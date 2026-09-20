import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { TEAMS } from "../data/teams.js"
import { getTeamLogo } from "../assets/teamLogos.js"
import { socketService } from "../services/socket.js"

function TeamSelection({ roomCode, setCurrentPage, setSelectedTeam }) {
  const [claimedTeams, setClaimedTeams] = useState(new Map())
  const [errorMessage, setErrorMessage] = useState("")

  const myPlayerId = socketService.playerIdentity.playerId

  useEffect(() => {
    socketService.connect()

    const unreg = socketService.on("room_updated", (room) => {
      const map = new Map()
      if (room?.players) {
        room.players.forEach((p) => {
          if (p.team) {
            map.set(p.team, { playerId: p.id, playerName: p.name })
          }
        })
      }
      setClaimedTeams(map)
    })

    return () => unreg()
  }, [])

  const handleSelectTeam = async (teamCode) => {
    setErrorMessage("")
    const claim = claimedTeams.get(teamCode)

    if (claim && claim.playerId !== myPlayerId) {
      setErrorMessage(`Franchise ${teamCode} is already chosen by ${claim.playerName}!`)
      return
    }

    if (socketService.isConnected && roomCode) {
      const res = await socketService.selectTeam({ roomCode, teamCode })
      if (!res.success) {
        setErrorMessage(res.error || "Failed to select team")
        return
      }
    }

    setSelectedTeam(teamCode)
    setCurrentPage("lobby")
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at center, #1e1b4b 0%, #030712 100%)",
        color: "white",
        padding: "40px",
        fontFamily: "'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px" }}>
          <button
            onClick={() => setCurrentPage("lobby")}
            style={{
              padding: "10px 18px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            ← Back to Lobby
          </button>

          <span style={{ color: "#94a3b8", fontSize: "14px" }}>
            Room: <strong style={{ color: "white" }}>{roomCode || "Local"}</strong>
          </span>
        </div>

        <h1
          style={{
            textAlign: "center",
            fontSize: "46px",
            fontWeight: "900",
            marginBottom: "10px",
            letterSpacing: "-0.5px",
          }}
        >
          🏏 SELECT YOUR FRANCHISE
        </h1>

        <p
          style={{
            textAlign: "center",
            color: "#94a3b8",
            fontSize: "18px",
            marginBottom: "30px",
          }}
        >
          Each player controls one exclusive IPL franchise
        </p>

        {errorMessage && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#fca5a5",
              padding: "12px 20px",
              borderRadius: "14px",
              textAlign: "center",
              marginBottom: "24px",
              fontWeight: "600",
            }}
          >
            ⚠️ {errorMessage}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "24px",
          }}
        >
          {TEAMS.map((team) => {
            const claim = claimedTeams.get(team.code)
            const isTakenByOther = claim && claim.playerId !== myPlayerId
            const isTakenByMe = claim && claim.playerId === myPlayerId

            return (
              <motion.div
                key={team.code}
                onClick={() => !isTakenByOther && handleSelectTeam(team.code)}
                whileHover={!isTakenByOther ? {
                  scale: 1.05,
                  y: -6,
                  boxShadow: `0 15px 35px ${team.primaryColor}33`,
                  borderColor: `${team.primaryColor}88`,
                } : {}}
                whileTap={!isTakenByOther ? { scale: 0.96 } : {}}
                style={{
                  background: isTakenByMe
                    ? "rgba(34, 197, 94, 0.15)"
                    : isTakenByOther
                    ? "rgba(15, 23, 42, 0.4)"
                    : "rgba(15, 23, 42, 0.75)",
                  backdropFilter: "blur(18px)",
                  borderRadius: "24px",
                  padding: "32px 24px",
                  textAlign: "center",
                  cursor: isTakenByOther ? "not-allowed" : "pointer",
                  border: isTakenByMe
                    ? "2px solid #22c55e"
                    : isTakenByOther
                    ? "1px solid rgba(255, 255, 255, 0.04)"
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  opacity: isTakenByOther ? 0.5 : 1,
                  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  position: "relative",
                }}
              >
                {/* CLAIMED BADGE */}
                {isTakenByOther && (
                  <span
                    style={{
                      position: "absolute",
                      top: "14px",
                      right: "14px",
                      background: "rgba(239, 68, 68, 0.2)",
                      color: "#f87171",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      fontSize: "11px",
                      fontWeight: "700",
                      padding: "4px 8px",
                      borderRadius: "10px",
                    }}
                  >
                    🔒 {claim.playerName}
                  </span>
                )}

                {isTakenByMe && (
                  <span
                    style={{
                      position: "absolute",
                      top: "14px",
                      right: "14px",
                      background: "rgba(34, 197, 94, 0.2)",
                      color: "#4ade80",
                      border: "1px solid rgba(34, 197, 94, 0.4)",
                      fontSize: "11px",
                      fontWeight: "700",
                      padding: "4px 8px",
                      borderRadius: "10px",
                    }}
                  >
                    ✓ YOUR TEAM
                  </span>
                )}

                <img
                  src={getTeamLogo(team.code)}
                  alt={team.name}
                  style={{
                    width: "84px",
                    height: "84px",
                    borderRadius: "16px",
                    objectFit: "contain",
                    marginBottom: "16px",
                    filter: isTakenByOther ? "grayscale(80%)" : "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
                  }}
                />
                <h2 style={{ fontSize: "24px", margin: "0 0 6px", fontWeight: "800" }}>
                  {team.code}
                </h2>
                <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0 }}>
                  {team.name}
                </p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default TeamSelection