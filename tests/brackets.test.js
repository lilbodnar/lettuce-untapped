const test = require('node:test');
const assert = require('node:assert/strict');
const Brackets = require('../simulator/js/brackets.js');

// A 100-card deck: the given cards plus enough basic lands. cards: [{ name, oracle, cmc, gameChanger, qty }]
function deck(cards) {
  const defs = { cmd: { name: 'Some Commander', oracle: '', cmc: 4, gameChanger: false } };
  const rows = [{ id: 'cmd', name: 'Some Commander', qty: 1, commander: true }];
  cards.forEach((c, i) => {
    defs['c' + i] = { cmc: 2, oracle: '', gameChanger: false, ...c };
    rows.push({ id: 'c' + i, name: c.name, qty: c.qty || 1 });
  });
  defs.land = { name: 'Forest', oracle: '', cmc: 0, gameChanger: false };
  rows.push({ id: 'land', name: 'Forest', qty: 100 - rows.reduce((n, r) => n + r.qty, 0) });
  return Brackets.estimate(rows, id => defs[id]);
}

test('a plain deck is Bracket 2', () => {
  const e = deck([{ name: 'Grizzly Bears' }]);
  assert.equal(e.commander, true);
  assert.equal(e.bracket, 2);
  assert.deepEqual(e.reasons, []);
});

test('Game Changers: 1 to 3 is Bracket 3, more is 4', () => {
  const gc = n => Array.from({ length: n }, (_, i) => ({ name: 'GC ' + i, gameChanger: true }));
  assert.equal(deck(gc(1)).bracket, 3);
  assert.equal(deck(gc(3)).bracket, 3);
  assert.equal(deck(gc(4)).bracket, 4);
  assert.equal(deck(gc(2)).gameChangers.length, 2);
});

test('tutors: card tutors count, land searches do not', () => {
  assert.equal(Brackets.isTutor('Search your library for a card, put that card into your hand, then shuffle.'), true);
  assert.equal(Brackets.isTutor('Search your library for a green creature card with mana value X or less, put it onto the battlefield.'), true);
  assert.equal(Brackets.isTutor('Search your library for up to two basic land cards, reveal those cards.'), false);
  assert.equal(Brackets.isTutor('Pay 1 life, Sacrifice Flooded Strand: Search your library for a Plains or Island card.'), false);
  assert.equal(Brackets.isTutor('Search your library for any number of cards named Squadron Hawk.'), false);
  const tutor = { name: 'Tutor', oracle: 'Search your library for a card and put it into your hand.' };
  assert.equal(deck([tutor, tutor, tutor].map((t, i) => ({ ...t, name: 'Tutor ' + i }))).bracket, 2);
  assert.equal(deck([{ ...tutor, qty: 4 }]).bracket, 3);
});

test('extra turns and mass land denial', () => {
  assert.equal(Brackets.isExtraTurn('Take an extra turn after this one.'), true);
  assert.equal(Brackets.isExtraTurn('Target player takes an extra turn after this one.'), true);
  assert.equal(Brackets.isLandDenial('Destroy all lands.'), true);
  assert.equal(Brackets.isLandDenial('Destroy all artifacts, creatures, and lands. Jokulhaups can\'t be regenerated.'), true);
  assert.equal(Brackets.isLandDenial('Nonbasic lands are Mountains.'), true);
  assert.equal(Brackets.isLandDenial('Players can\'t untap more than one land during their untap steps.'), true);
  assert.equal(Brackets.isLandDenial('Destroy target land.'), false);
  assert.equal(Brackets.isLandDenial('Destroy all creatures. They can\'t be regenerated.'), false);
  assert.equal(deck([{ name: 'Armageddon', oracle: 'Destroy all lands.' }]).bracket, 4);
  const turn = { oracle: 'Take an extra turn after this one.' };
  assert.equal(deck([1, 2].map(i => ({ ...turn, name: 'Turn ' + i }))).bracket, 2);
  assert.equal(deck([1, 2, 3].map(i => ({ ...turn, name: 'Turn ' + i }))).bracket, 3);
  assert.equal(deck([1, 2, 3, 4, 5].map(i => ({ ...turn, name: 'Turn ' + i }))).bracket, 4);
});

test('two-card combos: early ones are Bracket 4, late ones 3', () => {
  const early = deck([{ name: "Thassa's Oracle", cmc: 2 }, { name: 'Demonic Consultation', cmc: 1 }]);
  assert.equal(early.combos.length, 1);
  assert.equal(early.combos[0].early, true);
  assert.equal(early.bracket, 4);
  const late = deck([{ name: 'Sanguine Bond', cmc: 5 }, { name: 'Exquisite Blood', cmc: 5 }]);
  assert.equal(late.combos[0].early, false);
  assert.equal(late.bracket, 3);
  assert.equal(deck([{ name: "Thassa's Oracle", cmc: 2 }]).combos.length, 0);
});

test('a 60-card deck without a commander is not a Commander deck', () => {
  const rows = [{ id: 'a', name: 'Shock', qty: 4 }, { id: 'b', name: 'Mountain', qty: 20 }];
  const e = Brackets.estimate(rows, id => ({ a: { name: 'Shock', oracle: '' }, b: { name: 'Mountain', oracle: '' } })[id]);
  assert.equal(e.commander, false);
});

test('cards without the Game Changer mark are counted as unchecked', () => {
  const e = Brackets.estimate([{ id: 'x', name: 'Old Card', qty: 1, commander: true }], () => ({ name: 'Old Card', oracle: '' }));
  assert.equal(e.unchecked, 1);
});
