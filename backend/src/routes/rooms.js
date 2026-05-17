import express from 'express';
import { z } from 'zod';
import { newRoomCode, cleanRoomCode, newPlayerId } from '../utils/ids.js';
import { HttpError, assertOrThrow } from '../utils/errors.js';
import { createGameState, answerQuestion, advanceGame } from '../services/gameEngine.js';

const createRoomSchema = z.object({
  mode: z.enum(['quiz', 'debate', 'vocab', 'call-video', 'call-voice']).default('quiz'),
  displayName: z.string().trim().min(1).max(40),
  playerId: z.string().trim().min(3).max(80).optional()
});

const joinRoomSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  playerId: z.string().trim().min(3).max(80).optional()
});

const eventSchema = z.object({
  playerId: z.string().trim().min(3).max(80),
  type: z.enum(['chat', 'typing', 'system', 'presence']),
  payload: z.record(z.any()).default({})
});

const answerSchema = z.object({
  playerId: z.string().trim().min(3).max(80),
  answerIdx: z.number().int().min(0).max(10)
});

async function uniqueRoomCode(store) {
  for (let i = 0; i < 15; i += 1) {
    const code = newRoomCode();
    if (!(await store.getRoom(code))) return code;
  }
  throw new HttpError(503, 'Could not allocate a room code. Try again.', 'room_code_exhausted');
}

function ensureRoomUsable(room) {
  assertOrThrow(room, 404, 'Room not found.', 'room_not_found');
  assertOrThrow(new Date(room.expiresAt).getTime() > Date.now(), 410, 'Room expired.', 'room_expired');
  assertOrThrow(!['ended', 'expired'].includes(room.status), 410, 'Room is no longer active.', 'room_closed');
}

async function snapshot(store, code) {
  const [room, players, events] = await Promise.all([
    store.getRoom(code),
    store.listPlayers(code),
    store.listEvents(code, 60)
  ]);
  return { room, players, events };
}

export function roomsRouter({ store, hub, config }) {
  const router = express.Router();

  router.post('/', async (req, res, next) => {
    try {
      const body = createRoomSchema.parse(req.body || {});
      const playerId = body.playerId || newPlayerId();
      const code = await uniqueRoomCode(store);
      const room = await store.createRoom({
        code,
        mode: body.mode,
        hostPlayerId: playerId,
        maxPlayers: config.maxRoomPlayers,
        ttlMinutes: config.roomTtlMinutes
      });
      const player = await store.addPlayer(code, {
        playerId,
        displayName: body.displayName,
        role: 'host',
        connected: true
      });
      const event = await store.addEvent(code, { type: 'system', playerId, payload: { text: `${body.displayName} created the room.` } });
      const snap = await snapshot(store, code);
      hub.publishRoomEvent(code, event).catch(() => {});
      res.status(201).json({ ok: true, room, player, ...snap });
    } catch (error) { next(error); }
  });

  router.get('/:code', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      ensureRoomUsable(await store.getRoom(code));
      res.json({ ok: true, ...(await snapshot(store, code)) });
    } catch (error) { next(error); }
  });

  router.post('/:code/join', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const body = joinRoomSchema.parse(req.body || {});
      const room = await store.getRoom(code);
      ensureRoomUsable(room);
      const players = await store.listPlayers(code);
      const playerId = body.playerId || newPlayerId();
      const existing = players.find(p => p.playerId === playerId || p.displayName.toLowerCase() === body.displayName.toLowerCase());
      if (!existing) assertOrThrow(players.length < room.maxPlayers, 409, 'Room is full.', 'room_full');
      const player = await store.addPlayer(code, {
        playerId,
        displayName: body.displayName,
        role: room.hostPlayerId === playerId ? 'host' : 'guest',
        connected: true
      });
      const event = await store.addEvent(code, { type: 'system', playerId, payload: { text: `${body.displayName} joined the room.` } });
      hub.publishRoomEvent(code, event).catch(() => {});
      res.json({ ok: true, player, ...(await snapshot(store, code)) });
    } catch (error) { next(error); }
  });

  router.post('/:code/leave', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const playerId = String(req.body?.playerId || '');
      assertOrThrow(playerId, 400, 'playerId is required.', 'missing_player');
      const room = await store.getRoom(code);
      ensureRoomUsable(room);
      await store.removePlayer(code, playerId);
      const players = await store.listPlayers(code);
      const connected = players.filter(p => p.connected);
      if (room.hostPlayerId === playerId && connected.length) {
        await store.updateRoom(code, { hostPlayerId: connected[0].playerId });
        await store.updatePlayer(code, connected[0].playerId, { role: 'host' });
      }
      if (!connected.length) await store.updateRoom(code, { status: 'ended' });
      const event = await store.addEvent(code, { type: 'presence', playerId, payload: { connected: false } });
      await hub.publishRoomEvent(code, event);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post('/:code/events', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const body = eventSchema.parse(req.body || {});
      const room = await store.getRoom(code);
      ensureRoomUsable(room);
      const safePayload = { ...body.payload };
      if (typeof safePayload.text === 'string') safePayload.text = safePayload.text.slice(0, 1000);
      const event = await store.addEvent(code, { type: body.type, playerId: body.playerId, payload: safePayload });
      await hub.publishRoomEvent(code, event);
      res.json({ ok: true, event });
    } catch (error) { next(error); }
  });

  router.post('/:code/start', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const playerId = String(req.body?.playerId || '');
      const room = await store.getRoom(code);
      ensureRoomUsable(room);
      assertOrThrow(playerId === room.hostPlayerId, 403, 'Only the host can start this room.', 'host_required');
      const players = (await store.listPlayers(code)).filter(p => p.connected);
      assertOrThrow(players.length >= 2, 409, 'At least two connected players are required.', 'need_two_players');
      const gameState = createGameState(code, players.map(p => p.playerId), room.mode);
      await store.updateRoom(code, { status: 'active', gameState });
      const event = await store.addEvent(code, { type: 'system', playerId, payload: { text: 'Game started.' } });
      await hub.publishRoomEvent(code, event);
      res.json({ ok: true, ...(await snapshot(store, code)) });
    } catch (error) { next(error); }
  });

  router.post('/:code/answer', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const body = answerSchema.parse(req.body || {});
      const room = await store.getRoom(code);
      ensureRoomUsable(room);
      const players = await store.listPlayers(code);
      assertOrThrow(players.some(p => p.playerId === body.playerId), 403, 'Player is not in this room.', 'player_not_in_room');
      const result = answerQuestion(room.gameState, body.playerId, body.answerIdx);
      assertOrThrow(result.accepted, 409, result.reason || 'Answer not accepted.', 'answer_rejected');
      let nextState = result.gameState;
      const qIdx = nextState.currentQuestionIdx;
      const answerCount = Object.keys(nextState.answers?.[String(qIdx)] || {}).length;
      if (answerCount >= players.length) nextState = advanceGame(nextState);
      await store.updateRoom(code, { gameState: nextState, status: nextState.status === 'finished' ? 'ended' : 'active' });
      const event = await store.addEvent(code, { type: 'system', playerId: body.playerId, payload: { action: 'answer', correct: result.correct, questionIdx: qIdx } });
      await hub.publishRoomEvent(code, event);
      res.json({ ok: true, correct: result.correct, ...(await snapshot(store, code)) });
    } catch (error) { next(error); }
  });

  router.post('/:code/next', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const playerId = String(req.body?.playerId || '');
      const room = await store.getRoom(code);
      ensureRoomUsable(room);
      assertOrThrow(playerId === room.hostPlayerId, 403, 'Only the host can advance the game.', 'host_required');
      const gameState = advanceGame(room.gameState);
      await store.updateRoom(code, { gameState, status: gameState.status === 'finished' ? 'ended' : 'active' });
      const event = await store.addEvent(code, { type: 'system', playerId, payload: { action: 'advance', questionIdx: gameState.currentQuestionIdx } });
      await hub.publishRoomEvent(code, event);
      res.json({ ok: true, ...(await snapshot(store, code)) });
    } catch (error) { next(error); }
  });

  return router;
}
