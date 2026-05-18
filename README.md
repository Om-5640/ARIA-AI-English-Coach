# ARIA

**AI-powered English coaching with real-time multiplayer, live peer calling, and a fully server-secured AI backend.**

ARIA is a production-grade language learning platform built for students who want genuine progress. It combines a Groq-powered coaching loop, peer-to-peer WebRTC calling with automatic signaling, and live multiplayer game modes — all without exposing API keys to the browser.

---

## What it does

**AI Coaching** — Speak naturally; ARIA transcribes, corrects grammar, scores fluency, teaches vocabulary, and maintains a persistent memory of your weak areas across sessions.

**Live Peer Calling** — Video and voice calls directly between browsers using WebRTC with automatic signaling. No manual SDP exchange, no third-party call service.

**Compete with Friends** — Real-time multiplayer rooms supporting three game modes: Quiz Race (grammar MCQ), Debate Battle (custom topic, AI-judged), and Vocab Showdown. Rooms are created with 8-digit codes; sessions authenticate with per-player server-issued tokens.

**Secure by Architecture** — The browser never touches Groq or Supabase directly. All AI calls are proxied server-side. Session tokens are 256-bit random values stored in `sessionStorage`, scoped per tab.

---

## Architecture

```
Browser                         Backend (Node.js / Express)              External
──────                          ───────────────────────────              ────────
UI ──── POST /api/ai/chat  ───► Groq proxy ──────────────────────────► Groq API
UI ──── POST /api/rooms    ───► Room engine ─────────────────────────► Supabase
UI ──── WS  /realtime      ───► Realtime hub ◄──► Redis (optional)
UI ──── POST /api/webrtc   ───► Signal relay
                                     │
                           room.snapshot broadcast
                                     │
UI ◄──────────────────────────── WebSocket ──────────────────────────► Browser B
```

### Backend

| Module | Responsibility |
|--------|---------------|
| `server.js` | Express app, static serving, error boundary |
| `realtime/hub.js` | WebSocket server — room subscriptions, heartbeat, ghost-player cleanup |
| `realtime/pubsub.js` | Optional Redis pub/sub adapter for multi-instance horizontal scaling |
| `routes/rooms.js` | Room lifecycle: create, join, start, answer, leave, event broadcast |
| `routes/webrtc.js` | ICE server config, signal relay with targeted peer delivery |
| `routes/ai.js` | Groq chat completion and Whisper STT proxy |
| `services/store.js` | Storage abstraction: `MemoryStore` (dev) and `SupabaseStore` (prod) |
| `services/gameEngine.js` | Deterministic game state: question shuffle, scoring, auto-advance |
| `services/groqClient.js` | Groq API wrapper with retry, timeout, and input sanitization |
| `middleware/auth.js` | Bearer token middleware — verifies per-player session tokens |

### Frontend

The frontend is a single `index.html` application (no build step required). `frontend/src/production-overrides.js` is loaded as a script and replaces stub functions at runtime, wiring the UI to the backend without modifying the original HTML:

- Intercepts `window.fetch()` calls to `api.groq.com` and redirects them to `/api/ai/*`
- Replaces `startCompeteRoom()`, `joinRoom()`, `sendCompeteMsg()`, and all other compete functions with backend-connected implementations
- Manages WebSocket lifecycle: connection, `room.subscribe` auth, snapshot application, reconnect with exponential backoff
- Handles WebRTC negotiation with Perfect Negotiation pattern (polite/impolite peers)

### Realtime Protocol

```
Client → Server:  { type: "room.subscribe", roomCode, playerId, sessionToken }
Server → Client:  { type: "room.snapshot",  room, players, events, serverTime }
Server → Client:  { type: "webrtc.signal",  signal, serverTime }
Server → Client:  { type: "error",          error }
```

All WS subscriptions require a valid session token. Heartbeat runs every 30 seconds; unresponsive clients are terminated.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (ESM) |
| HTTP | Express 5 |
| WebSocket | `ws` library |
| AI | Groq (`llama-3.3-70b-versatile`, `whisper-large-v3-turbo`) |
| Database | Supabase (Postgres + RLS) |
| Pub/Sub | In-process (default) or Redis via ioredis |
| Validation | Zod |
| Auth | 256-bit random session tokens (per-player, per-room) |
| Security | Helmet, CORS, express-rate-limit |
| WebRTC | Native browser APIs, automatic signaling |
| Frontend | Vanilla JS/HTML/CSS — no framework, no build step |
| Container | Docker |

---

## Local Development

### Prerequisites

- Node.js 22+
- A free [Groq API key](https://console.groq.com)

```bash
git clone https://github.com/Om-5640/ARIA-AI-English-Coach.git
cd ARIA-AI-English-Coach/backend
cp .env.example .env
```

Minimum `.env` for local development:

```env
GROQ_API_KEY=gsk_your_key_here
STORAGE_DRIVER=memory
NODE_ENV=development
PORT=8080
```

```bash
npm install
npm start
```

Open `http://localhost:8080`. The backend serves the frontend from the same port.

To test multiplayer locally, open two **separate browser tabs** — each tab gets its own `sessionStorage` identity so they behave as independent players.

---

## Production Setup

### 1. Database migrations

Create a Supabase project, open the SQL editor, and run the migrations in order:

```
supabase/001_realtime_schema.sql   — tables, indexes, RLS, cleanup function
supabase/002_session_tokens.sql    — session_token column on aria_room_players
supabase/003_room_code_entropy.sql — widens room code constraint to 8 digits
supabase/004_capacity_trigger.sql  — (reference only — superseded)
supabase/005_drop_capacity_trigger.sql — removes trigger; capacity enforced in application layer
```

### 2. Environment variables

```env
# Server
NODE_ENV=production
PORT=8080
PUBLIC_APP_ORIGIN=https://your-domain.com

# AI (required)
GROQ_API_KEY=gsk_your_key_here
GROQ_CHAT_MODEL=llama-3.3-70b-versatile
GROQ_STT_MODEL=whisper-large-v3-turbo

# Storage (required in production)
STORAGE_DRIVER=supabase
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# WebRTC TURN servers (required for cross-network video calls)
TURN_URLS=stun:stun.l.google.com:19302,turn:your.turn.server:3478
TURN_USERNAME=your_turn_username
TURN_CREDENTIAL=your_turn_credential

# Rate limiting (optional — defaults shown)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
AI_RATE_LIMIT_MAX=30

# Redis pub/sub (optional — enables multi-instance scaling)
REDIS_URL=redis://your-redis-host:6379

# Room settings (optional)
ROOM_TTL_MINUTES=120
MAX_ROOM_PLAYERS=2
```

### 3. TURN server

WebRTC video calls across different networks require a TURN server. Free options:

- [Metered.ca](https://dashboard.metered.ca) — free tier available
- [Twilio Network Traversal Service](https://www.twilio.com/stun-turn) — free trial credits

### 4. Deploy

**Docker:**

```bash
docker build -t aria-coach .
docker run -p 8080:8080 --env-file backend/.env aria-coach
```

**Node.js on any host (Railway, Render, Fly.io, VPS):**

```bash
cd backend && npm ci --omit=dev && node src/server.js
```

WebRTC camera and microphone access requires **HTTPS** in production. Terminate TLS at the reverse proxy layer (Caddy, nginx, Cloudflare Tunnel).

---

## API Reference

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check — returns storage driver and server time |
| `GET` | `/api/config` | Client configuration — realtime path, room limits |
| `GET` | `/api/webrtc/ice` | ICE/TURN server credentials |
| `POST` | `/api/rooms` | Create a room (`mode`: quiz \| debate \| vocab \| call-video \| call-voice) |
| `POST` | `/api/rooms/:code/join` | Join an existing room by 8-digit code |
| `WS` | `/realtime` | WebSocket hub — subscribe to room snapshots and signals |

### Authenticated (Bearer session token required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/rooms/:code/start` | Host starts the game (includes custom debate topic) |
| `POST` | `/api/rooms/:code/answer` | Submit a quiz answer (0-indexed) |
| `POST` | `/api/rooms/:code/events` | Post a chat or system event |
| `POST` | `/api/rooms/:code/leave` | Leave and trigger presence update |
| `POST` | `/api/webrtc/rooms/:code/signal` | Relay WebRTC signal to a specific peer |
| `POST` | `/api/ai/chat` | Groq chat completion proxy |
| `POST` | `/api/ai/transcribe` | Groq Whisper STT proxy (multipart audio) |

Session tokens are issued on room create/join and must be sent as `Authorization: Bearer <token>`. Tokens are scoped per player per room and stored in `sessionStorage`.

---

## Game Modes

### Quiz Race
8 shuffled grammar and vocabulary questions. Players answer independently; the server auto-advances when all connected players have submitted. Winner determined by final score.

### Debate Battle
1. Host types a custom debate topic before starting.
2. Sides (FOR / AGAINST) are randomly assigned at game start.
3. Players argue via the room chat.
4. Host clicks "End Debate & Get AI Verdict" — the full transcript is sent to Groq, which summarises each side's arguments, declares a winner, and scores both players out of 10.
5. Verdict is posted as a system message visible to both players.

### Vocab Showdown
Same quiz infrastructure as Quiz Race; uses vocabulary-focused questions.

---

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── middleware/auth.js
│   │   ├── realtime/
│   │   │   ├── hub.js
│   │   │   └── pubsub.js
│   │   ├── routes/
│   │   │   ├── rooms.js
│   │   │   ├── webrtc.js
│   │   │   └── ai.js
│   │   ├── services/
│   │   │   ├── store.js
│   │   │   ├── gameEngine.js
│   │   │   ├── groqClient.js
│   │   │   └── turn.js
│   │   ├── data/
│   │   │   ├── competeQuestions.js
│   │   │   └── debateTopics.js
│   │   └── utils/
│   │       ├── ids.js
│   │       ├── errors.js
│   │       ├── logger.js
│   │       └── validateEnv.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── index.html
│   └── src/
│       └── production-overrides.js
├── supabase/
│   ├── 001_realtime_schema.sql
│   ├── 002_session_tokens.sql
│   ├── 003_room_code_entropy.sql
│   ├── 004_capacity_trigger.sql
│   └── 005_drop_capacity_trigger.sql
├── Dockerfile
└── docs/
    ├── ARCHITECTURE.md
    └── DEPLOYMENT_CHECKLIST.md
```

---

## Security Considerations

**API key isolation** — `GROQ_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` never leave the server process. The browser receives only proxied responses.

**Session tokens** — Per-player, per-room, 256-bit random hex strings. Stored in `sessionStorage` (tab-isolated, cleared on tab close). Verified server-side on every protected request and WebSocket subscription.

**Input validation** — All API routes validate with Zod schemas. AI chat inputs are sanitized: last 24 messages, 12,000 character cap per message, role allowlist.

**Rate limiting** — 120 requests/min per IP on all API routes; 30 requests/min on AI endpoints; 30 signals/min on the WebRTC signal route.

**Room expiry** — Rooms expire after a configurable TTL (default 2 hours). A cleanup interval runs every 5 minutes. Ended rooms are purged from Supabase.

**Capacity enforcement** — Room player limits are enforced at the application layer in `SupabaseStore.addPlayer` with a best-effort count check. The database-level trigger was removed due to a conflict with Supabase's upsert implementation.

---

## Scaling

The default configuration runs on a single Node.js process with in-process pub/sub. To scale horizontally:

1. Set `REDIS_URL` — the realtime hub switches to `RedisPubSub`, which fans out `room.snapshot` broadcasts across instances via a `room:*` pattern subscription.
2. Deploy behind a load balancer with sticky sessions, or let Redis handle cross-instance fan-out without stickiness.

The `SupabaseStore` is stateless by design — any backend instance can serve any request.

---

## Browser and Mobile Support

| Browser | Status |
|---------|--------|
| Chrome 90+ | Full support |
| Firefox 90+ | Full support |
| Safari 15+ (iOS/macOS) | Full support |
| Samsung Internet 14+ | Full support |
| Edge 90+ | Full support |

The UI uses `100dvh` for mobile viewport height, `env(safe-area-inset-bottom)` for notch/home-button spacing, and `font-size: 16px` on inputs to prevent iOS zoom. Mobile layout stacks vertically with a fixed bottom navigation bar.

WebRTC camera and microphone require a secure context (HTTPS or localhost).

---

## License

MIT
