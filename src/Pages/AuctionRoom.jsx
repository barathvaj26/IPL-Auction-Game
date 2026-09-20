import { useEffect, useReducer, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { auctionReducer, createInitialState } from "../reducers/auctionReducer.js"
import { PLAYERS } from "../data/players.js"
import { TEAMS, TEAM_MAP } from "../data/teams.js"
import { getTeamLogo } from "../assets/teamLogos.js"
import { formatCurrency, getBidIncrement, getNextBid } from "../utils/auctionRules.js"
import { validateBid } from "../utils/squadRules.js"
import { playerImage } from "../utils/auctionPool.js"
import { socketService } from "../services/socket.js"

function AuctionRoom({
  selectedTeam = "CSK",
  budget = 120,
  roomCode = "IPL7X9",
  hostName = "Host",
  setCurrentPage,
}) {
  const initialBudgetNum = Number(budget) || 120

  const [state, dispatch] = useReducer(
    auctionReducer,
    null,
    () => createInitialState(PLAYERS, initialBudgetNum)
  )

  const [isLiveConnected, setIsLiveConnected] = useState(socketService.isConnected)

  const {
    phase,
    playerIndex,
    players,
    currentBid,
    highestBidder,
    hasBid,
    timer,
    timerMode,
    isPaused,
    resultSnapshot,
    auctionHistory,
    teamPurses,
    teamSquads,
  } = state

  const currentPlayer = players[playerIndex] || players[0]
  const userTeam = TEAM_MAP[selectedTeam] || TEAMS[0]
  const userPurse = teamPurses[selectedTeam] ?? initialBudgetNum

  // 1. Socket Synchronization
  useEffect(() => {
    socketService.connect()

    const unregConn = socketService.on("connection_change", (conn) => {
      setIsLiveConnected(conn)
    })

    const unregTick = socketService.on("auction_tick", (data) => {
      dispatch({ type: "SYNC_TIMER", payload: data })
    })

    const unregBid = socketService.on("bid_placed", (data) => {
      dispatch({ type: "SYNC_BID", payload: data })
    })

    const unregSold = socketService.on("player_sold", (data) => {
      if (data.state) dispatch({ type: "SYNC_STATE", payload: data.state })
    })

    const unregUnsold = socketService.on("player_unsold", (data) => {
      if (data.state) dispatch({ type: "SYNC_STATE", payload: data.state })
    })

    const unregNext = socketService.on("next_player", (data) => {
      if (data.state) dispatch({ type: "SYNC_STATE", payload: data.state })
    })

    const unregPause = socketService.on("auction_paused", () => {
      dispatch({ type: "SET_PAUSED", payload: true })
    })

    const unregResume = socketService.on("auction_resumed", () => {
      dispatch({ type: "SET_PAUSED", payload: false })
    })

    const unregTimerMode = socketService.on("timer_mode_changed", (data) => {
      dispatch({ type: "SET_TIMER_MODE", payload: data.timerMode })
    })

    const unregUpdate = socketService.on("room_updated", (room) => {
      if (room?.auctionState) {
        dispatch({ type: "SYNC_STATE", payload: room.auctionState })
      }
    })

    return () => {
      unregConn()
      unregTick()
      unregBid()
      unregSold()
      unregUnsold()
      unregNext()
      unregPause()
      unregResume()
      unregTimerMode()
      unregUpdate()
    }
  }, [])

  // 2. Authoritative Timer Effect (Runs locally ONLY when offline/disconnected)
  useEffect(() => {
    if (isLiveConnected) return // Server clock drives the timer!
    if (phase !== "ACTIVE_BIDDING" || isPaused) return

    const intervalId = setInterval(() => {
      dispatch({ type: "TICK" })
    }, 1000)

    return () => clearInterval(intervalId)
  }, [phase, isPaused, isLiveConnected])

  // 3. Automated Progression to Next Player upon SOLD or UNSOLD (Runs locally ONLY when offline)
  useEffect(() => {
    if (isLiveConnected) return // Server controls automated progression!

    if (phase === "SOLD") {
      const timerId = setTimeout(() => {
        dispatch({ type: "NEXT_PLAYER" })
      }, 3000)
      return () => clearTimeout(timerId)
    }

    if (phase === "UNSOLD") {
      const timerId = setTimeout(() => {
        dispatch({ type: "NEXT_PLAYER" })
      }, 2200)
      return () => clearTimeout(timerId)
    }
  }, [phase, isLiveConnected])

  // Bid calculations
  const nextBidAmount = useMemo(() => {
    return hasBid ? getNextBid(currentBid) : currentBid
  }, [hasBid, currentBid])

  const incrementAmount = useMemo(() => {
    return getBidIncrement(currentBid)
  }, [currentBid])

  // Squad-aware bid eligibility (purse + squad size + overseas + duplicate).
  const squadCheck = useMemo(() => {
    return validateBid({
      teamCode: selectedTeam,
      player: currentPlayer,
      currentBid,
      hasBid,
      teamSquads,
      teamPurses,
    })
  }, [selectedTeam, currentPlayer, currentBid, hasBid, teamSquads, teamPurses])

  const canUserBid = useMemo(() => {
    if (phase !== "ACTIVE_BIDDING" || isPaused) return false
    return squadCheck.allowed
  }, [phase, isPaused, squadCheck])

  const handlePlaceBid = async () => {
    if (!canUserBid) return
    if (isLiveConnected && roomCode) {
      const res = await socketService.placeBid({ roomCode, team: selectedTeam })
      if (res && !res.success && res.reason) {
        alert(res.reason)
      }
    } else {
      dispatch({ type: "PLACE_BID", payload: { team: selectedTeam } })
    }
  }

  const handleTogglePause = () => {
    if (isLiveConnected && roomCode) {
      if (isPaused) socketService.resumeAuction({ roomCode })
      else socketService.pauseAuction({ roomCode })
    } else {
      dispatch({ type: "SET_PAUSED", payload: !isPaused })
    }
  }

  const handleChangeTimerMode = (mode) => {
    if (isLiveConnected && roomCode) {
      socketService.changeTimerMode({ roomCode, timerMode: mode })
    } else {
      dispatch({ type: "SET_TIMER_MODE", payload: mode })
    }
  }

  const roleColors = {
    BATTER: { bg: "rgba(59, 130, 246, 0.2)", text: "#60a5fa", border: "#3b82f6" },
    BOWLER: { bg: "rgba(239, 68, 68, 0.2)", text: "#f87171", border: "#ef4444" },
    ALL_ROUNDER: { bg: "rgba(168, 85, 247, 0.2)", text: "#c084fc", border: "#a855f7" },
    WICKET_KEEPER: { bg: "rgba(34, 197, 94, 0.2)", text: "#4ade80", border: "#22c55e" },
  }

  const currentRoleStyle =
    roleColors[currentPlayer?.role] || roleColors.BATTER

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 10%, #1e1b4b 0%, #030712 100%)",
        color: "#f8fafc",
        padding: "24px 36px",
        fontFamily: "'Segoe UI', Roboto, sans-serif",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* BACKGROUND AMBIENT GLOW */}
      <div
        style={{
          position: "fixed",
          top: "-200px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "900px",
          height: "600px",
          background: "radial-gradient(circle, rgba(124, 58, 237, 0.15) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* TOP BROADCAST BAR */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: "20px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "28px",
          position: "relative",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              background: "linear-gradient(135deg, #7c3aed, #2563eb)",
              padding: "10px 18px",
              borderRadius: "14px",
              boxShadow: "0 0 20px rgba(124, 58, 237, 0.4)",
            }}
          >
            <span style={{ fontSize: "11px", letterSpacing: "2px", fontWeight: "bold" }}>
              IPL WAR ROOM
            </span>
            <div style={{ fontSize: "20px", fontWeight: "900", letterSpacing: "1px" }}>
              {roomCode}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 style={{ margin: 0, fontSize: "26px", fontWeight: "800", letterSpacing: "-0.5px" }}>
                Premier Cricket Auction
              </h1>
              <span
                style={{
                  background: isPaused ? "#ef4444" : "#22c55e",
                  fontSize: "11px",
                  fontWeight: "bold",
                  padding: "4px 10px",
                  borderRadius: "20px",
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                }}
              >
                {isPaused ? "Paused" : "Live"}
              </span>
            </div>
            <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "13px" }}>
              Host: <strong style={{ color: "#e2e8f0" }}>{hostName}</strong> • Player {playerIndex + 1} of {players.length}
              {currentPlayer?.category && (
                <span style={{ marginLeft: "8px", color: "#a855f7", fontWeight: "700" }}>
                  [{currentPlayer.category.replace("_", " ")}]
                </span>
              )}
            </p>
          </div>
        </div>

        {/* USER FRANCHISE BADGE & PURSE */}
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              background: "rgba(255, 255, 255, 0.05)",
              backdropFilter: "blur(16px)",
              padding: "8px 20px",
              borderRadius: "18px",
              border: `1px solid ${userTeam.primaryColor}55`,
              boxShadow: `0 0 25px ${userTeam.primaryColor}22`,
            }}
          >
            <img
              src={getTeamLogo(selectedTeam)}
              alt={selectedTeam}
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "12px",
                objectFit: "contain",
              }}
            />
            <div>
              <div style={{ fontSize: "11px", color: "#94a3b8", letterSpacing: "1px" }}>
                YOUR PURSE ({selectedTeam})
              </div>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: "800",
                  color: userPurse < 10 ? "#ef4444" : "#38bdf8",
                }}
              >
                {formatCurrency(userPurse)}
              </div>
            </div>
          </div>

          {setCurrentPage && (
            <button
              onClick={() => setCurrentPage("lobby")}
              style={{
                padding: "10px 16px",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.05)",
                color: "#cbd5e1",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "600",
              }}
            >
              Exit to Lobby
            </button>
          )}
        </div>
      </header>

      {/* MAIN AUCTION BROADCAST GRID */}
      <main
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: "28px",
          position: "relative",
          zIndex: 5,
        }}
      >
        {/* LEFT COLUMN: ACTIVE PLAYER & BIDDING CONSOLE */}
        <section style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* PLAYER CARD */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.75)",
              backdropFilter: "blur(20px)",
              borderRadius: "28px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "32px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              display: "flex",
              gap: "32px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* OVERSEAS / DOMESTIC BADGE */}
            <div
              style={{
                position: "absolute",
                top: "20px",
                right: "24px",
                display: "flex",
                gap: "8px",
              }}
            >
              <span
                style={{
                  background: currentRoleStyle.bg,
                  color: currentRoleStyle.text,
                  border: `1px solid ${currentRoleStyle.border}`,
                  padding: "6px 14px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  fontWeight: "700",
                  letterSpacing: "0.5px",
                }}
              >
                {currentPlayer.role.replace("_", " ")}
              </span>

              <span
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "#cbd5e1",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  fontWeight: "600",
                }}
              >
                {currentPlayer.isOverseas ? "✈️ Overseas" : "🇮🇳 India"}
              </span>
            </div>

            {/* PLAYER HEADSHOT */}
            <div
              style={{
                position: "relative",
                width: "220px",
                height: "260px",
                borderRadius: "20px",
                background: "linear-gradient(180deg, rgba(30, 41, 59, 0.5) 0%, #0f172a 100%)",
                border: "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <img
                src={playerImage(currentPlayer)}
                alt={currentPlayer.name}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "top",
                }}
              />
            </div>

            {/* PLAYER INFO & STATS */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
              <div>
                <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "4px", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  {currentPlayer.isCapped === false ? "⭐ Uncapped Talent" : currentPlayer.category === "MARQUEE" ? "🔥 Marquee Player" : currentPlayer.category?.replace("_", " ") || "Player"}
                </div>
                <h2 style={{ fontSize: "38px", margin: "0 0 8px", fontWeight: "900", letterSpacing: "-0.5px" }}>
                  {currentPlayer.name}
                </h2>
                <p style={{ margin: "0 0 20px", color: "#94a3b8", fontSize: "14px" }}>
                  {currentPlayer.country}{currentPlayer.age ? ` • Age ${currentPlayer.age}` : ""} • Previous Franchise: <strong>{currentPlayer.previousTeam}</strong>
                </p>

                {/* STATS TILES */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                  <div
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      padding: "12px",
                      borderRadius: "14px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>MATCHES</div>
                    <div style={{ fontSize: "18px", fontWeight: "700", marginTop: "2px" }}>
                      {currentPlayer.matches}
                    </div>
                  </div>

                  <div
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      padding: "12px",
                      borderRadius: "14px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                      {currentPlayer.role === "BOWLER" ? "WICKETS" : "RUNS"}
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: "700", marginTop: "2px" }}>
                      {currentPlayer.role === "BOWLER" ? currentPlayer.wickets : currentPlayer.runs}
                    </div>
                  </div>

                  <div
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      padding: "12px",
                      borderRadius: "14px",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                      {currentPlayer.role === "BOWLER" ? "ECONOMY" : "STRIKE RATE"}
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: "700", marginTop: "2px" }}>
                      {currentPlayer.role === "BOWLER" ? currentPlayer.economy : currentPlayer.strikeRate}
                    </div>
                  </div>
                </div>
              </div>

              {/* BASE PRICE TAG */}
              <div style={{ marginTop: "18px" }}>
                <span style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px" }}>
                  Base Reserve Price:
                </span>
                <span style={{ marginLeft: "10px", fontSize: "18px", fontWeight: "800", color: "#f8fafc" }}>
                  {formatCurrency(currentPlayer.basePrice)}
                </span>
              </div>
            </div>
          </div>

          {/* BIDDING CONSOLE */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.85)",
              backdropFilter: "blur(20px)",
              borderRadius: "28px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "28px 36px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.3fr 1fr",
                gap: "24px",
                alignItems: "center",
                marginBottom: "24px",
              }}
            >
              {/* CURRENT BID VALUE */}
              <div>
                <span style={{ fontSize: "12px", letterSpacing: "2px", color: "#94a3b8", fontWeight: "700" }}>
                  {hasBid ? "CURRENT HIGHEST BID" : "OPENING BASE BID"}
                </span>
                <div
                  style={{
                    fontSize: "56px",
                    fontWeight: "900",
                    color: "#a855f7",
                    letterSpacing: "-1px",
                    lineHeight: 1.1,
                    textShadow: "0 0 30px rgba(168, 85, 247, 0.35)",
                    marginTop: "6px",
                  }}
                >
                  {formatCurrency(currentBid)}
                </div>
              </div>

              {/* HIGHEST BIDDER BROADCAST LOGO */}
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "20px",
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                }}
              >
                {highestBidder ? (
                  <>
                    <img
                      src={getTeamLogo(highestBidder)}
                      alt={highestBidder}
                      style={{
                        width: "60px",
                        height: "60px",
                        borderRadius: "14px",
                        objectFit: "contain",
                        boxShadow: "0 0 20px rgba(255,255,255,0.1)",
                      }}
                    />
                    <div>
                      <div style={{ fontSize: "11px", color: "#22c55e", fontWeight: "700", letterSpacing: "1px" }}>
                        LEADING BIDDER
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: "800", color: "white" }}>
                        {TEAM_MAP[highestBidder]?.name || highestBidder}
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: "center", width: "100%", color: "#94a3b8", padding: "10px 0" }}>
                    <span style={{ fontSize: "24px", display: "block", marginBottom: "4px" }}>🏏</span>
                    <span style={{ fontSize: "13px", fontWeight: "600" }}>No Bids Placed Yet</span>
                  </div>
                )}
              </div>
            </div>

            {/* ACTION BUTTON & BID INCREMENT */}
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <motion.button
                whileHover={canUserBid ? { scale: 1.02 } : {}}
                whileTap={canUserBid ? { scale: 0.97 } : {}}
                onClick={handlePlaceBid}
                disabled={!canUserBid}
                style={{
                  flex: 1,
                  padding: "20px",
                  borderRadius: "18px",
                  border: "none",
                  background: canUserBid
                    ? "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)"
                    : "#334155",
                  color: canUserBid ? "white" : "#94a3b8",
                  fontSize: "20px",
                  fontWeight: "800",
                  cursor: canUserBid ? "pointer" : "not-allowed",
                  boxShadow: canUserBid ? "0 10px 30px rgba(124, 58, 237, 0.4)" : "none",
                  transition: "all 0.2s ease",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span>BID FOR {selectedTeam}</span>
                <span
                  style={{
                    background: "rgba(0,0,0,0.25)",
                    padding: "4px 12px",
                    borderRadius: "10px",
                    fontSize: "16px",
                  }}
                >
                  +{formatCurrency(incrementAmount)}
                </span>
              </motion.button>
            </div>

            {/* PURSE INSUFFICIENCY WARNING */}
            {!canUserBid && phase === "ACTIVE_BIDDING" && userPurse < nextBidAmount && (
              <p style={{ color: "#ef4444", fontSize: "13px", margin: "12px 0 0", textAlign: "center" }}>
                ⚠️ Next bid of {formatCurrency(nextBidAmount)} exceeds your franchise purse of {formatCurrency(userPurse)}.
              </p>
            )}
            {/* SQUAD RULE REJECTION (overseas / full / duplicate) */}
            {!canUserBid && phase === "ACTIVE_BIDDING" && userPurse >= nextBidAmount && !squadCheck.allowed && (
              <p style={{ color: "#f59e0b", fontSize: "13px", margin: "12px 0 0", textAlign: "center" }}>
                ⚠️ {squadCheck.message}
              </p>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: TIMER, HOST CONTROLS & LIVE TEAM PURSES */}
        <section style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* SYNCHRONIZED TIMER CARD */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.75)",
              backdropFilter: "blur(20px)",
              borderRadius: "28px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "28px",
              textAlign: "center",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ fontSize: "12px", letterSpacing: "2px", color: "#94a3b8", fontWeight: "700" }}>
              AUCTION HAMMER CLOCK
            </div>

            <motion.div
              animate={timer <= 3 && phase === "ACTIVE_BIDDING" ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.6, repeat: Infinity }}
              style={{
                fontSize: "80px",
                fontWeight: "900",
                color: timer <= 3 ? "#ef4444" : "#f8fafc",
                textShadow: timer <= 3 ? "0 0 35px rgba(239, 68, 68, 0.6)" : "none",
                lineHeight: 1.1,
                margin: "12px 0",
              }}
            >
              {timer}s
            </motion.div>

            <div style={{ fontSize: "13px", color: "#94a3b8" }}>
              {isPaused
                ? "⏸ Auction is currently paused"
                : timer <= 3
                ? "⚠️ FINAL SECONDS! Place bids now!"
                : "Timer automatically resets on each bid"}
            </div>
          </div>

          {/* HOST CONTROLS */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.75)",
              backdropFilter: "blur(20px)",
              borderRadius: "24px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "20px 24px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "1.5px",
                color: "#94a3b8",
                fontWeight: "700",
                marginBottom: "14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>HOST CONTROLS</span>
              <span style={{ color: "#a855f7", fontWeight: "bold" }}>👑 {hostName}</span>
            </div>

            {/* PAUSE / RESUME */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
              <button
                onClick={handleTogglePause}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "12px",
                  border: "none",
                  background: isPaused ? "#22c55e" : "#eab308",
                  color: "#0f172a",
                  fontWeight: "800",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                {isPaused ? "▶ Resume Auction" : "⏸ Pause Auction"}
              </button>
            </div>

            {/* TIMER MODE SELECTOR */}
            <div>
              <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "8px" }}>
                TIMER RESET DURATION:
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => handleChangeTimerMode(5)}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "10px",
                    border: timerMode === 5 ? "2px solid #7c3aed" : "1px solid rgba(255,255,255,0.1)",
                    background: timerMode === 5 ? "rgba(124, 58, 237, 0.3)" : "rgba(255,255,255,0.05)",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: "700",
                    fontSize: "13px",
                  }}
                >
                  ⚡ 5s (Fast)
                </button>

                <button
                  onClick={() => handleChangeTimerMode(10)}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "10px",
                    border: timerMode === 10 ? "2px solid #7c3aed" : "1px solid rgba(255,255,255,0.1)",
                    background: timerMode === 10 ? "rgba(124, 58, 237, 0.3)" : "rgba(255,255,255,0.05)",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: "700",
                    fontSize: "13px",
                  }}
                >
                  ⏱ 10s (Standard)
                </button>
              </div>
            </div>
          </div>

          {/* TEAM BUDGETS OVERVIEW */}
          <div
            style={{
              background: "rgba(15, 23, 42, 0.75)",
              backdropFilter: "blur(20px)",
              borderRadius: "24px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "20px 24px",
              maxHeight: "260px",
              overflowY: "auto",
            }}
          >
            <div style={{ fontSize: "12px", letterSpacing: "1.5px", color: "#94a3b8", fontWeight: "700", marginBottom: "12px" }}>
              FRANCHISE PURSES ({TEAMS.length} TEAMS)
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {TEAMS.map((team) => {
                const purseVal = teamPurses[team.code] ?? initialBudgetNum
                const squadCount = teamSquads[team.code]?.length || 0
                return (
                  <div
                    key={team.code}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      borderRadius: "10px",
                      background: team.code === selectedTeam ? "rgba(124, 58, 237, 0.15)" : "rgba(255,255,255,0.02)",
                      border: team.code === selectedTeam ? "1px solid rgba(124, 58, 237, 0.4)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <img
                        src={getTeamLogo(team.code)}
                        alt={team.code}
                        style={{ width: "24px", height: "24px", borderRadius: "6px", objectFit: "contain" }}
                      />
                      <span style={{ fontSize: "13px", fontWeight: "700" }}>{team.code}</span>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>({squadCount} bought)</span>
                    </div>

                    <span style={{ fontSize: "14px", fontWeight: "800", color: purseVal < 10 ? "#ef4444" : "#38bdf8" }}>
                      {formatCurrency(purseVal)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </main>

      {/* LOWER SECTION: SQUAD DRAWER & LIVE HISTORY FEED */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "28px",
          marginTop: "28px",
          position: "relative",
          zIndex: 5,
        }}
      >
        {/* CURRENT FRANCHISE SQUAD */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(20px)",
            borderRadius: "24px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "24px",
          }}
        >
          <h3 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: "800" }}>
            🛡️ {selectedTeam} Squad ({teamSquads[selectedTeam]?.length || 0})
          </h3>

          {!teamSquads[selectedTeam] || teamSquads[selectedTeam].length === 0 ? (
            <p style={{ color: "#64748b", fontSize: "14px", fontStyle: "italic" }}>
              No players purchased yet. Bid when player appears!
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "200px", overflowY: "auto" }}>
              {teamSquads[selectedTeam].map((player, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "12px",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: "14px" }}>{player.name}</strong>
                    <span style={{ color: "#94a3b8", fontSize: "12px", marginLeft: "8px" }}>
                      {player.role}
                    </span>
                  </div>
                  <span style={{ color: "#22c55e", fontWeight: "700", fontSize: "14px" }}>
                    {formatCurrency(player.soldPrice)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* LIVE AUCTION HISTORY FEED */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(20px)",
            borderRadius: "24px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "24px",
          }}
        >
          <h3 style={{ margin: "0 0 16px", fontSize: "18px", fontWeight: "800" }}>
            📜 Live Auction Feed
          </h3>

          {auctionHistory.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: "14px", fontStyle: "italic" }}>
              Awaiting first completed auction transaction...
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "200px", overflowY: "auto" }}>
              {auctionHistory.slice(0, 15).map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "12px",
                    borderLeft: item.status === "sold" ? "4px solid #22c55e" : "4px solid #ef4444",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {item.status === "sold" ? (
                      <>
                        <img
                          src={getTeamLogo(item.team)}
                          alt={item.team}
                          style={{ width: "24px", height: "24px", borderRadius: "6px", objectFit: "contain" }}
                        />
                        <div>
                          <strong style={{ fontSize: "14px" }}>{item.player.name}</strong>
                          <span style={{ color: "#94a3b8", fontSize: "12px", marginLeft: "6px" }}>
                            sold to {item.team}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div>
                        <strong style={{ fontSize: "14px" }}>{item.player.name}</strong>
                        <span style={{ color: "#ef4444", fontSize: "12px", marginLeft: "6px", fontWeight: "bold" }}>
                          UNSOLD
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: item.status === "sold" ? "#22c55e" : "#94a3b8", fontWeight: "700", fontSize: "14px" }}>
                      {item.status === "sold" ? formatCurrency(item.amount) : "Reserve Unmet"}
                    </div>
                    <div style={{ fontSize: "10px", color: "#64748b" }}>{item.timestamp}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SOLD BROADCAST OVERLAY (USES IMMUTABLE RESULT SNAPSHOT) */}
      <AnimatePresence>
        {phase === "SOLD" && resultSnapshot && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2, 6, 23, 0.88)",
              backdropFilter: "blur(16px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div
              style={{
                background: "linear-gradient(180deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)",
                border: "2px solid #22c55e",
                borderRadius: "32px",
                padding: "48px 64px",
                textAlign: "center",
                boxShadow: "0 0 80px rgba(34, 197, 94, 0.35)",
                maxWidth: "540px",
                width: "90%",
              }}
            >
              <div
                style={{
                  color: "#22c55e",
                  fontSize: "14px",
                  letterSpacing: "3px",
                  fontWeight: "900",
                  textTransform: "uppercase",
                  marginBottom: "16px",
                }}
              >
                AUCTION HAMMER HAS FALLEN
              </div>

              <img
                src={getTeamLogo(resultSnapshot.team)}
                alt={resultSnapshot.team}
                style={{
                  width: "110px",
                  height: "110px",
                  objectFit: "contain",
                  marginBottom: "20px",
                  filter: "drop-shadow(0 0 25px rgba(255,255,255,0.2))",
                }}
              />

              <h2 style={{ fontSize: "36px", margin: "0 0 8px", fontWeight: "900" }}>
                {resultSnapshot.player.name}
              </h2>

              <div style={{ fontSize: "16px", color: "#94a3b8", marginBottom: "20px" }}>
                Acquired by <strong style={{ color: "#f8fafc" }}>{TEAM_MAP[resultSnapshot.team]?.name}</strong>
              </div>

              <div
                style={{
                  background: "rgba(34, 197, 94, 0.15)",
                  border: "1px solid rgba(34, 197, 94, 0.3)",
                  padding: "16px 28px",
                  borderRadius: "20px",
                  display: "inline-block",
                }}
              >
                <div style={{ fontSize: "11px", color: "#86efac", fontWeight: "700", letterSpacing: "1px" }}>
                  FINAL SALE PRICE
                </div>
                <div style={{ fontSize: "40px", fontWeight: "900", color: "#22c55e" }}>
                  {formatCurrency(resultSnapshot.amount)}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* UNSOLD BROADCAST OVERLAY (USES IMMUTABLE RESULT SNAPSHOT) */}
      <AnimatePresence>
        {phase === "UNSOLD" && resultSnapshot && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ duration: 0.3 }}
            style={{
              position: "fixed",
              bottom: "40px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              borderRadius: "20px",
              padding: "18px 36px",
              textAlign: "center",
              boxShadow: "0 10px 40px rgba(0,0,0,0.7), 0 0 25px rgba(239, 68, 68, 0.25)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.2)",
                color: "#ef4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                fontWeight: "bold",
              }}
            >
              ✕
            </div>

            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: "18px", fontWeight: "800" }}>
                {resultSnapshot.player.name} went <span style={{ color: "#ef4444" }}>UNSOLD</span>
              </div>
              <div style={{ fontSize: "13px", color: "#94a3b8" }}>
                Reserve base price of {formatCurrency(resultSnapshot.player.basePrice)} was not met.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AUCTION COMPLETED SCREEN */}
      {phase === "COMPLETED" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.94)",
            backdropFilter: "blur(20px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "40px",
          }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{
              background: "rgba(15, 23, 42, 0.9)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "32px",
              padding: "48px",
              textAlign: "center",
              maxWidth: "600px",
              width: "100%",
            }}
          >
            <div style={{ fontSize: "52px", marginBottom: "12px" }}>🏆</div>
            <h2 style={{ fontSize: "36px", fontWeight: "900", margin: "0 0 10px" }}>
              AUCTION CONCLUDED
            </h2>
            <p style={{ color: "#94a3b8", fontSize: "16px", marginBottom: "30px" }}>
              All players in this pool have been processed. Squads and final purses have been locked.
            </p>

            <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
              <button
                onClick={() => dispatch({ type: "RESET_AUCTION" })}
                style={{
                  padding: "14px 28px",
                  borderRadius: "14px",
                  border: "none",
                  background: "linear-gradient(135deg, #7c3aed, #2563eb)",
                  color: "white",
                  fontSize: "16px",
                  fontWeight: "800",
                  cursor: "pointer",
                }}
              >
                Restart Auction
              </button>

              {setCurrentPage && (
                <button
                  onClick={() => setCurrentPage("lobby")}
                  style={{
                    padding: "14px 28px",
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.05)",
                    color: "white",
                    fontSize: "16px",
                    fontWeight: "800",
                    cursor: "pointer",
                  }}
                >
                  Return to Lobby
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

export default AuctionRoom