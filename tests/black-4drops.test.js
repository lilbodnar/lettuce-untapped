// Mono-black creatures with mana value 4.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-4drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-black creatures with mana value 4 card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever an opponent draws a card, they lose 2 life."), "Whenever an opponent draws a card, that player loses 2 life."); // Sheoldred, the Apocalypse
  assert.equal(plain("At the beginning of each combat, any opponent may sacrifice a creature of their choice. If a player does, tap this creature and put a +1/+1 counter on it."), "At the beginning of combat on your turn, tap this creature."); // Desecration Demon
  assert.equal(plain("Whenever a source deals damage to this creature, that source's controller sacrifices that many permanents of their choice."), "Whenever this creature deals combat damage to a player, that player sacrifices a creature of their choice."); // Phyrexian Obliterator
  assert.equal(plain("At the beginning of each player's upkeep, that player sacrifices an artifact, creature, or land of their choice."), "At the beginning of each player's upkeep, that player sacrifices a creature of their choice."); // Braids, Cabal Minion
  assert.equal(plain("At the beginning of your upkeep, if this card is in your graveyard, you may exile a black creature card other than this card from your graveyard. If you do, return this card to the battlefield."), "{B}: Return this card from your graveyard to the battlefield. Activate only as a sorcery."); // Ichorid
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("When this creature leaves the battlefield, exile all Serf tokens."), 'This ability is never activated.');
});
