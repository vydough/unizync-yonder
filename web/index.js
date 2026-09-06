import * as U from '../lib/universe.js';

const cfg = window.UNIVERSE_CONFIG;

if (!cfg || !cfg.url || !cfg.anonKey) {
  throw new Error('Supabase config missing');
}

// Initialise Supabase connection
U.init(cfg.url, cfg.anonKey);


// --------------------
// App state
// --------------------

let deck = [];
let currentIndex = 0;


// --------------------
// Start app
// --------------------

async function boot() {
  try {
    const user = await U.currentUser();

    if (!user) {
      console.log('Not signed in');
      return;
    }

    console.log('Signed in:', user.email);

    await loadDeck();

  } catch (error) {
    console.error('Failed to start app:', error);
  }
}


// --------------------
// Load recommendations
// --------------------

async function loadDeck() {
  try {
    deck = await U.getDeck(15);

    console.log('Deck:', deck);

    currentIndex = 0;

    renderCurrentEvent();

  } catch (error) {
    console.error('Failed to load deck:', error);
  }
}


// --------------------
// Render event
// --------------------

function renderCurrentEvent() {
  const container = document.getElementById('event-card');

  if (!container) {
    console.error('Could not find #event-card');
    return;
  }

  const event = deck[currentIndex];

  if (!event) {
    container.innerHTML = `
      <h2>No more events</h2>
    `;
    return;
  }

  container.innerHTML = `
    <h1>${event.title}</h1>

    <p>${event.club.name}</p>

    <p>${event.club.university.short_name}</p>

    <p>${U.dayTime(event.starts_at)}</p>

    <p>${event.venue_name || ''}</p>

    <p>${U.priceStr(event)}</p>

    <p>${event.matchPct}% match</p>
  `;
}


// Start
boot();