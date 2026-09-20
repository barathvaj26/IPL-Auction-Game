/**
 * Dataset Audit — expansion phase (read-only audit, merges NOTHING).
 *
 * Compares every additional dataset in src/data/players/ against
 * processed/master_players.json (182 records) and writes:
 *   src/data/players/processed/dataset_audit.json
 *
 * Classification per aux record:
 *   exact     — slug identical to a master id (confident match)
 *   likely    — same last-name token + same first initial, different slug
 *               (REVIEW required, never auto-merged)
 *   ambiguous — one aux slug matching 2+ master ids (reported, not merged)
 *   new       — no master candidate
 * Duplicates = same slug twice in one dataset (cross-season repeats flagged
 * as seasonSplit, not errors). Conflicts = same identity with differing
 * role/country/team inside one season scope.
 *
 * Usage: node scripts/auditPlayerDatasets.js
 */

import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PD = path.join(ROOT, "src", "data", "players")
const OUT = path.join(PD, "processed", "dataset_audit.json")
const ZTMP = path.join(process.env.TEMP || process.env.TMP || "/tmp", "ipl-audit-archive")

const splitRow = (line) => {
  const out = []
  let cur = "", q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++ }
      else q = !q
    } else if (c === "," && !q) { out.push(cur); cur = "" }
    else cur += c
  }
  out.push(cur)
  return out
}

const readCsv = (file) => {
  const text = fs.readFileSync(file, "utf-8").replace(/^﻿/, "")
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  return {
    header: splitRow(lines[0]).map((s) => s.trim()),
    rows: lines.slice(1).map(splitRow),
  }
}

const slugify = (name) =>
  String(name || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-")

const normName = (s) => String(s || "").replace(/\s+/g, " ").trim()
const tokensOf = (slug) => slug.split("-").filter(Boolean)

/** Levenshtein distance (short slugs only — O(n*m) is fine). */
const editDistance = (a, b) => {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Tight likely-match rule (same last token AND one of):
 *  (a) initial-abbreviation either way ("r" vs "ravichandran", "b" vs "baba")
 *  (b) full-slug edit distance ≤ 2 (spelling variants: dushmanta/dushmantha)
 * Common-surname collisions ("sharma", "singh", "yadav", "khan") otherwise
 * fall through to ambiguous/new — never auto-merged.
 */
const isTightLikely = (auxSlug, masterId) => {
  const at = tokensOf(auxSlug), mt = tokensOf(masterId)
  if (at[at.length - 1] !== mt[mt.length - 1]) return false
  const af = at[0], mf = mt[0]
  const abbrev =
    (af.length === 1 && mf[0] === af) ||
    (mf.length === 1 && af[0] === mf) ||
    (af.length === 2 && af[1] === "." && mf[0] === af[0])
  if (abbrev) return true
  return editDistance(auxSlug, masterId) <= 2
}

// Dataset specs. seasonKey() scopes conflict/duplicate detection.
const SPECS = [
  {
    key: "sold-2022-2023", file: path.join(PD, "IPL_2023-22_Sold_Players.csv"),
    name: (r, h) => normName(r[h.indexOf("Name")]),
    seasonKey: (r, h) => (r[h.indexOf("Season")] || "").trim(),
    detail: (r, h) => ({
      role: (r[h.indexOf("Type")] || "").trim(),
      country: (r[h.indexOf("Nationality")] || "").trim(),
      team: (r[h.indexOf("Team")] || "").trim(),
      price: (r[h.indexOf("Price")] || "").trim(),
    }),
  },
  {
    key: "auction-list-2022", file: path.join(ZTMP, "2022 Auction", "IPL2022_Player_Auction_List.csv"),
    name: (r, h) => normName(`${r[h.indexOf("First Name")]} ${r[h.indexOf("Surname")]}`),
    seasonKey: () => "2022-pool",
    detail: (r, h) => ({
      role: (r[h.indexOf("Specialism")] || "").trim(),
      country: (r[h.indexOf("Country")] || "").trim(),
      team: (r[h.indexOf("2021 Team")] || "").trim(),
      price: (r[h.indexOf("Reserve Price Rs Lakh")] || "").trim(),
    }),
  },
  {
    key: "sold-2022", file: path.join(ZTMP, "2022 Auction", "IPL_2022_Sold_Players.csv"),
    name: (r, h) => normName(r[h.indexOf("Players")]),
    seasonKey: () => "2022",
    detail: (r, h) => ({
      role: (r[h.indexOf("Type")] || "").trim(),
      country: (r[h.indexOf("Nationality")] || "").trim(),
      team: (r[h.indexOf("Team")] || "").trim(),
      price: (r[h.indexOf("Price Paid")] || "").trim(),
    }),
  },
  {
    key: "fulllist-2022", file: path.join(ZTMP, "2022 Auction", "IPL_Auction_2022_FullList.csv"),
    name: (r, h) => normName(r[h.indexOf("Players")]),
    seasonKey: () => "2022-pool",
    detail: (r, h) => ({
      role: (r[h.indexOf("Specialism")] || "").trim(),
      country: (r[h.indexOf("Country")] || "").trim(),
      team: (r[h.indexOf("Team")] || "").trim(),
      price: (r[h.indexOf("Price Paid")] || "").trim(),
    }),
  },
  {
    key: "pool-2023", file: path.join(ZTMP, "2023 Auction", "IPL_2023_Auction_Pool.csv"),
    name: (r, h) => normName(`${r[h.indexOf("First Name")]} ${r[h.indexOf("Surname")]}`),
    seasonKey: () => "2023-pool",
    detail: (r, h) => ({
      role: (r[h.indexOf("Specialism")] || "").trim(),
      country: (r[h.indexOf("Country")] || "").trim(),
      team: (r[h.indexOf("2022 Team")] || "").trim(),
      price: (r[h.indexOf("Reserve_Price")] || "").trim(),
    }),
  },
  {
    key: "sold-2023", file: path.join(ZTMP, "2023 Auction", "IPL_2023_Auction_Sold.csv"),
    name: (r, h) => normName(`${r[h.indexOf("First Name")]} ${r[h.indexOf("Surname")]}`),
    seasonKey: () => "2023",
    detail: (r, h) => ({
      role: (r[h.indexOf("Specialism")] || "").trim(),
      country: (r[h.indexOf("Country")] || "").trim(),
      team: (r[h.indexOf("TEAM")] || "").trim(),
      price: (r[h.indexOf("Auction_Price")] || "").trim(),
    }),
  },
  {
    key: "submitted-2023", file: path.join(ZTMP, "2023 Auction", "IPL_2023_Auction_Submitted.csv"),
    name: (r, h) => normName(`${r[h.indexOf("First Name")]} ${r[h.indexOf("Surname")]}`),
    seasonKey: () => "2023-pool",
    detail: (r, h) => ({
      role: (r[h.indexOf("Role")] || "").trim(),
      country: (r[h.indexOf("Country")] || "").trim(),
      team: (r[h.indexOf("2022 Team")] || "").trim(),
      price: (r[h.indexOf("Reserve Price (Rs. Lakh)")] || "").trim(),
    }),
  },
]

const main = () => {
  // Extract archive to temp (original zip untouched).
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${path.join(PD, "archive.zip")}' -DestinationPath '${ZTMP}' -Force"`,
    { stdio: "ignore" }
  )

  const master = JSON.parse(fs.readFileSync(path.join(PD, "processed", "master_players.json"), "utf-8"))
  const masterById = new Map(master.players.map((p) => [p.id, p]))
  // last-token index for likely-match detection: lastToken -> [masterIds]
  const masterByLast = new Map()
  for (const p of master.players) {
    const toks = tokensOf(p.id)
    const last = toks[toks.length - 1]
    if (!masterByLast.has(last)) masterByLast.set(last, [])
    masterByLast.get(last).push(p.id)
  }

  const datasets = {}
  const totals = { exact: 0, likely: 0, ambiguous: 0, new: 0, duplicates: 0, seasonSplit: 0, conflicts: 0 }

  for (const spec of SPECS) {
    const { header, rows } = readCsv(spec.file)
    const recs = rows.map((r, i) => {
      const name = spec.name(r, header)
      return { name, slug: slugify(name), season: spec.seasonKey(r, header), detail: spec.detail(r, header), row: i + 2 }
    })

    // Match against master.
    let exact = 0, likely = 0, ambiguous = 0, fresh = 0
    const likelyRows = [], ambiguousRows = [], newRows = []
    for (const rec of recs) {
      if (!rec.slug) { ambiguousRows.push({ ...rec, note: "blank name" }); ambiguous++; continue }
      if (masterById.has(rec.slug)) { rec.match = { kind: "exact", masterId: rec.slug }; exact++; continue }
      const toks = tokensOf(rec.slug)
      const last = toks[toks.length - 1]
      const sameLast = masterByLast.get(last) || []
      const tight = sameLast.filter((id) => isTightLikely(rec.slug, id))
      if (tight.length === 1) {
        rec.match = { kind: "likely", masterId: tight[0] }
        likelyRows.push({ aux: rec.name, master: masterById.get(tight[0]).name })
        likely++
        continue
      }
      if (tight.length > 1) {
        rec.match = { kind: "ambiguous", candidates: tight }
        ambiguousRows.push({ aux: rec.name, candidates: tight.map((id) => masterById.get(id).name) })
        ambiguous++
        continue
      }
      // Loose surname collision (review-only signal, never a match).
      const loose = sameLast.filter((id) => tokensOf(id)[0][0] === toks[0][0])
      if (loose.length >= 2) {
        rec.match = { kind: "ambiguous", candidates: loose }
        ambiguousRows.push({ aux: rec.name, candidates: loose.map((id) => masterById.get(id).name) })
        ambiguous++
        continue
      }
      rec.match = { kind: "new" }
      newRows.push(rec.name)
      fresh++
    }

    // Duplicates within dataset (same slug + same season scope).
    const seen = new Map()
    const dups = [], splits = []
    for (const rec of recs) {
      const k = `${rec.season}||${rec.slug}`
      if (seen.has(k)) {
        // Same season repeat = true duplicate; different rows same name
        // across seasons collapse into same scope only for pool files.
        dups.push({ name: rec.name, season: rec.season, rows: [seen.get(k), rec.row] })
      } else seen.set(k, rec.row)
    }
    // Cross-season repeats of the same slug in this file (informational).
    const bySlug = new Map()
    for (const rec of recs) {
      if (!bySlug.has(rec.slug)) bySlug.set(rec.slug, new Set())
      bySlug.get(rec.slug).add(rec.season)
    }
    for (const [slug, seasons] of bySlug) {
      if (seasons.size > 1) splits.push({ slug, seasons: [...seasons] })
    }

    // Conflicts: same slug+season, differing role/country/team.
    const byKey = new Map()
    for (const rec of recs) {
      const k = `${rec.season}||${rec.slug}`
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(rec)
    }
    const conflicts = []
    for (const [k, group] of byKey) {
      if (group.length < 2) continue
      const roles = new Set(group.map((g) => g.detail.role))
      const countries = new Set(group.map((g) => g.detail.country))
      const teams = new Set(group.map((g) => g.detail.team))
      // Team changes across rows in one season file = conflict unless the
      // file is a sold-list where each row is a distinct sale (root file
      // separates seasons, so same-season team change is a real conflict).
      if (roles.size > 1 || countries.size > 1 || teams.size > 1) {
        conflicts.push({ key: k, name: group[0].name, roles: [...roles], countries: [...countries], teams: [...teams] })
      }
    }

    totals.exact += exact; totals.likely += likely; totals.ambiguous += ambiguous
    totals.new += fresh; totals.duplicates += dups.length; totals.seasonSplit += splits.length
    totals.conflicts += conflicts.length

    datasets[spec.key] = {
      file: path.relative(ROOT, spec.file),
      records: recs.length,
      columns: header,
      exact, likely, ambiguous, new: fresh,
      duplicates: dups, crossSeasonSlugs: splits, conflicts,
      likelyRows: likelyRows.slice(0, 40), ambiguousRows: ambiguousRows.slice(0, 40),
    }
    if (newRows.length && (spec.key === "sold-2022-2023" || fresh < 60)) {
      datasets[spec.key].newNames = newRows
    }
    datasets[spec.key].newCount = fresh
  }

  const payload = {
    meta: { generatedBy: "scripts/auditPlayerDatasets.js", master: "processed/master_players.json", masterCount: master.players.length },
    totals, datasets,
  }
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log("=== Dataset Audit Summary ===")
  for (const [key, d] of Object.entries(datasets)) {
    console.log(`${key}: ${d.records} rec | exact ${d.exact} | likely ${d.likely} | ambiguous ${d.ambiguous} | new ${d.newCount} | dupes ${d.duplicates.length} | xSeason ${d.crossSeasonSlugs.length} | conflicts ${d.conflicts.length}`)
  }
  console.log("TOTALS:", JSON.stringify(totals))
  console.log("Wrote:", path.relative(ROOT, OUT))
}

main()
