// Mono-green 5-drop creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-5drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-green 5-drop creatures card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever this creature becomes blocked, you may destroy target artifact or enchantment defending player controls."), "Whenever this creature attacks, destroy target artifact or enchantment an opponent controls."); // Rust Scarab
  assert.equal(plain("When Bartz and Boko enters, each other Bird you control deals damage equal to its power to target creature an opponent controls."), "When this creature enters, it deals 4 damage to target creature an opponent controls."); // Bartz and Boko
  assert.equal(plain("When this creature dies, seek two Forest cards and put them onto the battlefield."), "When this creature dies, search your library for up to two Forest cards, put them onto the battlefield tapped, then shuffle."); // Wildgrove Summoner
  assert.equal(plain("When this creature enters, if it was kicked, you may reveal cards from the top of your library until you reveal a creature card. If you do, put that card onto the battlefield and shuffle all other cards revealed this way into your library."), "When this creature enters, if it was kicked, search your library for a creature card, put it onto the battlefield, then shuffle."); // Thicket Elemental
  assert.equal(plain("Whenever this permanent enters or attacks, create a tapped colorless land token named Everywhere that is every basic land type."), "Whenever this creature enters or attacks, search your library for a basic land card, put it onto the battlefield tapped, then shuffle."); // Overlord of the Hauntwoods
  assert.equal(plain("When God-Eternal Rhonas enters, double the power of each other creature you control until end of turn. Those creatures gain vigilance until end of turn."), "When this creature enters, creatures you control get +2/+0 and gain vigilance until end of turn."); // God-Eternal Rhonas
  assert.equal(plain("Whenever Emissary Green attacks, starting with you, each player votes for profit or security. You create a number of Treasure tokens equal to twice the number of profit votes. Put a number of +1/+1 counters on each creature you control equal to the number of security votes."), "Whenever this creature attacks, create two Treasure tokens."); // Emissary Green
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Whenever you tap a land creature for mana, add an additional {G}."), "This ability is never activated.");
});
