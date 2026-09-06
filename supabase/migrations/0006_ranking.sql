-- ============================================================
-- UniVerse — the ranking scale, exec-only organisers, event pages
-- Run this after 0005. Safe to re-run.
--
-- Three things:
--   1. get_deck() rebuilt as a weighted scale where every component
--      is normalised 0–1 by a named, published formula.
--   2. Only a club's executive can be verified as an organiser.
--   3. Every event remembers its own public page, so "Register"
--      sends a student to the event they tapped — never to a union
--      homepage they then have to search.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXEC POSITIONS ONLY
-- ------------------------------------------------------------
-- A general committee member can't post in a club's name. The exec is
-- who the union actually lists and who the club holds accountable.

update club_organisers set role = 'President'
 where role not in ('President','Vice-President','Secretary','Treasurer','Events officer');

alter table club_organisers drop constraint if exists exec_roles_only;
alter table club_organisers add constraint exec_roles_only
  check (role in ('President','Vice-President','Secretary','Treasurer','Events officer'));

-- request_organiser() rejects anything else before it reaches the check,
-- so a student gets a sentence rather than a constraint violation.
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
  v_role text := coalesce(nullif(trim(p_role),''), '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_club_name),'') = '' then raise exception 'club name required'; end if;
  if v_role not in ('President','Vice-President','Secretary','Treasurer','Events officer') then
    raise exception 'Only a club''s executive can be verified. Pick President, Vice-President, Secretary, Treasurer or Events officer.';
  end if;
  if p_proof_url is null and p_proof_path is null then
    raise exception 'a link to your club''s union page, or a screenshot, is required';
  end if;
  if p_proof_url is not null and p_proof_url !~* '^https://' then
    raise exception 'the proof link must be https';
  end if;

  select university_id into v_uni from profiles where id = auth.uid();
  if v_uni is null then raise exception 'no profile'; end if;

  select id into v_club from clubs
   where university_id = v_uni and lower(name) = lower(trim(p_club_name))
   limit 1;

  insert into club_organisers (user_id, university_id, club_id, club_name, role, proof_url, proof_path)
  values (auth.uid(), v_uni, v_club, trim(p_club_name), v_role, p_proof_url, p_proof_path)
  on conflict (user_id, lower(club_name)) where status <> 'rejected'
  do update set role = excluded.role, proof_url = excluded.proof_url, proof_path = excluded.proof_path
  returning * into v_row;

  return v_row;
end $$;

revoke all on function request_organiser(text,text,text,text) from public;
grant execute on function request_organiser(text,text,text,text) to authenticated;

-- ------------------------------------------------------------
-- 2. THE EVENT'S OWN PAGE
-- ------------------------------------------------------------
-- ticket_url is the checkout. page_url is the event's public page —
-- the exact link the organiser pasted. They are often the same and
-- often not, and treating them as one is how a student ends up on a
-- homepage instead of the event they tapped.

alter table events add column if not exists page_url text;

-- backfill: anything imported or posted already knows its own page
update events set page_url = source_url
 where page_url is null and source_url is not null;

create or replace function post_club_event(p jsonb)
returns events
language plpgsql security definer set search_path = public as $$
declare
  v_org  club_organisers;
  v_club uuid;
  v_ev   events;
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
    lat, lng, price_cents, ticket_url, page_url, ticket_provider, activity_type_id,
    submitted_by, organiser_id, source, source_url
  )
  select
    v_club,
    p->>'title',
    p->>'description',
    -- the poster read off the event's own page
    nullif(p->>'image_url',''),
    (p->>'starts_at')::timestamptz,
    nullif(p->>'ends_at','')::timestamptz,
    nullif(p->>'venue_name',''),
    nullif(p->>'suburb',''),
    nullif(p->>'address',''),
    s.lat, s.lng,
    coalesce((p->>'price_cents')::int, 0),
    nullif(p->>'ticket_url',''),
    nullif(p->>'page_url',''),
    coalesce(nullif(p->>'ticket_provider','')::ticket_provider, 'none'),
    (select id from activity_types where slug = p->>'activity_type' or label = p->>'activity_type' limit 1),
    auth.uid(), v_org.id, 'organiser',
    coalesce(nullif(p->>'page_url',''), nullif(p->>'source_url',''))
  from (select lat, lng from suburbs where name = p->>'suburb') s
  right join (select 1) one on true
  returning * into v_ev;

  insert into event_interests (event_id, interest_id)
  select v_ev.id, i.id from interests i
   where i.slug = any (coalesce(
     array(select jsonb_array_elements_text(p->'interests')), '{}'::text[]))
  on conflict do nothing;

  return v_ev;
end $$;

revoke all on function post_club_event(jsonb) from public;
grant execute on function post_club_event(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 3. THE RANKING SCALE
-- ------------------------------------------------------------
-- Every component is normalised to 0–1 by a published formula, then
-- combined as a weighted sum whose weights add to 1. The score IS the
-- match percentage: nothing is on an arbitrary scale, and changing one
-- weight has a predictable effect on the deck.
--
--   component      weight  formula                        source
--   -------------------------------------------------------------
--   interests       0.32   Szymkiewicz–Simpson overlap    Simpson 1943
--                          blended 70/30 with Jaccard     Jaccard 1901
--   activity type   0.14   set membership                 —
--   when it is on   0.14   gravity decay 1/(1+d)^0.8      Hacker News
--   how far         0.14   Haversine + e^(-d/λ)           Sinnott 1984 /
--                                                         Tobler 1970
--   price fit       0.10   linear ramp against budget     —
--   other students  0.10   Wilson score lower bound       Wilson 1927
--   cross-campus    0.06   set membership                 —
--
-- These must stay identical to the JavaScript in web/index.html. If you
-- change a weight, change it in both, or the deck the app draws and the
-- deck the database returns will disagree.

-- Wilson score lower bound at 95% confidence (Wilson, 1927).
-- The honest way to rank a ratio on a small sample: 1 like out of 1 is
-- not the same evidence as 40 out of 40, and a raw average says it is.
create or replace function wilson_lower(pos bigint, n bigint, z double precision default 1.96)
returns double precision
language sql immutable as $$
  select case when n <= 0 then 0.0 else
    ( (pos::double precision / n) + z*z/(2*n)
      - z * sqrt( ((pos::double precision / n) * (1 - pos::double precision / n) + z*z/(4*n)) / n )
    ) / (1 + z*z/n)
  end;
$$;

comment on function wilson_lower is
  'Wilson (1927) score interval, lower bound. Ranks a success ratio without over-rewarding tiny samples.';

drop function if exists get_deck(int);
create or replace function get_deck(p_limit int default 15)
returns table (
  event_id         uuid,
  score            double precision,   -- 0..1, so score*100 is a % match
  match_pct        int,
  distance_km      double precision,
  interest_overlap int,
  cross_campus     boolean,
  top_reason       text,               -- which component contributed most
  relaxed          boolean
)
language sql stable security invoker as $$
  with me as (
    select p.id  as uid,
           p.university_id as uni,
           p.budget_cents  as budget,
           p.max_distance_km as maxkm,
           coalesce(s.lat, u.campus_lat) as lat,
           coalesce(s.lng, u.campus_lng) as lng,
           (select count(*) from user_interests ui where ui.user_id = p.id) as n_interests,
           (select count(*) from friendships f
             where f.user_id = p.id and f.status = 'accepted')             as n_friends
    from profiles p
    join universities u on u.id = p.university_id
    left join suburbs s on s.name = p.home_suburb
    where p.id = auth.uid()
  ),
  base as (
    select
      e.id,
      e.club_id,
      e.price_cents,
      (c.university_id <> me.uni) as cross_campus,
      haversine_km(me.lat, me.lng, coalesce(e.lat, me.lat), coalesce(e.lng, me.lng)) as km,
      -- |A ∩ B|, |A|, |B| — everything Jaccard and the overlap coefficient need
      (select count(*)::int from event_interests ei
         join user_interests ui on ui.interest_id = ei.interest_id and ui.user_id = me.uid
        where ei.event_id = e.id)                                   as inter,
      me.n_interests::int                                           as n_a,
      (select count(*)::int from event_interests ei where ei.event_id = e.id) as n_b,
      (case when exists (
         select 1 from user_activity_types uat
         where uat.user_id = me.uid and uat.activity_type_id = e.activity_type_id
       ) then 1 else 0 end)                                         as act,
      greatest(0.0, extract(epoch from (e.starts_at - now()))::double precision / 86400.0) as days_away,
      -- friends who like it, with a registration counting double
      least(me.n_friends, (
        select coalesce(sum(case when r.user_id is not null then 2 else 1 end), 0)
          from friendships f
          left join swipes sw on sw.user_id = f.friend_id and sw.event_id = e.id and sw.direction = 'like'
          left join registrations r on r.user_id = f.friend_id and r.event_id = e.id
         where f.user_id = me.uid and f.status = 'accepted'
           and (sw.user_id is not null or r.user_id is not null)
      ))                                                            as friend_pos,
      me.n_friends,
      me.budget,
      me.maxkm
    from events e
    join clubs c on c.id = e.club_id
    cross join me
    where e.status = 'published'
      and e.starts_at > now()
      and e.starts_at < now() + interval '14 days'
      and not exists (select 1 from swipes s where s.user_id = me.uid and s.event_id = e.id)
  ),
  strict as (
    select * from base
    where (budget is null or price_cents <= budget)
      and (maxkm  is null or km <= maxkm)
  ),
  -- A thin deck is a worse failure than an imperfect one, so if the
  -- filters leave fewer than eight we drop them and say so.
  pool as (
    select s.*, false as relaxed from strict s where (select count(*) from strict) >= 8
    union all
    select b.*, true  as relaxed from base   b where (select count(*) from strict) <  8
  ),
  components as (
    select
      pool.id, pool.club_id, pool.km, pool.inter, pool.cross_campus, pool.relaxed,
      -- interests: 0.7 × overlap coefficient + 0.3 × Jaccard
      (case when pool.n_a = 0 or pool.n_b = 0 then 0.0 else
        0.7 * (pool.inter::double precision / least(pool.n_a, pool.n_b))
      + 0.3 * (pool.inter::double precision / (pool.n_a + pool.n_b - pool.inter))
       end)                                                          as c_interest,
      pool.act::double precision                                     as c_activity,
      -- gravity decay: sooner matters more, with a diminishing penalty
      (1.0 / power(1.0 + pool.days_away, 0.8))                       as c_timing,
      -- exponential distance decay, rescaled to how far this student travels
      exp(- pool.km / greatest(1.0, coalesce(pool.maxkm::double precision / 2.0, 8.0)))
                                                                     as c_distance,
      (case when pool.price_cents = 0 then 1.0
            else greatest(0.0, 1.0 - pool.price_cents::double precision
                                     / coalesce(nullif(pool.budget,0), 5000)) end) as c_price,
      wilson_lower(pool.friend_pos, pool.n_friends)                  as c_social,
      (case when pool.cross_campus then 1.0 else 0.0 end)            as c_cross
    from pool
  ),
  scored as (
    select
      id, club_id, km, inter, cross_campus, relaxed,
      ( 0.32*c_interest + 0.14*c_activity + 0.14*c_timing
      + 0.14*c_distance + 0.10*c_price   + 0.10*c_social + 0.06*c_cross ) as score,
      -- the largest weighted contribution, for the one-line "why"
      (select k from (values
         ('interest', 0.32*c_interest), ('activity', 0.14*c_activity),
         ('timing',   0.14*c_timing),   ('distance', 0.14*c_distance),
         ('price',    0.10*c_price),    ('social',   0.10*c_social),
         ('cross',    0.06*c_cross)
       ) as t(k, v) order by v desc limit 1)                          as top_reason
    from components
  ),
  capped as (
    -- no more than three from one club, so a busy club can't take the deck
    select *, row_number() over (partition by club_id order by score desc, id) as rn
    from scored
  )
  select id, score, round(score * 100)::int, km, inter, cross_campus, top_reason, relaxed
  from capped
  where rn <= 3
  order by score desc, id
  limit p_limit;
$$;

grant execute on function get_deck(int) to authenticated;
