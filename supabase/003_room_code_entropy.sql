-- Migration: widen room code constraint from 6 to 8 digits (100M combinations)
-- Run after 002_session_tokens.sql

alter table public.aria_rooms
  drop constraint if exists aria_rooms_code_check;

alter table public.aria_rooms
  add constraint aria_rooms_code_check check (code ~ '^[0-9]{8}$');
