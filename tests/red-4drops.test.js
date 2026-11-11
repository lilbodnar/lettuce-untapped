// Mono-red creatures with mana value 4.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-4drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-red creatures with mana value 4 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever a creature you control attacks, this creature deals 1 damage to the player or planeswalker it's attacking."), "Whenever a creature you control attacks, each opponent loses 1 life."); // Hellrider
  assert.equal(plain("When this creature enters, it deals 1 damage to each opponent and 1 damage to each creature your opponents control."), "When this creature enters, it deals 1 damage to each creature your opponents control. Each opponent loses 1 life."); // Dagger Caster
  assert.equal(plain("When this creature enters, if it's on the battlefield, it deals damage equal to its power to target creature an opponent controls and that creature deals damage equal to its power to this creature."), "When this creature enters, this creature fights target creature you don't control."); // Stalking Yeti
  assert.equal(plain("Whenever this creature attacks, it deals 6 damage to each creature defending player controls."), "Whenever this creature attacks, it deals 2 damage to each creature your opponents control."); // Lord of Shatterskull Pass
  assert.equal(plain("When Elektra enters, you may have her deal 2 damage to you. When you do, she deals 4 damage to target creature."), "When this creature enters, it deals 4 damage to target creature an opponent controls. You lose 2 life."); // Elektra, Femme Fatale
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("When this creature attacks, up to one target creature defending player controls blocks it this combat if able."), "This ability is never activated.");
});
