// Mono-black creatures with mana value 5.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-5drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-black creatures with mana value 5 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("At the beginning of each player's upkeep, that player loses 2 life and draws two cards."), "At the beginning of your upkeep, you draw two cards and you lose 2 life."); // Seizan, Perverter of Truth
  assert.equal(plain("{B}, Sacrifice X creatures: Target player draws X cards and gains X life. Put X +1/+1 counters on Krav."), "{B}, Sacrifice a creature: You draw a card and you gain 1 life. Put a +1/+1 counter on this creature."); // Krav, the Unredeemed
  assert.equal(plain("When Zodiark enters, each player sacrifices half the non-God creatures they control of their choice, rounded down."), "When this creature enters, each opponent sacrifices a creature of their choice."); // Zodiark, Umbral God
  assert.equal(plain("When this creature enters, destroy all lands you control. If it was kicked, destroy all lands instead."), "When this creature enters, sacrifice two lands."); // Desolation Angel
  assert.equal(plain("Evoke—{1}{B}{B}, Pay 3 life."), "Evoke {1}{B}{B}"); // Infestation
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("At end of combat, put a -0/-2 counter on each creature blocking or blocked by this creature."), 'This ability is never activated.');
});
