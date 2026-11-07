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
roomManager.onStateChange = (roomId) => broadcastRoomState(roomId);

// Map WebSocket to client metadata: { ws, roomId, playerId }
const clientSockets = new Map();

// Broadcast tailored state to all connected players in a room
function broadcastRoomState(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  for (const player of [...room.players, ...(room.spectators || [])]) {
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
  const { hostName, mode, houseRules } = req.body;
  try {
    const result = roomManager.createRoom(hostName, mode, houseRules);
    res.status(201).json({
      success: true,
      roomId: result.roomId,
      playerId: result.playerId,
      sessionToken: result.sessionToken,
    });
  } catch (err) {
    res.status(409).json({ success: false, error: err.message });
  }
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
    maxPlayers: room.mode === 'classic' ? 10 : 6,
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
      const { type, roomId: requestedRoomId, sessionToken, playerName, data } = payload;
      let cleanRoomId = (requestedRoomId || '').trim().toUpperCase();
      let playerId = null;

      if (type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (type === 'create') {
        if (clientSockets.has(ws)) {
          sendError(ws, 'This connection has already joined a room.');
          return;
        }
        if (cleanRoomId && !/^[A-Z0-9]{3,12}$/.test(cleanRoomId)) {
          sendError(ws, 'Enter a valid room code.');
          return;
        }
        try {
          const created = roomManager.createRoom(playerName || 'Host', data?.mode || 'classic', data?.houseRules, cleanRoomId || undefined);
          playerId = created.playerId;
          roomManager.attachSocket(created.roomId, playerId, ws);
          clientSockets.set(ws, { roomId: created.roomId, playerId });
          ws.send(JSON.stringify({ type: 'joined', data: created }));
          broadcastRoomState(created.roomId);
        } catch (err) {
          sendError(ws, err.message || 'Could not create room.');
        }
        return;
      }

      if (type === 'join') {
        if (clientSockets.has(ws)) {
          sendError(ws, 'This connection has already joined a room.');
          return;
        }
        if (!/^[A-Z0-9]{3,12}$/.test(cleanRoomId)) {
          sendError(ws, 'Enter a valid room code.');
          return;
        }
        const joined = roomManager.joinRoom(cleanRoomId, playerName, sessionToken);
        if (!joined.success) {
          sendError(ws, joined.error);
          return;
        }
        playerId = joined.playerId;
        const joinedRoom = roomManager.getRoom(cleanRoomId);
        const existingPlayer = [...(joinedRoom?.players || []), ...(joinedRoom?.spectators || [])].find((p) => p.id === playerId);
        if (existingPlayer?.socket && existingPlayer.socket !== ws) {
          clientSockets.delete(existingPlayer.socket);
          existingPlayer.socket.close(4001, 'Player reconnected elsewhere');
        }
        if (!roomManager.attachSocket(cleanRoomId, playerId, ws)) {
          sendError(ws, 'Could not attach player to room');
          return;
        }
        clientSockets.set(ws, { roomId: cleanRoomId, playerId });
        ws.send(JSON.stringify({ type: 'joined', data: { roomId: cleanRoomId, playerId, sessionToken: joined.sessionToken } }));
        broadcastRoomState(cleanRoomId);
        return;
      }

      const authenticated = clientSockets.get(ws);
      if (!authenticated) {
        sendError(ws, 'Join a room with your session before sending game actions.');
        return;
      }
      if (cleanRoomId && cleanRoomId !== authenticated.roomId) {
        sendError(ws, 'This connection is authenticated for a different room.');
        return;
      }
      cleanRoomId = authenticated.roomId;
      playerId = authenticated.playerId;

      const rematchMethods={rematch_propose:'proposeRematch',rematch_respond:'respondRematch',rematch_vote:'voteRematch',rematch_cancel:'cancelRematch'};
      if (rematchMethods[type]) {
        const room=roomManager.getRoom(cleanRoomId);
        const receipt=typeof payload.actionId==='string'?`${playerId}:${payload.actionId.slice(0,100)}`:null;
        if(receipt&&room?.actionReceipts?.includes(receipt)){broadcastRoomState(cleanRoomId);return;}
        const result=roomManager[rematchMethods[type]](cleanRoomId,playerId,data||{});
        if(result.success&&receipt){room.actionReceipts=[...(room.actionReceipts||[]),receipt].slice(-256);roomManager.persist(cleanRoomId);}

        if (!result.success) sendError(ws,result.error);
        broadcastRoomState(cleanRoomId);
        return;
      }

      // Persist bounded receipts so retransmission cannot execute a second turn.
      const actionMethods = { play_card: 'playCard', draw_card: 'drawCard', pass_turn: 'passTurn', choose_color: 'chooseOpeningColor', challenge_draw4: 'resolveDrawFour', call_uno: 'callUno', catch_uno: 'catchUno', rematch: 'rematch', start_game: 'startGame' };
      if (actionMethods[type]) {
        const room = roomManager.getRoom(cleanRoomId);
        const actionId = typeof payload.actionId === 'string' ? payload.actionId.slice(0, 100) : null;
        const receipt = actionId ? `${playerId}:${actionId}` : null;
        if (receipt && room.actionReceipts?.includes(receipt)) { broadcastRoomState(cleanRoomId); return; }
        const versionedActions = ['play_card', 'draw_card', 'pass_turn', 'choose_color', 'challenge_draw4'];
        if (room.mode !== 'flip' && versionedActions.includes(type) && payload.expectedActionVersion !== undefined && payload.expectedActionVersion !== (room.actionVersion || 0)) {
          sendError(ws, 'The turn changed. Review the current table before acting again.');
          broadcastRoomState(cleanRoomId);
          return;
        }
        let argument = data || {};
        if (type === 'choose_color') argument = data?.chosenColor;
        if (type === 'catch_uno') argument = data?.targetPlayerId;
        if (type === 'challenge_draw4') argument = true;
        const result = roomManager[actionMethods[type]](cleanRoomId, playerId, argument);
        if (!result.success) sendError(ws, result.error);
        else {
          if (receipt) { room.actionReceipts = [...(room.actionReceipts || []), receipt].slice(-256); roomManager.persist(cleanRoomId); }
          broadcastRoomState(cleanRoomId);
        }
        return;
      }

      switch (type) {
        case 'create': {
          sendError(ws, 'This connection has already joined a room.');
          break;
        }

        case 'join': {
          sendError(ws, 'This connection has already joined a room.');
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

        case 'leave': {
          roomManager.leaveRoom(cleanRoomId, playerId);
          clientSockets.delete(ws);
          broadcastRoomState(cleanRoomId);
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
