// Mono-green 2-drop creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-2drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-green 2-drop creatures card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever this creature deals combat damage to a player, you may remove a deathtouch counter from it. When you do, exile target artifact or enchantment that player controls."), "Whenever this creature deals combat damage to a player, exile target artifact or enchantment that player controls."); // Kappa Tech-Wrecker
  assert.equal(plain("Undergrowth — When this creature enters, choose up to one target creature you don't control with flying. This creature gets +X/+0 until end of turn, where X is the number of creature cards in your graveyard, then you may have this creature fight that creature."), "When this creature enters, this creature fights target creature you don't control."); // Kraul Harpooner
  assert.equal(plain("{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard."), "{G}, {T}: Mill three cards."); // Hermit Druid
  assert.equal(plain("You may exert this creature as it attacks. When you do, it gets +1/+0 and gains deathtouch until end of turn."), "Whenever this creature attacks, it gets +1/+0 and gains deathtouch until end of turn."); // Bitterblade Warrior
  assert.equal(plain("{X}{B}: Return target creature card with mana value X from your graveyard to the battlefield with a finality counter on it. Activate only as a sorcery."), "{3}{B}: Return target creature card with mana value 2 or less from your graveyard to the battlefield. Activate only as a sorcery."); // Jet Collector
  assert.equal(plain("Landfall — Whenever a land you control enters, double Tifa Lockhart's power until end of turn."), "Whenever a land you control enters, this creature gets +1/+0 until end of turn."); // Tifa Lockhart
  assert.equal(plain("Discard a card: This creature gets +1/+1 and becomes the color of your choice until end of turn."), "Discard a card: This creature gets +1/+1 until end of turn."); // Wild Mongrel
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("{1}{G}: Add one mana of any color."), "This ability is never activated.");
});
