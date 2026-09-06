-- ============================================================
-- UniVerse — checks for 0005 (organisers + notifications)
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/0005_organisers_test.sql
--
-- Runs entirely as `authenticated` with a real auth.uid(), so it
-- exercises the RLS policies rather than going around them. Rolls
-- back at the end: it leaves no rows behind.
-- ============================================================

\set ON_ERROR_STOP on
\timing off
begin;

-- ---------- two students ----------
-- Signing up is an insert into auth.users; the handle_new_user trigger
-- from 0003 reads the domain and creates the profile.
insert into auth.users (email) values ('alex.tran@student.monash.edu')
returning id as alex \gset
insert into auth.users (email) values ('priya.raman@student.monash.edu')
returning id as priya \gset

-- Priya is Alex's accepted friend, and has registered for something.
insert into friendships (user_id, friend_id, status) values
  (:'alex',  :'priya', 'accepted'),
  (:'priya', :'alex',  'accepted');

insert into registrations (user_id, event_id, channel)
select :'priya', id, 'internal' from events
 where starts_at > now() order by starts_at limit 1;

-- Alex likes that same event, plus one starting within 24 hours.
insert into swipes (user_id, event_id, direction)
select :'alex', id, 'like' from events where starts_at > now() order by starts_at limit 1;

insert into events (club_id, title, starts_at, ends_at, venue_name, suburb, price_cents)
select id, 'Tomorrow Night Test Event', now() + interval '6 hours',
       now() + interval '8 hours', 'Union Hall', 'Clayton', 0
  from clubs limit 1
returning id as soon_ev \gset

insert into swipes (user_id, event_id, direction) values (:'alex', :'soon_ev', 'like');
-- and Alex is registered for that one, so the reminder wording changes
insert into registrations (user_id, event_id) values (:'alex', :'soon_ev');

-- a third student has asked to add Alex, so the request kind shows too
insert into auth.users (email) values ('sam.okafor@student.rmit.edu.au')
returning id as sam \gset
insert into friendships (user_id, friend_id, status) values (:'sam', :'alex', 'pending');

-- ---------- become Alex ----------
set local role authenticated;
select set_config('request.jwt.claim.sub', :'alex', true);

\echo '--- 1. a student cannot post an event before verification'
do $$
begin
  begin
    insert into events (club_id, title, starts_at, submitted_by)
    select id, 'Should Not Exist', now() + interval '3 days', auth.uid() from clubs limit 1;
    raise exception 'FAIL: unverified student inserted an event';
  exception when insufficient_privilege then
    raise notice 'ok  unverified insert blocked by RLS';
  end;
end $$;

\echo '--- 2. request organiser verification'
select status = 'pending' as pending_ok, club_name
  from request_organiser('Monash Film Society', 'Events officer',
                         'https://monashclubs.org/clubs/film-society');

\echo '--- 3. a student cannot verify themselves'
do $$
begin
  begin
    update club_organisers set status = 'verified' where user_id = auth.uid();
    if found then raise exception 'FAIL: self-verification succeeded'; end if;
    raise notice 'ok  self-verify changed nothing (no update policy)';
  exception when insufficient_privilege then
    raise notice 'ok  self-verify blocked by RLS';
  end;
end $$;

\echo '--- 4. a reviewer approves (service role only)'
reset role;
select id as claim from club_organisers where club_name = 'Monash Film Society' \gset
select status = 'verified' as verified_ok from approve_organiser(:'claim', 'UniVerse team');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'alex', true);

\echo '--- 5. post an event through post_club_event'
select (post_club_event(jsonb_build_object(
  'title',           'Rooftop Screening: In the Mood for Love',
  'description',     'Open-air film night on the Union rooftop.',
  'starts_at',       (now() + interval '9 days')::text,
  'ends_at',         (now() + interval '9 days 3 hours')::text,
  'venue_name',      'Campus Centre Rooftop',
  'suburb',          'Clayton',
  'price_cents',     800,
  'ticket_url',      'https://events.humanitix.com/rooftop-screening',
  'ticket_provider', 'humanitix',
  'activity_type',   'Concerts & performances',
  'source_url',      'https://events.humanitix.com/rooftop-screening',
  'interests',       jsonb_build_array('art-design','music-performance')
))).id as posted \gset

select e.title, e.price_cents, e.suburb, e.lat is not null as located,
       e.ticket_provider, c.name as club,
       (select count(*) from event_interests where event_id = e.id) as tags
  from events e join clubs c on c.id = e.club_id where e.id = :'posted';

\echo '--- 6. edit it (and the updated_at trigger fires)'
-- now() is frozen inside a transaction, so age the row first to prove
-- the trigger actually rewrote updated_at rather than it just matching.
reset role;
update events set created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour'
 where id = :'posted';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'alex', true);

update events set title = 'Rooftop Screening: Chungking Express' where id = :'posted';
select title, updated_at > created_at as touched from events where id = :'posted';

\echo '--- 7. someone else''s event is untouchable'
do $$
declare other uuid;
begin
  select id into other from events where submitted_by is distinct from auth.uid() limit 1;
  update events set title = 'Hijacked' where id = other;
  if found then raise exception 'FAIL: edited an event we do not own'; end if;
  raise notice 'ok  other clubs'' events not editable';
end $$;

\echo '--- 8. notifications: exactly the three kinds, nothing else'
select kind, count(*) from get_notifications(100) group by kind order by kind;
-- the request must come first, and a registered reminder says so
select kind, title from get_notifications(100) limit 3;
do $$
declare v record;
begin
  select * into v from get_notifications(100) where kind = 'request' limit 1;
  if v is null then raise exception 'FAIL: friend request missing from the feed'; end if;
  if v.title not like 'Sam wants to add you%' then raise exception 'FAIL: %', v.title; end if;
  raise notice 'ok  friend request appears, first name only';

  if not exists (select 1 from get_notifications(100)
                  where kind = 'reminder' and title like 'You%re registered%') then
    raise exception 'FAIL: registered reminder not worded differently';
  end if;
  raise notice 'ok  registered reminder worded differently';

  if exists (select 1 from get_notifications(100)
              where kind not in ('reminder','friend','request')) then
    raise exception 'FAIL: an unexpected notification kind appeared';
  end if;
  raise notice 'ok  only the three promised kinds';
end $$;
select unread_notification_count() as unread_before;
select mark_notifications_read() as marked;
select unread_notification_count() as unread_after;

\echo '--- 9. remove: no registrations means a real delete'
select remove_club_event(:'posted') as outcome;
select count(*) as still_there from events where id = :'posted';

\echo '--- 10. remove: with registrations it is cancelled, not deleted'
select (post_club_event(jsonb_build_object(
  'title', 'Sold Out Night', 'starts_at', (now() + interval '10 days')::text,
  'suburb', 'Clayton', 'price_cents', 0))).id as posted2 \gset

reset role;
insert into registrations (user_id, event_id) values (:'priya', :'posted2');
set local role authenticated;
select set_config('request.jwt.claim.sub', :'alex', true);

select remove_club_event(:'posted2') as outcome;
select status as status_after from events where id = :'posted2';

\echo '--- 11. a cancelled event is out of everyone else''s deck'
select set_config('request.jwt.claim.sub', :'priya', true);
select count(*) as visible_to_priya from events where id = :'posted2';

reset role;
rollback;
\echo '--- done (rolled back)'
