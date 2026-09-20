/**
 * Test Suite for Team Comparison Engine V1
 *
 * Verifies all 23 test scenarios specified in the requirements:
 * 1. Three distinct teams
 * 2. Two teams
 * 3. One team
 * 4. Empty team list
 * 5. Clear highest-scoring team
 * 6. Exact score tie
 * 7. Floating-point near tie
 * 8. Category comparison
 * 9. Category leaders
 * 10. Score spread
 * 11. First-vs-second gap
 * 12. Role coverage comparison
 * 13. Purse comparison
 * 14. Valuable purchases
 * 15. Expensive purchases
 * 16. Missing price
 * 17. Missing player statistics
 * 18. Different confidence levels
 * 19. Determinism
 * 20. No input mutation
 * 21. No NaN
 * 22. No Infinity
 * 23. Scores remain within expected ranges
 *
 * Usage: node scripts/testTeamComparisonEngine.js
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { compareTeams, CATEGORY_KEYS, CATEGORY_MAXIMA } from "../src/Utils/teamComparisonEngine.js"
import { evaluateTeam, TEAM_SCORE_WEIGHTS } from "../src/Utils/teamEvaluationEngine.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const master = JSON.parse(
  readFileSync(resolve(ROOT, "src/data/players/processed/master_players.json"), "utf-8")
).players

const byRole = {
  BATTER: master.filter((p) => p.role === "BATTER" && p.ipl?.batting?.runs > 200),
  BOWLER: master.filter((p) => p.role === "BOWLER" && p.ipl?.bowling?.wickets > 10),
  ALL_ROUNDER: master.filter((p) => p.role === "ALL_ROUNDER" && p.ipl?.batting?.runs > 100),
  WICKET_KEEPER: master.filter((p) => p.role === "WICKET_KEEPER"),
}

let fails = 0
const ok = (cond, msg) => {
  console.log(`${cond ? "ok: " : "FAIL: "}${msg}`)
  if (!cond) fails++
}

console.log("==================================================")
console.log("RUNNING TEAM COMPARISON ENGINE V1 TEST SUITE")
console.log("==================================================\n")

const buildSquad = (bCount, bwCount, arCount, wkCount, price = 2.0) => [
  ...byRole.BATTER.slice(0, bCount),
  ...byRole.BOWLER.slice(0, bwCount),
  ...byRole.ALL_ROUNDER.slice(0, arCount),
  ...byRole.WICKET_KEEPER.slice(0, wkCount),
].map((p, idx) => ({ ...p, soldPrice: price + (idx % 2) }))

const teamA = evaluateTeam({ teamCode: "CSK", squad: buildSquad(5, 5, 4, 2, 2.0), purse: 20.0 })
const teamB = evaluateTeam({ teamCode: "MI", squad: buildSquad(8, 2, 2, 1, 3.0), purse: 10.0 })
const teamC = evaluateTeam({ teamCode: "RCB", squad: buildSquad(2, 8, 2, 1, 1.5), purse: 30.0 })

// ---------------------------------------------------------------------------
// Scenario 1: Three Distinct Teams
// ---------------------------------------------------------------------------
const comp3 = compareTeams([teamA, teamB, teamC])
ok(comp3.status === "COMPLETE", "1. Status is COMPLETE")
ok(comp3.teamCount === 3, "1. teamCount is 3")
ok(comp3.overallScores.length === 3, "1. overallScores array length is 3")

// ---------------------------------------------------------------------------
// Scenario 2: Two Teams
// ---------------------------------------------------------------------------
const comp2 = compareTeams([teamA, teamB])
ok(comp2.teamCount === 2, "2. teamCount is 2")

// ---------------------------------------------------------------------------
// Scenario 3: One Team
// ---------------------------------------------------------------------------
const comp1 = compareTeams([teamA])
ok(comp1.teamCount === 1, "3. teamCount is 1")
ok(comp1.highestScoringTeam.teamCode === "CSK", "3. Single team is highest scoring")

// ---------------------------------------------------------------------------
// Scenario 4: Empty Team List
// ---------------------------------------------------------------------------
const compEmpty = compareTeams([])
ok(compEmpty.status === "INSUFFICIENT_DATA", "4. Empty input returns INSUFFICIENT_DATA")
ok(compEmpty.teamCount === 0, "4. teamCount is 0")

// ---------------------------------------------------------------------------
// Scenario 5: Clear Highest-Scoring Team
// ---------------------------------------------------------------------------
ok(comp3.highestScoringTeam.teamCode === comp3.overallScores[0].teamCode, `5. Highest scoring team matches rank 1 (${comp3.highestScoringTeam.teamCode})`)
ok(comp3.highestScoringTeam.label.includes("highest-scoring squad"), "5. Neutral model label used")

// ---------------------------------------------------------------------------
// Scenario 6: Exact Score Tie
// ---------------------------------------------------------------------------
const teamATie = { ...teamA, teamCode: "CSK_TIE", teamName: "CSK Tie Squad" }
const compTie = compareTeams([teamA, teamATie])
ok(compTie.tieStatus.isTie === true, "6. Exact tie detected")
ok(compTie.highestScoringTeam.type === "TIE", "6. highestScoringTeam type is TIE")

// ---------------------------------------------------------------------------
// Scenario 7: Floating-Point Near Tie
// ---------------------------------------------------------------------------
const teamANear = { ...teamA, teamCode: "CSK_NEAR", teamName: "CSK Near Squad", overallScore: teamA.overallScore + 0.001 }
const compNearTie = compareTeams([teamA, teamANear])
ok(compNearTie.tieStatus.isTie === true, "7. Floating-point near tie detected (<0.01 precision)")

// ---------------------------------------------------------------------------
// Scenario 8: Category Comparison
// ---------------------------------------------------------------------------
ok(Object.keys(comp3.categoryComparison).length === 8, "8. All 8 categories present in categoryComparison")
ok(comp3.categoryComparison.batting.length === 3, "8. Batting category contains all 3 teams")

// ---------------------------------------------------------------------------
// Scenario 9: Category Leaders
// ---------------------------------------------------------------------------
ok(comp3.categoryLeaders.batting.score >= comp3.categoryLeaders.bowling.score || comp3.categoryLeaders.batting.teamCode !== null, `9. Batting leader identified (${comp3.categoryLeaders.batting.teamCode}, score ${comp3.categoryLeaders.batting.score})`)
ok(comp3.categoryLeaders.bowling.teamCode === "RCB", `9. RCB leads bowling category (${comp3.categoryLeaders.bowling.score})`)

// ---------------------------------------------------------------------------
// Scenario 10: Score Spread
// ---------------------------------------------------------------------------
ok(typeof comp3.scoreGap.scoreSpread === "number", `10. Score spread calculated (${comp3.scoreGap.scoreSpread})`)

// ---------------------------------------------------------------------------
// Scenario 11: First-vs-Second Gap
// ---------------------------------------------------------------------------
ok(comp3.scoreGap.firstToSecondGap >= 0, `11. First to second gap calculated (${comp3.scoreGap.firstToSecondGap})`)

// ---------------------------------------------------------------------------
// Scenario 12: Role Coverage Comparison
// ---------------------------------------------------------------------------
ok(teamA.roleBreakdown.batters === 5, "12. Role counts preserved in team evaluations")

// ---------------------------------------------------------------------------
// Scenario 13: Purse Comparison
// ---------------------------------------------------------------------------
ok(teamA.purseAnalysis.remaining === 20.0, "13. Purse remaining preserved")

// ---------------------------------------------------------------------------
// Scenario 14: Valuable Purchases
// ---------------------------------------------------------------------------
ok(Array.isArray(teamA.valuablePurchases), "14. Valuable purchases array present in team evaluation")

// ---------------------------------------------------------------------------
// Scenario 15: Expensive Purchases
// ---------------------------------------------------------------------------
ok(Array.isArray(teamB.expensivePurchases), "15. Expensive purchases array present in team evaluation")

// ---------------------------------------------------------------------------
// Scenario 16: Missing Price
// ---------------------------------------------------------------------------
const noPriceSquad = buildSquad(5, 5, 4, 2).map((p) => ({ ...p, soldPrice: null }))
const noPriceEval = evaluateTeam({ teamCode: "NOPRICE", squad: noPriceSquad })
const compNoPrice = compareTeams([noPriceEval, teamA])
ok(compNoPrice.status === "COMPLETE", "16. Comparison handles team with missing prices cleanly")

// ---------------------------------------------------------------------------
// Scenario 17: Missing Player Statistics
// ---------------------------------------------------------------------------
const rookieSquad = master.slice(0, 10).map((p) => ({ ...p, ipl: { batting: {}, bowling: {} } }))
const rookieEval = evaluateTeam({ teamCode: "ROOKIE", squad: rookieSquad })
const compRookie = compareTeams([rookieEval, teamA])
ok(compRookie.status === "COMPLETE", "17. Comparison handles team with missing player statistics cleanly")

// ---------------------------------------------------------------------------
// Scenario 18: Different Confidence Levels
// ---------------------------------------------------------------------------
ok(compRookie.overallScores[0].confidence !== undefined, "18. Team confidence preserved in overallScores")

// ---------------------------------------------------------------------------
// Scenario 19: Determinism
// ---------------------------------------------------------------------------
const compRun1 = compareTeams([teamA, teamB, teamC])
const compRun2 = compareTeams([teamA, teamB, teamC])
ok(JSON.stringify(compRun1) === JSON.stringify(compRun2), "19. Identical input produces identical JSON comparison output")

// ---------------------------------------------------------------------------
// Scenario 20: No Input Mutation
// ---------------------------------------------------------------------------
const teamACopy = JSON.stringify(teamA)
compareTeams([teamA, teamB, teamC])
ok(JSON.stringify(teamA) === teamACopy, "20. Input team evaluation objects remain unmutated")

// ---------------------------------------------------------------------------
// Scenario 21 & 22: No NaN or Infinity
// ---------------------------------------------------------------------------
const jsonStr = JSON.stringify(comp3)
ok(!jsonStr.includes("NaN") && !jsonStr.includes("Infinity"), "21 & 22. No NaN or Infinity in output payload")

// ---------------------------------------------------------------------------
// Scenario 23: Scores Remain Within Expected Ranges
// ---------------------------------------------------------------------------
ok(comp3.overallScores.every((t) => t.score >= 0 && t.score <= 100), "23. All overall scores within [0, 100]")

// ---------------------------------------------------------------------------
// Scenario 24: Role Coverage From Comparison Output
// ---------------------------------------------------------------------------
ok(Array.isArray(comp3.roleCoverage) && comp3.roleCoverage.length === 3 * 4, `24. Role coverage has 12 entries (${comp3.roleCoverage.length})`)
const cskBat = comp3.roleCoverage.find((r) => r.teamCode === "CSK" && r.role === "BATTER")
ok(cskBat && cskBat.current === 5 && cskBat.target === 5 && cskBat.gap === 0, `24. CSK batter coverage {current 5, target 5, gap 0}`)
ok(comp3.roleCoverage.every((r) => "teamCode" in r && "role" in r && "current" in r && "target" in r && "gap" in r), "24. Role coverage entry shape")

// ---------------------------------------------------------------------------
// Scenario 25: Purse Comparison From Comparison Output
// ---------------------------------------------------------------------------
ok(comp3.purseComparison.teams.length === 3, "25. Purse comparison covers 3 teams")
ok(comp3.purseComparison.highestSpender !== null && comp3.purseComparison.lowestSpender !== null, `25. Spenders identified (${comp3.purseComparison.highestSpender}/${comp3.purseComparison.lowestSpender})`)

// ---------------------------------------------------------------------------
// Scenario 26: Pairwise Differences
// ---------------------------------------------------------------------------
ok(comp3.pairwiseDifferences.length === 3, `26. 3 unordered pairs for 3 teams (${comp3.pairwiseDifferences.length})`)
ok(comp3.pairwiseDifferences.every((p) => p.gap >= 0 && p.teamA !== p.teamB), "26. Pairwise gaps non-negative, distinct teams")
ok(compareTeams([teamA]).pairwiseDifferences.length === 0, "26. No pairs for single team")

// ---------------------------------------------------------------------------
// Scenario 27: Category Maxima Reused From Team Evaluation Engine
// ---------------------------------------------------------------------------
ok(JSON.stringify(CATEGORY_MAXIMA) === JSON.stringify(TEAM_SCORE_WEIGHTS), "27. Maxima identical to Team Evaluation weights (no duplicate constants)")

// ---------------------------------------------------------------------------
// Scenario 28: Valuable/Expensive Purchases Flow Through Comparison Teams
// ---------------------------------------------------------------------------
ok(Array.isArray(comp3.teams[0].valuablePurchases) && Array.isArray(comp3.teams[0].expensivePurchases), "28. Purchase classifications preserved on comparison teams")

console.log("\n==================================================")
console.log(fails ? `TEST SUITE COMPLETED WITH ${fails} FAILURES` : "ALL TEAM COMPARISON ENGINE V1 TESTS PASSED PERFECTLY!")
console.log("==================================================")

process.exit(fails ? 1 : 0)
