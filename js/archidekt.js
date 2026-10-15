/*
 * Loads public decks straight from Archidekt by link or username.
 * Archidekt's API doesn't allow requests from other websites, so they go through a small relay
 * (worker/archidekt-relay.js, hosted free on Cloudflare). Decks come back as the same text
 * format as an Archidekt export, so they go through the normal Import steps.
 */
const Archidekt = (() => {
  'use strict';

  // Paste your relay's address here (e.g. 'https://archidekt-relay.yourname.workers.dev') so
  // everyone using the app gets it. It can also be set per browser on the Import tab.
  const DEFAULT_RELAY = 'https://archidekt-relay.liliazbodnar.workers.dev';

  async function get(relay, path) {
    if (!relay) throw new Error('No Archidekt relay is set up yet');
    let res;
    try {
      res = await fetch(relay.replace(/\/+$/, '') + path, { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new Error("Couldn't reach the Archidekt relay. Check its address and your internet connection");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Archidekt error ${res.status}`);
    return res.json();
  }

  // "https://archidekt.com/decks/123456/my_deck" or "123456" -> { deckId }; "archidekt.com/u/name" or "name" -> { username }
  function parseInput(input) {
    const s = input.trim();
    let m;
    if ((m = s.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/i)) || (m = s.match(/^(\d+)$/))) return { deckId: m[1] };
    if ((m = s.match(/archidekt\.com\/(?:u|user)\/([^/?#\s]+)/i))) return { username: decodeURIComponent(m[1]) };
    if (/^[\w.-]+$/.test(s)) return { username: s };
    return null;
  }

  // Category and tag text can't contain the characters the export format uses as separators.
  const clean = s => String(s).replace(/[[\]{},^]/g, ' ').replace(/\s+/g, ' ').trim();

  // Archidekt deck JSON -> export-format text (see parser.js).
  function deckToText(deck) {
    const outOfDeck = new Set((deck.categories || []).filter(c => c.includedInDeck === false).map(c => c.name));
    const lines = [];
    for (const entry of deck.cards || []) {
      const card = entry.card || {};
      const name = (card.oracleCard && card.oracleCard.name) || card.displayName;
      if (!name || !entry.quantity) continue;
      let line = `${entry.quantity}x ${name}`;
      const set = card.edition && card.edition.editioncode;
      if (set && card.collectorNumber) line += ` (${set}) ${card.collectorNumber}`;
      if (entry.modifier === 'Foil') line += ' *F*';
      else if (entry.modifier === 'Etched') line += ' *E*';
      const cats = (entry.categories || []).map(c => clean(c) + (outOfDeck.has(c) ? '{noDeck}' : '')).filter(Boolean);
      if (cats.length) line += ` [${cats.join(',')}]`;
      // Labels look like "Buy,#0066ff" (name, colour).
      const label = clean(String(entry.label || '').split(',')[0]);
      if (label) line += ` ^${label}^`;
      lines.push(line);
    }
    return lines.sort((a, b) => a.replace(/^\d+x /, '').localeCompare(b.replace(/^\d+x /, ''))).join('\n');
  }

  async function fetchDeck(relay, deckId) {
    const deck = await get(relay, `/api/decks/${encodeURIComponent(deckId)}/`);
    if (!deck) throw new Error("That deck wasn't found. It may be private, or the link may be wrong");
    return { id: deck.id, name: deck.name, text: deckToText(deck) };
  }

  // A user's public decks, newest first.
  async function userDecks(relay, username) {
    const decks = [];
    let page = 1;
    while (page <= 10) {
      const data = await get(relay, `/api/decks/v3/?ownerUsername=${encodeURIComponent(username)}&orderBy=-updatedAt&pageSize=50&page=${page}`);
      if (!data) break;
      for (const d of data.results || []) {
        decks.push({ id: d.id, name: d.name, size: d.size, updatedAt: d.updatedAt, owner: d.owner && d.owner.username });
      }
      if (!data.next) break;
      page++;
    }
    // The search is loose, so keep only that user's decks.
    return decks.filter(d => !d.owner || d.owner.toLowerCase() === username.toLowerCase());
  }

  return { DEFAULT_RELAY, parseInput, deckToText, fetchDeck, userDecks };
})();

if (typeof module !== 'undefined') module.exports = Archidekt;
