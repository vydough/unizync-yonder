-- UniVerse - Rubric event destinations
-- Run this after 0006_ranking.sql.

-- Rubric event pages are valid direct destinations, even though Rubric
-- does not expose a separate checkout URL.
alter type ticket_provider add value if not exists 'rubric';

-- Older demo rows used provider homepages as placeholders. A homepage is
-- not a valid event destination, so clear only those placeholders.
update events
set ticket_url = null,
    ticket_provider = 'none'
where ticket_url in (
  'https://events.humanitix.com/',
  'https://www.eventbrite.com.au/',
  'https://www.trybooking.com/'
);

-- A submitted event always keeps its exact pasted page as a usable
-- destination when a provider has no separate ticket checkout.
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
    nullif(p->>'image_url',''),
    (p->>'starts_at')::timestamptz,
    nullif(p->>'ends_at','')::timestamptz,
    nullif(p->>'venue_name',''),
    nullif(p->>'suburb',''),
    nullif(p->>'address',''),
    s.lat, s.lng,
    coalesce((p->>'price_cents')::int, 0),
    coalesce(nullif(p->>'ticket_url',''), nullif(p->>'page_url','')),
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
