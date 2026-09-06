/**
 * The provider registry.
 *
 * Adding a provider is: write a file next to this one that exports
 * { name, canParse(url), parse(url, html) }, import it, add it to the
 * array. Nothing else in the system changes — which is the entire
 * point of the interface, and why this isn't a chain of if-statements.
 *
 * Order matters only for overlapping hosts, and none of these overlap.
 */

import { humanitix }  from './humanitix.js';
import { eventbrite } from './eventbrite.js';
import { rubric }     from './rubric.js';
import { trybooking } from './trybooking.js';
import { university } from './university.js';

/** @type {import('../types.js').EventParser[]} */
export const parsers = [
  humanitix,
  eventbrite,
  rubric,
  trybooking,
  university
];

/** The parser for this URL, or null — in which case the generic
 *  parsers carry the whole page on their own, which they usually can. */
export function parserFor(url) {
  return parsers.find(p => {
    try { return p.canParse(url); } catch { return false; }
  }) || null;
}

/** Every host we have a parser for. Used to build the fetch
 *  allow-list, so the two can never drift apart. */
export function knownHostPatterns() {
  return parsers.map(p => p.name);
}
