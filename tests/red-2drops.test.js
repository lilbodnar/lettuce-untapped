// Mono-red creatures with mana value 2.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./red-2drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-red creatures with mana value 2 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever a player casts a spell with mana value 3 or less, this creature deals 2 damage to that player."), "Whenever an opponent casts a spell, this creature deals 1 damage to that player."); // Eidolon of the Great Revel
  assert.equal(plain("Whenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin."), "Whenever this creature attacks, it gets +2/+0 until end of turn."); // Goblin Piledriver
  assert.equal(plain("Whenever this creature attacks, you may cast target instant or sorcery card with mana value less than or equal to this creature's power from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead."), "Whenever this creature attacks, return target instant or sorcery card with mana value 1 or less from your graveyard to your hand."); // Dreadhorde Arcanist
  assert.equal(plain("{T}: This creature deals 1 damage to any target and 1 damage to you."), "{T}: This creature deals 1 damage to any target. You lose 1 life."); // Fireslinger
  assert.equal(plain("This creature gets -1/-1 for each other creature on the battlefield."), "This creature enters with a -1/-1 counter on it."); // Mogg Squad
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("This creature can't block creatures with power greater than this creature's power."), "This ability is never activated.");
});
