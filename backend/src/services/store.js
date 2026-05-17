import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

function isoPlusMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function toRoom(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    mode: row.mode,
    hostPlayerId: row.host_player_id,
    status: row.status,
    maxPlayers: row.max_players,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    gameState: row.game_state || {}
  };
}

function toPlayer(row) {
  if (!row) return null;
  return {
    roomId: row.room_id,
    roomCode: row.room_code,
    playerId: row.player_id,
    displayName: row.display_name,
    role: row.role,
    connected: row.connected,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at
  };
}

function safePlayer(player) {
  if (!player) return null;
  const { sessionToken: _token, ...safe } = player;
  return safe;
}

export class MemoryStore {
  constructor() {
    this.rooms = new Map();
    this.players = new Map();
    this.events = [];
    this.signals = [];
  }

  async createRoom({ code, mode, hostPlayerId, maxPlayers, ttlMinutes }) {
    if (this.rooms.has(code)) throw Object.assign(new Error('Room code already exists'), { code: 'duplicate_room' });
    const now = new Date().toISOString();
    const room = {
      id: crypto.randomUUID(),
      code,
      mode,
      hostPlayerId,
      status: 'waiting',
      maxPlayers,
      createdAt: now,
      expiresAt: isoPlusMinutes(ttlMinutes),
      updatedAt: now,
      gameState: {}
    };
    this.rooms.set(code, room);
    this.players.set(code, new Map());
    return room;
  }

  async getRoom(code) {
    return this.rooms.get(code) || null;
  }

  async updateRoom(code, patch) {
    const existing = this.rooms.get(code);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.rooms.set(code, next);
    return next;
  }

  async addPlayer(code, player) {
    const room = await this.getRoom(code);
    if (!room) return null;
    const collection = this.players.get(code) || new Map();
    const now = new Date().toISOString();
    const next = {
      roomId: room.id,
      roomCode: code,
      playerId: player.playerId,
      displayName: player.displayName,
      role: player.role || 'guest',
      connected: player.connected ?? true,
      joinedAt: player.joinedAt || now,
      lastSeenAt: now,
      sessionToken: player.sessionToken || null
    };
    collection.set(next.playerId, next);
    this.players.set(code, collection);
    const { sessionToken, ...publicFields } = next;
    return { ...publicFields, sessionToken };
  }

  async updatePlayer(code, playerId, patch) {
    const collection = this.players.get(code);
    if (!collection?.has(playerId)) return null;
    const next = { ...collection.get(playerId), ...patch, lastSeenAt: new Date().toISOString() };
    collection.set(playerId, next);
    return safePlayer(next);
  }

  async listPlayers(code) {
    return [...(this.players.get(code)?.values() || [])]
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map(safePlayer);
  }

  async verifyPlayerToken(roomCode, playerId, token) {
    const collection = this.players.get(roomCode);
    const player = collection?.get(playerId);
    if (!player || !token || player.sessionToken !== token) return null;
    return safePlayer(player);
  }

  async removePlayer(code, playerId) {
    return this.updatePlayer(code, playerId, { connected: false });
  }

  async addEvent(code, event) {
    const room = await this.getRoom(code);
    const item = {
      id: crypto.randomUUID(),
      roomId: room?.id || null,
      roomCode: code,
      type: event.type,
      playerId: event.playerId || null,
      payload: event.payload || {},
      createdAt: new Date().toISOString()
    };
    this.events.push(item);
    return item;
  }

  async listEvents(code, limit = 50) {
    return this.events.filter(e => e.roomCode === code).slice(-limit);
  }

  async addSignal(code, signal) {
    const item = {
      id: crypto.randomUUID(),
      roomCode: code,
      fromPlayerId: signal.fromPlayerId,
      toPlayerId: signal.toPlayerId || null,
      type: signal.type,
      payload: signal.payload || {},
      createdAt: new Date().toISOString()
    };
    this.signals.push(item);
    return item;
  }

  async cleanupExpiredRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (new Date(room.expiresAt).getTime() < now || room.status === 'ended') {
        this.rooms.delete(code);
        this.players.delete(code);
      }
    }
  }
}

export class SupabaseStore {
  constructor({ url, serviceRoleKey }) {
    this.supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async createRoom({ code, mode, hostPlayerId, maxPlayers, ttlMinutes }) {
    const { data, error } = await this.supabase.from('aria_rooms').insert({
      code,
      mode,
      host_player_id: hostPlayerId,
      max_players: maxPlayers,
      expires_at: isoPlusMinutes(ttlMinutes),
      game_state: {}
    }).select('*').single();
    if (error) throw error;
    return toRoom(data);
  }

  async getRoom(code) {
    const { data, error } = await this.supabase.from('aria_rooms').select('*').eq('code', code).maybeSingle();
    if (error) throw error;
    return toRoom(data);
  }

  async updateRoom(code, patch) {
    const dbPatch = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.hostPlayerId !== undefined) dbPatch.host_player_id = patch.hostPlayerId;
    if (patch.gameState !== undefined) dbPatch.game_state = patch.gameState;
    if (patch.expiresAt !== undefined) dbPatch.expires_at = patch.expiresAt;
    const { data, error } = await this.supabase.from('aria_rooms').update(dbPatch).eq('code', code).select('*').single();
    if (error) throw error;
    return toRoom(data);
  }

  async addPlayer(code, player) {
    const room = await this.getRoom(code);
    if (!room) return null;
    const row = {
      room_id: room.id,
      room_code: code,
      player_id: player.playerId,
      display_name: player.displayName,
      role: player.role || 'guest',
      connected: player.connected ?? true,
      last_seen_at: new Date().toISOString()
    };
    if (player.sessionToken) row.session_token = player.sessionToken;
    const { data, error } = await this.supabase.from('aria_room_players').upsert(row, { onConflict: 'room_id,player_id' }).select('*').single();
    if (error) throw error;
    const sessionToken = data.session_token || player.sessionToken || null;
    return { ...toPlayer(data), sessionToken };
  }

  async updatePlayer(code, playerId, patch) {
    const dbPatch = { last_seen_at: new Date().toISOString() };
    if (patch.connected !== undefined) dbPatch.connected = patch.connected;
    if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    const { data, error } = await this.supabase.from('aria_room_players').update(dbPatch).eq('room_code', code).eq('player_id', playerId).select('*').maybeSingle();
    if (error) throw error;
    return toPlayer(data);
  }

  async listPlayers(code) {
    const { data, error } = await this.supabase.from('aria_room_players').select('*').eq('room_code', code).order('joined_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(toPlayer);
  }

  async removePlayer(code, playerId) {
    return this.updatePlayer(code, playerId, { connected: false });
  }

  async verifyPlayerToken(roomCode, playerId, token) {
    if (!token) return null;
    const { data, error } = await this.supabase
      .from('aria_room_players')
      .select('*')
      .eq('room_code', roomCode)
      .eq('player_id', playerId)
      .eq('session_token', token)
      .maybeSingle();
    if (error || !data) return null;
    return toPlayer(data);
  }

  async addEvent(code, event) {
    const room = await this.getRoom(code);
    const { data, error } = await this.supabase.from('aria_room_events').insert({
      room_id: room?.id || null,
      room_code: code,
      type: event.type,
      player_id: event.playerId || null,
      payload: event.payload || {}
    }).select('*').single();
    if (error) throw error;
    return {
      id: data.id,
      roomId: data.room_id,
      roomCode: data.room_code,
      type: data.type,
      playerId: data.player_id,
      payload: data.payload || {},
      createdAt: data.created_at
    };
  }

  async listEvents(code, limit = 50) {
    const { data, error } = await this.supabase.from('aria_room_events').select('*').eq('room_code', code).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).reverse().map(row => ({
      id: row.id,
      roomId: row.room_id,
      roomCode: row.room_code,
      type: row.type,
      playerId: row.player_id,
      payload: row.payload || {},
      createdAt: row.created_at
    }));
  }

  async addSignal(code, signal) {
    const { data, error } = await this.supabase.from('aria_webrtc_signals').insert({
      room_code: code,
      from_player_id: signal.fromPlayerId,
      to_player_id: signal.toPlayerId || null,
      type: signal.type,
      payload: signal.payload || {}
    }).select('*').single();
    if (error) throw error;
    return {
      id: data.id,
      roomCode: data.room_code,
      fromPlayerId: data.from_player_id,
      toPlayerId: data.to_player_id,
      type: data.type,
      payload: data.payload || {},
      createdAt: data.created_at
    };
  }

  async cleanupExpiredRooms() {
    const { error } = await this.supabase.rpc('aria_expire_rooms');
    if (error) logger.warn('Supabase room cleanup RPC failed', { error: error.message });
  }
}

export function createStoreFromEnv() {
  const driver = process.env.STORAGE_DRIVER || 'supabase';
  if (driver === 'memory') {
    logger.warn('Using in-memory room store. Use STORAGE_DRIVER=supabase for production multi-instance deployments.');
    return new MemoryStore();
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_DRIVER=supabase.');
  }
  return new SupabaseStore({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
}
