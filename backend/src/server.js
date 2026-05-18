import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createStoreFromEnv } from './services/store.js';
import { RealtimeHub } from './realtime/hub.js';
import { createPubSub } from './realtime/pubsub.js';
import { roomsRouter } from './routes/rooms.js';
import { webrtcRouter } from './routes/webrtc.js';
import { aiRouter } from './routes/ai.js';
import { HttpError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { validateEnv } from './utils/validateEnv.js';

validateEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// rootDir = project root (one level above backend/)
const rootDir = path.resolve(__dirname, '../..');
// frontend/ sits alongside backend/ at the project root
const frontendDir = path.join(rootDir, 'frontend');

const config = {
  port: Number(process.env.PORT || 8080),
  roomTtlMinutes: Number(process.env.ROOM_TTL_MINUTES || 120),
  maxRoomPlayers: Number(process.env.MAX_ROOM_PLAYERS || 2),
  publicAppOrigin: process.env.PUBLIC_APP_ORIGIN || '*'
};

const store = createStoreFromEnv();
const pubsub = await createPubSub();
const app = express();

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: config.publicAppOrigin === '*' ? true : config.publicAppOrigin.split(',').map(v => v.trim()),
  credentials: false
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.RATE_LIMIT_MAX || 120),
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

const server = http.createServer(app);
const hub = new RealtimeHub({ store, pubsub });
hub.attach(server);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0', storage: process.env.STORAGE_DRIVER || 'supabase', now: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    realtimePath: '/realtime',
    roomTtlMinutes: config.roomTtlMinutes,
    maxRoomPlayers: config.maxRoomPlayers,
    aiProxy: true,
    manualSdpDisabled: true
  });
});

app.use('/api/rooms', roomsRouter({ store, hub, config }));
app.use('/api/webrtc', webrtcRouter({ store, hub }));
app.use('/api/ai', aiRouter());

app.use(express.static(frontendDir, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : (err.status || 500);
  const code = err instanceof HttpError ? err.code : (err.code || 'internal_error');
  const message = status >= 500 ? 'Internal server error.' : err.message;
  logger.error('HTTP error', { status, code, message: err.message, path: req.path });
  res.status(status).json({ ok: false, error: { code, message, details: err.details } });
});

setInterval(() => {
  store.cleanupExpiredRooms().catch(error => logger.warn('Room cleanup failed', { error: error.message }));
}, 5 * 60_000).unref();

server.listen(config.port, () => {
  logger.info('ARIA realtime backend started', { port: config.port, frontendDir });
});
