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

import { clean, decodeEntities } from '../generic/metadataParser.js';

const UNI_HOSTS = /(^|\.)(unimelb|rmit|monash|deakin|latrobe|ltu|swin|swinburne)\.edu(\.au)?$/i;
const UNION_HOSTS = /(^|\.)(umsu\.unimelb\.edu\.au|rusu\.rmit\.edu\.au|monashclubs\.org|msa\.monash\.edu|dusa\.org\.au|latrobesu\.org\.au|studentlife\.swinburne\.edu\.au)$/i;

/** Which of our six universities a URL belongs to, if any. */
export function universityFromHost(hostname) {
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

export const university = {
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
