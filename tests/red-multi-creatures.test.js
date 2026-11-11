// Multicolor red creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-multi-creatures-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every multicolor red creatures card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("This creature has flying and trample if it devoured a creature."), "Flying, trample"); // Hellkite Hatchling
  assert.equal(plain("Whenever Radha attacks, you may add {R}{R}."), "Whenever this creature attacks, add {R}{R}."); // Radha, Heir to Keld
  assert.equal(plain("Whenever this creature or another creature you control enters, that creature fights target creature an opponent controls."), "Whenever another creature you control enters, it deals 2 damage to target creature an opponent controls."); // Gruul Ragebeast
  assert.equal(plain("Unrivaled Lethality — Double all damage Wolverine would deal."), "Double strike"); // Wolverine, Best There Is
  assert.equal(plain("This creature enters with X +1/+1 counters on it. If X is 5 or more, it enters with an additional X +1/+1 counters on it."), "This creature enters with three +1/+1 counters on it."); // Apocalypse Hydra
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("At the beginning of each upkeep, if no spells were cast last turn, transform Ulrich of the Krallenhorde."), "This ability is never activated.");
});
