/**
 * UniVerse — URL safety
 * ---------------------------------------------------------------
 * The endpoint takes a URL from a student and fetches it, which is
 * textbook SSRF: without this, anyone with an account could point it
 * at the server's own metadata service, or at something inside
 * Supabase's network, and read the response back through our preview
 * screen.
 *
 * Two layers, in this order:
 *   1. an allow-list of hosts we have parsers for — the architecture
 *      doc's MVP recommendation, and the right default. A club event
 *      lives on one of about a dozen platforms.
 *   2. a deny-list of everything that could be internal, which catches
 *      the case where someone widens the allow-list later and forgets.
 *
 * This file is imported by BOTH the edge function and the client, so
 * the app can grey out an unsupported link before anyone waits on a
 * request, and the two can never disagree about what's allowed.
 */

/** Hosts we will fetch. Suffix match on the registrable domain. */
export const ALLOWED_HOSTS = [
  // ticketing
  'humanitix.com',
  'events.humanitix.com',
  'eventbrite.com',
  'eventbrite.com.au',
  'trybooking.com',
  'trybooking.com.au',
  'hellorubric.com',
  'campus.hellorubric.com',
  'moshtix.com.au',
  'oztix.com.au',
  'stickytickets.com.au',

  // our six universities and their unions
  'unimelb.edu.au',
  'umsu.unimelb.edu.au',
  'rmit.edu.au',
  'rusu.rmit.edu.au',
  'monash.edu',
  'monashclubs.org',
  'msa.monash.edu',
  'deakin.edu.au',
  'dusa.org.au',
  'latrobe.edu.au',
  'ltu.edu.au',
  'latrobesu.org.au',
  'swinburne.edu.au',
  'swin.edu.au',
  'studentlife.swinburne.edu.au'
];

/** Never fetch these, whatever the allow-list says. */
const BLOCKED_HOSTNAMES = /^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$|.*\.local$|.*\.internal$|metadata\.google\.internal$)/i;

/** RFC1918 and friends, plus the cloud metadata addresses. */
function isPrivateAddress(host) {
  // IPv4
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 169 && b === 254) return true;         // link-local + AWS/GCP metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 0 || a >= 224) return true;            // this-network, multicast, reserved
    return false;
  }
  // IPv6 — anything that isn't a plain global unicast address
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '').toLowerCase();
    return /^(::1?$|fe80:|fc00:|fd|::ffff:)/.test(h);
  }
  return false;
}

/**
 * @param {string} raw
 * @returns {{ok: true, url: URL} | {ok: false, reason: string}}
 */
export function checkUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); }
  catch { return { ok: false, reason: 'That isn\'t a valid link.' }; }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Only https links are accepted.' };
  }
  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.test(host) || isPrivateAddress(host)) {
    return { ok: false, reason: 'That address isn\'t reachable from here.' };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, reason: 'Only standard https ports are accepted.' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Links with credentials in them aren\'t accepted.' };
  }
  const allowed = ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  if (!allowed) {
    return {
      ok: false,
      reason: 'We don\'t read links from ' + host + ' yet. Paste the page itself instead — ' +
              'select all on the event page, copy, and paste it here.'
    };
  }
  return { ok: true, url };
}

/** True if we'd fetch it — for greying out a button before anyone waits. */
export function isFetchable(raw) {
  return checkUrl(raw).ok;
}
