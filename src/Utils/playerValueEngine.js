/**
 * Player Value Engine V2
 *
 * Deterministic, role-aware, sample-size sensitive evaluation engine for IPL players.
 * Computes transparent quality, component scores, confidence, strengths/limitations,
 * and auction value metrics from canonical master records or legacy auction objects.
 *
 * Design Principles:
 * 1. Pure & Deterministic: Same input ALWAYS produces identical output. No LLMs, APIs, or randomness.
 * 2. Null vs Zero: null = unavailable/missing data; 0 = genuine zero. Never convert null to 0.
 * 3. Sample-Size Aware: Small samples do not inflate confidence; raw volume is scaled.
 * 4. Separate Quality & Price: Historical SOLD_PRICE does not dictate player quality.
 * 5. Role Aware: BATTER, BOWLER, ALL_ROUNDER, WICKET_KEEPER scored on relevant craft.
 * 6. Wicketkeeping: Keeping stats are marked unavailable if not present in dataset (no fabrication).
 * 7. Full Backward Compatibility: Maintains top-level functions and property aliases.
 */

import { roundCurrency } from "./auctionRules.js"

// ---------------------------------------------------------------------------
// Constants & Norm Caps
// ---------------------------------------------------------------------------

export const VALUE_SCALE = { MIN: 0, MAX: 100 }

export const VALUE_CAPS = {
  RUNS: 6000,
  WICKETS: 160,
  MATCHES: 200,
  INNINGS: 180,
  BATTING_AVG_FLOOR: 15,
  BATTING_AVG_CEILING: 45,
  SR_FLOOR: 100,
  SR_CEILING: 170,
  ECON_FLOOR: 6.0,
  ECON_CEILING: 10.0,
  BOWL_AVG_FLOOR: 20.0,
  BOWL_AVG_CEILING: 40.0,
  BOWL_SR_FLOOR: 14.0,
  BOWL_SR_CEILING: 28.0,
}

export const VFM_BANDS = [
  { min: 80, label: "EXCELLENT" },
  { min: 60, label: "GOOD" },
  { min: 40, label: "FAIR" },
  { min: 20, label: "LOW" },
  { min: 0, label: "POOR" },
]

// ---------------------------------------------------------------------------
// Helper Math & Validation Functions
// ---------------------------------------------------------------------------

export const isVal = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v))

export const num = (v) => (isVal(v) ? Number(v) : null)

export const clamp = (val, min, max) => Math.min(max, Math.max(min, val))

export const clamp100 = (v) => Math.min(100, Math.max(0, v))

export const round1 = (v) => (isVal(v) ? Math.round(clamp100(v) * 10) / 10 : null)

export const round2 = (v) => (isVal(v) ? Math.round(v * 100) / 100 : null)

/** Linear 0-100 normalization */
export const normRange = (val, floor, ceiling, invert = false) => {
  if (!isVal(val)) return null
  const n = num(val)
  if (floor === ceiling) return 50
  const pct = (n - floor) / (ceiling - floor)
  const score = invert ? (1 - pct) * 100 : pct * 100
  return clamp100(score)
}

/** Diminishing returns volume curve (sub-linear power scaling) */
export const normVolume = (val, cap, power = 0.75) => {
  if (!isVal(val)) return null
  const linearPct = clamp100((num(val) / cap) * 100) / 100
  return clamp100(Math.pow(linearPct, power) * 100)
}

// ---------------------------------------------------------------------------
// Data Extraction Layer (Handles canonical master + flattened auction player)
// ---------------------------------------------------------------------------

export const extractPlayerStats = (player = {}) => {
  const iplBat = player?.ipl?.batting || {}
  const iplBowl = player?.ipl?.bowling || {}
  const iplKeep = player?.ipl?.keeping || player?.keeping || {}

  const matches = num(iplBat.matches ?? player.matches)
  const innings = num(iplBat.innings ?? player.innings)
  const runs = num(iplBat.runs ?? player.runs)
  const balls = num(iplBat.balls ?? player.balls ?? player.ballsFaced)
  const highestScore = num(iplBat.highestScore ?? player.highestScore)
  const average = num(iplBat.average ?? player.average ?? player.battingAverage)
  const strikeRate = num(iplBat.strikeRate ?? player.strikeRate)
  const notOuts = num(iplBat.notOuts ?? player.notOuts)
  const fours = num(iplBat.fours ?? player.fours)
  const sixes = num(iplBat.sixes ?? player.sixes)
  const ducks = num(iplBat.ducks ?? player.ducks)
  const fifties = num(iplBat.fifties ?? player.fifties)
  const hundreds = num(iplBat.hundreds ?? player.hundreds)

  const b_innings = num(iplBowl.innings ?? player.b_innings ?? player.bowlingInnings)
  const b_balls = num(iplBowl.balls ?? player.b_balls ?? player.bowlingBalls)
  const b_runs = num(iplBowl.runsConceded ?? player.b_runs ?? player.runsConceded)
  const b_maidens = num(iplBowl.maidens ?? player.b_maidens ?? player.maidens)
  const b_wickets = num(iplBowl.wickets ?? player.wickets)
  const b_average = num(iplBowl.average ?? player.b_average ?? player.bowlingAverage)
  const b_economy = num(iplBowl.economy ?? player.b_economy ?? player.economy)
  const b_strikeRate = num(iplBowl.strikeRate ?? player.b_strikeRate ?? player.bowlingStrikeRate)
  const b_4w = num(iplBowl.fourWickets ?? player.b_4w ?? player.fourWickets)
  const b_5w = num(iplBowl.fiveWickets ?? player.b_5w ?? player.fiveWickets)

  const catches = num(iplKeep.catches ?? player.catches)
  const stumpings = num(iplKeep.stumpings ?? player.stumpings)

  const age = num(player.age)
  const isCapped = player.isCapped === true
  const captaincyExperience = player.captaincyExperience === true || Number(player.captaincySeasons) > 0

  const soldPrice = num(player.auction?.soldPriceCr ?? player.soldPrice ?? player.soldPriceCr)
  const basePrice = num(player.auction?.basePrice ?? player.basePrice)

  return {
    id: player?.id || null,
    name: player?.name || "Unknown Player",
    role: player?.role || "BATTER",
    matches,
    innings,
    runs,
    balls,
    highestScore,
    average,
    strikeRate,
    notOuts,
    fours,
    sixes,
    ducks,
    fifties,
    hundreds,
    b_innings,
    b_balls,
    b_runs,
    b_maidens,
    b_wickets,
    b_average,
    b_economy,
    b_strikeRate,
    b_4w,
    b_5w,
    catches,
    stumpings,
    age,
    isCapped,
    captaincyExperience,
    soldPrice,
    basePrice,
  }
}

// ---------------------------------------------------------------------------
// Component Calculators (V2 Engine Core)
// ---------------------------------------------------------------------------

/**
 * Batting Component Evaluation
 * Sample-size aware: uses innings and run volume to scale confidence.
 */
export const evaluateBatting = (player = {}) => {
  const s = extractPlayerStats(player)
  const metricsUsed = []

  const hasBattingData =
    isVal(s.runs) || isVal(s.innings) || isVal(s.strikeRate) || isVal(s.average) || isVal(s.matches)

  if (!hasBattingData || (s.runs === null && s.innings === null && s.matches === null)) {
    return {
      score: null,
      confidence: 0.0,
      metricsUsed: [],
      details: { statisticsAvailable: false },
    }
  }

  const runs = s.runs ?? 0
  const innings = s.innings ?? (s.matches ? Math.round(s.matches * 0.8) : 0)

  // 1. Run Volume Score (40% weight) - diminishing returns curve
  const runsScore = normVolume(runs, VALUE_CAPS.RUNS, 0.72)
  if (isVal(s.runs)) metricsUsed.push("runs")

  // 2. Average Score (30% weight)
  let avgVal = s.average
  if (!isVal(avgVal) && isVal(s.runs) && isVal(s.innings) && s.innings > 0) {
    const outs = Math.max(1, s.innings - (s.notOuts ?? 0))
    avgVal = s.runs / outs
  }
  const avgScore = isVal(avgVal)
    ? normRange(avgVal, VALUE_CAPS.BATTING_AVG_FLOOR, VALUE_CAPS.BATTING_AVG_CEILING)
    : 50
  if (isVal(avgVal)) metricsUsed.push("average")

  // 3. Strike Rate Score (30% weight)
  const srVal = s.strikeRate
  const srScore = isVal(srVal)
    ? normRange(srVal, VALUE_CAPS.SR_FLOOR, VALUE_CAPS.SR_CEILING)
    : 50
  if (isVal(srVal)) metricsUsed.push("strikeRate")

  if (isVal(s.fifties) || isVal(s.hundreds)) metricsUsed.push("milestones")

  // Weighted raw performance score
  let rawScore = runsScore * 0.4 + avgScore * 0.3 + srScore * 0.3

  // Milestone bonus
  if (isVal(s.fifties) && s.fifties > 0) rawScore += Math.min(5, s.fifties * 0.5)
  if (isVal(s.hundreds) && s.hundreds > 0) rawScore += Math.min(8, s.hundreds * 2.0)

  const finalScore = round1(rawScore)

  // Confidence based on sample size (full confidence at 30 innings or 600 runs)
  const sampleFactor = Math.min(1.0, Math.max(innings / 30, runs / 600))
  const dataCompleteness = (metricsUsed.length / 4) * 0.4 + 0.6
  const confidence = round2(clamp(sampleFactor * dataCompleteness, 0.05, 1.0))

  return {
    score: finalScore,
    confidence,
    metricsUsed,
    details: {
      statisticsAvailable: true,
      runs,
      innings,
      average: avgVal !== null ? round2(avgVal) : null,
      strikeRate: s.strikeRate,
      fifties: s.fifties,
      hundreds: s.hundreds,
      sampleFactor: round2(sampleFactor),
    },
  }
}

/**
 * Bowling Component Evaluation
 * Sample-size aware: lower economy/average is better.
 */
export const evaluateBowling = (player = {}) => {
  const s = extractPlayerStats(player)
  const metricsUsed = []

  const hasBowlingData =
    isVal(s.b_wickets) || isVal(s.b_balls) || isVal(s.b_economy) || isVal(s.b_average) || isVal(s.b_innings)

  if (!hasBowlingData || (s.b_wickets === null && s.b_balls === null && s.b_innings === null)) {
    return {
      score: null,
      confidence: 0.0,
      metricsUsed: [],
      details: { statisticsAvailable: false },
    }
  }

  const wickets = s.b_wickets ?? 0
  const balls = s.b_balls ?? (s.b_innings ? s.b_innings * 18 : 0)

  // 1. Wicket Volume Score (45% weight) - diminishing returns curve
  const wicketsScore = normVolume(wickets, VALUE_CAPS.WICKETS, 0.72)
  if (isVal(s.b_wickets)) metricsUsed.push("wickets")

  // 2. Economy Score (30% weight) - lower is better
  const econVal = s.b_economy
  const econScore = isVal(econVal)
    ? normRange(econVal, VALUE_CAPS.ECON_FLOOR, VALUE_CAPS.ECON_CEILING, true)
    : 50
  if (isVal(econVal)) metricsUsed.push("economy")

  // 3. Bowling Average Score (25% weight) - lower is better
  let avgVal = s.b_average
  if (!isVal(avgVal) && isVal(s.b_runs) && isVal(s.b_wickets) && s.b_wickets > 0) {
    avgVal = s.b_runs / s.b_wickets
  }
  const avgScore = isVal(avgVal)
    ? normRange(avgVal, VALUE_CAPS.BOWL_AVG_FLOOR, VALUE_CAPS.BOWL_AVG_CEILING, true)
    : 50
  if (isVal(avgVal)) metricsUsed.push("bowlingAverage")

  if (isVal(s.b_4w) || isVal(s.b_5w)) metricsUsed.push("hauls")

  // Weighted raw bowling score
  let rawScore = wicketsScore * 0.45 + econScore * 0.3 + avgScore * 0.25

  // Multi-wicket haul bonus
  if (isVal(s.b_4w) && s.b_4w > 0) rawScore += Math.min(4, s.b_4w * 1.5)
  if (isVal(s.b_5w) && s.b_5w > 0) rawScore += Math.min(6, s.b_5w * 3.0)

  const finalScore = round1(rawScore)

  // Confidence based on sample size (full confidence at 240 balls [40 overs] or 20 wickets)
  const sampleFactor = Math.min(1.0, Math.max(balls / 240, wickets / 20))
  const dataCompleteness = (metricsUsed.length / 4) * 0.4 + 0.6
  const confidence = round2(clamp(sampleFactor * dataCompleteness, 0.05, 1.0))

  return {
    score: finalScore,
    confidence,
    metricsUsed,
    details: {
      statisticsAvailable: true,
      wickets,
      balls,
      economy: econVal,
      bowlingAverage: avgVal !== null ? round2(avgVal) : null,
      fourWickets: s.b_4w,
      fiveWickets: s.b_5w,
      sampleFactor: round2(sampleFactor),
    },
  }
}

/**
 * All-Rounder Component Evaluation
 * Role-aware combination of batting and bowling without penalizing unplayed disciplines.
 */
export const evaluateAllRounder = (player = {}) => {
  const bat = evaluateBatting(player)
  const bowl = evaluateBowling(player)

  const batAvailable = bat.details.statisticsAvailable && bat.score !== null
  const bowlAvailable = bowl.details.statisticsAvailable && bowl.score !== null

  if (!batAvailable && !bowlAvailable) {
    return {
      score: null,
      confidence: 0.0,
      metricsUsed: [],
      details: { statisticsAvailable: false, explanation: "No batting or bowling statistics available" },
    }
  }

  const metricsUsed = []
  if (batAvailable) metricsUsed.push(...bat.metricsUsed.map((m) => `batting.${m}`))
  if (bowlAvailable) metricsUsed.push(...bowl.metricsUsed.map((m) => `bowling.${m}`))

  let score
  let calculationMethod

  if (batAvailable && bowlAvailable) {
    // Both disciplines have data
    const batWeight = Math.max(0.2, bat.confidence)
    const bowlWeight = Math.max(0.2, bowl.confidence)
    const totalWeight = batWeight + bowlWeight

    const weightedScore = (bat.score * batWeight + bowl.score * bowlWeight) / totalWeight

    // Versatility bonus if both disciplines have meaningful contributions
    const bothStrong = bat.score >= 40 && bowl.score >= 40 && bat.confidence >= 0.3 && bowl.confidence >= 0.3
    const versatilityBonus = bothStrong ? 5.0 : 0.0

    score = round1(weightedScore + versatilityBonus)
    calculationMethod = bothStrong
      ? "Balanced dual-discipline evaluation with versatility bonus"
      : "Confidence-weighted blend of batting and bowling scores"
  } else if (batAvailable) {
    score = bat.score
    calculationMethod = "Batting-primary evaluation (bowling data unavailable)"
  } else {
    score = bowl.score
    calculationMethod = "Bowling-primary evaluation (batting data unavailable)"
  }

  const combinedConfidence = round2(
    batAvailable && bowlAvailable
      ? (bat.confidence + bowl.confidence) / 2
      : batAvailable
      ? bat.confidence * 0.8
      : bowl.confidence * 0.8
  )

  return {
    score,
    confidence: combinedConfidence,
    metricsUsed,
    details: {
      statisticsAvailable: true,
      battingScore: bat.score,
      bowlingScore: bowl.score,
      battingConfidence: bat.confidence,
      bowlingConfidence: bowl.confidence,
      calculationMethod,
    },
  }
}

/**
 * Wicketkeeper Component Evaluation
 * MUST NOT fabricate keeping quality if stats do not exist in dataset.
 */
export const evaluateWicketKeeping = (player = {}) => {
  const s = extractPlayerStats(player)
  const isWKRole = s.role === "WICKET_KEEPER"

  const hasKeepingStats = isVal(s.catches) || isVal(s.stumpings)

  if (!hasKeepingStats) {
    return {
      score: null,
      confidence: null,
      metricsUsed: [],
      statisticsAvailable: false,
      details: {
        isDeclaredRole: isWKRole,
        explanation: "No wicketkeeping dismissals data (catches/stumpings) available in dataset",
      },
    }
  }

  // If keeping statistics exist in dataset:
  const catches = s.catches ?? 0
  const stumpings = s.stumpings ?? 0
  const totalDismissals = catches + stumpings
  const score = round1(normRange(totalDismissals, 0, 100))

  return {
    score,
    confidence: round2(clamp(totalDismissals / 50, 0.2, 1.0)),
    metricsUsed: ["catches", "stumpings"],
    statisticsAvailable: true,
    details: {
      isDeclaredRole: isWKRole,
      catches,
      stumpings,
      totalDismissals,
    },
  }
}

/**
 * Experience Component Evaluation
 * Distinct from performance: evaluates matches, age curve, captaincy, and capped status.
 */
export const evaluateExperience = (player = {}) => {
  const s = extractPlayerStats(player)
  const metricsUsed = []

  // 1. Match Experience Score (50% weight) - diminishing returns curve
  const matches = s.matches ?? s.innings ?? 0
  const matchesScore = normVolume(matches, VALUE_CAPS.MATCHES, 0.8)
  if (isVal(s.matches) || isVal(s.innings)) metricsUsed.push("matches")

  // 2. Age Curve Score (20% weight)
  let ageScore = 50
  if (isVal(s.age)) {
    const age = s.age
    metricsUsed.push("age")
    if (age >= 25 && age <= 32) ageScore = 100
    else if (age < 25) ageScore = clamp100(50 + (age - 18) * (50 / 7))
    else ageScore = clamp100(100 - (age - 32) * 8)
  }

  // 3. Captaincy Bonus (15% weight)
  const captaincyScore = s.captaincyExperience ? 100 : 0
  if (s.captaincyExperience) metricsUsed.push("captaincyExperience")

  // 4. International Capped Status (15% weight)
  const cappedScore = s.isCapped ? 100 : 35
  metricsUsed.push("isCapped")

  const rawScore = matchesScore * 0.5 + ageScore * 0.2 + captaincyScore * 0.15 + cappedScore * 0.15
  const score = round1(rawScore)
  const confidence = isVal(s.matches) ? 0.95 : 0.60

  return {
    score,
    confidence,
    metricsUsed,
    details: {
      matches,
      age: s.age,
      captaincyExperience: s.captaincyExperience,
      isCapped: s.isCapped,
    },
  }
}

/**
 * Role Value Component Evaluation
 * Evaluates output & craft fit for player's declared role.
 */
export const evaluateRoleValue = (player = {}) => {
  const s = extractPlayerStats(player)
  const role = s.role

  const bat = evaluateBatting(player)
  const bowl = evaluateBowling(player)
  const ar = evaluateAllRounder(player)

  let score

  switch (role) {
    case "BATTER":
      score = bat.score
      break
    case "BOWLER":
      score = bowl.score
      break
    case "ALL_ROUNDER":
      score = ar.score
      break
    case "WICKET_KEEPER":
      // WK scored on batting output as keeping stats are unrecorded
      score = bat.score
      break
    default:
      score = bat.score !== null && bowl.score !== null
        ? round1((bat.score + bowl.score) / 2)
        : bat.score ?? bowl.score ?? null
  }

  return {
    score,
    primaryRole: role,
    contribution: {
      battingScore: bat.score,
      bowlingScore: bowl.score,
      allRounderScore: ar.score,
    },
  }
}

/**
 * Auction Value Evaluation
 * Kept strictly separate from player quality!
 */
export const evaluateAuctionValue = (player = {}, auctionPrice = null) => {
  const s = extractPlayerStats(player)

  // Determine historical price:
  // If auctionPrice arg is provided (not null/undefined), use it.
  // Else fall back to s.soldPrice. If neither is available, price is null.
  let historicalPrice = null
  if (auctionPrice !== undefined && auctionPrice !== null) {
    historicalPrice = num(auctionPrice)
  } else if (isVal(s.soldPrice)) {
    historicalPrice = s.soldPrice
  }

  const basePrice = s.basePrice

  // Calculate overall score to establish baseline fair market value
  const bat = evaluateBatting(player)
  const bowl = evaluateBowling(player)
  const exp = evaluateExperience(player)
  const roleVal = evaluateRoleValue(player)

  const perfScore = roleVal.score ?? bat.score ?? bowl.score ?? exp.score ?? 50
  const fairPrice = roundCurrency(0.3 + (perfScore / 100) * 14.7)

  if (!isVal(historicalPrice) || historicalPrice <= 0) {
    return {
      historicalPrice: null,
      basePrice,
      fairPrice,
      estimatedValue: fairPrice,
      valueForMoney: null,
      valueBand: null,
      priceEfficiency: null,
    }
  }

  // Value for money score (100 if paid half fair price, 50 if paid fair price, lower if overpaid)
  const ratio = fairPrice / historicalPrice
  const vfmScore = round1(clamp100(ratio * 50))

  const bandObj = VFM_BANDS.find((b) => vfmScore >= b.min)
  const valueBand = bandObj ? bandObj.label : "POOR"

  const priceEfficiency = round2(ratio)

  return {
    historicalPrice: roundCurrency(historicalPrice),
    basePrice,
    fairPrice,
    estimatedValue: fairPrice,
    valueForMoney: vfmScore,
    valueBand,
    priceEfficiency,
  }
}

// ---------------------------------------------------------------------------
// Deterministic Strengths & Limitations Generator
// ---------------------------------------------------------------------------

export const generateStrengthsAndLimitations = (player = {}, evalObj = {}) => {
  const s = extractPlayerStats(player)
  const bat = evalObj.batting || evaluateBatting(player)
  const bowl = evalObj.bowling || evaluateBowling(player)
  const auc = evalObj.auctionValue || evaluateAuctionValue(player)
  const wk = evalObj.wicketKeeping || evaluateWicketKeeping(player)

  const strengths = []
  const limitations = []

  // Batting Strengths & Limitations
  if (bat.details.statisticsAvailable) {
    if (isVal(s.runs) && s.runs >= 2000) strengths.push("Strong IPL run volume")
    if (isVal(bat.details.average) && bat.details.average >= 32.0) strengths.push("High career batting average")
    if (isVal(s.strikeRate) && s.strikeRate >= 140.0) strengths.push("High IPL batting strike rate")
    if (isVal(s.fifties) && s.fifties >= 15) strengths.push("Consistent fifty-plus run scorer")

    if (isVal(s.innings) && s.innings < 15) limitations.push("Limited IPL batting sample")
    if (isVal(s.strikeRate) && s.strikeRate < 118.0) limitations.push("Low batting strike rate")
  } else {
    limitations.push("No IPL batting statistics recorded")
  }

  // Bowling Strengths & Limitations
  if (bowl.details.statisticsAvailable) {
    if (isVal(s.b_wickets) && s.b_wickets >= 75) strengths.push("Strong IPL wicket-taking record")
    if (isVal(s.b_economy) && s.b_economy <= 7.6) strengths.push("Economical bowling rate")
    if (isVal(bowl.details.bowlingAverage) && bowl.details.bowlingAverage <= 24.0) strengths.push("Excellent bowling strike rate and average")

    if (isVal(s.b_balls) && s.b_balls < 120) limitations.push("Limited IPL bowling sample")
    if (isVal(s.b_economy) && s.b_economy >= 9.2) limitations.push("High bowling economy rate")
  } else if (s.role === "BOWLER") {
    limitations.push("No IPL bowling statistics recorded")
  }

  // All-Rounder & Experience
  if (s.role === "ALL_ROUNDER" && bat.score >= 40 && bowl.score >= 40) {
    strengths.push("Useful all-round contribution")
  }

  if (s.captaincyExperience) strengths.push("Extensive captaincy experience")
  if (isVal(s.matches) && s.matches >= 100) strengths.push("Vast IPL match experience")

  // Wicketkeeper note
  if (!wk.statisticsAvailable) {
    limitations.push("No wicketkeeping statistics available")
  }

  // Auction Price note
  if (!isVal(auc.historicalPrice)) {
    limitations.push("Historical auction price unavailable")
  }

  return { strengths, limitations }
}

// ---------------------------------------------------------------------------
// Main Evaluation Entry Point (Player Value Engine V2)
// ---------------------------------------------------------------------------

export const evaluatePlayerV2 = (player = {}, auctionPrice = null) => {
  const stats = extractPlayerStats(player)

  const batting = evaluateBatting(player)
  const bowling = evaluateBowling(player)
  const allRounder = evaluateAllRounder(player)
  const wicketKeeping = evaluateWicketKeeping(player)
  const experience = evaluateExperience(player)
  const roleValue = evaluateRoleValue(player)
  const auctionValue = evaluateAuctionValue(player, auctionPrice)

  const statisticsAvailable =
    batting.details.statisticsAvailable || bowling.details.statisticsAvailable

  // Calculate Overall Score (Role Weighted)
  let overallScore = null
  let overallConfidence = 0.0

  if (statisticsAvailable) {
    const batS = batting.score ?? 40
    const bowlS = bowling.score ?? 40
    const expS = experience.score
    const roleS = roleValue.score ?? perfScoreFallback(batting, bowling)

    switch (stats.role) {
      case "BATTER":
        overallScore = round1(batS * 0.55 + (bowling.score !== null ? bowlS * 0.1 : 0) + roleS * 0.15 + expS * 0.2)
        break
      case "BOWLER":
        overallScore = round1(bowlS * 0.55 + (batting.score !== null ? batS * 0.1 : 0) + roleS * 0.15 + expS * 0.2)
        break
      case "ALL_ROUNDER":
        overallScore = round1((allRounder.score ?? (batS + bowlS) / 2) * 0.65 + roleS * 0.15 + expS * 0.2)
        break
      case "WICKET_KEEPER":
        overallScore = round1(batS * 0.55 + roleS * 0.2 + expS * 0.25)
        break
      default:
        overallScore = round1(batS * 0.35 + bowlS * 0.35 + expS * 0.3)
    }

    const confWeights = [batting.confidence, bowling.confidence, experience.confidence].filter((c) => c > 0)
    overallConfidence = round2(
      confWeights.reduce((a, b) => a + b, 0) / (confWeights.length || 1)
    )
  }

  const { strengths, limitations } = generateStrengthsAndLimitations(player, {
    batting,
    bowling,
    experience,
    auctionValue,
    wicketKeeping,
  })

  // Full V2 Structured Evaluation Object
  return {
    playerId: stats.id,
    name: stats.name,
    role: stats.role,
    statisticsAvailable,

    batting,
    bowling,
    allRounder,
    wicketKeeping,
    experience,
    roleValue,
    auctionValue,

    overallScore,
    confidence: overallConfidence,
    strengths,
    limitations,

    // Backward compatibility property aliases:
    battingValue: batting.score ?? 0,
    bowlingValue: bowling.score ?? 0,
    allRounderValue: allRounder.score ?? 0,
    wicketKeeperValue: wicketKeeping.score,
    experienceValue: experience.score,
    roleValueScore: roleValue.score ?? 0,
    overallValue: overallScore ?? 0,
    auctionPrice: auctionValue.historicalPrice,
    valueForMoney: auctionValue.valueForMoney,
    valueBand: auctionValue.valueBand,
    fairPrice: auctionValue.fairPrice,
  }
}

function perfScoreFallback(batting, bowling) {
  if (batting.score !== null && bowling.score !== null) return (batting.score + bowling.score) / 2
  return batting.score ?? bowling.score ?? 40
}

// ---------------------------------------------------------------------------
// Backward Compatibility API Wrappers
// ---------------------------------------------------------------------------

export const calculateBattingValue = (player = {}) => {
  const res = evaluateBatting(player)
  return res.score ?? 0
}

export const calculateBowlingValue = (player = {}) => {
  const res = evaluateBowling(player)
  return res.score ?? 0
}

export const calculateAllRounderValue = (player = {}) => {
  const res = evaluateAllRounder(player)
  return res.score ?? 0
}

export const calculateWicketKeeperValue = (player = {}) => {
  const res = evaluateWicketKeeping(player)
  return res.score
}

export const calculateExperienceValue = (player = {}) => {
  const res = evaluateExperience(player)
  return res.score ?? 0
}

export const calculateRoleValue = (player = {}) => {
  const res = evaluateRoleValue(player)
  return res.score ?? 0
}

export const calculateOverallPlayerValue = (player = {}) => {
  const res = evaluatePlayerV2(player)
  return res.overallScore ?? 0
}

export const calculateValueForMoney = (player = {}, auctionPrice) => {
  const auc = evaluateAuctionValue(player, auctionPrice)
  return {
    score: auc.valueForMoney,
    band: auc.valueBand,
    fairPrice: auc.fairPrice,
  }
}

/** Primary V1 wrapper function, delegates to evaluatePlayerV2 */
export const evaluatePlayerValue = (player = {}, auctionPrice = null) => {
  return evaluatePlayerV2(player, auctionPrice)
}

/** Attach V2 evaluation to a SOLD event payload */
export const attachValueToSoldEvent = (soldEvent = {}, player = {}) => ({
  ...soldEvent,
  value: evaluatePlayerValue(player, soldEvent?.finalPrice ?? null),
})
