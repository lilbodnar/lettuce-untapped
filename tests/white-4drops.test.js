// Mono-white creatures with mana value 4.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-4drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-white 4 mana creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('When this creature dies, you may exile it. If you do, search your library for an enchantment card, put that card onto the battlefield, then shuffle.'), 'When this creature dies, search your library for an enchantment card, put it onto the battlefield, then shuffle.'); // Academy Rector
  assert.equal(plain('Humans you control have each of the chosen abilities.'), 'Humans you control have first strike and vigilance.'); // Greymond
  assert.equal(plain('Whenever a Sliver deals damage, its controller gains that much life.'), 'Slivers you control have lifelink.'); // Essence Sliver
  assert.equal(plain('Trample; banding'), 'Trample'); // (banding dropped)
});
