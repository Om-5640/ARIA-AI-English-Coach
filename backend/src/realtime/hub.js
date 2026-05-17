import { WebSocketServer } from 'ws';
import { logger } from '../utils/logger.js';

function safeSend(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

export class RealtimeHub {
  constructor({ store }) {
    this.store = store;
    this.wss = null;
    this.clients = new Map(); // socketId -> {ws, playerId, rooms:Set<string>, alive:boolean}
    this.rooms = new Map(); // roomCode -> Set<socketId>
    this.nextId = 1;
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/realtime' });
    this.wss.on('connection', ws => this.handleConnection(ws));
    setInterval(() => this.heartbeat(), 30000).unref();
    logger.info('Realtime WebSocket hub attached', { path: '/realtime' });
  }

  handleConnection(ws) {
    const socketId = `s_${this.nextId++}`;
    this.clients.set(socketId, { ws, playerId: null, rooms: new Set(), alive: true });
    safeSend(ws, { type: 'connected', socketId, serverTime: new Date().toISOString() });

    ws.on('pong', () => {
      const client = this.clients.get(socketId);
      if (client) client.alive = true;
    });

    ws.on('message', raw => {
      try {
        const message = JSON.parse(String(raw));
        this.handleMessage(socketId, message).catch(error => {
          logger.warn('handleMessage error', { socketId, error: error.message });
          const client = this.clients.get(socketId);
          if (client) safeSend(client.ws, { type: 'error', error: 'Internal realtime error.' });
        });
      } catch (error) {
        safeSend(ws, { type: 'error', error: 'Invalid realtime message.' });
      }
    });

    ws.on('close', async () => {
      const client = this.clients.get(socketId);
      if (!client) return;
      for (const code of client.rooms) {
        const set = this.rooms.get(code);
        set?.delete(socketId);
        if (client.playerId) {
          try {
            await this.store.updatePlayer(code, client.playerId, { connected: false });
            await this.broadcastSnapshot(code);
          } catch (error) {
            logger.warn('Presence disconnect update failed', { code, error: error.message });
          }
        }
      }
      this.clients.delete(socketId);
    });
  }

  async handleMessage(socketId, message) {
    const client = this.clients.get(socketId);
    if (!client) return;

    if (message.type === 'room.subscribe') {
      const roomCode = String(message.roomCode || '').trim();
      const playerId = String(message.playerId || '').trim();
      const sessionToken = String(message.sessionToken || '').trim();

      if (!/^\d{6}$/.test(roomCode) || !playerId) {
        safeSend(client.ws, { type: 'error', error: 'Invalid room subscription.' });
        return;
      }

      if (!sessionToken) {
        safeSend(client.ws, { type: 'error', error: 'Authentication required for room subscription.' });
        return;
      }

      const player = await this.store.verifyPlayerToken(roomCode, playerId, sessionToken);
      if (!player) {
        safeSend(client.ws, { type: 'error', error: 'Unauthorized room subscription.' });
        return;
      }

      client.playerId = playerId;
      client.rooms.add(roomCode);
      if (!this.rooms.has(roomCode)) this.rooms.set(roomCode, new Set());
      this.rooms.get(roomCode).add(socketId);
      await this.store.updatePlayer(roomCode, playerId, { connected: true });
      await this.broadcastSnapshot(roomCode);
      return;
    }

    if (message.type === 'ping') {
      safeSend(client.ws, { type: 'pong', serverTime: new Date().toISOString() });
    }
  }

  heartbeat() {
    for (const [socketId, client] of this.clients.entries()) {
      if (!client.alive) {
        try { client.ws.terminate(); } catch {}
        this.clients.delete(socketId);
        continue;
      }
      client.alive = false;
      try { client.ws.ping(); } catch {}
    }
  }

  broadcast(roomCode, message) {
    const sockets = this.rooms.get(roomCode) || new Set();
    for (const socketId of sockets) {
      const client = this.clients.get(socketId);
      if (client) safeSend(client.ws, message);
    }
  }

  async buildSnapshot(roomCode) {
    const [room, players, events] = await Promise.all([
      this.store.getRoom(roomCode),
      this.store.listPlayers(roomCode),
      this.store.listEvents(roomCode, 60)
    ]);
    return { room, players, events };
  }

  async broadcastSnapshot(roomCode) {
    const snapshot = await this.buildSnapshot(roomCode);
    this.broadcast(roomCode, { type: 'room.snapshot', ...snapshot, serverTime: new Date().toISOString() });
    return snapshot;
  }

  async publishRoomEvent(roomCode, event) {
    this.broadcast(roomCode, { type: 'room.event', event, serverTime: new Date().toISOString() });
    await this.broadcastSnapshot(roomCode);
  }

  publishSignal(roomCode, signal) {
    this.broadcast(roomCode, { type: 'webrtc.signal', signal, serverTime: new Date().toISOString() });
  }
}
