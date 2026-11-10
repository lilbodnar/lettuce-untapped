// Mono-white creatures with mana value 1.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-1drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-white 1-drop creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.'), '{T}: Another target creature you control gains hexproof until end of turn.'); // Giver of Runes
  assert.equal(plain('Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter).'), 'Whenever another creature you control enters, you gain 1 life and you get {E}.'); // Guide of Souls
  assert.equal(plain('As this creature enters, choose another creature you control.'), ''); // Dauntless Bodyguard (picks a target when sacrificed)
  assert.equal(plain('Sacrifice this creature: The chosen creature gains indestructible until end of turn.'), 'Sacrifice this creature: Another target creature you control gains indestructible until end of turn.');
  assert.equal(plain('I, II — Prevent all damage that would be dealt to creatures you control this turn.'), 'I, II — Nothing happens here.'); // Summon: Alexander
});
