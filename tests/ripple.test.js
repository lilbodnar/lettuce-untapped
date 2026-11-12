// Ripple: the Surging spells skip it when cast (CAST_ONLY); on the two permanents (Surging Might, Surging Sentinels) it's not applied (NEAR.WP_SHARED).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./ripple-cards.json');

test('every Surging card (the Ripple 4 cards) is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Ripple on a permanent is a line that is not applied', () => {
  assert.ok(Bot.parts.NEAR.WP_SHARED.test('Ripple 4'));
  assert.ok(Bot.parts.NEAR.WP_SHARED.test('ripple 4.'));
});
