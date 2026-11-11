// Green instants.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-instants-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every green instants card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Look at the top six cards of your library. Put up to two creature cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in any order."), "Search your library for a creature card, put it onto the battlefield, then shuffle."); // Collected Company
  assert.equal(plain("Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle."), "Search your library for a creature card, put it onto the battlefield, then shuffle."); // Chord of Calling
  assert.equal(plain("Search your library for a green creature card, reveal it, put it into your hand, then shuffle."), "Search your library for a creature card, reveal it, put it into your hand, then shuffle."); // Summoner's Pact
  assert.equal(plain("Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn."), "Target creature gains hexproof until end of turn. Draw a card."); // Veil of Summer
  assert.equal(plain("Target creature gets +3/+3 until end of turn. If this spell was kicked, instead that creature gets +4/+4 and gains trample and haste until end of turn."), "Target creature gets +3/+3 until end of turn."); // Colossal Growth
  assert.equal(plain("Target creature you control deals damage equal to twice its power to target creature you don't control."), "Target creature you control deals damage equal to its power to target creature you don't control."); // Polliwallop
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Destroy all creatures that were blocked by target Wall this turn. They can't be regenerated. For each creature that died this way, put a creature card from the graveyard of the player who controlled that creature the last time it became blocked by that Wall onto the battlefield under its owner's control."), "Nothing happens here.");
});
