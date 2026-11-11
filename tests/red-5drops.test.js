// Mono-red creatures with mana value 5.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-5drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-red creatures with mana value 5 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever another creature you control enters, this creature deals damage equal to that creature's power to any target."), "Whenever another creature you control enters, it deals 2 damage to target creature an opponent controls."); // Terror of the Peaks
  assert.equal(plain("At the beginning of your upkeep, exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, create a 3/1 red Dinosaur creature token. If you exiled a nonland card this way, create a Treasure token."), "At the beginning of your upkeep, exile the top two cards of your library. You may play them this turn."); // Bonehoard Dracosaur
  assert.equal(plain("Malignus's power and toughness are each equal to half the highest life total among your opponents, rounded up."), "This creature enters with five +1/+1 counters on it."); // Malignus
  assert.equal(plain("When this creature enters, you lose all but 1 life."), "When this creature enters, you lose 5 life."); // Soulgorger Orgg
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Whenever Ma Chao attacks alone, it can't be blocked this combat."), "This ability is never activated.");
});
