import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { socketService } from "../services/socket.js"
import { getTeamLogo } from "../assets/teamLogos.js"
import { TEAM_MAP } from "../data/teams.js"

function InfoCard({ title, value }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(20px)",
        padding: "20px",
        borderRadius: "20px",
        border: "1px solid rgba(255,255,255,0.08)",
        textAlign: "center",
        boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
      }}
    >
      <p
        style={{
          color: "#94a3b8",
          fontSize: "12px",
          marginBottom: "6px",
          letterSpacing: "2px",
          fontWeight: "700",
        }}
      >
        {title}
      </p>

      <h2
        style={{
          margin: 0,
          color: "white",
          fontSize: "24px",
          fontWeight: "800",
        }}
      >
        {value}
      </h2>
    </div>
  )
}

function Lobby({
  roomCode,
  roomName,
  teams,
  budget,
  auctionType,
  hostName,
  isHost = true,
  selectedTeam,
  setCurrentPage,
}) {
  const [roomData, setRoomData] = useState(null)
  const [copied, setCopied] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const [isStarting, setIsStarting] = useState(false)

  const myPlayerId = socketService.playerIdentity.playerId

  // Listen to real-time room updates from socket
  useEffect(() => {
    socketService.connect()

    const unregUpdate = socketService.on("room_updated", (updated) => {
      setRoomData(updated)
    })

    const unregStarted = socketService.on("auction_started", () => {
      setCurrentPage("auctionRoom")
    })

    const unregKicked = socketService.on("kicked", (data) => {
      alert(data.message || "You were removed from the room by the host.")
      setCurrentPage("home")
    })

    return () => {
      unregUpdate()
      unregStarted()
      unregKicked()
    }
  }, [setCurrentPage])

  const playersList = roomData?.players || []
  const currentHost = roomData?.host?.name || hostName || "Host"
  const maxTeams = roomData?.settings?.teamsCount || Number(teams) || 10
  const roomBudget = roomData?.settings?.budget || budget || 120
  const currentType = roomData?.settings?.auctionType || auctionType || "Mega Auction"

  // Check if current user is host in room data
  const userIsHost = isHost || (roomData?.host?.id === myPlayerId)

  // Current user's player record
  const myPlayerRecord = playersList.find((p) => p.id === myPlayerId)
  const myAssignedTeam = myPlayerRecord?.team || selectedTeam

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleToggleReady = async () => {
    if (!myAssignedTeam) {
      setStatusMessage("Please select a franchise team before marking ready!")
      return
    }
    await socketService.toggleReady({ roomCode })
  }

  const handleStartAuction = async () => {
    if (!userIsHost || isStarting) return
    setStatusMessage("")
    if (!socketService.isConnected || !roomCode) {
      setStatusMessage("Not connected to the live server. Start the backend (npm run server) and retry.")
      return
    }
    setIsStarting(true)
    try {
      const res = await socketService.startAuction({ roomCode })
      if (res && res.success) {
        // Navigate immediately; AuctionRoom syncs via room_updated / initial state.
        // The auction_started broadcast below is a second trigger for other clients.
        setCurrentPage("auctionRoom")
      } else if (res && res.alreadyStarted) {
        setCurrentPage("auctionRoom")
      } else {
        setStatusMessage(res?.error || "Failed to start auction. Please retry.")
      }
    } catch (err) {
      setStatusMessage(err?.message || "Failed to start auction. Please retry.")
    } finally {
      setIsStarting(false)
    }
  }

  const handleKick = async (targetId) => {
    if (!userIsHost) return
    await socketService.kickPlayer({ roomCode, targetPlayerId: targetId })
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 15%, #1e1b4b 0%, #020617 80%, #000000 100%)",
        color: "white",
        padding: "40px",
        overflowX: "hidden",
        position: "relative",
        fontFamily: "'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* GLOW EFFECT */}
      <div
        style={{
          position: "absolute",
          width: "900px",
          height: "900px",
          borderRadius: "50%",
          background: "#7c3aed",
          filter: "blur(280px)",
          opacity: 0.14,
          top: "-300px",
          left: "50%",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ maxWidth: "1100px", margin: "0 auto", position: "relative", zIndex: 5 }}>
        {/* HEADER */}
        <motion.h1
          animate={{
            textShadow: [
              "0 0 20px #7c3aed",
              "0 0 50px #2563eb",
              "0 0 20px #7c3aed",
            ],
          }}
          transition={{ duration: 4, repeat: Infinity }}
          style={{
            textAlign: "center",
            fontSize: "52px",
            fontWeight: "900",
            letterSpacing: "-0.5px",
            marginBottom: "8px",
          }}
        >
          🏆 IPL AUCTION WAR ROOM
        </motion.h1>

        <p style={{ textAlign: "center", color: "#94a3b8", fontSize: "17px", marginBottom: "32px" }}>
          {roomName || "IPL Championship Auction"} • Waiting for Franchise Owners
        </p>

        {/* INFO CARDS */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "20px",
            marginBottom: "36px",
          }}
        >
          {/* ROOM CODE CARD WITH COPY */}
          <div
            onClick={handleCopyCode}
            style={{
              background: "rgba(124, 58, 237, 0.15)",
              backdropFilter: "blur(20px)",
              padding: "20px",
              borderRadius: "20px",
              border: "1px solid rgba(124, 58, 237, 0.4)",
              textAlign: "center",
              cursor: "pointer",
              boxShadow: "0 0 30px rgba(124, 58, 237, 0.25)",
            }}
          >
            <p style={{ color: "#c084fc", fontSize: "11px", letterSpacing: "2px", margin: "0 0 6px", fontWeight: "700" }}>
              ROOM CODE (CLICK TO COPY)
            </p>
            <div style={{ fontSize: "28px", fontWeight: "900", letterSpacing: "3px", color: "white" }}>
              {roomCode}
            </div>
            <span style={{ fontSize: "12px", color: copied ? "#22c55e" : "#a855f7", fontWeight: "600" }}>
              {copied ? "✓ Copied to Clipboard!" : "Tap to Copy Code"}
            </span>
          </div>

          <InfoCard title="TARGET TEAMS" value={`${playersList.length + 1} / ${maxTeams}`} />
          <InfoCard title="PURSE BUDGET" value={`₹ ${roomBudget} Cr`} />
          <InfoCard title="AUCTION TYPE" value={currentType} />
        </div>

        {/* FRANCHISE OWNERS SECTION */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(20px)",
            padding: "28px",
            borderRadius: "24px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            marginBottom: "32px",
            boxShadow: "0 15px 40px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "800", margin: 0 }}>
              👥 Connected Franchise Owners ({playersList.length + 1})
            </h2>

            {/* TEAM SELECTION SHORTCUT */}
            <button
              onClick={() => setCurrentPage("teamSelection")}
              style={{
                padding: "10px 18px",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.08)",
                color: "white",
                cursor: "pointer",
                fontWeight: "700",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>🏏</span>
              <span>{myAssignedTeam ? `Team: ${myAssignedTeam} (Change)` : "Choose Franchise Team"}</span>
            </button>
          </div>

          {/* HOST ROW */}
          <div
            style={{
              background: "linear-gradient(90deg, rgba(234, 179, 8, 0.15) 0%, rgba(15, 23, 42, 0.6) 100%)",
              border: "1px solid rgba(234, 179, 8, 0.3)",
              borderLeft: "6px solid #eab308",
              padding: "16px 20px",
              borderRadius: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "24px" }}>👑</span>
              <div>
                <strong style={{ fontSize: "16px" }}>{currentHost}</strong>
                <span style={{ color: "#eab308", fontSize: "12px", marginLeft: "8px", fontWeight: "bold" }}>
                  ROOM HOST (Auctioneer)
                </span>
              </div>
            </div>

            <span
              style={{
                background: "rgba(234, 179, 8, 0.2)",
                color: "#fde047",
                padding: "4px 12px",
                borderRadius: "20px",
                fontSize: "12px",
                fontWeight: "700",
              }}
            >
              Auctioneer
            </span>
          </div>

          {/* PLAYER ROWS */}
          {playersList.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "#64748b" }}>
              <p style={{ margin: 0, fontSize: "15px" }}>
                Waiting for other players to join using room code <strong>{roomCode}</strong>...
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {playersList.map((player) => (
                <div
                  key={player.id}
                  style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderLeft: player.isReady ? "6px solid #22c55e" : "6px solid #7c3aed",
                    padding: "14px 20px",
                    borderRadius: "16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {player.team ? (
                      <img
                        src={getTeamLogo(player.team)}
                        alt={player.team}
                        style={{ width: "32px", height: "32px", borderRadius: "8px", objectFit: "contain" }}
                      />
                    ) : (
                      <span style={{ fontSize: "20px" }}>🏏</span>
                    )}

                    <div>
                      <strong style={{ fontSize: "15px" }}>{player.name}</strong>
                      <span style={{ color: "#94a3b8", fontSize: "13px", marginLeft: "10px" }}>
                        {player.team ? TEAM_MAP[player.team]?.name || player.team : "No Team Selected"}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span
                      style={{
                        background: player.isReady ? "rgba(34, 197, 94, 0.2)" : "rgba(124, 58, 237, 0.2)",
                        color: player.isReady ? "#4ade80" : "#c084fc",
                        padding: "4px 12px",
                        borderRadius: "20px",
                        fontSize: "12px",
                        fontWeight: "700",
                      }}
                    >
                      {player.isReady ? "✓ READY" : "NOT READY"}
                    </span>

                    {userIsHost && player.id !== myPlayerId && (
                      <button
                        onClick={() => handleKick(player.id)}
                        style={{
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          color: "#f87171",
                          borderRadius: "8px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          fontWeight: "bold",
                          cursor: "pointer",
                        }}
                      >
                        Kick
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* STATUS MESSAGE */}
        {statusMessage && (
          <p style={{ color: "#ef4444", textAlign: "center", fontWeight: "600", marginBottom: "16px" }}>
            {statusMessage}
          </p>
        )}

        {/* ACTION BUTTONS */}
        <div style={{ display: "flex", gap: "20px" }}>
          {!userIsHost && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleToggleReady}
              style={{
                flex: 1,
                padding: "18px",
                borderRadius: "18px",
                border: "none",
                background: myPlayerRecord?.isReady
                  ? "rgba(239, 68, 68, 0.3)"
                  : "linear-gradient(135deg, #10b981, #059669)",
                color: "white",
                fontSize: "18px",
                fontWeight: "800",
                cursor: "pointer",
              }}
            >
              {myPlayerRecord?.isReady ? "Unmark Ready" : "Mark Ready ✓"}
            </motion.button>
          )}

          {userIsHost ? (
            <motion.button
              whileHover={isStarting ? {} : { scale: 1.02 }}
              whileTap={isStarting ? {} : { scale: 0.98 }}
              onClick={handleStartAuction}
              disabled={isStarting}
              style={{
                flex: 2,
                padding: "20px",
                borderRadius: "18px",
                border: "none",
                background: isStarting
                  ? "#475569"
                  : "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                color: "white",
                fontSize: "22px",
                fontWeight: "900",
                cursor: isStarting ? "not-allowed" : "pointer",
                boxShadow: "0 10px 30px rgba(124, 58, 237, 0.5)",
                letterSpacing: "0.5px",
              }}
            >
              {isStarting ? "STARTING AUCTION…" : "⚡ START IPL AUCTION ⚡"}
            </motion.button>
          ) : (
            <div
              style={{
                flex: 2,
                padding: "20px",
                borderRadius: "18px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#94a3b8",
                textAlign: "center",
                fontSize: "18px",
                fontWeight: "700",
              }}
            >
              ⏳ Waiting for Host ({currentHost}) to start the auction...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Lobby