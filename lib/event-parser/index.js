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

import { CONFIDENCE } from './types.js';
import { mergeInto, overallConfidence, missingFields, isBlank } from './mergeDefined.js';
import { parseJsonLd } from './generic/jsonLdParser.js';
import { parseOpenGraph, parseMetaTags, parseMicrodata, parseTitleTag, parseIcs } from './generic/metadataParser.js';
import { parserFor } from './providers/index.js';
import { checkUrl } from './safeUrl.js';

/**
 * Parse whatever an organiser pasted. Accepts a full HTML page, an
 * .ics invite, or a bare URL with nothing else.
 *
 * @param {string} text
 * @param {string} [sourceUrl] the link it came from, if known
 * @returns {import('./types.js').NormalisedEvent}
 */
export function parseEventFromHtml(text, sourceUrl) {
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
export async function parseEventFromUrl(rawUrl, opts = {}) {
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

export { checkUrl, isBlank };
export { ALLOWED_HOSTS, isFetchable } from './safeUrl.js';
export { CONFIDENCE } from './types.js';
export { parsers, parserFor } from './providers/index.js';
