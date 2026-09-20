import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { AuctionEngine } from "./auctionEngine.js"
import { PLAYERS } from "../src/data/players.js"
import { TEAM_CODES } from "../src/data/teams.js"
import { buildPoolForMode, validatePool } from "../src/utils/auctionPool.js"

// Master database (3.9MB) loads lazily, once — never bundled to clients.
let masterCache = null
const loadMasterPlayers = () => {
  if (!masterCache) {
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..", "src", "data", "players", "processed", "master_players.json"
    )
    masterCache = JSON.parse(fs.readFileSync(file, "utf-8")).players
  }
  return masterCache
}

/**
 * Resolve the auction player pool for a room.
 * Default poolSource "legacy" preserves the curated 47-player auction.
 * poolSource "master" builds a pool from the canonical database via the
 * adapter (Mini Auction rooms use master/mini).
 */
export const resolveRoomPool = ({ poolSource = "legacy", poolMode = "mega", poolLimit, poolCategories } = {}) => {
  if (poolSource !== "master") return { players: PLAYERS, meta: { source: "legacy", size: PLAYERS.length } }
  const pool = buildPoolForMode(loadMasterPlayers(), poolMode, {
    ...(typeof poolLimit === "number" ? { limit: poolLimit } : {}),
    ...(poolCategories ? { categories: poolCategories } : {}),
  })
  const check = validatePool(pool)
  if (!check.ok) throw new Error(`Invalid master pool: ${JSON.stringify(check)}`)
  return { players: pool, meta: { source: "master", mode: poolMode, size: pool.length } }
}

export class RoomManager {
  constructor(io) {
    this.io = io
    this.rooms = new Map() // roomCode -> Room
  }

  generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    let code = ""
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  createRoom({
    hostName = "Host",
    roomName = "IPL War Room",
    teams = 10,
    budget = 120,
    auctionType = "Mega Auction",
    timerMode = 10,
    // Pool selection (additive): legacy default preserves current behavior.
    // Mini Auction rooms default to a master-database mini pool.
    poolSource,
    poolMode,
    poolLimit,
    poolCategories,
    socketId,
    hostId,
  }) {
    let code = this.generateRoomCode()
    while (this.rooms.has(code)) {
      code = this.generateRoomCode()
    }

    const effectiveSource = poolSource || (auctionType === "Mini Auction" ? "master" : "legacy")
    const effectiveMode = poolMode || (auctionType === "Mini Auction" ? "mini" : "mega")
    const { players: poolPlayers, meta: poolMeta } = resolveRoomPool({
      poolSource: effectiveSource, poolMode: effectiveMode, poolLimit, poolCategories,
    })

    const host = {
      id: hostId || `host-${Date.now()}`,
      name: hostName || "Host",
      socketId,
      isHost: true,
      isConnected: true,
    }

    const engine = new AuctionEngine({
      players: poolPlayers,
      initialBudget: Number(budget) || 120,
      timerMode: Number(timerMode) === 5 ? 5 : 10,
      onBroadcast: (event, payload) => {
        this.io.to(code).emit(event, payload)
      },
    })

    const room = {
      roomCode: code,
      roomName: roomName || `${hostName}'s Auction`,
      host,
      players: new Map(), // playerId -> player
      settings: {
        teamsCount: Math.min(10, Math.max(2, Number(teams) || 10)),
        budget: Number(budget) || 120,
        auctionType,
        timerMode: Number(timerMode) === 5 ? 5 : 10,
        pool: poolMeta,
      },
      engine,
      createdAt: new Date(),
    }

    this.rooms.set(code, room)
    return room
  }

  getRoom(roomCode) {
    if (!roomCode) return null
    return this.rooms.get(roomCode.toUpperCase()) || null
  }

  joinRoom({ roomCode, playerName, playerId, socketId }) {
    const room = this.getRoom(roomCode)
    if (!room) {
      return { success: false, error: "Room not found. Check the code." }
    }

    const pId = playerId || `p-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`

    // Check if host is reconnecting
    if (room.host.id === pId) {
      room.host.socketId = socketId
      room.host.isConnected = true
      return {
        success: true,
        isHost: true,
        room: this.serializeRoom(room),
        player: room.host,
      }
    }

    // Check if existing player is reconnecting
    if (room.players.has(pId)) {
      const existing = room.players.get(pId)
      existing.socketId = socketId
      existing.isConnected = true
      return {
        success: true,
        isHost: false,
        room: this.serializeRoom(room),
        player: existing,
      }
    }

    // New player joining: verify room capacity
    if (room.players.size >= room.settings.teamsCount) {
      return { success: false, error: "This auction room is already full." }
    }

    const newPlayer = {
      id: pId,
      name: playerName || `Franchise Owner ${room.players.size + 1}`,
      socketId,
      team: null,
      isReady: false,
      isConnected: true,
      isHost: false,
    }

    room.players.set(pId, newPlayer)

    return {
      success: true,
      isHost: false,
      room: this.serializeRoom(room),
      player: newPlayer,
    }
  }

  selectTeam({ roomCode, playerId, teamCode }) {
    const room = this.getRoom(roomCode)
    if (!room) return { success: false, error: "Room not found" }

    if (!TEAM_CODES.includes(teamCode)) {
      return { success: false, error: "Invalid IPL franchise" }
    }

    const player = room.players.get(playerId)
    if (!player) return { success: false, error: "Player not found in room" }

    // Check if another player already claimed this team
    for (const [otherId, otherPlayer] of room.players.entries()) {
      if (otherId !== playerId && otherPlayer.team === teamCode) {
        return {
          success: false,
          error: `${teamCode} is already chosen by ${otherPlayer.name}`,
        }
      }
    }

    player.team = teamCode
    return { success: true, room: this.serializeRoom(room), player }
  }

  toggleReady({ roomCode, playerId }) {
    const room = this.getRoom(roomCode)
    if (!room) return { success: false, error: "Room not found" }

    const player = room.players.get(playerId)
    if (!player) return { success: false, error: "Player not found" }

    if (!player.team) {
      return { success: false, error: "Please select a franchise before getting ready" }
    }

    player.isReady = !player.isReady
    return { success: true, room: this.serializeRoom(room), player }
  }

  kickPlayer({ roomCode, hostId, targetPlayerId }) {
    const room = this.getRoom(roomCode)
    if (!room) return { success: false, error: "Room not found" }

    if (room.host.id !== hostId) {
      return { success: false, error: "Only the host can kick players" }
    }

    if (room.players.has(targetPlayerId)) {
      const removedPlayer = room.players.get(targetPlayerId)
      room.players.delete(targetPlayerId)
      return { success: true, removedPlayer, room: this.serializeRoom(room) }
    }

    return { success: false, error: "Player not found" }
  }

  handleDisconnect(socketId) {
    for (const room of this.rooms.values()) {
      if (room.host.socketId === socketId) {
        room.host.isConnected = false
        this.io.to(room.roomCode).emit("room_updated", this.serializeRoom(room))
        return
      }

      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          player.isConnected = false
          this.io.to(room.roomCode).emit("room_updated", this.serializeRoom(room))
          return
        }
      }
    }
  }

  serializeRoom(room) {
    return {
      roomCode: room.roomCode,
      roomName: room.roomName,
      host: room.host,
      players: Array.from(room.players.values()),
      settings: room.settings,
      auctionState: room.engine.getState(),
      createdAt: room.createdAt,
    }
  }
}
