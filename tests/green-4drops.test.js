// Mono-green 4-drop creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-4drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-green 4-drop creatures card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever this creature attacks, put a +1/+1 counter on each attacking creature."), "Whenever this creature attacks, put a +1/+1 counter on each creature you control."); // Fangren Firstborn
  assert.equal(plain("When Polukranos becomes monstrous, it deals X damage divided as you choose among any number of target creatures your opponents control. Each of those creatures deals damage equal to its power to Polukranos."), "When this creature becomes monstrous, it deals 3 damage to target creature an opponent controls."); // Polukranos, World Eater
  assert.equal(plain("{T}: Add an amount of {G} equal to your devotion to green."), "{T}: Add {G}{G}."); // Karametra's Acolyte
  assert.equal(plain("You may exert this creature as it attacks. When you do, you may put a creature card from your hand onto the battlefield."), "Whenever this creature attacks, you may put a creature card from your hand onto the battlefield."); // Champion of Rhonas
  assert.equal(plain("Whenever this creature attacks, you may search your library for a basic land card that doesn't share a land type with a land you control, put that card onto the battlefield, then shuffle."), "Whenever this creature attacks, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle."); // Hiveheart Shaman
  assert.equal(plain("Whenever Leatherhead deals combat damage to a player, you may remove a counter from her. When you do, destroy target artifact or enchantment that player controls."), "Whenever this creature deals combat damage to a player, destroy target artifact or enchantment that player controls."); // Leatherhead, Swamp Stalker
  assert.equal(plain("At the beginning of combat on your turn, target Elf you control gains trample and gets +X/+X until end of turn, where X is the number of Forests you control."), "At the beginning of combat on your turn, target creature you control gets +2/+2 and gains trample until end of turn."); // Mirkwood Channeler
  assert.equal(plain("Whenever this creature attacks, you may have the base power and toughness of target Human you control become equal to this creature's power and toughness until end of turn."), "Whenever this creature attacks, another target creature you control gets +2/+2 until end of turn."); // Exuberant Wolfbear
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Whenever this creature deals combat damage to a creature, tap that creature and it doesn't untap during its controller's next untap step."), "This ability is never activated.");
});
