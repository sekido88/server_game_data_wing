const crypto = require("crypto");
const express = require("express");
const { createServer } = require("http");
const WebSocket = require("ws");
const uuid = require("uuid-random");

const app = express();
const port = 8080;

const server = createServer(app);
const wss = new WebSocket.Server({ server });

exports.WS_Export = wss;

const rooms = new Map();
const clients = new Map();

wss.on("connection", (ws) => {
  const clientId = uuid();
  ws.id = clientId;

  clients.set(clientId, ws);

  console.log(`Client connected: ${clientId}`);

  sendToClient(ws, {
    action: "connected",
    playerId: clientId,
  });
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      console.log("Received message from client:", message);

      handleMessage(ws, message);
    } catch (error) {
      console.error("Error handling message:", error);
    }
  });

  ws.on("close", () => {
    handlePlayerDisconnect(ws);
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
  });
});

const handleMessage = (ws, message) => {
  try {
    switch (message.action) {
      case "chat_message":
        handleChatMessage(ws, message);
        break;
      case "get_rooms":
        handleGetRooms(ws, message);
        break;
      case "create_room":
        handleCreateRoom(ws, message);
        break;
      case "join_room":
        handleJoinRoom(ws, message);
        break;
      case "player_moved":
        handlePlayerMove(ws, message);
        break;
      case "player_ready":
        handlePlayerReady(ws, message);
        break;
      case "start_race":
        handleStartRace(ws, message);
        break;
      case "player_checkpoint":
        handlePlayerCheckpoint(ws, message);
        break;
      case "leave_room":
        handleLeaveRoom(ws, message);
        break;
      case "get_race_time":
        handleGetRaceTime(ws, message);
        break;
      case "player_finished":
        handlePlayerFinished(ws, message);
        break;
      default:
        console.warn(`Unknown action: ${message.action}`);
        sendToClient(ws, {
          action: "error",
          error: "Unknown action"
        });
    }
  } catch (error) {
    console.error("Error in handleMessage:", error);
    sendToClient(ws, {
      action: "error",
      error: "Internal server error"
    });
  }
}
const handleGetRooms = (ws, message) => {
  const allRooms = Array.from(rooms.values()).map((room) => ({
    id: room.id,
    host: room.host,
    playerCount: room.players.size,
    isRacing: room.isRacing,
  }));

  sendToClient(ws, {
    action: "rooms_list",
    rooms: allRooms,
  });

  console.log(`Sent list of rooms to client ${ws.id}`);
};

const handleChatMessage = (ws, message) => {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  const player = room.players.get(ws.id);
  if (!player) return;

  broadcastToRoom(room, {
    action: "chat_message",
    playerId: ws.id,
    senderName: player.name,
    chatMessage: message.chatMessage
  });
};

const handleCreateRoom = (ws, message) => {
  const roomId = generateRoomId();
  console.log(`Creating room: ${roomId} for client: ${ws.id}`);

  const room = {
    id: roomId,
    host: ws.id,
    raceStartTime: null,
    players: new Map(),
    finishTimes: new Map(),
  };

  rooms.set(roomId, room);

  room.players.set(ws.id, {
    ws: ws,
    name: message.playerName,
    playerId: ws.id,
    roomId: roomId,
    socketEffectName: message.socketEffectName,
    trailEffectName: message.trailEffectName,
    spriteName: message.spriteName,
    isReady: message.isReady,
    position: null,
    rotation: null,
  });

  ws.roomId = roomId;

  sendToClient(ws, {
    action: "room_created",
    playerName : message.playerName,
    roomId: roomId,
    spriteName: message.spriteName,
    trailEffectName: message.trailEffectName,
    socketEffectName: message.socketEffectName,
    players: getPlayersData(room),
    playerId: ws.id,
    isHost: true,
  });
};

const handleJoinRoom = (ws, message) => {
  const room = rooms.get(message.roomId);
  if (!room) {
    sendToClient(ws, {
      action: "error",
      error: "Room not found",
    });
    return;
  }

  room.players.set(ws.id, {
    ws: ws,
    name: message.playerName,
    playerId: ws.id,
    roomId: message.roomId,
    socketEffectName: message.socketEffectName,
    trailEffectName: message.trailEffectName,
    spriteName: message.spriteName,
    isReady: false,
    position: null,
    rotation: null,
  });

  ws.roomId = message.roomId;

  broadcastToRoom(
    room,
    {
      action: "player_joined",
      playerName : message.playerName,
      players: getPlayersData(room),
      playerId: ws.id,
    },
    message.playerId
  );

  sendToClient(ws, {
    action: "room_joined",
    roomId: message.roomId,
    playerId: ws.id,
    isHost: false,
    players: getPlayersData(room),
  });
};

const handlePlayerMove = (ws, message) => {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  broadcastToRoom(
    room,
    {
      action: "player_moved",
      playerId: ws.id,
      position: message.position,
      rotation: message.rotation,
    },
    ws.id
  );
};

const handleLeaveRoom = (ws, message) => {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  room.players.delete(ws.id);

  broadcastToRoom(room, {
    action: "player_leave",
    playerId: ws.id,
    players: getPlayersData(room),
  });

  if (room.players.size === 0) {
    rooms.delete(ws.roomId); 
    console.log(`Room ${ws.roomId} has been deleted`);
  }

  ws.roomId = null;
};

const handlePlayerDisconnect = (ws) => {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  room.players.delete(ws.id);

  if (room.players.size === 0) {
    rooms.delete(ws.roomId);
    console.log(`Room ${ws.roomId} has been deleted due to all players disconnected`);
  } else {
    broadcastToRoom(room, {
      action: "player_left",
      playerId: ws.id,
    });
  }
};

const generateRoomId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const sendToClient = (ws, message) => {
  try {
    console.log("Sending to client:", message);
    ws.send(JSON.stringify(message));
  } catch (error) {
    console.error("Error sending message:", error);
  }
};

const handlePlayerReady = (ws, message) => {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  const player = room.players.get(ws.id);
  if (player) {
    player.isReady = message.isReady;

    broadcastToRoom(room, {
      action: "player_ready",
      players: getPlayersData(room),
    });
  }
};

const broadcastToRoom = (room, message, excludeClientId = null) => {
  room.players.forEach((player, playerId) => {
    if (playerId !== excludeClientId) {
      sendToClient(player.ws, message);
    }
  });
};

const handleStartRace = (ws, message) => {
  const room = rooms.get(ws.roomId);
  if (!room || room.host !== ws.id) return;

  const allReady = Array.from(room.players.values()).every((p) => p.isReady);
  if (!allReady) return;

  broadcastToRoom(room, {
    action: "game_starting",
    players: getPlayersData(room),
  });

  setTimeout(() => {
    room.isRacing = true;
    room.raceStartTime = Date.now(),
      broadcastToRoom(room, {
        action: "game_started",
        players: getPlayersData(room),
      });
  }, 3000);
};

const handleGetRaceTime = (ws, message) => {
  const room = rooms.get(ws.roomId);
  if (!room || !room.isRacing) return;

  const currentTime = Date.now() - room.raceStartTime;
  sendToClient(ws, {
    action: "race_time",
    currentTime: currentTime,
    finishTimes: Array.from(room.finishTimes.entries()),
  });
};
const handlePlayerFinished = (ws, message) => {
  const room = rooms.get(ws.roomId);
  if (!room || !room.isRacing) return;

  const finishTime = Date.now();
  const raceTime = finishTime - room.raceStartTime;
  room.finishTimes.set(ws.id, raceTime);

  broadcastToRoom(room, {
    action: "player_finished",
    playerId: ws.id,
    raceTime: raceTime,
    finishTimes: Array.from(room.finishTimes.entries()).map(([id, value]) => ({
      playerId: id,
      time: value,
    })),
  });

  if (room.finishTimes.size === room.players.size) {
    room.isRacing = false;
    broadcastToRoom(room, {
      action: "race_ended",
      finishTimes: Array.from(room.finishTimes.entries()).map(([id, value]) => ({
        playerId: id,
        time: value,
      })),
    });
  }
};
const getPlayersData = (room) => {
  return Array.from(room.players.entries()).map(([id, player]) => ({
    id: id,
    name: player.name,
    isReady: player.isReady,
    socketEffectName: player.socketEffectName,
    trailEffectName: player.trailEffectName,
    spriteName: player.spriteName,
  }));
};

server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
