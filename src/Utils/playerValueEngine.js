/**
 * Player Value Engine (Phase 4)
 *
 * Deterministic, transparent player-quality metrics computed ONLY from fields
 * already present in src/data/players.js. No LLMs, no randomness, no invented
 * statistics — the same player object always yields the same scores.
 *
 * AVAILABLE schema fields (verified): id, name, country, role, basePrice,
 * matches, runs, strikeRate, wickets, economy, battingStyle, bowlingStyle,
 * age, previousTeam, isOverseas, isCapped, category.
 *
 * NOT available (therefore NOT scored): batting average, balls faced,
 * bowling average/strike-rate, catches/stumpings, recent form, per-season
 * splits. There is deliberately NO calculateConsistencyValue — consistency
 * cannot be derived from career aggregates without inventing data.
 *
 * All scores are 0–100, rounded to 1 decimal. Every numeric input is coerced
 * through safeNum() so missing/zero stats yield 0, never NaN/Infinity.
 */

import { roundCurrency } from "./auctionRules.js"

// ---------------------------------------------------------------------------
// Scale + normalization caps (documented constants, not judgments)
// Caps approximate the observed pool maxima so the best career in the pool
// scores near 100: most runs ≈ 8004 (Kohli), most wickets ≈ 205 (Chahal),
// most matches ≈ 264 (Dhoni).
// ---------------------------------------------------------------------------

export const VALUE_SCALE = { MIN: 0, MAX: 100 }

export const VALUE_CAPS = {
  RUNS: 8000,
  WICKETS: 200,
  MATCHES: 260,
  // Strike rate: ≤100 → 0 contribution, ≥170 → full contribution.
  SR_FLOOR: 100,
  SR_CEILING: 170,
  // Economy: ≥10 → 0 contribution, ≤6 → full contribution (lower is better).
  ECON_FLOOR: 6,
  ECON_CEILING: 10,
}

// Value-for-money bands (documented thresholds on the 0–100 VFM score).
export const VFM_BANDS = [
  { min: 80, label: "EXCELLENT" },
  { min: 60, label: "GOOD" },
  { min: 40, label: "FAIR" },
  { min: 20, label: "LOW" },
  { min: 0, label: "POOR" },
]

const clamp100 = (v) => Math.min(100, Math.max(0, v))

const safeNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
};

/** Linear 0–100 normalization of value against a cap. */
const norm = (value, cap) => clamp100((safeNum(value) / cap) * 100)

const round1 = (v) => Math.round(clamp100(v) * 10) / 10

// ---------------------------------------------------------------------------
// Component calculators — every one is a pure function of player fields.
// ---------------------------------------------------------------------------

/**
 * Batting value = 55% run volume + 30% scoring rate + 15% matches.
 * Rate and longevity components ramp with demonstrated output
 * (full credit at 500 runs) so pure bowlers harvest no phantom batting
 * points from longevity alone; zero runs → both contribute 0.
 */
export const calculateBattingValue = (player = {}) => {
  const runsScore = norm(player.runs, VALUE_CAPS.RUNS)
  const outputShare = Math.min(1, safeNum(player.runs) / 500)
  const srScore =
    outputShare > 0
      ? clamp100(
          ((safeNum(player.strikeRate) - VALUE_CAPS.SR_FLOOR) /
            (VALUE_CAPS.SR_CEILING - VALUE_CAPS.SR_FLOOR)) *
            100
        ) * outputShare
      : 0
  const matchesScore = norm(player.matches, VALUE_CAPS.MATCHES) * outputShare
  return round1(runsScore * 0.55 + srScore * 0.3 + matchesScore * 0.15)
};

/**
 * Bowling value = 55% wicket volume + 30% economy control + 15% matches.
 * Control and longevity components ramp with demonstrated output
 * (full credit at 20 wickets) so batters harvest no phantom bowling
 * points; zero wickets → both contribute 0 (also neutralizes the
 * economy-0 placeholder rows carried by non-bowlers).
 */
export const calculateBowlingValue = (player = {}) => {
  const wicketsScore = norm(player.wickets, VALUE_CAPS.WICKETS)
  const outputShare = Math.min(1, safeNum(player.wickets) / 20)
  const econScore =
    outputShare > 0
      ? clamp100(
          ((VALUE_CAPS.ECON_CEILING - safeNum(player.economy)) /
            (VALUE_CAPS.ECON_CEILING - VALUE_CAPS.ECON_FLOOR)) *
            100
        ) * outputShare
      : 0
  const matchesScore = norm(player.matches, VALUE_CAPS.MATCHES) * outputShare
  return round1(wicketsScore * 0.55 + econScore * 0.3 + matchesScore * 0.15)
};

/**
 * All-rounder value = mean of batting + bowling. Always computable because
 * every player row carries both batting and bowling aggregate fields.
 */
export const calculateAllRounderValue = (player = {}) => {
  return round1((calculateBattingValue(player) + calculateBowlingValue(player)) / 2)
};

/**
 * Wicket-keeper value. The pool has NO dismissals data (catches/stumpings),
 * so keeping skill itself cannot be scored; the honest signal is batting
 * (70%) blended with experience (30%). Returns null for non-keepers rather
 * than inventing a keeping metric.
 */
export const calculateWicketKeeperValue = (player = {}) => {
  if (player?.role !== "WICKET_KEEPER") return null
  return round1(calculateBattingValue(player) * 0.7 + calculateExperienceValue(player) * 0.3)
};

/**
 * Experience value = 65% matches + 25% capped status + 10% age curve.
 * Age curve peaks across 26–32 and tapers to 0.5 weight at ≤18 / ≥42;
 * it rewards availability without pretending age equals skill.
 */
export const calculateExperienceValue = (player = {}) => {
  const matchesScore = norm(player.matches, VALUE_CAPS.MATCHES)
  const cappedScore = player?.isCapped ? 100 : 0
  const age = Number(player?.age)
  let ageScore = 50
  if (Number.isFinite(age) && age > 0) {
    if (age >= 26 && age <= 32) ageScore = 100
    else if (age < 26) ageScore = clamp100(50 + (age - 18) * (50 / 8))
    else ageScore = clamp100(100 - (age - 32) * 10)
  }
  return round1(matchesScore * 0.65 + cappedScore * 0.25 + ageScore * 0.1)
};

/**
 * Role value selects the composite matching the player's role:
 * BATTER → batting, BOWLER → bowling, ALL_ROUNDER → all-rounder mean,
 * WICKET_KEEPER → keeper blend. Unknown/missing role → null (no guessing).
 */
export const calculateRoleValue = (player = {}) => {
  switch (player?.role) {
    case "BATTER":
      return calculateBattingValue(player)
    case "BOWLER":
      return calculateBowlingValue(player)
    case "ALL_ROUNDER":
      return calculateAllRounderValue(player)
    case "WICKET_KEEPER":
      return calculateWicketKeeperValue(player)
    default:
      return null
  }
};

/**
 * Overall value (0–100): role-weighted blend so specialists are judged on
 * their craft, with experience as a shared anchor.
 *   BATTER  60% bat / 10% bowl / 30% exp
 *   BOWLER  10% bat / 60% bowl / 30% exp
 *   ALL_ROUNDER 35% / 35% / 30%
 *   WICKET_KEEPER 55% bat / 15% bowl / 30% exp
 *   unknown role → mean of bat/bowl/exp (null roleValue kept as the signal).
 */
export const calculateOverallPlayerValue = (player = {}) => {
  const bat = calculateBattingValue(player)
  const bowl = calculateBowlingValue(player)
  const exp = calculateExperienceValue(player)
  switch (player?.role) {
    case "BATTER":
      return round1(bat * 0.6 + bowl * 0.1 + exp * 0.3)
    case "BOWLER":
      return round1(bat * 0.1 + bowl * 0.6 + exp * 0.3)
    case "ALL_ROUNDER":
      return round1(bat * 0.35 + bowl * 0.35 + exp * 0.3)
    case "WICKET_KEEPER":
      return round1(bat * 0.55 + bowl * 0.15 + exp * 0.3)
    default:
      return round1((bat + bowl + exp) / 3)
  }
};

// ---------------------------------------------------------------------------
// Auction value (quality vs price)
// ---------------------------------------------------------------------------

/**
 * Fair-price model (Cr): 0.3 + (overall/100) * 14.
 * A 0-rated player is worth ~base minimum; a 100-rated player ~14.3 Cr,
 * inside the observed IPL band. VFM = clamp(fair/actual / 2) * 100, so
 * paying half of fair value (or less) scores 100 and paying double (or
 * more) scores ≤50. Zero/missing price → null (no division by zero).
 */
export const calculateValueForMoney = (player = {}, auctionPrice) => {
  const price = Number(auctionPrice)
  if (!Number.isFinite(price) || price <= 0) return { score: null, band: null, fairPrice: null }
  const overall = calculateOverallPlayerValue(player)
  const fairPrice = roundCurrency(0.3 + (overall / 100) * 14)
  const score = round1(clamp100((fairPrice / price / 2) * 100))
  const band = VFM_BANDS.find((b) => score >= b.min)?.label || "POOR"
  return { score, band, fairPrice }
};

/**
 * Full structured evaluation. Shape matches the Phase 4 contract; only
 * wicketKeeperValue may be null (non-keepers), and valueForMoney fields
 * are null when no auction price is supplied.
 */
export const evaluatePlayerValue = (player = {}, auctionPrice = null) => {
  const vfm =
    auctionPrice === null || auctionPrice === undefined
      ? { score: null, band: null, fairPrice: null }
      : calculateValueForMoney(player, auctionPrice)
  return {
    playerId: player?.id || null,
    playerName: player?.name || null,
    role: player?.role || null,
    battingValue: calculateBattingValue(player),
    bowlingValue: calculateBowlingValue(player),
    allRounderValue: calculateAllRounderValue(player),
    wicketKeeperValue: calculateWicketKeeperValue(player),
    experienceValue: calculateExperienceValue(player),
    roleValue: calculateRoleValue(player),
    overallValue: calculateOverallPlayerValue(player),
    auctionPrice:
      auctionPrice === null || auctionPrice === undefined
        ? null
        : roundCurrency(Number(auctionPrice) || 0),
    valueForMoney: vfm.score,
    valueBand: vfm.band,
    fairPrice: vfm.fairPrice,
  }
};

/**
 * Attach a value evaluation to a Phase-3 SOLD event payload.
 * Additive only — returns a new object, never mutates inputs or flow.
 */
export const attachValueToSoldEvent = (soldEvent = {}, player = {}) => ({
  ...soldEvent,
  value: evaluatePlayerValue(player, soldEvent?.finalPrice ?? null),
});
