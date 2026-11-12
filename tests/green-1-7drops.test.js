// Mono-green creatures with mana value 0-1 or 7+.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-1-7drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-green creatures with mana value 0-1 or 7+ card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever a creature you control with mana value 7 or greater attacks, double its power and toughness until end of turn."), "Whenever this creature attacks, it gets +10/+10 until end of turn."); // Maular, the Next Evolution
  assert.equal(plain("When this creature dies, search your library for any number of creature cards with total mana value 6 or less, put them onto the battlefield, then shuffle."), "When this creature dies, search your library for a creature card, put it onto the battlefield, then shuffle."); // Protean Hulk
  assert.equal(plain("The Tarrasque has haste and ward {10} as long as it was cast."), "Haste"); // The Tarrasque
  assert.equal(plain("Devour land 3"), "This creature enters with six +1/+1 counters on it."); // Famished Worldsire
  assert.equal(plain("{3}: Until end of turn, this creature has base power 4 and gains trample."), "{3}: This creature gets +4/+0 and gains trample until end of turn."); // Turtle-Duck
  assert.equal(plain("When this creature enters, for each opponent, destroy target noncreature permanent that player controls. Search your library for up to X Forest cards, where X is the number of permanents destroyed this way, put those cards onto the battlefield tapped, then shuffle."), "When this creature enters, destroy target noncreature permanent an opponent controls."); // Sylvan Primordial
  assert.equal(plain("When this creature enters, distribute three +1/+1 counters among one, two, or three target creatures."), "When this creature enters, put three +1/+1 counters on target creature."); // Wurmskin Forger
  assert.equal(plain("Whenever this creature deals combat damage to a player, roll a d20. When you do, put X +1/+1 counters on each of up to two target creatures, where X is the result."), "Whenever this creature deals combat damage to a player, put five +1/+1 counters on target creature you control."); // Ancient Bronze Dragon
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Grazing type"), "This ability is never activated.");
});
