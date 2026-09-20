/**
 * Player Database Builder — MASTER MERGE phase.
 *
 * Pipeline:
 *   1. Build 182 base records from IPL dataset final.csv (STATISTICAL
 *      AUTHORITY — ipl/t20i blocks are never overwritten afterwards).
 *   2. Parse 7 auxiliary auction datasets (in priority order) into
 *      normalized aux records.
 *   3. Match aux → base via exact slug or REVIEWED_ALLOWLIST only.
 *      Likely/ambiguous surname collisions are NEVER auto-merged.
 *   4. Additive merge (first-known-wins by priority) + full conflict log.
 *   5. New archive-only players added with null statistics.
 *   6. Validate (10-point safety checklist) → write master_players.json
 *      + merge_report.json. Deterministic: sorted output, no timestamps.
 *
 * Usage: npm run build:players   (node scripts/buildPlayerDatabase.js)
 */

import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PLAYERS_DIR = path.join(ROOT, "src", "data", "players")
const OUT_DIR = path.join(PLAYERS_DIR, "processed")
const OUT_FILE = path.join(OUT_DIR, "master_players.json")
const REPORT_FILE = path.join(OUT_DIR, "merge_report.json")
const ZTMP = path.join(process.env.TEMP || process.env.TMP || "/tmp", "ipl-player-merge")

// ---------------------------------------------------------------------------
// Reviewed allowlist: aux-slug → master-id. Hand-verified spelling/initial
// variants ONLY. Known near-collisions (mohit→rohit sharma, ajaz→axar patel,
// aman→karan sharma, …) are DELIBERATELY absent. Build aborts if an entry
// fails to resolve on either side.
// ---------------------------------------------------------------------------
const REVIEWED_ALLOWLIST = {
  "r-ashwin": "ravichandran-ashwin",
  "k-gowtham": "krishnappa-gowtham",
  "raj-angad-bawa": "rajangad-bawa",
  "dushmanta-chameera": "dushmantha-chameera",
  "baba-indrajith": "b-indrajith",
  "n-tilak-varma": "tilak-varma",
  "b-sai-sudharsan": "sai-sudharsan",
  "r-sai-kishore": "sai-kishore",
  "kuldip-yadav": "kuldeep-yadav",
  "karn-sharma": "karan-sharma",
  "suyash-prabhudessai": "suyash-s-prabhudessai",
  "jimmy-neesham": "james-neesham",
}

// ---------------------------------------------------------------------------
// Normalization tables
// ---------------------------------------------------------------------------
const COUNTRY_MAP = {
  IND: "India", AUS: "Australia", ENG: "England", NZ: "New Zealand",
  SA: "South Africa", WI: "West Indies", SL: "Sri Lanka",
  BAN: "Bangladesh", AFG: "Afghanistan",
}
const TEAM_FULL_MAP = {
  "CHENNAI SUPER KINGS": "CSK", "DELHI CAPITALS": "DC", "GUJARAT TITANS": "GT",
  "KOLKATA KNIGHT RIDERS": "KKR", "LUCKNOW SUPER GIANTS": "LSG",
  "MUMBAI INDIANS": "MI", "PUNJAB KINGS": "PBKS", "RAJASTHAN ROYALS": "RR",
  "ROYAL CHALLENGERS BANGALORE": "RCB", "SUNRISERS HYDERABAD": "SRH",
  PK: "PBKS", PBKS: "PBKS",
}
const NULL_TEAM_TOKENS = new Set(["", "UNSOLD", "DO NO PLAY", "-", "NA"])

const normalizeRole = (raw) => {
  const v = String(raw || "").trim().toLowerCase().replace(/[-_]+/g, " ")
  if (["batting", "batter", "batsman"].includes(v)) return "BATTER"
  if (["bowling", "bowler"].includes(v)) return "BOWLER"
  if (["all rounder", "allrounder", "all rounders"].includes(v)) return "ALL_ROUNDER"
  if (["wicket keeper", "wicketkeeper", "keeper", "wk"].includes(v)) return "WICKET_KEEPER"
  return null
}

const normalizeTeam = (raw) => {
  const v = String(raw || "").trim()
  if (NULL_TEAM_TOKENS.has(v.toUpperCase())) return null
  return TEAM_FULL_MAP[v.toUpperCase()] || TEAM_FULL_MAP[v] || v || null
}

const toNumber = (raw, { integer = false } = {}) => {
  if (raw === undefined || raw === null) return null
  const s = String(raw).trim().replace(/\*+$/g, "")
  if (s === "" || s === "-") return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return integer ? Math.trunc(n) : n
}

/** Lakh float/int → Cr (2dp). */
const lakhToCr = (raw) => {
  const n = Number(String(raw || "").trim())
  if (!Number.isFinite(n)) return null
  return Math.round((n / 100) * 100) / 100
}

/** Raw rupees ("50000000.0", "₹2,00,00,000", "50,00,000") → Cr (2dp). */
const rupeesToCr = (raw) => {
  if (raw === undefined || raw === null) return null
  const s = String(raw).replace(/₹/g, "").replace(/,/g, "").trim()
  if (s === "" || s === "-") return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round((n / 10000000) * 100) / 100
}

/** '6cr' | '50l' → Cr (2dp). */
const crLakhToCr = (raw) => {
  const display = String(raw || "").trim()
  const m = display.match(/^([\d.]+)\s*(cr|l)$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return Math.round((m[2].toLowerCase() === "l" ? n / 100 : n) * 100) / 100
}

const slugify = (name) =>
  String(name || "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-")

const toISODate = (raw) => {
  const s = String(raw || "").trim()
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
}

const titleCase = (s) =>
  String(s || "").toLowerCase().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ")

const splitRow = (line) => {
  const out = []
  let cur = "", quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ }
      else quoted = !quoted
    } else if (c === "," && !quoted) { out.push(cur); cur = "" }
    else cur += c
  }
  out.push(cur)
  return out
}

const readCsv = (file) => {
  const text = fs.readFileSync(file, "utf-8").replace(/^﻿/, "")
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const header = splitRow(lines[0]).map((s) => s.trim())
  return { header, rows: lines.slice(1).map(splitRow) }
}

// ---------------------------------------------------------------------------
// STEP 1 — base records (unchanged logic from foundation phase)
// ---------------------------------------------------------------------------
const INT_FIELDS = new Set([
  "matches", "innings", "runs", "balls", "notOuts", "fours", "sixes",
  "ducks", "fifties", "hundreds", "maidens", "wickets", "fourWickets", "fiveWickets",
])

const pickStats = (row, header, map, issues, playerName) => {
  const out = {}
  for (const [field, col] of Object.entries(map)) {
    const ci = header.indexOf(col)
    const raw = ci >= 0 ? row[ci] : undefined
    if (ci < 0) { out[field] = null; continue }
    const val = toNumber(raw, { integer: INT_FIELDS.has(field) })
    if (raw !== undefined && String(raw).trim() !== "" && String(raw).trim() !== "-" && val === null) {
      issues.push(`${playerName}: unparsable numeric ${col}="${String(raw).trim()}" → null`)
    }
    out[field] = val
  }
  return out
}

const BASE = {
  key: "ipl-dataset-final",
  file: path.join(PLAYERS_DIR, "IPL dataset final.csv"),
  battingMap: {
    matches: "Mat", innings: "Inns", runs: "Runs", balls: "BF",
    highestScore: "HS", average: "Avg", strikeRate: "SR", notOuts: "NO",
    fours: "4s", sixes: "6s", ducks: "0s", fifties: "50s", hundreds: "100s",
  },
  t20iBattingMap: {
    matches: "TMat", innings: "TInns", runs: "TRuns", balls: "TBF",
    highestScore: "THS", average: "TAvg", strikeRate: "TSR", notOuts: "TNO",
    fours: "T4s", sixes: "T6s", ducks: "T0s", fifties: "T50s", hundreds: "T100s",
  },
  bowlingMap: {
    innings: "B_Inns", balls: "B_Balls", runsConceded: "B_Runs",
    maidens: "B_Maidens", wickets: "B_Wkts", average: "B_Avg",
    economy: "B_Econ", strikeRate: "B_SR", fourWickets: "B_4w", fiveWickets: "B_5w",
  },
  t20iBowlingMap: {
    innings: "B_TInns", balls: "B_TBalls", runsConceded: "B_TRuns",
    maidens: "B_TMaidens", wickets: "B_TWkts", average: "B_TAvg",
    economy: "B_TEcon", strikeRate: "B_TSR", fourWickets: "B_T4w", fiveWickets: "B_T5w",
  },
}

const buildBaseRecords = (issues) => {
  const { header, rows } = readCsv(BASE.file)
  const cell = (row, name) => {
    const i = header.indexOf(name)
    return i >= 0 ? String(row[i] ?? "").trim() : ""
  }
  return rows.map((row, i) => {
    const rowNumber = i + 2
    const name = cell(row, "Player")
    const rawCountry = cell(row, "COUNTRY")
    const rawTeam = cell(row, "TEAM")
    const rawRole = cell(row, "Paying_Role")
    const role = normalizeRole(rawRole)
    const age = toNumber(cell(row, "AGE"), { integer: true })
    const captaincySeasons = toNumber(cell(row, "CAPTAINCY EXP"), { integer: true })
    const soldRaw = cell(row, "SOLD_PRICE")
    return {
      id: slugify(name),
      name,
      country: COUNTRY_MAP[rawCountry] || null,
      countryCode: rawCountry || null,
      age,
      dateOfBirth: null,
      role,
      roleRaw: rawRole || null,
      roleConflicts: [],
      team: rawTeam === "PK" ? "PBKS" : rawTeam || null,
      previousTeams: [],
      captaincyExperience: captaincySeasons !== null && captaincySeasons > 0,
      captaincySeasons,
      isOverseas: rawCountry ? rawCountry !== "IND" : null,
      isCapped: null,
      isAssociate: null,
      battingStyle: null,
      bowlingStyle: null,
      caps: { test: null, odi: null, t20i: null, ipl: null },
      auction: {
        basePrice: null,
        basePriceDisplay: null,
        soldPriceCr: crLakhToCr(soldRaw),
        soldPriceDisplay: soldRaw || null,
        auctionHistory: [],
        auctionSets: [],
      },
      ipl: {
        batting: pickStats(row, header, BASE.battingMap, issues, name),
        bowling: pickStats(row, header, BASE.bowlingMap, issues, name),
      },
      t20i: {
        batting: pickStats(row, header, BASE.t20iBattingMap, issues, name),
        bowling: pickStats(row, header, BASE.t20iBowlingMap, issues, name),
        interpretation: "T20 International career statistics",
      },
      source: { datasets: [{ key: BASE.key, file: path.basename(BASE.file), row: rowNumber }] },
    }
  })
}

// ---------------------------------------------------------------------------
// STEP 2 — auxiliary dataset specs (priority order for enrichment)
// ---------------------------------------------------------------------------
const capInt = (v) => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (s === "" || s === "-") return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

const fullNameToCountry = (v) => {
  const s = String(v || "").trim()
  if (!s) return null
  const hit = Object.entries(COUNTRY_MAP).find(([, full]) => full.toLowerCase() === s.toLowerCase())
  return hit ? hit[1] : s // keep raw (e.g. Nepal/Ireland) — reported, not dropped
}

/**
 * Each spec parses one file into normalized aux records:
 * { slug, name, seasonScope, role, roleRaw, country, overseasFlag, team,
 *   prevTeams[], reserveCr, soldCr, soldDisplay, status, set, caps{},
 *   battingStyle, bowlingStyle, dob, age, cua, file, row }
 */
const AUX_SPECS = [
  {
    key: "sold-2023", file: () => path.join(ZTMP, "2023 Auction", "IPL_2023_Auction_Sold.csv"),
    parse(h, rows, file) {
      const g = (r, c) => String(r[h.indexOf(c)] ?? "").trim()
      return rows.map((r, i) => {
        const auc = g(r, "Auction_Price")
        const sold = auc !== "" && auc !== "0" && auc !== "0.0"
        const team = normalizeTeam(g(r, "TEAM"))
        return {
          slug: slugify(`${g(r, "First Name")} ${g(r, "Surname")}`),
          name: `${g(r, "First Name")} ${g(r, "Surname")}`.replace(/\s+/g, " ").trim(),
          seasonScope: 2023,
          role: normalizeRole(g(r, "Specialism")), roleRaw: g(r, "Specialism") || null,
          country: fullNameToCountry(g(r, "Country")), overseasFlag: null,
          team: sold ? team : null, prevTeams: !sold && team ? [] : (team ? [] : []),
          priorTeam: g(r, "2022 Team"),
          reserveCr: lakhToCr(g(r, "Reserve_Price")), reserveDisplay: g(r, "Reserve_Price") ? `${g(r, "Reserve_Price")} lakh` : null,
          soldCr: sold ? lakhToCr(auc) : null, soldDisplay: sold ? `${auc} lakh` : null,
          status: sold ? "SOLD" : "UNSOLD",
          set: g(r, "2023 Set") || null,
          caps: { test: capInt(g(r, "Test caps")), odi: capInt(g(r, "ODI caps")), t20i: capInt(g(r, "T20 caps")), ipl: capInt(g(r, "IPL")) },
          battingStyle: g(r, "Batting_Style") || null, bowlingStyle: g(r, "Bowling_Style") || null,
          dob: toISODate(g(r, "DOB")), age: toNumber(g(r, "Age"), { integer: true }), cua: g(r, "C/U/A") || null,
          file, row: i + 2,
        }
      })
    },
  },
  {
    key: "pool-2023", file: () => path.join(ZTMP, "2023 Auction", "IPL_2023_Auction_Pool.csv"),
    parse(h, rows, file) {
      const g = (r, c) => String(r[h.indexOf(c)] ?? "").trim()
      return rows.map((r, i) => ({
        slug: slugify(`${g(r, "First Name")} ${g(r, "Surname")}`),
        name: `${g(r, "First Name")} ${g(r, "Surname")}`.replace(/\s+/g, " ").trim(),
        seasonScope: 2023,
        role: normalizeRole(g(r, "Specialism")), roleRaw: g(r, "Specialism") || null,
        country: fullNameToCountry(g(r, "Country")), overseasFlag: null,
        team: null, priorTeam: g(r, "2022 Team"),
        reserveCr: lakhToCr(g(r, "Reserve_Price")), reserveDisplay: g(r, "Reserve_Price") ? `${g(r, "Reserve_Price")} lakh` : null,
        soldCr: null, soldDisplay: null, status: null,
        set: g(r, "2023 Set") || null,
        caps: { test: capInt(g(r, "Test caps")), odi: capInt(g(r, "ODI caps")), t20i: capInt(g(r, "T20 caps")), ipl: capInt(g(r, "IPL")) },
        battingStyle: g(r, "Batting_Style") || null, bowlingStyle: g(r, "Bowling_Style") || null,
        dob: toISODate(g(r, "DOB")), age: toNumber(g(r, "Age"), { integer: true }), cua: g(r, "C/U/A") || null,
        file, row: i + 2,
      }))
    },
  },
  {
    key: "sold-2022-2023", file: () => path.join(PLAYERS_DIR, "IPL_2023-22_Sold_Players.csv"),
    parse(h, rows, file) {
      const g = (r, c) => String(r[h.indexOf(c)] ?? "").trim()
      return rows.map((r, i) => {
        const nat = g(r, "Nationality")
        return {
          slug: slugify(g(r, "Name")),
          name: g(r, "Name"),
          seasonScope: Number(g(r, "Season")) || null,
          role: normalizeRole(g(r, "Type")), roleRaw: g(r, "Type") || null,
          country: nat === "Indian" ? "India" : nat === "Overseas" ? null : fullNameToCountry(nat),
          overseasFlag: nat === "Overseas" ? true : nat === "Indian" ? false : null,
          team: normalizeTeam(g(r, "Team")), priorTeam: "",
          reserveCr: null, reserveDisplay: null,
          soldCr: rupeesToCr(g(r, "Price")), soldDisplay: g(r, "Price") || null,
          status: "SOLD",
          set: null,
          caps: { test: null, odi: null, t20i: null, ipl: null },
          battingStyle: null, bowlingStyle: null,
          dob: null, age: null, cua: null,
          file, row: i + 2,
        }
      })
    },
  },
  {
    key: "fulllist-2022", file: () => path.join(ZTMP, "2022 Auction", "IPL_Auction_2022_FullList.csv"),
    parse(h, rows, file) {
      const g = (r, c) => String(r[h.indexOf(c)] ?? "").trim()
      return rows.map((r, i) => {
        const bid = g(r, "Bid")
        const sold = bid.toLowerCase() === "sold"
        const paid = g(r, "Price Paid")
        return {
          slug: slugify(g(r, "Players")),
          name: g(r, "Players"),
          seasonScope: 2022,
          role: normalizeRole(g(r, "Specialism")), roleRaw: g(r, "Specialism") || null,
          country: fullNameToCountry(g(r, "Country")), overseasFlag: null,
          team: sold ? normalizeTeam(g(r, "Team")) : null, priorTeam: g(r, "2021 Team"),
          prevTeamList: g(r, "Previous IPLTeam(s)"),
          reserveCr: lakhToCr(g(r, "Reserve Price Rs Lakh")),
          reserveDisplay: g(r, "Reserve Price Rs Lakh") ? `${g(r, "Reserve Price Rs Lakh")} lakh` : null,
          soldCr: sold && paid !== "" ? rupeesToCr(paid) : null,
          soldDisplay: sold ? paid || null : null,
          status: bid ? bid.toUpperCase() : null,
          set: g(r, "2022 Set") || null,
          caps: { test: capInt(g(r, "Test caps")), odi: capInt(g(r, "ODI caps")), t20i: capInt(g(r, "T20 caps")), ipl: capInt(g(r, "IPL")) },
          battingStyle: g(r, "Batting Style") || null, bowlingStyle: g(r, "Bowling Style") || null,
          dob: null, age: toNumber(g(r, "Age"), { integer: true }), cua: g(r, "C/U/A") || null,
          file, row: i + 2,
        }
      })
    },
  },
  {
    key: "sold-2022", file: () => path.join(ZTMP, "2022 Auction", "IPL_2022_Sold_Players.csv"),
    parse(h, rows, file) {
      const g = (r, c) => String(r[h.indexOf(c)] ?? "").trim()
      return rows.map((r, i) => {
        const nat = g(r, "Nationality")
        return {
          slug: slugify(g(r, "Players")),
          name: g(r, "Players"),
          seasonScope: 2022,
          role: normalizeRole(g(r, "Type")), roleRaw: g(r, "Type") || null,
          country: nat === "Indian" ? "India" : nat === "Overseas" ? null : fullNameToCountry(nat),
          overseasFlag: nat === "Overseas" ? true : nat === "Indian" ? false : null,
          team: normalizeTeam(g(r, "Team")), priorTeam: "",
          reserveCr: null, reserveDisplay: null,
          soldCr: rupeesToCr(g(r, "Price Paid")), soldDisplay: g(r, "Price Paid") || null,
          status: "SOLD",
          set: null,
          caps: { test: null, odi: null, t20i: null, ipl: null },
          battingStyle: null, bowlingStyle: null,
          dob: null, age: null, cua: null,
          file, row: i + 2,
        }
      })
    },
  },
  {
    key: "auction-list-2022", file: () => path.join(ZTMP, "2022 Auction", "IPL2022_Player_Auction_List.csv"),
    parse(h, rows, file) {
      const g = (r, c) => String(r[h.indexOf(c)] ?? "").trim()
      return rows.map((r, i) => ({
        slug: slugify(`${g(r, "First Name")} ${g(r, "Surname")}`),
        name: `${g(r, "First Name")} ${g(r, "Surname")}`.replace(/\s+/g, " ").trim(),
        seasonScope: 2022,
        role: normalizeRole(g(r, "Specialism")), roleRaw: g(r, "Specialism") || null,
        country: fullNameToCountry(g(r, "Country")), overseasFlag: null,
        team: null, priorTeam: g(r, "2021 Team"),
        reserveCr: lakhToCr(g(r, "Reserve Price Rs Lakh")),
        reserveDisplay: g(r, "Reserve Price Rs Lakh") ? `${g(r, "Reserve Price Rs Lakh")} lakh` : null,
        soldCr: null, soldDisplay: null, status: null,
        set: g(r, "2022 Set") || null,
        caps: { test: capInt(g(r, "Test caps")), odi: capInt(g(r, "ODI caps")), t20i: capInt(g(r, "T20 caps")), ipl: capInt(g(r, "IPL")) },
        battingStyle: null, bowlingStyle: null,
        dob: toISODate(g(r, "DOB")), age: toNumber(g(r, "Age"), { integer: true }), cua: g(r, "C/U/A") || null,
        file, row: i + 2,
      }))
    },
  },
  {
    key: "submitted-2023", file: () => path.join(ZTMP, "2023 Auction", "IPL_2023_Auction_Submitted.csv"),
    parse(h, rows, file) {
      const g = (r, c) => String(r[h.indexOf(c)] ?? "").trim()
      return rows.map((r, i) => ({
        slug: slugify(`${g(r, "First Name")} ${g(r, "Surname")}`),
        name: `${g(r, "First Name")} ${g(r, "Surname")}`.replace(/\s+/g, " ").trim(),
        seasonScope: 2023,
        role: normalizeRole(g(r, "Role")), roleRaw: g(r, "Role") || null,
        country: fullNameToCountry(g(r, "Country")), overseasFlag: null,
        team: null, priorTeam: g(r, "2022 Team"),
        prevTeamList: g(r, "Previous IPL Team(s)"),
        reserveCr: lakhToCr(g(r, "Reserve Price (Rs. Lakh)")),
        reserveDisplay: g(r, "Reserve Price (Rs. Lakh)") ? `${g(r, "Reserve Price (Rs. Lakh)")} lakh` : null,
        soldCr: null, soldDisplay: null, status: null,
        set: null,
        caps: { test: capInt(g(r, "Test caps")), odi: capInt(g(r, "ODI caps")), t20i: capInt(g(r, "T20 caps")), ipl: capInt(g(r, "IPL")) },
        battingStyle: null, bowlingStyle: null,
        dob: null, age: toNumber(g(r, "Age"), { integer: true }), cua: g(r, "C/U/A") || null,
        file, row: i + 2,
      }))
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const styleNorm = (kind, v) => {
  if (!v) return null
  if (String(v).trim() === "-") return null
  const t = titleCase(v)
  if (kind === "bat") {
    if (/^RHB$/i.test(v)) return "Right-hand bat"
    if (/^LHB$/i.test(v)) return "Left-hand bat"
  }
  return t
}

const prevTeamsOf = (aux) => {
  const out = []
  for (const raw of [aux.priorTeam, aux.prevTeamList]) {
    if (!raw) continue
    for (const tok of String(raw).split(",")) {
      const t = tok.trim()
      if (!t || NULL_TEAM_TOKENS.has(t.toUpperCase())) continue
      const code = TEAM_FULL_MAP[t.toUpperCase()] || t
      if (!out.includes(code)) out.push(code)
    }
  }
  return out
}

const blankStats = (map) => Object.fromEntries(Object.keys(map).map((k) => [k, null]))

const newPlayerRecord = (aux) => ({
  id: aux.slug,
  name: aux.name,
  country: aux.country,
  countryCode: null,
  age: aux.age,
  dateOfBirth: aux.dob,
  role: aux.role,
  roleRaw: aux.roleRaw,
  roleConflicts: [],
  team: aux.team,
  previousTeams: prevTeamsOf(aux),
  captaincyExperience: false,
  captaincySeasons: null,
  isOverseas: aux.country ? aux.country !== "India" : aux.overseasFlag,
  isCapped: aux.cua === "Capped" ? true : aux.cua === "Uncapped" ? false : null,
  isAssociate: aux.cua === "Associate" ? true : aux.cua ? false : null,
  battingStyle: styleNorm("bat", aux.battingStyle),
  bowlingStyle: styleNorm("bowl", aux.bowlingStyle),
  caps: { ...aux.caps },
  auction: {
    basePrice: aux.reserveCr,
    basePriceDisplay: aux.reserveDisplay,
    soldPriceCr: null,
    soldPriceDisplay: null,
    auctionHistory: [],
    auctionSets: aux.set && aux.seasonScope ? [{ season: aux.seasonScope, set: aux.set }] : [],
  },
  ipl: { batting: blankStats(BASE.battingMap), bowling: blankStats(BASE.bowlingMap) },
  t20i: {
    batting: blankStats(BASE.t20iBattingMap),
    bowling: blankStats(BASE.t20iBowlingMap),
    interpretation: "T20 International career statistics",
  },
  source: { datasets: [{ key: aux.key, file: path.basename(aux.file), row: aux.row }] },
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = () => {
  const issues = []
  const merge = {
    exactMerges: 0, allowlistMerges: 0, allowlistUsed: [],
    ambiguousExcluded: 0, ambiguousSamples: [],
    teamUpdates: [],
    newPlayers: 0, duplicatesResolved: 0,
    roleConflicts: [], countryConflicts: [], teamConflicts: [], priceConflicts: [],
    wkUpgraded: [],
  }

  // STEP 1 — base.
  const base = buildBaseRecords(issues)
  const baseIds = new Set(base.map((b) => b.id))
  if (baseIds.size !== base.length) {
    console.error("FATAL: duplicate ids in base dataset")
    process.exit(1)
  }
  // BASE_TEAM_SEASON evidence: dataset-final lacks 2023 debutants/returnees
  // (Brook, Green, Curran, Stokes all absent) and carries 2022 affiliations
  // (Mayank→PBKS, Rahane→KKR, Williamson→SRH). T20I stat vintage ≈ Jan 2023.
  const BASE_TEAM_SEASON = 2022
  // Surname index over BASE ids only (new ids must not self-match).
  const baseByLast = new Map()
  for (const b of base) {
    const toks = b.id.split("-").filter(Boolean)
    const last = toks[toks.length - 1]
    if (!baseByLast.has(last)) baseByLast.set(last, [])
    baseByLast.get(last).push(b.id)
  }
  // True ambiguous rule (audit §): unmatched aux slug sharing last token +
  // first initial with 2+ base ids needs human review — counted, never merged.
  const isAmbiguousNew = (slug) => {
    const toks = slug.split("-").filter(Boolean)
    if (!toks.length) return false
    const cands = (baseByLast.get(toks[toks.length - 1]) || [])
      .filter((id) => id.split("-")[0][0] === toks[0][0] && id !== slug)
    return cands.length >= 2 ? cands : null
  }
  const baseStatsSnapshot = new Map(base.map((b) => [b.id, JSON.stringify({ ipl: b.ipl, t20i: { batting: b.t20i.batting, bowling: b.t20i.bowling } })]))
  const byId = new Map(base.map((b) => [b.id, b]))

  // Allowlist sanity: both sides resolve (aux side checked during parse).
  const allowTargets = new Set(Object.values(REVIEWED_ALLOWLIST))
  for (const id of allowTargets) {
    if (!byId.has(id)) { console.error(`FATAL: allowlist target missing in master: ${id}`); process.exit(1) }
  }

  // Extract archive once.
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${path.join(PLAYERS_DIR, "archive.zip")}' -DestinationPath '${ZTMP}' -Force"`,
    { stdio: "ignore" }
  )

  // STEP 2+3 — parse aux in priority order, match, merge.
  const teamUpdated = new Set()
  for (const spec of AUX_SPECS) {
    const { header, rows } = readCsv(spec.file())
    const auxRecs = spec.parse(header, rows, spec.file()).map((a) => ({ ...a, key: spec.key }))

    // Intra-file duplicates: same slug+season → union into one aux record.
    const grouped = new Map()
    for (const a of auxRecs) {
      const k = `${a.seasonScope}||${a.slug}`
      if (!grouped.has(k)) grouped.set(k, [])
      grouped.get(k).push(a)
    }
    const deduped = []
    for (const [, group] of grouped) {
      if (group.length === 1) { deduped.push(group[0]); continue }
      merge.duplicatesResolved += group.length - 1
      const first = [...group].sort((x, y) => x.row - y.row)[0]
      const union = { ...first }
      for (const g of group) {
        for (const f of ["role", "roleRaw", "country", "team", "priorTeam", "reserveCr", "soldCr", "status", "set", "battingStyle", "bowlingStyle", "dob", "age", "cua"]) {
          if ((union[f] === null || union[f] === undefined || union[f] === "") && g[f] !== null && g[f] !== undefined && g[f] !== "") {
            union[f] = g[f]
          }
        }
        for (const c of ["test", "odi", "t20i", "ipl"]) {
          if (union.caps[c] === null && g.caps[c] !== null) union.caps[c] = g.caps[c]
        }
        if (g.overseasFlag !== null && union.overseasFlag === null) union.overseasFlag = g.overseasFlag
      }
      // Same-key field variance on dup rows = conflict evidence.
      const roles = new Set(group.map((g) => g.role).filter(Boolean))
      if (roles.size > 1) {
        merge.roleConflicts.push({ dataset: spec.key, slug: first.slug, name: first.name, values: [...roles], note: "intra-file duplicate rows disagree" })
      }
      union._dupRows = group.map((g) => g.row)
      deduped.push(union)
    }

    for (const aux of deduped) {
      if (!aux.slug) continue
      let targetId = null
      if (byId.has(aux.slug)) { targetId = aux.slug; merge.exactMerges++ }
      else if (REVIEWED_ALLOWLIST[aux.slug]) {
        targetId = REVIEWED_ALLOWLIST[aux.slug]
        merge.allowlistMerges++
        if (!merge.allowlistUsed.includes(aux.slug)) merge.allowlistUsed.push(aux.slug)
      } else {
        // Genuinely ambiguous surname collisions are counted and still
        // added as separate records (never merged into a master id).
        const ambCands = isAmbiguousNew(aux.slug)
        if (ambCands) {
          merge.ambiguousExcluded++
          if (merge.ambiguousSamples.length < 30) {
            merge.ambiguousSamples.push({
              dataset: spec.key,
              aux: aux.name,
              candidates: ambCands.map((id) => byId.get(id)?.name || id),
            })
          }
        }
        // New player record.
        const rec = newPlayerRecord(aux)
        // History entry for sold/unsold outcome datasets.
        if (aux.status && aux.seasonScope) {
          rec.auction.auctionHistory.push({
            season: aux.seasonScope, team: aux.team, priceCr: aux.soldCr,
            priceDisplay: aux.soldDisplay, status: aux.status, source: spec.key,
          })
        }
        byId.set(rec.id, rec)
        merge.newPlayers++
        continue
      }

      // Merge into canonical record (additive, first-known-wins).
      const rec = byId.get(targetId)
      rec.source.datasets.push({ key: spec.key, file: path.basename(aux.file), row: aux.row })

      // Role: base kept; WK evidence upgrades (base dataset has no keepers).
      if (aux.role && aux.role !== rec.role) {
        if (aux.role === "WICKET_KEEPER") {
          rec.roleConflicts.push({ kept: "WICKET_KEEPER", rejected: rec.role, from: rec.roleRaw, dataset: spec.key })
          merge.roleConflicts.push({ dataset: spec.key, slug: targetId, name: rec.name, upgradedTo: "WICKET_KEEPER", previous: rec.role })
          merge.wkUpgraded.push(targetId)
          rec.role = "WICKET_KEEPER"
        } else {
          merge.roleConflicts.push({ dataset: spec.key, slug: targetId, name: rec.name, kept: rec.role, rejected: aux.role, raw: aux.roleRaw })
          rec.roleConflicts.push({ kept: rec.role, rejected: aux.role, from: aux.roleRaw, dataset: spec.key })
        }
      }

      // Country: base kept; conflict logged. New-record path fills nulls.
      if (aux.country && !rec.country) rec.country = aux.country
      else if (aux.country && rec.country && aux.country !== rec.country) {
        merge.countryConflicts.push({ dataset: spec.key, slug: targetId, name: rec.name, kept: rec.country, rejected: aux.country })
      }
      if (rec.isOverseas === null || rec.isOverseas === undefined) {
        if (aux.country) rec.isOverseas = aux.country !== "India"
        else if (aux.overseasFlag !== null) rec.isOverseas = aux.overseasFlag
      } else if (aux.country && (aux.country !== "India") !== rec.isOverseas) {
        merge.countryConflicts.push({ dataset: spec.key, slug: targetId, name: rec.name, keptOverseas: rec.isOverseas, rejectedCountry: aux.country })
      }

      // Team chronology: base affiliations are BASE_TEAM_SEASON vintage, so a
      // SOLD record from a later season supersedes (old team → previousTeams,
      // logged as teamUpdates, not conflicts). Same/older-season variance
      // keeps the canonical value and logs a conflict.
      if (!rec.team && aux.team) rec.team = aux.team
      else if (aux.team && rec.team && aux.team !== rec.team) {
        if (aux.status === "SOLD" && aux.seasonScope && aux.seasonScope > BASE_TEAM_SEASON && !teamUpdated.has(targetId)) {
          if (!rec.previousTeams.includes(rec.team)) rec.previousTeams.push(rec.team)
          merge.teamUpdates.push({ dataset: spec.key, slug: targetId, name: rec.name, from: rec.team, to: aux.team, season: aux.seasonScope })
          rec.team = aux.team
          teamUpdated.add(targetId)
        } else {
          merge.teamConflicts.push({ dataset: spec.key, slug: targetId, name: rec.name, kept: rec.team, soldTeam: aux.team, season: aux.seasonScope })
        }
      }
      for (const t of prevTeamsOf(aux)) {
        if (t !== rec.team && !rec.previousTeams.includes(t)) rec.previousTeams.push(t)
      }
      // Older-season sold team also belongs to history, not previousTeams dup.
      if (aux.team && aux.seasonScope === 2022 && rec.team && aux.team !== rec.team && !rec.previousTeams.includes(aux.team)) {
        rec.previousTeams.push(aux.team)
      }

      // Capped status / associate (first-known wins).
      if (aux.cua) {
        const capped = aux.cua === "Capped" ? true : aux.cua === "Uncapped" ? false : null
        const assoc = aux.cua === "Associate" ? true : false
        if (rec.isCapped === null && capped !== null) rec.isCapped = capped
        else if (capped !== null && rec.isCapped !== null && capped !== rec.isCapped) {
          merge.countryConflicts.push({ dataset: spec.key, slug: targetId, name: rec.name, cappedKept: rec.isCapped, cappedRejected: capped, note: "capped-status conflict" })
        }
        if (rec.isAssociate === null) rec.isAssociate = assoc
      }

      // Styles / DOB / age (fill nulls only).
      if (!rec.battingStyle && aux.battingStyle) rec.battingStyle = styleNorm("bat", aux.battingStyle)
      if (!rec.bowlingStyle && aux.bowlingStyle) rec.bowlingStyle = styleNorm("bowl", aux.bowlingStyle)
      if (!rec.dateOfBirth && aux.dob) rec.dateOfBirth = aux.dob
      if ((rec.age === null || rec.age === undefined) && aux.age !== null) rec.age = aux.age
      for (const c of ["test", "odi", "t20i", "ipl"]) {
        if ((rec.caps[c] === null || rec.caps[c] === undefined) && aux.caps[c] !== null) rec.caps[c] = aux.caps[c]
      }

      // Base price: latest season reserve wins (2023 applied before 2022
      // in priority order, so first-known-wins == latest-wins).
      if (aux.reserveCr !== null && rec.auction.basePrice === null) {
        rec.auction.basePrice = aux.reserveCr
        rec.auction.basePriceDisplay = aux.reserveDisplay
      }

      // Auction sets (union per season).
      if (aux.set && aux.seasonScope && !rec.auction.auctionSets.some((s) => s.season === aux.seasonScope && s.set === aux.set)) {
        rec.auction.auctionSets.push({ season: aux.seasonScope, set: aux.set })
      }

      // Auction history (dedupe by season+status+team; price variance → conflict, priority wins).
      if (aux.status && aux.seasonScope) {
        const entry = {
          season: aux.seasonScope, team: aux.team, priceCr: aux.soldCr,
          priceDisplay: aux.soldDisplay, status: aux.status, source: spec.key,
        }
        const dup = rec.auction.auctionHistory.find(
          (e) => e.season === entry.season && e.status === entry.status && (e.team || null) === (entry.team || null)
        )
        if (!dup) rec.auction.auctionHistory.push(entry)
        else if ((dup.priceCr ?? null) !== (entry.priceCr ?? null)) {
          merge.priceConflicts.push({
            dataset: spec.key, slug: targetId, name: rec.name, season: entry.season,
            kept: { priceCr: dup.priceCr, source: dup.source }, rejected: { priceCr: entry.priceCr, source: entry.source },
          })
        }
      }
    }
  }

  // Sort histories/sets/sources deterministically.
  const players = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const p of players) {
    p.auction.auctionHistory.sort((x, y) => x.season - y.season || String(x.source).localeCompare(String(y.source)))
    p.auction.auctionSets.sort((x, y) => x.season - y.season || String(x.set).localeCompare(String(y.set)))
    p.previousTeams.sort()
    p.source.datasets.sort((x, y) => String(x.key).localeCompare(String(y.key)) || x.row - y.row)
  }

  // -------------------------------------------------------------------------
  // Safety checklist (gate the write)
  // -------------------------------------------------------------------------
  const failures = []
  const ids = players.map((p) => p.id)
  if (new Set(ids).size !== ids.length) failures.push("duplicate canonical ids")
  if (players.some((p) => !p.name)) failures.push("missing names")
  const validRoles = new Set(["BATTER", "BOWLER", "ALL_ROUNDER", "WICKET_KEEPER"])
  const badRoles = players.filter((p) => !validRoles.has(p.role))
  if (badRoles.length) failures.push(`invalid roles: ${badRoles.map((p) => p.id).join(",")}`)
  for (const [id, snap] of baseStatsSnapshot) {
    const cur = byId.get(id)
    const now = JSON.stringify({ ipl: cur.ipl, t20i: { batting: cur.t20i.batting, bowling: cur.t20i.bowling } })
    if (now !== snap) failures.push(`stats overwritten for ${id}`)
  }
  if (!players.every((p) => p.source.datasets.length > 0)) failures.push("missing provenance")
  // No random ids: every id must be a slug of its own name or an allowlist key.
  for (const p of players) {
    if (p.id !== slugify(p.name) && !Object.prototype.hasOwnProperty.call(REVIEWED_ALLOWLIST, p.id)) {
      failures.push(`non-deterministic id ${p.id}`)
      break
    }
  }

  const withHistory = players.filter((p) => p.auction.auctionHistory.length > 0).length
  const missingStats = players.filter((p) =>
    Object.values(p.ipl.batting).every((v) => v === null) && Object.values(p.ipl.bowling).every((v) => v === null)
  ).length
  const wkCount = players.filter((p) => p.role === "WICKET_KEEPER").length

  const report = {
    meta: { generatedBy: "scripts/buildPlayerDatabase.js", schemaVersion: 2 },
    baseCount: base.length,
    finalCount: players.length,
    exactMerges: merge.exactMerges,
    allowlistMerges: merge.allowlistMerges,
    allowlistUsed: [...merge.allowlistUsed].sort(),
    ambiguousExcluded: merge.ambiguousExcluded,
    ambiguousSamples: merge.ambiguousSamples,
    newPlayersAdded: merge.newPlayers,
    duplicatesResolved: merge.duplicatesResolved,
    roleConflicts: merge.roleConflicts,
    countryConflicts: merge.countryConflicts,
    teamConflicts: merge.teamConflicts,
    teamUpdates: merge.teamUpdates,
    priceConflicts: merge.priceConflicts,
    wicketKeepers: wkCount,
    wkUpgradedFromBase: [...new Set(merge.wkUpgraded)].sort(),
    missingStats,
    withAuctionHistory: withHistory,
    baseIssues: issues.slice(0, 20),
  }

  if (failures.length) {
    console.error("BUILD FAILED:\n- " + failures.join("\n- "))
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    meta: {
      generatedBy: "scripts/buildPlayerDatabase.js",
      datasets: [BASE.key, ...AUX_SPECS.map((s) => s.key)],
      recordCount: players.length,
      schemaVersion: 2,
    },
    players,
  }, null, 2) + "\n")
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n")

  console.log("=== Master Merge Report ===")
  console.log(`Base players      : ${report.baseCount}`)
  console.log(`Final players     : ${report.finalCount}`)
  console.log(`Exact merges      : ${report.exactMerges}`)
  console.log(`Allowlist merges  : ${report.allowlistMerges} (${report.allowlistUsed.length} keys)`)
  console.log(`Ambiguous excluded: ${report.ambiguousExcluded}`)
  console.log(`New players added : ${report.newPlayersAdded}`)
  console.log(`Duplicates resolved: ${report.duplicatesResolved}`)
  console.log(`Role conflicts    : ${report.roleConflicts.length}`)
  console.log(`Country conflicts : ${report.countryConflicts.length}`)
  console.log(`Team conflicts    : ${report.teamConflicts.length}`)
  console.log(`Team updates (chronological): ${report.teamUpdates.length}`)
  console.log(`Price conflicts   : ${report.priceConflicts.length}`)
  console.log(`Wicket keepers    : ${report.wicketKeepers}`)
  console.log(`Missing-stats recs: ${report.missingStats}`)
  console.log(`With history      : ${report.withAuctionHistory}`)
  console.log("Wrote: src/data/players/processed/master_players.json + merge_report.json")
  console.log("BUILD OK")
}

main()
