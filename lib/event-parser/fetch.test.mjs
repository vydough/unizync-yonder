/**
 * UniVerse — parseEventFromUrl tests
 *
 *   node lib/event-parser/fetch.test.mjs
 *
 * The fetch is mocked, so this runs offline and tests the thing that
 * actually matters: that the guards hold. The edge function uses the
 * same checkUrl() and the same parser, so these cover its logic too.
 */

import { parseEventFromUrl, checkUrl } from './index.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : '  → ' + detail}`);
};
const threw = async (label, fn, match) => {
  try { await fn(); ok(label, false, 'did not throw'); }
  catch (e) { ok(label, match ? match.test(e.message) : true, e.message); }
};

const page = `<html><head><title>Test | Humanitix</title></head><body>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Event',
  name: 'Fetched Event', startDate: '2026-11-05T18:00:00+11:00',
  location: { '@type': 'Place', name: 'Kaleide Theatre' },
  offers: { '@type': 'Offer', price: '10', priceCurrency: 'AUD' }
})}</script></body></html>`;

const mockFetch = (opts = {}) => async (url) => ({
  ok: opts.ok !== false,
  status: opts.status || 200,
  url: opts.finalUrl || url,
  headers: { get: (k) => k.toLowerCase() === 'content-type' ? (opts.type || 'text/html; charset=utf-8') : null },
  text: async () => opts.body ?? page
});

console.log('\nThe happy path');
let r = await parseEventFromUrl('https://events.humanitix.com/test', { fetchImpl: mockFetch() });
ok('parses a fetched page', r.title === 'Fetched Event', r.title);
ok('keeps the venue',       r.venue?.name === 'Kaleide Theatre', JSON.stringify(r.venue));
ok('keeps the price',       r.priceCents === 1000, String(r.priceCents));
ok('records the provider',  r.source.provider === 'humanitix', r.source.provider);
ok('records the url',       r.source.url === 'https://events.humanitix.com/test', r.source.url);

console.log('\nThe guards');
await threw('refuses a host we have no parser for',
  () => parseEventFromUrl('https://evil.example.com/x', { fetchImpl: mockFetch() }), /don't read links/i);
await threw('refuses http',
  () => parseEventFromUrl('http://events.humanitix.com/x', { fetchImpl: mockFetch() }), /https/i);
await threw('refuses cloud metadata',
  () => parseEventFromUrl('https://169.254.169.254/latest/meta-data/', { fetchImpl: mockFetch() }), /isn't reachable|don't read/i);
await threw('refuses a non-standard port',
  () => parseEventFromUrl('https://events.humanitix.com:8080/x', { fetchImpl: mockFetch() }), /port/i);

// The one that catches people out: allowed host, redirects somewhere else.
await threw('refuses a redirect off the allow-list',
  () => parseEventFromUrl('https://events.humanitix.com/x',
    { fetchImpl: mockFetch({ finalUrl: 'https://169.254.169.254/meta' }) }), /redirect/i);

ok('a redirect within the allow-list is fine',
  (await parseEventFromUrl('https://events.humanitix.com/x',
    { fetchImpl: mockFetch({ finalUrl: 'https://events.humanitix.com/x-renamed' }) })).title === 'Fetched Event');

console.log('\nBad responses');
await threw('a 404 says so',
  () => parseEventFromUrl('https://events.humanitix.com/gone',
    { fetchImpl: mockFetch({ ok: false, status: 404 }) }), /404/);
await threw('a PDF is refused',
  () => parseEventFromUrl('https://events.humanitix.com/x',
    { fetchImpl: mockFetch({ type: 'application/pdf' }) }), /isn't a web page/i);

r = await parseEventFromUrl('https://events.humanitix.com/x',
  { fetchImpl: mockFetch({ body: '<html><body>nothing here</body></html>' }) });
ok('an unreadable page returns empty rather than throwing',
   r.title === '' && r.missing.required.includes('title'), JSON.stringify(r.missing));

console.log('\nTimeouts');
await threw('a hung page times out', () => parseEventFromUrl('https://events.humanitix.com/slow', {
  timeoutMs: 60,
  fetchImpl: (url, opts) => new Promise((_, rej) => {
    opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })
}));

console.log('\nThe error messages are useful');
ok('unsupported host tells you what to do',
   /paste the page itself/i.test(checkUrl('https://randomclub.com/e').reason));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
