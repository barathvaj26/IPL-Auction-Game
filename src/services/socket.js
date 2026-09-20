import { io } from "socket.io-client"

// Get or generate persistent player identity from localStorage
export function getOrCreatePlayerIdentity(preferredName = "") {
  let playerId = localStorage.getItem("ipl_auction_player_id")
  if (!playerId) {
    playerId = `player_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`
    localStorage.setItem("ipl_auction_player_id", playerId)
  }

  let storedName = localStorage.getItem("ipl_auction_player_name")
  if (preferredName) {
    storedName = preferredName
    localStorage.setItem("ipl_auction_player_name", preferredName)
  }

  return {
    playerId,
    playerName: storedName || "Cricket Enthusiast",
  }
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000"

class SocketService {
  constructor() {
    this.socket = null
    this.isConnected = false
    this.currentRoom = null
    this.playerIdentity = getOrCreatePlayerIdentity()
    this.listeners = new Map() // event -> Set(callback)
  }

  connect() {
    // Reuse the same socket so we never lose Socket.IO room membership.
    if (this.socket) {
      if (!this.socket.connected && !this.socket.active) {
        try { this.socket.connect() } catch { /* noop */ }
      }
      return this.socket
    }

    this.socket = io(SERVER_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })
    this._forwardersAttached = false

    this.socket.on("connect", () => {
      console.log("⚡ [Socket] Connected to backend server:", this.socket.id)
      this.isConnected = true
      this._emitLocal("connection_change", true)
    })

    this.socket.on("disconnect", () => {
      console.log("⚠️ [Socket] Disconnected from backend server")
      this.isConnected = false
      this._emitLocal("connection_change", false)
    })

    this.socket.on("connect_error", (err) => {
      console.warn(
        `⚠️ [Socket] Cannot reach backend at ${SERVER_URL} (${err?.message || err}). Start it with: npm run server`
      )
      this.isConnected = false
      this._emitLocal("connection_change", false)
    })

    // Forward server events to local subscribers
    const forwardEvents = [
      "room_created",
      "joined_room",
      "room_updated",
      "auction_started",
      "auction_tick",
      "bid_placed",
      "player_sold",
      "player_unsold",
      "next_player",
      "auction_paused",
      "auction_resumed",
      "timer_mode_changed",
      "auction_completed",
      "kicked",
      "join_error",
      "action_error",
    ]

    if (!this._forwardersAttached) {
      forwardEvents.forEach((ev) => {
        this.socket.on(ev, (data) => {
          this._emitLocal(ev, data)
        })
      })
      this._forwardersAttached = true
    }

    return this.socket
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(callback)
    return () => this.off(event, callback)
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback)
    }
  }

  _emitLocal(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((cb) => cb(data))
    }
  }

  _withAckTimeout(resolve, reject, ms, failMessage) {
    const timeoutId = setTimeout(() => {
      reject(new Error(failMessage))
    }, ms)
    return (fn) => (response) => {
      clearTimeout(timeoutId)
      fn(response)
    }
  }

  createRoom({ hostName, roomName, teams, budget, auctionType, timerMode, poolSource, poolMode, poolLimit, poolCategories }) {
    this.connect()
    if (hostName) {
      this.playerIdentity = getOrCreatePlayerIdentity(hostName)
    }
    const { playerId } = this.playerIdentity
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected to server. Start it with: npm run server"))
        return
      }
      const done = this._withAckTimeout(
        resolve,
        reject,
        6000,
        "Server did not respond. Is the backend running? (npm run server)"
      )((response) => {
        if (response && response.success) {
          this.currentRoom = response.room
          resolve(response)
        } else {
          reject(new Error(response?.error || "Failed to create room"))
        }
      })
      this.socket.emit(
        "create_room",
        {
          hostName,
          roomName,
          teams,
          budget,
          auctionType,
          timerMode,
          poolSource,
          poolMode,
          poolLimit,
          poolCategories,
          hostId: playerId,
        },
        done
      )
    })
  }

  joinRoom({ roomCode, playerName }) {
    this.connect()
    if (playerName) {
      this.playerIdentity = getOrCreatePlayerIdentity(playerName)
    }
    const { playerId } = this.playerIdentity
    return new Promise((resolve, reject) => {
      if (!this.socket || !roomCode) {
        reject(new Error("Not connected to server. Start it with: npm run server"))
        return
      }
      const done = this._withAckTimeout(
        resolve,
        reject,
        6000,
        "Server did not respond. Is the backend running? (npm run server)"
      )((response) => {
        if (response && response.success) {
          this.currentRoom = response.room
          resolve(response)
        } else {
          reject(new Error(response?.error || "Failed to join room"))
        }
      })
      this.socket.emit(
        "join_room",
        {
          roomCode: roomCode.toUpperCase(),
          playerName,
          playerId,
        },
        done
      )
    })
  }

  selectTeam({ roomCode, teamCode }) {
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      this.socket.emit(
        "select_team",
        { roomCode: roomCode.toUpperCase(), playerId, teamCode },
        (res) => resolve(res)
      )
    })
  }

  toggleReady({ roomCode }) {
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      this.socket.emit(
        "toggle_ready",
        { roomCode: roomCode.toUpperCase(), playerId },
        (res) => resolve(res)
      )
    })
  }

  startAuction({ roomCode }) {
    this.connect()
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      if (!this.socket || !roomCode) {
        resolve({ success: false, error: "Not connected to server" })
        return
      }
      const timeoutId = setTimeout(() => {
        resolve({ success: false, error: "Server did not respond. Is the backend running?" })
      }, 5000)
      this.socket.emit(
        "start_auction",
        { roomCode: roomCode.toUpperCase(), hostId: playerId },
        (res) => {
          clearTimeout(timeoutId)
          resolve(res || { success: false, error: "Empty server response" })
        }
      )
    })
  }

  placeBid({ roomCode, team }) {
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      this.socket.emit(
        "place_bid",
        { roomCode: roomCode.toUpperCase(), playerId, team },
        (res) => resolve(res)
      )
    })
  }

  pauseAuction({ roomCode }) {
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      this.socket.emit(
        "pause_auction",
        { roomCode: roomCode.toUpperCase(), hostId: playerId },
        (res) => resolve(res)
      )
    })
  }

  resumeAuction({ roomCode }) {
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      this.socket.emit(
        "resume_auction",
        { roomCode: roomCode.toUpperCase(), hostId: playerId },
        (res) => resolve(res)
      )
    })
  }

  changeTimerMode({ roomCode, timerMode }) {
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      this.socket.emit(
        "change_timer_mode",
        { roomCode: roomCode.toUpperCase(), hostId: playerId, timerMode },
        (res) => resolve(res)
      )
    })
  }

  kickPlayer({ roomCode, targetPlayerId }) {
    const { playerId } = this.playerIdentity
    return new Promise((resolve) => {
      this.socket.emit(
        "kick_player",
        { roomCode: roomCode.toUpperCase(), hostId: playerId, targetPlayerId },
        (res) => resolve(res)
      )
    })
  }
}

export const socketService = new SocketService()
