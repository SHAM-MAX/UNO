import { WebSocket } from 'ws';

// Keep broadcasts proportional to this room, rather than the whole server.
export class RoomConnections extends Map {
  rooms = new Map();

  set(socket, metadata) {
    this.delete(socket);
    super.set(socket, metadata);
    let members = this.rooms.get(metadata.roomId);
    if (!members) this.rooms.set(metadata.roomId, members = new Map());
    members.set(socket, metadata);
    return this;
  }

  delete(socket) {
    const metadata = this.get(socket);
    if (metadata) {
      const members = this.rooms.get(metadata.roomId);
      members?.delete(socket);
      if (!members?.size) this.rooms.delete(metadata.roomId);
    }
    return super.delete(socket);
  }

  clear() {
    super.clear();
    this.rooms.clear();
  }

  forRoom(roomId) {
    return this.rooms.get(roomId) || new Map();
  }
}

export function sendRoomMessage(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  // Let the existing reconnect/resync flow recover stalled clients. Never
  // silently drop an authoritative update and leave a client out of sync.
  if (socket.bufferedAmount > 1024 * 1024) {
    socket.terminate();
    return false;
  }
  socket.send(message);
  return true;
}
