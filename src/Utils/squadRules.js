/**
 * Team Strategy & Squad Validation Engine (Phase 3)
 *
 * Centralized, UI-free business logic. Pure functions only — safe to import
 * from both the Socket.IO server (server/auctionEngine.js) and the React
 * client (reducers/auctionReducer.js, Pages/AuctionRoom.jsx).
 *
 * Reuses existing domain helpers from ./auctionRules.js (getNextBid,
 * roundCurrency) — no duplicated bid math.
 */

import { getNextBid, roundCurrency } from "./auctionRules.js"
import { TEAM_CODES } from "../data/teams.js"

/**
 * Centralized squad configuration.
 *
 * Limits mirror real IPL rules. MIN_SQUAD_SIZE is an end-state completeness
 * target used by needs/evaluation — it NEVER blocks a bid (a 47-player pool
 * shared by up to 10 teams cannot fill every squad to 18). MAX_SQUAD_SIZE and
 * MAX_OVERSEAS_PER_SQUAD are enforced at bid time.
 */
export const SQUAD_RULES = {
  MIN_SQUAD_SIZE: 18,
  MAX_SQUAD_SIZE: 25,
  MAX_OVERSEAS_PER_SQUAD: 8,
  // Transparent role targets used ONLY for needs analysis (never bid gates).
  ROLE_TARGETS: {
    BATTER: 5,
    BOWLER: 5,
    ALL_ROUNDER: 4,
    WICKET_KEEPER: 2,
  },
}

export const VALIDATION_CODES = {
  ALLOWED: "ALLOWED",
  BIDDING_CLOSED: "BIDDING_CLOSED",
  INVALID_TEAM: "INVALID_TEAM",
  INVALID_PLAYER: "INVALID_PLAYER",
  DUPLICATE_PLAYER: "DUPLICATE_PLAYER",
  SQUAD_FULL: "SQUAD_FULL",
  OVERSEAS_LIMIT: "OVERSEAS_LIMIT",
  INSUFFICIENT_PURSE: "INSUFFICIENT_PURSE",
}

const KNOWN_ROLES = ["BATTER", "BOWLER", "ALL_ROUNDER", "WICKET_KEEPER"]

const isOverseasPlayer = (player) => player?.isOverseas === true

/**
 * Summarize one team's squad from actual squad/player data.
 * @param {Array} squad - teamSquads[teamCode] entries ({...player, soldPrice})
 * @param {number} purse - teamPurses[teamCode]
 */
export const getSquadSummary = (squad = [], purse = 0) => {
  const roles = { BATTER: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 }
  let overseas = 0

  for (const p of squad) {
    if (p?.role && roles[p.role] !== undefined) roles[p.role] += 1
    if (isOverseasPlayer(p)) overseas += 1
  }

  const total = squad.length
  return {
    total,
    indian: total - overseas,
    overseas,
    batters: roles.BATTER,
    bowlers: roles.BOWLER,
    allRounders: roles.ALL_ROUNDER,
    wicketkeepers: roles.WICKET_KEEPER,
    roles,
    remainingPurse: Number(purse) || 0,
    slotsLeft: Math.max(0, SQUAD_RULES.MAX_SQUAD_SIZE - total),
    overseasSlotsLeft: Math.max(0, SQUAD_RULES.MAX_OVERSEAS_PER_SQUAD - overseas),
    isFull: total >= SQUAD_RULES.MAX_SQUAD_SIZE,
    isComplete: total >= SQUAD_RULES.MIN_SQUAD_SIZE,
  }
};

/**
 * Summaries for every known franchise.
 */
export const getAllTeamSummaries = (teamSquads = {}, teamPurses = {}) => {
  const out = {}
  for (const code of TEAM_CODES) {
    out[code] = getSquadSummary(teamSquads[code] || [], teamPurses[code] || 0)
  }
  return out
};

/**
 * Structured bid validation. Returns { allowed, reason, message, nextBid }.
 * Never throws on bad input — returns INVALID_* instead.
 */
export const validateBid = ({
  teamCode,
  player,
  currentBid = 0,
  hasBid = false,
  teamSquads = {},
  teamPurses = {},
} = {}) => {
  if (!teamCode || !TEAM_CODES.includes(teamCode)) {
    return {
      allowed: false,
      reason: VALIDATION_CODES.INVALID_TEAM,
      message: `Unknown team "${teamCode || "—"}"`,
      nextBid: null,
    }
  }
  if (!player || typeof player !== "object" || !player.id) {
    return {
      allowed: false,
      reason: VALIDATION_CODES.INVALID_PLAYER,
      message: "Invalid player data for this bid",
      nextBid: null,
    }
  }

  const squad = teamSquads[teamCode] || []
  const purse = Number(teamPurses[teamCode]) || 0
  const nextBid = hasBid ? getNextBid(currentBid) : roundCurrency(currentBid)

  if (squad.some((p) => p?.id === player.id)) {
    return {
      allowed: false,
      reason: VALIDATION_CODES.DUPLICATE_PLAYER,
      message: `${player.name || player.id} is already in the ${teamCode} squad`,
      nextBid,
    }
  }

  if (squad.length >= SQUAD_RULES.MAX_SQUAD_SIZE) {
    return {
      allowed: false,
      reason: VALIDATION_CODES.SQUAD_FULL,
      message: `${teamCode} squad is full (${SQUAD_RULES.MAX_SQUAD_SIZE} players)`,
      nextBid,
    }
  }

  if (
    isOverseasPlayer(player) &&
    squad.filter(isOverseasPlayer).length >= SQUAD_RULES.MAX_OVERSEAS_PER_SQUAD
  ) {
    return {
      allowed: false,
      reason: VALIDATION_CODES.OVERSEAS_LIMIT,
      message: `${teamCode} already has ${SQUAD_RULES.MAX_OVERSEAS_PER_SQUAD} overseas players`,
      nextBid,
    }
  }

  if (nextBid > purse) {
    return {
      allowed: false,
      reason: VALIDATION_CODES.INSUFFICIENT_PURSE,
      message: `Team does not have enough purse for the next bid (needs ₹ ${nextBid} Cr, has ₹ ${purse} Cr)`,
      nextBid,
    }
  }

  return { allowed: true, reason: VALIDATION_CODES.ALLOWED, message: "Bid allowed", nextBid }
};

/**
 * Transparent, rule-based team needs from a squad summary.
 * One entry per role deficit + overseas + overall fill; sorted HIGH → LOW.
 * Returns [] when the squad meets every target.
 */
export const getTeamNeeds = (summary) => {
  if (!summary) return []
  const needs = []

  for (const role of KNOWN_ROLES) {
    const target = SQUAD_RULES.ROLE_TARGETS[role] || 0
    const current = summary.roles?.[role] ?? 0
    const deficit = target - current
    if (deficit <= 0) continue
    needs.push({
      role,
      priority: deficit >= 3 || (role === "WICKET_KEEPER" && current === 0) ? "HIGH" : "MEDIUM",
      count: deficit,
    })
  }

  const overseasDeficit =
    Math.min(SQUAD_RULES.MAX_OVERSEAS_PER_SQUAD, SQUAD_RULES.ROLE_TARGETS.BATTER) -
    summary.overseas
  if (overseasDeficit > 0 && summary.overseas < 4) {
    needs.push({ role: "OVERSEAS", priority: summary.overseas === 0 ? "HIGH" : "LOW", count: overseasDeficit })
  }

  const fillDeficit = SQUAD_RULES.MIN_SQUAD_SIZE - summary.total
  if (fillDeficit > 0) {
    needs.push({
      role: "SQUAD_FILL",
      priority: fillDeficit > 10 ? "HIGH" : "MEDIUM",
      count: fillDeficit,
    })
  }

  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  return needs.sort((a, b) => rank[a.priority] - rank[b.priority] || b.count - a.count)
};

/**
 * Before/after purchase preview (data layer for future UI).
 */
export const previewPurchase = ({
  teamCode,
  player,
  currentBid = 0,
  hasBid = false,
  teamSquads = {},
  teamPurses = {},
} = {}) => {
  const before = getSquadSummary(teamSquads[teamCode] || [], teamPurses[teamCode] || 0)
  const validation = validateBid({ teamCode, player, currentBid, hasBid, teamSquads, teamPurses })
  if (!validation.allowed) {
    return { allowed: false, reason: validation.reason, message: validation.message, before, after: before, price: validation.nextBid }
  }

  const price = validation.nextBid
  const after = getSquadSummary(
    [...(teamSquads[teamCode] || []), { ...player, soldPrice: price }],
    roundCurrency(Math.max(0, before.remainingPurse - price))
  )
  return { allowed: true, reason: VALIDATION_CODES.ALLOWED, message: "Purchase preview", before, after, price }
};

/**
 * Structured SOLD analytics payload (extends, never replaces, the snapshot).
 */
export const buildSoldEvent = ({ player, team, finalPrice, timestamp }) => ({
  playerId: player?.id || null,
  playerName: player?.name || null,
  team: team || null,
  finalPrice: roundCurrency(Number(finalPrice) || 0),
  role: player?.role || null,
  isOverseas: isOverseasPlayer(player),
  basePrice: player?.basePrice ?? null,
  timestamp: timestamp || new Date().toLocaleTimeString(),
});
