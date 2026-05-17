import express from 'express';
import { z } from 'zod';
import { cleanRoomCode } from '../utils/ids.js';
import { assertOrThrow } from '../utils/errors.js';
import { getIceServers } from '../services/turn.js';

const signalSchema = z.object({
  fromPlayerId: z.string().trim().min(3).max(80),
  toPlayerId: z.string().trim().min(3).max(80).optional().nullable(),
  type: z.enum(['offer', 'answer', 'candidate', 'renegotiate', 'bye']),
  payload: z.record(z.any()).default({})
});

export function webrtcRouter({ store, hub }) {
  const router = express.Router();

  router.get('/ice', (req, res) => {
    res.json({ ok: true, ...getIceServers() });
  });

  router.post('/rooms/:code/signal', async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const body = signalSchema.parse(req.body || {});
      const room = await store.getRoom(code);
      assertOrThrow(room, 404, 'Room not found.', 'room_not_found');
      const players = await store.listPlayers(code);
      assertOrThrow(players.some(p => p.playerId === body.fromPlayerId), 403, 'Sender is not in this room.', 'sender_not_in_room');
      if (body.toPlayerId) assertOrThrow(players.some(p => p.playerId === body.toPlayerId), 403, 'Recipient is not in this room.', 'recipient_not_in_room');
      const signal = await store.addSignal(code, body);
      hub.publishSignal(code, signal);
      res.json({ ok: true, signal });
    } catch (error) { next(error); }
  });

  return router;
}
