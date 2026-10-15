const test = require('node:test');
const assert = require('node:assert/strict');
const Moxfield = require('../js/moxfield.js');
const Parser = require('../js/parser.js');

const entry = (name, extra = {}) => ({
  quantity: 1, finish: 'nonFoil', ...extra,
  card: { name, set: 'cmm', cn: '1', type_line: 'Creature — Elf', ...(extra.card || {}) },
});

const DECK = {
  name: 'Elves',
  authorTags: { 'Llanowar Elves': ['Ramp'] },
  boards: {
    commanders: { cards: { a: entry('Lathril, Blade of the Elves', { card: { type_line: 'Legendary Creature — Elf Noble' } }) } },
    mainboard: { cards: {
      b: entry('Llanowar Elves', { quantity: 2, finish: 'foil' }),
      c: entry('Forest', { quantity: 30, card: { type_line: 'Basic Land — Forest' } }),
    } },
    sideboard: { cards: { d: entry('Naturalize', { card: { type_line: 'Instant' } }) } },
    maybeboard: { cards: { e: entry('Elvish Mystic', { finish: 'etched' }) } },
  },
};

test('reads Moxfield deck links', () => {
  assert.deepEqual(Moxfield.parseInput('https://moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA'), { deckId: 'oEWXWHM5eEGMmopExLWRCA' });
  assert.deepEqual(Moxfield.parseInput('www.moxfield.com/decks/abc-123/primer'), { deckId: 'abc-123' });
  assert.equal(Moxfield.parseInput('https://archidekt.com/decks/1'), null);
});

test('turns a Moxfield deck into rows the importer understands', () => {
  const { entries, errors } = Parser.parse(Moxfield.deckToText(DECK));
  assert.deepEqual(errors, []);
  const by = Object.fromEntries(entries.map(e => [e.name, e]));
  assert.deepEqual(by['Lathril, Blade of the Elves'].categories, ['Commander']);
  assert.equal(by['Lathril, Blade of the Elves'].inDeck, true);
  assert.deepEqual(by['Llanowar Elves'].categories, ['Ramp']); // the deck's own tag
  assert.equal(by['Llanowar Elves'].qty, 2);
  assert.equal(by['Llanowar Elves'].finish, 'foil');
  assert.deepEqual(by.Forest.categories, ['Land']); // no tag, so grouped by type
  assert.equal(by.Naturalize.inDeck, false);
  assert.equal(by['Elvish Mystic'].inDeck, false);
  assert.equal(by['Elvish Mystic'].finish, 'etched');
  assert.equal(by.Forest.set, 'cmm');
});
