// Red enchantments.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-enchantments-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every red enchantments card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("{R}: Enchanted creature gets +1/+0 until end of turn."), "Enchanted creature gets +1/+0."); // Firebreathing
  assert.equal(plain("{3}, Discard a card at random: This enchantment deals damage to any target equal to the mana value of the discarded card."), "{3}, Discard a card: This enchantment deals 2 damage to any target."); // Pyromancy
  assert.equal(plain("II — You may discard up to two cards. If you do, draw that many cards."), "II — Draw two cards, then discard two cards."); // Fable of the Mirror-Breaker // Reflection of Kiki-Jiki
  assert.equal(plain("{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step."), "{R}: Put a creature card from your hand onto the battlefield. It gains haste. Sacrifice it at the beginning of the next end step."); // Sneak Attack
  assert.equal(plain("Whenever a creature you control with power 2 or less attacks, this enchantment deals 1 damage to the player or planeswalker that creature is attacking."), "Whenever a creature you control with power 2 or less attacks, this enchantment deals 1 damage to each opponent."); // Raid Bombardment
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("At the beginning of your upkeep, you may flip a coin. If you win the flip, put a fuse counter on this enchantment. If you lose the flip, remove a fuse counter from this enchantment."), 'This ability is never activated.');
});
