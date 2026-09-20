/**
 * Auction Results Analyzer V1
 *
 * Higher-level pure analysis utility that aggregates completed or in-progress auction data,
 * executes Team Evaluation Engine V1 and Team Comparison Engine V1, and produces
 * auction-wide spending, purchase value, and role coverage insights.
 *
 * Design Principles:
 * 1. Pure & Deterministic: Same input state = identical analysis output. No side effects.
 * 2. Incomplete-Data Safe: Safely handles empty auctions, missing prices, or 0 teams without throwing errors.
 * 3. Neutral Value Terms: High-cost buys are labelled neutrally as "high-cost relative to model value".
 * 4. Modular Reuse: Leverages evaluateTeam and compareTeams without code duplication.
 */

import { roundCurrency } from "./auctionRules.js"
import { SQUAD_RULES } from "./squadRules.js"
import { TEAM_MAP } from "../data/teams.js"
import { evaluateTeam } from "./teamEvaluationEngine.js"
import { compareTeams } from "./teamComparisonEngine.js"
import { isVal, num, round2 } from "./playerValueEngine.js"

// ---------------------------------------------------------------------------
// Purchase classification thresholds (owned by Team Evaluation Engine V1 —
// repeated here for transparency; this module aggregates, never reclassifies):
//   valuable  = fairPrice / soldPrice ratio >= 1.1
//   expensive = ratio <= 0.67 AND soldPrice >= 4.0 Cr ("high-cost relative to
//               model value" — neutral wording, never "bad")
// Null/zero fairPrice or price is skipped safely, never coerced to zero.
// ---------------------------------------------------------------------------

/** Deduplicate unsold entries by canonical player id (fallback: name). */
export const dedupeUnsoldPlayers = (unsoldPlayers = []) => {
  const list = Array.isArray(unsoldPlayers) ? unsoldPlayers : []
  const seen = new Map()
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const p = entry.player || entry
    const key = p.id || entry.playerId || p.name || entry.name
    if (!key || seen.has(key)) continue
    seen.set(key, entry)
  }
  return [...seen.values()]
}

export const analyzeAuctionResults = (auctionData = {}, options = {}) => {
  const {
    teamSquads = {},
    teamPurses = {},
    initialBudget = 120.0,
    auctionHistory = null,
    unsoldPlayers = [],
    teamEvaluations: inputEvaluations = null,
  } = auctionData

  // 1. Resolve or compute single-team evaluations
  const teamEvaluations = {}
  const activeTeamCodes = Object.keys(teamSquads).length > 0
    ? Object.keys(teamSquads)
    : Object.keys(teamPurses).length > 0
    ? Object.keys(teamPurses)
    : Object.keys(TEAM_MAP)

  for (const code of activeTeamCodes) {
    if (inputEvaluations && inputEvaluations[code]) {
      teamEvaluations[code] = inputEvaluations[code]
    } else {
      const squad = teamSquads[code] || []
      const purse = num(teamPurses[code]) ?? (initialBudget - squad.reduce((acc, p) => acc + (num(p.soldPrice) || 0), 0))
      teamEvaluations[code] = evaluateTeam({
        teamCode: code,
        teamName: TEAM_MAP[code]?.name || code,
        squad,
        purse,
        initialPurse: initialBudget,
      })
    }
  }

  const evalList = Object.values(teamEvaluations)
  const totalSquadPlayers = evalList.reduce((sum, e) => sum + (e.squadSize || 0), 0)

  const dedupedUnsold = dedupeUnsoldPlayers(unsoldPlayers)

  if (evalList.length === 0 || totalSquadPlayers === 0) {
    return {
      status: "INSUFFICIENT_DATA",
      message: "No completed squad or auction purchase data available for analysis",
      summary: {
        totalPlayersSold: 0,
        totalPlayersAuctioned: dedupedUnsold.length,
        totalSpent: 0,
        averagePrice: 0,
        highestPurchase: null,
        lowestPurchase: null,
        unsoldPlayerCount: dedupedUnsold.length,
        perTeamPurchases: [],
      },
      teamEvaluations: {},
      comparison: compareTeams([]),
      spending: {
        teamPurses: {},
        highestSpender: null,
        lowestSpender: null,
        largestRemainingPurse: null,
      },
      purchases: {
        valuablePurchases: [],
        expensivePurchases: [],
      },
      roleCoverage: [],
      unsold: dedupedUnsold,
      highestScoringTeam: null,
      tieStatus: { isTie: false, tiedTeams: [] },
    }
  }

  // 2. Run Team Comparison Engine V1
  const comparison = compareTeams(teamEvaluations, options)

  // 3. Purchase & Price Aggregations
  const allPurchases = []
  let totalSpent = 0

  for (const e of evalList) {
    const rawSquad = teamSquads[e.teamCode] || e.squad || []
    for (const item of rawSquad) {
      const p = item.player || item
      const price = num(item.soldPrice ?? item.finalPrice ?? item.auctionValue?.historicalPrice ?? p.soldPrice)
      if (isVal(price) && price > 0) {
        totalSpent += price
        allPurchases.push({
          playerId: p.id || item.playerId || "unknown",
          playerName: p.name || item.name || "Unknown Player",
          teamCode: e.teamCode,
          teamName: e.teamName,
          price: roundCurrency(price),
        })
      }
    }
  }

  totalSpent = roundCurrency(totalSpent)
  const totalPlayersSold = allPurchases.length
  const averagePrice = totalPlayersSold > 0 ? round2(totalSpent / totalPlayersSold) : 0

  const sortedPurchases = [...allPurchases].sort((a, b) => b.price - a.price)
  const highestPurchase = sortedPurchases.length > 0 ? sortedPurchases[0] : null
  const lowestPurchase = sortedPurchases.length > 0 ? sortedPurchases[sortedPurchases.length - 1] : null

  // 4. Aggregated Model-Derived Value Buys & High-Cost Buys.
  // Classification is owned by Team Evaluation Engine V1 (thresholds above);
  // here each entry is enriched with the V2 valueForMoney score looked up
  // from the team's own squad evaluations (null when unavailable).
  const squadEvalIndex = new Map()
  for (const e of evalList) {
    for (const s of e.squad || []) {
      if (s.playerId) squadEvalIndex.set(`${e.teamCode}||${s.playerId}`, s)
    }
  }
  const enrichPurchase = (entry, teamCode, teamName) => {
    const hit = squadEvalIndex.get(`${teamCode}||${entry.playerId}`)
    return {
      teamCode,
      teamName,
      playerId: entry.playerId,
      playerName: entry.name,
      purchasePrice: entry.soldPrice,
      fairPrice: entry.fairPrice ?? null,
      valueForMoney: hit?.valueForMoney ?? null,
      ratio: entry.efficiency ?? null,
    }
  }

  const valuablePurchases = []
  const expensivePurchases = []

  for (const e of evalList) {
    for (const v of e.valuablePurchases || []) {
      valuablePurchases.push(enrichPurchase(v, e.teamCode, e.teamName))
    }
    for (const ex of e.expensivePurchases || []) {
      expensivePurchases.push(enrichPurchase(ex, e.teamCode, e.teamName))
    }
  }

  valuablePurchases.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
  expensivePurchases.sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0))

  // 5. Spending & Purse Analysis Across Franchises.
  // purseBalanced verifies spent + remaining ≈ initialPurse (0.02 tolerance
  // for two-decimal rounding) rather than assuming it.
  const spendingList = evalList.map((e) => {
    const pa = e.purseAnalysis || {}
    const initial = num(pa.initialPurse)
    const spent = num(pa.spent) ?? 0
    const remaining = num(pa.remaining) ?? 0
    return {
      teamCode: e.teamCode,
      teamName: e.teamName,
      initialPurse: initial,
      spent,
      remaining,
      spendingPercentage: num(pa.spendingPercentage) ?? 0,
      purseBalanced:
        initial === null ? null : Math.abs(spent + remaining - initial) < 0.02,
    }
  })

  const sortedBySpent = [...spendingList].sort((a, b) => b.spent - a.spent)
  const sortedByRemaining = [...spendingList].sort((a, b) => b.remaining - a.remaining)

  const spending = {
    teamPurses,
    highestSpender: sortedBySpent[0] || null,
    lowestSpender: sortedBySpent[sortedBySpent.length - 1] || null,
    largestRemainingPurse: sortedByRemaining[0] || null,
    spendingList,
  }

  // 6. Role Coverage Comparison Across All Teams
  const roleCoverage = []
  for (const e of evalList) {
    for (const [role, target] of Object.entries(SQUAD_RULES.ROLE_TARGETS)) {
      const current = e.roleBreakdown.roles[role] || 0
      const gap = Math.max(0, target - current)
      roleCoverage.push({
        teamCode: e.teamCode,
        teamName: e.teamName,
        role,
        current,
        target,
        gap,
        isDeficit: gap > 0,
      })
    }
  }

  // Per-team purchase counts + deduplicated unsold fenced off from sold stats.
  const perTeamPurchases = evalList.map((e) => ({
    teamCode: e.teamCode,
    teamName: e.teamName,
    count: allPurchases.filter((p) => p.teamCode === e.teamCode).length,
  }))

  return {
    status: totalSquadPlayers >= 18 * evalList.length ? "COMPLETE" : "PARTIAL",
    summary: {
      totalPlayersSold,
      totalPlayersAuctioned: totalPlayersSold + dedupedUnsold.length,
      totalSpent,
      averagePrice,
      highestPurchase,
      lowestPurchase,
      unsoldPlayerCount: dedupedUnsold.length,
      historyCount: Array.isArray(auctionHistory) ? auctionHistory.length : 0,
      perTeamPurchases,
    },
    teamEvaluations,
    comparison,
    spending,
    purchases: {
      valuablePurchases,
      expensivePurchases,
    },
    roleCoverage,
    unsold: dedupedUnsold,
    highestScoringTeam: comparison.highestScoringTeam,
    tieStatus: comparison.tieStatus,
  }
}
