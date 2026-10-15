const test = require('node:test');
const assert = require('node:assert/strict');
const DeckCheck = require('../js/deckcheck.js');

const legal = format => ({ [format]: 'legal' });
const CARDS = {
  atraxa: { name: "Atraxa, Praetors' Voice", typeLine: 'Legendary Creature — Phyrexian Angel Horror', colorIdentity: ['W', 'U', 'B', 'G'], legalities: legal('commander') },
  bolt: { name: 'Lightning Bolt', typeLine: 'Instant', colorIdentity: ['R'], legalities: { commander: 'legal', modern: 'legal', standard: 'not_legal' } },
  sol: { name: 'Sol Ring', typeLine: 'Artifact', colorIdentity: [], legalities: { commander: 'legal', vintage: 'restricted', legacy: 'banned' } },
  forest: { name: 'Forest', typeLine: 'Basic Land — Forest', colorIdentity: ['G'], legalities: { commander: 'legal', modern: 'legal', vintage: 'legal' } },
  rats: { name: 'Relentless Rats', typeLine: 'Creature — Rat', colorIdentity: ['B'], legalities: legal('commander'), oracle: 'A deck can have any number of cards named Relentless Rats.' },
  bear: { name: 'Grizzly Bears', typeLine: 'Creature — Bear', colorIdentity: ['G'], legalities: { commander: 'legal', modern: 'legal', vintage: 'legal' } },
};
const row = (id, qty, extra = {}) => ({ scryfallId: id, name: CARDS[id] ? CARDS[id].name : id, qty, inDeck: true, categories: [], ...extra });
const cardOf = r => CARDS[r.scryfallId] || null;
const texts = result => result.issues.map(i => i.text);

test('a legal 100-card Commander deck has no problems', () => {
  const deck = [row('atraxa', 1, { categories: ['Commander'] }), row('sol', 1), row('rats', 30), row('forest', 68)];
  assert.deepEqual(DeckCheck.run('commander', deck, cardOf), { issues: [], pending: 0 });
});

test('Commander: wrong size, duplicates, missing commander colors', () => {
  const deck = [row('atraxa', 1, { categories: ['Commander'] }), row('sol', 2), row('bolt', 1), row('forest', 50)];
  const result = DeckCheck.run('commander', deck, cardOf);
  assert.match(texts(result)[0], /has 54 cards.*exactly 100/);
  assert.deepEqual(result.issues.find(i => /one copy/.test(i.text)).cards, ['Sol Ring (2)']);
  assert.deepEqual(result.issues.find(i => /Outside your commander's colors \(WUBG\)/.test(i.text)).cards, ['Lightning Bolt']);
});

test('Commander: no commander, or one that isn\'t legendary', () => {
  assert.ok(texts(DeckCheck.run('commander', [row('forest', 100)], cardOf)).some(t => /No commander found/.test(t)));
  const result = DeckCheck.run('commander', [row('bear', 1, { categories: ['Commander'] }), row('forest', 99)], cardOf);
  assert.deepEqual(result.issues.find(i => /legendary creature/.test(i.text)).cards, ['Grizzly Bears']);
});

test('constructed: 4-copy limit counts the sideboard, plus sideboard size', () => {
  const deck = [row('bear', 3), row('forest', 57), row('bear', 2, { inDeck: false, categories: ['Sideboard'] }), row('forest', 14, { inDeck: false, categories: ['Sideboard'] })];
  const result = DeckCheck.run('modern', deck, cardOf);
  assert.deepEqual(result.issues.find(i => /At most 4 copies/.test(i.text)).cards, ['Grizzly Bears (5)']);
  assert.ok(texts(result).some(t => /sideboard has 16 cards/.test(t)));
});

test('banned, not legal, and restricted cards', () => {
  assert.deepEqual(DeckCheck.run('legacy', [row('sol', 1), row('forest', 59)], cardOf).issues.find(i => /Banned/.test(i.text)).cards, ['Sol Ring']);
  assert.deepEqual(DeckCheck.run('standard', [row('bolt', 1), row('forest', 59)], cardOf).issues.find(i => /Not legal in Standard/.test(i.text)).cards, ['Lightning Bolt']);
  assert.deepEqual(DeckCheck.run('vintage', [row('sol', 2), row('forest', 58)], cardOf).issues.find(i => /Restricted/.test(i.text)).cards, ['Sol Ring']);
});

test('cards without legality info yet are counted as pending, not as problems', () => {
  const result = DeckCheck.run('modern', [row('unknown', 4), row('forest', 56)], cardOf);
  assert.equal(result.pending, 1);
  assert.deepEqual(result.issues, []);
});

test('copy limits from rules text', () => {
  assert.equal(DeckCheck.copyLimit('Forest', '', 1), Infinity);
  assert.equal(DeckCheck.copyLimit('Seven Dwarves', '', 1), 7);
  assert.equal(DeckCheck.copyLimit('New Card', 'A deck can have up to nine cards named New Card.', 1), 9);
  assert.equal(DeckCheck.copyLimit('Opt', 'Scry 1.', 4), 4);
});
