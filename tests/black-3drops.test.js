// Mono-black creatures with mana value 3.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-3drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-black creatures with mana value 3 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever this creature deals damage to an opponent, that player discards a card at random."), "Whenever this creature deals combat damage to a player, that player discards a card."); // Hypnotic Specter
  assert.equal(plain("When Rankle enters, you may pay 1 life. When you do, each player discards a card and sacrifices a creature."), "When this creature enters, each player sacrifices a creature of their choice."); // Rankle, Pitiless Trickster
  assert.equal(plain("At the beginning of your upkeep, sacrifice a creature other than this creature."), "At the beginning of your upkeep, sacrifice a creature."); // Demonic Taskmaster
  assert.equal(plain("Whenever this creature is dealt damage, sacrifice that many permanents."), "At the beginning of your upkeep, sacrifice a land."); // Phyrexian Negator
  assert.equal(plain("At the beginning of your end step, if an artifact or creature was put into a graveyard from the battlefield this turn, put a +1/+1 counter on this creature."), "At the beginning of your end step, if a creature died this turn, put a +1/+1 counter on this creature."); // Ichor Shade
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Rankle has lifelink and haste as long as an opponent controls no creatures."), 'This ability is never activated.');
});
