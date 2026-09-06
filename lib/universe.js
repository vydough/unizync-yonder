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
  const { data: userData, error: userError } = await db().auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('No authenticated user.');

  const { data, error } = await db()
    .from('profiles')
    .select(`
      id, display_name, avatar_url, student_number, home_suburb,
      max_distance_km, budget_cents, discovery, dark_mode, seen_tutorial,
      university:universities ( id, name, short_name, brand_colour, union_name, reg_label, reg_url )
    `)
    .eq('id', userData.user.id)
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
  ticket_url, page_url, ticket_provider, source, source_url,
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
 * all happen in Postgres — see 0006_ranking.sql.
 *
 * Every component of the score is normalised 0–1 by a published
 * formula (Szymkiewicz–Simpson overlap, Jaccard, Hacker News gravity
 * decay, Haversine + exponential distance decay, Wilson lower bound)
 * and the weights add to 1, so `score` IS the match fraction.
 *
 * Returns events with `score`, `matchPct`, `topReason`, `distance_km`,
 * `interest_overlap`, `cross_campus` and `relaxed` attached.
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
      score: r.score,                 // 0..1 — the weighted match fraction
      matchPct: r.match_pct,          // the same thing as a percentage
      topReason: r.top_reason,        // 'interest' | 'activity' | 'timing' |
                                      // 'distance' | 'price' | 'social' | 'cross'
      distance_km: r.distance_km,
      interest_overlap: r.interest_overlap,
      cross_campus: r.cross_campus,
      relaxed: r.relaxed
    }));
}

/** Browse mode: everything upcoming, optionally text-searched. */
export async function browseEvents({ search = '', interestSlug = null, limit = 200 } = {}) {
  const now = new Date().toISOString();
  let q = db()
    .from('events')
    .select(EVENT_FIELDS)
    .eq('status', 'published')
    .or(`ends_at.gt.${now},and(ends_at.is.null,starts_at.gt.${now})`)
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
/**
 * Where "Register" sends someone, most specific first:
 *   1. free           → we take the registration in-app
 *   2. ticket_url     → the club's checkout page
 *   3. page_url       → the exact event page the organiser pasted
 *   4. the union      → last resort, and only for events that predate
 *                       organiser posting
 * Steps 2 and 3 are the point: a student who tapped one event must
 * land on that event, never on a union homepage they have to search.
 */
export function destinationFor(event) {
  const uni = event.club.university;
  if (event.price_cents === 0) return { kind: 'free', label: 'UniVerse', url: null, uni };
  if (event.ticket_url) return { kind: 'club', label: event.ticket_provider, url: event.ticket_url, uni };
  if (event.page_url)   return { kind: 'club', label: hostOf(event.page_url), url: event.page_url, uni };
  return { kind: 'union', label: uni.reg_label, url: uni.reg_url, uni };
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
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

/**
 * Add someone by the student email you already have. This is the ONLY
 * way to add anyone — there is no directory, no search and no
 * suggestions, so a student is never shown to someone who doesn't
 * already know their address.
 *
 * Returns one of:
 *   'sent'                a request or an invite went out
 *   'accepted'            they had already asked you, so you're friends
 *   'already_friends'
 *   'self'
 *   'unknown_university'  not an email domain we recognise
 *
 * 'sent' comes back whether or not that address has an account, so this
 * can't be used to find out who is registered.
 */
export async function requestFriendByEmail(email) {
  const { data, error } = await db().rpc('request_friend_by_email', { p_email: email });
  if (error) throw error;
  return data;
}

/** People who have asked to add you — first name and university only. */
export async function pendingRequests() {
  const { data, error } = await db().rpc('pending_friend_requests');
  if (error) throw error;
  return data.map(r => ({
    id: r.requester_id,
    firstName: r.first_name,
    university: r.university,
    colour: r.brand_colour,
    askedAt: r.asked_at
  }));
}

/** Requests you've sent that haven't been accepted yet. */
export async function sentRequests() {
  const { data: u } = await db().auth.getUser();
  const [pending, invites] = await Promise.all([
    db().from('friendships').select('friend_id').eq('user_id', u.user.id).eq('status', 'pending'),
    db().from('friend_invites').select('email, created_at')
  ]);
  if (pending.error) throw pending.error;
  if (invites.error) throw invites.error;
  return {
    toMembers: pending.data.map(r => r.friend_id),
    toInvited: invites.data.map(r => r.email)
  };
}

export async function cancelInvite(email) {
  const { data: u } = await db().auth.getUser();
  const { error } = await db()
    .from('friend_invites').delete().eq('inviter_id', u.user.id).eq('email', email.toLowerCase());
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
   6. Club organisers
   A student proves to their union that they run a club, and only
   then can they post that club's events. Nothing here can approve
   itself: `status` is forced to 'pending' by RLS and there is no
   update policy, so only the union's review tool (service role)
   can move a claim to 'verified'.
   =============================================================== */

/** Your standing, or null. { id, status, clubName, role, universityId } */
export async function myOrganiser() {
  const { data, error } = await db().rpc('my_organiser');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,                 // 'pending' | 'verified' | 'rejected'
    clubId: row.club_id,
    clubName: row.club_name,
    role: row.role,
    universityId: row.university_id,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note
  };
}

export async function isVerifiedOrganiser() {
  const o = await myOrganiser();
  return !!o && o.status === 'verified';
}

/**
 * Ask us to confirm you run a club.
 *   requestOrganiser({ clubName, role, proofUrl })
 *   requestOrganiser({ clubName, role, proofFile })   // a File from an <input type=file>
 * A link to the union's own club page is enough on its own. A
 * screenshot goes to the private `organiser-proof` bucket and only
 * the path is stored, so nobody browsing the table sees the file.
 */
/** The only roles that can be verified. A general committee member
 *  can't post in a club's name — the exec is who the union lists. */
export const EXEC_ROLES = ['President','Vice-President','Secretary','Treasurer','Events officer'];

export async function requestOrganiser({ clubName, role, proofUrl = null, proofFile = null }) {
  if (!EXEC_ROLES.includes(role)) {
    throw new Error('Only a club\'s executive can be verified: ' + EXEC_ROLES.join(', '));
  }
  let proofPath = null;
  if (proofFile) {
    const { data: u } = await db().auth.getUser();
    proofPath = `${u.user.id}/${Date.now()}-${proofFile.name.replace(/[^\w.\-]/g, '_')}`;
    const { error: upErr } = await db().storage.from('organiser-proof').upload(proofPath, proofFile);
    if (upErr) throw upErr;
  }
  const { data, error } = await db().rpc('request_organiser', {
    p_club_name: clubName,
    p_role: role,
    p_proof_url: proofUrl,
    p_proof_path: proofPath
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/* ===============================================================
   7. Posting, editing and removing a club's events
   =============================================================== */

/**
 * Post an event as a verified organiser. Takes the shape the paste
 * parser produces:
 *   { title, description, startsAt, endsAt, venueName, suburb, address,
 *     priceCents, ticketUrl, ticketProvider, activityType, imageUrl,
 *     sourceUrl, interestSlugs: [] }
 * The club row is created on the first event if the union's club
 * isn't in our catalogue yet, and lat/lng come from the suburb.
 */
export async function postClubEvent(event) {
  const { data, error } = await db().rpc('post_club_event', {
    p: {
      title:           event.title,
      description:     event.description || null,
      image_url:       event.imageUrl || null,
      starts_at:       event.startsAt,
      ends_at:         event.endsAt || null,
      venue_name:      event.venueName || null,
      suburb:          event.suburb || null,
      address:         event.address || null,
      price_cents:     event.priceCents || 0,
      ticket_url:      event.ticketUrl || null,
      page_url:        event.pageUrl || null,
      ticket_provider: event.ticketProvider || 'none',
      activity_type:   event.activityType || null,
      source_url:      event.sourceUrl || null,
      interests:       event.interestSlugs || []
    }
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/** The events you posted, cancelled ones included. */
export async function myClubEvents() {
  const { data: u } = await db().auth.getUser();
  const { data, error } = await db()
    .from('events')
    .select('*, club:clubs ( id, name, initials )')
    .eq('submitted_by', u.user.id)
    .order('starts_at');
  if (error) throw error;
  return data;
}

/** Change one of your own. Only the fields you pass are touched. */
export async function updateClubEvent(eventId, patch) {
  const cols = {
    title: 'title', description: 'description', imageUrl: 'image_url',
    startsAt: 'starts_at', endsAt: 'ends_at', venueName: 'venue_name',
    suburb: 'suburb', address: 'address', priceCents: 'price_cents',
    ticketUrl: 'ticket_url', pageUrl: 'page_url', ticketProvider: 'ticket_provider',
    activityTypeId: 'activity_type_id', status: 'status'
  };
  const row = {};
  for (const [k, col] of Object.entries(cols)) if (k in patch) row[col] = patch[k];

  const { error } = await db().from('events').update(row).eq('id', eventId);
  if (error) throw error;

  if (patch.interestSlugs) {
    await db().from('event_interests').delete().eq('event_id', eventId);
    const { data: ints } = await db().from('interests').select('id').in('slug', patch.interestSlugs);
    if (ints && ints.length) {
      await db().from('event_interests')
        .insert(ints.map(i => ({ event_id: eventId, interest_id: i.id })));
    }
  }
}

/**
 * Take one of yours down. Students who already registered keep their
 * record, so an event with registrations is CANCELLED rather than
 * deleted and they see "cancelled by the club". Returns 'deleted'
 * or 'cancelled' so you can say which happened.
 */
export async function removeClubEvent(eventId) {
  const { data, error } = await db().rpc('remove_club_event', { p_event_id: eventId });
  if (error) throw error;
  return data;
}

/* ===============================================================
   8. Notifications
   Derived on read from data that already exists — there is no table
   of messages, so the feed can only ever hold the three things we
   promised: something you saved starts within 24 hours, a friend
   registered for something, someone asked to add you.
   =============================================================== */

export async function getNotifications(limit = 25) {
  const { data, error } = await db().rpc('get_notifications', { p_limit: limit });
  if (error) throw error;
  return data.map(n => ({
    key: n.key,
    kind: n.kind,                 // 'reminder' | 'friend' | 'request'
    eventId: n.event_id,
    friendId: n.friend_id,
    title: n.title,
    body: n.body,
    meta: n.meta,
    at: n.sort_at,
    unread: n.unread
  }));
}

export async function unreadCount() {
  const { data, error } = await db().rpc('unread_notification_count');
  if (error) throw error;
  return data || 0;
}

/** Pass keys to mark some; pass nothing to mark the lot. */
export async function markNotificationsRead(keys = null) {
  const { data, error } = await db().rpc('mark_notifications_read', { p_keys: keys });
  if (error) throw error;
  return data;
}

/** The bell, live. Fires whenever anything that feeds it changes. */
export function watchNotifications(onChange) {
  const channel = db()
    .channel('notif-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onChange)
    .subscribe();
  return () => db().removeChannel(channel);
}

/* ===============================================================
   8b. Reading an event off its own page
   =============================================================== */

/**
 * Parse an event from a public URL.
 *
 * A browser cannot fetch events.humanitix.com from your page — CORS
 * forbids it — so this calls the `parse-event` edge function, which
 * does the fetch server-side behind an allow-list and returns the same
 * NormalisedEvent the local parser produces.
 *
 *   supabase functions deploy parse-event
 *
 * If you haven't deployed it, this throws a message saying so, and the
 * app falls back to asking the organiser to paste the page itself —
 * which needs no backend and produces an identical result.
 */
export async function parseEventLink(url) {
  const { data: session } = await db().auth.getSession();
  const token = session?.session?.access_token;
  if (!token) throw new Error('Sign in first.');

  const { data, error } = await db().functions.invoke('parse-event', {
    body: { url }
  });
  if (error) {
    // supabase-js wraps the function's own message; dig it out so the
    // organiser sees "we don't read links from x yet" rather than
    // "Edge Function returned a non-2xx status code".
    let detail = '';
    try { detail = (await error.context?.json())?.error || ''; } catch { /* ignore */ }
    throw new Error(detail || error.message ||
      'The parse-event function isn\'t deployed yet. Paste the event page itself instead.');
  }
  if (data?.error) throw new Error(data.error);
  return data.event;
}

/** Would the endpoint even accept this link? Checked locally, so the
 *  UI can say "paste the page instead" without a round trip. */
export { isFetchable, checkUrl } from './event-parser/safeUrl.js';

/** Parse text the organiser pasted — a page, a link or an invite.
 *  Pure and offline; the same code the endpoint runs. */
export { parseEventFromHtml } from './event-parser/index.js';

/* ===============================================================
   9. Clubs
   =============================================================== */

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
   10. Dates — the ONLY place a date gets formatted
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
