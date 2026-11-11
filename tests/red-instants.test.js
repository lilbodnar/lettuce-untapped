// Red instants.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-instants-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every red instants card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Searing Blaze deals 1 damage to target player or planeswalker and 1 damage to target creature that player or that planeswalker's controller controls."), "This spell deals 3 damage to target creature. This spell deals 3 damage to each opponent."); // Searing Blaze
  assert.equal(plain("Chandra's Outrage deals 4 damage to target creature and 2 damage to that creature's controller."), "This spell deals 4 damage to target creature. This spell deals 2 damage to each opponent."); // Chandra's Outrage
  assert.equal(plain("You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice that creature at the beginning of the next end step."), "Put a creature card from your hand onto the battlefield. It gains haste. Sacrifice it at the beginning of the next end step."); // Through the Breach
  assert.equal(plain("Players can't gain life this turn. Damage can't be prevented this turn. Skullcrack deals 3 damage to target player or planeswalker."), "This spell deals 3 damage to target player or planeswalker."); // Skullcrack
  assert.equal(plain("Rock Slide deals X damage divided as you choose among any number of target attacking or blocking creatures without flying."), "This spell deals 3 damage to target creature."); // Rock Slide
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player."), "Nothing happens here.");
});
