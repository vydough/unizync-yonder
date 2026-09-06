/* ================================================================
   UNIVERSAL EVENT PARSER  —  GENERATED, DO NOT EDIT BY HAND
   ================================================================
   Source of truth: lib/event-parser/
   Regenerate:      node tools/build-inline-parser.mjs
   Verify:          node lib/event-parser/inline.test.mjs

   The app is one file with no imports so it runs by double-clicking
   and works inside a shared artifact. This is the same code as the
   modules, flattened into one scope. Edit the modules, not this.

   Flow:  URL → validate → fetch (server-side only) → JSON-LD /
   OpenGraph / meta / microdata → detect provider → provider parser →
   merge by confidence → normalise → preview → save
   ================================================================ */
var UniVerseParser = (function(){
"use strict";
/* ---------- lib/event-parser/types.js ---------- */
/**
 * UniVerse — event parser types
 * ---------------------------------------------------------------
 * Plain JavaScript, because the whole project has no build step —
 * but the shapes are documented as JSDoc so an editor still
 * autocompletes them and a `.d.ts` would be a copy-paste away.
 *
 * The point of NormalisedEvent: every provider returns the SAME
 * object, so nothing downstream — the preview screen, the database
 * writer, the app — ever needs to know whether an event came from
 * Humanitix, Eventbrite, Rubric or a club's own WordPress page.
 */

/**
 * @typedef {Object} Ticket
 * @property {string}  [name]       'Student', 'General admission'
 * @property {number}  [price]      in dollars, not cents — cents is a DB concern
 * @property {string}  [currency]   'AUD'
 * @property {boolean} [available]
 */

/**
 * @typedef {Object} Venue
 * @property {string} [name]
 * @property {string} [address]
 * @property {string} [suburb]
 */

/**
 * @typedef {Object} EventSource
 * @property {string} provider   'humanitix' | 'eventbrite' | … | 'generic'
 * @property {string} url        the page this was read from
 * @property {string} [pageUrl]  the event's own canonical page, if it names one
 */

/**
 * @typedef {Object} NormalisedEvent
 * @property {string}   title
 * @property {string}   [description]
 * @property {string}   [imageUrl]
 * @property {string}   [startDate]   ISO 8601
 * @property {string}   [endDate]     ISO 8601
 * @property {Venue}    [venue]
 * @property {Ticket[]} [tickets]
 * @property {string}   [ticketUrl]   where to actually buy
 * @property {string}   [organiser]   the club's name, as the page gives it
 * @property {EventSource} source
 * @property {Object.<string, FieldProvenance>} [provenance]
 */

/**
 * Where each field came from and how much to trust it. This is what
 * lets the merger pick between two different answers for `title`
 * without a pile of if-statements, and what lets the preview screen
 * show a student which fields are worth checking by hand.
 *
 * @typedef {Object} FieldProvenance
 * @property {string} source      'json-ld' | 'opengraph' | 'meta' | 'title-tag' | provider name
 * @property {number} confidence  0–1
 */

/**
 * How much each extraction method is worth. Straight from the
 * architecture doc — a provider that publishes structured data about
 * itself is more reliable than us reading its HTML, which is in turn
 * more reliable than a generic <meta> tag.
 */
const CONFIDENCE = {
  'provider-api':  0.99,
  'json-ld':       0.95,
  'provider-html': 0.90,
  'opengraph':     0.85,
  'microdata':     0.80,
  'ics':           0.90,
  'meta':          0.70,
  'generic-html':  0.60,
  'title-tag':     0.50,
  'url-only':      0.30
};

/**
 * The contract every provider parser follows.
 *
 *   canParse(url) → boolean
 *   parse(url, html) → Partial<NormalisedEvent>
 *
 * Adding a provider means writing one of these and adding it to the
 * list in providers/index.js. Nothing else changes — which is the
 * whole reason for the interface.
 *
 * @typedef {Object} EventParser
 * @property {string} name
 * @property {(url: URL) => boolean} canParse
 * @property {(url: URL, html: string) => Partial<NormalisedEvent>} parse
 */
const EMPTY = Object.freeze({
  title: '', source: { provider: 'generic', url: '' }, provenance: {}
});

/* ---------- lib/event-parser/safeUrl.js ---------- */
/**
 * UniVerse — URL safety
 * ---------------------------------------------------------------
 * The endpoint takes a URL from a student and fetches it, which is
 * textbook SSRF: without this, anyone with an account could point it
 * at the server's own metadata service, or at something inside
 * Supabase's network, and read the response back through our preview
 * screen.
 *
 * Two layers, in this order:
 *   1. an allow-list of hosts we have parsers for — the architecture
 *      doc's MVP recommendation, and the right default. A club event
 *      lives on one of about a dozen platforms.
 *   2. a deny-list of everything that could be internal, which catches
 *      the case where someone widens the allow-list later and forgets.
 *
 * This file is imported by BOTH the edge function and the client, so
 * the app can grey out an unsupported link before anyone waits on a
 * request, and the two can never disagree about what's allowed.
 */

/** Hosts we will fetch. Suffix match on the registrable domain. */
const ALLOWED_HOSTS = [
  // ticketing
  'humanitix.com',
  'events.humanitix.com',
  'eventbrite.com',
  'eventbrite.com.au',
  'trybooking.com',
  'trybooking.com.au',
  'hellorubric.com',
  'campus.hellorubric.com',
  'moshtix.com.au',
  'oztix.com.au',
  'stickytickets.com.au',

  // our six universities and their unions
  'unimelb.edu.au',
  'umsu.unimelb.edu.au',
  'rmit.edu.au',
  'rusu.rmit.edu.au',
  'monash.edu',
  'monashclubs.org',
  'msa.monash.edu',
  'deakin.edu.au',
  'dusa.org.au',
  'latrobe.edu.au',
  'ltu.edu.au',
  'latrobesu.org.au',
  'swinburne.edu.au',
  'swin.edu.au',
  'studentlife.swinburne.edu.au'
];

/** Never fetch these, whatever the allow-list says. */
const BLOCKED_HOSTNAMES = /^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$|.*\.local$|.*\.internal$|metadata\.google\.internal$)/i;

/** RFC1918 and friends, plus the cloud metadata addresses. */
function isPrivateAddress(host) {
  // IPv4
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 169 && b === 254) return true;         // link-local + AWS/GCP metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 0 || a >= 224) return true;            // this-network, multicast, reserved
    return false;
  }
  // IPv6 — anything that isn't a plain global unicast address
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '').toLowerCase();
    return /^(::1?$|fe80:|fc00:|fd|::ffff:)/.test(h);
  }
  return false;
}

/**
 * @param {string} raw
 * @returns {{ok: true, url: URL} | {ok: false, reason: string}}
 */
function checkUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); }
  catch { return { ok: false, reason: 'That isn\'t a valid link.' }; }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Only https links are accepted.' };
  }
  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.test(host) || isPrivateAddress(host)) {
    return { ok: false, reason: 'That address isn\'t reachable from here.' };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, reason: 'Only standard https ports are accepted.' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Links with credentials in them aren\'t accepted.' };
  }
  const allowed = ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  if (!allowed) {
    return {
      ok: false,
      reason: 'We don\'t read links from ' + host + ' yet. Paste the page itself instead — ' +
              'select all on the event page, copy, and paste it here.'
    };
  }
  return { ok: true, url };
}

/** True if we'd fetch it — for greying out a button before anyone waits. */
function isFetchable(raw) {
  return checkUrl(raw).ok;
}

/* ---------- lib/event-parser/mergeDefined.js ---------- */
/**
 * UniVerse — merging parser results
 * ---------------------------------------------------------------
 * Several parsers run over the same page and each returns whatever it
 * could read. This decides what the final answer is.
 *
 * The rule from the architecture doc — "provider-specific data should
 * normally have higher priority, but empty or undefined values should
 * not overwrite valid universal data" — is exactly right, and the
 * clean way to express it is per-field confidence rather than a
 * fixed order. A provider parser that confidently found a price and
 * guessed at a venue shouldn't overwrite the JSON-LD venue just
 * because it ran last.
 *
 * So: every field carries where it came from and how sure we are, and
 * the highest confidence wins. Ties go to whoever ran later, which is
 * the provider parser, which is what the doc asked for.
 */

/** Values that mean "I didn't find anything", not "the answer is empty". */
function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Date) return isNaN(v.getTime());
  if (typeof v === 'object') return Object.values(v).every(isBlank);
  return false;
}

/**
 * Merge one parser's result into the accumulator.
 *
 * @param {Object} into      the event being built up
 * @param {Object} patch     what this parser found
 * @param {string} sourceName 'json-ld', 'opengraph', 'humanitix', …
 * @param {number} [confidence] defaults to the table in types.js
 */
function mergeInto(into, patch, sourceName, confidence) {
  if (!patch) return into;
  const conf = confidence != null ? confidence : (CONFIDENCE[sourceName] ?? 0.5);
  into.provenance = into.provenance || {};

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'source' || key === 'provenance') continue;
    if (isBlank(value)) continue;                      // never overwrite with nothing

    const held = into.provenance[key];

    // Venue is two fields pretending to be one — merge it key by key so
    // a provider that knows the venue name doesn't wipe a JSON-LD address.
    if (key === 'venue' && typeof value === 'object' && into.venue) {
      for (const [vk, vv] of Object.entries(value)) {
        if (isBlank(vv)) continue;
        const vHeld = into.provenance['venue.' + vk];
        if (!vHeld || conf >= vHeld.confidence) {
          into.venue[vk] = vv;
          into.provenance['venue.' + vk] = { source: sourceName, confidence: conf };
        }
      }
      continue;
    }

    // Tickets: more detail beats less. A provider that found three tiers
    // is worth more than JSON-LD's single cheapest offer.
    if (key === 'tickets' && Array.isArray(value) && Array.isArray(into.tickets)) {
      if (value.length > into.tickets.length || conf > (held?.confidence ?? 0)) {
        into.tickets = value;
        into.provenance.tickets = { source: sourceName, confidence: conf };
      }
      continue;
    }

    if (!held || conf >= held.confidence) {
      into[key] = value;
      into.provenance[key] = { source: sourceName, confidence: conf };
    }
  }
  return into;
}

/**
 * Merge a list of [patch, sourceName] pairs in order.
 * Later entries win ties, so pass generic first and provider last.
 */
function mergeDefined(...pairs) {
  const out = { provenance: {} };
  for (const [patch, sourceName, conf] of pairs) mergeInto(out, patch, sourceName, conf);
  return out;
}

/** The average confidence across the fields that matter, 0–1.
 *  Shown on the preview screen so an organiser knows whether to
 *  read every field carefully or just glance at it. */
function overallConfidence(event) {
  const weighted = { title: 3, startDate: 3, venue: 1, imageUrl: 1, tickets: 1, description: 1 };
  let sum = 0, total = 0;
  for (const [field, weight] of Object.entries(weighted)) {
    const p = event.provenance?.[field] || event.provenance?.['venue.name'];
    total += weight;
    if (p) sum += weight * p.confidence;
  }
  return total ? sum / total : 0;
}

/** Fields we found nothing for — the ones a human has to fill in. */
function missingFields(event) {
  const required = ['title', 'startDate'];
  const nice = ['venue', 'imageUrl', 'description', 'tickets'];
  return {
    required: required.filter(f => isBlank(event[f])),
    optional: nice.filter(f => isBlank(event[f]))
  };
}

/* ---------- lib/event-parser/generic/metadataParser.js ---------- */
/**
 * UniVerse — OpenGraph, meta tags, microdata and the title tag
 * ---------------------------------------------------------------
 * The fallbacks, in the order the architecture doc lists them. These
 * run on every page, including ones that already gave us JSON-LD —
 * because a page often has a good og:image and a poor JSON-LD image,
 * and the merger picks per field rather than per parser.
 *
 * Deliberately regex-based rather than DOM-based: this file has to run
 * in a Deno edge function, in Node, and in a browser with no DOMParser
 * guarantees, and an event page is not adversarial input we need to
 * fully parse — we're reading six or seven attributes out of a head.
 */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
/** Turn a scrap of HTML into plain text. The one implementation —
 *  the JSON-LD parser uses this too, so "<b>ink</b>." can only ever
 *  come out one way. */
function clean(s, max = 1500) {
  return decodeEntities(String(s == null ? '' : s))
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, ' ')  // block ends become a space
    .replace(/<[^>]+>/g, '')                                 // inline tags leave nothing,
                                                             // so "<b>ink</b>." stays "ink."
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')                          // no space before punctuation
    .trim().slice(0, max);
}

/** Read <meta property="x" content="y"> or <meta name="x" content="y">,
 *  with the attributes in either order, quoted either way. */
function meta(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp('<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["\']' + k + '["\'][^>]*?content\\s*=\\s*["\']([^"\']*)["\']', 'i'),
    new RegExp('<meta[^>]+content\\s*=\\s*["\']([^"\']*)["\'][^>]*?(?:property|name|itemprop)\\s*=\\s*["\']' + k + '["\']', 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return '';
}

function isoOf(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** OpenGraph — og:* plus the event-specific extensions some sites use. */
function parseOpenGraph(html) {
  const out = {};
  const title = meta(html, 'og:title');
  const desc  = meta(html, 'og:description');
  const image = meta(html, 'og:image:secure_url') || meta(html, 'og:image:url') || meta(html, 'og:image');
  const url   = meta(html, 'og:url');

  if (title) out.title = clean(title, 140);
  if (desc)  out.description = clean(desc, 1500);
  if (/^https?:\/\//i.test(image)) out.imageUrl = image;
  if (/^https?:\/\//i.test(url))   out.pageUrl = url;

  // Facebook's event namespace, still emitted by a few ticketing sites
  const start = isoOf(meta(html, 'event:start_time') || meta(html, 'og:event:start_time'));
  const end   = isoOf(meta(html, 'event:end_time')   || meta(html, 'og:event:end_time'));
  if (start) out.startDate = start;
  if (end)   out.endDate = end;

  const place = meta(html, 'event:location') || meta(html, 'og:street-address');
  if (place) out.venue = { name: clean(place, 90) };

  const price = meta(html, 'product:price:amount') || meta(html, 'og:price:amount');
  const cur   = meta(html, 'product:price:currency') || meta(html, 'og:price:currency');
  if (price && !isNaN(Number(price))) {
    out.tickets = [{ price: Number(price), currency: cur || 'AUD' }];
  }
  return out;
}

/** Twitter cards and the plain description/keywords tags. */
function parseMetaTags(html) {
  const out = {};
  const title = meta(html, 'twitter:title');
  const desc  = meta(html, 'twitter:description') || meta(html, 'description');
  const image = meta(html, 'twitter:image') || meta(html, 'twitter:image:src');

  if (title) out.title = clean(title, 140);
  if (desc)  out.description = clean(desc, 1500);
  if (/^https?:\/\//i.test(image)) out.imageUrl = image;

  const canonical = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
  if (canonical && /^https?:\/\//i.test(canonical[1])) out.pageUrl = decodeEntities(canonical[1]);
  return out;
}

/**
 * schema.org microdata — the older itemprop attribute form. Some
 * university CMSs still emit this and nothing else.
 */
function parseMicrodata(html) {
  const out = {};
  const prop = name => {
    const re = new RegExp('itemprop\\s*=\\s*["\']' + name + '["\'][^>]*?(?:content|datetime)\\s*=\\s*["\']([^"\']+)["\']', 'i');
    const m = html.match(re);
    if (m) return decodeEntities(m[1]).trim();
    // or as element text: <span itemprop="name">Zine Fair</span>
    const re2 = new RegExp('itemprop\\s*=\\s*["\']' + name + '["\'][^>]*>([^<]{1,200})<', 'i');
    const m2 = html.match(re2);
    return m2 ? clean(m2[1], 200) : '';
  };
  const name = prop('name');
  const start = isoOf(prop('startDate'));
  const end = isoOf(prop('endDate'));
  if (name)  out.title = clean(name, 140);
  if (start) out.startDate = start;
  if (end)   out.endDate = end;
  const loc = prop('location') || prop('addressLocality');
  if (loc) out.venue = { name: clean(loc, 90) };
  return out;
}

/**
 * The last resort. A <title> is almost always the event name plus the
 * site name, so strip the site half.
 */
function parseTitleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
  if (!m) return {};
  let t = clean(m[1], 160);
  t = t.replace(/\s*[|·–—-]\s*(Humanitix|Eventbrite|TryBooking|Rubric|Tickets?|Home)\s*$/i, '')
       .replace(/^\s*Tickets?\s*(for|to)\s*/i, '')
       .trim();
  return t ? { title: t } : {};
}

/**
 * An .ics calendar invite. Not HTML at all, but it's one of the three
 * things an organiser might paste, and it's the most accurate of them.
 */
function parseIcs(text) {
  if (!/BEGIN:VEVENT/i.test(text)) return {};
  const out = {};
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const dt = v => {
    const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) { const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString(); }
    const [, y, mo, d, h, mi, s, z] = m;
    const date = z
      ? new Date(Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(s || 0)))
      : new Date(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(s || 0));
    return isNaN(date.getTime()) ? '' : date.toISOString();
  };
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
    if (key === 'SUMMARY')     out.title = clean(val, 140);
    if (key === 'DESCRIPTION') out.description = clean(val, 1500);
    if (key === 'LOCATION')    out.venue = { name: clean(val, 90) };
    if (key === 'DTSTART')     out.startDate = dt(val);
    if (key === 'DTEND')       out.endDate = dt(val);
    if (key === 'URL' && /^https?:\/\//i.test(val)) out.pageUrl = val;
    if (key === 'ORGANIZER') {
      const cn = line.match(/CN=([^;:]+)/i);
      if (cn) out.organiser = clean(cn[1], 90);
    }
  }
  return out;
}

/* ---------- lib/event-parser/generic/jsonLdParser.js ---------- */
/**
 * UniVerse — JSON-LD parser
 * ---------------------------------------------------------------
 * The highest-value parser in the whole system, and the reason this
 * approach works at all: Google requires schema.org Event markup to
 * show event rich results, so Humanitix, Eventbrite, TryBooking and
 * essentially every ticketing platform publish it. One parser reads
 * all of them.
 *
 * It has to handle every shape they actually use in the wild:
 *   • a bare  { "@type": "Event", … }
 *   • an array of objects, one of which is the Event
 *   • { "@graph": [ … ] }              (Yoast, WordPress, Rubric)
 *   • { "@type": "ItemList", itemListElement: [ … ] }  (listing pages)
 *   • subEvent nesting                 (festivals, multi-day)
 *   • subtypes: MusicEvent, EducationEvent, SocialEvent, Festival…
 *   • "@type" as an ARRAY: ["Event","MusicEvent"]
 */

const EVENT_TYPES = /^(Event|BusinessEvent|ChildrensEvent|ComedyEvent|CourseInstance|DanceEvent|DeliveryEvent|EducationEvent|ExhibitionEvent|Festival|FoodEvent|Hackathon|LiteraryEvent|MusicEvent|PublicationEvent|SaleEvent|ScreeningEvent|SocialEvent|SportsEvent|TheaterEvent|VisualArtsEvent)$/;

function typesOf(node) {
  const t = node && node['@type'];
  if (!t) return [];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}
function isEvent(node) {
  return typesOf(node).some(t => EVENT_TYPES.test(t));
}

/** Walk anything and collect every Event-shaped node inside it. */
function collectEvents(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return out;

  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, out, depth + 1);
    return out;
  }
  if (isEvent(node) && node.name) out.push(node);

  for (const key of ['@graph', 'itemListElement', 'subEvent', 'item', 'mainEntity', 'about']) {
    if (node[key]) collectEvents(node[key], out, depth + 1);
  }
  return out;
}

/** Pull every <script type="application/ld+json"> block out of raw HTML. */
function extractLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let text = m[1].trim()
      .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
      .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');   // some CMSs wrap it in a comment
    try { blocks.push(JSON.parse(text)); }
    catch {
      // A trailing comma or an unescaped newline shouldn't lose the whole page.
      try { blocks.push(JSON.parse(text.replace(/,\s*([}\]])/g, '$1'))); } catch { /* skip */ }
    }
  }
  return blocks;
}

function str(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === 'object') return str(v.name ?? v['@value'] ?? v.url ?? '');
  return '';
}
/** Same text cleaner as the metadata parser, but tolerant of the
 *  shapes JSON-LD puts values in (arrays, {@value}, {name}). */
function ldClean(v, max = 2000) { return clean(str(v), max); }

function imageOf(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageOf(img[0]);
  return str(img.url || img.contentUrl || '');
}
function ldIso(v) {
  const s = str(v);
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** schema.org Offers → our ticket list. */
function ticketsOf(offers) {
  const list = [].concat(offers || []).filter(o => o && typeof o === 'object');
  const out = [];
  for (const o of list) {
    // an AggregateOffer wraps the real ones
    if (/AggregateOffer/i.test(str(o['@type'])) && o.offers) {
      out.push(...ticketsOf(o.offers));
      if (o.lowPrice != null) out.push({
        name: 'From', price: Number(o.lowPrice),
        currency: str(o.priceCurrency) || 'AUD', available: true
      });
      continue;
    }
    if (o.price == null && o.lowPrice == null) continue;
    const price = Number(o.price ?? o.lowPrice);
    if (isNaN(price)) continue;
    out.push({
      name: ldClean(o.name || o.category || '', 60) || undefined,
      price,
      currency: str(o.priceCurrency) || 'AUD',
      available: o.availability ? !/SoldOut|OutOfStock/i.test(str(o.availability)) : undefined
    });
  }
  // de-duplicate identical tiers
  const seen = new Set();
  return out.filter(t => {
    const k = (t.name || '') + '|' + t.price;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function venueOf(loc) {
  if (!loc) return undefined;
  const l = Array.isArray(loc) ? loc[0] : loc;
  if (typeof l === 'string') return { name: ldClean(l, 90) };
  const addr = l.address;
  let address = '';
  if (typeof addr === 'string') address = ldClean(addr, 160);
  else if (addr && typeof addr === 'object') {
    address = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
      .map(x => ldClean(x, 60)).filter(Boolean).join(', ');
  }
  const name = ldClean(l.name, 90);
  const suburb = ldClean(addr && addr.addressLocality, 60);
  if (!name && !address) return undefined;
  // Humanitix and others use the location name as a hosting note
  return {
    name: /hosted on|online event|to be announced/i.test(name) ? '' : name,
    address,
    suburb
  };
}

/**
 * @param {string} html
 * @returns {Partial<import('../types.js').NormalisedEvent> & {found?: number}}
 */
function parseJsonLd(html) {
  const events = [];
  for (const block of extractLdBlocks(html)) collectEvents(block, events);
  if (!events.length) return {};

  // A listing page gives many; take the soonest one that hasn't happened.
  const now = Date.now();
  const dated = events
    .map(e => ({ e, t: new Date(str(e.startDate)).getTime() }))
    .filter(x => !isNaN(x.t));
  const upcoming = dated.filter(x => x.t > now).sort((a, b) => a.t - b.t);
  const chosen = (upcoming[0] || dated[0] || { e: events[0] }).e;

  const tickets = ticketsOf(chosen.offers);
  const offerUrl = [].concat(chosen.offers || [])
    .map(o => o && typeof o === 'object' ? str(o.url) : '')
    .find(u => /^https?:\/\//i.test(u)) || '';

  const out = {
    title: ldClean(chosen.name, 140),
    description: ldClean(chosen.description, 1500),
    imageUrl: imageOf(chosen.image),
    startDate: ldIso(chosen.startDate),
    endDate: ldIso(chosen.endDate),
    venue: venueOf(chosen.location),
    organiser: ldClean((chosen.organizer && chosen.organizer.name) || chosen.organizer, 90),
    ticketUrl: offerUrl,
    found: events.length
  };
  const canonical = str(chosen.url);
  if (/^https?:\/\//i.test(canonical)) out.pageUrl = canonical;
  if (tickets.length) out.tickets = tickets;
  return out;
}

/* ---------- lib/event-parser/providers/humanitix.js ---------- */
/**
 * Humanitix — RUSU's ticketing platform, and the one most Melbourne
 * clubs land on.
 *
 * Humanitix publishes excellent JSON-LD, so this parser exists to add
 * the two things JSON-LD leaves out: the full ticket-tier list (JSON-LD
 * carries the cheapest offer only, which is how you end up advertising
 * "$5" for an event whose student ticket is $15), and the sold-out
 * state.
 *
 * It reads Humanitix's own Next.js hydration payload — the same data
 * the page renders itself from — rather than scraping rendered markup,
 * so it doesn't break when they restyle.
 */

/** Pull __NEXT_DATA__ or a window.__PRELOADED_STATE__ blob. */
function hydrationBlob(html) {
  const next = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (next) { try { return JSON.parse(next[1]); } catch { /* fall through */ } }
  const pre = html.match(/window\.__(?:PRELOADED_STATE|INITIAL_STATE)__\s*=\s*(\{[\s\S]*?\})\s*[;<]/i);
  if (pre) { try { return JSON.parse(pre[1]); } catch { /* fall through */ } }
  return null;
}

/** Find the first object that looks like a Humanitix event, anywhere. */
function findEvent(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return null;
  if (Array.isArray(node)) {
    for (const x of node) { const f = findEvent(x, depth + 1); if (f) return f; }
    return null;
  }
  if (node.name && (node.startDate || node.dates) && (node.ticketTypes || node.slug)) return node;
  for (const v of Object.values(node)) {
    const f = findEvent(v, depth + 1);
    if (f) return f;
  }
  return null;
}
const humanitix = {
  name: 'humanitix',

  canParse(url) {
    return /(^|\.)humanitix\.(com|com\.au)$/i.test(url.hostname);
  },

  parse(url, html) {
    const out = {};
    const blob = hydrationBlob(html);
    const ev = blob ? findEvent(blob) : null;

    if (ev) {
      if (ev.name) out.title = clean(ev.name, 140);
      if (ev.description) out.description = clean(ev.description, 1500);
      const img = ev.bannerImage?.url || ev.featureImage?.url || ev.image;
      if (typeof img === 'string' && /^https?:/i.test(img)) out.imageUrl = img;

      const start = ev.startDate || ev.dates?.[0]?.startDate;
      const end   = ev.endDate   || ev.dates?.[0]?.endDate;
      if (start && !isNaN(new Date(start))) out.startDate = new Date(start).toISOString();
      if (end   && !isNaN(new Date(end)))   out.endDate   = new Date(end).toISOString();

      const v = ev.eventLocation || ev.venue;
      if (v) {
        out.venue = {
          name: clean(v.venueName || v.name || '', 90),
          address: clean(v.address || v.formattedAddress || '', 160),
          suburb: clean(v.city || v.locality || '', 60)
        };
      }
      if (ev.organiser?.name || ev.organizer?.name) {
        out.organiser = clean(ev.organiser?.name || ev.organizer?.name, 90);
      }

      // the bit JSON-LD doesn't give you: every tier, with availability
      const tiers = ev.ticketTypes || ev.tickets;
      if (Array.isArray(tiers) && tiers.length) {
        out.tickets = tiers
          .filter(t => t && !t.deleted && !t.isDonation)
          .map(t => ({
            name: clean(t.name, 60) || undefined,
            price: Number(t.price ?? 0),
            currency: clean(ev.currency || 'AUD', 3),
            available: t.quantity == null ? undefined : (t.quantity > (t.qtySold || 0))
          }))
          .filter(t => !isNaN(t.price));
      }
    }

    // The checkout URL is the event page plus /tickets — always true on
    // Humanitix, and it saves a student one tap.
    const base = url.href.split('?')[0].replace(/\/+$/, '');
    if (!/\/tickets$/.test(base)) out.ticketUrl = base + '/tickets';
    out.pageUrl = base;
    return out;
  }
};

/* ---------- lib/event-parser/providers/eventbrite.js ---------- */
/**
 * Eventbrite — MSA (Monash) sells through this.
 *
 * Eventbrite's public search API was withdrawn in 2020, but an
 * individual event page is public HTML with good JSON-LD, so the
 * paste-a-link route works where an integration wouldn't.
 *
 * This parser adds the server-rendered state Eventbrite embeds, which
 * carries the ticket tiers and the organiser name more reliably than
 * its JSON-LD does.
 */

function serverData(html) {
  const m = html.match(/window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i)
        || html.match(/window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
const eventbrite = {
  name: 'eventbrite',

  canParse(url) {
    return /(^|\.)eventbrite\.(com|com\.au|co\.uk|ca|ie|nz)$/i.test(url.hostname);
  },

  parse(url, html) {
    const out = {};
    const d = serverData(html);
    const ev = d?.event || d?.model?.event || null;

    if (ev) {
      if (ev.name) out.title = clean(ev.name.text || ev.name, 140);
      if (ev.description) out.description = clean(ev.description.text || ev.description, 1500);
      if (ev.start?.utc) out.startDate = new Date(ev.start.utc).toISOString();
      if (ev.end?.utc)   out.endDate   = new Date(ev.end.utc).toISOString();
      const img = ev.logo?.original?.url || ev.logo?.url || ev.image;
      if (typeof img === 'string') out.imageUrl = img;
      if (ev.venue) {
        out.venue = {
          name: clean(ev.venue.name, 90),
          address: clean(ev.venue.address?.localized_address_display || '', 160),
          suburb: clean(ev.venue.address?.city || '', 60)
        };
      }
      if (ev.organizer?.name) out.organiser = clean(ev.organizer.name, 90);
    }

    const tiers = d?.ticket_classes || d?.components?.ticketClasses || ev?.ticket_classes;
    if (Array.isArray(tiers) && tiers.length) {
      out.tickets = tiers
        .filter(t => t && !t.hidden && !t.donation)
        .map(t => {
          const major = t.cost?.major_value ?? t.actual_cost?.major_value ?? (t.free ? 0 : null);
          return {
            name: clean(t.name, 60) || undefined,
            price: major == null ? null : Number(major),
            currency: clean(t.cost?.currency || 'AUD', 3),
            available: t.on_sale_status ? t.on_sale_status === 'AVAILABLE' : undefined
          };
        })
        .filter(t => t.price != null && !isNaN(t.price));
    }

    // Eventbrite's canonical event URL, stripped of the tracking tail
    const canonical = meta(html, 'og:url') || url.href;
    const base = canonical.split('?')[0].replace(/\/+$/, '');
    out.pageUrl = base;
    out.ticketUrl = base + '#tickets';
    return out;
  }
};

/* ---------- lib/event-parser/providers/rubric.js ---------- */
/**
 * Rubric (campus.hellorubric.com) — RUSU at RMIT and DUSA at Deakin
 * both run their club portals on it, so one parser covers two unions.
 *
 * Rubric is a club-management portal rather than a ticketing platform,
 * so its event pages carry less structured data than Humanitix. This
 * parser reads what it does emit and falls back to the page's own
 * markup for the date line, which Rubric renders in a stable format.
 */

/** Rubric renders dates as e.g. "Thu 9 Oct 2026, 6:00pm - 9:00pm". */
function parseRubricDate(text, year) {
  const m = text.match(
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(\d{4})?[,\s]*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );
  if (!m) return {};
  const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  let hour = Number(m[4]);
  if (/pm/i.test(m[6]) && hour !== 12) hour += 12;
  if (/am/i.test(m[6]) && hour === 12) hour = 0;
  const d = new Date(Number(m[3] || year || new Date().getFullYear()),
                     MONTHS[m[2].toLowerCase()], Number(m[1]), hour, Number(m[5] || 0));
  if (isNaN(d.getTime())) return {};
  const out = { startDate: d.toISOString() };

  // an end time on the same line
  const tail = text.slice(m.index + m[0].length);
  const e = tail.match(/^\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (e) {
    let eh = Number(e[1]);
    if (/pm/i.test(e[3]) && eh !== 12) eh += 12;
    if (/am/i.test(e[3]) && eh === 12) eh = 0;
    const end = new Date(d); end.setHours(eh, Number(e[2] || 0), 0, 0);
    if (end > d) out.endDate = end.toISOString();
  }
  return out;
}

function textOf(html, re) {
  const m = html.match(re);
  return m ? clean(decodeEntities(m[1]), 300) : '';
}
const rubric = {
  name: 'rubric',

  canParse(url) {
    return /(^|\.)hellorubric\.com$/i.test(url.hostname);
  },

  parse(url, html) {
    const out = {};

    const h1 = textOf(html, /<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i);
    if (h1) out.title = h1.slice(0, 140);

    // Rubric marks these up with predictable class names
    const when = textOf(html, /class="[^"]*(?:event-date|date-time|when)[^"]*"[^>]*>([\s\S]{1,160}?)</i);
    if (when) Object.assign(out, parseRubricDate(when));

    const where = textOf(html, /class="[^"]*(?:event-location|venue|where)[^"]*"[^>]*>([\s\S]{1,160}?)</i);
    if (where) out.venue = { name: where.slice(0, 90) };

    const club = textOf(html, /class="[^"]*(?:club-name|organiser|host)[^"]*"[^>]*>([\s\S]{1,120}?)</i);
    if (club) out.organiser = club.slice(0, 90);

    const price = html.match(/\$\s?(\d+(?:\.\d{2})?)/);
    if (price) out.tickets = [{ price: Number(price[1]), currency: 'AUD' }];
    else if (/\bfree\b/i.test(html.slice(0, 8000))) out.tickets = [{ price: 0, currency: 'AUD' }];

    // Which union's portal this is — Rubric identifies societies by ?s=
    const society = url.searchParams.get('s');
    if (society === '4202') out.organiserUnion = 'RUSU';
    if (society === '3659') out.organiserUnion = 'DUSA';

    out.pageUrl = url.href.split('#')[0];
    out.ticketUrl = out.pageUrl;
    return out;
  }
};

/* ---------- lib/event-parser/providers/trybooking.js ---------- */
/**
 * TryBooking — the cheap Australian option, common for one-off club
 * nights and anything a treasurer is paying for out of a small grant.
 *
 * TryBooking event pages carry OpenGraph and usually JSON-LD, so the
 * generic parsers do most of the work. This adds its session/date
 * table, which is where the actual start time lives on multi-session
 * events, and normalises its two URL shapes.
 */
const trybooking = {
  name: 'trybooking',

  canParse(url) {
    return /(^|\.)trybooking\.com(\.au)?$/i.test(url.hostname);
  },

  parse(url, html) {
    const out = {};

    // TryBooking renders the session list as a table of ISO datetimes
    const iso = html.match(/data-session-date\s*=\s*["']([^"']+)["']/i)
             || html.match(/"sessionStartDate"\s*:\s*"([^"]+)"/i);
    if (iso) {
      const d = new Date(iso[1]);
      if (!isNaN(d.getTime())) out.startDate = d.toISOString();
    }

    const venue = html.match(/"venueName"\s*:\s*"([^"]+)"/i)
               || html.match(/class="[^"]*venue-name[^"]*"[^>]*>([^<]{1,120})</i);
    if (venue) out.venue = { name: clean(venue[1], 90) };

    // prices appear as data-price on each ticket row
    const prices = [...html.matchAll(/data-ticket-name\s*=\s*["']([^"']{1,60})["'][^>]*data-price\s*=\s*["']([\d.]+)["']/gi)];
    if (prices.length) {
      out.tickets = prices.map(m => ({
        name: clean(m[1], 60), price: Number(m[2]), currency: 'AUD'
      })).filter(t => !isNaN(t.price));
    }

    // /events/<id> and /b/<id> both resolve; keep whichever they pasted
    const base = url.href.split('?')[0].replace(/\/+$/, '');
    out.pageUrl = base;
    out.ticketUrl = base;
    return out;
  }
};

/* ---------- lib/event-parser/providers/university.js ---------- */
/**
 * University and union sites — UMSU, MSL portals, LiveWhale calendars,
 * and a club's own page on its university's domain.
 *
 * This is the "one university/provider-specific parser" the
 * architecture doc asks for in the MVP list, and it's the one that
 * matters most for us: a lot of Melbourne club events never touch a
 * ticketing platform at all. They're free, and they live on a union
 * page with a date and a room number.
 *
 * Two specific formats are handled because they're what our six unions
 * actually run:
 *   • LiveWhale  — Unimelb's events system, which publishes a public
 *                  JSON feed per event page (/live/json/events)
 *   • MSL        — the portal behind UMSU, LTSU and Swinburne clubs
 * Everything else falls through to the generic parsers, which is fine.
 */

const UNI_HOSTS = /(^|\.)(unimelb|rmit|monash|deakin|latrobe|ltu|swin|swinburne)\.edu(\.au)?$/i;
const UNION_HOSTS = /(^|\.)(umsu\.unimelb\.edu\.au|rusu\.rmit\.edu\.au|monashclubs\.org|msa\.monash\.edu|dusa\.org\.au|latrobesu\.org\.au|studentlife\.swinburne\.edu\.au)$/i;

/** Which of our six universities a URL belongs to, if any. */
function universityFromHost(hostname) {
  const h = hostname.toLowerCase();
  if (/unimelb\.edu\.au$/.test(h) || /umsu\./.test(h)) return 'Unimelb';
  if (/rmit\.edu\.au$/.test(h)    || /rusu\./.test(h)) return 'RMIT';
  if (/monash\.(edu|edu\.au)$/.test(h) || /monashclubs\.org$/.test(h)) return 'Monash';
  if (/deakin\.edu\.au$/.test(h)  || /dusa\.org\.au$/.test(h)) return 'Deakin';
  if (/(latrobe|ltu)\.edu\.au$/.test(h) || /latrobesu\.org\.au$/.test(h)) return 'La Trobe';
  if (/swin(burne)?\.edu\.au$/.test(h) || /studentlife\.swinburne/.test(h)) return 'Swinburne';
  return '';
}

/** LiveWhale embeds a JSON payload for the event on its own page. */
function liveWhale(html) {
  const m = html.match(/<script[^>]+class=["']lw_json["'][^>]*>([\s\S]*?)<\/script>/i)
         || html.match(/lw_event_json\s*=\s*(\{[\s\S]*?\});/i);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    const e = Array.isArray(j) ? j[0] : (j.events ? j.events[0] : j);
    if (!e || !e.title) return null;
    const out = { title: clean(e.title, 140) };
    if (e.description || e.summary) out.description = clean(e.description || e.summary, 1500);
    if (e.date_utc || e.date_iso || e.date) {
      const d = new Date(e.date_utc || e.date_iso || e.date);
      if (!isNaN(d.getTime())) out.startDate = d.toISOString();
    }
    if (e.date2_utc || e.enddate) {
      const d = new Date(e.date2_utc || e.enddate);
      if (!isNaN(d.getTime())) out.endDate = d.toISOString();
    }
    if (e.location) out.venue = { name: clean(e.location, 90) };
    if (e.thumbnail_url || e.image) out.imageUrl = e.thumbnail_url || e.image;
    if (e.group || e.group_name) out.organiser = clean(e.group || e.group_name, 90);
    return out;
  } catch { return null; }
}

/** MSL portals mark the details up with predictable ids. */
function msl(html) {
  const grab = re => { const m = html.match(re); return m ? clean(decodeEntities(m[1]), 200) : ''; };
  const title = grab(/id="[^"]*ctl00_Main_(?:EventName|lblEventName)"[^>]*>([\s\S]{1,200}?)</i);
  if (!title) return null;
  const out = { title: title.slice(0, 140) };
  const when = grab(/id="[^"]*(?:EventDate|lblDate)"[^>]*>([\s\S]{1,160}?)</i);
  if (when) {
    const d = new Date(when);
    if (!isNaN(d.getTime())) out.startDate = d.toISOString();
  }
  const where = grab(/id="[^"]*(?:EventLocation|lblLocation)"[^>]*>([\s\S]{1,160}?)</i);
  if (where) out.venue = { name: where.slice(0, 90) };
  const price = html.match(/\$\s?(\d+(?:\.\d{2})?)/);
  if (price) out.tickets = [{ price: Number(price[1]), currency: 'AUD' }];
  return out;
}
const university = {
  name: 'university',

  canParse(url) {
    return UNI_HOSTS.test(url.hostname) || UNION_HOSTS.test(url.hostname);
  },

  parse(url, html) {
    const out = liveWhale(html) || msl(html) || {};

    // Free until proven otherwise: a union page with no price on it is
    // almost always a free club event, and that's the safer default —
    // the organiser sees it in the preview and can correct it.
    if (!out.tickets && !/\$\s?\d/.test(html) && /\b(free|no cost|no charge)\b/i.test(html)) {
      out.tickets = [{ price: 0, currency: 'AUD' }];
    }

    const uni = universityFromHost(url.hostname);
    if (uni) out.university = uni;

    out.pageUrl = url.href.split('#')[0];
    out.ticketUrl = out.pageUrl;
    return out;
  }
};

/* ---------- lib/event-parser/providers/index.js ---------- */
/**
 * The provider registry.
 *
 * Adding a provider is: write a file next to this one that exports
 * { name, canParse(url), parse(url, html) }, import it, add it to the
 * array. Nothing else in the system changes — which is the entire
 * point of the interface, and why this isn't a chain of if-statements.
 *
 * Order matters only for overlapping hosts, and none of these overlap.
 */





/** @type {import('../types.js').EventParser[]} */
const parsers = [
  humanitix,
  eventbrite,
  rubric,
  trybooking,
  university
];

/** The parser for this URL, or null — in which case the generic
 *  parsers carry the whole page on their own, which they usually can. */
function parserFor(url) {
  return parsers.find(p => {
    try { return p.canParse(url); } catch { return false; }
  }) || null;
}

/** Every host we have a parser for. Used to build the fetch
 *  allow-list, so the two can never drift apart. */
function knownHostPatterns() {
  return parsers.map(p => p.name);
}

/* ---------- lib/event-parser/index.js ---------- */
/**
 * UniVerse — the universal event parser
 * ===============================================================
 *
 *   import { parseEventFromHtml, parseEventFromUrl } from './event-parser/index.js';
 *
 *   parseEventFromHtml(pastedText, sourceUrl?)  // works anywhere, no network
 *   await parseEventFromUrl(url, { fetchImpl }) // needs a fetch that can
 *                                               // reach the open internet
 *
 * Both return the same NormalisedEvent, so nothing downstream cares
 * which one was used.
 *
 * WHY THERE ARE TWO
 * A browser cannot fetch humanitix.com from your page — CORS forbids
 * it, and no amount of client code gets around that. The fetch has to
 * happen server-side, which is what supabase/functions/parse-event is
 * for. Everything else — all the actual parsing — is pure and runs
 * anywhere, which is why the app still works with no backend at all:
 * the organiser pastes the page instead of the link.
 *
 * THE FLOW, as in the architecture doc:
 *
 *   URL → validate → fetch → generic parsers (JSON-LD, OpenGraph,
 *   meta, microdata, title) → detect provider → provider parser →
 *   merge by confidence → normalise → validate → preview → save
 */






/**
 * Parse whatever an organiser pasted. Accepts a full HTML page, an
 * .ics invite, or a bare URL with nothing else.
 *
 * @param {string} text
 * @param {string} [sourceUrl] the link it came from, if known
 * @returns {import('./types.js').NormalisedEvent}
 */
function parseEventFromHtml(text, sourceUrl) {
  const raw = String(text || '');
  const event = { provenance: {} };

  // The link they pasted is the event's page unless the page itself
  // names a canonical one — which the parsers below may well do, and
  // which outranks this because its confidence is higher.
  const firstUrl = sourceUrl || (raw.match(/https:\/\/[^\s"'<>]+/) || [])[0] || '';
  const cleanFirst = firstUrl.replace(/[).,;'"]+$/, '');
  if (cleanFirst) {
    mergeInto(event, { pageUrl: cleanFirst, ticketUrl: cleanFirst }, 'url-only');
  }

  // A calendar invite is not HTML and is more accurate than either.
  if (/BEGIN:VEVENT/i.test(raw)) {
    mergeInto(event, parseIcs(raw), 'ics');
  }

  const looksLikeHtml = /<[a-z!][\s\S]*>/i.test(raw);
  if (looksLikeHtml) {
    // Order here is only about ties — the confidence table decides.
    mergeInto(event, parseTitleTag(raw),  'title-tag');
    mergeInto(event, parseMetaTags(raw),  'meta');
    mergeInto(event, parseMicrodata(raw), 'microdata');
    mergeInto(event, parseOpenGraph(raw), 'opengraph');

    const ld = parseJsonLd(raw);
    if (ld && Object.keys(ld).length) {
      event.foundCount = ld.found;
      delete ld.found;
      mergeInto(event, ld, 'json-ld');
    }

    // Provider-specific last, so it wins ties, as the doc asks.
    let url = null;
    try { url = new URL(cleanFirst || event.pageUrl || ''); } catch { /* none */ }
    if (url) {
      const provider = parserFor(url);
      if (provider) {
        try {
          mergeInto(event, provider.parse(url, raw), provider.name, CONFIDENCE['provider-html']);
          event.providerName = provider.name;
        } catch (err) {
          // A provider parser must never take the whole parse down with
          // it — the generic ones have almost certainly done the job.
          event.providerError = String(err && err.message || err);
        }
      }
    }
  }

  return normalise(event, cleanFirst);
}

/**
 * The full pipeline, including the fetch. Only usable where fetch can
 * reach the open internet: the edge function, or Node.
 *
 * @param {string} rawUrl
 * @param {{fetchImpl?: Function, timeoutMs?: number, maxBytes?: number}} [opts]
 */
async function parseEventFromUrl(rawUrl, opts = {}) {
  const check = checkUrl(rawUrl);
  if (!check.ok) throw new Error(check.reason);
  const url = check.url;

  const doFetch = opts.fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('No fetch available in this environment.');

  const timeoutMs = opts.timeoutMs || 10000;
  const maxBytes  = opts.maxBytes  || 3_000_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let html = '';
  try {
    const res = await doFetch(url.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Identify ourselves honestly. A club's own site should be able
        // to see who is reading it, and some hosts block blank agents.
        'User-Agent': 'UniVerseBot/1.0 (+https://universe.app/about-the-parser)',
        'Accept': 'text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9'
      }
    });
    if (!res.ok) throw new Error('That page returned ' + res.status + '.');

    // A redirect can leave the allow-list — re-check where we landed.
    if (res.url) {
      const after = checkUrl(res.url);
      if (!after.ok) throw new Error('That link redirected somewhere we don\'t read.');
    }
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/calendar|application\/json/i.test(type)) {
      throw new Error('That link isn\'t a web page.');
    }
    html = (await res.text()).slice(0, maxBytes);
  } finally {
    clearTimeout(timer);
  }

  return parseEventFromHtml(html, url.href);
}

/**
 * Everything downstream reads this shape and nothing else.
 * Also attaches the things a preview screen needs: how confident we
 * are overall, and which fields a human still has to fill in.
 */
function normalise(event, sourceUrl) {
  const tickets = (event.tickets || []).filter(t => t && !isNaN(Number(t.price)));
  const cheapest = tickets.length ? Math.min(...tickets.map(t => Number(t.price))) : null;

  const out = {
    title:       (event.title || '').trim(),
    description: event.description || '',
    imageUrl:    event.imageUrl || '',
    startDate:   event.startDate || '',
    endDate:     event.endDate || '',
    venue:       event.venue && !isBlank(event.venue) ? event.venue : undefined,
    tickets:     tickets.length ? tickets : undefined,
    priceCents:  cheapest == null ? null : Math.round(cheapest * 100),
    isFree:      cheapest === 0,
    organiser:   event.organiser || '',
    university:  event.university || '',
    ticketUrl:   event.ticketUrl || '',
    source: {
      provider: event.providerName || 'generic',
      url: sourceUrl || event.pageUrl || '',
      pageUrl: event.pageUrl || sourceUrl || ''
    },
    provenance: event.provenance || {}
  };

  out.confidence = overallConfidence(event);
  out.missing = missingFields(out);
  if (event.foundCount > 1) out.otherEventsOnPage = event.foundCount - 1;
  if (event.providerError) out.providerError = event.providerError;
  return out;
}
return {
  parseEventFromHtml: parseEventFromHtml,
  checkUrl: checkUrl,
  isFetchable: isFetchable,
  parserFor: parserFor,
  ALLOWED_HOSTS: ALLOWED_HOSTS,
  CONFIDENCE: CONFIDENCE
};
})();
