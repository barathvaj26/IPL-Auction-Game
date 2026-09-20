/**
 * Team Evaluation Engine V1
 *
 * Deterministic, explainable evaluation engine for completed IPL auction teams/squads.
 * Evaluates squad quality, batting depth, bowling strength, all-rounder capabilities,
 * squad balance, overseas distribution, wicketkeeping coverage, and auction spending efficiency.
 *
 * Design Principles:
 * 1. Pure & Deterministic: Same squad + same player data = identical result. No AI/LLM, no side effects.
 * 2. Composition Aware: Squad is more than the average of individual player scores. Imbalances hurt balance/category scores.
 * 3. Null vs Zero Preserved: null = missing data; 0 = genuine zero. Never converts null to 0.
 * 4. Transparent 100-Point Model: Exactly 100 total points distributed across 8 documented categories.
 * 5. Deterministic Strengths & Weaknesses: Every reported strength, weakness, and missing role corresponds to a calculated metric threshold.
 * 6. Neutral Auction Value Wording: Overpaid players are labelled neutrally as "high-cost relative to model value".
 */

import { roundCurrency } from "./auctionRules.js"
import { SQUAD_RULES } from "./squadRules.js"
import { TEAM_MAP } from "../data/teams.js"
import { evaluatePlayerV2, isVal, num, round1, round2, clamp100 } from "./playerValueEngine.js"

// ---------------------------------------------------------------------------
// Category Weight Constants (Sum MUST equal 100)
// ---------------------------------------------------------------------------

export const TEAM_SCORE_WEIGHTS = {
  batting: 20,
  bowling: 20,
  allRounders: 15,
  squadBalance: 15,
  playerQuality: 10,
  overseasBalance: 5,
  wicketKeeping: 5,
  auctionValue: 10,
}

// Ensure total weights sum to exactly 100
const TOTAL_WEIGHT_SUM = Object.values(TEAM_SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
if (TOTAL_WEIGHT_SUM !== 100) {
  throw new Error(`TEAM_SCORE_WEIGHTS must sum to 100, got ${TOTAL_WEIGHT_SUM}`)
}

// ---------------------------------------------------------------------------
// Squad Input Normalization Adapter
// ---------------------------------------------------------------------------

export const normalizeTeamInput = (teamInput = {}, options = {}) => {
  let teamCode = "CUSTOM"
  let teamName = "Team Squad"
  let squad = []
  let remainingPurse = 0
  let initialPurse = 120.0

  if (Array.isArray(teamInput)) {
    squad = teamInput
    teamCode = options.teamCode || "CUSTOM"
    teamName = options.teamName || TEAM_MAP[teamCode]?.name || "Team Squad"
    remainingPurse = num(options.purse ?? options.remainingPurse) ?? 0
    initialPurse = num(options.initialPurse) ?? 120.0
  } else if (teamInput && typeof teamInput === "object") {
    teamCode = teamInput.teamCode || teamInput.code || options.teamCode || "CUSTOM"
    teamName = teamInput.teamName || teamInput.name || TEAM_MAP[teamCode]?.name || "Team Squad"
    squad = Array.isArray(teamInput.squad)
      ? teamInput.squad
      : Array.isArray(teamInput.players)
      ? teamInput.players
      : []
    remainingPurse = num(teamInput.purse ?? teamInput.remainingPurse ?? options.purse) ?? 0
    initialPurse = num(teamInput.initialPurse ?? options.initialPurse) ?? 120.0
  }

  const hasExplicitPurse = Array.isArray(teamInput)
    ? isVal(options.purse) || isVal(options.remainingPurse)
    : isVal(teamInput?.purse) || isVal(teamInput?.remainingPurse) || isVal(options.purse)

  const hasExplicitInitialPurse = Array.isArray(teamInput)
    ? isVal(options.initialPurse)
    : isVal(teamInput?.initialPurse) || isVal(options.initialPurse)

  return {
    teamCode,
    teamName,
    squad,
    remainingPurse,
    initialPurse,
    hasExplicitPurse,
    hasExplicitInitialPurse,
  }
}

// ---------------------------------------------------------------------------
// Category Evaluators
// ---------------------------------------------------------------------------

/**
 * Batting Category Evaluation (/20 points)
 */
export const evaluateTeamBatting = (squadEvals = []) => {
  const battingContributors = squadEvals
    .map((e) => ({
      player: e.player,
      score: e.batting.score,
      confidence: e.batting.confidence,
      role: e.role,
    }))
    .filter((c) => c.score !== null)
    .sort((a, b) => b.score - a.score)

  if (battingContributors.length === 0) {
    return { score: 0, rawRating: 0, topBatters: [], depthCount: 0 }
  }

  // Top 5 batters quality
  const top5 = battingContributors.slice(0, 5)
  const quality = top5.reduce((sum, c) => sum + c.score, 0) / top5.length

  // Batting depth score (target: 6-7 batting options)
  const battingOptionsCount = battingContributors.filter((c) => c.score >= 35).length
  const depthRating = clamp100((battingOptionsCount / 6) * 100)

  const rawRating = quality * 0.6 + depthRating * 0.4
  const weightedScore = round1((rawRating / 100) * TEAM_SCORE_WEIGHTS.batting)

  return {
    score: weightedScore,
    rawRating: round1(rawRating),
    quality: round1(quality),
    depthRating: round1(depthRating),
    depthCount: battingOptionsCount,
    topBatters: top5.map((c) => ({ id: c.player.id, name: c.player.name, score: c.score })),
  }
}

/**
 * Bowling Category Evaluation (/20 points)
 */
export const evaluateTeamBowling = (squadEvals = []) => {
  const bowlingContributors = squadEvals
    .map((e) => ({
      player: e.player,
      score: e.bowling.score,
      confidence: e.bowling.confidence,
      role: e.role,
    }))
    .filter((c) => c.score !== null && c.confidence > 0)
    .sort((a, b) => b.score - a.score)

  if (bowlingContributors.length === 0) {
    return { score: 0, rawRating: 0, topBowlers: [], depthCount: 0 }
  }

  // Top 5 bowlers quality
  const top5 = bowlingContributors.slice(0, 5)
  const quality = top5.reduce((sum, c) => sum + c.score, 0) / top5.length

  // Bowling depth score (target: 5-6 bowling options)
  const bowlingOptionsCount = bowlingContributors.filter((c) => c.score >= 35).length
  const depthRating = clamp100((bowlingOptionsCount / 5) * 100)

  const rawRating = quality * 0.6 + depthRating * 0.4
  const weightedScore = round1((rawRating / 100) * TEAM_SCORE_WEIGHTS.bowling)

  return {
    score: weightedScore,
    rawRating: round1(rawRating),
    quality: round1(quality),
    depthRating: round1(depthRating),
    depthCount: bowlingOptionsCount,
    topBowlers: top5.map((c) => ({ id: c.player.id, name: c.player.name, score: c.score })),
  }
}

/**
 * All-Rounder Category Evaluation (/15 points)
 */
export const evaluateTeamAllRounders = (squadEvals = []) => {
  const arContributors = squadEvals
    .map((e) => ({
      player: e.player,
      score: e.allRounder.score,
      confidence: e.allRounder.confidence,
      role: e.role,
      hasBoth: e.batting.score >= 30 && e.bowling.score >= 30,
    }))
    .filter((c) => c.score !== null)
    .sort((a, b) => b.score - a.score)

  if (arContributors.length === 0) {
    return { score: 0, rawRating: 0, count: 0 }
  }

  const top3 = arContributors.slice(0, 3)
  const quality = top3.reduce((sum, c) => sum + c.score, 0) / top3.length

  const genuineARCount = arContributors.filter((c) => c.hasBoth || c.role === "ALL_ROUNDER").length
  const countRating = clamp100((genuineARCount / SQUAD_RULES.ROLE_TARGETS.ALL_ROUNDER) * 100)

  const rawRating = quality * 0.6 + countRating * 0.4
  const weightedScore = round1((rawRating / 100) * TEAM_SCORE_WEIGHTS.allRounders)

  return {
    score: weightedScore,
    rawRating: round1(rawRating),
    quality: round1(quality),
    count: genuineARCount,
    topAllRounders: top3.map((c) => ({ id: c.player.id, name: c.player.name, score: c.score })),
  }
}

/**
 * Squad Balance Category Evaluation (/15 points)
 */
export const evaluateSquadBalance = (roleCounts = {}, totalPlayers = 0, overseasCount = 0) => {
  // 1. Role Coverage Rating
  let roleDeficits = 0
  for (const [role, target] of Object.entries(SQUAD_RULES.ROLE_TARGETS)) {
    const current = roleCounts[role] || 0
    if (current < target) {
      roleDeficits += (target - current)
    }
  }
  const roleCoverageRating = clamp100(100 - roleDeficits * 15)

  // 2. Squad Size Rating (Target: MIN_SQUAD_SIZE 18 to MAX_SQUAD_SIZE 25)
  let sizeRating = 100
  if (totalPlayers < SQUAD_RULES.MIN_SQUAD_SIZE) {
    sizeRating = clamp100((totalPlayers / SQUAD_RULES.MIN_SQUAD_SIZE) * 100)
  } else if (totalPlayers > SQUAD_RULES.MAX_SQUAD_SIZE) {
    sizeRating = clamp100(100 - (totalPlayers - SQUAD_RULES.MAX_SQUAD_SIZE) * 20)
  }

  // 3. Imbalance Penalties (e.g. <3 batters or <3 bowlers or >60% in one role)
  let imbalancePenalty = 0
  if ((roleCounts.BATTER || 0) < 3) imbalancePenalty += 20
  if ((roleCounts.BOWLER || 0) < 3) imbalancePenalty += 20
  if ((roleCounts.WICKET_KEEPER || 0) === 0) imbalancePenalty += 15
  if (overseasCount > SQUAD_RULES.MAX_OVERSEAS_PER_SQUAD) imbalancePenalty += 30

  const rawRating = clamp100(roleCoverageRating * 0.6 + sizeRating * 0.4 - imbalancePenalty)
  const weightedScore = round1((rawRating / 100) * TEAM_SCORE_WEIGHTS.squadBalance)

  return {
    score: weightedScore,
    rawRating: round1(rawRating),
    roleCoverageRating: round1(roleCoverageRating),
    sizeRating: round1(sizeRating),
    imbalancePenalty,
  }
}

/**
 * Player Quality Category Evaluation (/10 points)
 */
export const evaluateTeamPlayerQuality = (squadEvals = []) => {
  const scores = squadEvals
    .map((e) => e.overallScore)
    .filter((s) => s !== null)
    .sort((a, b) => b - a)

  if (scores.length === 0) {
    return { score: 0, rawRating: 0, coreXIQuality: 0 }
  }

  // Quality of top 11 core players
  const top11 = scores.slice(0, 11)
  const coreXIQuality = top11.reduce((sum, s) => sum + s, 0) / top11.length

  const rawRating = coreXIQuality
  const weightedScore = round1((rawRating / 100) * TEAM_SCORE_WEIGHTS.playerQuality)

  return {
    score: weightedScore,
    rawRating: round1(rawRating),
    coreXIQuality: round1(coreXIQuality),
  }
}

/**
 * Overseas Balance Category Evaluation (/5 points)
 */
export const evaluateTeamOverseasBalance = (overseasCount = 0) => {
  let rawRating
  if (overseasCount === 0) rawRating = 20
  else if (overseasCount >= 1 && overseasCount <= 3) rawRating = 60
  else if (overseasCount >= 4 && overseasCount <= 6) rawRating = 90
  else if (overseasCount >= 7 && overseasCount <= 8) rawRating = 100
  else rawRating = 40 // Exceeds max overseas limit of 8

  const weightedScore = round1((rawRating / 100) * TEAM_SCORE_WEIGHTS.overseasBalance)
  return {
    score: weightedScore,
    rawRating: round1(rawRating),
    overseasCount,
  }
}

/**
 * Wicketkeeping Category Evaluation (/5 points)
 */
export const evaluateTeamWicketKeeping = (squadEvals = []) => {
  const keepers = squadEvals.filter((e) => e.role === "WICKET_KEEPER")
  const keeperCount = keepers.length

  let rawRating
  if (keeperCount === 0) {
    rawRating = 10
  } else if (keeperCount === 1) {
    const primaryBatScore = keepers[0].batting.score ?? 50
    rawRating = clamp100(65 + (primaryBatScore / 100) * 20)
  } else {
    const bestBatScore = Math.max(...keepers.map((k) => k.batting.score ?? 50))
    rawRating = clamp100(85 + (bestBatScore / 100) * 15)
  }

  const weightedScore = round1((rawRating / 100) * TEAM_SCORE_WEIGHTS.wicketKeeping)
  return {
    score: weightedScore,
    rawRating: round1(rawRating),
    keeperCount,
    keepers: keepers.map((k) => ({ id: k.playerId, name: k.name, battingScore: k.batting.score })),
  }
}

/**
 * Auction Value & Spending Efficiency Category Evaluation (/10 points)
 */
export const evaluateTeamAuctionValue = (squadEvals = []) => {
  const valuablePurchases = []
  const expensivePurchases = []

  let totalSpent = 0
  let totalFairValue = 0
  let pricedPlayersCount = 0

  for (const e of squadEvals) {
    const price = e.auctionValue.historicalPrice
    const fair = e.auctionValue.fairPrice

    if (isVal(price) && price > 0) {
      totalSpent += price
      if (isVal(fair)) totalFairValue += fair
      pricedPlayersCount += 1

      const ratio = fair / price
      if (ratio >= 1.1) {
        valuablePurchases.push({
          playerId: e.playerId,
          name: e.name,
          soldPrice: price,
          fairPrice: fair,
          efficiency: round2(ratio),
        })
      } else if (ratio <= 0.67 && price >= 4.0) {
        expensivePurchases.push({
          playerId: e.playerId,
          name: e.name,
          soldPrice: price,
          fairPrice: fair,
          efficiency: round2(ratio),
          note: "high-cost relative to model value",
        })
      }
    }
  }

  totalSpent = roundCurrency(totalSpent)
  totalFairValue = roundCurrency(totalFairValue)

  let valueRating = 50
  if (totalSpent > 0 && pricedPlayersCount > 0) {
    const overallRatio = totalFairValue / totalSpent
    valueRating = clamp100(overallRatio * 75)
  } else if (pricedPlayersCount === 0) {
    valueRating = 70 // Neutral baseline if no price data exists
  }

  const weightedScore = round1((valueRating / 100) * TEAM_SCORE_WEIGHTS.auctionValue)

  return {
    score: weightedScore,
    rawRating: round1(valueRating),
    totalSpent,
    totalFairValue,
    valuablePurchases,
    expensivePurchases,
  }
}

// ---------------------------------------------------------------------------
// Deterministic Strengths & Weaknesses Generator
// ---------------------------------------------------------------------------

export const generateTeamStrengthsAndWeaknesses = (
  categories = {},
  roleCounts = {},
  squadComp = {},
  purseAnalysis = {}
) => {
  const strengths = []
  const weaknesses = []

  // Batting
  if (categories.batting.score >= 15.0) strengths.push("Strong batting depth and quality")
  else if (categories.batting.score < 10.0) weaknesses.push("Low batting depth")

  // Bowling
  if (categories.bowling.score >= 15.0) strengths.push("High-quality bowling attack")
  else if (categories.bowling.score < 10.0) weaknesses.push("Limited specialist bowling depth")

  // All-Rounders
  if (categories.allRounders.score >= 11.0) strengths.push("Multiple reliable all-round options")

  // Wicketkeeping
  if (roleCounts.WICKET_KEEPER >= 2 && categories.wicketKeeping.score >= 4.0) {
    strengths.push("Good wicketkeeper coverage")
  } else if (roleCounts.WICKET_KEEPER === 0) {
    weaknesses.push("No recognised wicketkeepers in squad")
  } else if (roleCounts.WICKET_KEEPER === 1) {
    weaknesses.push("Only one recognised wicketkeeper (lack of backup)")
  }

  // Role Imbalances
  if ((roleCounts.BOWLER || 0) < 4) weaknesses.push("Too few specialist bowlers")
  if ((roleCounts.BATTER || 0) < 4) weaknesses.push("Too few specialist batters")
  if ((roleCounts.BATTER || 0) >= 9) weaknesses.push("Heavy concentration in batting role")
  if ((roleCounts.BOWLER || 0) >= 9) weaknesses.push("Heavy concentration in bowling role")

  // Overseas Flexibility
  if (squadComp.overseasPlayers === 0) weaknesses.push("No overseas players in squad")
  else if (squadComp.overseasPlayers >= 4 && squadComp.overseasPlayers <= 8) {
    strengths.push("Good overseas flexibility")
  }

  // Purse & Auction Value
  if (categories.auctionValue.score >= 7.5) strengths.push("Strong value purchases across the squad")
  if (purseAnalysis.remaining >= 20.0) strengths.push("Healthy remaining purse flexibility")
  if (purseAnalysis.spendingPercentage > 92.0) weaknesses.push("High amount of purse spent")

  return { strengths, weaknesses }
}

// ---------------------------------------------------------------------------
// Missing Roles Detector
// ---------------------------------------------------------------------------

export const detectMissingRoles = (roleCounts = {}) => {
  const missingRoles = []
  for (const [role, target] of Object.entries(SQUAD_RULES.ROLE_TARGETS)) {
    const current = roleCounts[role] || 0
    const gap = target - current
    if (gap > 0) {
      missingRoles.push({
        role,
        current,
        target,
        gap,
        status: current === 0 ? "MISSING" : "DEFICIT",
      })
    }
  }
  return missingRoles
}

// ---------------------------------------------------------------------------
// Main Evaluation Entry Point (Team Evaluation Engine V1)
// ---------------------------------------------------------------------------

export const evaluateTeam = (teamInput = {}, options = {}) => {
  const normalized = normalizeTeamInput(teamInput, options)
  const { teamCode, teamName, squad, remainingPurse, initialPurse } = normalized

  // Evaluate every individual player using Player Value Engine V2
  const squadEvals = squad.map((player) => {
    const price = num(player.soldPrice ?? player.finalPrice)
    const evalResult = evaluatePlayerV2(player, price)
    return {
      player,
      ...evalResult,
    }
  })

  // Role Counts & Squad Composition
  const roleCounts = { BATTER: 0, BOWLER: 0, ALL_ROUNDER: 0, WICKET_KEEPER: 0 }
  let overseasCount = 0
  let cappedCount = 0
  let uncappedCount = 0

  for (const e of squadEvals) {
    if (roleCounts[e.role] !== undefined) roleCounts[e.role] += 1
    if (e.player.isOverseas === true) overseasCount += 1
    if (e.player.isCapped === true) cappedCount += 1
    else if (e.player.isCapped === false) uncappedCount += 1
  }

  const totalPlayers = squadEvals.length
  const indianCount = totalPlayers - overseasCount

  // Calculate 8 Component Categories
  const batting = evaluateTeamBatting(squadEvals)
  const bowling = evaluateTeamBowling(squadEvals)
  const allRounders = evaluateTeamAllRounders(squadEvals)
  const squadBalance = evaluateSquadBalance(roleCounts, totalPlayers, overseasCount)
  const playerQuality = evaluateTeamPlayerQuality(squadEvals)
  const overseasBalance = evaluateTeamOverseasBalance(overseasCount)
  const wicketKeeping = evaluateTeamWicketKeeping(squadEvals)

  // Purse Analysis
  const spent = roundCurrency(
    squadEvals.reduce((sum, e) => sum + (num(e.auctionValue.historicalPrice) || 0), 0)
  )

  let remaining
  let effectiveInitialPurse

  if (normalized.hasExplicitPurse && !normalized.hasExplicitInitialPurse) {
    remaining = roundCurrency(remainingPurse)
    effectiveInitialPurse = roundCurrency(spent + remaining)
  } else if (normalized.hasExplicitInitialPurse && !normalized.hasExplicitPurse) {
    effectiveInitialPurse = roundCurrency(initialPurse)
    remaining = roundCurrency(Math.max(0, effectiveInitialPurse - spent))
  } else if (normalized.hasExplicitInitialPurse && normalized.hasExplicitPurse) {
    effectiveInitialPurse = roundCurrency(initialPurse)
    remaining = roundCurrency(remainingPurse)
  } else {
    effectiveInitialPurse = roundCurrency(initialPurse)
    remaining = roundCurrency(Math.max(0, effectiveInitialPurse - spent))
  }

  const spendingPercentage = round1(
    effectiveInitialPurse > 0 ? (spent / effectiveInitialPurse) * 100 : 0
  )

  const purseAnalysis = {
    initialPurse: effectiveInitialPurse,
    spent,
    remaining,
    spendingPercentage,
  }

  const auctionValue = evaluateTeamAuctionValue(squadEvals, remaining, effectiveInitialPurse)

  // Overall Team Score (Sum of 8 weighted category scores)
  const overallScore = round1(
    batting.score +
      bowling.score +
      allRounders.score +
      squadBalance.score +
      playerQuality.score +
      overseasBalance.score +
      wicketKeeping.score +
      auctionValue.score
  )

  // Feedback: Strengths, Weaknesses, Missing Roles
  const categoriesObj = {
    batting,
    bowling,
    allRounders,
    squadBalance,
    playerQuality,
    overseasBalance,
    wicketKeeping,
    auctionValue,
  }

  const squadComp = {
    totalPlayers,
    overseasPlayers: overseasCount,
    IndianPlayers: indianCount,
    cappedPlayers: cappedCount,
    uncappedPlayers: uncappedCount,
  }

  const { strengths, weaknesses } = generateTeamStrengthsAndWeaknesses(
    categoriesObj,
    roleCounts,
    squadComp,
    purseAnalysis
  )

  const missingRoles = detectMissingRoles(roleCounts)

  // Squad Confidence Calculation
  const confs = squadEvals.map((e) => e.confidence).filter((c) => c > 0)
  const avgPlayerConf = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.5
  const completeness = totalPlayers >= SQUAD_RULES.MIN_SQUAD_SIZE ? 1.0 : totalPlayers / SQUAD_RULES.MIN_SQUAD_SIZE
  const confidence = round2(avgPlayerConf * 0.7 + completeness * 0.3)

  return {
    teamCode,
    teamName,
    squadSize: totalPlayers,
    overallScore,
    squad: squadEvals,

    categories: categoriesObj,

    roleBreakdown: {
      batters: roleCounts.BATTER,
      bowlers: roleCounts.BOWLER,
      allRounders: roleCounts.ALL_ROUNDER,
      wicketKeepers: roleCounts.WICKET_KEEPER,
      roles: roleCounts,
    },

    squadComposition: squadComp,
    purseAnalysis,

    strengths,
    weaknesses,
    missingRoles,
    valuablePurchases: auctionValue.valuablePurchases,
    expensivePurchases: auctionValue.expensivePurchases,

    confidence,
  }
}
