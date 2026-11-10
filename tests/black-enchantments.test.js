// Black enchantments (Auras, Sagas, Curses, Classes, Cases and the rest).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-enchantments-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every black enchantment here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.'), 'Pay 2 life: Draw a card. Activate only once each turn.'); // Necropotence
  assert.equal(plain('When The Meathook Massacre enters, each creature gets -X/-X until end of turn.'), 'When this enchantment enters, creatures your opponents control get -2/-2 until end of turn.'); // The Meathook Massacre
  assert.equal(plain('At the beginning of your upkeep, target opponent discards a card for each Shrine you control.'), 'At the beginning of your upkeep, target opponent discards a card.'); // Honden of Night's Reach
  assert.equal(plain('If a card would be put into an opponent\'s graveyard from anywhere, exile it instead.'), 'This ability is never activated.'); // Leyline of the Void (not applied)
});
