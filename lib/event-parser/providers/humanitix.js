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

import { clean } from '../generic/metadataParser.js';

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

export const humanitix = {
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
