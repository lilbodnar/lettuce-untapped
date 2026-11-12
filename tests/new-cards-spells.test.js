// New spells (Star Trek and other Nov 2026 cards).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./new-cards-spells-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every new spells (star trek and other nov 2026 cards) card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Planetary Bombardment deals 2 damage to target creature. Planetary Bombardment deals 4 damage to that creature instead if a creature died this turn."), "This spell deals 3 damage to target creature."); // Planetary Bombardment
  assert.equal(plain("Until end of turn, whenever a creature deals combat damage to you, destroy that creature and create a 2/1 red Klingon Warrior creature token with haste."), "Destroy target attacking creature. Create a 2/1 red Klingon Warrior creature token with haste."); // Right of Vengeance
  assert.equal(plain("Choose target noncreature spell an opponent controls. That player may exile it. If they don't, you may cast a noncreature spell from your hand without paying its mana cost."), "Counter target noncreature spell."); // Brazen Bluff
  assert.equal(plain("Strange new worlds — Draw X cards, where X is the number of differently named lands you control. You have no maximum hand size until your next turn."), "Draw three cards."); // Deep Space Scan
  assert.equal(plain("Double your life total. Draw cards equal to the number of cards in your hand. You have no maximum hand size until your next turn."), "Double your life total. Draw four cards."); // Live Long and Prosper
  assert.equal(plain("Federation — Exile target instant or sorcery card from your graveyard. Copy that card X times, where X is the number of creature types among non-Borg creatures you control. You may cast the copies without paying their mana costs. Exile Infinite Diversity."), "Return target instant or sorcery card from your graveyard to your hand."); // Infinite Diversity
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("• Follow the 98th Rule — Target opponent gains control of target nonland permanent you control. If they do, you draw three cards."), "• Nothing happens here.");
});
