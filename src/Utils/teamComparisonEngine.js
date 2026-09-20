/**
 * Team Comparison Engine V1
 *
 * Deterministic comparison and analysis layer for evaluated IPL auction squads.
 * Consumes single-team evaluations produced by Team Evaluation Engine V1.
 *
 * Design Principles:
 * 1. Pure & Deterministic: Same evaluations in = identical comparison out. Synchronous, pure logic.
 * 2. Strict Ranking Rule: Team ordering comes ONLY from Team Evaluation Engine V1 overallScore.
 *    No secret formulas, popularity, or real-world bias.
 * 3. Highest Scoring Team: Identifies the highest-scoring squad in the model (never "will win IPL").
 * 4. Explicit Tie Handling: Explicitly flags ties if top overall scores are identical within 0.01 precision.
 * 5. Category Leaders: Identifies leaders for each of the 8 evaluation categories.
 * 6. Neutral & Objective: Descriptive statistics and model-grounded comparative insights.
 */

import { round1, isVal, num } from "./playerValueEngine.js"
import { TEAM_SCORE_WEIGHTS } from "./teamEvaluationEngine.js"
import { SQUAD_RULES } from "./squadRules.js"

// ---------------------------------------------------------------------------
// Category Definitions
// ---------------------------------------------------------------------------

export const CATEGORY_KEYS = [
  "batting",
  "bowling",
  "allRounders",
  "squadBalance",
  "playerQuality",
  "overseasBalance",
  "wicketKeeping",
  "auctionValue",
]

// Maximum values are preserved from Team Evaluation Engine V1 — this object
// is derived, not duplicated. Any weight change there flows through here.
export const CATEGORY_MAXIMA = { ...TEAM_SCORE_WEIGHTS }

export const ROLE_KEYS = ["BATTER", "BOWLER", "ALL_ROUNDER", "WICKET_KEEPER"]

// ---------------------------------------------------------------------------
// Main Comparison Entry Point
// ---------------------------------------------------------------------------

export const compareTeams = (teamEvaluationsInput = [], options = {}) => {
  // Tie epsilon: score differences strictly below this count as a tie.
  // Default 0.01 (floating-point noise); pass { tieEpsilon: 0 } for exact ties only.
  const tieEpsilon = num(options.tieEpsilon) ?? 0.01
  let teamsList = []

  if (Array.isArray(teamEvaluationsInput)) {
    teamsList = teamEvaluationsInput.filter((t) => t && typeof t === "object" && t.teamCode)
  } else if (teamEvaluationsInput && typeof teamEvaluationsInput === "object") {
    teamsList = Object.values(teamEvaluationsInput).filter((t) => t && typeof t === "object" && t.teamCode)
  }

  // Handle Empty / Insufficient Data
  if (!teamsList || teamsList.length === 0) {
    return {
      status: "INSUFFICIENT_DATA",
      message: "No team evaluations provided for comparison",
      teamCount: 0,
      teams: [],
      categoryComparison: {},
      overallScores: [],
      highestScoringTeam: null,
      tieStatus: { isTie: false, tiedTeams: [] },
      scoreGap: { highestScore: null, lowestScore: null, scoreSpread: null, firstToSecondGap: null },
      pairwiseDifferences: [],
      roleCoverage: [],
      purseComparison: { teams: [], highestSpender: null, lowestSpender: null },
      categoryLeaders: {},
      analysis: { relativeComparisons: [] },
    }
  }

  const teamCount = teamsList.length

  // Single Team Handling
  if (teamCount === 1) {
    const single = teamsList[0]
    return {
      status: "COMPLETE",
      teamCount: 1,
      teams: [single],
      overallScores: [
        {
          teamCode: single.teamCode,
          teamName: single.teamName,
          score: single.overallScore,
          confidence: single.confidence,
          rank: 1,
        },
      ],
      highestScoringTeam: {
        teamCode: single.teamCode,
        teamName: single.teamName,
        score: single.overallScore,
        label: "highest-scoring squad in this evaluation model",
        isTie: false,
      },
      tieStatus: { isTie: false, tiedTeams: [] },
      scoreGap: {
        highestScore: single.overallScore,
        lowestScore: single.overallScore,
        scoreSpread: 0,
        firstToSecondGap: 0,
      },
      categoryLeaders: buildSingleTeamLeaders(single),
      categoryComparison: buildSingleTeamCategoryComparison(single),
      pairwiseDifferences: [],
      roleCoverage: buildRoleCoverage([single]),
      purseComparison: buildPurseComparison([single]),
      analysis: {
        strongestBatting: { teamCode: single.teamCode, teamName: single.teamName, score: single.categories.batting.score },
        strongestBowling: { teamCode: single.teamCode, teamName: single.teamName, score: single.categories.bowling.score },
        strongestAllRounderGroup: { teamCode: single.teamCode, teamName: single.teamName, score: single.categories.allRounders.score },
        strongestBalance: { teamCode: single.teamCode, teamName: single.teamName, score: single.categories.squadBalance.score },
        strongestValue: { teamCode: single.teamCode, teamName: single.teamName, score: single.categories.auctionValue.score },
        relativeComparisons: [`Single squad evaluated: ${single.teamName} (${single.overallScore}/100).`],
      },
    }
  }

  // Multi-Team Sorting (Strictly by overallScore descending)
  const sortedTeams = [...teamsList].sort(
    (a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0)
  )

  const overallScores = sortedTeams.map((t, idx) => ({
    teamCode: t.teamCode,
    teamName: t.teamName,
    score: t.overallScore,
    confidence: t.confidence,
    rank: idx + 1,
  }))

  // Highest Scoring Team & Tie Detection
  const topScore = sortedTeams[0].overallScore
  const topTeams = sortedTeams.filter(
    (t) => isVal(t.overallScore) && Math.abs(t.overallScore - topScore) < tieEpsilon
  )

  const isTie = topTeams.length > 1

  const highestScoringTeam = isTie
    ? {
        type: "TIE",
        score: topScore,
        tiedTeams: topTeams.map((t) => ({
          teamCode: t.teamCode,
          teamName: t.teamName,
          score: t.overallScore,
        })),
        label: "multiple squads tied for highest evaluation score",
      }
    : {
        teamCode: sortedTeams[0].teamCode,
        teamName: sortedTeams[0].teamName,
        score: sortedTeams[0].overallScore,
        label: "highest-scoring squad in this evaluation model",
        isTie: false,
      }

  const tieStatus = {
    isTie,
    tiedTeams: topTeams.map((t) => ({
      teamCode: t.teamCode,
      teamName: t.teamName,
      score: t.overallScore,
    })),
  }

  // Score Gaps & Spread
  const highestScore = sortedTeams[0].overallScore
  const lowestScore = sortedTeams[sortedTeams.length - 1].overallScore
  const scoreSpread = round1(highestScore - lowestScore)
  const firstToSecondGap = round1(highestScore - sortedTeams[1].overallScore)

  const scoreGap = {
    highestScore,
    lowestScore,
    scoreSpread,
    firstToSecondGap,
  }

  // Category Leaders & Full Category Comparisons
  const categoryLeaders = {}
  const categoryComparison = {}

  for (const catKey of CATEGORY_KEYS) {
    const maxScore = CATEGORY_MAXIMA[catKey] || 100
    const catSorted = [...teamsList].sort((a, b) => {
      const scoreA = a.categories?.[catKey]?.score ?? 0
      const scoreB = b.categories?.[catKey]?.score ?? 0
      return scoreB - scoreA
    })

    const topCatScore = catSorted[0]?.categories?.[catKey]?.score ?? 0
    const topCatTeams = catSorted.filter(
      (t) => Math.abs((t.categories?.[catKey]?.score ?? 0) - topCatScore) < tieEpsilon
    )

    categoryLeaders[catKey] = {
      teamCode: topCatTeams.length > 1 ? "TIE" : topCatTeams[0].teamCode,
      teamName: topCatTeams.length > 1 ? "Multiple Teams" : topCatTeams[0].teamName,
      score: topCatScore,
      maximum: maxScore,
      isTie: topCatTeams.length > 1,
      teams: topCatTeams.map((t) => ({ teamCode: t.teamCode, teamName: t.teamName, score: t.categories[catKey].score })),
    }

    categoryComparison[catKey] = catSorted.map((t, idx) => ({
      teamCode: t.teamCode,
      teamName: t.teamName,
      score: t.categories?.[catKey]?.score ?? 0,
      maximum: maxScore,
      rank: idx + 1,
    }))
  }

  // Analysis & Relative Comparisons
  const analysis = {
    strongestBatting: { teamCode: categoryLeaders.batting.teamCode, teamName: categoryLeaders.batting.teamName, score: categoryLeaders.batting.score },
    strongestBowling: { teamCode: categoryLeaders.bowling.teamCode, teamName: categoryLeaders.bowling.teamName, score: categoryLeaders.bowling.score },
    strongestAllRounderGroup: { teamCode: categoryLeaders.allRounders.teamCode, teamName: categoryLeaders.allRounders.teamName, score: categoryLeaders.allRounders.score },
    strongestBalance: { teamCode: categoryLeaders.squadBalance.teamCode, teamName: categoryLeaders.squadBalance.teamName, score: categoryLeaders.squadBalance.score },
    strongestValue: { teamCode: categoryLeaders.auctionValue.teamCode, teamName: categoryLeaders.auctionValue.teamName, score: categoryLeaders.auctionValue.score },
    relativeComparisons: buildRelativeComparisonStatements(sortedTeams, categoryLeaders, isTie, firstToSecondGap),
  }

  return {
    status: "COMPLETE",
    teamCount,
    teams: sortedTeams,
    overallScores,
    highestScoringTeam,
    tieStatus,
    scoreGap,
    pairwiseDifferences: buildPairwiseDifferences(sortedTeams),
    roleCoverage: buildRoleCoverage(sortedTeams),
    purseComparison: buildPurseComparison(sortedTeams),
    categoryLeaders,
    categoryComparison,
    analysis,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSingleTeamLeaders(single) {
  const leaders = {}
  for (const catKey of CATEGORY_KEYS) {
    leaders[catKey] = {
      teamCode: single.teamCode,
      teamName: single.teamName,
      score: single.categories?.[catKey]?.score ?? 0,
      maximum: CATEGORY_MAXIMA[catKey],
      isTie: false,
    }
  }
  return leaders
}

function buildSingleTeamCategoryComparison(single) {
  const comp = {}
  for (const catKey of CATEGORY_KEYS) {
    comp[catKey] = [
      {
        teamCode: single.teamCode,
        teamName: single.teamName,
        score: single.categories?.[catKey]?.score ?? 0,
        maximum: CATEGORY_MAXIMA[catKey],
        rank: 1,
      },
    ]
  }
  return comp
}

/**
 * Pairwise absolute score gaps for every unordered team pair.
 * Sorted widest-gap-first. Deterministic: no randomness, round1 precision.
 */
export const buildPairwiseDifferences = (sortedTeams = []) => {
  const pairs = []
  for (let i = 0; i < sortedTeams.length; i++) {
    for (let j = i + 1; j < sortedTeams.length; j++) {
      const a = sortedTeams[i]
      const b = sortedTeams[j]
      pairs.push({
        teamA: a.teamCode,
        teamB: b.teamCode,
        scoreA: a.overallScore ?? 0,
        scoreB: b.overallScore ?? 0,
        gap: round1(Math.abs((a.overallScore ?? 0) - (b.overallScore ?? 0))),
      })
    }
  }
  return pairs.sort((x, y) => y.gap - x.gap || String(x.teamA).localeCompare(String(y.teamA)))
}

/**
 * Role coverage per team, reusing squadRules ROLE_TARGETS (never duplicated).
 * Reads each evaluation's roleBreakdown.roles; missing data counts as 0,
 * never crashes. Shape: { teamCode, teamName, role, current, target, gap }.
 */
export const buildRoleCoverage = (teamsList = []) => {
  const coverage = []
  for (const t of teamsList) {
    const roles = t.roleBreakdown?.roles || {}
    for (const role of ROLE_KEYS) {
      const target = SQUAD_RULES.ROLE_TARGETS[role] ?? 0
      const current = num(roles[role]) ?? 0
      coverage.push({
        teamCode: t.teamCode,
        teamName: t.teamName,
        role,
        current,
        target,
        gap: Math.max(0, target - current),
      })
    }
  }
  return coverage
}

/**
 * Purse comparison derived from each evaluation's purseAnalysis
 * (computed by Team Evaluation Engine V1 — compared here, not recalculated).
 */
export const buildPurseComparison = (sortedTeams = []) => {
  const teams = sortedTeams.map((t) => ({
    teamCode: t.teamCode,
    teamName: t.teamName,
    initialPurse: num(t.purseAnalysis?.initialPurse),
    spent: num(t.purseAnalysis?.spent) ?? 0,
    remaining: num(t.purseAnalysis?.remaining) ?? 0,
    spendingPercentage: num(t.purseAnalysis?.spendingPercentage) ?? 0,
  }))
  const bySpent = [...teams].sort((a, b) => b.spent - a.spent)
  return {
    teams,
    highestSpender: bySpent[0]?.teamCode || null,
    lowestSpender: bySpent[bySpent.length - 1]?.teamCode || null,
  }
}

function buildRelativeComparisonStatements(sortedTeams, categoryLeaders, isTie, firstToSecondGap) {
  const statements = []

  if (isTie) {
    statements.push("Top squads are tied in total evaluation score.")
  } else if (sortedTeams.length >= 2) {
    statements.push(
      `${sortedTeams[0].teamName} leads the overall evaluation model by ${firstToSecondGap} points over ${sortedTeams[1].teamName}.`
    )
  }

  if (categoryLeaders.batting) {
    statements.push(`${categoryLeaders.batting.teamName} achieves the highest batting score (${categoryLeaders.batting.score}/20).`)
  }
  if (categoryLeaders.bowling) {
    statements.push(`${categoryLeaders.bowling.teamName} achieves the highest bowling score (${categoryLeaders.bowling.score}/20).`)
  }
  if (categoryLeaders.squadBalance) {
    statements.push(`${categoryLeaders.squadBalance.teamName} demonstrates the best squad balance (${categoryLeaders.squadBalance.score}/15).`)
  }

  return statements
}
