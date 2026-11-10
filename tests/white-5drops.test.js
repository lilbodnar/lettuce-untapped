// Mono-white creatures with mana value 5.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-5drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-white 5 mana creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('Flying, first strike, lifelink, protection from Demons and from Dragons'), 'Flying, first strike, lifelink'); // Baneslayer Angel
  assert.equal(plain("When this creature enters, exile up to one other target creature. That creature's controller gains life equal to its power."), 'When this creature enters, exile up to one target creature an opponent controls. Its controller gains life equal to its power.'); // Solitude
  assert.equal(plain('Psychic Defense — When this creature enters, tap all creatures you don\'t control.'), 'When this creature enters, tap all creatures your opponents control.'); // Githzerai Monk
  assert.equal(plain('Soulshift 4'), '');
});
