import express from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { cleanRoomCode } from '../utils/ids.js';
import { assertOrThrow } from '../utils/errors.js';
import { getIceServers } from '../services/turn.js';
import { requireAuth } from '../middleware/auth.js';

const signalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'rate_limited', message: 'Too many signals. Slow down.' } }
});

const signalSchema = z.object({
  toPlayerId: z.string().trim().min(3).max(80).optional().nullable(),
  type: z.enum(['offer', 'answer', 'candidate', 'renegotiate', 'bye']),
  payload: z.record(z.any()).default({})
}).superRefine((data, ctx) => {
  if ((data.type === 'offer' || data.type === 'answer') && !data.payload?.description) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'offer/answer signal must include payload.description', path: ['payload'] });
  }
  if (data.type === 'candidate' && !data.payload?.candidate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'candidate signal must include payload.candidate', path: ['payload'] });
  }
});

export function webrtcRouter({ store, hub }) {
  const router = express.Router();
  const auth = requireAuth(store);

  router.get('/ice', (req, res) => {
    res.json({ ok: true, ...getIceServers() });
  });

  // fromPlayerId is taken from req.player (set by auth middleware) — never from the body.
  // This prevents any player from sending signals on behalf of another player.
  router.post('/rooms/:code/signal', auth, signalLimiter, async (req, res, next) => {
    try {
      const code = cleanRoomCode(req.params.code);
      const body = signalSchema.parse(req.body || {});
      const room = await store.getRoom(code);
      assertOrThrow(room, 404, 'Room not found.', 'room_not_found');
      const players = await store.listPlayers(code);
      if (body.toPlayerId) assertOrThrow(players.some(p => p.playerId === body.toPlayerId), 403, 'Recipient is not in this room.', 'recipient_not_in_room');
      const signal = await store.addSignal(code, { ...body, fromPlayerId: req.player.playerId });
      hub.publishSignal(code, signal);
      res.json({ ok: true, signal });
    } catch (error) { next(error); }
  });

  return router;
}
