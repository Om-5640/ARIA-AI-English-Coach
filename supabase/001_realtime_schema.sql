-- ARIA production realtime schema
-- Run in Supabase SQL editor, then set STORAGE_DRIVER=supabase and SUPABASE_SERVICE_ROLE_KEY in backend env.

create extension if not exists pgcrypto;

create table if not exists public.aria_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  mode text not null check (mode in ('quiz','debate','vocab','call-video','call-voice')),
  host_player_id text not null,
  status text not null default 'waiting' check (status in ('waiting','active','ended','expired')),
  max_players integer not null default 2 check (max_players between 2 and 8),
  game_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  updated_at timestamptz not null default now()
);

create table if not exists public.aria_room_players (
  room_id uuid not null references public.aria_rooms(id) on delete cascade,
  room_code text not null,
  player_id text not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role text not null default 'guest' check (role in ('host','guest')),
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, player_id)
);

create table if not exists public.aria_room_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.aria_rooms(id) on delete cascade,
  room_code text not null,
  type text not null check (type in ('chat','typing','system','presence')),
  player_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aria_game_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.aria_rooms(id) on delete cascade,
  room_code text not null,
  player_id text not null,
  question_idx integer not null,
  answer_idx integer not null,
  correct boolean not null,
  score_delta integer not null default 0,
  client_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, player_id, question_idx)
);

create table if not exists public.aria_webrtc_signals (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  from_player_id text not null,
  to_player_id text,
  type text not null check (type in ('offer','answer','candidate','renegotiate','bye')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists aria_rooms_code_idx on public.aria_rooms(code);
create index if not exists aria_rooms_status_expires_idx on public.aria_rooms(status, expires_at);
create index if not exists aria_players_room_code_idx on public.aria_room_players(room_code);
create index if not exists aria_events_room_code_created_idx on public.aria_room_events(room_code, created_at desc);
create index if not exists aria_signals_room_code_created_idx on public.aria_webrtc_signals(room_code, created_at desc);

create or replace function public.aria_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists aria_rooms_touch_updated_at on public.aria_rooms;
create trigger aria_rooms_touch_updated_at
before update on public.aria_rooms
for each row execute function public.aria_touch_updated_at();

create or replace function public.aria_expire_rooms()
returns void language sql security definer as $$
  update public.aria_rooms
     set status = 'expired', updated_at = now()
   where status in ('waiting','active')
     and expires_at < now();

  delete from public.aria_webrtc_signals
   where created_at < now() - interval '1 day';

  delete from public.aria_room_events
   where created_at < now() - interval '14 days';
$$;

alter table public.aria_rooms enable row level security;
alter table public.aria_room_players enable row level security;
alter table public.aria_room_events enable row level security;
alter table public.aria_game_answers enable row level security;
alter table public.aria_webrtc_signals enable row level security;

-- Backend uses service role, which bypasses RLS. Deny direct anonymous writes.
drop policy if exists "aria deny anon room writes" on public.aria_rooms;
create policy "aria deny anon room writes" on public.aria_rooms for all to anon using (false) with check (false);

drop policy if exists "aria deny anon player writes" on public.aria_room_players;
create policy "aria deny anon player writes" on public.aria_room_players for all to anon using (false) with check (false);

drop policy if exists "aria deny anon event writes" on public.aria_room_events;
create policy "aria deny anon event writes" on public.aria_room_events for all to anon using (false) with check (false);

drop policy if exists "aria deny anon answer writes" on public.aria_game_answers;
create policy "aria deny anon answer writes" on public.aria_game_answers for all to anon using (false) with check (false);

drop policy if exists "aria deny anon signal writes" on public.aria_webrtc_signals;
create policy "aria deny anon signal writes" on public.aria_webrtc_signals for all to anon using (false) with check (false);
