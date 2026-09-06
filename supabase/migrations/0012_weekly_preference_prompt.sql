-- UniVerse - weekly preference prompt state
-- Run this after 0011_event_image_storage.sql.

alter table profiles
  add column if not exists preference_prompted_at timestamptz;
