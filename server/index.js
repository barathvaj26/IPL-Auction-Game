import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import { RoomManager } from "./roomManager.js"

const app = express()
const httpServer = createServer(app)

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]

app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json())

const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
})

const roomManager = new RoomManager(io)

// Basic health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    activeRooms: roomManager.rooms.size,
    timestamp: new Date().toISOString(),
  })
})

app.get("/", (req, res) => {
  res.json({
    message: "IPL Auction Socket.IO server. Use a Socket.IO client, not a browser address bar.",
    health: "/health",
    frontend: "http://localhost:5173",
  })
})

io.on("connection", (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`)

  // 1. CREATE ROOM
  socket.on("create_room", (payload, callback) => {
    try {
      const room = roomManager.createRoom({
        ...payload,
        socketId: socket.id,
      })

      socket.join(room.roomCode)
      console.log(`[Room] Created: ${room.roomCode} by ${room.host.name}`)

      const serialized = roomManager.serializeRoom(room)
      if (typeof callback === "function") {
        callback({ success: true, room: serialized, host: room.host })
      }
      socket.emit("room_created", { room: serialized, host: room.host })
    } catch (err) {
      console.error("[Room] Error creating room:", err)
      if (typeof callback === "function") {
        callback({ success: false, error: err.message })
      }
    }
  })

  // 2. JOIN ROOM
  socket.on("join_room", (payload, callback) => {
    try {
      const { roomCode, playerName, playerId } = payload
      const result = roomManager.joinRoom({
        roomCode,
        playerName,
        playerId,
        socketId: socket.id,
      })

      if (!result.success) {
        if (typeof callback === "function") callback(result)
        socket.emit("join_error", { message: result.error })
        return
      }

      socket.join(roomCode.toUpperCase())
      console.log(`[Room] ${playerName || playerId} joined room ${roomCode}`)

      if (typeof callback === "function") callback(result)
      socket.emit("joined_room", result)
      io.to(roomCode.toUpperCase()).emit("room_updated", result.room)
    } catch (err) {
      console.error("[Room] Error joining room:", err)
      if (typeof callback === "function") {
        callback({ success: false, error: err.message })
      }
    }
  })

  // 3. SELECT FRANCHISE TEAM
  socket.on("select_team", ({ roomCode, playerId, teamCode }, callback) => {
    const result = roomManager.selectTeam({ roomCode, playerId, teamCode })
    if (!result.success) {
      if (typeof callback === "function") callback(result)
      socket.emit("action_error", { message: result.error })
      return
    }

    if (typeof callback === "function") callback(result)
    io.to(roomCode.toUpperCase()).emit("room_updated", result.room)
  })

  // 4. TOGGLE READY STATUS
  socket.on("toggle_ready", ({ roomCode, playerId }, callback) => {
    const result = roomManager.toggleReady({ roomCode, playerId })
    if (!result.success) {
      if (typeof callback === "function") callback(result)
      socket.emit("action_error", { message: result.error })
      return
    }

    if (typeof callback === "function") callback(result)
    io.to(roomCode.toUpperCase()).emit("room_updated", result.room)
  })

  // 5. START AUCTION (HOST ONLY)
  socket.on("start_auction", ({ roomCode, hostId }, callback) => {
    const respond = (payload) => {
      if (typeof callback === "function") callback(payload)
    }
    const room = roomManager.getRoom(roomCode)
    if (!room) {
      respond({ success: false, error: "Room not found. Check the code." })
      return
    }

    if (room.host.id !== hostId) {
      respond({ success: false, error: "Only host can start" })
      return
    }

    const started = room.engine.startAuction()
    if (started) {
      console.log(`[Auction] Started for room ${roomCode}`)
      io.to(roomCode.toUpperCase()).emit("room_updated", roomManager.serializeRoom(room))
      respond({ success: true, room: roomManager.serializeRoom(room) })
      return
    }

    // startAuction() returns false when transition is not allowed (already started)
    respond({
      success: false,
      error: `Auction cannot be started from phase ${room.engine.phase}`,
      alreadyStarted: room.engine.phase !== "LOBBY",
      room: roomManager.serializeRoom(room),
    })
  })

  // 6. ATOMIC BID PLACEMENT
  socket.on("place_bid", ({ roomCode, playerId, team }, callback) => {
    const room = roomManager.getRoom(roomCode)
    if (!room) {
      if (typeof callback === "function") callback({ success: false, reason: "Room not found" })
      return
    }

    const result = room.engine.placeBid({ playerId, team })
    if (typeof callback === "function") callback(result)
  })

  // 7. PAUSE / RESUME (HOST ONLY)
  socket.on("pause_auction", ({ roomCode, hostId }, callback) => {
    const room = roomManager.getRoom(roomCode)
    if (!room) {
      if (typeof callback === "function") callback({ success: false, error: "Room not found" })
      return
    }
    if (room.host.id !== hostId) {
      if (typeof callback === "function") callback({ success: false, error: "Only host can pause" })
      return
    }
    room.engine.pauseAuction()
    if (typeof callback === "function") callback({ success: true })
  })

  socket.on("resume_auction", ({ roomCode, hostId }, callback) => {
    const room = roomManager.getRoom(roomCode)
    if (!room) {
      if (typeof callback === "function") callback({ success: false, error: "Room not found" })
      return
    }
    if (room.host.id !== hostId) {
      if (typeof callback === "function") callback({ success: false, error: "Only host can resume" })
      return
    }
    room.engine.resumeAuction()
    if (typeof callback === "function") callback({ success: true })
  })

  // 8. CHANGE TIMER MODE (HOST ONLY)
  socket.on("change_timer_mode", ({ roomCode, hostId, timerMode }, callback) => {
    const room = roomManager.getRoom(roomCode)
    if (!room) {
      if (typeof callback === "function") callback({ success: false, error: "Room not found" })
      return
    }
    if (room.host.id !== hostId) {
      if (typeof callback === "function") callback({ success: false, error: "Only host can change timer" })
      return
    }
    room.engine.setTimerMode(timerMode)
    if (typeof callback === "function") callback({ success: true })
  })

  // 9. KICK PLAYER (HOST ONLY)
  socket.on("kick_player", ({ roomCode, hostId, targetPlayerId }, callback) => {
    const result = roomManager.kickPlayer({ roomCode, hostId, targetPlayerId })
    if (result.success) {
      if (result.removedPlayer?.socketId) {
        io.to(result.removedPlayer.socketId).emit("kicked", { message: "You were kicked by the host" })
      }
      io.to(roomCode.toUpperCase()).emit("room_updated", result.room)
    }
    if (typeof callback === "function") callback(result)
  })

  // 10. DISCONNECT HANDLING
  socket.on("disconnect", () => {
    console.log(`[Socket] Disconnected: ${socket.id}`)
    roomManager.handleDisconnect(socket.id)
  })
})

const PORT = process.env.PORT || 5000
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ IPL Auction Real-Time Server listening on port ${PORT}`)
  console.log(`   Health: http://localhost:${PORT}/health`)
})
