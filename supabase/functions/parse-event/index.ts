/**
 * UniVerse — POST /parse-event
 * ===============================================================
 * The one thing the parser can't do in a browser: fetch the page.
 *
 * A browser cannot fetch events.humanitix.com from your app — CORS
 * forbids it, and no client-side trick gets around that. So the fetch
 * happens here, on Supabase's edge, and everything else (all the
 * actual parsing) stays in lib/event-parser where it can also run in
 * the browser, in Node, and in the tests.
 *
 * DEPLOY
 *   supabase functions deploy parse-event
 *
 * There is nothing to configure. It needs no secrets: it reads public
 * event pages and returns what it read. It does NOT touch the database
 * — saving is a separate, authenticated step, on purpose, so a parsing
 * bug can never write anything.
 *
 * CALL
 *   POST /functions/v1/parse-event
 *   Authorization: Bearer <the user's access token>
 *   { "url": "https://events.humanitix.com/example" }
 *
 * SECURITY
 * This endpoint takes a URL from a signed-in student and fetches it,
 * which is textbook SSRF. Three things guard it:
 *   1. an allow-list of hosts we have parsers for (lib/.../safeUrl.js,
 *      shared with the client so the two can't drift)
 *   2. a deny-list of localhost, private ranges and cloud metadata
 *      addresses, re-checked after every redirect
 *   3. sign-in required, plus a per-user rate limit — an open fetch
 *      proxy is a gift to anyone scanning for one
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// One canonical copy of the parser, shared with the app and the tests.
// Supabase's bundler follows relative imports out of the functions
// folder, so there is no second copy to keep in sync.
import { parseEventFromHtml } from '../../../lib/event-parser/index.js';
import { checkUrl } from '../../../lib/event-parser/safeUrl.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 3_000_000;

/** Crude but effective: 20 fetches per user per 10 minutes, in memory.
 *  An edge instance is short-lived, so this is a speed bump rather
 *  than a quota — move it to a table if it ever needs to be exact. */
const hits = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW = 10 * 60 * 1000;

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter(t => now - t < RATE_WINDOW);
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) hits.clear();      // don't grow without bound
  return recent.length > RATE_LIMIT;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // ---- who's asking ----
  // Signed in, because an open fetch proxy will be found and abused.
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Sign in first.' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return json({ error: 'Sign in first.' }, 401);

  if (rateLimited(user.id)) {
    return json({ error: 'That is a lot of links at once. Try again in a few minutes.' }, 429);
  }

  // ---- what they're asking for ----
  let body: { url?: string };
  try { body = await req.json(); }
  catch { return json({ error: 'Send {"url": "…"}' }, 400); }

  const check = checkUrl(body.url || '');
  if (!check.ok) return json({ error: check.reason }, 400);
  const url = check.url;

  // ---- fetch it ----
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html = '';
  let finalUrl = url.href;

  try {
    const res = await fetch(url.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'UniVerseBot/1.0 (+https://universe.app/about-the-parser)',
        'Accept': 'text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9'
      }
    });

    // A redirect can walk off the allow-list — check where we landed.
    finalUrl = res.url || url.href;
    const after = checkUrl(finalUrl);
    if (!after.ok) return json({ error: 'That link redirects somewhere we don\'t read.' }, 400);

    if (!res.ok) {
      return json({
        error: res.status === 404
          ? 'That event page doesn\'t exist any more.'
          : 'That page returned ' + res.status + '. It may need a login.'
      }, 422);
    }

    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/calendar|application\/json/i.test(type)) {
      return json({ error: 'That link isn\'t a web page.' }, 422);
    }

    // Read with a hard cap rather than trusting content-length, which
    // a hostile or broken server is free to lie about.
    const reader = res.body?.getReader();
    if (!reader) return json({ error: 'Nothing came back from that page.' }, 422);

    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
      if (size >= MAX_BYTES) { await reader.cancel(); break; }
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { joined.set(c, offset); offset += c.length; }
    html = new TextDecoder('utf-8').decode(joined);
  } catch (err) {
    const msg = String((err as Error)?.name === 'AbortError'
      ? 'That page took too long to answer.'
      : 'Couldn\'t reach that page.');
    return json({ error: msg }, 504);
  } finally {
    clearTimeout(timer);
  }

  // ---- parse it ----
  const event = parseEventFromHtml(html, finalUrl);

  if (!event.title && !event.startDate) {
    return json({
      error: 'That page doesn\'t publish event details we can read. ' +
             'Paste the page itself, or fill the form in by hand.',
      event
    }, 422);
  }

  // Preview only. Saving is a separate authenticated call to
  // post_club_event(), so nothing here can write to the catalogue.
  return json({ event });
});
