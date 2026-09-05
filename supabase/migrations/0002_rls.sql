-- ============================================================
-- UniVerse — Row Level Security
-- Run this SECOND.
--
-- Supabase tables are wide open until you enable RLS, and then
-- completely closed until you write policies. The second failure
-- looks like an empty deck with no error, so do this before you
-- wire up any UI: if data doesn't appear, check here first.
-- ============================================================

-- Safe to re-run: clear any policies from a previous run first.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table universities        enable row level security;
alter table university_domains  enable row level security;
alter table suburbs             enable row level security;
alter table interests           enable row level security;
alter table activity_types      enable row level security;
alter table clubs               enable row level security;
alter table events              enable row level security;
alter table event_interests     enable row level security;
alter table profiles            enable row level security;
alter table user_interests      enable row level security;
alter table user_activity_types enable row level security;
alter table friendships         enable row level security;
alter table swipes              enable row level security;
alter table registrations       enable row level security;

-- ---------- table grants ----------
-- Supabase sets most of these by default, but stating them means the
-- schema also works if you ever run it on plain Postgres, and it rules
-- out the "empty deck, no error" class of bug.

grant usage on schema public to anon, authenticated;

grant select on universities, university_domains to anon, authenticated;
grant select on suburbs, interests, activity_types, clubs, events, event_interests, saved_events
  to authenticated;
grant insert, update on events to authenticated;
grant insert on event_interests to authenticated;
grant select, insert, update, delete
  on profiles, user_interests, user_activity_types, friendships, swipes, registrations
  to authenticated;

-- ---------- reference data: readable by any signed-in student ----------
-- Writes happen with the service role key during seeding only.

create policy "read universities"   on universities       for select to authenticated using (true);
create policy "read domains"        on university_domains for select to authenticated using (true);
create policy "read suburbs"        on suburbs            for select to authenticated using (true);
create policy "read interests"      on interests          for select to authenticated using (true);
create policy "read activity types" on activity_types     for select to authenticated using (true);
create policy "read clubs"          on clubs              for select to authenticated using (true);

-- Domains are also needed BEFORE sign-in, to check the email is a
-- university one. Anon can read the domain list and nothing else.
create policy "anon reads domains"      on university_domains for select to anon using (true);
create policy "anon reads universities" on universities       for select to anon using (true);

-- ---------- events: published events are public to students ----------

create policy "read published events" on events
  for select to authenticated
  using (status = 'published');

create policy "read event interests" on event_interests
  for select to authenticated using (true);

-- A club officer posts through the app: they may create an event and
-- edit only the ones they submitted.
create policy "students submit events" on events
  for insert to authenticated
  with check (submitted_by = auth.uid());

create policy "edit own submissions" on events
  for update to authenticated
  using (submitted_by = auth.uid())
  with check (submitted_by = auth.uid());

create policy "tag own submissions" on event_interests
  for insert to authenticated
  with check (exists (
    select 1 from events e
    where e.id = event_interests.event_id and e.submitted_by = auth.uid()
  ));

-- ---------- profiles: read your own, plus your accepted friends ----------

create policy "read own profile" on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = profiles.id and f.status = 'accepted'
    )
  );

create policy "create own profile" on profiles
  for insert to authenticated with check (id = auth.uid());

create policy "update own profile" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- preferences: your own rows only ----------

create policy "own interests" on user_interests
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own activity types" on user_activity_types
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- friendships ----------

create policy "read own friendships" on friendships
  for select to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

create policy "send friend request" on friendships
  for insert to authenticated with check (user_id = auth.uid());

create policy "respond to friend request" on friendships
  for update to authenticated
  using (friend_id = auth.uid() or user_id = auth.uid());

create policy "remove friendship" on friendships
  for delete to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

-- ---------- swipes: yours, plus your accepted friends' likes ----------
-- This is what powers "Priya is interested". A friend never sees your
-- passes — only the events you liked.

create policy "read own swipes" on swipes
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      direction = 'like'
      and exists (
        select 1 from friendships f
        where f.user_id = auth.uid() and f.friend_id = swipes.user_id and f.status = 'accepted'
      )
    )
  );

create policy "write own swipes" on swipes
  for insert to authenticated with check (user_id = auth.uid());

create policy "change own swipes" on swipes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "undo own swipes" on swipes
  for delete to authenticated using (user_id = auth.uid());

-- ---------- registrations: yours, plus your accepted friends' ----------

create policy "read registrations" on registrations
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from friendships f
      where f.user_id = auth.uid() and f.friend_id = registrations.user_id and f.status = 'accepted'
    )
  );

create policy "write own registrations" on registrations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- the view inherits from swipes ----------
-- Postgres 15+ runs views with the invoker's permissions when asked to,
-- which makes saved_events obey the swipes policies above.
alter view saved_events set (security_invoker = on);
