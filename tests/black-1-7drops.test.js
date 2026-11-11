// Mono-black creatures with mana value 0-1 or 7+.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-1-7drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-black creatures with mana value 0-1 or 7+ card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("{B}{B}{B}, {T}: Destroy target creature. If that creature dies this way, create a black Vampire creature token. Its power is equal to that creature's power and its toughness is equal to that creature's toughness."), "{B}{B}{B}, {T}: Destroy target creature."); // Kalitas, Bloodchief of Ghet
  assert.equal(plain("This creature gets -X/-X, where X is your life total."), "This creature enters with ten -1/-1 counters on it."); // Death's Shadow
  assert.equal(plain("Whenever Phage deals combat damage to a creature, destroy that creature. It can't be regenerated."), "Deathtouch"); // Phage the Untouchable
  assert.equal(plain("At the beginning of your upkeep, sacrifice a creature other than this creature. If you can't, this creature deals 7 damage to you."), "At the beginning of your upkeep, sacrifice a creature."); // Lord of the Pit
  assert.equal(plain("At the beginning of your upkeep, tap this creature unless you pay 1 life."), "At the beginning of your upkeep, you lose 1 life."); // Carnophage
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Whenever a suspected creature an opponent controls dies while Snarlfang Vermin is in your graveyard, that opponent loses 1 life."), 'This ability is never activated.');
});
