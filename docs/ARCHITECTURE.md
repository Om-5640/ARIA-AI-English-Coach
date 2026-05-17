# ARIA Realtime Architecture

## Critical weaknesses found in the original app

- Room state was kept in browser localStorage, so cross-device joining failed by design.
- Room updates were polled every second, which caused stale state, race conditions, and unnecessary CPU/network work.
- Multiplayer game questions were shuffled independently per client, causing mismatched questions and scores.
- Friend scoring was simulated with random timers, not synchronized with a real player.
- WebRTC required manual SDP copy-paste and waited for ICE gathering completion, so it failed across many NAT/mobile networks.
- Only public Google STUN servers were configured; no TURN path existed for CGNAT or restrictive networks.
- AI calls were made directly from the browser to Groq with a user-entered key.
- Media streams and peer connections had incomplete cleanup on pagehide/disconnect.
- Error reporting existed but there was no structured backend observability.

## New request flow

### AI

Browser → `/api/ai/chat` or `/api/ai/transcribe` → server-side Groq key → Groq.

No provider secret is stored or required in the browser.

### Rooms and games

Browser → REST API for commands → authoritative backend store → WebSocket broadcast → all subscribed clients.

Commands include create, join, start, answer, next, chat, leave. The backend generates deterministic questions from the room code and owns all score updates.

### WebRTC

Browser A creates a call room. Browser B joins by 6-digit room code. Both clients subscribe to the room. SDP offers/answers and ICE candidates are exchanged automatically through the backend signaling endpoint and WebSocket broadcasts.

## Important production note

The backend WebSocket hub is real realtime and authoritative per running instance. For horizontal scaling, either:

- Use sticky sessions at the load balancer, or
- Add Redis/NATS/Supabase Realtime fan-out between backend instances.

The Supabase schema already persists all durable state and can support either strategy.
