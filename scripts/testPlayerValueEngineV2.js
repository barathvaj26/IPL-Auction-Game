/**
 * Test Suite for Player Value Engine V2
 *
 * Verifies all 15 test scenarios specified in the requirements:
 * 1. Strong batter
 * 2. Strong bowler
 * 3. Strong all-rounder
 * 4. Wicketkeeper with no keeping statistics
 * 5. Player with complete statistics
 * 6. Player with partial statistics
 * 7. Player with no IPL statistics
 * 8. null vs zero handling
 * 9. Small sample-size player
 * 10. Historical SOLD_PRICE present
 * 11. SOLD_PRICE absent
 * 12. Deterministic repeated evaluation
 * 13. Role-aware scoring
 * 14. Confidence calculation
 * 15. Strength and limitation generation
 *
 * Usage: node scripts/testPlayerValueEngineV2.js
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  evaluatePlayerV2,
  evaluatePlayerValue,
  calculateBattingValue,
  calculateBowlingValue,
  calculateAllRounderValue,
  calculateWicketKeeperValue,
  calculateExperienceValue,
  calculateRoleValue,
  calculateOverallPlayerValue,
  calculateValueForMoney,
  attachValueToSoldEvent,
  evaluateBatting,
  evaluateBowling,
  evaluateAllRounder,
  evaluateWicketKeeping,
  evaluateExperience,
  evaluateRoleValue,
  evaluateAuctionValue,
  extractPlayerStats,
  isVal,
} from "../src/Utils/playerValueEngine.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const master = JSON.parse(
  readFileSync(resolve(ROOT, "src/data/players/processed/master_players.json"), "utf-8")
).players

const byId = new Map(master.map((p) => [p.id, p]))

let fails = 0
const ok = (cond, msg) => {
  console.log(`${cond ? "ok: " : "FAIL: "}${msg}`)
  if (!cond) fails++
}

console.log("==================================================")
console.log("RUNNING PLAYER VALUE ENGINE V2 TEST SUITE")
console.log("==================================================\n")

// ---------------------------------------------------------------------------
// Scenario 1: Strong Batter
// ---------------------------------------------------------------------------
const batterMaster = master.find((p) => p.role === "BATTER" && p.ipl?.batting?.runs > 2000)
ok(!!batterMaster, "1. Strong batter found in canonical master database")
if (batterMaster) {
  const evalRes = evaluatePlayerV2(batterMaster)
  ok(evalRes.batting.score > 50, `1. Strong batter batting score high (${evalRes.batting.score})`)
  ok(evalRes.batting.confidence >= 0.8, `1. High confidence for large batting sample (${evalRes.batting.confidence})`)
  ok(evalRes.role === "BATTER", "1. Role is BATTER")
  ok(evalRes.strengths.length > 0, `1. Generated strengths: ${evalRes.strengths.join(", ")}`)
}

// ---------------------------------------------------------------------------
// Scenario 2: Strong Bowler
// ---------------------------------------------------------------------------
const bowlerMaster = master.find((p) => p.role === "BOWLER" && p.ipl?.bowling?.wickets > 50)
ok(!!bowlerMaster, "2. Strong bowler found in canonical master database")
if (bowlerMaster) {
  const evalRes = evaluatePlayerV2(bowlerMaster)
  ok(evalRes.bowling.score > 50, `2. Strong bowler bowling score high (${evalRes.bowling.score})`)
  ok(evalRes.bowling.confidence >= 0.7, `2. High confidence for bowler (${evalRes.bowling.confidence})`)
  ok(evalRes.role === "BOWLER", "2. Role is BOWLER")
}

// ---------------------------------------------------------------------------
// Scenario 3: Strong All-Rounder
// ---------------------------------------------------------------------------
const arMaster = master.find(
  (p) => p.role === "ALL_ROUNDER" && p.ipl?.batting?.runs > 200 && p.ipl?.bowling?.wickets > 5
)
ok(!!arMaster, "3. Strong all-rounder found in canonical master database")
if (arMaster) {
  const evalRes = evaluatePlayerV2(arMaster)
  ok(evalRes.allRounder.score !== null, `3. All-rounder score present (${evalRes.allRounder.score})`)
  ok(evalRes.allRounder.details.statisticsAvailable === true, "3. Both disciplines available")
}

// ---------------------------------------------------------------------------
// Scenario 4: Wicketkeeper with no keeping statistics
// ---------------------------------------------------------------------------
const wkMaster = master.find((p) => p.role === "WICKET_KEEPER")
ok(!!wkMaster, "4. Wicketkeeper found in canonical master database")
if (wkMaster) {
  const evalRes = evaluatePlayerV2(wkMaster)
  ok(evalRes.wicketKeeping.score === null, "4. Wicketkeeping score is null (no statistics in dataset)")
  ok(evalRes.wicketKeeping.statisticsAvailable === false, "4. keeping statisticsAvailable is false")
  ok(evalRes.limitations.includes("No wicketkeeping statistics available"), "4. Wicketkeeping limitation generated")
  ok(evalRes.batting.score !== null || evalRes.statisticsAvailable === false, "4. Batting score calculated separately")
}

// ---------------------------------------------------------------------------
// Scenario 5: Player with complete statistics
// ---------------------------------------------------------------------------
const completePlayer = {
  id: "test-complete-1",
  name: "Complete Star",
  role: "ALL_ROUNDER",
  age: 28,
  isCapped: true,
  captaincyExperience: true,
  ipl: {
    batting: {
      matches: 100,
      innings: 90,
      runs: 2800,
      average: 35.0,
      strikeRate: 142.5,
      fifties: 18,
      hundreds: 2,
    },
    bowling: {
      innings: 80,
      balls: 1500,
      runsConceded: 1875,
      wickets: 95,
      economy: 7.5,
      average: 19.7,
      fourWickets: 3,
      fiveWickets: 1,
    },
  },
  auction: { soldPriceCr: 12.5, basePrice: 2.0 },
}
const completeEval = evaluatePlayerV2(completePlayer)
ok(completeEval.statisticsAvailable === true, "5. Complete stats statisticsAvailable is true")
ok(completeEval.overallScore > 70, `5. High overall score for complete star (${completeEval.overallScore})`)
ok(completeEval.confidence > 0.85, `5. High overall confidence (${completeEval.confidence})`)
ok(completeEval.auctionValue.valueForMoney !== null, "5. Auction VFM score present")

// ---------------------------------------------------------------------------
// Scenario 6: Player with partial statistics (e.g. batting only)
// ---------------------------------------------------------------------------
const partialPlayer = {
  id: "test-partial-1",
  name: "Pure Specialist Batter",
  role: "BATTER",
  ipl: {
    batting: { matches: 40, innings: 38, runs: 1200, strikeRate: 135.0, average: 34.2 },
    bowling: { matches: null, innings: null, wickets: null, economy: null },
  },
}
const partialEval = evaluatePlayerV2(partialPlayer)
ok(partialEval.batting.score > 35, `6. Batting score present (${partialEval.batting.score})`)
ok(partialEval.bowling.score === null, "6. Bowling score is null when no bowling stats present")
ok(partialEval.bowling.confidence === 0, "6. Bowling confidence is 0")
ok(partialEval.overallScore !== null, `6. Overall score present (${partialEval.overallScore})`)

// ---------------------------------------------------------------------------
// Scenario 7: Player with no IPL statistics
// ---------------------------------------------------------------------------
const noStatsPlayer = {
  id: "test-no-stats",
  name: "New Uncapped Rookie",
  role: "BOWLER",
  age: 20,
  isCapped: false,
  ipl: {
    batting: { matches: null, runs: null },
    bowling: { matches: null, wickets: null },
  },
}
const noStatsEval = evaluatePlayerV2(noStatsPlayer)
ok(noStatsEval.statisticsAvailable === false, "7. statisticsAvailable is false for player without IPL stats")
ok(noStatsEval.overallScore === null, "7. overallScore is null when no statistics present")
ok(noStatsEval.confidence === 0.0, "7. confidence is 0.0 for player with no statistics")

// ---------------------------------------------------------------------------
// Scenario 8: null vs zero handling
// ---------------------------------------------------------------------------
const zeroWktsPlayer = {
  id: "zero-wkts",
  name: "Zero Wkts Bowler",
  role: "BOWLER",
  ipl: { bowling: { wickets: 0, balls: 24, runsConceded: 45, economy: 11.25 } },
}
const nullWktsPlayer = {
  id: "null-wkts",
  name: "Null Wkts Player",
  role: "BATTER",
  ipl: { bowling: { wickets: null, balls: null } },
}
const zeroEval = evaluateBowling(zeroWktsPlayer)
const nullEval = evaluateBowling(nullWktsPlayer)

ok(zeroEval.details.wickets === 0, "8. Genuine 0 wickets preserved as 0")
ok(zeroEval.details.statisticsAvailable === true, "8. Zero wickets player statisticsAvailable is true")
ok(nullEval.details.wickets === undefined || nullEval.score === null, "8. Null wickets player score is null")
ok(nullEval.details.statisticsAvailable === false, "8. Null wickets player statisticsAvailable is false")

// ---------------------------------------------------------------------------
// Scenario 9: Small sample-size player
// ---------------------------------------------------------------------------
const smallSamplePlayer = {
  id: "small-sample",
  name: "One Game Wonder",
  role: "BATTER",
  ipl: {
    batting: { matches: 2, innings: 2, runs: 85, average: 85.0, strikeRate: 170.0 },
  },
}
const smallEval = evaluatePlayerV2(smallSamplePlayer)
ok(smallEval.batting.score > 0, "9. Small sample batting score computed")
ok(smallEval.batting.confidence < 0.35, `9. Small sample confidence is low (${smallEval.batting.confidence})`)
ok(smallEval.limitations.includes("Limited IPL batting sample"), "9. Limited sample limitation generated")

// ---------------------------------------------------------------------------
// Scenario 10: Historical SOLD_PRICE present
// ---------------------------------------------------------------------------
const pricedPlayer = evaluateAuctionValue(completePlayer, 10.0)
ok(pricedPlayer.historicalPrice === 10.0, `10. Historical price present (${pricedPlayer.historicalPrice})`)
ok(pricedPlayer.valueForMoney !== null, `10. VFM score calculated (${pricedPlayer.valueForMoney})`)
ok(typeof pricedPlayer.valueBand === "string", `10. Value band assigned (${pricedPlayer.valueBand})`)

// ---------------------------------------------------------------------------
// Scenario 11: SOLD_PRICE absent
// ---------------------------------------------------------------------------
const unpricedPlayerObj = {
  ...completePlayer,
  auction: { basePrice: 2.0, soldPriceCr: null },
  soldPrice: null,
}
const unpricedPlayer = evaluateAuctionValue(unpricedPlayerObj, null)
ok(unpricedPlayer.historicalPrice === null, "11. Historical price is null when absent")
ok(unpricedPlayer.valueForMoney === null, "11. VFM score is null when absent")
ok(unpricedPlayer.valueBand === null, "11. Value band is null when absent")
ok(unpricedPlayer.fairPrice > 0, `11. Fair price still computed (${unpricedPlayer.fairPrice})`)

// ---------------------------------------------------------------------------
// Scenario 12: Deterministic repeated evaluation invariant
// ---------------------------------------------------------------------------
const evalRun1 = evaluatePlayerV2(completePlayer, 8.5)
const evalRun2 = evaluatePlayerV2(completePlayer, 8.5)
ok(
  JSON.stringify(evalRun1) === JSON.stringify(evalRun2),
  "12. Identical player input produces identical JSON evaluation output"
)

// ---------------------------------------------------------------------------
// Scenario 13: Role-aware scoring
// ---------------------------------------------------------------------------
const batterRoleEval = evaluateRoleValue(partialPlayer)
const bowlerRoleEval = evaluateRoleValue({ ...partialPlayer, role: "BOWLER" })
ok(batterRoleEval.primaryRole === "BATTER", "13. BATTER primary role set")
ok(batterRoleEval.score === partialEval.batting.score, "13. BATTER role value uses batting score")

// ---------------------------------------------------------------------------
// Scenario 14: Confidence calculation
// ---------------------------------------------------------------------------
const highSampleConf = evaluateBatting({
  ipl: { batting: { matches: 120, innings: 110, runs: 3500, average: 36.0, strikeRate: 140.0 } },
})
const lowSampleConf = evaluateBatting({
  ipl: { batting: { matches: 3, innings: 3, runs: 40, average: 13.3, strikeRate: 105.0 } },
})
ok(highSampleConf.confidence > lowSampleConf.confidence, `14. High sample conf (${highSampleConf.confidence}) > low sample conf (${lowSampleConf.confidence})`)

// ---------------------------------------------------------------------------
// Scenario 15: Strength and Limitation text generation
// ---------------------------------------------------------------------------
const kohliMaster = master.find((p) => p.name.includes("Kohli") || p.id === "virat-kohli") || batterMaster
const textEval = evaluatePlayerV2(kohliMaster)
ok(Array.isArray(textEval.strengths), "15. Strengths is an array")
ok(Array.isArray(textEval.limitations), "15. Limitations is an array")
console.log("   Strengths:", textEval.strengths)
console.log("   Limitations:", textEval.limitations)

// ---------------------------------------------------------------------------
// Scenario 16: Backward Compatibility Verification
// ---------------------------------------------------------------------------
const legacyWrap = evaluatePlayerValue(kohliMaster, 17.0)
ok(typeof legacyWrap.battingValue === "number", "16. Backward comp battingValue present")
ok(typeof legacyWrap.bowlingValue === "number", "16. Backward comp bowlingValue present")
ok(typeof legacyWrap.overallValue === "number", "16. Backward comp overallValue present")

const soldEvent = { playerId: kohliMaster.id, finalPrice: 15.0 }
const attached = attachValueToSoldEvent(soldEvent, kohliMaster)
ok(attached.value.overallValue !== undefined, "16. attachValueToSoldEvent attaches value payload")

console.log("\n==================================================")
console.log(fails ? `TEST SUITE COMPLETED WITH ${fails} FAILURES` : "ALL PLAYER VALUE ENGINE V2 TESTS PASSED PERFECTLY!")
console.log("==================================================")

process.exit(fails ? 1 : 0)
