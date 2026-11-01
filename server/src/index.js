import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { PersistentRoomStore } from './db.js';
import { RoomManager } from './roomManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const store = new PersistentRoomStore();
const roomManager = new RoomManager(store);

// Map WebSocket to client metadata: { ws, roomId, playerId }
const clientSockets = new Map();

// Broadcast tailored state to all connected players in a room
function broadcastRoomState(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  for (const player of room.players) {
    if (player.socket && player.socket.readyState === WebSocket.OPEN) {
      const view = roomManager.getClientView(roomId, player.id);
      if (view) {
        player.socket.send(
          JSON.stringify({
            type: 'room:state',
            data: view,
          })
        );
      }
    }
  }
}

// Send error message to a specific socket
function sendError(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message,
      })
    );
  }
}

// Health check endpoint
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    app: 'UNO Arena',
    uptime: process.uptime(),
    activeRooms: roomManager.getRoomCount(),
    timestamp: new Date().toISOString(),
  });
});

// Create Room REST endpoint
app.post('/api/rooms', (req, res) => {
  const { hostName, mode, houseRules, roomCode } = req.body;
  const result = roomManager.createRoom(hostName, mode, houseRules, roomCode);
  res.json({
    success: true,
    roomId: result.roomId,
    playerId: result.playerId,
    sessionToken: result.sessionToken,
  });
});

// Join Room REST endpoint
app.post('/api/rooms/join', (req, res) => {
  const { roomId, playerName, sessionToken } = req.body;
  const result = roomManager.joinRoom(roomId, playerName, sessionToken);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// Get Room Info
app.get('/api/rooms/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId.toUpperCase());
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    roomId: room.roomId,
    mode: room.mode,
    status: room.status,
    playerCount: room.players.length,
    maxPlayers: 6,
  });
});

// Serve shared constants and rules to client
const sharedDir = path.resolve(__dirname, '../../shared');
app.use('/shared', express.static(sharedDir));

// Serve frontend static assets from client directory
const clientDir = path.resolve(__dirname, '../../client');
app.use(express.static(clientDir));

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

const server = http.createServer(app);

// WebSocket Server attached to HTTP server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message.toString());
      const { type, roomId, playerId, sessionToken, playerName, data } = payload;

      const cleanRoomId = (roomId || '').trim().toUpperCase();

      switch (type) {
        case 'create': {
          const createResult = roomManager.createRoom(
            playerName || 'Host',
            data?.mode || 'classic',
            data?.houseRules,
            cleanRoomId || undefined
          );
          roomManager.attachSocket(createResult.roomId, createResult.playerId, ws);
          clientSockets.set(ws, { roomId: createResult.roomId, playerId: createResult.playerId });
          ws.send(
            JSON.stringify({
              type: 'joined',
              data: createResult,
            })
          );
          broadcastRoomState(createResult.roomId);
          break;
        }

        case 'join': {
          let pId = playerId;
          let sToken = sessionToken;

          // Attempt to join or reconnect
          let joinResult = roomManager.joinRoom(cleanRoomId, playerName, sToken);
          if (!joinResult.success && !pId) {
            // If room doesn't exist, create it with this room code as host
            const createRes = roomManager.createRoom(playerName || 'Host', 'classic', {}, cleanRoomId);
            pId = createRes.playerId;
            sToken = createRes.sessionToken;
            joinResult = { success: true, playerId: pId, sessionToken: sToken };
          }

          pId = pId || joinResult.playerId;
          sToken = sToken || joinResult.sessionToken;

          const attached = roomManager.attachSocket(cleanRoomId, pId, ws);
          if (!attached) {
            sendError(ws, 'Could not attach player to room');
            return;
          }

          clientSockets.set(ws, { roomId: cleanRoomId, playerId: pId });

          // Send confirmation with player credentials for localStorage persistence
          ws.send(
            JSON.stringify({
              type: 'joined',
              data: {
                roomId: cleanRoomId,
                playerId: pId,
                sessionToken: sToken,
              },
            })
          );

          broadcastRoomState(cleanRoomId);
          break;
        }

        case 'ready': {
          roomManager.setReady(cleanRoomId, playerId, data?.isReady);
          broadcastRoomState(cleanRoomId);
          break;
        }

        case 'set_mode': {
          roomManager.setMode(cleanRoomId, playerId, data?.mode);
          broadcastRoomState(cleanRoomId);
          break;
        }

        case 'set_rules': {
          roomManager.setHouseRules(cleanRoomId, playerId, data?.houseRules);
          broadcastRoomState(cleanRoomId);
          break;
        }

        case 'start_game': {
          const res = roomManager.startGame(cleanRoomId, playerId);
          if (!res.success) {
            sendError(ws, res.error);
          } else {
            broadcastRoomState(cleanRoomId);
          }
          break;
        }

        case 'play_card': {
          const res = roomManager.playCard(cleanRoomId, playerId, data || {});
          if (!res.success) {
            sendError(ws, res.error);
          } else {
            broadcastRoomState(cleanRoomId);
          }
          break;
        }

        case 'draw_card': {
          const res = roomManager.drawCard(cleanRoomId, playerId);
          if (!res.success) {
            sendError(ws, res.error);
          } else {
            broadcastRoomState(cleanRoomId);
          }
          break;
        }

        case 'pass_turn': {
          const res = roomManager.passTurn(cleanRoomId, playerId);
          if (!res.success) {
            sendError(ws, res.error);
          } else {
            broadcastRoomState(cleanRoomId);
          }
          break;
        }

        case 'call_uno': {
          const res = roomManager.callUno(cleanRoomId, playerId);
          if (!res.success) {
            sendError(ws, res.error);
          } else {
            broadcastRoomState(cleanRoomId);
          }
          break;
        }

        case 'catch_uno': {
          const res = roomManager.catchUno(cleanRoomId, playerId, data?.targetPlayerId);
          if (!res.success) {
            sendError(ws, res.error);
          } else {
            broadcastRoomState(cleanRoomId);
          }
          break;
        }

        case 'rematch': {
          const res = roomManager.rematch(cleanRoomId, playerId);
          if (!res.success) {
            sendError(ws, res.error);
          } else {
            broadcastRoomState(cleanRoomId);
          }
          break;
        }

        case 'leave': {
          roomManager.leaveRoom(cleanRoomId, playerId);
          clientSockets.delete(ws);
          broadcastRoomState(cleanRoomId);
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        default:
          console.warn('Unknown message type:', type);
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      sendError(ws, 'Internal server error processing move');
    }
  });

  ws.on('close', () => {
    const meta = clientSockets.get(ws);
    if (meta) {
      roomManager.detachSocket(ws);
      clientSockets.delete(ws);
      broadcastRoomState(meta.roomId);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket client error:', err);
  });
});

// 25-second heartbeat to keep WebSocket connections alive on Render / proxy networks
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
heartbeatInterval.unref();

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Start HTTP & WebSocket server if not imported in a unit test
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`  UNO Arena Server running on port ${PORT}`);
    console.log(`  Health check: http://localhost:${PORT}/health`);
    console.log(`===============================================`);
  });
}

export { app, server, wss, roomManager };
