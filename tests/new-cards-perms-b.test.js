// New permanents B (Star Trek and other Nov 2026 cards).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./new-cards-perms-b-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every new permanents b (star trek and other nov 2026 cards) card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("I — Assimilate target nonartifact creature an opponent controls."), "I — Exile target nonartifact creature an opponent controls."); // The Best of Both Worlds
  assert.equal(plain("Whenever this Spacecraft enters or attacks, assimilate a creature card exiled with it. If you can't, exile up to one target creature."), "Whenever this Spacecraft enters or attacks, exile up to one target creature an opponent controls."); // Borg Cube
  assert.equal(plain("When Genesis Device enters, search your library for a basic land card or Planet card, put it onto the battlefield tapped, then shuffle."), "When this artifact enters, search your library for a basic land card, put it onto the battlefield tapped, then shuffle."); // Genesis Device
  assert.equal(plain("Parley — At the beginning of combat on your turn, each player reveals the top card of their library, then draws a card. For each nonland card revealed this way, put a +1/+1 counter on Ambassador K'Ehleyr."), "At the beginning of combat on your turn, each player draws a card. Put a +1/+1 counter on this creature."); // Ambassador K'Ehleyr
  assert.equal(plain("When Grilka enters, gain control of target creature an opponent controls until end of turn. Untap it. Until end of turn, it gains trample, haste, and \"Whenever this creature deals combat damage to a player, create that many tapped Treasure tokens.\""), "When this creature enters, gain control of target creature an opponent controls until end of turn. Untap that creature. It gains haste until end of turn."); // Grilka, Widowed Warrior
  assert.equal(plain("When Khan enters, he deals 1 damage to each opponent and each creature your opponents control."), "When this creature enters, it deals 1 damage to each creature your opponents control. Each opponent loses 1 life."); // Khan, Despot by Design
  assert.equal(plain("Landfall — Whenever a land you control enters, Captain Burnham deals 1 damage to each opponent. If this is the second time this ability has resolved this turn, put a +1/+1 counter on Captain Burnham."), "Whenever a land you control enters, this creature deals 1 damage to each opponent."); // Captain Michael Burnham
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("{T}: Each opponent exiles a card from their graveyard. You may exile a card from your graveyard."), "This ability is never activated.");
});
