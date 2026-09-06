-- ============================================================
-- UniVerse — where an event came from
-- Run this after 0003. Safe to re-run.
--
-- Every event in the catalogue was put there by somebody, and the
-- app says so on the card. These two columns are what it reads.
--   source     — 'organiser' when a verified club officer posted it,
--                'seed' for the demo catalogue. Anything else you
--                add later (a union feed, a partnership) names itself.
--   source_url — the event's own public page, for attribution and so
--                a student can always get back to the original.
--
-- post_club_event() in 0005 writes both.
-- ============================================================

alter table events
  add column if not exists source     text,
  add column if not exists source_url text;

create index if not exists events_source_idx on events (source) where source is not null;
