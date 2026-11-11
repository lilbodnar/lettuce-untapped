// Mono-black creatures with mana value 6.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-6drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-black creatures with mana value 6 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("When this creature enters, each opponent sacrifices a creature."), "When this creature enters, each opponent sacrifices a creature of their choice."); // Goremand
  assert.equal(plain("When this creature enters, each opponent discards a card and loses 2 life. You draw a card and gain 2 life."), "When this creature enters, each opponent discards a card. Each opponent loses 2 life. You draw a card and you gain 2 life."); // Arbiter of Woe
  assert.equal(plain("Whenever Nefarox attacks alone, defending player sacrifices a creature of their choice."), "Whenever this creature attacks, each opponent sacrifices a creature of their choice."); // Nefarox, Overlord of Grixis
  assert.equal(plain("When this creature enters or dies, exile another card from a graveyard. When you do, choose one —"), "When this creature enters or dies, target creature an opponent controls gets -2/-2 until end of turn."); // Cemetery Desecrator
  assert.equal(plain("As this creature enters, pay any amount of life."), "When this creature enters, you lose 3 life."); // Minion of the Wastes
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("As long as Doom Weaver is paired with another creature, each of those creatures has \"When this creature dies, draw cards equal to its power.\""), 'This ability is never activated.');
});
