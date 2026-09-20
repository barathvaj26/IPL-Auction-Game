import { PLAYERS } from "../src/data/players.js"
import { TEAMS } from "../src/data/teams.js"
import { roundCurrency } from "../src/utils/auctionRules.js"
import { buildSoldEvent, validateBid } from "../src/utils/squadRules.js"
import { attachValueToSoldEvent } from "../src/utils/playerValueEngine.js"

export class AuctionEngine {
  constructor({
    players = PLAYERS,
    initialBudget = 120.0,
    timerMode = 10,
    onBroadcast,
  }) {
    this.players = players
    this.initialBudget = Number(initialBudget) || 120.0
    this.timerMode = Number(timerMode) === 5 ? 5 : 10
    this.onBroadcast = onBroadcast || (() => {})

    this.phase = "LOBBY" // "LOBBY" | "COUNTDOWN" | "ACTIVE_BIDDING" | "PAUSED" | "SOLD" | "UNSOLD" | "COMPLETED"
    this.playerIndex = 0
    this.currentBid = this.players[0] ? this.players[0].basePrice : 2.0
    this.highestBidder = null
    this.highestBidderId = null
    this.hasBid = false
    this.timer = this.timerMode
    this.isPaused = false
    this.resultSnapshot = null
    this.auctionHistory = []
    this.unsoldPlayers = []

    this.teamPurses = Object.fromEntries(
      TEAMS.map((t) => [t.code, this.initialBudget])
    )

    this.teamSquads = Object.fromEntries(
      TEAMS.map((t) => [t.code, []])
    )

    this.timerInterval = null
    this.transitionTimeout = null
  }

  getState() {
    const currentPlayer = this.players[this.playerIndex] || null
    return {
      phase: this.phase,
      playerIndex: this.playerIndex,
      totalPlayers: this.players.length,
      // Full pool sync (additive): lets rooms run master-database pools
      // while offline clients keep their local default until first sync.
      players: this.players,
      currentPlayer,
      currentBid: this.currentBid,
      highestBidder: this.highestBidder,
      highestBidderId: this.highestBidderId,
      hasBid: this.hasBid,
      timer: this.timer,
      timerMode: this.timerMode,
      isPaused: this.isPaused,
      resultSnapshot: this.resultSnapshot,
      auctionHistory: this.auctionHistory,
      unsoldPlayers: this.unsoldPlayers,
      teamPurses: this.teamPurses,
      teamSquads: this.teamSquads,
    }
  }

  broadcast(eventName, data) {
    this.onBroadcast(eventName, {
      ...data,
      state: this.getState(),
    })
  }

  startAuction() {
    if (this.phase !== "LOBBY") return false

    this.playerIndex = 0
    const firstPlayer = this.players[0]
    this.currentBid = firstPlayer ? firstPlayer.basePrice : 2.0
    this.highestBidder = null
    this.highestBidderId = null
    this.hasBid = false
    this.timer = this.timerMode
    this.phase = "ACTIVE_BIDDING"
    this.isPaused = false

    this.broadcast("auction_started", { message: "Auction has officially begun!" })
    this._startTimerLoop()
    return true
  }

  _startTimerLoop() {
    this._clearTimerLoop()

    this.timerInterval = setInterval(() => {
      this._onTick()
    }, 1000)
  }

  _clearTimerLoop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
  }

  _onTick() {
    if (this.phase !== "ACTIVE_BIDDING" || this.isPaused) return

    if (this.timer > 1) {
      this.timer -= 1
      this.broadcast("auction_tick", { timer: this.timer })
      return
    }

    // Timer reached 0: Resolve Player Sale or Unsold
    this.timer = 0
    this._clearTimerLoop()

    const currentPlayer = this.players[this.playerIndex]
    if (!currentPlayer) {
      this.phase = "COMPLETED"
      this.broadcast("auction_completed", {})
      return
    }

    if (this.hasBid && this.highestBidder) {
      // SOLD
      this.phase = "SOLD"
      const winningTeam = this.highestBidder
      const finalPrice = roundCurrency(this.currentBid)
      const currentPurse = this.teamPurses[winningTeam] || 0
      const remainingPurse = roundCurrency(Math.max(0, currentPurse - finalPrice))

      this.teamPurses[winningTeam] = remainingPurse

      this.teamSquads[winningTeam].push({
        ...currentPlayer,
        soldPrice: finalPrice,
      })

      const soldAt = new Date().toLocaleTimeString()
      const snapshot = {
        id: `sold-${currentPlayer.id}-${Date.now()}`,
        player: { ...currentPlayer },
        amount: finalPrice,
        team: winningTeam,
        status: "sold",
        timestamp: soldAt,
        // Structured analytics payload (additive — existing UI untouched).
        // Phase 4: value evaluation attached to the Phase-3 event shape.
        event: attachValueToSoldEvent(
          buildSoldEvent({
            player: currentPlayer,
            team: winningTeam,
            finalPrice,
            timestamp: soldAt,
          }),
          currentPlayer
        ),
      }

      this.resultSnapshot = snapshot
      this.auctionHistory.unshift(snapshot)

      this.broadcast("player_sold", {
        snapshot,
        message: `${currentPlayer.name} sold to ${winningTeam} for ₹ ${finalPrice} Cr!`,
      })

      // Automated transition to next player after 3.2s
      this.transitionTimeout = setTimeout(() => {
        this.nextPlayer()
      }, 3200)
    } else {
      // UNSOLD
      this.phase = "UNSOLD"
      const snapshot = {
        id: `unsold-${currentPlayer.id}-${Date.now()}`,
        player: { ...currentPlayer },
        amount: 0,
        team: null,
        status: "unsold",
        timestamp: new Date().toLocaleTimeString(),
      }

      this.resultSnapshot = snapshot
      this.unsoldPlayers.push(currentPlayer)
      this.auctionHistory.unshift(snapshot)

      this.broadcast("player_unsold", {
        snapshot,
        message: `${currentPlayer.name} went UNSOLD.`,
      })

      // Automated transition to next player after 2.4s
      this.transitionTimeout = setTimeout(() => {
        this.nextPlayer()
      }, 2400)
    }
  }

  placeBid({ playerId, team }) {
    if (this.phase !== "ACTIVE_BIDDING" || this.isPaused) {
      return { success: false, reason: "Bidding is currently closed or paused" }
    }

    if (!team) {
      return { success: false, reason: "Must have an assigned IPL team to bid" }
    }

    // Centralized squad validation (purse + squad size + overseas + duplicate).
    const currentPlayer = this.players[this.playerIndex]
    const check = validateBid({
      teamCode: team,
      player: currentPlayer,
      currentBid: this.currentBid,
      hasBid: this.hasBid,
      teamSquads: this.teamSquads,
      teamPurses: this.teamPurses,
    })
    if (!check.allowed) {
      return { success: false, reason: check.message, code: check.reason }
    }
    const nextAmount = check.nextBid

    // Atomic update
    this.currentBid = nextAmount
    this.highestBidder = team
    this.highestBidderId = playerId
    this.hasBid = true
    this.timer = this.timerMode // Reset countdown clock on valid bid

    this.broadcast("bid_placed", {
      team,
      playerId,
      currentBid: this.currentBid,
      timer: this.timer,
    })

    return { success: true, currentBid: this.currentBid, highestBidder: team }
  }

  pauseAuction() {
    if (this.phase !== "ACTIVE_BIDDING") return false
    this.isPaused = true
    this.phase = "PAUSED"
    this.broadcast("auction_paused", { message: "Auction paused by host" })
    return true
  }

  resumeAuction() {
    if (this.phase !== "PAUSED") return false
    this.isPaused = false
    this.phase = "ACTIVE_BIDDING"
    this.broadcast("auction_resumed", { message: "Auction resumed by host" })
    return true
  }

  setTimerMode(seconds) {
    const mode = Number(seconds) === 5 ? 5 : 10
    this.timerMode = mode
    if (this.timer > mode) {
      this.timer = mode
    }
    this.broadcast("timer_mode_changed", { timerMode: this.timerMode })
    return true
  }

  nextPlayer() {
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout)
      this.transitionTimeout = null
    }

    const nextIndex = this.playerIndex + 1
    if (nextIndex >= this.players.length) {
      this.phase = "COMPLETED"
      this.resultSnapshot = null
      this._clearTimerLoop()
      this.broadcast("auction_completed", { message: "All players processed!" })
      return
    }

    this.playerIndex = nextIndex
    const nextPlayer = this.players[nextIndex]
    this.currentBid = nextPlayer.basePrice
    this.highestBidder = null
    this.highestBidderId = null
    this.hasBid = false
    this.timer = this.timerMode
    this.resultSnapshot = null
    this.phase = "ACTIVE_BIDDING"

    this.broadcast("next_player", {
      playerIndex: this.playerIndex,
      player: nextPlayer,
    })

    this._startTimerLoop()
  }

  cleanup() {
    this._clearTimerLoop()
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout)
      this.transitionTimeout = null
    }
  }
}
