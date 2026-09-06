/**
 * Rubric (campus.hellorubric.com) — RUSU at RMIT and DUSA at Deakin
 * both run their club portals on it, so one parser covers two unions.
 *
 * Rubric is a club-management portal rather than a ticketing platform,
 * so its event pages carry less structured data than Humanitix. This
 * parser reads what it does emit and falls back to the page's own
 * markup for the date line, which Rubric renders in a stable format.
 */

import { clean, decodeEntities } from '../generic/metadataParser.js';

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

export const rubric = {
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
