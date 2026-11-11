// Red artifacts, planeswalkers, battles and other cards.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-perms-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every red artifacts, planeswalkers, battles and other cards card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("−2: Chandra deals 4 damage to target creature and 2 damage to that creature's controller."), "−2: Chandra deals 4 damage to target creature. Chandra deals 2 damage to each opponent."); // Chandra, Flame's Fury
  assert.equal(plain("+1: Untap target Mountain. It becomes a 4/4 red Elemental creature until end of turn. It's still a land."), "+1: Untap target Mountain."); // Koth of the Hammer
  assert.equal(plain("When this Siege enters, it deals 4 damage to another target battle or opponent and 1 damage to up to one target creature."), "When this Siege enters, it deals 4 damage to target opponent. It deals 1 damage to target creature."); // Invasion of Regatha // Disciples of the Inferno
  assert.equal(plain("Double all damage equipped creature would deal."), "Equipped creature has double strike."); // Mjölnir, Hammer of Thor
  assert.equal(plain("When this artifact enters, it deals 4 damage to any target and 3 damage to you."), "When this artifact enters, it deals 4 damage to any target. You lose 3 life."); // Spicy Oatmeal Pizza
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("As long as this Vehicle has three or more fire counters on it, it's an artifact creature."), 'This ability is never activated.');
});
