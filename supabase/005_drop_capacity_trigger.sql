-- Migration: remove capacity trigger (PostgREST upsert + BEFORE INSERT trigger conflict)
-- The JS-level count check in SupabaseStore.addPlayer provides equivalent protection.
-- Run after 004_capacity_trigger.sql

drop trigger if exists aria_enforce_room_capacity on aria_room_players;
drop function if exists aria_check_room_capacity();
