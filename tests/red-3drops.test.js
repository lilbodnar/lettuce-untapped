// Mono-red creatures with mana value 3.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-3drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-red creatures with mana value 3 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("When this creature enters, it deals 1 damage to each opponent and each creature and planeswalker they control."), "When this creature enters, it deals 1 damage to each creature your opponents control. Each opponent loses 1 life."); // Goblin Chainwhirler
  assert.equal(plain("Whenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Goblin."), "Whenever this creature attacks, it gets +1/+0 until end of turn."); // Goblin Rabblemaster
  assert.equal(plain("When this creature enters, discard two cards, then draw two cards. For each nonland card discarded this way, create a 1/1 red Elemental creature token."), "When this creature enters, discard two cards, then draw two cards. Create a 1/1 red Elemental creature token."); // Seasoned Pyromancer
  assert.equal(plain("When this creature enters, search your library for a creature card with power 2 or less, reveal it, put it into your hand, then shuffle."), "When this creature enters, search your library for a creature card, reveal it, put it into your hand, then shuffle."); // Imperial Recruiter
  assert.equal(plain("{T}: This creature deals 2 damage to any target and 3 damage to you."), "{T}: This creature deals 2 damage to any target. You lose 3 life."); // Orcish Artillery
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("At the beginning of each combat, unless you pay {R}, whenever this creature blocks or becomes blocked by a creature this combat, that creature gains first strike until end of turn."), "This ability is never activated.");
});
