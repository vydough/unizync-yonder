-- ============================================================
-- UniVerse — club organisers, event ownership, notifications
-- Run this after 0004. Safe to re-run.
--
-- Three things:
--   1. A student shows us they run a club — and one of us checks it
--      by hand — before they can post that club's events. The unions
--      already publish who runs each club, so the proof is public;
--      we just read it. No partnership needed to launch.
--   2. An organiser owns the events they posted — edit, cancel, remove.
--   3. Notifications, derived from data that already exists. There is
--      no fan-out table of messages: the feed is computed on read, so
--      it can only ever contain the three things we promised.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ORGANISER VERIFICATION
-- ------------------------------------------------------------

do $$ begin
  create type organiser_status as enum ('pending','verified','rejected');
exception when duplicate_object then null; end $$;

create table if not exists club_organisers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles on delete cascade,
  university_id  uuid not null references universities,
  -- the club they claim to run. club_id is filled in when a reviewer
  -- approves and we match the claim to a real club row.
  club_id        uuid references clubs on delete set null,
  club_name      text not null,
  role           text not null,                  -- 'President', 'Events officer', …
  -- the proof a human reads. A link to the union's own club page is
  -- enough on its own; a screenshot goes to a private Storage bucket
  -- and only the path is stored here.
  proof_url      text,
  proof_path     text,
  status         organiser_status not null default 'pending',
  reviewed_by    text,                           -- who on the team approved it
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz not null default now(),
  constraint proof_required check (proof_url is not null or proof_path is not null)
);

-- one live claim per student per club name
create unique index if not exists club_organisers_one_live
  on club_organisers (user_id, lower(club_name))
  where status <> 'rejected';

create index if not exists club_organisers_user_idx on club_organisers (user_id);
create index if not exists club_organisers_club_idx on club_organisers (club_id) where status = 'verified';

-- ------------------------------------------------------------
-- 2. EVENT OWNERSHIP
-- ------------------------------------------------------------

-- Which verified organiser posted it. submitted_by (0001) is the person;
-- this is the standing they posted it under, so revoking a verification
-- also tells us which events to re-check.
alter table events
  add column if not exists organiser_id uuid references club_organisers on delete set null,
  add column if not exists updated_at   timestamptz not null default now();

create index if not exists events_organiser_idx on events (organiser_id);

create or replace function touch_event() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists events_touch on events;
create trigger events_touch before update on events
  for each row execute function touch_event();

-- ------------------------------------------------------------
-- 3. NOTIFICATION READ STATE
-- ------------------------------------------------------------

-- The feed itself is computed (see get_notifications below). All we
-- store is which items a student has already seen, keyed the same way
-- the app keys them: 'rem:<event>', 'fr:<friend>:<event>', 'req:<friend>'.
create table if not exists notification_reads (
  user_id uuid not null references profiles on delete cascade,
  key     text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------

alter table club_organisers    enable row level security;
alter table notification_reads enable row level security;

grant select, insert on club_organisers to authenticated;
grant select, insert, delete on notification_reads to authenticated;
grant delete on events to authenticated;

-- Your own claims, and nobody else's proof.
drop policy if exists "read own organiser claims" on club_organisers;
create policy "read own organiser claims" on club_organisers
  for select to authenticated using (user_id = auth.uid());

-- You may ask. You may not approve yourself: the insert is forced to
-- 'pending', and there is no update policy at all, so nothing a
-- browser can do moves a claim to 'verified'. Only the service role —
-- i.e. a person in the Supabase SQL editor — can approve.
drop policy if exists "claim organiser" on club_organisers;
create policy "claim organiser" on club_organisers
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and reviewed_at is null);

drop policy if exists "own notification reads" on notification_reads;
create policy "own notification reads" on notification_reads
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Events: replace the 0002 policies with organiser-gated ones.
-- Before this migration any signed-in student could post an event.
drop policy if exists "students submit events"          on events;
drop policy if exists "edit own submissions"            on events;
drop policy if exists "tag own submissions"             on event_interests;
drop policy if exists "read published events"           on events;
drop policy if exists "verified organisers post events" on events;
drop policy if exists "organisers edit their events"    on events;
drop policy if exists "organisers remove their events"  on events;

create policy "read published events" on events
  for select to authenticated
  using (status = 'published' or submitted_by = auth.uid());

create policy "verified organisers post events" on events
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from club_organisers o
      where o.id = events.organiser_id
        and o.user_id = auth.uid()
        and o.status = 'verified'
        and (o.club_id is null or o.club_id = events.club_id)
    )
  );

create policy "organisers edit their events" on events
  for update to authenticated
  using (submitted_by = auth.uid() and exists (
    select 1 from club_organisers o
    where o.id = events.organiser_id and o.user_id = auth.uid() and o.status = 'verified'))
  with check (submitted_by = auth.uid());

create policy "organisers remove their events" on events
  for delete to authenticated
  using (submitted_by = auth.uid() and exists (
    select 1 from club_organisers o
    where o.id = events.organiser_id and o.user_id = auth.uid() and o.status = 'verified'));

create policy "tag own submissions" on event_interests
  for all to authenticated
  using (exists (select 1 from events e
                 where e.id = event_interests.event_id and e.submitted_by = auth.uid()))
  with check (exists (select 1 from events e
                      where e.id = event_interests.event_id and e.submitted_by = auth.uid()));

grant delete on event_interests to authenticated;

-- ------------------------------------------------------------
-- 5. FUNCTIONS
-- ------------------------------------------------------------

-- Ask us to confirm you run a club. Always lands as 'pending'.
create or replace function request_organiser(
  p_club_name text,
  p_role      text,
  p_proof_url text default null,
  p_proof_path text default null
) returns club_organisers
language plpgsql security definer set search_path = public as $$
declare
  v_uni uuid;
  v_club uuid;
  v_row club_organisers;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_club_name),'') = '' then raise exception 'club name required'; end if;
  if p_proof_url is null and p_proof_path is null then
    raise exception 'a link to your union''s club page, or a screenshot, is required';
  end if;
  if p_proof_url is not null and p_proof_url !~* '^https://' then
    raise exception 'the proof link must be https';
  end if;

  select university_id into v_uni from profiles where id = auth.uid();
  if v_uni is null then raise exception 'no profile'; end if;

  -- match the claim to a club we already know about, if we can
  select id into v_club from clubs
   where university_id = v_uni and lower(name) = lower(trim(p_club_name))
   limit 1;

  insert into club_organisers (user_id, university_id, club_id, club_name, role, proof_url, proof_path)
  values (auth.uid(), v_uni, v_club, trim(p_club_name), coalesce(nullif(trim(p_role),''),'Committee member'),
          p_proof_url, p_proof_path)
  on conflict (user_id, lower(club_name)) where status <> 'rejected'
  do update set role = excluded.role, proof_url = excluded.proof_url, proof_path = excluded.proof_path
  returning * into v_row;

  return v_row;
end $$;

revoke all on function request_organiser(text,text,text,text) from public;
grant execute on function request_organiser(text,text,text,text) to authenticated;

-- Your verified standing, if you have one. Returns null otherwise.
create or replace function my_organiser()
returns club_organisers
language sql stable security definer set search_path = public as $$
  select * from club_organisers
   where user_id = auth.uid()
   order by (status = 'verified') desc, created_at desc
   limit 1;
$$;

grant execute on function my_organiser() to authenticated;

-- The reviewer's side. Run these in the Supabase SQL editor, or from a
-- script holding the service role key. Never exposed to the browser:
-- the revoke below is what makes self-approval impossible.
--
--   select * from pending_claims;                     -- what's waiting
--   select approve_organiser('<id>', 'Vy');           -- yes
--   select reject_organiser('<id>', 'Vy', 'reason');  -- no
create or replace function approve_organiser(
  p_id uuid, p_reviewer text, p_club_id uuid default null
) returns club_organisers
language plpgsql security definer set search_path = public as $$
declare v_row club_organisers;
begin
  update club_organisers
     set status = 'verified', reviewed_by = p_reviewer, reviewed_at = now(),
         club_id = coalesce(p_club_id, club_id)
   where id = p_id
  returning * into v_row;
  return v_row;
end $$;

revoke all on function approve_organiser(uuid,text,uuid) from public, authenticated, anon;

create or replace function reject_organiser(p_id uuid, p_reviewer text, p_note text default null)
returns club_organisers
language plpgsql security definer set search_path = public as $$
declare v_row club_organisers;
begin
  update club_organisers
     set status = 'rejected', reviewed_by = p_reviewer, reviewed_at = now(), review_note = p_note
   where id = p_id
  returning * into v_row;
  return v_row;
end $$;

revoke all on function reject_organiser(uuid,text,text) from public, authenticated, anon;

-- The review queue, oldest first. Service role only — it deliberately
-- joins in the claimant's name and email, which no student may read.
create or replace view pending_claims as
  select o.id, o.created_at, p.display_name, au.email, u.short_name as university,
         o.club_name, o.role, o.proof_url, o.proof_path,
         (select count(*) from clubs c
           where c.university_id = o.university_id
             and lower(c.name) = lower(o.club_name)) as club_already_known
    from club_organisers o
    join profiles p     on p.id = o.user_id
    join auth.users au  on au.id = o.user_id
    join universities u on u.id = o.university_id
   where o.status = 'pending'
   order by o.created_at;

revoke all on pending_claims from public, authenticated, anon;

-- Post an event as a verified organiser. Creates the club row on the
-- first event if the union's club isn't in our catalogue yet.
create or replace function post_club_event(p jsonb)
returns events
language plpgsql security definer set search_path = public as $$
declare
  v_org  club_organisers;
  v_club uuid;
  v_ev   events;
  v_slug text;
begin
  select * into v_org from club_organisers
   where user_id = auth.uid() and status = 'verified'
   order by created_at desc limit 1;
  if v_org is null then raise exception 'you are not a verified organiser'; end if;

  v_club := v_org.club_id;
  if v_club is null then
    insert into clubs (name, initials, university_id)
    values (v_org.club_name,
            upper(left(regexp_replace(v_org.club_name, '[^a-zA-Z ]', '', 'g'), 1)) ||
            coalesce(substring(regexp_replace(v_org.club_name, '[^A-Z]', '', 'g') from 2 for 3), ''),
            v_org.university_id)
    returning id into v_club;
    update club_organisers set club_id = v_club where id = v_org.id;
  end if;

  insert into events (
    club_id, title, description, image_url, starts_at, ends_at, venue_name, suburb, address,
    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id,
    submitted_by, organiser_id, source, source_url
  )
  select
    v_club,
    p->>'title',
    p->>'description',
    nullif(p->>'image_url',''),
    (p->>'starts_at')::timestamptz,
    nullif(p->>'ends_at','')::timestamptz,
    nullif(p->>'venue_name',''),
    nullif(p->>'suburb',''),
    nullif(p->>'address',''),
    s.lat, s.lng,
    coalesce((p->>'price_cents')::int, 0),
    nullif(p->>'ticket_url',''),
    coalesce(nullif(p->>'ticket_provider','')::ticket_provider, 'none'),
    (select id from activity_types where slug = p->>'activity_type' or label = p->>'activity_type' limit 1),
    auth.uid(), v_org.id, 'organiser', nullif(p->>'source_url','')
  from (select lat, lng from suburbs where name = p->>'suburb') s
  right join (select 1) one on true
  returning * into v_ev;

  -- tags
  insert into event_interests (event_id, interest_id)
  select v_ev.id, i.id from interests i
   where i.slug = any (coalesce(
     array(select jsonb_array_elements_text(p->'interests')), '{}'::text[]))
  on conflict do nothing;

  return v_ev;
end $$;

revoke all on function post_club_event(jsonb) from public;
grant execute on function post_club_event(jsonb) to authenticated;

-- Remove one of your own. Students who already registered keep their
-- record, so an event with registrations is cancelled rather than
-- deleted, and the app shows them "cancelled by the club".
create or replace function remove_club_event(p_event_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not exists (
    select 1 from events e join club_organisers o on o.id = e.organiser_id
     where e.id = p_event_id and e.submitted_by = auth.uid() and o.status = 'verified'
  ) then raise exception 'not your event'; end if;

  select count(*) into v_count from registrations where event_id = p_event_id;
  if v_count > 0 then
    update events set status = 'cancelled' where id = p_event_id;
    return 'cancelled';
  end if;
  delete from events where id = p_event_id;
  return 'deleted';
end $$;

revoke all on function remove_club_event(uuid) from public;
grant execute on function remove_club_event(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. NOTIFICATIONS
-- ------------------------------------------------------------

-- Exactly three kinds, all derived — nothing else can appear here:
--   reminder : something you saved or registered for starts within 24h
--   friend   : an accepted friend registered for an upcoming event
--   request  : someone asked to add you
create or replace function get_notifications(p_limit int default 25)
returns table (
  key text, kind text, event_id uuid, friend_id uuid,
  title text, body text, meta text, sort_at timestamptz, unread boolean
)
language sql stable security definer set search_path = public as $$
with me as (select auth.uid() as uid),
reminders as (
  select 'rem:' || e.id                                as key,
         'reminder'                                    as kind,
         e.id                                          as event_id,
         null::uuid                                    as friend_id,
         case when r.user_id is not null
              then 'You''re registered — starts soon'
              else 'Starts soon' end                   as title,
         e.title || ' · ' || coalesce(e.venue_name,'') ||
           case when e.suburb is null then '' else ', ' || e.suburb end as body,
         to_char(e.starts_at at time zone 'Australia/Melbourne', 'Dy HH12:MIam') as meta,
         e.starts_at                                   as sort_at
    from swipes s
    join events e on e.id = s.event_id
    left join registrations r on r.event_id = e.id and r.user_id = s.user_id
   where s.user_id = (select uid from me)
     and s.direction = 'like'
     and e.status = 'published'
     and e.starts_at between now() and now() + interval '24 hours'
),
friend_regs as (
  select 'fr:' || f.friend_id || ':' || e.id           as key,
         'friend'                                      as kind,
         e.id                                          as event_id,
         f.friend_id                                   as friend_id,
         split_part(p.display_name, ' ', 1) || ' registered for ' ||
           case when mine.user_id is not null then 'an event you saved' else 'an event' end as title,
         e.title || ' · ' ||
           to_char(e.starts_at at time zone 'Australia/Melbourne', 'Dy HH12:MIam') as body,
         u.short_name                                  as meta,
         -- things you also saved float to the top
         e.starts_at - case when mine.user_id is not null then interval '365 days'
                            else interval '0' end      as sort_at
    from friendships f
    join registrations r  on r.user_id = f.friend_id
    join events e         on e.id = r.event_id
    join profiles p       on p.id = f.friend_id
    join universities u   on u.id = p.university_id
    left join swipes mine on mine.event_id = e.id
                         and mine.user_id = (select uid from me)
                         and mine.direction = 'like'
   where f.user_id = (select uid from me)
     and f.status = 'accepted'
     and e.status = 'published'
     and e.starts_at > now()
),
requests as (
  select 'req:' || f.user_id                           as key,
         'request'                                     as kind,
         null::uuid                                    as event_id,
         f.user_id                                     as friend_id,
         split_part(p.display_name, ' ', 1) || ' wants to add you' as title,
         u.short_name || ' · they''ll see your first name and university' as body,
         ''                                            as meta,
         '-infinity'::timestamptz                      as sort_at
    from friendships f
    join profiles p     on p.id = f.user_id
    join universities u on u.id = p.university_id
   where f.friend_id = (select uid from me)
     and f.status = 'pending'
),
all_notifs as (
  select * from reminders
  union all select * from friend_regs
  union all select * from requests
)
select n.key, n.kind, n.event_id, n.friend_id, n.title, n.body, n.meta, n.sort_at,
       (nr.key is null) as unread
  from all_notifs n
  left join notification_reads nr
         on nr.user_id = (select uid from me) and nr.key = n.key
 order by n.sort_at
 limit greatest(1, least(p_limit, 100));
$$;

grant execute on function get_notifications(int) to authenticated;

create or replace function unread_notification_count()
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from get_notifications(100) where unread;
$$;

grant execute on function unread_notification_count() to authenticated;

create or replace function mark_notifications_read(p_keys text[] default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into notification_reads (user_id, key)
  select auth.uid(), k
    from unnest(coalesce(p_keys, array(select key from get_notifications(100)))) as k
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function mark_notifications_read(text[]) to authenticated;

-- ------------------------------------------------------------
-- 7. PROOF STORAGE
-- ------------------------------------------------------------
-- A screenshot of a committee confirmation is somebody's evidence,
-- not public content, so the bucket is private and a student can
-- only ever see their own folder. Skipped outside Supabase.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'no storage schema — skipping the proof bucket (fine outside Supabase)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('organiser-proof', 'organiser-proof', false, 5242880,
          array['image/png','image/jpeg','image/webp','application/pdf'])
  on conflict (id) do nothing;

  execute $p$drop policy if exists "organiser uploads own proof" on storage.objects$p$;
  execute $p$create policy "organiser uploads own proof" on storage.objects
            for insert to authenticated
            with check (bucket_id = 'organiser-proof'
                        and (storage.foldername(name))[1] = auth.uid()::text)$p$;

  execute $p$drop policy if exists "organiser reads own proof" on storage.objects$p$;
  execute $p$create policy "organiser reads own proof" on storage.objects
            for select to authenticated
            using (bucket_id = 'organiser-proof'
                   and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;

-- ------------------------------------------------------------
-- 8. REALTIME
-- ------------------------------------------------------------
-- So a new event, a friend's registration and a friend request all
-- push straight into an open app. Adding a table twice is an error,
-- so each one is guarded.
do $$
declare t text;
begin
  foreach t in array array['events','registrations','friendships','club_organisers'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found — skipping (fine outside Supabase)';
end $$;
