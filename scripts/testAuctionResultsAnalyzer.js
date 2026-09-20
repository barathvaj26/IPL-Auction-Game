/**
 * Test Suite for Auction Results Analyzer V1
 *
 * Verifies all 7 test scenarios specified in section 21:
 * 1. Completed auction
 * 2. Incomplete auction
 * 3. Empty auction
 * 4. Multiple teams
 * 5. Missing auction history
 * 6. Missing prices
 * 7. Missing statistics
 *
 * Usage: node scripts/testAuctionResultsAnalyzer.js
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { analyzeAuctionResults } from "../src/Utils/auctionResultsAnalyzer.js"
import { evaluateTeam } from "../src/Utils/teamEvaluationEngine.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const master = JSON.parse(
  readFileSync(resolve(ROOT, "src/data/players/processed/master_players.json"), "utf-8")
).players

let fails = 0
const ok = (cond, msg) => {
  console.log(`${cond ? "ok: " : "FAIL: "}${msg}`)
  if (!cond) fails++
}

console.log("==================================================")
console.log("RUNNING AUCTION RESULTS ANALYZER V1 TEST SUITE")
console.log("==================================================\n")

const squadCSK = master.slice(0, 18).map((p, i) => ({ ...p, soldPrice: 2.0 + (i % 3) }))
const squadMI = master.slice(18, 36).map((p, i) => ({ ...p, soldPrice: 1.5 + (i % 4) }))
const squadRCB = master.slice(36, 54).map((p, i) => ({ ...p, soldPrice: 3.0 + (i % 2) }))

// ---------------------------------------------------------------------------
// Scenario 1: Completed Auction (3 full squads of 18+ players)
// ---------------------------------------------------------------------------
const completedState = {
  // Purses reconcile exactly: CSK spent 54 + 66, MI spent 52 + 68, RCB spent 63 + 57
  teamSquads: { CSK: squadCSK, MI: squadMI, RCB: squadRCB },
  teamPurses: { CSK: 66.0, MI: 68.0, RCB: 57.0 },
  initialBudget: 120.0,
}
const completedAnalysis = analyzeAuctionResults(completedState)
ok(completedAnalysis.status === "COMPLETE", "1. Status is COMPLETE for 3 full squads")
ok(completedAnalysis.summary.totalPlayersSold === 54, `1. Total players sold is 54 (${completedAnalysis.summary.totalPlayersSold})`)
ok(completedAnalysis.summary.totalSpent > 0, `1. Total spent calculated (${completedAnalysis.summary.totalSpent})`)
ok(completedAnalysis.highestScoringTeam !== null, `1. Highest scoring team identified (${completedAnalysis.highestScoringTeam.teamCode})`)

// ---------------------------------------------------------------------------
// Scenario 2: Incomplete Auction (partial squads)
// ---------------------------------------------------------------------------
const incompleteState = {
  teamSquads: { CSK: squadCSK.slice(0, 5), MI: squadMI.slice(0, 4) },
  teamPurses: { CSK: 100.0, MI: 105.0 },
}
const incompleteAnalysis = analyzeAuctionResults(incompleteState)
ok(incompleteAnalysis.status === "PARTIAL", "2. Status is PARTIAL for incomplete squads")
ok(incompleteAnalysis.summary.totalPlayersSold === 9, "2. Total players sold is 9")

// ---------------------------------------------------------------------------
// Scenario 3: Empty Auction
// ---------------------------------------------------------------------------
const emptyAnalysis = analyzeAuctionResults({})
ok(emptyAnalysis.status === "INSUFFICIENT_DATA", "3. Empty auction returns INSUFFICIENT_DATA")
ok(emptyAnalysis.summary.totalPlayersSold === 0, "3. Total players sold is 0")

// ---------------------------------------------------------------------------
// Scenario 4: Multiple Teams Analysis
// ---------------------------------------------------------------------------
ok(Object.keys(completedAnalysis.teamEvaluations).length === 3, "4. Multiple team evaluations present")
ok(completedAnalysis.comparison.teamCount === 3, "4. Comparison engine ran on all 3 teams")

// ---------------------------------------------------------------------------
// Scenario 5: Missing Auction History
// ---------------------------------------------------------------------------
const noHistoryState = { teamSquads: { CSK: squadCSK }, auctionHistory: null }
const noHistoryAnalysis = analyzeAuctionResults(noHistoryState)
ok(noHistoryAnalysis.summary.totalPlayersSold === 18, "5. Works cleanly without auctionHistory array")

// ---------------------------------------------------------------------------
// Scenario 6: Missing Prices
// ---------------------------------------------------------------------------
const noPriceSquad = squadCSK.map((p) => ({ ...p, soldPrice: null }))
const noPriceAnalysis = analyzeAuctionResults({ teamSquads: { CSK: noPriceSquad } })
ok(noPriceAnalysis.summary.totalSpent === 0, "6. Handles missing prices safely (totalSpent 0)")
ok(noPriceAnalysis.summary.averagePrice === 0, "6. Average price is 0 when prices missing")

// ---------------------------------------------------------------------------
// Scenario 7: Missing Statistics
// ---------------------------------------------------------------------------
const rookieSquad = master.slice(0, 18).map((p) => ({ ...p, ipl: { batting: {}, bowling: {} } }))
const rookieAnalysis = analyzeAuctionResults({ teamSquads: { ROOKIE: rookieSquad } })
ok(rookieAnalysis.teamEvaluations.ROOKIE !== undefined, "7. Handles squad with missing stats cleanly")

// ---------------------------------------------------------------------------
// Scenario 8: Duplicate Unsold Protection
// ---------------------------------------------------------------------------
const dupUnsold = [...master.slice(60, 66), ...master.slice(60, 66), ...master.slice(66, 68)]
const dupUnsoldAnalysis = analyzeAuctionResults({
  teamSquads: { CSK: squadCSK },
  unsoldPlayers: dupUnsold.map((p) => ({ player: p })),
})
ok(dupUnsoldAnalysis.summary.unsoldPlayerCount === 8, `8. Duplicate unsold deduplicated to 8 (${dupUnsoldAnalysis.summary.unsoldPlayerCount})`)
ok(dupUnsoldAnalysis.unsold.length === 8, "8. Top-level unsold array deduplicated")
ok(dupUnsoldAnalysis.summary.totalPlayersAuctioned === 18 + 8, `8. Total auctioned = sold + deduped unsold (${dupUnsoldAnalysis.summary.totalPlayersAuctioned})`)

// ---------------------------------------------------------------------------
// Scenario 9: Per-Team Purchase Counts + Purse Verification
// ---------------------------------------------------------------------------
ok(completedAnalysis.summary.perTeamPurchases.length === 3, "9. Per-team purchase counts for 3 teams")
ok(completedAnalysis.summary.perTeamPurchases.every((t) => t.count === 18), "9. Each team bought 18")
ok(completedAnalysis.spending.spendingList.every((t) => t.purseBalanced === true), "9. spent + remaining balances to initial purse")
ok(completedAnalysis.spending.spendingList.every((t) => "initialPurse" in t && "spent" in t && "remaining" in t && "spendingPercentage" in t), "9. Purse entry shape")

// ---------------------------------------------------------------------------
// Scenario 10: Purchase Enrichment (fairPrice / ratio / valueForMoney)
// ---------------------------------------------------------------------------
const allClassified = [...completedAnalysis.purchases.valuablePurchases, ...completedAnalysis.purchases.expensivePurchases]
ok(allClassified.length > 0, `10. Classified purchases present (${allClassified.length})`)
ok(allClassified.every((p) => "purchasePrice" in p && "fairPrice" in p && "ratio" in p && "valueForMoney" in p && "teamCode" in p), "10. Purchase entry shape")
ok(completedAnalysis.purchases.expensivePurchases.every((p) => p.ratio === null || p.ratio <= 0.67), "10. Expensive threshold ratio <= 0.67")
ok(completedAnalysis.purchases.valuablePurchases.every((p) => p.ratio === null || p.ratio >= 1.1), "10. Valuable threshold ratio >= 1.1")

// ---------------------------------------------------------------------------
// Scenario 11: Exact Tie Between Two Identical Squads
// ---------------------------------------------------------------------------
const tieAnalysis = analyzeAuctionResults({
  teamSquads: { CSK: squadCSK, MI: squadCSK.map((p) => ({ ...p })) },
  teamPurses: { CSK: 30.0, MI: 30.0 },
  initialBudget: 120.0,
})
ok(tieAnalysis.tieStatus.isTie === true, "11. Identical squads produce a tie")
ok(tieAnalysis.highestScoringTeam.type === "TIE", "11. Highest-scoring team type is TIE")

// ---------------------------------------------------------------------------
// Scenario 12: Single Team + Determinism + No NaN
// ---------------------------------------------------------------------------
const singleAnalysis = analyzeAuctionResults({ teamSquads: { CSK: squadCSK }, teamPurses: { CSK: 30.0 } })
ok(singleAnalysis.comparison.teamCount === 1, "12. Single team comparison")
const runA = JSON.stringify(analyzeAuctionResults(completedState))
const runB = JSON.stringify(analyzeAuctionResults(completedState))
ok(runA === runB, "12. Deterministic output")
ok(!runA.includes("NaN") && !runA.includes("Infinity"), "12. No NaN or Infinity")

// ---------------------------------------------------------------------------
// Scenario 13: result shape per spec §6
// ---------------------------------------------------------------------------
for (const k of ["teamEvaluations", "comparison", "spending", "purchases", "roleCoverage", "unsold", "highestScoringTeam", "tieStatus"]) {
  ok(k in completedAnalysis, `13. Result contains ${k}`)
}

console.log("\n==================================================")
console.log(fails ? `TEST SUITE COMPLETED WITH ${fails} FAILURES` : "ALL AUCTION RESULTS ANALYZER V1 TESTS PASSED PERFECTLY!")
console.log("==================================================")

process.exit(fails ? 1 : 0)
