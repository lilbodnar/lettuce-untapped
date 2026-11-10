// Mono-white creatures with mana value 7 or more.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-7drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-white 7+ mana creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('When this creature enters, if your life total is less than your starting life total, it becomes equal to your starting life total.'), 'When this creature enters, you gain 10 life.'); // Resolute Archangel
  assert.equal(plain('When this creature enters, tap all nonwhite creatures.'), 'When this creature enters, tap all creatures your opponents control.'); // Ivory Giant
  assert.equal(plain('If you have 3 or less life, this spell costs {6} less to cast.'), ''); // Avatar of Hope (no discount)
  assert.equal(plain('Your opponents can\'t cast spells of the chosen color.'), 'This ability is never activated.'); // Iona (not applied)
});
