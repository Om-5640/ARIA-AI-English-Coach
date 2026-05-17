import { cleanRoomCode } from '../utils/ids.js';
import { HttpError } from '../utils/errors.js';

export function requireAuth(store) {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) return next(new HttpError(401, 'Authentication required.', 'unauthorized'));

      const code = cleanRoomCode(req.params.code || '');
      if (!code) return next(new HttpError(400, 'Room code required.', 'missing_room'));

      const playerId = String(req.body?.playerId || '').trim();
      if (!playerId) return next(new HttpError(400, 'playerId required.', 'missing_player'));

      const player = await store.verifyPlayerToken(code, playerId, token);
      if (!player) return next(new HttpError(403, 'Invalid session token.', 'forbidden'));

      req.player = player;
      next();
    } catch (error) {
      next(error);
    }
  };
}
