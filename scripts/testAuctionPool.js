/**
 * Adapter + pool tests (CONNECT phase, §STEP 11).
 * Covers: conversion, base price, missing base, missing stats, roles,
 * overseas, capped, WK, dedupe, pool selection, mega/mini, legacy behavior.
 * Usage: npm run test:pool   (node scripts/testAuctionPool.js)
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  toAuctionPlayer, resolveBasePrice, getPlayerGroups, getPrimaryCategory,
  selectPool, buildPoolForMode, validatePool, playerImage, isMarquee,
  LEGACY_PLAYERS,
} from "../src/utils/auctionPool.js"
import { AuctionEngine } from "../server/auctionEngine.js"

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

// 1. conversion keeps every legacy engine key, stable id
const kohli = toAuctionPlayer(byId.get("virat-kohli"))
ok(kohli.id === "virat-kohli" && kohli.name === "Virat Kohli", "1 conversion id/name stable")
ok(["country","role","basePrice","matches","runs","strikeRate","wickets","economy","age","previousTeam","isOverseas","isCapped","category"].every((k) => k in kohli), "1 all legacy keys present")

// 2. base price from reserve
const rahane = toAuctionPlayer(byId.get("ajinkya-rahane"))
ok(rahane.basePrice === 0.5 && rahane.basePriceSource === "reserve", `2 reserve base ${rahane.basePrice}`)

// 3. missing base price → documented fallback (never sold price)
const noBase = toAuctionPlayer({ id: "x", role: "BATTER", isCapped: true, auction: {}, ipl: { batting: {}, bowling: {} } })
const noBaseU = toAuctionPlayer({ id: "y", role: "BATTER", isCapped: false, auction: {}, ipl: { batting: {}, bowling: {} } })
ok(noBase.basePrice === 2.0 && noBase.basePriceSource === "fallback-capped", "3 capped fallback 2.0")
ok(noBaseU.basePrice === 0.3 && noBaseU.basePriceSource === "fallback", "3 uncapped fallback 0.3")

// 4. missing stats stay null (not 0)
const uthappa = toAuctionPlayer(byId.get("robin-uthappa"))
ok(uthappa.matches === null && uthappa.wickets === null && uthappa.economy === null, "4 null stats preserved")

// 5. roles passthrough
ok(toAuctionPlayer(byId.get("jasprit-bumrah")).role === "BOWLER", "5 bowler role")
ok(toAuctionPlayer(byId.get("ravindra-jadeja")).role === "ALL_ROUNDER", "5 all-rounder role")

// 6. overseas mapping
ok(toAuctionPlayer(byId.get("kane-williamson")).isOverseas === true, "6 overseas true")
ok(toAuctionPlayer(byId.get("virat-kohli")).isOverseas === false, "6 indian false")

// 7. capped mapping
ok(toAuctionPlayer(byId.get("ajinkya-rahane")).isCapped === true, "7 capped true")

// 8. wicket keepers
const kiron = master.find((p) => p.role === "WICKET_KEEPER")
ok(!!kiron, "8 WK exists in master")
const wkAp = toAuctionPlayer(kiron)
ok(wkAp.role === "WICKET_KEEPER" && wkAp.groups.includes("WICKET_KEEPER"), `8 WK mapped (${kiron.id}, category ${wkAp.category})`)

// 9. duplicate protection by id
const dupPool = selectPool([byId.get("virat-kohli"), byId.get("virat-kohli")])
ok(dupPool.length === 1, "9 dupes collapsed by id")

// 10. pool selection: categories + sets + limit + deterministic
const marquee = selectPool(master, { categories: ["MARQUEE"] })
ok(marquee.length === 10 && marquee.every((p) => p.category === "MARQUEE" || p.groups.includes("MARQUEE")), `10 marquee set → ${marquee.length}`)
const wkSet = selectPool(master, { sets: ["WK1"] })
ok(wkSet.length > 0 && wkSet.every((p) => p.masterSets.includes("WK1")), `10 set filter WK1 → ${wkSet.length}`)
const limited = selectPool(master, { limit: 25 })
ok(limited.length === 25, "10 limit respected")
ok(JSON.stringify(selectPool(master, { limit: 25 }).map((p) => p.id)) === JSON.stringify(limited.map((p) => p.id)), "10 deterministic order")

// 11. mega/mini presets share one path
const mega = buildPoolForMode(master, "mega")
const mini = buildPoolForMode(master, "mini")
ok(mega.length === 120 && mini.length === 30, `11 mega ${mega.length} / mini ${mini.length}`)
ok(validatePool(mini).ok && validatePool(mega).ok, "11 pools validate")

// 12. legacy behavior intact (engine default + legacy pool valid)
const engine = new AuctionEngine({ onBroadcast: () => {} })
ok(engine.players.length === LEGACY_PLAYERS.length && LEGACY_PLAYERS.length === 47, "12 engine default still legacy 47")
ok(validatePool(LEGACY_PLAYERS).ok, "12 legacy pool validates")

// image fallback never breaks cards
ok(playerImage({ name: "No Image", role: "BATTER" }).startsWith("data:image/svg+xml,"), "image fallback data-uri")
ok(playerImage(LEGACY_PLAYERS[0]) === LEGACY_PLAYERS[0].image, "legacy image passthrough")
ok(isMarquee(byId.get("virat-kohli")) === false || typeof isMarquee(byId.get("virat-kohli")) === "boolean", "marquee predicate safe")
ok(getPrimaryCategory({ isCapped: false, role: "BATTER" }) === "UNCAPPED", "uncapped primary category")
ok(getPlayerGroups({ role: "BATTER", isOverseas: true }).join(",") === "BATTER,OVERSEAS", "multi-group membership")

console.log(fails ? `FAILURES: ${fails}` : "ALL POOL TESTS PASSED")
process.exit(fails ? 1 : 0)
