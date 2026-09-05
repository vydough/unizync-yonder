-- ============================================================
-- UniVerse — schema
-- Postgres 16 / Supabase
-- Run this FIRST. Then 0002_rls.sql, then 0003_functions.sql,
-- then supabase/seed.sql.
-- ============================================================

-- ---------- reference data ----------

create table universities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                    -- 'RMIT University'
  short_name    text not null,                    -- 'RMIT'
  brand_colour  text not null,                    -- '#E60028'
  campus_lat    double precision not null,
  campus_lng    double precision not null,
  -- who runs club events here, and where a paid registration is sent
  union_name    text not null,                    -- 'RUSU'
  reg_label     text not null,                    -- 'RUSU · Rubric'
  reg_url       text not null                     -- 'https://campus.hellorubric.com/?s=4202'
);

-- one university can accept several email domains
create table university_domains (
  domain        text primary key,                 -- 'student.rmit.edu.au'
  university_id uuid not null references universities on delete cascade
);

create table suburbs (
  name text primary key,                          -- 'Clayton'
  lat  double precision not null,
  lng  double precision not null
);

create table interests (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,                -- 'art-design'
  label      text not null,                       -- 'Art & design'
  emoji      text,
  sort_order integer not null default 0
);

create table activity_types (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,                -- 'workshops'
  label      text not null,                       -- 'Workshops'
  sort_order integer not null default 0
);

-- ---------- people ----------

create type discovery_mode as enum ('swipe', 'browse');

create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  display_name     text not null,
  avatar_url       text,
  university_id    uuid not null references universities,
  student_number   text,
  -- preferences, all set during the 5-step onboarding
  home_suburb      text references suburbs(name),  -- null = measure from campus
  max_distance_km  integer,                        -- null = any distance
  budget_cents     integer,                        -- null = no limit
  discovery        discovery_mode not null default 'swipe',
  dark_mode        boolean not null default false,
  seen_tutorial    boolean not null default false,
  created_at       timestamptz not null default now()
);

create table user_interests (
  user_id     uuid references profiles on delete cascade,
  interest_id uuid references interests on delete cascade,
  primary key (user_id, interest_id)
);

create table user_activity_types (
  user_id          uuid references profiles on delete cascade,
  activity_type_id uuid references activity_types on delete cascade,
  primary key (user_id, activity_type_id)
);

-- friendships are mutual and explicit; a row per direction, created in
-- pairs when a request is accepted, so "are we friends" is one lookup
create type friend_status as enum ('pending', 'accepted');

create table friendships (
  user_id    uuid not null references profiles on delete cascade,
  friend_id  uuid not null references profiles on delete cascade,
  status     friend_status not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint no_self_friend check (user_id <> friend_id)
);

-- ---------- clubs and events ----------

create table clubs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  initials      text not null,                    -- 'MUCC', used on the generated poster
  university_id uuid not null references universities,
  logo_url      text,
  description   text
);

create type ticket_provider as enum
  ('humanitix','eventbrite','trybooking','external','none');

create type event_status as enum ('published','draft','cancelled');

create table events (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references clubs on delete cascade,
  title            text not null,
  description      text,
  image_url        text,                           -- null = the app prints a poster
  starts_at        timestamptz not null,
  ends_at          timestamptz,
  venue_name       text,
  suburb           text references suburbs(name),
  address          text,
  lat              double precision,
  lng              double precision,
  price_cents      integer not null default 0,
  is_free          boolean generated always as (price_cents = 0) stored,
  ticket_url       text,
  ticket_provider  ticket_provider not null default 'none',
  activity_type_id uuid references activity_types,
  status           event_status not null default 'published',
  submitted_by     uuid references profiles on delete set null,
  created_at       timestamptz not null default now(),
  constraint ends_after_start check (ends_at is null or ends_at > starts_at),
  constraint price_not_negative check (price_cents >= 0)
);

create table event_interests (
  event_id    uuid references events on delete cascade,
  interest_id uuid references interests on delete cascade,
  primary key (event_id, interest_id)
);

-- ---------- what a student does ----------

-- Single source of truth for like AND pass. There is no saved_events table.
create type swipe_direction as enum ('like','pass');

create table swipes (
  user_id    uuid not null references profiles on delete cascade,
  event_id   uuid not null references events on delete cascade,
  direction  swipe_direction not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- a registration is a separate, stronger signal than a like
create table registrations (
  user_id       uuid not null references profiles on delete cascade,
  event_id      uuid not null references events on delete cascade,
  registered_at timestamptz not null default now(),
  -- where we sent them: 'internal' for free events we take the name for,
  -- otherwise the club page or the union platform
  channel       text not null default 'internal',
  primary key (user_id, event_id)
);

-- Saved = likes, with the event joined in.
create view saved_events as
  select s.user_id, s.created_at as saved_at, e.*
  from swipes s
  join events e on e.id = s.event_id
  where s.direction = 'like';

-- ---------- indexes ----------

create index events_starts_at_idx      on events (starts_at) where status = 'published';
create index events_club_idx           on events (club_id);
create index event_interests_int_idx   on event_interests (interest_id);
create index swipes_user_idx           on swipes (user_id);
create index registrations_event_idx   on registrations (event_id);
create index friendships_friend_idx    on friendships (friend_id) where status = 'accepted';
create index clubs_university_idx      on clubs (university_id);
