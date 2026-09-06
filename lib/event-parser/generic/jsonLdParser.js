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

import { clean } from './metadataParser.js';

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
export function collectEvents(node, out = [], depth = 0) {
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
export function extractLdBlocks(html) {
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
export function parseJsonLd(html) {
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
