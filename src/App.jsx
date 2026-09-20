import AuctionRoom from "./Pages/AuctionRoom"
import Lobby from "./Pages/Lobby"
import TeamSelection from "./Pages/TeamSelection"
import { useState } from "react"
import { motion } from "framer-motion"



import { db } from "./firebase"

import {
  collection,
  addDoc,
  getDocs,
} from "firebase/firestore"

import csk from "./assets/LOGOS/csk.jpg"
import dc from "./assets/LOGOS/dc.jpg"
import gt from "./assets/LOGOS/gt.jpg"
import kkr from "./assets/LOGOS/kkr.jpg"
import lsg from "./assets/LOGOS/lsg.png"
import mi from "./assets/LOGOS/mi.png"
import pbks from "./assets/LOGOS/pbks.png"
import rcb from "./assets/LOGOS/rcb.jpg"
import rr from "./assets/LOGOS/rr.jpg"
import srh from "./assets/LOGOS/srh.jpg"

import { socketService } from "./services/socket"

function FloatingLogo({ src, top, left, delay }) {
  return (
    <motion.img
      src={src}
      alt=""
      animate={{
        y: [0, -20, 0],
        rotate: [0, 3, -3, 0],
      }}
      transition={{
        duration: 5,
        repeat: Infinity,
        delay,
      }}
      style={{
        position: "absolute",
        width: "110px",
        top,
        left,
        opacity: 0.22,
        borderRadius: "20px",
        zIndex: 1,
        boxShadow: "0 0 40px rgba(255,255,255,0.15)",
      }}
    />
  )
}

function App() {
  const [showModal, setShowModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)

  const [roomError, setRoomError] = useState("")
  const [joinError, setJoinError] = useState("")
  const [isJoining, setIsJoining] = useState(false)
  const [currentPage, setCurrentPage] = useState("home")

  const [roomName, setRoomName] = useState("")
  const [teams, setTeams] = useState("")
  const [teamError, setTeamError] = useState("")
  const [auctionType, setAuctionType] =
    useState("Mega Auction")

  const [budget, setBudget] = useState("120")

  const [roomCode, setRoomCode] = useState("")

  const [joinCode, setJoinCode] = useState("")
  const [username, setUsername] = useState("")
  const [hostName, setHostName] = useState("")
  const [joinedPlayers, setJoinedPlayers] = useState([])
  const [selectedTeam, setSelectedTeam] = useState("")
  const [isHost, setIsHost] = useState(true)

  if (currentPage === "lobby") {
    return (
      <Lobby
        roomCode={roomCode}
        roomName={roomName}
        teams={teams}
        budget={budget}
        auctionType={auctionType}
        hostName={hostName}
        isHost={isHost}
        joinedPlayers={joinedPlayers}
        selectedTeam={selectedTeam}
        setCurrentPage={setCurrentPage}
      />
    )
  }
  if (currentPage === "teamSelection") {
    return (
      <TeamSelection
        roomCode={roomCode}
        setCurrentPage={setCurrentPage}
        setSelectedTeam={setSelectedTeam}
      />
    )
  }
  if (currentPage === "auctionRoom") {
    return (
      <AuctionRoom
        selectedTeam={selectedTeam || "CSK"}
        budget={budget || 120}
        roomCode={roomCode || "IPL7X9"}
        hostName={hostName || "Host"}
        setCurrentPage={setCurrentPage}
      />
    )
  }

  // CREATE ROOM
  const createRoom = async () => {
    let valid = true
    if (
      !teams ||
      Number(teams) < 2 ||
      Number(teams) > 10
    ) {
      setTeamError(
        "Number of teams must be between 2 and 10"
      )
      return
    }

    setRoomError("")
    setTeamError("")

    if (!roomName.trim()) {
      setRoomError("Room Name is Required")
      valid = false
    }

    if (!valid) return

    // Single source of truth: prefer the server-generated room code.
    let finalCode = ""
    try {
      const socketRes = await socketService.createRoom({
        hostName: hostName || "Host",
        roomName,
        teams: Number(teams) || 10,
        budget: Number(budget) || 120,
        auctionType,
        timerMode: 10,
      })

      if (socketRes && socketRes.room) {
        finalCode = socketRes.room.roomCode
        setRoomCode(finalCode)
        setIsHost(true)
      }
    } catch (socketErr) {
      console.warn("Socket createRoom fallback:", socketErr.message)
    }

    if (!finalCode) {
      // Offline fallback only: generate a local code when the server is unreachable.
      finalCode = Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()
      setRoomCode(finalCode)
      setIsHost(true)
    }

    try {
      await addDoc(collection(db, "rooms"), {
        roomCode: finalCode,
        roomName,
        teams,
        auctionType,
        budget,
        hostName: hostName || "Host",
        createdAt: new Date(),
      })
      console.log("Room Created in Firebase Successfully")
    } catch (error) {
      console.warn("Firebase createRoom notice (proceeding in local mode):", error.message)
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "14px",
    marginBottom: "18px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "white",
    fontSize: "15px",
    outline: "none",
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        overflow: "hidden",
        position: "relative",
        background:
          "radial-gradient(circle at center,#1e1b4b,#020617)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Arial",
      }}
    >

      {/* GLOW */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
        }}
        style={{
          position: "absolute",
          width: "700px",
          height: "700px",
          background: "#7c3aed",
          borderRadius: "50%",
          filter: "blur(220px)",
          opacity: 0.25,
        }}
      />

      {/* FLOATING LOGOS */}
      <FloatingLogo src={csk} top="8%" left="5%" delay={0} />
      <FloatingLogo src={mi} top="70%" left="80%" delay={1} />
      <FloatingLogo src={rcb} top="15%" left="78%" delay={2} />
      <FloatingLogo src={kkr} top="65%" left="10%" delay={1.5} />
      <FloatingLogo src={srh} top="45%" left="85%" delay={2.5} />
      <FloatingLogo src={dc} top="72%" left="30%" delay={0.5} />
      <FloatingLogo src={gt} top="10%" left="38%" delay={1.2} />
      <FloatingLogo src={lsg} top="72%" left="55%" delay={1.8} />
      <FloatingLogo src={pbks} top="25%" left="92%" delay={2.2} />
      <FloatingLogo src={rr} top="55%" left="65%" delay={0.8} />

      {/* MAIN CARD */}
      <motion.div
        initial={{
          opacity: 0,
          y: 40,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        transition={{
          duration: 1.2,
        }}
        style={{
          position: "relative",
          zIndex: 5,
          width: "600px",
          padding: "60px",
          borderRadius: "35px",
          backdropFilter: "blur(22px)",
          background: "rgba(255,255,255,0.08)",
          border:
            "1px solid rgba(255,255,255,0.12)",
          boxShadow:
            "0 0 60px rgba(124,58,237,0.35)",
          textAlign: "center",
        }}
      >
        <motion.h1
          animate={{
            textShadow: [
              "0 0 15px #7c3aed",
              "0 0 40px #2563eb",
              "0 0 15px #7c3aed",
            ],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
          }}
          style={{
            fontSize: "64px",
            color: "white",
            marginBottom: "18px",
            fontWeight: "bold",
          }}
        >
          IPL Auction AI
        </motion.h1>

        <p
          style={{
            color: "#cbd5e1",
            fontSize: "20px",
            marginBottom: "45px",
          }}
        >
          Smart IPL Auction Platform with AI Prediction
        </p>

        {/* BUTTONS */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "25px",
          }}
        >
          <motion.button
            whileHover={{
              scale: 1.08,
            }}
            whileTap={{
              scale: 0.95,
            }}
            onClick={() => setShowModal(true)}
            style={{
              padding: "16px 34px",
              border: "none",
              borderRadius: "14px",
              background:
                "linear-gradient(135deg,#7c3aed,#2563eb)",
              color: "white",
              fontWeight: "bold",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            Create Room
          </motion.button>

          <motion.button
            whileHover={{
              scale: 1.08,
            }}
            whileTap={{
              scale: 0.95,
            }}
            onClick={() => setShowJoinModal(true)}
            style={{
              padding: "16px 34px",
              borderRadius: "14px",
              border:
                "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "white",
              fontWeight: "bold",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            Join Room
          </motion.button>
        </div>
      </motion.div>

      {/* CREATE ROOM MODAL */}
      {showModal && (
        <div
          style={modalBg}
          onClick={() => setShowModal(false)}
        >
          <motion.div
            initial={{
              scale: 0.7,
              opacity: 0,
            }}
            animate={{
              scale: 1,
              opacity: 1,
            }}
            style={modalStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={modalTitle}>
              Create Auction Room
            </h2>
            <input
              placeholder="Host Name"
              style={inputStyle}
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
            />
            <input
              placeholder="Room Name"
              style={inputStyle}
              value={roomName}
              onChange={(e) =>
                setRoomName(e.target.value)
              }
            />

            {roomError && (
              <p style={errorStyle}>
                {roomError}
              </p>
            )}

            <input
              type="number"
              min="2"
              max="10"
              placeholder="Enter teams (2-10)"
              value={teams}
              onChange={(e) => {
                const value = e.target.value

                if (
                  value === "" ||
                  (/^\d+$/.test(value) &&
                    Number(value) <= 10)
                ) {
                  setTeams(value)
                  setTeamError("")
                }
              }}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "12px",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "white",
                fontSize: "16px",
              }}
            />

            {teamError && (
              <p
                style={{
                  color: "#ef4444",
                  marginTop: "6px",
                  fontSize: "14px",
                }}
              >
                {teamError}
              </p>
            )}

            <select
              style={{
                ...inputStyle,
                background: "#0f172a",
                color: "white",
              }}
              value={auctionType}
              onChange={(e) =>
                setAuctionType(e.target.value)
              }
            >
              <option value="Mega Auction">
                Mega Auction
              </option>

              <option value="Mini Auction">
                Mini Auction
              </option>
            </select>

            <input
              placeholder="Budget (120 Cr)"
              style={inputStyle}
              value={budget}
              onChange={(e) =>
                setBudget(e.target.value)
              }
            />

            <button
              onClick={createRoom}
              style={buttonStyle}
            >
              Create Room
            </button>

            {roomCode && (
              <div
                style={{
                  marginTop: "20px",
                  textAlign: "center",
                  padding: "15px",
                  borderRadius: "12px",
                  background: "rgba(255,255,255,0.05)",
                }}
              >
                <p
                  style={{
                    color: "#22c55e",
                    marginBottom: "10px",
                  }}
                >
                  Room Created Successfully 🎉
                </p>

                <h1
                  style={{
                    color: "#ffffff",
                    letterSpacing: "4px",
                    fontSize: "36px",
                    margin: "10px 0",
                  }}
                >
                  {roomCode}
                </h1>

                <div style={{ display: "flex", gap: "10px", marginTop: "15px" }}>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(roomCode)
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "10px",
                      background: "rgba(255,255,255,0.1)",
                      color: "white",
                      cursor: "pointer",
                      fontWeight: "bold",
                    }}
                  >
                    📋 Copy Code
                  </button>

                  <button
                    onClick={() => {
                      setShowModal(false)
                      setCurrentPage("lobby")
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      border: "none",
                      borderRadius: "10px",
                      background: "linear-gradient(135deg, #22c55e, #16a34a)",
                      color: "white",
                      cursor: "pointer",
                      fontWeight: "bold",
                    }}
                  >
                    ⚡ Enter Lobby
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* JOIN ROOM MODAL */}
      {showJoinModal && (
        <div
          style={modalBg}
          onClick={() => setShowJoinModal(false)}
        >
          <motion.div
            initial={{
              scale: 0.7,
              opacity: 0,
            }}
            animate={{
              scale: 1,
              opacity: 1,
            }}
            style={modalStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={modalTitle}>
              Join Auction Room
            </h2>

            <input
              placeholder="Enter Room Code"
              style={inputStyle}
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value)
              }
            />

            {joinError && (
              <p style={errorStyle}>
                {joinError}
              </p>
            )}

            <input
              placeholder="Enter Username"
              style={inputStyle}
              value={username}
              onChange={(e) =>
                setUsername(e.target.value)
              }
            />

            <button
              disabled={isJoining}
              onClick={async () => {
                if (isJoining) return
                setJoinError("")

                const cleanCode = joinCode.trim().toUpperCase()
                if (!cleanCode) {
                  setJoinError("Please Enter Room Code")
                  return
                }

                setIsJoining(true)
                try {
                  // 1. Try Socket.IO Real-Time Join
                  try {
                    const socketRes = await socketService.joinRoom({
                      roomCode: cleanCode,
                      playerName: username.trim() || "Franchise Owner",
                    })

                    if (socketRes && socketRes.success) {
                      if (socketRes.isHost) {
                        console.warn(
                          "Join resolved as host — same browser profile shares one player ID. Test host + joiner in two different browsers / incognito windows."
                        )
                      }
                      setRoomCode(cleanCode)
                      setIsHost(false)
                      setJoinedPlayers((prev) => [...prev, username.trim() || "Franchise Owner"])
                      setShowJoinModal(false)
                      setCurrentPage("lobby")
                      return
                    }
                  } catch (socketErr) {
                    const msg = socketErr?.message || ""
                    console.warn("Socket join notice (checking fallback):", msg)
                    // Authoritative server rejections must not be masked by the fallback.
                    if (/full/i.test(msg)) {
                      setJoinError(msg)
                      return
                    }
                    if (/not found|invalid|check the code/i.test(msg)) {
                      // Fall through to Firebase check below, which gives the
                      // same verdict for rooms created while offline.
                    }
                  }

                  // 2. Fallback to Firebase
                  try {
                    const querySnapshot = await getDocs(collection(db, "rooms"))
                    let roomExists = false

                    querySnapshot.forEach((doc) => {
                      if (doc.data().roomCode === cleanCode) {
                        roomExists = true
                      }
                    })

                    if (roomExists) {
                      setRoomCode(cleanCode)
                      setIsHost(false)
                      setJoinedPlayers((prev) => [...prev, username.trim() || "Franchise Owner"])
                      setShowJoinModal(false)
                      setCurrentPage("lobby")
                    } else {
                      setJoinError("Invalid Room Code. Please check and try again. (Tip: backend must be running: npm run server)")
                    }
                  } catch (fbErr) {
                    console.error(fbErr)
                    setJoinError("Cannot reach server or database. Start backend (npm run server) and retry.")
                  }
                } finally {
                  setIsJoining(false)
                }
              }}
              style={{
                ...buttonStyle,
                opacity: isJoining ? 0.6 : 1,
                cursor: isJoining ? "not-allowed" : "pointer",
              }}
            >
              {isJoining ? "Joining…" : "Join Room"}
            </button>
          </motion.div>
        </div>
      )}
    </div>
  )
}

const modalBg = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 100,
}

const modalStyle = {
  width: "430px",
  padding: "35px",
  borderRadius: "24px",
  background: "rgba(15,23,42,0.95)",
  border: "1px solid rgba(255,255,255,0.1)",
  backdropFilter: "blur(20px)",
  color: "white",
}

const modalTitle = {
  marginBottom: "25px",
  textAlign: "center",
}

const errorStyle = {
  color: "#ef4444",
  marginTop: "-10px",
  marginBottom: "10px",
  fontSize: "14px",
}

const buttonStyle = {
  width: "100%",
  padding: "14px",
  border: "none",
  borderRadius: "12px",
  background:
    "linear-gradient(135deg,#2563eb,#7c3aed)",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer",
}

export default App