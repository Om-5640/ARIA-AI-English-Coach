-- Migration: add session_token to aria_room_players
-- Run this after 001_realtime_schema.sql.
-- The backend verifies player identity using this token on all protected endpoints.

alter table public.aria_room_players
  add column if not exists session_token text;

-- Index speeds up the token-verification query in verifyPlayerToken()
create index if not exists aria_players_session_token_idx
  on public.aria_room_players (room_code, player_id, session_token)
  where session_token is not null;
