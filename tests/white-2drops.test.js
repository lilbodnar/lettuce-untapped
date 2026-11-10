// Mono-white creatures with mana value 2.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-2drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-white 2 mana creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('Each other Human you control gets +1/+0 and has ward {1}.'), 'Other Humans you control get +1/+0.'); // Coppercoat Vanguard
  assert.equal(plain('When this creature enters, you may search your library for up to three cards named Squadron Hawk, reveal them, put them into your hand, then shuffle.'), 'When this creature enters, search your library for a card named Squadron Hawk, reveal it, put it into your hand, then shuffle.'); // Squadron Hawk (one)
  assert.equal(plain('Create X Map tokens, where X is one plus the number of opponents who control an artifact.'), 'Create a Map token.'); // Kellan's Journey On
});
