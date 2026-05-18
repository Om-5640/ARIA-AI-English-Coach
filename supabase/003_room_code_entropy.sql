-- Migration: widen room code constraint from 6 to 8 digits (100M combinations)
-- Run after 002_session_tokens.sql
--
-- Rooms are ephemeral (2-hour TTL). Any existing 6-digit rows are stale and
-- safe to delete. Cascade clears players, events, signals, and answers too.

delete from public.aria_rooms where code ~ '^[0-9]{6}$';

alter table public.aria_rooms
  drop constraint if exists aria_rooms_code_check;

alter table public.aria_rooms
  add constraint aria_rooms_code_check check (code ~ '^[0-9]{8}$');
