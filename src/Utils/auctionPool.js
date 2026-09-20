/**
 * Auction Pool Adapter + Selector (MASTER → AUCTION integration phase).
 *
 * Layers:  master player (canonical, 1317) → toAuctionPlayer() →
 *          auction player object (legacy engine shape) → auction engine.
 *
 * JSON-free by design: functions take master arrays as arguments so the
 * 3.9MB master_players.json is loaded ONLY server-side (roomManager).
 * The browser never bundles it — clients receive the selected pool
 * through the existing auction-state sync.
 *
 * Auction-object shape (matches src/data/players.js legacy rows; extra
 * provenance fields are ignored by the engine):
 *   id, name, image, country, role, basePrice, matches, runs, strikeRate,
 *   wickets, economy, battingStyle, bowlingStyle, age, previousTeam,
 *   isOverseas, isCapped, category
 */

import { PLAYERS as LEGACY_PLAYERS } from "../data/players.js"

// ---------------------------------------------------------------------------
// Base price: master reserve where reliable, else explicit documented fallback.
// SOLD_PRICE is NEVER used as a base price. Fallback is deliberately coarse
// (capped 2.0 / uncapped-or-unknown 0.3, mirroring the legacy pool's own
// extremes) and always labelled via `basePriceSource`.
// ---------------------------------------------------------------------------
export const BASE_PRICE_FALLBACK = { capped: 2.0, default: 0.3 }

export const resolveBasePrice = (master = {}) => {
  const reserve = Number(master?.auction?.basePrice)
  if (Number.isFinite(reserve) && reserve > 0) {
    return { basePrice: reserve, basePriceSource: "reserve" }
  }
  if (master?.isCapped === true) {
    return { basePrice: BASE_PRICE_FALLBACK.capped, basePriceSource: "fallback-capped" }
  }
  return { basePrice: BASE_PRICE_FALLBACK.default, basePriceSource: "fallback" }
}

// ---------------------------------------------------------------------------
// Categories. Primary `category` mirrors the legacy pool's single-category
// convention; `groups` carries every selection group a player qualifies for
// (a player is never duplicated — one record, many groups).
// MARQUEE membership comes from auction set "M" membership (source evidence),
// never from reputation. UNCAPPED comes from isCapped === false.
// ---------------------------------------------------------------------------
export const AUCTION_CATEGORIES = [
  "MARQUEE", "BATTER", "BOWLER", "ALL_ROUNDER",
  "WICKET_KEEPER", "OVERSEAS", "UNCAPPED",
]

const MARQUEE_SETS = new Set(["M"])

export const isMarquee = (master = {}) =>
  (master?.auction?.auctionSets || []).some((s) => MARQUEE_SETS.has(s.set))

export const getPlayerGroups = (master = {}) => {
  const groups = []
  if (isMarquee(master)) groups.push("MARQUEE")
  if (master?.role) groups.push(master.role)
  if (master?.isOverseas === true) groups.push("OVERSEAS")
  if (master?.isCapped === false) groups.push("UNCAPPED")
  return groups
}

export const getPrimaryCategory = (master = {}) => {
  if (isMarquee(master)) return "MARQUEE"
  if (master?.isCapped === false) return "UNCAPPED"
  return master?.role || "BATTER"
}

// ---------------------------------------------------------------------------
// Master → auction object. Statistics pass through VERBATIM: null stays null
// (unavailable) and is never coerced to 0 — null means "no data", 0 means
// a real recorded zero. Downstream guards: safeNum() in playerValueEngine,
// purse/role checks in squadRules, blank-tolerant UI tiles.
// ---------------------------------------------------------------------------
export const toAuctionPlayer = (master = {}) => {
  const { basePrice, basePriceSource } = resolveBasePrice(master)
  return {
    id: master?.id || null,
    name: master?.name || "Unknown Player",
    image: null, // no image harvesting in this phase (see playerImage())
    country: master?.country || null,
    role: master?.role || "BATTER",
    basePrice,
    basePriceSource,
    matches: master?.ipl?.batting?.matches ?? null,
    runs: master?.ipl?.batting?.runs ?? null,
    strikeRate: master?.ipl?.batting?.strikeRate ?? null,
    wickets: master?.ipl?.bowling?.wickets ?? null,
    economy: master?.ipl?.bowling?.economy ?? null,
    battingStyle: master?.battingStyle || null,
    bowlingStyle: master?.bowlingStyle || null,
    age: master?.age ?? null,
    previousTeam: master?.team || null,
    isOverseas: master?.isOverseas ?? null,
    isCapped: master?.isCapped ?? null,
    category: getPrimaryCategory(master),
    groups: getPlayerGroups(master),
    masterSets: (master?.auction?.auctionSets || []).map((s) => s.set),
  }
}

// ---------------------------------------------------------------------------
// Image fallback (no downloads in this phase). Legacy rows carry hotlinked
// headshots; master-derived players get a deterministic initials SVG so
// reveal cards never render a broken <img>.
// ---------------------------------------------------------------------------
const ROLE_COLORS = {
  BATTER: "#3b82f6", BOWLER: "#ef4444",
  ALL_ROUNDER: "#a855f7", WICKET_KEEPER: "#22c55e",
}

export const playerImage = (player = {}) => {
  if (player?.image) return player.image
  const initials = String(player?.name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
  const color = ROLE_COLORS[player?.role] || "#64748b"
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='260'><rect width='220' height='260' fill='#0f172a'/><circle cx='110' cy='100' r='46' fill='${color}' opacity='0.35'/><text x='110' y='116' font-family='Arial' font-size='40' font-weight='bold' fill='#f8fafc' text-anchor='middle'>${initials}</text><text x='110' y='200' font-family='Arial' font-size='16' fill='#94a3b8' text-anchor='middle'>${player?.role || ""}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------------------------
// Pool selection. Deterministic: category order MARQUEE → role order, then
// id. Duplicate protection by canonical id (never by display name).
// ---------------------------------------------------------------------------
export const CATEGORY_ORDER = ["MARQUEE", "BATTER", "WICKET_KEEPER", "ALL_ROUNDER", "BOWLER", "UNCAPPED"]

export const POOL_PRESETS = {
  mega: { limit: 120, categories: null, sets: null, onlyWithStats: false },
  mini: { limit: 30, categories: null, sets: null, onlyWithStats: false },
}

const hasAnyStats = (auctionPlayer) =>
  auctionPlayer.matches !== null || auctionPlayer.runs !== null ||
  auctionPlayer.wickets !== null || auctionPlayer.economy !== null

export const selectPool = (masterPlayers = [], options = {}) => {
  const {
    categories = null, sets = null, limit = null,
    onlyWithStats = false, excludeIds = [],
  } = options
  const excluded = new Set(excludeIds)
  const seen = new Map() // id → auction player (duplicate protection)

  for (const master of masterPlayers) {
    if (!master?.id || seen.has(master.id) || excluded.has(master.id)) continue
    const ap = toAuctionPlayer(master)
    if (categories && categories.length && !categories.some((c) => ap.category === c || ap.groups.includes(c))) continue
    if (sets && sets.length && !sets.some((s) => ap.masterSets.includes(s))) continue
    if (onlyWithStats && !hasAnyStats(ap)) continue
    seen.set(ap.id, ap)
  }

  const rank = (p) => {
    const i = CATEGORY_ORDER.indexOf(p.category)
    return i === -1 ? CATEGORY_ORDER.length : i
  }
  const pool = [...seen.values()].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))
  return typeof limit === "number" && limit >= 0 ? pool.slice(0, limit) : pool
}

/** Build a pool from a mode preset (+ overrides). Mega/Mini share this path. */
export const buildPoolForMode = (masterPlayers = [], mode = "mega", overrides = {}) => {
  const preset = POOL_PRESETS[mode] || POOL_PRESETS.mega
  return selectPool(masterPlayers, { ...preset, ...overrides })
}

/** Structural validation for tests and room creation. */
export const validatePool = (pool = []) => {
  const ids = pool.map((p) => p?.id)
  return {
    size: pool.length,
    duplicates: ids.filter((id, i) => ids.indexOf(id) !== i),
    missingId: pool.filter((p) => !p?.id).length,
    missingBasePrice: pool.filter((p) => !(Number(p?.basePrice) > 0)).length,
    nullStats: pool.filter((p) => !hasAnyStats(p)).length,
    ok: pool.length > 0 && new Set(ids).size === ids.length && pool.every((p) => p?.id && Number(p?.basePrice) > 0),
  }
}

export { LEGACY_PLAYERS }
