/**
 * UniVerse — merging parser results
 * ---------------------------------------------------------------
 * Several parsers run over the same page and each returns whatever it
 * could read. This decides what the final answer is.
 *
 * Two rules, and that's the whole file:
 *
 *   1. LAST ONE WINS. Parsers run worst-to-best, so the better one
 *      always runs later and simply overwrites:
 *
 *        <title>  →  meta  →  microdata  →  OpenGraph  →  JSON-LD  →  provider
 *
 *   2. A BLANK NEVER OVERWRITES. An empty string, an empty array or a
 *      missing key means "I didn't find anything", not "the answer is
 *      empty" — so it's skipped. This is what lets a page with a good
 *      og:image and an empty JSON-LD image end up with the og:image.
 *
 * Together those give exactly the priority the architecture asks for:
 * provider-specific data wins, but never by replacing something real
 * with nothing.
 *
 * We still record WHICH parser gave us each field — one line, no
 * scoring — because the preview screen showing "venue · not on the
 * page" is what tells an organiser which field to check.
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
 * @param {Object} into       the event being built up
 * @param {Object} patch      what this parser found
 * @param {string} sourceName 'json-ld', 'opengraph', 'humanitix', …
 */
export function mergeInto(into, patch, sourceName) {
  if (!patch) return into;
  into.sources = into.sources || {};

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'source' || key === 'sources') continue;
    if (isBlank(value)) continue;                    // rule 2

    // Venue is two fields pretending to be one, so merge it key by key:
    // a provider that knows the venue name shouldn't wipe a JSON-LD
    // address just because it didn't happen to find one.
    if (key === 'venue' && typeof value === 'object') {
      into.venue = into.venue || {};
      for (const [vk, vv] of Object.entries(value)) {
        if (isBlank(vv)) continue;
        into.venue[vk] = vv;
        into.sources['venue.' + vk] = sourceName;
      }
      continue;
    }

    // Tickets: the longer list wins. JSON-LD carries the cheapest offer
    // only, so a provider parser that found all three tiers should keep
    // them — but a provider that found one shouldn't throw three away.
    if (key === 'tickets' && Array.isArray(value) && Array.isArray(into.tickets)) {
      if (value.length >= into.tickets.length) {
        into.tickets = value;
        into.sources.tickets = sourceName;
      }
      continue;
    }

    into[key] = value;                               // rule 1
    into.sources[key] = sourceName;
  }
  return into;
}

/**
 * Merge a list of [patch, sourceName] pairs in order.
 * Pass the least reliable parser first and the provider last.
 */
export function mergeDefined(...pairs) {
  const out = { sources: {} };
  for (const [patch, sourceName] of pairs) mergeInto(out, patch, sourceName);
  return out;
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
