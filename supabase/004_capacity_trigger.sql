-- Migration: DB-level room capacity enforcement (true atomicity for Supabase)
-- Run after 003_room_code_entropy.sql

create or replace function aria_check_room_capacity()
returns trigger language plpgsql as $$
declare
  v_max  int;
  v_curr int;
begin
  -- Upsert (rejoin): player already exists in this room — skip capacity check
  if exists (
    select 1 from aria_room_players
    where room_id = new.room_id and player_id = new.player_id
  ) then return new; end if;

  select max_players into v_max from aria_rooms where id = new.room_id;
  select count(*)    into v_curr from aria_room_players where room_id = new.room_id;

  if v_curr >= v_max then
    raise exception 'Room is full.' using errcode = 'P0001', detail = 'room_full';
  end if;
  return new;
end;
$$;

drop trigger if exists aria_enforce_room_capacity on aria_room_players;
create trigger aria_enforce_room_capacity
  before insert on aria_room_players
  for each row execute function aria_check_room_capacity();
