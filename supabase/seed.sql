-- ============================================================
-- UniVerse - seed data
-- Run this LAST, after the three migrations.
-- Generated from the prototype's own catalogue, so the demo and the
-- database show exactly the same events.
--
-- Dates are RELATIVE to the day you run it, so the deck is always
-- full. Re-run it any time to reset (it clears the tables first).
-- ============================================================

-- helper: build a Melbourne-local timestamp N days from today
create or replace function seed_melb(day_offset int, t time)
returns timestamptz language sql stable as $$
  select timezone('Australia/Melbourne',
    ((timezone('Australia/Melbourne', now()))::date + day_offset)::timestamp + t);
$$;

truncate event_interests, events, clubs cascade;
delete from university_domains;
delete from universities;
delete from suburbs;
delete from interests;
delete from activity_types;


-- ---------- universities ----------

insert into universities (name, short_name, brand_colour, campus_lat, campus_lng, union_name, reg_label, reg_url) values
  ('University of Melbourne', 'Unimelb', '#094183', -37.7963, 144.9614, 'UMSU', 'UMSU events', 'https://umsu.unimelb.edu.au/events/'),
  ('RMIT University', 'RMIT', '#E60028', -37.808, 144.9633, 'RUSU', 'RUSU · Rubric', 'https://campus.hellorubric.com/?s=4202'),
  ('Monash University', 'Monash', '#006DAE', -37.9114, 145.134, 'MSA', 'MSA · Eventbrite', 'https://www.eventbrite.com.au/o/monash-student-association-msa-13953137008'),
  ('Deakin University', 'Deakin', '#C79100', -37.847, 145.115, 'DUSA', 'DUSA · Rubric', 'https://campus.hellorubric.com/?s=3659'),
  ('La Trobe University', 'La Trobe', '#8C1D40', -37.719, 145.049, 'LTSU', 'LTSU clubs', 'https://www.latrobesu.org.au/clubs'),
  ('Swinburne University', 'Swinburne', '#E05A00', -37.8221, 145.0389, 'Student Life', 'Swinburne Student Life', 'https://studentlife.swinburne.edu.au/Events');

-- Who is allowed to sign up. Checked against each university's own IT
-- pages, September 2026. Marked 'student' below is the domain a current
-- student actually gets; the others are staff or identity realms we
-- also accept so a tutor or a club officer isn't locked out.
--
--   * Monash is .edu, NOT .edu.au. Do not "correct" it.
--   * Deakin students and staff share deakin.edu.au, so the domain
--     alone can never tell you which is which.
--   * La Trobe publishes students.ltu.edu.au as the sign-in identity
--     and states nowhere public what the mailbox domain is, so all
--     four forms are accepted until LTSU confirms which is real.
--   * Alumni domains (alumni.unimelb.edu.au, alumni.swinburne.edu) are
--     forwarders belonging to people who have left. Left out on purpose.
insert into university_domains (domain, university_id) values
  ('student.unimelb.edu.au',  (select id from universities where short_name = 'Unimelb')),   -- student
  ('unimelb.edu.au',          (select id from universities where short_name = 'Unimelb')),   -- staff
  ('student.rmit.edu.au',     (select id from universities where short_name = 'RMIT')),      -- student, incl. TAFE + pathways
  ('rmit.edu.au',             (select id from universities where short_name = 'RMIT')),      -- staff
  ('student.monash.edu',      (select id from universities where short_name = 'Monash')),    -- student
  ('monash.edu',              (select id from universities where short_name = 'Monash')),    -- staff
  ('monashcollege.edu.au',    (select id from universities where short_name = 'Monash')),    -- pathway college
  ('deakin.edu.au',           (select id from universities where short_name = 'Deakin')),    -- student AND staff
  ('deakincollege.edu.au',    (select id from universities where short_name = 'Deakin')),    -- pathway college
  ('students.ltu.edu.au',     (select id from universities where short_name = 'La Trobe')),  -- sign-in identity, incl. LTCA
  ('students.latrobe.edu.au', (select id from universities where short_name = 'La Trobe')),  -- unconfirmed, accepted anyway
  ('ltu.edu.au',              (select id from universities where short_name = 'La Trobe')),  -- staff identity realm
  ('latrobe.edu.au',          (select id from universities where short_name = 'La Trobe')),  -- staff
  ('student.swin.edu.au',     (select id from universities where short_name = 'Swinburne')), -- student, incl. TAFE
  ('swin.edu.au',             (select id from universities where short_name = 'Swinburne')), -- staff (legacy)
  ('swinburne.edu.au',        (select id from universities where short_name = 'Swinburne')); -- staff (current)


-- ---------- suburbs (for the distance filter) ----------

insert into suburbs (name, lat, lng) values
  ('Carlton', -37.8, 144.967),
  ('Carlton North', -37.784, 144.972),
  ('Parkville', -37.785, 144.952),
  ('Melbourne', -37.814, 144.963),
  ('Cbd', -37.814, 144.963),
  ('West Melbourne', -37.806, 144.94),
  ('North Melbourne', -37.799, 144.942),
  ('Fitzroy', -37.798, 144.978),
  ('Collingwood', -37.803, 144.988),
  ('Docklands', -37.817, 144.946),
  ('Southbank', -37.823, 144.964),
  ('Port Melbourne', -37.84, 144.93),
  ('St Kilda', -37.868, 144.981),
  ('Richmond', -37.819, 144.998),
  ('Brunswick', -37.767, 144.96),
  ('Preston', -37.741, 145.001),
  ('Fairfield', -37.778, 145.017),
  ('Clayton', -37.917, 145.122),
  ('Burwood', -37.851, 145.114),
  ('Bundoora', -37.7, 145.067),
  ('Hawthorn', -37.822, 145.035),
  ('Footscray', -37.8, 144.9),
  ('Abbotsford', -37.803, 145);


-- ---------- interests (seed these exactly, in this order) ----------

insert into interests (slug, label, emoji, sort_order) values
  ('technology-innovation', 'Technology & innovation', '💻', 1),
  ('business-entrepreneurship', 'Business & entrepreneurship', '📈', 2),
  ('career-networking', 'Career & networking', '🤝', 3),
  ('art-design', 'Art & design', '🎨', 4),
  ('photography-content', 'Photography & content', '📷', 5),
  ('music-performance', 'Music & performance', '🎸', 6),
  ('sport-fitness', 'Sport & fitness', '⚽', 7),
  ('gaming', 'Gaming', '🎮', 8),
  ('food-cafes', 'Food & cafés', '☕', 9),
  ('culture-languages', 'Culture & languages', '🌏', 10),
  ('health-wellbeing', 'Health & wellbeing', '🧘', 11),
  ('sustainability', 'Sustainability', '🌱', 12),
  ('volunteering', 'Volunteering', '🤟', 13),
  ('melbourne-exploration', 'Melbourne exploration', '🗺', 14),
  ('study-academic', 'Study & academic', '📚', 15);


-- ---------- activity types ----------

insert into activity_types (slug, label, sort_order) values
  ('workshops', 'Workshops', 1),
  ('concerts-and-performances', 'Concerts & performances', 2),
  ('sports-events', 'Sports events', 3),
  ('hackathons', 'Hackathons', 4),
  ('career-fairs', 'Career fairs', 5),
  ('social-mixers', 'Social mixers', 6),
  ('seminars-and-talks', 'Seminars & talks', 7),
  ('competitions', 'Competitions', 8),
  ('club-meetings', 'Club meetings', 9),
  ('outdoor-activities', 'Outdoor activities', 10);


-- ---------- clubs ----------

insert into clubs (name, initials, university_id) values
  ('Melbourne University Computing Club', 'MUCC', (select id from universities where short_name = 'Unimelb')),
  ('Melbourne Uni Film Society', 'MUFS', (select id from universities where short_name = 'Unimelb')),
  ('RMIT Link Arts & Culture', 'LINK', (select id from universities where short_name = 'RMIT')),
  ('RMIT Business Society', 'RBS', (select id from universities where short_name = 'RMIT')),
  ('Monash Association of Coding', 'MAC', (select id from universities where short_name = 'Monash')),
  ('Monash Sustainability Collective', 'MSC', (select id from universities where short_name = 'Monash')),
  ('Deakin Photography Club', 'DPC', (select id from universities where short_name = 'Deakin')),
  ('Deakin Entrepreneurs Society', 'DES', (select id from universities where short_name = 'Deakin')),
  ('La Trobe Wellbeing Collective', 'LTWC', (select id from universities where short_name = 'La Trobe')),
  ('La Trobe Food & Culture Club', 'FCC', (select id from universities where short_name = 'La Trobe')),
  ('Swinburne Game Development Club', 'SGDC', (select id from universities where short_name = 'Swinburne')),
  ('Swinburne Design Collective', 'SDC', (select id from universities where short_name = 'Swinburne'));


-- ---------- events ----------

insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Melbourne University Computing Club'),
  'Hack the Semester: 6-Hour Build Night',
  'Turn up with an idea or borrow one of ours. Six hours, free pizza at 8, demos at midnight. Every skill level — half the room has never shipped anything before.',
  seed_melb(2, '18:00'),
  seed_melb(2, '18:00') + interval '360 minutes',
  'Melbourne Connect', 'Carlton', '700 Swanston St, Carlton',
  -37.8, 144.967, 0, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Hackathons')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Melbourne University Computing Club'),
  'Intro to Rust, With Pizza',
  'A two-hour, laptop-open introduction to Rust for people who already write a bit of Python or JS. Bring a laptop. We bring the pizza.',
  seed_melb(6, '17:30'),
  seed_melb(6, '17:30') + interval '120 minutes',
  'Doug McDonell Building', 'Parkville', 'Doug McDonell Bldg, Parkville',
  -37.785, 144.952, 0, null, 'none',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Melbourne University Computing Club'),
  'Grad Season: Resume Teardown with Atlassian',
  'Two Atlassian engineers read real student resumes on the projector, anonymously, and say what they would actually do with them. Submit yours when you register.',
  seed_melb(9, '18:00'),
  seed_melb(9, '18:00') + interval '120 minutes',
  'Kwong Lee Dow Building', 'Parkville', '234 Queensberry St, Carlton',
  -37.785, 144.952, 0, 'https://www.eventbrite.com.au/', 'eventbrite',
  (select id from activity_types where label = 'Career fairs')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Melbourne Uni Film Society'),
  'Rooftop Film Night: Wong Kar-wai Double',
  'Chungking Express then In the Mood for Love, projected on the rooftop as it gets dark. Beanbags, blankets and a hot chip cart. Dress for Melbourne, not for the forecast.',
  seed_melb(3, '19:30'),
  seed_melb(3, '19:30') + interval '210 minutes',
  'Union House Rooftop', 'Parkville', 'Union House, Parkville',
  -37.785, 144.952, 1200, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Concerts & performances')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Melbourne Uni Film Society'),
  '35mm Sunday: Shorts by Melbourne Students',
  'Nine short films by students from five universities, screened on real 35mm, with a Q&A afterwards where the directors have to answer for their choices.',
  seed_melb(8, '14:00'),
  seed_melb(8, '14:00') + interval '180 minutes',
  'Cinema Nova', 'Carlton', '380 Lygon St, Carlton',
  -37.8, 144.967, 900, 'https://www.trybooking.com/', 'trybooking',
  (select id from activity_types where label = 'Concerts & performances')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Melbourne Uni Film Society'),
  'Score & Screen: Live Soundtrack Night',
  'A student ensemble plays live over silent film clips they have never rehearsed against. It goes wrong at least once and that is the fun of it.',
  seed_melb(12, '19:00'),
  seed_melb(12, '19:00') + interval '150 minutes',
  'The Toff in Town', 'Melbourne', '252 Swanston St, Melbourne',
  -37.814, 144.963, 1800, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Concerts & performances')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Link Arts & Culture'),
  'Life Drawing in the Laneway',
  'Charcoal, newsprint and a clothed model, in a working studio surrounded by other people making things. Materials provided. No experience whatsoever required.',
  seed_melb(1, '18:30'),
  seed_melb(1, '18:30') + interval '120 minutes',
  'Blender Studios', 'West Melbourne', '33 Dudley St, West Melbourne',
  -37.806, 144.94, 800, null, 'none',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Link Arts & Culture'),
  'Zine Fair + Riso Workshop',
  'Forty student stallholders selling zines for the price of a coffee, plus a rolling risograph workshop — fold and print an eight-page zine in twenty minutes.',
  seed_melb(5, '12:00'),
  seed_melb(5, '12:00') + interval '240 minutes',
  'RMIT Building 45', 'Melbourne', 'Bldg 45, La Trobe St, Melbourne',
  -37.814, 144.963, 0, null, 'none',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Link Arts & Culture'),
  'Open Mic: First-Timers Welcome',
  'Half the slots are held for people who have never played to a room before. Five minutes each, a house amp and a piano that is nearly in tune.',
  seed_melb(10, '19:00'),
  seed_melb(10, '19:00') + interval '150 minutes',
  'Bar Open', 'Fitzroy', '317 Brunswick St, Fitzroy',
  -37.798, 144.978, 0, null, 'none',
  (select id from activity_types where label = 'Concerts & performances')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Link Arts & Culture'),
  'Street Photography Walk: Hosier to Fitzroy',
  'A three-kilometre walk from Hosier Lane up to Fitzroy in the late afternoon light, with two photographers giving on-the-spot feedback. Phone cameras absolutely count.',
  seed_melb(4, '16:00'),
  seed_melb(4, '16:00') + interval '150 minutes',
  'Meet at Hosier Lane', 'Melbourne', 'Hosier Ln, Melbourne',
  -37.814, 144.963, 0, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Outdoor activities')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Business Society'),
  'Case Comp Crash Course',
  'How to structure, time and present a consulting case in under ten minutes, run by last year’s national finalists. Practice case included.',
  seed_melb(2, '17:00'),
  seed_melb(2, '17:00') + interval '120 minutes',
  'RMIT Building 80', 'Melbourne', '445 Swanston St, Melbourne',
  -37.814, 144.963, 0, 'https://www.eventbrite.com.au/', 'eventbrite',
  (select id from activity_types where label = 'Seminars & talks')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Business Society'),
  'Founders on Failure: Three Startups, One Night',
  'Three founders talk only about the thing that did not work — the co-founder split, the burnt runway, the product nobody wanted. Honest, specific and a bit brutal.',
  seed_melb(7, '18:30'),
  seed_melb(7, '18:30') + interval '120 minutes',
  'Goods Shed North', 'Docklands', '733 Collins St, Docklands',
  -37.817, 144.946, 500, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Seminars & talks')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Business Society'),
  'End of Semester Gala Dinner',
  'Three courses, a keynote you will actually remember, and a room full of people who will be your industry in three years. Black tie, student prices.',
  seed_melb(13, '18:00'),
  seed_melb(13, '18:00') + interval '240 minutes',
  'Meat Market', 'North Melbourne', '5 Blackwood St, North Melbourne',
  -37.799, 144.942, 6500, 'https://www.trybooking.com/', 'trybooking',
  (select id from activity_types where label = 'Social mixers')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Monash Association of Coding'),
  'Beginner’s CTF: Capture the Flag Night',
  'A security capture-the-flag built for people who have never done one. Teams of three formed on the night, hints available, snacks non-negotiable.',
  seed_melb(3, '17:30'),
  seed_melb(3, '17:30') + interval '180 minutes',
  'Woodside Building', 'Clayton', '20 Exhibition Walk, Clayton',
  -37.917, 145.122, 0, null, 'none',
  (select id from activity_types where label = 'Competitions')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Monash Association of Coding'),
  'Ship It Weekend: 24-Hour Build',
  'One weekend, one working thing. Mentors from four companies float between tables. Sleeping bags optional but historically popular.',
  seed_melb(11, '09:00'),
  seed_melb(11, '09:00') + interval '540 minutes',
  'Learning & Teaching Building', 'Clayton', '19 Ancora Imparo Way, Clayton',
  -37.917, 145.122, 0, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Hackathons')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Monash Association of Coding'),
  'AI Reading Group: Papers & Pastries',
  'One paper, read aloud in sections, argued about over pastries. This fortnight: something on evaluation that everyone cites and nobody has read.',
  seed_melb(6, '12:30'),
  seed_melb(6, '12:30') + interval '90 minutes',
  'Campus Centre', 'Clayton', '21 Chancellors Walk, Clayton',
  -37.917, 145.122, 0, null, 'none',
  (select id from activity_types where label = 'Club meetings')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Monash Sustainability Collective'),
  'Repair Café: Bring Something Broken',
  'Volunteer fixers on soldering irons and sewing machines. Bring a lamp, a jacket, a kettle, a bike. You fix it, we show you how.',
  seed_melb(4, '11:00'),
  seed_melb(4, '11:00') + interval '240 minutes',
  'Monash Campus Centre', 'Clayton', '21 Chancellors Walk, Clayton',
  -37.917, 145.122, 0, null, 'none',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Monash Sustainability Collective'),
  'Yarra Bend Cleanup + Picnic',
  'Two hours along the river with gloves and bags, then a picnic under the gums. Last time we pulled out nine shopping trolleys and a scooter.',
  seed_melb(9, '09:30'),
  seed_melb(9, '09:30') + interval '180 minutes',
  'Yarra Bend Park', 'Fairfield', 'Yarra Bend Rd, Fairfield',
  -37.778, 145.017, 0, 'https://www.eventbrite.com.au/', 'eventbrite',
  (select id from activity_types where label = 'Outdoor activities')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Monash Sustainability Collective'),
  'Thrift Swap & Mend Night',
  'Bring five things you never wear, leave with five you will. Visible-mending station running all night for anything with a hole in it.',
  seed_melb(12, '17:00'),
  seed_melb(12, '17:00') + interval '150 minutes',
  'Monash Sports Hall', 'Clayton', '42 Scenic Blvd, Clayton',
  -37.917, 145.122, 0, null, 'none',
  (select id from activity_types where label = 'Social mixers')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Deakin Photography Club'),
  'Golden Hour at the Pier',
  'The old pilings at sunset are the most photographed thing in Port Melbourne for a reason. Tripods welcome, phone shooters equally welcome.',
  seed_melb(2, '17:45'),
  seed_melb(2, '17:45') + interval '120 minutes',
  'Princes Pier', 'Port Melbourne', 'Pier St, Port Melbourne',
  -37.84, 144.93, 0, null, 'none',
  (select id from activity_types where label = 'Outdoor activities')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Deakin Photography Club'),
  'Studio Lighting 101',
  'One light, then two, then a reflector — portrait lighting from the beginning in a real studio. We supply the gear, you supply a willing face.',
  seed_melb(8, '13:00'),
  seed_melb(8, '13:00') + interval '180 minutes',
  'Deakin Burwood Studio D', 'Burwood', '221 Burwood Hwy, Burwood',
  -37.851, 145.114, 1000, null, 'none',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Deakin Photography Club'),
  'Night Long-Exposure: City Loop',
  'Light trails, reflections on the Yarra and thirty-second exposures across the bridge. Bring a tripod or borrow one of our four.',
  seed_melb(14, '20:00'),
  seed_melb(14, '20:00') + interval '150 minutes',
  'Sandridge Bridge', 'Southbank', 'Sandridge Bridge, Southbank',
  -37.823, 144.964, 0, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Outdoor activities')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Deakin Entrepreneurs Society'),
  'Pitch Night: 90 Seconds, No Slides',
  'Ninety seconds, no deck, no props. Judges from two VC funds give feedback on the spot. Sign up on the night if you are feeling brave.',
  seed_melb(5, '18:00'),
  seed_melb(5, '18:00') + interval '150 minutes',
  'Deakin Downtown', 'Docklands', '727 Collins St, Docklands',
  -37.817, 144.946, 0, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Competitions')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Deakin Entrepreneurs Society'),
  'Side Hustle Sunday: Build a Landing Page',
  'Arrive with an idea, leave with a live page and a way to take email addresses. No coding needed, though you can if you want to.',
  seed_melb(10, '10:00'),
  seed_melb(10, '10:00') + interval '240 minutes',
  'Deakin Downtown', 'Docklands', '727 Collins St, Docklands',
  -37.817, 144.946, 600, 'https://www.eventbrite.com.au/', 'eventbrite',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Deakin Entrepreneurs Society'),
  'Coffee with a Founder',
  'Eight students, one founder, one long table, ninety minutes before the day starts. You get to ask the question you would not ask on a panel.',
  seed_melb(13, '08:30'),
  seed_melb(13, '08:30') + interval '90 minutes',
  'Market Lane Coffee', 'Carlton', 'Queen Victoria Market, Carlton',
  -37.8, 144.967, 0, null, 'none',
  (select id from activity_types where label = 'Social mixers')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Wellbeing Collective'),
  'Sunrise Run Club: 5k, All Paces',
  'A flat 3.2km loop with a walk group, a jog group and a group that takes it far too seriously. Coffee at the pavilion afterwards.',
  seed_melb(1, '06:45'),
  seed_melb(1, '06:45') + interval '75 minutes',
  'Princes Park', 'Carlton North', 'Princes Park Dr, Carlton North',
  -37.784, 144.972, 0, null, 'none',
  (select id from activity_types where label = 'Sports events')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Wellbeing Collective'),
  'Exam Season Yoga & Chai',
  'An hour of slow, unintimidating yoga aimed squarely at people who have been at a desk for nine hours, then chai and a biscuit. Mats provided.',
  seed_melb(6, '17:00'),
  seed_melb(6, '17:00') + interval '90 minutes',
  'La Trobe Wellbeing Hub', 'Bundoora', 'Kingsbury Dr, Bundoora',
  -37.7, 145.067, 0, null, 'none',
  (select id from activity_types where label = 'Club meetings')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Wellbeing Collective'),
  'Bouldering for Beginners',
  'Entry, shoes and a two-hour intro session with a coach. If you can climb a ladder you can do this, and you will ache tomorrow.',
  seed_melb(9, '18:00'),
  seed_melb(9, '18:00') + interval '150 minutes',
  'Northside Boulders', 'Brunswick', '23 Sydney Rd, Brunswick',
  -37.767, 144.96, 1500, null, 'none',
  (select id from activity_types where label = 'Sports events')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Wellbeing Collective'),
  'Silent Study Sprint + Free Coffee',
  'Four hours of phones-away, timer-on study in blocks of fifty minutes, with a coffee cart from ten. Bring the assignment you are avoiding.',
  seed_melb(3, '10:00'),
  seed_melb(3, '10:00') + interval '240 minutes',
  'La Trobe Library', 'Bundoora', 'Kingsbury Dr, Bundoora',
  -37.7, 145.067, 0, null, 'none',
  (select id from activity_types where label = 'Club meetings')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Wellbeing Collective'),
  'Social Futsal: Teams Made on the Night',
  'Turn up alone, get put in a team, play four short games. Mixed, genuinely social, and nobody keeps a ladder.',
  seed_melb(13, '19:00'),
  seed_melb(13, '19:00') + interval '90 minutes',
  'La Trobe Sports Centre', 'Bundoora', 'Kingsbury Dr, Bundoora',
  -37.7, 145.067, 500, 'https://www.trybooking.com/', 'trybooking',
  (select id from activity_types where label = 'Sports events')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Food & Culture Club'),
  'Dumpling Night: Fold Your Own',
  'Four fillings, three folding techniques and a competitive final round. You eat everything you make, which is motivation enough.',
  seed_melb(4, '18:00'),
  seed_melb(4, '18:00') + interval '150 minutes',
  'Union Hall Kitchen', 'Bundoora', 'Kingsbury Dr, Bundoora',
  -37.7, 145.067, 1200, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Food & Culture Club'),
  'Language Exchange: 8 Tables, 8 Languages',
  'Twenty minutes per table, then everyone moves. Mandarin, Hindi, Auslan, Arabic, Spanish, Vietnamese, Greek and Italian. Absolute beginners at every table.',
  seed_melb(7, '17:30'),
  seed_melb(7, '17:30') + interval '120 minutes',
  'Eagle Bar', 'Bundoora', 'Kingsbury Dr, Bundoora',
  -37.7, 145.067, 0, null, 'none',
  (select id from activity_types where label = 'Social mixers')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'La Trobe Food & Culture Club'),
  'Preston Market Food Crawl',
  'Six stalls, six things you have probably never eaten, chosen by people who grew up shopping here. Free to join, bring about twenty-five dollars.',
  seed_melb(11, '11:00'),
  seed_melb(11, '11:00') + interval '180 minutes',
  'Preston Market', 'Preston', 'Cramer St, Preston',
  -37.741, 145.001, 0, null, 'none',
  (select id from activity_types where label = 'Outdoor activities')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Swinburne Game Development Club'),
  'Game Jam Kickoff: 48 Hours, One Theme',
  'Theme announced at 5pm, teams formed by 6, playable builds due Sunday night. Artists and writers are as wanted as programmers.',
  seed_melb(5, '17:00'),
  seed_melb(5, '17:00') + interval '180 minutes',
  'Swinburne ATC Building', 'Hawthorn', '427 Burwood Rd, Hawthorn',
  -37.822, 145.035, 0, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Hackathons')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Swinburne Game Development Club'),
  'Retro Arcade Night + Tournament',
  'Two floors of cabinets, a Street Fighter II bracket and a prize nobody actually wants but everybody competes for. Ticket includes a token stack.',
  seed_melb(8, '18:00'),
  seed_melb(8, '18:00') + interval '240 minutes',
  'Bartronica', 'Melbourne', '121 Flinders Ln, Melbourne',
  -37.814, 144.963, 1000, 'https://www.eventbrite.com.au/', 'eventbrite',
  (select id from activity_types where label = 'Competitions')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Swinburne Game Development Club'),
  'Playtest Party: Bring Your Build',
  'Bring something half-finished and watch a stranger play it while you sit on your hands. The most useful three hours in game development.',
  seed_melb(12, '17:30'),
  seed_melb(12, '17:30') + interval '150 minutes',
  'Swinburne AMDC', 'Hawthorn', '469 Burwood Rd, Hawthorn',
  -37.822, 145.035, 0, null, 'none',
  (select id from activity_types where label = 'Club meetings')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Swinburne Design Collective'),
  'Portfolio Night: Get Yours Reviewed',
  'Fifteen-minute one-on-one reviews with working designers from studios and in-house teams. Book a slot, bring a laptop, take notes.',
  seed_melb(7, '18:00'),
  seed_melb(7, '18:00') + interval '150 minutes',
  'Swinburne AGSE', 'Hawthorn', 'John St, Hawthorn',
  -37.822, 145.035, 0, 'https://www.eventbrite.com.au/', 'eventbrite',
  (select id from activity_types where label = 'Career fairs')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Swinburne Design Collective'),
  'Type Safari: Melbourne Signage Walk',
  'Hand-painted ghost signs, deco brasswork and one genuinely terrible council sign, over two hours on foot. You will never look at the CBD the same way.',
  seed_melb(10, '15:00'),
  seed_melb(10, '15:00') + interval '120 minutes',
  'Meet at Degraves St', 'Melbourne', 'Degraves St, Melbourne',
  -37.814, 144.963, 0, null, 'none',
  (select id from activity_types where label = 'Outdoor activities')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Swinburne Design Collective'),
  'Volunteer Design Day for Local Charities',
  'Five community organisations arrive with a real design problem. You spend a day on it in a small team and they leave with something they can use.',
  seed_melb(14, '10:00'),
  seed_melb(14, '10:00') + interval '300 minutes',
  'Kathleen Syme Library', 'Carlton', '251 Faraday St, Carlton',
  -37.8, 144.967, 0, 'https://events.humanitix.com/', 'humanitix',
  (select id from activity_types where label = 'Workshops')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'RMIT Link Arts & Culture'),
  'Semester Trivia Night',
  'Six rounds, one picture round that ruins everyone, and a meat tray that has been won by the same table three semesters running.',
  seed_melb(-3, '18:00'),
  seed_melb(-3, '18:00') + interval '150 minutes',
  'Naughtons Hotel', 'Parkville', '43 Royal Pde, Parkville',
  -37.785, 144.952, 500, null, 'none',
  (select id from activity_types where label = 'Social mixers')
);
insert into events (club_id, title, description, starts_at, ends_at, venue_name, suburb, address,
                    lat, lng, price_cents, ticket_url, ticket_provider, activity_type_id) values (
  (select id from clubs where name = 'Melbourne University Computing Club'),
  'Winter Coding Bootcamp: Week 1',
  'The first of four evenings taking absolute beginners from nothing to a working web page they built themselves.',
  seed_melb(-5, '17:30'),
  seed_melb(-5, '17:30') + interval '120 minutes',
  'Melbourne Connect', 'Carlton', '700 Swanston St, Carlton',
  -37.8, 144.967, 0, null, 'none',
  (select id from activity_types where label = 'Workshops')
);

-- ---------- event tags ----------

insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Hack the Semester: 6-Hour Build Night'), id
from interests where slug in ('technology-innovation', 'study-academic');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Intro to Rust, With Pizza'), id
from interests where slug in ('technology-innovation', 'food-cafes');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Grad Season: Resume Teardown with Atlassian'), id
from interests where slug in ('career-networking', 'technology-innovation');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Rooftop Film Night: Wong Kar-wai Double'), id
from interests where slug in ('art-design', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = '35mm Sunday: Shorts by Melbourne Students'), id
from interests where slug in ('art-design', 'photography-content');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Score & Screen: Live Soundtrack Night'), id
from interests where slug in ('music-performance', 'art-design');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Life Drawing in the Laneway'), id
from interests where slug in ('art-design');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Zine Fair + Riso Workshop'), id
from interests where slug in ('art-design', 'photography-content');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Open Mic: First-Timers Welcome'), id
from interests where slug in ('music-performance', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Street Photography Walk: Hosier to Fitzroy'), id
from interests where slug in ('photography-content', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Case Comp Crash Course'), id
from interests where slug in ('business-entrepreneurship', 'career-networking', 'study-academic');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Founders on Failure: Three Startups, One Night'), id
from interests where slug in ('business-entrepreneurship', 'career-networking');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'End of Semester Gala Dinner'), id
from interests where slug in ('business-entrepreneurship', 'career-networking', 'food-cafes');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Beginner’s CTF: Capture the Flag Night'), id
from interests where slug in ('technology-innovation', 'gaming');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Ship It Weekend: 24-Hour Build'), id
from interests where slug in ('technology-innovation', 'study-academic');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'AI Reading Group: Papers & Pastries'), id
from interests where slug in ('technology-innovation', 'study-academic', 'food-cafes');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Repair Café: Bring Something Broken'), id
from interests where slug in ('sustainability', 'volunteering');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Yarra Bend Cleanup + Picnic'), id
from interests where slug in ('sustainability', 'volunteering', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Thrift Swap & Mend Night'), id
from interests where slug in ('sustainability', 'art-design');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Golden Hour at the Pier'), id
from interests where slug in ('photography-content', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Studio Lighting 101'), id
from interests where slug in ('photography-content', 'art-design');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Night Long-Exposure: City Loop'), id
from interests where slug in ('photography-content', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Pitch Night: 90 Seconds, No Slides'), id
from interests where slug in ('business-entrepreneurship', 'career-networking');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Side Hustle Sunday: Build a Landing Page'), id
from interests where slug in ('business-entrepreneurship', 'technology-innovation', 'study-academic');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Coffee with a Founder'), id
from interests where slug in ('business-entrepreneurship', 'career-networking', 'food-cafes');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Sunrise Run Club: 5k, All Paces'), id
from interests where slug in ('sport-fitness', 'health-wellbeing');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Exam Season Yoga & Chai'), id
from interests where slug in ('health-wellbeing', 'study-academic', 'food-cafes');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Bouldering for Beginners'), id
from interests where slug in ('sport-fitness', 'health-wellbeing');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Silent Study Sprint + Free Coffee'), id
from interests where slug in ('study-academic', 'health-wellbeing');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Social Futsal: Teams Made on the Night'), id
from interests where slug in ('sport-fitness');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Dumpling Night: Fold Your Own'), id
from interests where slug in ('food-cafes', 'culture-languages');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Language Exchange: 8 Tables, 8 Languages'), id
from interests where slug in ('culture-languages', 'career-networking');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Preston Market Food Crawl'), id
from interests where slug in ('food-cafes', 'culture-languages', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Game Jam Kickoff: 48 Hours, One Theme'), id
from interests where slug in ('gaming', 'technology-innovation', 'art-design');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Retro Arcade Night + Tournament'), id
from interests where slug in ('gaming', 'melbourne-exploration');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Playtest Party: Bring Your Build'), id
from interests where slug in ('gaming', 'technology-innovation');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Portfolio Night: Get Yours Reviewed'), id
from interests where slug in ('art-design', 'career-networking');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Type Safari: Melbourne Signage Walk'), id
from interests where slug in ('art-design', 'melbourne-exploration', 'photography-content');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Volunteer Design Day for Local Charities'), id
from interests where slug in ('volunteering', 'art-design');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Semester Trivia Night'), id
from interests where slug in ('culture-languages', 'food-cafes');
insert into event_interests (event_id, interest_id)
select (select id from events where title = 'Winter Coding Bootcamp: Week 1'), id
from interests where slug in ('technology-innovation', 'study-academic');

-- ---------- a demo student ----------
-- profiles hangs off auth.users, so sign up through the app once with a
-- university email, then run this with that email to give the account
-- interests, preferences and a few saved events. Saved is never empty
-- when a judge picks up the phone.

create or replace function seed_demo_user(p_email text)
returns void language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = lower(p_email);
  if v_id is null then
    raise exception 'No account for % - sign up through the app first', p_email;
  end if;

  update profiles
     set home_suburb = 'Clayton',
         max_distance_km = null,
         budget_cents = 2500,
         discovery = 'swipe'
   where id = v_id;

  delete from user_interests where user_id = v_id;
  insert into user_interests (user_id, interest_id)
  select v_id, id from interests
  where slug in ('art-design','photography-content','food-cafes',
                 'melbourne-exploration','technology-innovation');

  delete from user_activity_types where user_id = v_id;
  insert into user_activity_types (user_id, activity_type_id)
  select v_id, id from activity_types
  where label in ('Workshops','Outdoor activities','Concerts & performances');

  delete from swipes where user_id = v_id;
  insert into swipes (user_id, event_id, direction)
  select v_id, id, 'like' from events
  where title in ('Street Photography Walk: Hosier to Fitzroy',
                  'Rooftop Film Night: Wong Kar-wai Double',
                  'Dumpling Night: Fold Your Own');
  insert into swipes (user_id, event_id, direction)
  select v_id, id, 'pass' from events
  where title in ('End of Semester Gala Dinner', 'Sunrise Run Club: 5k, All Paces');

  delete from registrations where user_id = v_id;
  insert into registrations (user_id, event_id, channel)
  select v_id, id, 'internal' from events
  where title = 'Street Photography Walk: Hosier to Fitzroy';
end $$;

-- Then run:  select seed_demo_user('you@student.rmit.edu.au');

drop function seed_melb(int, time);
