import { io } from "socket.io-client"

console.log("=== Testing Real-Time Multiplayer Socket Server ===")

const SERVER_URL = "http://localhost:5000"

async function runTest() {
  const hostSocket = io(SERVER_URL)
  const playerSocket = io(SERVER_URL)

  await new Promise((resolve) => hostSocket.on("connect", resolve))
  console.log("✅ Host Socket connected:", hostSocket.id)

  await new Promise((resolve) => playerSocket.on("connect", resolve))
  console.log("✅ Player Socket connected:", playerSocket.id)

  let testRoomCode = ""

  // 1. Host creates room
  const createPromise = new Promise((resolve) => {
    hostSocket.emit(
      "create_room",
      {
        hostName: "Arun Host",
        roomName: "Mega War Room",
        teams: 4,
        budget: 120,
        auctionType: "Mega Auction",
        timerMode: 5,
        hostId: "host-arun",
      },
      (response) => {
        console.log("✅ Host created room:", response.room.roomCode)
        testRoomCode = response.room.roomCode
        resolve(response)
      }
    )
  })
  await createPromise

  // 2. Player joins room
  const joinPromise = new Promise((resolve) => {
    playerSocket.emit(
      "join_room",
      {
        roomCode: testRoomCode,
        playerName: "Player Rohit",
        playerId: "player-rohit-1",
      },
      (response) => {
        console.log("✅ Player joined room:", response.success, response.player.name)
        resolve(response)
      }
    )
  })
  await joinPromise

  // 3. Player selects team CSK
  const selectTeamPromise = new Promise((resolve) => {
    playerSocket.emit(
      "select_team",
      {
        roomCode: testRoomCode,
        playerId: "player-rohit-1",
        teamCode: "CSK",
      },
      (response) => {
        console.log("✅ Player selected team CSK:", response.success)
        resolve(response)
      }
    )
  })
  await selectTeamPromise

  // 4. Host starts auction
  const startPromise = new Promise((resolve) => {
    playerSocket.once("auction_started", (data) => {
      console.log("✅ Player received auction_started event:", data.message)
      resolve(data)
    })

    hostSocket.emit("start_auction", {
      roomCode: testRoomCode,
      hostId: "host-arun",
    })
  })
  await startPromise

  // 5. Player places bid for CSK
  const bidPromise = new Promise((resolve) => {
    hostSocket.once("bid_placed", (data) => {
      console.log("✅ Host received bid_placed event:", data.team, "Amount:", data.currentBid)
      resolve(data)
    })

    playerSocket.emit("place_bid", {
      roomCode: testRoomCode,
      playerId: "player-rohit-1",
      team: "CSK",
    })
  })
  await bidPromise

  console.log("🎉 ALL REAL-TIME SOCKET MULTIPLAYER TESTS PASSED!")

  hostSocket.disconnect()
  playerSocket.disconnect()
  process.exit(0)
}

runTest().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
