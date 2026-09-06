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
 * @property {Object.<string, string>} [sources]
 *           which parser gave us each field — 'json-ld', 'opengraph',
 *           'humanitix' … Used by the preview screen to show an
 *           organiser where each answer came from and what's missing.
 */

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
  title: '', source: { provider: 'generic', url: '' }, sources: {}
});
