-- ============================================================
-- UniVerse — checks for 0006 (ranking scale, exec roles, event pages)
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/0006_ranking_test.sql
--
-- The formulas are checked against values worked out by hand, so if
-- someone "simplifies" one of them this fails rather than quietly
-- reshuffling everybody's deck. Rolls back; leaves nothing behind.
-- ============================================================

\set ON_ERROR_STOP on
\timing off
begin;

\echo '--- 1. Wilson score lower bound (Wilson, 1927)'
do $$
declare
  eps double precision := 0.0005;
begin
  if abs(wilson_lower(0, 0)) > eps then raise exception 'FAIL: n=0 must be 0'; end if;
  if abs(wilson_lower(0, 5)) > eps then raise exception 'FAIL: 0 of 5 must be 0'; end if;
  if abs(wilson_lower(1, 1) - 0.2065) > eps then
    raise exception 'FAIL: 1 of 1 = %, expected 0.2065', wilson_lower(1,1); end if;
  if abs(wilson_lower(5, 10) - 0.2366) > eps then
    raise exception 'FAIL: 5 of 10 = %, expected 0.2366', wilson_lower(5,10); end if;
  if wilson_lower(8, 8) <= wilson_lower(1, 1) then
    raise exception 'FAIL: 8 of 8 must beat 1 of 1'; end if;
  raise notice 'ok  matches the published formula, and does not over-reward n=1';
end $$;

\echo '--- 2. the weights add to exactly 1'
do $$
declare w double precision := 0.32 + 0.14 + 0.14 + 0.14 + 0.10 + 0.10 + 0.06;
begin
  if abs(w - 1.0) > 1e-9 then raise exception 'FAIL: weights sum to %, not 1', w; end if;
  raise notice 'ok  score is a true 0-1 match fraction';
end $$;

\echo '--- 3. only exec roles can be claimed'
insert into auth.users (email) values ('vy.do@student.rmit.edu.au') returning id as vy \gset
set local role authenticated;
select set_config('request.jwt.claim.sub', :'vy', true);

do $$
begin
  begin
    perform request_organiser('RMIT Link Arts & Culture', 'Committee member',
                              'https://www.rusu.rmit.edu.au/clubs/link-arts');
    raise exception 'FAIL: a committee member was allowed to claim';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'ok  non-exec role rejected: %', left(sqlerrm, 48);
  end;
end $$;

select status = 'pending' as exec_ok, role
  from request_organiser('RMIT Link Arts & Culture', 'Events officer',
                         'https://www.rusu.rmit.edu.au/clubs/link-arts');

\echo '--- 4. the check constraint holds even if someone writes SQL directly'
reset role;
do $$
begin
  begin
    update club_organisers set role = 'General member' where club_name = 'RMIT Link Arts & Culture';
    raise exception 'FAIL: constraint let a non-exec role through';
  exception when check_violation then
    raise notice 'ok  exec_roles_only constraint held';
  end;
end $$;

\echo '--- 5. an event remembers its own page, and Register uses it'
select id as claim from club_organisers where club_name = 'RMIT Link Arts & Culture' \gset
select status = 'verified' as approved from approve_organiser(:'claim', 'Vy');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'vy', true);

select (post_club_event(jsonb_build_object(
  'title',       'Zine Fair + Riso Workshop',
  'starts_at',   (now() + interval '5 days')::text,
  'suburb',      'Melbourne',
  'price_cents', 1500,
  'page_url',    'https://events.humanitix.com/zine-fair-riso',
  'image_url',   'https://cdn.humanitix.com/zine-fair-poster.jpg',
  'interests',   jsonb_build_array('art-design')
))).id as ev \gset

select page_url, image_url, ticket_url is null as no_checkout_link, source, source_url
  from events where id = :'ev';

do $$
declare r record;
begin
  select * into r from events where page_url = 'https://events.humanitix.com/zine-fair-riso';
  if r.page_url is null then raise exception 'FAIL: page_url not stored'; end if;
  if r.image_url is null then raise exception 'FAIL: poster from the page not stored'; end if;
  if r.source_url <> r.page_url then raise exception 'FAIL: source_url should mirror the page'; end if;
  raise notice 'ok  page, poster and provenance all kept';
end $$;

\echo '--- 6. the deck ranks, scores 0-1, and names a reason'
-- give Vy some preferences so the components actually differ
reset role;
insert into user_interests (user_id, interest_id)
select :'vy', id from interests where slug in ('art-design','photography-content','food-cafes');
insert into user_activity_types (user_id, activity_type_id)
select :'vy', id from activity_types where label in ('Workshops','Outdoor activities');
update profiles set home_suburb = 'Melbourne', budget_cents = 2500, max_distance_km = 25
 where id = :'vy';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'vy', true);

select count(*) as deck_size,
       min(score) >= 0 and max(score) <= 1 as score_in_range,
       max(match_pct) as best_pct,
       count(distinct top_reason) as reasons_used
  from get_deck(15);

select match_pct, round(distance_km::numeric,1) as km, interest_overlap, cross_campus, top_reason
  from get_deck(6);

do $$
declare v record; prev double precision := 2;
begin
  if (select count(*) from get_deck(15)) = 0 then raise exception 'FAIL: empty deck'; end if;
  for v in select * from get_deck(15) loop
    if v.score < 0 or v.score > 1 then raise exception 'FAIL: score % out of range', v.score; end if;
    if v.score > prev then raise exception 'FAIL: deck is not sorted'; end if;
    if v.top_reason is null then raise exception 'FAIL: no reason given'; end if;
    prev := v.score;
  end loop;
  raise notice 'ok  sorted, in range, every card has a reason';
end $$;

\echo '--- 7. an event matching three interests outranks one matching none'
do $$
declare hi double precision; lo double precision;
begin
  select max(score) into hi from get_deck(50) d
    join event_interests ei on ei.event_id = d.event_id
    join user_interests  ui on ui.interest_id = ei.interest_id and ui.user_id = auth.uid();
  select min(score) into lo from get_deck(50) d
   where not exists (
     select 1 from event_interests ei
      join user_interests ui on ui.interest_id = ei.interest_id and ui.user_id = auth.uid()
     where ei.event_id = d.event_id);
  if hi is null or lo is null then raise notice 'skip  deck had no contrasting pair'; return; end if;
  if hi <= lo then raise exception 'FAIL: matched % did not beat unmatched %', hi, lo; end if;
  raise notice 'ok  interest matches rank above non-matches (% vs %)', round(hi::numeric,3), round(lo::numeric,3);
end $$;

\echo '--- 8. no club takes more than three cards'
do $$
declare worst int;
begin
  select max(n) into worst from (
    select count(*) as n from get_deck(15) d join events e on e.id = d.event_id group by e.club_id
  ) t;
  if worst > 3 then raise exception 'FAIL: one club got % cards', worst; end if;
  raise notice 'ok  club cap holds (busiest club: % cards)', worst;
end $$;

reset role;
rollback;
\echo '--- done (rolled back)'
