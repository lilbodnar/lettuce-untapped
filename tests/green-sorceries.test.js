// Green sorceries.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-sorceries-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every green sorceries card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Target green creature you control gets +2/+2 until end of turn. It fights target green creature an opponent controls."), "Target creature you control fights target creature you don't control."); // Hunt the Hunter
  assert.equal(plain("Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library."), "Search your library for a creature card, put it onto the battlefield, then shuffle."); // Green Sun's Zenith
  assert.equal(plain("Hurricane deals X damage to each creature with flying and each player."), "This spell deals 2 damage to each creature with flying."); // Hurricane
  assert.equal(plain("Search your library for a green creature card, put it onto the battlefield, then shuffle."), "Search your library for a creature card, put it onto the battlefield, then shuffle."); // Natural Order
  assert.equal(plain("Put two target lands on top of their owners' libraries."), "Destroy target land."); // Plow Under
  assert.equal(plain("Destroy all enchantments. You gain 2 life for each enchantment destroyed this way."), "Destroy all enchantments."); // Multani's Decree
  assert.equal(plain("Discard any number of cards. Search your library for up to that many basic land cards, reveal them, put them into your hand, then shuffle."), "Search your library for a basic land card, reveal it, put it into your hand, then shuffle."); // Rites of Spring
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("You take the initiative."), "Nothing happens here.");
});
