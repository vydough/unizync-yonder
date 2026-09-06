/**
 * UniVerse — does the app's inline parser still match the modules?
 *
 *   node lib/event-parser/inline.test.mjs
 *
 * The app carries a generated copy of the parser so it can be one
 * file with no imports. A generated copy is only safe if something
 * checks it, so this runs the SAME inputs through both and fails if
 * they disagree on anything.
 *
 * Run it after `node tools/build-inline-parser.mjs`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEventFromHtml as viaModules, checkUrl as checkViaModules } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, 'inline.generated.js'), 'utf8');

// Evaluate the generated IIFE exactly as a browser would.
const Inline = new Function(bundle + '\nreturn UniVerseParser;')();

let pass = 0, fail = 0;
const same = (label, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) {
    console.log('         modules: ' + JSON.stringify(a).slice(0, 300));
    console.log('         inline : ' + JSON.stringify(b).slice(0, 300));
  }
};

const ld = o => '<script type="application/ld+json">' + JSON.stringify(o) + '</' + 'script>';

const CASES = [
  ['bare Event', ld({
    '@context': 'https://schema.org', '@type': 'Event', name: 'Zine Fair',
    startDate: '2026-10-02T12:00:00+10:00', endDate: '2026-10-02T16:00:00+10:00',
    description: 'Bring <b>paper</b>.', image: 'https://cdn.example.org/z.jpg',
    location: { '@type': 'Place', name: 'Kaleide', address: { addressLocality: 'Melbourne' } },
    organizer: { name: 'RMIT Link' },
    offers: { '@type': 'Offer', price: '12', priceCurrency: 'AUD' }
  }), 'https://events.humanitix.com/zine-fair'],

  ['@graph', ld({ '@graph': [{ '@type': 'WebSite' }, {
    '@type': 'Event', name: 'Graph Event', startDate: '2026-11-01T18:00:00+11:00' }] }), undefined],

  ['ItemList', ld({ '@type': 'ItemList', itemListElement: [
    { item: { '@type': 'Event', name: 'Later', startDate: '2026-12-01T18:00:00+11:00' } },
    { item: { '@type': 'Event', name: 'Sooner', startDate: '2026-10-05T18:00:00+11:00' } }
  ] }), undefined],

  ['OpenGraph only', `<html><head>
     <title>Trivia | Humanitix</title>
     <meta property="og:title" content="Trivia Night">
     <meta property="og:image" content="https://cdn.example.org/t.jpg">
     <meta property="event:start_time" content="2026-10-09T19:00:00+11:00">
   </head></html>`, 'https://events.humanitix.com/trivia'],

  ['humanitix hydration', `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
     props: { pageProps: { event: {
       name: 'Rooftop Screening', slug: 'rs', startDate: '2026-10-15T19:30:00+11:00',
       eventLocation: { venueName: 'Union Rooftop', city: 'Parkville' },
       ticketTypes: [{ name: 'Student', price: 8, quantity: 10, qtySold: 2 },
                     { name: 'General', price: 15, quantity: 5, qtySold: 5 }]
     } } } })}</script></body></html>`, 'https://events.humanitix.com/rs'],

  ['eventbrite', `<html><body><script>window.__SERVER_DATA__ = ${JSON.stringify({
     event: { name: { text: 'Tech Night' }, start: { utc: '2026-09-22T08:00:00Z' },
              venue: { name: 'Monash', address: { city: 'Clayton' } },
              organizer: { name: 'MSA' } },
     ticket_classes: [{ name: 'Student', cost: { major_value: '10.00', currency: 'AUD' } }]
   })};</script></body></html>`, 'https://www.eventbrite.com.au/e/tech-123'],

  ['rubric', `<html><body><h1>BBQ</h1>
     <div class="event-date">Thu 9 Oct 2026, 12:00pm - 2:00pm</div>
     <div class="event-location">Bowen Street</div></body></html>`,
   'https://campus.hellorubric.com/?s=4202'],

  ['livewhale', `<html><body><script class="lw_json">${JSON.stringify([{
     title: 'Forum', date_utc: '2026-10-20T07:00:00Z', location: 'Old Arts' }])}</script></body></html>`,
   'https://events.unimelb.edu.au/forum'],

  ['ics', `BEGIN:VEVENT
SUMMARY:Life Drawing
LOCATION:Blender Studios
DTSTART:20261008T183000Z
URL:https://umsu.unimelb.edu.au/e/ld
END:VEVENT`, undefined],

  ['bare link', 'https://events.humanitix.com/trivia-2026', undefined],
  ['empty', '', undefined],
  ['garbage', '<html><body>nothing at all</body></html>', undefined],
  ['broken json-ld', '<script type="application/ld+json">{not json</script>', undefined]
];

console.log('\nThe generated copy vs the modules');
for (const [label, html, url] of CASES) {
  same(label, viaModules(html, url), Inline.parseEventFromHtml(html, url));
}

console.log('\nThe URL guard, both ways');
for (const u of [
  'https://events.humanitix.com/x', 'http://events.humanitix.com/x',
  'https://169.254.169.254/x', 'https://evil.example.com/x',
  'https://localhost/x', 'https://campus.hellorubric.com/?s=4202', 'nonsense'
]) {
  const a = checkViaModules(u), b = Inline.checkUrl(u);
  same('checkUrl ' + u.slice(0, 40), { ok: a.ok, reason: a.reason }, { ok: b.ok, reason: b.reason });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log('Run: node tools/build-inline-parser.mjs');
process.exit(fail ? 1 : 0);
