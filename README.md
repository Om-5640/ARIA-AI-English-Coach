# ARIA — AI English Coach

**Real-time AI-powered English language learning with live video calls, multiplayer compete games, and a fully secured backend.**

ARIA is a full-stack language learning platform. Students get instant AI coaching, practice speaking via live peer video/voice calls, and compete with friends in real-time quiz battles — all without exposing any API keys to the browser.

---

## Features

| Feature | Details |
|---|---|
| **AI Coaching** | Groq-powered grammar correction, fluency scoring, vocabulary teaching, debate practice |
| **Live Video/Voice Calls** | WebRTC peer-to-peer calling with automatic signaling — no SDP copy-paste |
| **Compete with Friends** | Real-time quiz/debate/vocab battles via 6-digit room codes |
| **Secure by Design** | All API keys stay server-side; browser never touches Groq or Supabase directly |
| **Production Ready** | Supabase persistence, TURN/STUN, rate limiting, WebSocket hub, Docker support |

---

## Tech Stack

**Backend** — Node.js 22, Express, WebSocket (`ws`), Supabase, Groq SDK  
**Frontend** — Vanilla JS/HTML/CSS (no framework), WebRTC  
**Infra** — Docker, Supabase (Postgres + RLS), Twilio/Metered TURN servers

---

## Architecture

```
Browser A                    Backend (Node/Express)              Browser B
─────────                    ──────────────────────              ─────────
  UI ──── fetch /api/ai ────► AI proxy ──► Groq API
  UI ──── fetch /api/rooms ─► Room engine ──► Supabase
  UI ──── WebSocket ────────► Realtime hub ──────────────────► WebSocket
  UI ◄─── WebRTC offer ──────► Signal relay ──────────────────► WebRTC answer
```

- **AI proxy** — strips browser auth headers, forwards to Groq server-side, returns response
- **Room engine** — creates/joins rooms, manages game state, scores answers authoritatively
- **Realtime hub** — WebSocket server broadcasts `room.snapshot` and `webrtc.signal` events to all subscribers
- **Signal relay** — stores and broadcasts WebRTC offers/answers/ICE candidates so peers never exchange SDP manually

---

## Quick Start (Local)

### Prerequisites
- Node.js 22+
- A free [Groq API key](https://console.groq.com)

```bash
git clone https://github.com/Om-5640/ARIA-AI-English-Coach.git
cd ARIA-AI-English-Coach/backend
cp .env.example .env
```

Edit `.env` — minimum required for local testing:

```env
GROQ_API_KEY=your_groq_key_here
STORAGE_DRIVER=memory
NODE_ENV=development
PORT=8080
```

```bash
npm install
npm start
```

Open **http://localhost:8080** — the full app runs from a single port.

---

## Production Setup

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor → New query**
3. Paste and run `supabase/001_realtime_schema.sql`
4. Copy your **Project URL** and **service_role key** from Project Settings → API

### 2. TURN Server (for cross-network video calls)

Free options:
- [Metered.ca](https://dashboard.metered.ca) — free tier, instant credentials
- [Twilio Network Traversal](https://twilio.com) — free trial, reliable

### 3. Environment Variables

```env
NODE_ENV=production
PORT=8080
PUBLIC_APP_ORIGIN=https://your-domain.com

# AI
GROQ_API_KEY=your_groq_key
GROQ_CHAT_MODEL=llama-3.3-70b-versatile
GROQ_STT_MODEL=whisper-large-v3-turbo

# Storage
STORAGE_DRIVER=supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# WebRTC TURN
TURN_URLS=turn:global.turn.twilio.com:3478?transport=udp,turn:global.turn.twilio.com:443?transport=tcp
TURN_USERNAME=your_turn_username
TURN_CREDENTIAL=your_turn_credential

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

### 4. Deploy

**Docker (recommended):**
```bash
docker build -t aria-coach .
docker run -p 8080:8080 --env-file backend/.env aria-coach
```

**Any Node host** (Railway, Render, Fly.io, VPS):
```bash
cd backend && npm ci --omit=dev && node src/server.js
```

> WebRTC camera/mic require **HTTPS** in production. Put the app behind a TLS-terminating proxy (Caddy, nginx, Cloudflare Tunnel).

---

## Testing Two-Browser Calls

1. Start the backend
2. Open **http://localhost:8080** in Browser A → Login → Practice with a Friend → **Start Video Call** → copy the 6-digit code
3. Open **http://localhost:8080** in Browser B → Login → Practice with a Friend → paste code → **Join Call**

> If both browsers are on the same machine and share a camera, Tab A gets video and Tab B auto-falls back to voice-only. For true two-camera testing, use two different physical devices on the same network.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check + storage driver info |
| `GET` | `/api/config` | Client config (realtime path, room limits) |
| `GET` | `/api/webrtc/ice` | ICE/TURN server credentials |
| `POST` | `/api/rooms` | Create a room (compete or call) |
| `POST` | `/api/rooms/:code/join` | Join a room by code |
| `POST` | `/api/rooms/:code/start` | Host starts the game |
| `POST` | `/api/rooms/:code/answer` | Submit a quiz answer |
| `POST` | `/api/rooms/:code/leave` | Leave / disconnect from room |
| `POST` | `/api/webrtc/rooms/:code/signal` | Relay WebRTC signal to peer |
| `POST` | `/api/ai/chat` | Groq chat proxy |
| `POST` | `/api/ai/transcribe` | Groq Whisper STT proxy |
| `WS` | `/realtime` | WebSocket hub (room.subscribe, room.snapshot, webrtc.signal) |

---

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── server.js              # Express app + static serving
│   │   ├── realtime/hub.js        # WebSocket broadcast hub
│   │   ├── routes/
│   │   │   ├── rooms.js           # Room + game lifecycle
│   │   │   ├── webrtc.js          # Signal relay + ICE config
│   │   │   └── ai.js              # Groq proxy (chat + STT)
│   │   └── services/
│   │       ├── store.js           # MemoryStore + SupabaseStore
│   │       ├── gameEngine.js      # Deterministic question shuffle + scoring
│   │       ├── groqClient.js      # Groq SDK wrapper
│   │       └── turn.js            # TURN credential builder
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── index.html                 # Full ARIA UI (original, unmodified)
│   └── src/
│       └── production-overrides.js  # Runtime overlay — replaces stub functions
├── supabase/
│   └── 001_realtime_schema.sql    # All tables, indexes, RLS policies, cleanup fn
├── Dockerfile
└── .dockerignore
```

---

## Security

- **API keys never reach the browser** — Groq and Supabase keys are server-only
- **Row Level Security** — Supabase tables deny all anonymous writes; only the service role key (backend) can write
- **Rate limiting** — 120 req/min per IP by default (configurable)
- **Helmet** — security headers on all responses
- **Input validation** — Zod schemas on all API routes
- **Room expiry** — rooms auto-expire after 2 hours; cleanup runs every 5 minutes

---

## License

MIT
