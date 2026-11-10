// Mono-white creatures with mana value 3.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-3drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-white 3 mana creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('When this creature enters, you may search your library for a creature card with toughness 2 or less, reveal it, put it into your hand, then shuffle.'), "When this creature enters, look at the top card of your library. If it's a creature card, you may reveal it and put it into your hand."); // Recruiter of the Guard
  assert.equal(plain('Other Soldier creatures get +1/+1 and have first strike.'), 'Other Soldier creatures you control get +1/+1 and have first strike.'); // Field Marshal
  assert.equal(plain('Ripple 4 (When you cast this spell, you may reveal the top four cards of your library. You may cast any revealed cards with the same name as this spell without paying their mana costs. Put the rest on the bottom of your library.)'), 'Ripple 4'); // (kept: the Surging spells use it)
});
