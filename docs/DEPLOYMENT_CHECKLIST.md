# Production Deployment Checklist

## Backend

- [ ] Deploy Node backend on a platform with WebSocket support.
- [ ] Set `NODE_ENV=production`.
- [ ] Set `PUBLIC_APP_ORIGIN` to the final HTTPS origin.
- [ ] Set `STORAGE_DRIVER=supabase`.
- [ ] Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Set `GROQ_API_KEY` server-side only.
- [ ] Configure request logging and platform log retention.

## Supabase

- [ ] Run `supabase/001_realtime_schema.sql`.
- [ ] Confirm tables exist: `aria_rooms`, `aria_room_players`, `aria_room_events`, `aria_game_answers`, `aria_webrtc_signals`.
- [ ] Confirm RLS is enabled and direct anonymous writes are denied.
- [ ] Confirm backend can create a room using the service role key.

## TURN/STUN

- [ ] Provision a TURN service.
- [ ] Set `TURN_URLS` with UDP and TCP TURN URLs plus at least one STUN URL.
- [ ] Set `TURN_USERNAME` and `TURN_CREDENTIAL`.
- [ ] Test a call between WiFi and mobile data.
- [ ] Test a call behind a restrictive school/work network.

## Browser verification

- [ ] Chrome desktop.
- [ ] Edge desktop.
- [ ] Firefox desktop.
- [ ] Safari desktop.
- [ ] iPhone Safari.
- [ ] Android Chrome.

## Functional verification

- [ ] AI chat request goes to `/api/ai/chat`.
- [ ] Audio transcription request goes to `/api/ai/transcribe`.
- [ ] Browser localStorage has no `aria_room_*` room sync data.
- [ ] Two-device room create/join works.
- [ ] Room chat syncs instantly.
- [ ] Host-only game start is enforced.
- [ ] Both clients see identical questions.
- [ ] Duplicate answers are rejected.
- [ ] Scores are server-authoritative.
- [ ] Video call connects by room code, without SDP copy-paste.
- [ ] ICE candidates are exchanged automatically.
- [ ] End call releases camera and mic.
- [ ] Refresh/page close marks player disconnected.
