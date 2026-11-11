// Red sorceries.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-sorceries-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every red sorceries card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Arc Trail deals 2 damage to any target and 1 damage to any other target."), "This spell deals 3 damage to any target."); // Arc Trail
  assert.equal(plain("Chain Lightning deals 3 damage to any target. Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy."), "This spell deals 3 damage to any target."); // Chain Lightning
  assert.equal(plain("Destroy all artifacts, creatures, and lands. They can't be regenerated."), "Destroy all creatures. Destroy all lands."); // Jokulhaups
  assert.equal(plain("Any player may have Browbeat deal 5 damage to them. If no one does, target player draws three cards."), "Draw two cards."); // Browbeat
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Shuffle all permanents you own into your library, then reveal that many cards from the top of your library. Put all non-Aura permanent cards revealed this way onto the battlefield, then do the same for Aura cards, then put the rest on the bottom of your library in a random order."), "Nothing happens here.");
});
