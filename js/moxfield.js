/*
 * Loads public decks straight from Moxfield by link.
 * Moxfield doesn't allow requests from other websites either, so they go through the same relay
 * as Archidekt (worker/archidekt-relay.js). Decks come back as the same text format as an
 * Archidekt export, so they go through the normal Import steps.
 */
const Moxfield = (() => {
  'use strict';

  // "https://moxfield.com/decks/AbC123xyz…" -> { deckId }
  function parseInput(input) {
    const m = input.trim().match(/moxfield\.com\/decks\/([\w-]+)/i);
    return m ? { deckId: m[1] } : null;
  }

  const clean = s => String(s).replace(/[[\]{},^]/g, ' ').replace(/\s+/g, ' ').trim();
  const TYPES = ['Creature', 'Planeswalker', 'Battle', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'];
  const typeOf = typeLine => TYPES.find(t => String(typeLine || '').split('//')[0].includes(t)) || 'Other';

  // Which board each Moxfield board becomes, and whether it counts as part of the deck.
  const BOARDS = {
    commanders: ['Commander', true],
    companions: ['Companion', false],
    mainboard: [null, true],
    sideboard: ['Sideboard', false],
    maybeboard: ['Maybeboard', false],
  };

  // Moxfield deck JSON -> export-format text (see parser.js). Main deck cards are grouped by the
  // deck's own tags when it has them, otherwise by card type, like Moxfield shows them.
  function deckToText(deck) {
    const tags = deck.authorTags || {};
    const lines = [];
    for (const [board, [category, inDeck]] of Object.entries(BOARDS)) {
      const cards = (deck.boards && deck.boards[board] && deck.boards[board].cards) || {};
      for (const entry of Object.values(cards)) {
        const card = entry.card || {};
        if (!card.name || !entry.quantity) continue;
        let line = `${entry.quantity}x ${card.name}`;
        if (card.set && card.cn) line += ` (${card.set}) ${card.cn}`;
        if (entry.finish === 'foil') line += ' *F*';
        else if (entry.finish === 'etched') line += ' *E*';
        const cat = clean(category || (tags[card.name] && tags[card.name][0]) || typeOf(card.type_line));
        line += ` [${cat}${inDeck ? '' : '{noDeck}'}]`;
        lines.push(line);
      }
    }
    return lines.sort((a, b) => a.replace(/^\d+x /, '').localeCompare(b.replace(/^\d+x /, ''))).join('\n');
  }

  async function fetchDeck(relay, deckId) {
    if (!relay) throw new Error('No relay is set up yet');
    let res;
    try {
      res = await fetch(`${relay.replace(/\/+$/, '')}/moxfield/decks/${encodeURIComponent(deckId)}`, { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new Error("Couldn't reach the relay. Check your internet connection");
    }
    if (res.status === 404) {
      throw new Error("That deck wasn't found. It may be private, or the relay may need updating (see the README)");
    }
    if (!res.ok) throw new Error(`Moxfield error ${res.status}`);
    const deck = await res.json();
    return { id: deck.publicId || deckId, name: deck.name || 'Moxfield deck', text: deckToText(deck) };
  }

  return { parseInput, deckToText, fetchDeck };
})();

if (typeof module !== 'undefined') module.exports = Moxfield;
