-- events.suburb references the suburbs table. Keep a valid user-entered
-- suburb, but replace blank or unknown free-text values with the host
-- university's campus suburb before the foreign-key check runs.
create or replace function normalise_event_location()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_university text;
  v_suburb text;
  v_lat double precision;
  v_lng double precision;
begin
  select name, lat, lng into v_suburb, v_lat, v_lng
  from suburbs
  where lower(name) = lower(coalesce(new.suburb, ''))
  limit 1;

  if v_suburb is null then
    select u.short_name into v_university
    from clubs c
    join universities u on u.id = c.university_id
    where c.id = new.club_id;

    v_suburb := case v_university
      when 'Unimelb' then 'Parkville'
      when 'RMIT' then 'Melbourne'
      when 'Monash' then 'Clayton'
      when 'Deakin' then 'Burwood'
      when 'La Trobe' then 'Bundoora'
      when 'Swinburne' then 'Hawthorn'
      else 'Melbourne'
    end;

    select s.name, s.lat, s.lng into v_suburb, v_lat, v_lng
    from suburbs s
    where lower(s.name) = lower(v_suburb)
    limit 1;
  end if;

  new.suburb := v_suburb;
  new.lat := coalesce(new.lat, v_lat);
  new.lng := coalesce(new.lng, v_lng);
  return new;
end $$;

drop trigger if exists events_normalise_location on events;
create trigger events_normalise_location
before insert or update of club_id, suburb, lat, lng on events
for each row execute function normalise_event_location();
