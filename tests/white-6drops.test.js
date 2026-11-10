// Mono-white creatures with mana value 6.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-6drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-white 6 mana creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Sacrifice Lena: Creatures you control with power less than Lena's power gain indestructible until end of turn."), 'Sacrifice this creature: Other creatures you control gain indestructible until end of turn.'); // Lena
  assert.equal(plain('When Yosei dies, target player skips their next untap step. Tap up to five target permanents that player controls.'), 'When this creature dies, tap all creatures your opponents control.'); // Yosei
  assert.equal(plain('At the beginning of combat on your turn, you may attach any number of Equipment you control to target creature you control.'), 'At the beginning of combat on your turn, attach target Equipment you control to target creature you control.'); // Beatrix (one Equipment)
  assert.equal(plain('Soulshift 5'), ''); // (dropped)
});
