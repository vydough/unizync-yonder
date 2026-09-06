-- UniVerse - organiser event images
-- Run this after 0010_normalise_event_location.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-images', 'event-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "organiser uploads event image" on storage.objects;
create policy "organiser uploads event image" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "public reads event images" on storage.objects;
create policy "public reads event images" on storage.objects
  for select to public
  using (bucket_id = 'event-images');

drop policy if exists "organiser updates event image" on storage.objects;
create policy "organiser updates event image" on storage.objects
  for update to authenticated
  using (bucket_id = 'event-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'event-images' and (storage.foldername(name))[1] = auth.uid()::text);
