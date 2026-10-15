const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('../js/parser.js');

test('reads a full Archidekt export line', () => {
  assert.deepEqual(Parser.parseLine('1x Sol Ring (cmm) 410 *F* [Ramp] ^Buy,#0066ff^'), {
    qty: 1, name: 'Sol Ring', set: 'cmm', cn: '410', finish: 'foil', categories: ['Ramp'], inDeck: true, tags: ['Buy'],
  });
});

test('reads a plain "qty name" line', () => {
  const r = Parser.parseLine('4 Lightning Bolt');
  assert.equal(r.qty, 4);
  assert.equal(r.name, 'Lightning Bolt');
  assert.equal(r.set, null);
  assert.equal(r.finish, 'nonfoil');
});

test('keeps double-faced names and etched finish', () => {
  const r = Parser.parseLine('1x Delver of Secrets // Insectile Aberration (mid) 47 *E*');
  assert.equal(r.name, 'Delver of Secrets // Insectile Aberration');
  assert.equal(r.finish, 'etched');
  assert.equal(r.cn, '47');
});

test('{noDeck} categories are left out of the deck', () => {
  const r = Parser.parseLine('1x Opt (xln) 65 [Maybeboard{noDeck}{noPrice}]');
  assert.equal(r.inDeck, false);
  assert.deepEqual(r.categories, ['Maybeboard']);
});

test('section headings from Moxfield, Arena and MTGO lists', () => {
  const { entries, errors } = Parser.parse('Commander\n1 Lathril, Blade of the Elves\n\nDeck\n4 Llanowar Elves (m19) 314\nSIDEBOARD:\n2 Naturalize\n// Maybeboard\n1 Opt');
  assert.deepEqual(errors, []);
  assert.deepEqual(entries.map(e => [e.name, e.categories, e.inDeck]), [
    ['Lathril, Blade of the Elves', ['Commander'], true],
    ['Llanowar Elves', [], true],
    ['Naturalize', ['Sideboard'], false],
    ['Opt', ['Maybeboard'], false],
  ]);
});

test('skips blanks and comments, reports bad lines', () => {
  const { entries, errors } = Parser.parse('// Deck\n\n1 Island\nnot a card\r\n# note\n0 Swamp');
  assert.deepEqual(entries.map(e => e.name), ['Island']);
  assert.deepEqual(errors, ['not a card', '0 Swamp']);
});
