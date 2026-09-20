/**
 * Test Suite for Team Evaluation Engine V1
 *
 * Verifies all 25 test scenarios specified in the requirements:
 * 1. Balanced squad
 * 2. Batting-heavy squad
 * 3. Bowling-heavy squad
 * 4. All-rounder-heavy squad
 * 5. Missing wicketkeeper
 * 6. One wicketkeeper
 * 7. Two wicketkeepers
 * 8. Too few bowlers
 * 9. Too few batters
 * 10. Too few all-rounders
 * 11. Overseas-heavy squad
 * 12. No overseas players
 * 13. Strong value purchases
 * 14. Expensive purchases relative to model value
 * 15. Full purse
 * 16. Remaining purse
 * 17. Minimum valid squad
 * 18. Maximum valid squad
 * 19. Missing player statistics
 * 20. null vs zero
 * 21. Deterministic repeated evaluation
 * 22. Confidence calculation
 * 23. Strength generation
 * 24. Weakness generation
 * 25. Missing-role detection
 *
 * Usage: node scripts/testTeamEvaluationEngine.js
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  evaluateTeam,
  TEAM_SCORE_WEIGHTS,
  normalizeTeamInput,
  evaluateTeamBatting,
  evaluateTeamBowling,
  evaluateTeamAllRounders,
  evaluateSquadBalance,
  evaluateTeamPlayerQuality,
  evaluateTeamOverseasBalance,
  evaluateTeamWicketKeeping,
  evaluateTeamAuctionValue,
  generateTeamStrengthsAndWeaknesses,
  detectMissingRoles,
} from "../src/Utils/teamEvaluationEngine.js"
import { evaluatePlayerV2 } from "../src/Utils/playerValueEngine.js"

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
console.log("RUNNING TEAM EVALUATION ENGINE V1 TEST SUITE")
console.log("==================================================\n")

// ---------------------------------------------------------------------------
// Helper squad builder
// ---------------------------------------------------------------------------
const buildTestSquad = (bCount = 5, bwCount = 5, arCount = 4, wkCount = 2, extraPrice = 2.0) => {
  const squad = [
    ...byRole.BATTER.slice(0, bCount),
    ...byRole.BOWLER.slice(0, bwCount),
    ...byRole.ALL_ROUNDER.slice(0, arCount),
    ...byRole.WICKET_KEEPER.slice(0, wkCount),
  ].map((p, idx) => ({ ...p, soldPrice: extraPrice + (idx % 3) }))

  return squad
}

// ---------------------------------------------------------------------------
// Scenario 1: Balanced Squad
// ---------------------------------------------------------------------------
const balancedSquad = buildTestSquad(5, 5, 4, 2)
const balancedEval = evaluateTeam({ teamCode: "CSK", squad: balancedSquad, purse: 20.0, initialPurse: 120.0 })
ok(balancedEval.overallScore > 60, `1. Balanced squad score is healthy (${balancedEval.overallScore})`)
ok(balancedEval.missingRoles.length === 0, "1. No missing roles for balanced target squad")
ok(balancedEval.squadSize === 16, "1. Squad size correct")

// ---------------------------------------------------------------------------
// Scenario 2: Batting-Heavy Squad
// ---------------------------------------------------------------------------
const batHeavySquad = buildTestSquad(10, 2, 2, 1)
const batHeavyEval = evaluateTeam({ teamCode: "MI", squad: batHeavySquad, purse: 10.0 })
ok(batHeavyEval.categories.batting.score > batHeavyEval.categories.bowling.score, `2. Batting category (${batHeavyEval.categories.batting.score}) > Bowling category (${batHeavyEval.categories.bowling.score})`)
ok(batHeavyEval.weaknesses.includes("Too few specialist bowlers"), "2. Detects too few specialist bowlers weakness")

// ---------------------------------------------------------------------------
// Scenario 3: Bowling-Heavy Squad
// ---------------------------------------------------------------------------
const bowlHeavySquad = buildTestSquad(2, 10, 2, 1)
const bowlHeavyEval = evaluateTeam({ teamCode: "RCB", squad: bowlHeavySquad, purse: 15.0 })
ok(bowlHeavyEval.categories.bowling.score > bowlHeavyEval.categories.batting.score, `3. Bowling category (${bowlHeavyEval.categories.bowling.score}) > Batting category (${bowlHeavyEval.categories.batting.score})`)
ok(bowlHeavyEval.weaknesses.includes("Too few specialist batters"), "3. Detects too few specialist batters weakness")

// ---------------------------------------------------------------------------
// Scenario 4: All-Rounder-Heavy Squad
// ---------------------------------------------------------------------------
const arHeavySquad = buildTestSquad(3, 3, 8, 1)
const arHeavyEval = evaluateTeam({ teamCode: "KKR", squad: arHeavySquad, purse: 10.0 })
ok(arHeavyEval.categories.allRounders.score > 10, `4. All-rounder category score high (${arHeavyEval.categories.allRounders.score})`)

// ---------------------------------------------------------------------------
// Scenario 5: Missing Wicketkeeper
// ---------------------------------------------------------------------------
const noWkSquad = buildTestSquad(5, 5, 4, 0)
const noWkEval = evaluateTeam({ teamCode: "SRH", squad: noWkSquad, purse: 15.0 })
ok(noWkEval.roleBreakdown.wicketKeepers === 0, "5. Wicketkeeper count is 0")
ok(noWkEval.weaknesses.includes("No recognised wicketkeepers in squad"), "5. No WK weakness generated")
ok(noWkEval.missingRoles.some((r) => r.role === "WICKET_KEEPER" && r.status === "MISSING"), "5. Missing WK role detected")

// ---------------------------------------------------------------------------
// Scenario 6: One Wicketkeeper
// ---------------------------------------------------------------------------
const oneWkSquad = buildTestSquad(5, 5, 4, 1)
const oneWkEval = evaluateTeam({ teamCode: "DC", squad: oneWkSquad, purse: 15.0 })
ok(oneWkEval.roleBreakdown.wicketKeepers === 1, "6. Single WK count is 1")
ok(oneWkEval.weaknesses.includes("Only one recognised wicketkeeper (lack of backup)"), "6. Single WK backup weakness generated")

// ---------------------------------------------------------------------------
// Scenario 7: Two Wicketkeepers
// ---------------------------------------------------------------------------
const twoWkSquad = buildTestSquad(5, 5, 4, 2)
const twoWkEval = evaluateTeam({ teamCode: "RR", squad: twoWkSquad, purse: 15.0 })
ok(twoWkEval.roleBreakdown.wicketKeepers === 2, "7. Two WKs present")
ok(twoWkEval.categories.wicketKeeping.score >= 4.0, `7. Wicketkeeping category score high (${twoWkEval.categories.wicketKeeping.score})`)

// ---------------------------------------------------------------------------
// Scenario 8: Too Few Bowlers
// ---------------------------------------------------------------------------
const fewBowlersEval = evaluateTeam({ teamCode: "PBKS", squad: buildTestSquad(6, 2, 4, 2), purse: 10.0 })
ok(fewBowlersEval.missingRoles.some((r) => r.role === "BOWLER" && r.gap >= 3), "8. Bowler deficit gap detected")

// ---------------------------------------------------------------------------
// Scenario 9: Too Few Batters
// ---------------------------------------------------------------------------
const fewBattersEval = evaluateTeam({ teamCode: "GT", squad: buildTestSquad(2, 6, 4, 2), purse: 10.0 })
ok(fewBattersEval.missingRoles.some((r) => r.role === "BATTER" && r.gap >= 3), "9. Batter deficit gap detected")

// ---------------------------------------------------------------------------
// Scenario 10: Too Few All-Rounders
// ---------------------------------------------------------------------------
const fewArEval = evaluateTeam({ teamCode: "LSG", squad: buildTestSquad(6, 6, 1, 2), purse: 10.0 })
ok(fewArEval.missingRoles.some((r) => r.role === "ALL_ROUNDER" && r.gap >= 3), "10. All-rounder deficit gap detected")

// ---------------------------------------------------------------------------
// Scenario 11: Overseas-Heavy Squad
// ---------------------------------------------------------------------------
const overseasPlayers = master.filter((p) => p.isOverseas === true).slice(0, 9)
const overHeavyEval = evaluateTeam({ teamCode: "CSK", squad: overseasPlayers, purse: 10.0 })
ok(overHeavyEval.squadComposition.overseasPlayers === 9, "11. Overseas count is 9")
ok(overHeavyEval.categories.squadBalance.score < 10, "11. Imbalance penalty applied for >8 overseas")

// ---------------------------------------------------------------------------
// Scenario 12: No Overseas Players
// ---------------------------------------------------------------------------
const indianPlayers = master.filter((p) => p.isOverseas === false).slice(0, 15)
const noOverseasEval = evaluateTeam({ teamCode: "MI", squad: indianPlayers, purse: 20.0 })
ok(noOverseasEval.squadComposition.overseasPlayers === 0, "12. 0 overseas players in squad")
ok(noOverseasEval.weaknesses.includes("No overseas players in squad"), "12. No overseas weakness generated")

// ---------------------------------------------------------------------------
// Scenario 13: Strong Value Purchases
// ---------------------------------------------------------------------------
const bargainSquad = balancedSquad.map((p) => ({ ...p, soldPrice: 0.5 }))
const bargainEval = evaluateTeam({ teamCode: "RCB", squad: bargainSquad, purse: 50.0 })
ok(bargainEval.valuablePurchases.length > 0, `13. Valuable purchases detected (${bargainEval.valuablePurchases.length})`)
ok(bargainEval.categories.auctionValue.score >= 7.0, `13. Auction value category score high (${bargainEval.categories.auctionValue.score})`)

// ---------------------------------------------------------------------------
// Scenario 14: Expensive Purchases Relative to Model Value
// ---------------------------------------------------------------------------
const priceySquad = balancedSquad.map((p, i) => ({ ...p, soldPrice: i === 0 ? 18.0 : 2.0 }))
const priceyEval = evaluateTeam({ teamCode: "KKR", squad: priceySquad, purse: 5.0 })
ok(priceyEval.expensivePurchases.length >= 1, `14. Expensive purchase identified (${priceyEval.expensivePurchases.length})`)
ok(priceyEval.expensivePurchases[0].note === "high-cost relative to model value", "14. Neutral wording note used")

// ---------------------------------------------------------------------------
// Scenario 15: Full Purse (0 spent)
// ---------------------------------------------------------------------------
const fullPurseSquad = balancedSquad.map((p) => ({ ...p, soldPrice: 0 }))
const fullPurseEval = evaluateTeam({ teamCode: "SRH", squad: fullPurseSquad, purse: 120.0, initialPurse: 120.0 })
ok(fullPurseEval.purseAnalysis.spent === 0, "15. Spent purse is 0")
ok(fullPurseEval.purseAnalysis.remaining === 120.0, "15. Remaining purse is 120.0")

// ---------------------------------------------------------------------------
// Scenario 16: Remaining Purse Calculation
// ---------------------------------------------------------------------------
const remPurseEval = evaluateTeam({ teamCode: "DC", squad: balancedSquad, purse: 35.5 })
ok(remPurseEval.purseAnalysis.remaining === 35.5, `16. Remaining purse verified (${remPurseEval.purseAnalysis.remaining})`)
ok(remPurseEval.purseAnalysis.spent + remPurseEval.purseAnalysis.remaining === remPurseEval.purseAnalysis.initialPurse, `16. spent (${remPurseEval.purseAnalysis.spent}) + remaining (${remPurseEval.purseAnalysis.remaining}) === initialPurse (${remPurseEval.purseAnalysis.initialPurse}) invariant`)

// ---------------------------------------------------------------------------
// Scenario 17: Minimum Valid Squad (18 players)
// ---------------------------------------------------------------------------
const minSquad = master.slice(0, 18).map((p) => ({ ...p, soldPrice: 2.0 }))
const minEval = evaluateTeam({ teamCode: "RR", squad: minSquad, purse: 20.0 })
ok(minEval.squadSize === 18, "17. Squad size 18 verified")
ok(minEval.categories.squadBalance.sizeRating === 100, "17. Minimum squad size sizeRating is 100")

// ---------------------------------------------------------------------------
// Scenario 18: Maximum Valid Squad (25 players)
// ---------------------------------------------------------------------------
const maxSquad = master.slice(0, 25).map((p) => ({ ...p, soldPrice: 1.5 }))
const maxEval = evaluateTeam({ teamCode: "PBKS", squad: maxSquad, purse: 10.0 })
ok(maxEval.squadSize === 25, "18. Squad size 25 verified")
ok(maxEval.categories.squadBalance.sizeRating === 100, "18. Maximum squad size sizeRating is 100")

// ---------------------------------------------------------------------------
// Scenario 19: Missing Player Statistics (uncapped / rookie players)
// ---------------------------------------------------------------------------
const rookieSquad = [
  ...balancedSquad.slice(0, 10),
  { id: "rookie-1", name: "Rookie 1", role: "BATTER", ipl: { batting: {}, bowling: {} } },
  { id: "rookie-2", name: "Rookie 2", role: "BOWLER", ipl: { batting: {}, bowling: {} } },
]
const rookieEval = evaluateTeam({ teamCode: "GT", squad: rookieSquad, purse: 25.0 })
ok(rookieEval.confidence < balancedEval.confidence, `19. Rookie squad confidence (${rookieEval.confidence}) lower than complete squad (${balancedEval.confidence})`)

// ---------------------------------------------------------------------------
// Scenario 20: null vs zero handling in team evaluation
// ---------------------------------------------------------------------------
const zeroStatsPlayer = { id: "zero-bowler", name: "Zero Bowler", role: "BOWLER", ipl: { bowling: { wickets: 0, balls: 24 } } }
const nullStatsPlayer = { id: "null-bowler", name: "Null Bowler", role: "BOWLER", ipl: { bowling: { wickets: null, balls: null } } }
const zeroTeamEval = evaluateTeam({ squad: [zeroStatsPlayer] })
const nullTeamEval = evaluateTeam({ squad: [nullStatsPlayer] })
ok(zeroTeamEval.categories.bowling.score >= 0, "20. Zero stats bowler evaluated")
ok(nullTeamEval.categories.bowling.score === 0, "20. Null stats bowler contributes 0 to bowling quality")

// ---------------------------------------------------------------------------
// Scenario 21: Deterministic Repeated Evaluation
// ---------------------------------------------------------------------------
const run1 = evaluateTeam({ teamCode: "LSG", squad: balancedSquad, purse: 20.0 })
const run2 = evaluateTeam({ teamCode: "LSG", squad: balancedSquad, purse: 20.0 })
ok(JSON.stringify(run1) === JSON.stringify(run2), "21. Identical squad input produces identical evaluation output")

// ---------------------------------------------------------------------------
// Scenario 22: Confidence Calculation
// ---------------------------------------------------------------------------
ok(typeof balancedEval.confidence === "number", `22. Team confidence calculated (${balancedEval.confidence})`)
ok(balancedEval.confidence >= 0.0 && balancedEval.confidence <= 1.0, "22. Confidence within [0, 1]")

// ---------------------------------------------------------------------------
// Scenario 23: Strength Generation
// ---------------------------------------------------------------------------
ok(Array.isArray(balancedEval.strengths), "23. Strengths is an array")
console.log("   Strengths:", balancedEval.strengths)

// ---------------------------------------------------------------------------
// Scenario 24: Weakness Generation
// ---------------------------------------------------------------------------
ok(Array.isArray(batHeavyEval.weaknesses), "24. Weaknesses is an array")
console.log("   Weaknesses:", batHeavyEval.weaknesses)

// ---------------------------------------------------------------------------
// Scenario 25: Missing Role Detection
// ---------------------------------------------------------------------------
const missingRoleList = noWkEval.missingRoles
ok(missingRoleList.length > 0, `25. Missing roles array contains ${missingRoleList.length} items`)
ok(missingRoleList.some((r) => r.role === "WICKET_KEEPER"), "25. WICKET_KEEPER correctly identified in missing roles")

// ---------------------------------------------------------------------------
// Numerical Invariant Audits
// ---------------------------------------------------------------------------
ok(balancedEval.overallScore >= 0 && balancedEval.overallScore <= 100, `Invariant: Total score (${balancedEval.overallScore}) within 0-100`)
const weightsSum = Object.values(TEAM_SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
ok(weightsSum === 100, `Invariant: TEAM_SCORE_WEIGHTS sum (${weightsSum}) equals 100`)

console.log("\n==================================================")
console.log(fails ? `TEST SUITE COMPLETED WITH ${fails} FAILURES` : "ALL TEAM EVALUATION ENGINE V1 TESTS PASSED PERFECTLY!")
console.log("==================================================")

process.exit(fails ? 1 : 0)
