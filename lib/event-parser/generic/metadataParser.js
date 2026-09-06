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
    .replace(/&rsquo;|&lsquo;/g, '’').replace(/&rdquo;|&ldquo;/g, '”')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&eacute;/g, 'é').replace(/&ecirc;/g, 'ê').replace(/&egrave;/g, 'è')
    .replace(/&uuml;/g, 'ü').replace(/&ocirc;/g, 'ô').replace(/&copy;/g, '©')
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
export function parseOpenGraph(html) {
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
export function parseMetaTags(html) {
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
export function parseMicrodata(html) {
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
export function parseTitleTag(html) {
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
export function parseIcs(text) {
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

export { meta, clean, decodeEntities };
