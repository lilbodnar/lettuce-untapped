/*
 * Checks a deck against a format's deck-building rules: deck size, how many copies of each card,
 * sideboard size, banned and restricted cards (from Scryfall's legality data) and, for Commander,
 * the commander and its color identity. No screen code lives here.
 */
const DeckCheck = (() => {
  'use strict';

  const constructed = label => ({ label, size: 60, copies: 4, sideboard: 15 });
  const FORMATS = {
    commander: { label: 'Commander', size: 100, exact: true, copies: 1, commander: true },
    brawl: { label: 'Brawl', size: 100, exact: true, copies: 1, commander: true },
    standard: constructed('Standard'),
    pioneer: constructed('Pioneer'),
    modern: constructed('Modern'),
    legacy: constructed('Legacy'),
    vintage: constructed('Vintage'),
    pauper: constructed('Pauper'),
  };

  const BASIC = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;
  const NUMBERS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  // Used when a card's rules text hasn't been loaded yet.
  const ANY_NUMBER = new Set(['relentless rats', 'shadowborn apostle', 'rat colony', 'persistent petitioners', "dragon's approach",
    'slime against humanity', 'hare apparent', 'templar knight', 'cid, timeless artificer', 'tempest hawk']);
  const UP_TO = { 'seven dwarves': 7, 'nazgûl': 9 };

  // How many copies of a card a deck may have (Infinity for basics and "any number" cards).
  function copyLimit(name, oracle, normal) {
    const key = name.toLowerCase();
    if (BASIC.test(key) || ANY_NUMBER.has(key)) return Infinity;
    if (UP_TO[key]) return UP_TO[key];
    if (/a deck can have any number of cards named/i.test(oracle || '')) return Infinity;
    const m = (oracle || '').match(/a deck can have up to (\w+) cards named/i);
    if (m && NUMBERS[m[1].toLowerCase()]) return NUMBERS[m[1].toLowerCase()];
    return normal;
  }

  const isCommanderRow = r => (r.categories || []).some(c => c.toLowerCase() === 'commander');
  const isSideboardRow = r => !r.inDeck && (r.categories || []).some(c => /side/i.test(c));

  // rows: [{ name, qty, inDeck, categories }]; cardOf(row) -> Scryfall card info or null.
  // Returns { issues: [{ text, cards: [names] }], pending } where pending counts cards whose
  // legality isn't known yet.
  function run(format, rows, cardOf) {
    const f = FORMATS[format];
    if (!f) return { issues: [], pending: 0 };
    const issues = [];
    const add = (text, cards = []) => issues.push({ text, cards: [...new Set(cards)].sort() });
    const nameOf = r => (cardOf(r) && cardOf(r).name) || r.name;

    const deck = rows.filter(r => r.inDeck);
    const side = rows.filter(isSideboardRow);
    const size = deck.reduce((s, r) => s + r.qty, 0);
    if (f.exact && size !== f.size) add(`The deck has ${size} cards. ${f.label} decks need exactly ${f.size}, including the commander.`);
    else if (!f.exact && size < f.size) add(`The deck has ${size} cards. ${f.label} decks need at least ${f.size}.`);
    const sideSize = side.reduce((s, r) => s + r.qty, 0);
    if (f.sideboard != null && sideSize > f.sideboard) add(`The sideboard has ${sideSize} cards. The most allowed is ${f.sideboard}.`);

    // Copies are counted by name; in constructed formats the sideboard counts too.
    const counted = f.commander ? deck : deck.concat(side);
    const copies = new Map();
    for (const r of counted) {
      const name = nameOf(r);
      copies.set(name, (copies.get(name) || 0) + r.qty);
    }
    const tooMany = [];
    const restricted = [];
    for (const [name, n] of copies) {
      const row = counted.find(r => nameOf(r) === name);
      const card = cardOf(row) || {};
      const legal = card.legalities && card.legalities[format];
      if (legal === 'restricted' && n > 1) restricted.push(name);
      else if (n > copyLimit(name, card.oracle, f.copies)) tooMany.push(`${name} (${n})`);
    }
    if (tooMany.length) add(f.copies === 1 ? 'Only one copy of each card is allowed (except basic lands):' : `At most ${f.copies} copies of each card are allowed:`, tooMany);
    if (restricted.length) add(`Restricted in ${f.label}, so only one copy is allowed:`, restricted);

    let pending = 0;
    const banned = [];
    const notLegal = [];
    for (const r of counted) {
      const card = cardOf(r);
      const legal = card && card.legalities && card.legalities[format];
      if (!legal) { pending++; continue; }
      if (legal === 'banned') banned.push(nameOf(r));
      else if (legal === 'not_legal') notLegal.push(nameOf(r));
    }
    if (banned.length) add(`Banned in ${f.label}:`, banned);
    if (notLegal.length) add(`Not legal in ${f.label}:`, notLegal);

    if (f.commander) {
      const commanders = deck.filter(isCommanderRow);
      if (!commanders.length) {
        add('No commander found. Put your commander in a category called "Commander".');
      } else {
        if (commanders.length > 2) add('A deck can have at most two commanders (with Partner or a Background):', commanders.map(nameOf));
        const notCommander = commanders.filter(r => {
          const card = cardOf(r);
          if (!card || !card.typeLine) return false;
          const front = card.typeLine.split('//')[0];
          const legendary = /legendary/i.test(front) && /creature/i.test(front);
          return !legendary && !/can be your commander/i.test(card.oracle || '');
        });
        if (notCommander.length) add("Your commander has to be a legendary creature (or say it can be your commander):", notCommander.map(nameOf));
        const identity = new Set(commanders.flatMap(r => (cardOf(r) && cardOf(r).colorIdentity) || []));
        const outside = deck.filter(r => {
          const card = cardOf(r);
          return card && (card.colorIdentity || []).some(k => !identity.has(k));
        });
        const shown = [...identity].join('') || 'colorless';
        if (outside.length) add(`Outside your commander's colors (${shown}):`, outside.map(nameOf));
      }
    }

    return { issues, pending };
  }

  return { FORMATS, run, copyLimit };
})();

if (typeof module !== 'undefined') module.exports = DeckCheck;
