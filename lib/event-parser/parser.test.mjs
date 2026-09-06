/**
 * UniVerse — event parser tests
 *
 *   node lib/event-parser/parser.test.mjs
 *
 * No test framework, because the project has no dependencies. Each
 * check prints a line and the process exits non-zero if any fail.
 *
 * The fixtures are cut down but structurally faithful: the JSON-LD
 * shapes, the hydration blobs and the meta tags are the real ones
 * these platforms emit.
 */

import { parseEventFromHtml, checkUrl, isFetchable, ALLOWED_HOSTS } from './index.js';
import { mergeDefined } from './mergeDefined.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}` + (ok ? '' : `\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`));
};
const ok = (label, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : '  ' + detail}`);
};
const section = t => console.log('\n' + t);

const ldScript = obj => '<script type="application/ld+json">' + JSON.stringify(obj) + '</' + 'script>';

/* ============================================================
   1. JSON-LD — every shape these platforms actually emit
   ============================================================ */
section('JSON-LD shapes');

const baseEvent = {
  '@context': 'https://schema.org', '@type': 'Event',
  name: 'Zine Fair + Riso Workshop',
  description: '<p>Bring paper. We bring the <b>ink</b>.</p>',
  startDate: '2026-10-02T12:00:00+10:00',
  endDate: '2026-10-02T16:00:00+10:00',
  image: 'https://cdn.humanitix.com/zine.jpg',
  url: 'https://events.humanitix.com/zine-fair',
  location: { '@type': 'Place', name: 'Kaleide Theatre',
              address: { '@type': 'PostalAddress', streetAddress: '360 Swanston St', addressLocality: 'Melbourne' } },
  organizer: { '@type': 'Organization', name: 'RMIT Link Arts & Culture' },
  offers: { '@type': 'Offer', price: '12.00', priceCurrency: 'AUD',
            url: 'https://events.humanitix.com/zine-fair/tickets', availability: 'https://schema.org/InStock' }
};

let r = parseEventFromHtml('<html>' + ldScript(baseEvent) + '</html>', 'https://events.humanitix.com/zine-fair');
eq('bare Event: title',        r.title, 'Zine Fair + Riso Workshop');
eq('strips HTML from body',    r.description, 'Bring paper. We bring the ink.');
eq('start is ISO',             r.startDate, new Date('2026-10-02T12:00:00+10:00').toISOString());
eq('venue name',               r.venue.name, 'Kaleide Theatre');
eq('venue address',            r.venue.address, '360 Swanston St, Melbourne');
eq('suburb from locality',     r.venue.suburb, 'Melbourne');
eq('organiser',                r.organiser, 'RMIT Link Arts & Culture');
eq('price in cents',           r.priceCents, 1200);
eq('image',                    r.imageUrl, 'https://cdn.humanitix.com/zine.jpg');
ok('provider detected',        r.source.provider === 'humanitix', r.source.provider);

r = parseEventFromHtml('<html>' + ldScript({ '@context': 'https://schema.org', '@graph': [
  { '@type': 'WebSite', name: 'A club site' }, baseEvent
] }) + '</html>');
eq('@graph wrapper',           r.title, 'Zine Fair + Riso Workshop');

r = parseEventFromHtml('<html>' + ldScript({
  '@type': 'ItemList',
  itemListElement: [
    { '@type': 'ListItem', item: { ...baseEvent, name: 'Later Event', startDate: '2026-12-01T18:00:00+11:00' } },
    { '@type': 'ListItem', item: { ...baseEvent, name: 'Sooner Event', startDate: '2026-10-05T18:00:00+11:00' } }
  ]
}) + '</html>');
eq('ItemList picks the soonest upcoming', r.title, 'Sooner Event');
eq('and says how many others',            r.otherEventsOnPage, 1);

r = parseEventFromHtml('<html>' + ldScript({ ...baseEvent, '@type': ['Event', 'MusicEvent'] }) + '</html>');
eq('@type as an array',        r.title, 'Zine Fair + Riso Workshop');

r = parseEventFromHtml('<html>' + ldScript({ ...baseEvent, '@type': 'ScreeningEvent' }) + '</html>');
eq('subtype ScreeningEvent',   r.title, 'Zine Fair + Riso Workshop');

r = parseEventFromHtml('<html>' + ldScript({ ...baseEvent, offers: {
  '@type': 'AggregateOffer', lowPrice: '8', highPrice: '25', priceCurrency: 'AUD',
  offers: [ { '@type': 'Offer', name: 'Student', price: '8', priceCurrency: 'AUD' },
            { '@type': 'Offer', name: 'General', price: '25', priceCurrency: 'AUD' } ] } }) + '</html>');
ok('AggregateOffer expands to tiers', r.tickets.length >= 2, JSON.stringify(r.tickets));
eq('cheapest tier wins the headline price', r.priceCents, 800);

r = parseEventFromHtml('<html>' + ldScript({ ...baseEvent, offers: { '@type': 'Offer', price: '0', priceCurrency: 'AUD' } }) + '</html>');
eq('free events are marked free', r.isFree, true);
eq('free is zero cents',          r.priceCents, 0);

// malformed but recoverable
r = parseEventFromHtml('<script type="application/ld+json">' + JSON.stringify(baseEvent).replace('}', '},') + '</' + 'script>');
ok('survives a trailing comma', r.title === 'Zine Fair + Riso Workshop' || r.title === '', r.title);

/* ============================================================
   2. OpenGraph and meta fallbacks
   ============================================================ */
section('OpenGraph / meta / title fallbacks');

const ogPage = `<html><head>
  <title>Trivia Night at the Local | Humanitix</title>
  <meta property="og:title" content="Trivia Night at the Local">
  <meta content="Six rounds, free entry, prizes." property="og:description">
  <meta property="og:image" content="https://cdn.example.org/trivia.jpg">
  <meta property="og:url" content="https://events.humanitix.com/trivia-night">
  <meta property="event:start_time" content="2026-10-09T19:00:00+11:00">
  <meta name="twitter:image" content="https://cdn.example.org/twitter-only.jpg">
</head><body></body></html>`;

r = parseEventFromHtml(ogPage, 'https://events.humanitix.com/trivia-night');
eq('og:title',                 r.title, 'Trivia Night at the Local');
eq('og:description',           r.description, 'Six rounds, free entry, prizes.');
eq('og:image beats twitter',   r.imageUrl, 'https://cdn.example.org/trivia.jpg');
eq('event:start_time',         r.startDate, new Date('2026-10-09T19:00:00+11:00').toISOString());
eq('og:image is the source',   r.sources.imageUrl, 'opengraph');

r = parseEventFromHtml('<html><head><title>Life Drawing in the Laneway | Humanitix</title></head></html>');
eq('title tag, site name stripped', r.title, 'Life Drawing in the Laneway');

r = parseEventFromHtml('<html><head><meta itemprop="name" content="Microdata Night">' +
  '<meta itemprop="startDate" content="2026-11-01T18:00:00+11:00"></head></html>');
eq('microdata name',           r.title, 'Microdata Night');

/* ============================================================
   3. Merge rules
   ============================================================ */
section('Merging: last one wins, blanks never overwrite');

const both = `<html><head>
  <meta property="og:title" content="OG Title">
  <meta property="og:image" content="https://cdn.example.org/og.jpg">
  <meta property="og:description" content="From OpenGraph.">
</head><body>` + ldScript({ ...baseEvent, name: 'JSON-LD Title', image: '', description: '' }) + '</body></html>';

r = parseEventFromHtml(both, 'https://events.humanitix.com/x');
eq('JSON-LD beats OpenGraph for title', r.title, 'JSON-LD Title');
eq('but a blank never overwrites',      r.imageUrl, 'https://cdn.example.org/og.jpg');
eq('nor does a blank description',      r.description, 'From OpenGraph.');
eq('and each field records its source', r.sources.title, 'json-ld');
eq('image kept its own source',         r.sources.imageUrl, 'opengraph');

const merged = mergeDefined(
  [{ title: 'first', venue: { name: 'Generic Hall' } }, 'opengraph'],
  [{ title: 'second', venue: { address: '1 Test St' } }, 'json-ld']
);
eq('the later parser wins',    merged.title, 'second');
eq('venue merges key by key',  merged.venue, { name: 'Generic Hall', address: '1 Test St' });
eq('and each half keeps its source', merged.sources['venue.name'], 'opengraph');

const blanked = mergeDefined(
  [{ title: 'kept', imageUrl: 'https://a/i.jpg' }, 'opengraph'],
  [{ title: 'wins', imageUrl: '' }, 'json-ld']
);
eq('a blank never overwrites', blanked.imageUrl, 'https://a/i.jpg');
eq('a real value still does',  blanked.title, 'wins');

const tiers = mergeDefined(
  [{ tickets: [{ price: 8 }] }, 'json-ld'],
  [{ tickets: [{ price: 8 }, { price: 15 }, { price: 25 }] }, 'humanitix']
);
eq('the longer ticket list wins', tiers.tickets.length, 3);
const fewer = mergeDefined(
  [{ tickets: [{ price: 8 }, { price: 15 }, { price: 25 }] }, 'json-ld'],
  [{ tickets: [{ price: 8 }] }, 'humanitix']
);
eq('and a shorter one does not throw tiers away', fewer.tickets.length, 3);

/* ============================================================
   4. Provider parsers
   ============================================================ */
section('Provider parsers');

const humanitixPage = `<html><head>
  <meta property="og:title" content="Rooftop Screening">
</head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { event: {
    name: 'Rooftop Screening: In the Mood for Love',
    slug: 'rooftop-screening',
    description: 'Open-air film night.',
    startDate: '2026-10-15T19:30:00+11:00',
    endDate: '2026-10-15T22:00:00+11:00',
    currency: 'AUD',
    bannerImage: { url: 'https://cdn.humanitix.com/banner.jpg' },
    eventLocation: { venueName: 'Union House Rooftop', address: 'Parkville VIC', city: 'Parkville' },
    organiser: { name: 'Melbourne Uni Film Society' },
    ticketTypes: [
      { name: 'Student', price: 8,  quantity: 100, qtySold: 40 },
      { name: 'General', price: 15, quantity: 50,  qtySold: 50 },
      { name: 'Donation', price: 5, isDonation: true }
    ]
  } } }
})}</script></body></html>`;

r = parseEventFromHtml(humanitixPage, 'https://events.humanitix.com/rooftop-screening');
eq('humanitix: hydration title beats og', r.title, 'Rooftop Screening: In the Mood for Love');
eq('humanitix: all tiers, donation excluded', r.tickets.length, 2);
eq('humanitix: cheapest tier',            r.priceCents, 800);
eq('humanitix: sold-out tier flagged',    r.tickets[1].available, false);
eq('humanitix: venue',                    r.venue.name, 'Union House Rooftop');
eq('humanitix: checkout url derived',     r.ticketUrl, 'https://events.humanitix.com/rooftop-screening/tickets');
eq('humanitix: event page url',           r.source.pageUrl, 'https://events.humanitix.com/rooftop-screening');
eq('humanitix: named as the source',      r.source.provider, 'humanitix');

const humanitixRichPage = `<html><body>
  <div class="hostname"><a href="/host/women-in-technology">Women in Technology</a></div>
  <div class="RichContent"><p><span>Women in Tech presents </span><strong>CODE TO CONNECT: 2026 HACKATHON </strong><span>💾✨</span><br /><br />
    <span>Ready to turn your </span><strong>ideas</strong><span> 💡 into </span><strong>something real</strong><span>? Whether you’re a coding pro or just curious about tech, come along, connect with others, and build something awesome together! 🧑‍💻🤝</span><br /><br />
    <strong>📅 Friday, 4th September to 8th September</strong></p><p></p><p><span>🔗 More details coming soon — keep your eyes peeled!</span><br /><br /><span>Your next big idea might just start here 👀</span></p></div>
</body></html>`;

r = parseEventFromHtml(humanitixRichPage, 'https://events.humanitix.com/code-to-connect-2026-hackathon');
eq('humanitix: rendered description', r.description, 'Women in Tech presents CODE TO CONNECT: 2026 HACKATHON 💾✨\n\nReady to turn your ideas 💡 into something real? Whether you’re a coding pro or just curious about tech, come along, connect with others, and build something awesome together! 🧑‍💻🤝\n\n📅 Friday, 4th September to 8th September\n\n🔗 More details coming soon — keep your eyes peeled!\n\nYour next big idea might just start here 👀');
eq('humanitix: rendered host',        r.organiser, 'Women in Technology');

const eventbritePage = `<html><head><meta property="og:url" content="https://www.eventbrite.com.au/e/tech-night-tickets-123?aff=x"></head><body>
<script>window.__SERVER_DATA__ = ${JSON.stringify({
  event: {
    name: { text: 'Tech Networking Night' },
    description: { text: 'Meet students and industry.' },
    start: { utc: '2026-09-22T08:00:00Z' },
    end:   { utc: '2026-09-22T11:00:00Z' },
    logo: { original: { url: 'https://img.evbuc.com/hero.jpg' } },
    venue: { name: 'Monash University', address: { localized_address_display: 'Clayton VIC 3800', city: 'Clayton' } },
    organizer: { name: 'Monash Student Association' }
  },
  ticket_classes: [
    { name: 'Student', cost: { major_value: '10.00', currency: 'AUD' }, on_sale_status: 'AVAILABLE' },
    { name: 'Member',  free: true, on_sale_status: 'AVAILABLE' }
  ]
})};</script></body></html>`;

r = parseEventFromHtml(eventbritePage, 'https://www.eventbrite.com.au/e/tech-night-tickets-123');
eq('eventbrite: title',        r.title, 'Tech Networking Night');
eq('eventbrite: venue',        r.venue.name, 'Monash University');
eq('eventbrite: organiser',    r.organiser, 'Monash Student Association');
eq('eventbrite: free tier makes it free', r.priceCents, 0);
eq('eventbrite: tracking stripped from page url', r.source.pageUrl, 'https://www.eventbrite.com.au/e/tech-night-tickets-123');
eq('eventbrite: named as the source', r.source.provider, 'eventbrite');

const rubricPage = `<html><body>
  <h1>End of Semester BBQ</h1>
  <div class="event-date">Thu 9 Oct 2026, 12:00pm - 2:00pm</div>
  <div class="event-location">Bowen Street Lawn</div>
  <div class="club-name">RMIT Link Arts &amp; Culture</div>
  <span>Free for members</span>
</body></html>`;

r = parseEventFromHtml(rubricPage, 'https://campus.hellorubric.com/?s=4202&event=88');
eq('rubric: title from h1',    r.title, 'End of Semester BBQ');
ok('rubric: date parsed',      r.startDate.startsWith('2026-10-09'), r.startDate);
eq('rubric: venue',            r.venue.name, 'Bowen Street Lawn');
eq('rubric: organiser',        r.organiser, 'RMIT Link Arts & Culture');
eq('rubric: free',             r.priceCents, 0);
eq('rubric: named as the source', r.source.provider, 'rubric');

const uniPage = `<html><body>
<script class="lw_json">${JSON.stringify([{
  title: 'Sustainability Forum', summary: 'Panel and Q&A.',
  date_utc: '2026-10-20T07:00:00Z', location: 'Old Arts, Theatre B',
  group: 'Melbourne Environment Collective'
}])}</script>
<p>Free entry, no charge.</p>
</body></html>`;

r = parseEventFromHtml(uniPage, 'https://events.unimelb.edu.au/sustainability-forum');
eq('livewhale: title',         r.title, 'Sustainability Forum');
eq('livewhale: venue',         r.venue.name, 'Old Arts, Theatre B');
eq('livewhale: organiser',     r.organiser, 'Melbourne Environment Collective');
eq('university detected',      r.university, 'Unimelb');
eq('free by default on a union page', r.priceCents, 0);

/* ============================================================
   5. Bare link and .ics
   ============================================================ */
section('Bare links and calendar invites');

r = parseEventFromHtml('https://events.humanitix.com/trivia-night-2026');
eq('bare link becomes the page url', r.source.pageUrl, 'https://events.humanitix.com/trivia-night-2026');
eq('and the ticket url',             r.ticketUrl, 'https://events.humanitix.com/trivia-night-2026');
eq('title is left for the human',    r.title, '');
eq('and flagged as missing',         r.missing.required, ['title', 'startDate']);

r = parseEventFromHtml(`BEGIN:VEVENT
SUMMARY:Life Drawing in the Laneway
DESCRIPTION:Bring a pencil.
LOCATION:Blender Studios
DTSTART:20261008T183000Z
DTEND:20261008T203000Z
URL:https://umsu.unimelb.edu.au/e/life-drawing
ORGANIZER;CN=Melbourne Uni Art Club:mailto:art@umsu.unimelb.edu.au
END:VEVENT`);
eq('ics: title',               r.title, 'Life Drawing in the Laneway');
eq('ics: start',               r.startDate, '2026-10-08T18:30:00.000Z');
eq('ics: venue',               r.venue.name, 'Blender Studios');
eq('ics: organiser',           r.organiser, 'Melbourne Uni Art Club');
eq('ics: page url',            r.source.pageUrl, 'https://umsu.unimelb.edu.au/e/life-drawing');

/* ============================================================
   6. Robustness
   ============================================================ */
section('Robustness');

for (const junk of ['', '   ', 'not a url at all', '<html></html>', '{}', '<script type="application/ld+json">{broken</script>']) {
  const res = parseEventFromHtml(junk);
  ok('survives ' + JSON.stringify(junk.slice(0, 24)), typeof res.title === 'string' && Array.isArray(res.missing.required));
}
r = parseEventFromHtml('<html>' + ldScript({ '@type': 'Event', name: 'No Date Event' }) + '</html>');
eq('missing date is reported', r.missing.required, ['startDate']);
ok('sources are reported',     r.sources && typeof r.sources === 'object');

/* ============================================================
   7. SSRF guard
   ============================================================ */
section('URL safety (SSRF)');

const blocked = [
  'http://events.humanitix.com/x',        // not https
  'https://localhost/x',
  'https://127.0.0.1/x',
  'https://169.254.169.254/latest/meta-data/',  // AWS metadata
  'https://metadata.google.internal/x',
  'https://10.0.0.5/x',
  'https://192.168.1.1/x',
  'https://172.16.0.1/x',
  'https://[::1]/x',
  'https://evil.example.com/x',           // not on the allow-list
  'https://user:pass@events.humanitix.com/x',
  'https://events.humanitix.com:8080/x',
  'not a url'
];
for (const u of blocked) ok('refuses ' + u.slice(0, 42), !isFetchable(u));

const allowed = [
  'https://events.humanitix.com/zine-fair',
  'https://www.eventbrite.com.au/e/x-123',
  'https://campus.hellorubric.com/?s=4202',
  'https://umsu.unimelb.edu.au/whats-on/event',
  'https://www.trybooking.com/events/123',
  'https://monashclubs.org/event/5'
];
for (const u of allowed) ok('allows  ' + u.slice(0, 42), isFetchable(u), checkUrl(u).reason || '');

ok('an unsupported host explains what to do instead',
   /paste the page itself/i.test(checkUrl('https://evil.example.com/x').reason));
ok('allow-list is not empty', ALLOWED_HOSTS.length > 10);

/* ============================================================ */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
