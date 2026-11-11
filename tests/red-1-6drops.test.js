// Mono-red creatures with mana value 0-1 or 6+.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-1-6drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-red creatures with mana value 0-1 or 6+ card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("When this creature enters, any opponent may have it deal 4 damage to them. If a player does, sacrifice this creature."), "When this creature enters, each opponent loses 4 life. Sacrifice this creature."); // Vexing Devil
  assert.equal(plain("When this creature enters, tap all other creatures."), "When this creature enters, tap target creature an opponent controls."); // Thundermare
  assert.equal(plain("Whenever this creature deals combat damage to a player, it deals that much damage to each creature that player controls."), "Whenever this creature deals combat damage to a player, it deals 3 damage to each creature your opponents control."); // Balefire Dragon
  assert.equal(plain("Max speed — This creature has double strike."), "Double strike"); // Burnout Bashtronaut
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("If a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead."), "This ability is never activated.");
});
