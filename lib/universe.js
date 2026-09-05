/**
 * UniVerse — data layer
 * ---------------------------------------------------------------
 * Every database operation the app needs, in one file. Import it,
 * give it your Supabase URL and anon key, and call the functions.
 *
 *   import { init, signIn, getDeck, swipe } from './lib/universe.js';
 *   init(SUPABASE_URL, SUPABASE_ANON_KEY);
 *
 * Nothing here needs the service role key. That key only ever runs
 * seeds, from your machine, and must never reach the browser.
 */

let sb = null;

/** Call once at startup. `client` lets you pass your own supabase-js
 *  client if you already made one. */
export function init(url, anonKey, client) {
  if (client) { sb = client; return sb; }
  if (!window.supabase) {
    throw new Error(
      'supabase-js is not loaded. Add this before your script:\n' +
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>'
    );
  }
  sb = window.supabase.createClient(url, anonKey);
  return sb;
}
function db() {
  if (!sb) throw new Error('Call init(url, anonKey) first.');
  return sb;
}

/* ===============================================================
   1. Auth
   =============================================================== */

/** Check the email belongs to a seeded university BEFORE sending a
 *  link, so gmail.com fails fast with a clear message.
 *  Returns {id, name, short_name} or null. */
export async function universityForEmail(email) {
  const { data, error } = await db().rpc('university_for_email', { p_email: email });
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

/** Send the magic link. The profile row is created by a database
 *  trigger the first time the account is made, so there is no
 *  second step to forget. */
export async function signIn(email, redirectTo) {
  const uni = await universityForEmail(email);
  if (!uni) {
    const err = new Error("We don't recognise that university yet — try your student email.");
    err.code = 'unknown_university';
    throw err;
  }
  const { error } = await db().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo || window.location.href }
  });
  if (error) throw error;
  return uni;
}

export async function signOut() {
  const { error } = await db().auth.signOut();
  if (error) throw error;
}

export async function currentUser() {
  const { data } = await db().auth.getUser();
  return data.user || null;
}

/** Fires whenever the user signs in or out. */
export function onAuthChange(fn) {
  return db().auth.onAuthStateChange((_e, session) => fn(session ? session.user : null));
}

/* ===============================================================
   2. Profile and preferences
   =============================================================== */

export async function getProfile() {
  const { data, error } = await db()
    .from('profiles')
    .select(`
      id, display_name, avatar_url, student_number, home_suburb,
      max_distance_km, budget_cents, discovery, dark_mode, seen_tutorial,
      university:universities ( id, name, short_name, brand_colour, union_name, reg_label, reg_url )
    `)
    .single();
  if (error) throw error;
  return data;
}

/** Patch any subset: {display_name, home_suburb, max_distance_km,
 *  budget_cents, discovery, dark_mode, seen_tutorial}. */
export async function updateProfile(patch) {
  const { data: u } = await db().auth.getUser();
  const { error } = await db().from('profiles').update(patch).eq('id', u.user.id);
  if (error) throw error;
}

export async function getInterests() {
  const { data, error } = await db().from('interests').select('*').order('sort_order');
  if (error) throw error;
  return data;
}

export async function getActivityTypes() {
  const { data, error } = await db().from('activity_types').select('*').order('sort_order');
  if (error) throw error;
  return data;
}

export async function getSuburbs() {
  const { data, error } = await db().from('suburbs').select('name, lat, lng').order('name');
  if (error) throw error;
  return data;
}

export async function getMyInterests() {
  const { data, error } = await db()
    .from('user_interests')
    .select('interest:interests ( id, slug, label, emoji )');
  if (error) throw error;
  return data.map(r => r.interest);
}

/** Replace the whole set — max five, enforced in the UI. */
export async function setMyInterests(interestIds) {
  const { data: u } = await db().auth.getUser();
  const uid = u.user.id;
  const del = await db().from('user_interests').delete().eq('user_id', uid);
  if (del.error) throw del.error;
  if (!interestIds.length) return;
  const { error } = await db()
    .from('user_interests')
    .insert(interestIds.map(id => ({ user_id: uid, interest_id: id })));
  if (error) throw error;
}

export async function getMyActivityTypes() {
  const { data, error } = await db()
    .from('user_activity_types')
    .select('activity_type:activity_types ( id, slug, label )');
  if (error) throw error;
  return data.map(r => r.activity_type);
}

export async function setMyActivityTypes(typeIds) {
  const { data: u } = await db().auth.getUser();
  const uid = u.user.id;
  const del = await db().from('user_activity_types').delete().eq('user_id', uid);
  if (del.error) throw del.error;
  if (!typeIds.length) return;
  const { error } = await db()
    .from('user_activity_types')
    .insert(typeIds.map(id => ({ user_id: uid, activity_type_id: id })));
  if (error) throw error;
}

/* ===============================================================
   3. The deck
   =============================================================== */

const EVENT_FIELDS = `
  id, title, description, image_url, starts_at, ends_at,
  venue_name, suburb, address, lat, lng, price_cents, is_free,
  ticket_url, ticket_provider,
  activity_type:activity_types ( slug, label ),
  club:clubs (
    id, name, initials,
    university:universities ( id, short_name, name, brand_colour, union_name, reg_label, reg_url )
  ),
  event_interests ( interest:interests ( slug, label, emoji ) )
`;

/**
 * The ranked deck. Scoring, the budget and distance filters, the
 * relaxation when the deck would be thin, and the three-per-club cap
 * all happen in Postgres — see 0003_functions.sql.
 *
 * Returns events with `score`, `distance_km`, `interest_overlap`,
 * `cross_campus` and `relaxed` attached.
 */
export async function getDeck(limit = 15) {
  const { data: ranked, error } = await db().rpc('get_deck', { p_limit: limit });
  if (error) throw error;
  if (!ranked.length) return [];

  const ids = ranked.map(r => r.event_id);
  const { data: events, error: e2 } = await db().from('events').select(EVENT_FIELDS).in('id', ids);
  if (e2) throw e2;

  const byId = Object.fromEntries(events.map(e => [e.id, e]));
  return ranked
    .filter(r => byId[r.event_id])
    .map(r => ({
      ...byId[r.event_id],
      score: r.score,
      distance_km: r.distance_km,
      interest_overlap: r.interest_overlap,
      cross_campus: r.cross_campus,
      relaxed: r.relaxed
    }));
}

/** Browse mode: everything upcoming, optionally text-searched. */
export async function browseEvents({ search = '', interestSlug = null, limit = 200 } = {}) {
  let q = db()
    .from('events')
    .select(EVENT_FIELDS)
    .eq('status', 'published')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit);

  if (search.trim()) {
    const s = `%${search.trim()}%`;
    q = q.or(`title.ilike.${s},venue_name.ilike.${s},suburb.ilike.${s},description.ilike.${s}`);
  }
  const { data, error } = await q;
  if (error) throw error;

  if (!interestSlug) return data;
  return data.filter(e => e.event_interests.some(x => x.interest.slug === interestSlug));
}

export async function getEvent(id) {
  const { data, error } = await db().from('events').select(EVENT_FIELDS).eq('id', id).single();
  if (error) throw error;
  return data;
}

/* ===============================================================
   4. Swiping, saving, registering
   =============================================================== */

/** direction: 'like' | 'pass'. Upserts, so re-swiping is safe.
 *  Call it WITHOUT awaiting from the swipe handler — the card must
 *  fly out immediately and the write happens behind it. */
export async function swipe(eventId, direction) {
  const { error } = await db().rpc('record_swipe', { p_event: eventId, p_direction: direction });
  if (error) throw error;
}

/** Undo: deleting the row puts the event back in the deck. */
export async function undoSwipe(eventId) {
  const { data: u } = await db().auth.getUser();
  const { error } = await db()
    .from('swipes').delete().eq('user_id', u.user.id).eq('event_id', eventId);
  if (error) throw error;
}

/** Saved is a view over swipes where direction = 'like'. There is no
 *  second table, so the two can never drift apart. */
export async function getSaved() {
  const { data, error } = await db()
    .from('swipes')
    .select(`created_at, event:events ( ${EVENT_FIELDS} )`)
    .eq('direction', 'like');
  if (error) throw error;
  return data
    .map(r => ({ ...r.event, saved_at: r.created_at }))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

/** channel: 'internal' for free events we take the name for,
 *  'club' for the club's own ticket page, 'union' for the
 *  university's union platform. */
export async function register(eventId, channel = 'internal') {
  const { error } = await db().rpc('register_for_event', { p_event: eventId, p_channel: channel });
  if (error) throw error;
}

export async function cancelRegistration(eventId) {
  const { data: u } = await db().auth.getUser();
  const { error } = await db()
    .from('registrations').delete().eq('user_id', u.user.id).eq('event_id', eventId);
  if (error) throw error;
}

export async function getMyRegistrations() {
  const { data, error } = await db().from('registrations').select('event_id, channel, registered_at');
  if (error) throw error;
  return data;
}

/**
 * Where a registration should send this student.
 *   free            -> take the name in-app, no redirect at all
 *   club ticket url -> the club's own page
 *   otherwise       -> the hosting university's union platform
 */
export function destinationFor(event) {
  const uni = event.club.university;
  if (event.price_cents === 0) return { kind: 'free', label: 'UniVerse', url: null, uni };
  if (event.ticket_url) return { kind: 'club', label: event.ticket_provider, url: event.ticket_url, uni };
  return { kind: 'union', label: uni.reg_label, url: uni.reg_url, uni };
}

/** The details we already know, to prefill or paste on the club's page. */
export function prefillFor(event, profile) {
  return {
    name: profile.display_name,
    email: profile.email,
    university: profile.university.name,
    studentNumber: profile.student_number,
    ticket: event.price_cents === 0 ? 'General admission · Free'
                                    : `General admission · $${(event.price_cents / 100).toFixed(2)}`,
    event: event.title
  };
}

/* ===============================================================
   5. Friends
   =============================================================== */

export async function getFriends() {
  const { data, error } = await db()
    .from('friendships')
    .select('status, friend:profiles!friendships_friend_id_fkey ( id, display_name, university:universities ( short_name, brand_colour ) )')
    .eq('status', 'accepted');
  if (error) throw error;
  return data.map(r => r.friend);
}

export async function requestFriend(friendId) {
  const { data: u } = await db().auth.getUser();
  const { error } = await db()
    .from('friendships')
    .insert({ user_id: u.user.id, friend_id: friendId, status: 'pending' });
  if (error) throw error;
}

export async function acceptFriend(requesterId) {
  const { error } = await db().rpc('accept_friend', { p_requester: requesterId });
  if (error) throw error;
}

export async function removeFriend(friendId) {
  const { data: u } = await db().auth.getUser();
  const { error } = await db()
    .from('friendships').delete()
    .or(`and(user_id.eq.${u.user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${u.user.id})`);
  if (error) throw error;
}

/** One call for a whole deck — first name and university only, and
 *  never anyone's passes. */
export async function friendsOnEvents(eventIds) {
  if (!eventIds.length) return {};
  const { data, error } = await db().rpc('friends_on_events', { p_events: eventIds });
  if (error) throw error;
  const out = {};
  for (const row of data) {
    (out[row.event_id] = out[row.event_id] || []).push({
      id: row.friend_id,
      firstName: row.first_name,
      university: row.university,
      colour: row.brand_colour,
      registered: row.is_registered
    });
  }
  return out;
}

/* ===============================================================
   6. Clubs posting events
   =============================================================== */

/**
 * Post a club event. `event` takes the shape:
 *   { clubId, title, description, startsAt, endsAt, venueName, suburb,
 *     address, lat, lng, priceCents, ticketUrl, ticketProvider,
 *     activityTypeId, imageUrl, interestSlugs: [] }
 */
export async function postEvent(event) {
  const { data: u } = await db().auth.getUser();
  const { data: created, error } = await db()
    .from('events')
    .insert({
      club_id: event.clubId,
      title: event.title,
      description: event.description || null,
      image_url: event.imageUrl || null,
      starts_at: event.startsAt,
      ends_at: event.endsAt || null,
      venue_name: event.venueName || null,
      suburb: event.suburb || null,
      address: event.address || null,
      lat: event.lat ?? null,
      lng: event.lng ?? null,
      price_cents: event.priceCents || 0,
      ticket_url: event.ticketUrl || null,
      ticket_provider: event.ticketProvider || 'none',
      activity_type_id: event.activityTypeId || null,
      submitted_by: u.user.id
    })
    .select('id')
    .single();
  if (error) throw error;

  if (event.interestSlugs && event.interestSlugs.length) {
    const { data: ints } = await db().from('interests').select('id, slug').in('slug', event.interestSlugs);
    if (ints && ints.length) {
      await db().from('event_interests').insert(
        ints.map(i => ({ event_id: created.id, interest_id: i.id }))
      );
    }
  }
  return created.id;
}

export async function getClubs() {
  const { data, error } = await db()
    .from('clubs')
    .select('id, name, initials, university:universities ( id, short_name, brand_colour )')
    .order('name');
  if (error) throw error;
  return data;
}

/** New events, live, without a refresh. Returns an unsubscribe. */
export function watchEvents(onChange) {
  const channel = db()
    .channel('events-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onChange)
    .subscribe();
  return () => db().removeChannel(channel);
}

/* ===============================================================
   7. Dates — the ONLY place a date gets formatted
   =============================================================== */

const TZ = 'Australia/Melbourne';
const fmt = opts => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, ...opts });

export function timeStr(iso) {
  const parts = fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso));
  const get = t => (parts.find(p => p.type === t) || {}).value || '';
  return `${get('hour')}:${get('minute')}${get('dayPeriod').toLowerCase().replace(/\./g, '')}`;
}
export function dayTime(iso) {
  return `${fmt({ weekday: 'short' }).format(new Date(iso))} ${timeStr(iso)}`;
}
export function fullWhen(startIso, endIso) {
  const d = fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(startIso));
  return `${d}, ${timeStr(startIso)}${endIso ? '–' + timeStr(endIso) : ''}`;
}
export function dayKey(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));
}
export function dayLabel(iso) {
  const k = dayKey(iso);
  if (k === dayKey(new Date().toISOString())) return 'Today';
  if (k === dayKey(new Date(Date.now() + 864e5).toISOString())) return 'Tomorrow';
  return fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(/,/g, '');
}
export function priceStr(event) {
  return event.price_cents === 0 ? 'Free' : `$${(event.price_cents / 100).toFixed(event.price_cents % 100 ? 2 : 0)}`;
}
