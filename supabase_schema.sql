-- ── Makan Vote — Supabase Schema ─────────────────────────────────────────────
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run

-- Enable UUID generation
create extension if not exists "pgcrypto";


-- ── sessions ─────────────────────────────────────────────────────────────────
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  creator_id   uuid not null references auth.users(id) on delete cascade,
  locked       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ── members ──────────────────────────────────────────────────────────────────
create table members (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at    timestamptz not null default now(),
  unique (session_id, user_id)
);

-- ── options ──────────────────────────────────────────────────────────────────
create table options (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  meal         text not null,   -- 'Breakfast' | 'Lunch'
  area         text not null,   -- e.g. 'Georgetown'
  name         text not null,
  created_at   timestamptz not null default now()
);

-- ── votes ─────────────────────────────────────────────────────────────────────
create table votes (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  option_id    uuid not null references options(id) on delete cascade,
  amount       integer not null check (amount > 0 and amount <= 100),
  created_at   timestamptz not null default now()
);

-- Prevent duplicate votes per user per option
create unique index votes_user_option_unique on votes (session_id, user_id, option_id);


-- ── Row Level Security ────────────────────────────────────────────────────────
alter table sessions enable row level security;
alter table members  enable row level security;
alter table options  enable row level security;
alter table votes    enable row level security;

-- Sessions: anyone authenticated can read; only creator can update (lock)
create policy "sessions: authenticated read"
  on sessions for select to authenticated using (true);

create policy "sessions: authenticated insert"
  on sessions for insert to authenticated with check (auth.uid() = creator_id);

create policy "sessions: creator can lock"
  on sessions for update to authenticated
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

create policy "sessions: creator can delete"
  on sessions for delete to authenticated
  using (auth.uid() = creator_id);

-- Members: session members can read; authenticated users can join (insert themselves)
create policy "members: authenticated read"
  on members for select to authenticated using (true);

create policy "members: self insert"
  on members for insert to authenticated with check (auth.uid() = user_id);

-- Creator can remove members (delete any row in their session)
create policy "members: creator delete"
  on members for delete to authenticated
  using (
    auth.uid() = user_id  -- can always remove yourself
    or
    auth.uid() = (select creator_id from sessions where id = session_id)
  );

-- Options: session members can read and insert; anyone in session can delete
create policy "options: authenticated read"
  on options for select to authenticated using (true);

create policy "options: authenticated insert"
  on options for insert to authenticated
  with check (
    exists (select 1 from members where session_id = options.session_id and user_id = auth.uid())
  );

create policy "options: member delete"
  on options for delete to authenticated
  using (
    exists (select 1 from members where session_id = options.session_id and user_id = auth.uid())
  );

-- Votes: authenticated users can read all votes in sessions they belong to
create policy "votes: member read"
  on votes for select to authenticated
  using (
    exists (select 1 from members where session_id = votes.session_id and user_id = auth.uid())
  );

create policy "votes: self insert"
  on votes for insert to authenticated
  with check (auth.uid() = user_id);

create policy "votes: self delete"
  on votes for delete to authenticated
  using (
    auth.uid() = user_id
    or
    auth.uid() = (select creator_id from sessions where id = session_id)
  );


-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Enable realtime for live updates (run in Supabase Dashboard → Database → Replication
-- or just run these statements):
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table members;
alter publication supabase_realtime add table options;
alter publication supabase_realtime add table votes;
