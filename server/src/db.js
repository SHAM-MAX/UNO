import fs from 'node:fs';
import path from 'node:path';

let DatabaseSync = null;
try {
  const mod = await import('node:sqlite');
  DatabaseSync = mod.DatabaseSync;
} catch (e) {
  // SQLite optional
}

export class PersistentRoomStore {
  constructor(storageDir) {
    const dir = storageDir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.warn('Could not create data dir, using memory fallback:', err);
      }
    }
    this.dbPath = path.join(dir, 'uno_arena.sqlite');
    this.memoryFallback = new Map();
    this.sessionFallback = new Map();
    this.db = null;

    if (DatabaseSync) {
      try {
        this.db = new DatabaseSync(this.dbPath);
        this.initTables();
        console.log(`[Storage] Initialized persistent SQLite database at ${this.dbPath}`);
      } catch (err) {
        console.warn('[Storage] SQLite init error, using memory fallback:', err.message);
        this.db = null;
      }
    } else {
      console.log('[Storage] Using in-memory room store.');
    }
  }

  initTables() {
    if (!this.db) return;
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS rooms (
          room_id TEXT PRIMARY KEY,
          mode TEXT,
          state_json TEXT,
          updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS player_sessions (
          session_token TEXT PRIMARY KEY,
          room_id TEXT,
          player_id TEXT,
          player_name TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_room ON player_sessions(room_id);
      `);
    } catch (e) {
      console.error('[Storage] Init tables error:', e);
    }
  }

  saveRoom(roomId, mode, state) {
    const json = JSON.stringify(state);
    const now = Date.now();

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO rooms (room_id, mode, state_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(room_id) DO UPDATE SET
            mode = excluded.mode,
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `);
        stmt.run(roomId, mode, json, now);
        return;
      } catch (err) {
        console.error(`[Storage] Error saving room ${roomId} to SQLite:`, err);
      }
    }

    this.memoryFallback.set(roomId, {
      roomId,
      mode,
      stateJson: json,
      updatedAt: now,
    });
  }

  loadRoom(roomId) {
    if (this.db) {
      try {
        const stmt = this.db.prepare('SELECT state_json FROM rooms WHERE room_id = ?');
        const row = stmt.get(roomId);
        if (row && row.state_json) {
          return JSON.parse(row.state_json);
        }
      } catch (err) {
        console.error(`[Storage] Error loading room ${roomId} from SQLite:`, err);
      }
    }

    const rec = this.memoryFallback.get(roomId);
    if (rec) {
      return JSON.parse(rec.stateJson);
    }
    return null;
  }

  deleteRoom(roomId) {
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM rooms WHERE room_id = ?').run(roomId);
        this.db.prepare('DELETE FROM player_sessions WHERE room_id = ?').run(roomId);
      } catch (err) {
        console.error(`[Storage] Error deleting room ${roomId}:`, err);
      }
    }
    this.memoryFallback.delete(roomId);
    for (const [token, sess] of this.sessionFallback.entries()) {
      if (sess.roomId === roomId) {
        this.sessionFallback.delete(token);
      }
    }
  }

  saveSession(sessionToken, roomId, playerId, playerName) {
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO player_sessions (session_token, room_id, player_id, player_name)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(session_token) DO UPDATE SET
            room_id = excluded.room_id,
            player_id = excluded.player_id,
            player_name = excluded.player_name
        `);
        stmt.run(sessionToken, roomId, playerId, playerName);
        return;
      } catch (err) {
        console.error(`[Storage] Error saving session to SQLite:`, err);
      }
    }
    this.sessionFallback.set(sessionToken, { sessionToken, roomId, playerId, playerName });
  }

  getSession(sessionToken) {
    if (this.db) {
      try {
        const stmt = this.db.prepare(
          'SELECT session_token as sessionToken, room_id as roomId, player_id as playerId, player_name as playerName FROM player_sessions WHERE session_token = ?'
        );
        const row = stmt.get(sessionToken);
        if (row) return row;
      } catch (err) {
        console.error(`[Storage] Error getting session:`, err);
      }
    }
    return this.sessionFallback.get(sessionToken) || null;
  }

  loadAllActiveRooms() {
    const results = [];
    if (this.db) {
      try {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this.db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(cutoff);
        const rows = this.db.prepare('SELECT room_id as roomId, state_json as stateJson FROM rooms').all();
        for (const row of rows) {
          try {
            results.push({ roomId: row.roomId, state: JSON.parse(row.stateJson) });
          } catch (e) {}
        }
        return results;
      } catch (err) {
        console.error('[Storage] Error loading all active rooms:', err);
      }
    }

    for (const [roomId, rec] of this.memoryFallback.entries()) {
      try {
        results.push({ roomId, state: JSON.parse(rec.stateJson) });
      } catch (e) {}
    }
    return results;
  }
}
