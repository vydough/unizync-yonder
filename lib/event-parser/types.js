/**
 * UniVerse — event parser types
 * ---------------------------------------------------------------
 * Plain JavaScript, because the whole project has no build step —
 * but the shapes are documented as JSDoc so an editor still
 * autocompletes them and a `.d.ts` would be a copy-paste away.
 *
 * The point of NormalisedEvent: every provider returns the SAME
 * object, so nothing downstream — the preview screen, the database
 * writer, the app — ever needs to know whether an event came from
 * Humanitix, Eventbrite, Rubric or a club's own WordPress page.
 */

/**
 * @typedef {Object} Ticket
 * @property {string}  [name]       'Student', 'General admission'
 * @property {number}  [price]      in dollars, not cents — cents is a DB concern
 * @property {string}  [currency]   'AUD'
 * @property {boolean} [available]
 */

/**
 * @typedef {Object} Venue
 * @property {string} [name]
 * @property {string} [address]
 * @property {string} [suburb]
 */

/**
 * @typedef {Object} EventSource
 * @property {string} provider   'humanitix' | 'eventbrite' | … | 'generic'
 * @property {string} url        the page this was read from
 * @property {string} [pageUrl]  the event's own canonical page, if it names one
 */

/**
 * @typedef {Object} NormalisedEvent
 * @property {string}   title
 * @property {string}   [description]
 * @property {string}   [imageUrl]
 * @property {string}   [startDate]   ISO 8601
 * @property {string}   [endDate]     ISO 8601
 * @property {Venue}    [venue]
 * @property {Ticket[]} [tickets]
 * @property {string}   [ticketUrl]   where to actually buy
 * @property {string}   [organiser]   the club's name, as the page gives it
 * @property {EventSource} source
 * @property {Object.<string, FieldProvenance>} [provenance]
 */

/**
 * Where each field came from and how much to trust it. This is what
 * lets the merger pick between two different answers for `title`
 * without a pile of if-statements, and what lets the preview screen
 * show a student which fields are worth checking by hand.
 *
 * @typedef {Object} FieldProvenance
 * @property {string} source      'json-ld' | 'opengraph' | 'meta' | 'title-tag' | provider name
 * @property {number} confidence  0–1
 */

/**
 * How much each extraction method is worth. Straight from the
 * architecture doc — a provider that publishes structured data about
 * itself is more reliable than us reading its HTML, which is in turn
 * more reliable than a generic <meta> tag.
 */
export const CONFIDENCE = {
  'provider-api':  0.99,
  'json-ld':       0.95,
  'provider-html': 0.90,
  'opengraph':     0.85,
  'microdata':     0.80,
  'ics':           0.90,
  'meta':          0.70,
  'generic-html':  0.60,
  'title-tag':     0.50,
  'url-only':      0.30
};

/**
 * The contract every provider parser follows.
 *
 *   canParse(url) → boolean
 *   parse(url, html) → Partial<NormalisedEvent>
 *
 * Adding a provider means writing one of these and adding it to the
 * list in providers/index.js. Nothing else changes — which is the
 * whole reason for the interface.
 *
 * @typedef {Object} EventParser
 * @property {string} name
 * @property {(url: URL) => boolean} canParse
 * @property {(url: URL, html: string) => Partial<NormalisedEvent>} parse
 */

export const EMPTY = Object.freeze({
  title: '', source: { provider: 'generic', url: '' }, provenance: {}
});
