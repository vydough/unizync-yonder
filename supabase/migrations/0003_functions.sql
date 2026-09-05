-- ============================================================
-- UniVerse — functions
-- Run this THIRD.
-- ============================================================

-- ---------- distance, without needing any extensions ----------

create or replace function haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable parallel safe as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------- which university owns an email domain ----------
-- Callable before sign-in so the app can reject gmail.com with a
-- clear message instead of sending a magic link nowhere.

create or replace function university_for_email(p_email text)
returns table (id uuid, name text, short_name text)
language sql stable parallel safe as $$
  select u.id, u.name, u.short_name
  from university_domains d
  join universities u on u.id = d.university_id
  where d.domain = lower(split_part(p_email, '@', 2));
$$;

grant execute on function university_for_email(text) to anon, authenticated;

-- ---------- create the profile row exactly once, at signup ----------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_domain text := lower(split_part(new.email, '@', 2));
  v_uni    uuid;
  v_name   text;
begin
  select university_id into v_uni
  from university_domains where domain = v_domain;

  if v_uni is null then
    raise exception 'We don''t recognise % as a university email yet', v_domain;
  end if;

  -- 'vy.nguyen@student.rmit.edu.au' -> 'Vy Nguyen'
  v_name := initcap(regexp_replace(split_part(new.email, '@', 1), '[._\-0-9]+', ' ', 'g'));

  insert into profiles (id, display_name, university_id, student_number)
  values (
    new.id,
    nullif(trim(v_name), ''),
    v_uni,
    's' || (3000000 + (abs(hashtext(new.email)) % 999999))
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- the deck ----------
--   score = 3.0 x interest overlap (capped at 3)
--         + 1.5 x cross-campus
--         + 1.0 x how soon it is
--         + 1.0 x activity type match
--         + 0.5 x free entry
--
-- Budget and max distance filter first. If that leaves fewer than 8
-- events we drop both rather than hand back a thin deck, and flag it
-- so the app can say so. No more than 3 events from any one club.

create or replace function get_deck(p_limit int default 15)
returns table (
  event_id         uuid,
  score            double precision,
  distance_km      double precision,
  interest_overlap int,
  cross_campus     boolean,
  relaxed          boolean
)
language sql stable security invoker as $$
  with me as (
    select p.id  as uid,
           p.university_id as uni,
           p.budget_cents  as budget,
           p.max_distance_km as maxkm,
           coalesce(s.lat, u.campus_lat) as lat,
           coalesce(s.lng, u.campus_lng) as lng
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
      (select count(*)::int
         from event_interests ei
         join user_interests ui
           on ui.interest_id = ei.interest_id and ui.user_id = me.uid
        where ei.event_id = e.id) as overlap,
      (case when exists (
         select 1 from user_activity_types uat
         where uat.user_id = me.uid and uat.activity_type_id = e.activity_type_id
       ) then 1 else 0 end) as act,
      (extract(epoch from (e.starts_at - now()))::double precision / 86400.0) as days_away,
      me.budget,
      me.maxkm
    from events e
    join clubs c on c.id = e.club_id
    cross join me
    where e.status = 'published'
      and e.starts_at > now()
      and e.starts_at < now() + interval '14 days'
      and not exists (
        select 1 from swipes s where s.user_id = me.uid and s.event_id = e.id
      )
  ),
  strict as (
    select * from base
    where (budget is null or price_cents <= budget)
      and (maxkm  is null or km <= maxkm)
  ),
  pool as (
    select s.*, false as relaxed from strict s
    where (select count(*) from strict) >= 8
    union all
    select b.*, true as relaxed from base b
    where (select count(*) from strict) < 8
  ),
  scored as (
    select
      pool.id,
      pool.club_id,
      (3.0 * least(pool.overlap, 3)
       + 1.5 * (case when pool.cross_campus then 1 else 0 end)
       + 1.0 * greatest(0.0, 1.0 - (pool.days_away / 14.0))
       + 1.0 * pool.act
       + 0.5 * (case when pool.price_cents = 0 then 1 else 0 end)
      )::double precision as score,
      pool.km, pool.overlap, pool.cross_campus, pool.relaxed
    from pool
  ),
  capped as (
    select *, row_number() over (partition by club_id order by score desc, id) as rn
    from scored
  )
  select id, score, km, overlap, cross_campus, relaxed
  from capped
  where rn <= 3
  order by score desc, id
  limit p_limit;
$$;

grant execute on function get_deck(int) to authenticated;

-- ---------- swiping ----------
-- Upsert on the (user_id, event_id) conflict target so a re-swipe
-- updates instead of throwing a duplicate key error.

create or replace function record_swipe(p_event uuid, p_direction swipe_direction)
returns void
language sql security invoker as $$
  insert into swipes (user_id, event_id, direction)
  values (auth.uid(), p_event, p_direction)
  on conflict (user_id, event_id)
  do update set direction = excluded.direction, created_at = now();
$$;

grant execute on function record_swipe(uuid, swipe_direction) to authenticated;

-- ---------- registering ----------
-- A registration implies a like, so Saved always contains it.

create or replace function register_for_event(p_event uuid, p_channel text default 'internal')
returns void
language plpgsql security invoker as $$
begin
  insert into swipes (user_id, event_id, direction)
  values (auth.uid(), p_event, 'like')
  on conflict (user_id, event_id) do update set direction = 'like';

  insert into registrations (user_id, event_id, channel)
  values (auth.uid(), p_event, p_channel)
  on conflict (user_id, event_id)
  do update set channel = excluded.channel, registered_at = now();
end $$;

grant execute on function register_for_event(uuid, text) to authenticated;

-- ---------- who among your friends is going ----------
-- First name and university only. A friend never sees your passes.

create or replace function friends_on_event(p_event uuid)
returns table (
  friend_id     uuid,
  first_name    text,
  university    text,
  brand_colour  text,
  is_registered boolean
)
language sql stable security invoker as $$
  select
    p.id,
    split_part(p.display_name, ' ', 1),
    u.short_name,
    u.brand_colour,
    exists (select 1 from registrations r where r.user_id = p.id and r.event_id = p_event)
  from friendships f
  join profiles p     on p.id = f.friend_id
  join universities u on u.id = p.university_id
  where f.user_id = auth.uid()
    and f.status = 'accepted'
    and (
      exists (select 1 from swipes s
              where s.user_id = p.id and s.event_id = p_event and s.direction = 'like')
      or exists (select 1 from registrations r
                 where r.user_id = p.id and r.event_id = p_event)
    );
$$;

grant execute on function friends_on_event(uuid) to authenticated;

-- ---------- friends, in one call for a whole deck ----------
-- Avoids one round trip per card.

create or replace function friends_on_events(p_events uuid[])
returns table (
  event_id      uuid,
  friend_id     uuid,
  first_name    text,
  university    text,
  brand_colour  text,
  is_registered boolean
)
language sql stable security invoker as $$
  select
    e.event_id,
    p.id,
    split_part(p.display_name, ' ', 1),
    u.short_name,
    u.brand_colour,
    exists (select 1 from registrations r where r.user_id = p.id and r.event_id = e.event_id)
  from unnest(p_events) as e(event_id)
  join friendships f  on f.user_id = auth.uid() and f.status = 'accepted'
  join profiles p     on p.id = f.friend_id
  join universities u on u.id = p.university_id
  where exists (select 1 from swipes s
                where s.user_id = p.id and s.event_id = e.event_id and s.direction = 'like')
     or exists (select 1 from registrations r
                where r.user_id = p.id and r.event_id = e.event_id);
$$;

grant execute on function friends_on_events(uuid[]) to authenticated;

-- ---------- accepting a friend request creates the mirror row ----------

create or replace function accept_friend(p_requester uuid)
returns void
language plpgsql security invoker as $$
begin
  update friendships
     set status = 'accepted'
   where user_id = p_requester and friend_id = auth.uid();

  insert into friendships (user_id, friend_id, status)
  values (auth.uid(), p_requester, 'accepted')
  on conflict (user_id, friend_id) do update set status = 'accepted';
end $$;

grant execute on function accept_friend(uuid) to authenticated;
