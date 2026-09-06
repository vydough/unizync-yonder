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

import { CONFIDENCE } from './types.js';

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
export function mergeInto(into, patch, sourceName, confidence) {
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
export function mergeDefined(...pairs) {
  const out = { provenance: {} };
  for (const [patch, sourceName, conf] of pairs) mergeInto(out, patch, sourceName, conf);
  return out;
}

/** The average confidence across the fields that matter, 0–1.
 *  Shown on the preview screen so an organiser knows whether to
 *  read every field carefully or just glance at it. */
export function overallConfidence(event) {
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
export function missingFields(event) {
  const required = ['title', 'startDate'];
  const nice = ['venue', 'imageUrl', 'description', 'tickets'];
  return {
    required: required.filter(f => isBlank(event[f])),
    optional: nice.filter(f => isBlank(event[f]))
  };
}

export { isBlank };
