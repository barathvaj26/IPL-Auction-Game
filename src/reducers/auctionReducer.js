import { roundCurrency } from "../utils/auctionRules.js"
import { buildSoldEvent, validateBid } from "../utils/squadRules.js"
import { attachValueToSoldEvent } from "../utils/playerValueEngine.js"
import { PLAYERS } from "../data/players.js"
import { TEAMS } from "../data/teams.js"

export const initialPurses = Object.fromEntries(
  TEAMS.map((t) => [t.code, 120.0])
)

export const initialSquads = Object.fromEntries(
  TEAMS.map((t) => [t.code, []])
)

export const createInitialState = (players = PLAYERS, initialBudget = 120.0) => {
  const customPurses = Object.fromEntries(
    TEAMS.map((t) => [t.code, Number(initialBudget) || 120.0])
  )

  const firstPlayer = players[0]

  return {
    phase: "ACTIVE_BIDDING", // "ACTIVE_BIDDING" | "PAUSED" | "SOLD" | "UNSOLD" | "COMPLETED"
    playerIndex: 0,
    players: players,
    currentBid: firstPlayer ? firstPlayer.basePrice : 2.0,
    highestBidder: null,
    hasBid: false,
    timer: 10,
    timerMode: 10,
    isPaused: false,
    resultSnapshot: null, // Immutable frozen snapshot of sold/unsold event
    auctionHistory: [],
    unsoldPlayers: [],
    teamPurses: customPurses,
    teamSquads: initialSquads,
    lastBidRejection: null, // { reason, message } from squad validation (offline mode)
  }
}

export function auctionReducer(state, action) {
  switch (action.type) {
    case "TICK": {
      if (state.phase !== "ACTIVE_BIDDING" || state.isPaused) {
        return state
      }

      // If timer is about to hit zero, resolve player
      if (state.timer <= 1) {
        const currentPlayer = state.players[state.playerIndex]
        if (!currentPlayer) {
          return { ...state, phase: "COMPLETED", timer: 0 }
        }

        if (state.hasBid && state.highestBidder) {
          // SOLD
          const winningTeam = state.highestBidder
          const finalPrice = roundCurrency(state.currentBid)
          const newPurse = roundCurrency(
            Math.max(0, (state.teamPurses[winningTeam] || 0) - finalPrice)
          )

          const soldAt = new Date().toLocaleTimeString()
          const snapshot = {
            id: `sold-${currentPlayer.id}-${Date.now()}`,
            player: { ...currentPlayer },
            amount: finalPrice,
            team: winningTeam,
            status: "sold",
            timestamp: soldAt,
            // Phase 4: same additive event+value shape as the server engine.
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

          const updatedPurses = {
            ...state.teamPurses,
            [winningTeam]: newPurse,
          }

          const updatedSquad = [
            ...(state.teamSquads[winningTeam] || []),
            {
              ...currentPlayer,
              soldPrice: finalPrice,
            },
          ]

          const updatedSquads = {
            ...state.teamSquads,
            [winningTeam]: updatedSquad,
          }

          return {
            ...state,
            phase: "SOLD",
            timer: 0,
            resultSnapshot: snapshot,
            teamPurses: updatedPurses,
            teamSquads: updatedSquads,
            auctionHistory: [snapshot, ...state.auctionHistory],
          }
        } else {
          // UNSOLD
          const snapshot = {
            id: `unsold-${currentPlayer.id}-${Date.now()}`,
            player: { ...currentPlayer },
            amount: 0,
            team: null,
            status: "unsold",
            timestamp: new Date().toLocaleTimeString(),
          }

          return {
            ...state,
            phase: "UNSOLD",
            timer: 0,
            resultSnapshot: snapshot,
            unsoldPlayers: [...state.unsoldPlayers, currentPlayer],
            auctionHistory: [snapshot, ...state.auctionHistory],
          }
        }
      }

      // Normal timer tick
      return {
        ...state,
        timer: state.timer - 1,
      }
    }

    case "PLACE_BID": {
      if (state.phase !== "ACTIVE_BIDDING" || state.isPaused) {
        return state
      }

      const { team } = action.payload
      if (!team) return state

      // Centralized squad validation (mirrors server engine).
      const check = validateBid({
        teamCode: team,
        player: state.players[state.playerIndex],
        currentBid: state.currentBid,
        hasBid: state.hasBid,
        teamSquads: state.teamSquads,
        teamPurses: state.teamPurses,
      })
      if (!check.allowed) {
        return {
          ...state,
          lastBidRejection: { reason: check.reason, message: check.message },
        }
      }

      return {
        ...state,
        currentBid: check.nextBid,
        highestBidder: team,
        hasBid: true,
        timer: state.timerMode, // Every valid bid resets the timer
        lastBidRejection: null,
      }
    }

    case "SET_PAUSED": {
      const shouldPause = action.payload !== undefined ? action.payload : !state.isPaused
      if (shouldPause) {
        return {
          ...state,
          isPaused: true,
          phase: state.phase === "ACTIVE_BIDDING" ? "PAUSED" : state.phase,
        }
      } else {
        return {
          ...state,
          isPaused: false,
          phase: state.phase === "PAUSED" ? "ACTIVE_BIDDING" : state.phase,
        }
      }
    }

    case "SET_TIMER_MODE": {
      const mode = action.payload === 5 ? 5 : 10
      return {
        ...state,
        timerMode: mode,
        timer: state.timer > mode ? mode : state.timer,
      }
    }

    case "NEXT_PLAYER": {
      // Must only be called when currently in SOLD or UNSOLD phase
      if (state.phase !== "SOLD" && state.phase !== "UNSOLD") {
        return state
      }

      const nextIndex = state.playerIndex + 1
      if (nextIndex >= state.players.length) {
        return {
          ...state,
          phase: "COMPLETED",
          resultSnapshot: null,
          highestBidder: null,
          hasBid: false,
          timer: 0,
          lastBidRejection: null,
        }
      }

      const nextPlayer = state.players[nextIndex]

      return {
        ...state,
        phase: "ACTIVE_BIDDING",
        playerIndex: nextIndex,
        currentBid: nextPlayer.basePrice,
        highestBidder: null,
        hasBid: false,
        timer: state.timerMode,
        resultSnapshot: null,
        lastBidRejection: null,
      }
    }

    case "SYNC_STATE": {
      return {
        ...state,
        ...action.payload,
        lastBidRejection: null,
      }
    }

    case "SYNC_TIMER": {
      return {
        ...state,
        timer: action.payload.timer,
      }
    }

    case "SYNC_BID": {
      return {
        ...state,
        currentBid: action.payload.currentBid,
        highestBidder: action.payload.team,
        hasBid: true,
        timer: action.payload.timer ?? state.timerMode,
        lastBidRejection: null,
      }
    }

    case "RESET_AUCTION": {
      return createInitialState(action.payload?.players || state.players)
    }

    default:
      return state
  }
}
