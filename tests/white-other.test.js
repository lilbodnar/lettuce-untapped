// The last two white "Other" cards: Astral's Prismatic Dragon and Rainbow Knights ("Summon Dragon" type lines,
// which js/scryfall.js now reads as "Creature — Dragon").
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-other-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('both are done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('they are creatures on the battlefield', () => {
  const defs = { ...cards };
  const game = Game.create({ key: 'You', name: 'You', rows: Object.keys(defs).map(id => ({ id, qty: 1 })) }, defs);
  const iid = ['library', 'hand'].flatMap(z => game.zones[z]).find(i => game.cards[i].id === 'Rainbow Knights');
  Game.move(game, iid, 'battlefield', { put: true });
  assert.ok(Game.isCreature(game.cards[iid]));
});

test("Rainbow Knights' abilities read as today's wordings", () => {
  assert.equal(plain('{1}: First strike until end of turn.'), '{1}: This creature gains first strike until end of turn.');
  assert.equal(plain('{W}{W}: +0/+0, +1/+0 or +2/+0 until end of turn chosen at random.'), '{W}{W}: This creature gets +1/+0 until end of turn.');
});
