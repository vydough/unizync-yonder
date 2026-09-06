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

import { clean, meta } from '../generic/metadataParser.js';

function serverData(html) {
  const m = html.match(/window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i)
        || html.match(/window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\})\s*[;\n]/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export const eventbrite = {
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
    out.ticketUrlFallback = base + '#tickets';
    return out;
  }
};
