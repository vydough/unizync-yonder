/**
 * TryBooking — the cheap Australian option, common for one-off club
 * nights and anything a treasurer is paying for out of a small grant.
 *
 * TryBooking event pages carry OpenGraph and usually JSON-LD, so the
 * generic parsers do most of the work. This adds its session/date
 * table, which is where the actual start time lives on multi-session
 * events, and normalises its two URL shapes.
 */

import { clean } from '../generic/metadataParser.js';

export const trybooking = {
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
    out.ticketUrlFallback = base;
    return out;
  }
};
