// Mono-black creatures with mana value 2.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-2drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-black creatures with mana value 2 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("When this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1."), "When this creature enters, it deals 1 damage to any target. Amass Orcs 1."); // Orcish Bowmasters
  assert.equal(plain("When Tourach enters, if it was kicked, target opponent discards two cards at random."), "When this creature enters, if it was kicked, each opponent discards two cards."); // Tourach, Dread Cantor
  assert.equal(plain("When this creature enters, target opponent reveals their hand. You choose a noncreature, nonland card from it. Exile that card until this creature leaves the battlefield."), "When this creature enters, each opponent discards a card."); // Kitesail Freebooter
  assert.equal(plain("At the beginning of your upkeep, tap this creature unless you pay 2 life."), "At the beginning of your upkeep, you lose 2 life."); // Sangrophage
  assert.equal(plain("Whenever one or more other creatures you control die, each opponent loses 2 life and you gain 2 life. This ability triggers only once each turn."), "Whenever another creature you control dies, each opponent loses 2 life and you gain 2 life. This ability triggers only once each turn."); // Vraan, Executioner Thane
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Whenever this creature deals combat damage to a player, if you've committed a crime this turn, you may sacrifice this creature. If you do, search your library for a card, put it into your hand, then shuffle."), 'This ability is never activated.');
});
