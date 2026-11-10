// Black battles, artifacts and planeswalkers.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-perms-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every black battle, artifact and planeswalker here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('−2: Target player sacrifices a creature.'), '−2: Each opponent sacrifices a creature of their choice.'); // Liliana of the Veil
  assert.equal(plain('The Last Ride gets -X/-X, where X is your life total.'), 'This Vehicle can\'t attack or block.'); // The Last Ride
  assert.equal(plain('Chaosbringer — Equip—Pay 3 life. Activate only once each turn.'), 'Equip {2}'); // Dark Knight's Greatsword
  assert.equal(plain('You may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.'), 'This ability is never activated.'); // Bolas's Citadel (not applied)
});
