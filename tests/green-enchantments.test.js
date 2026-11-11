// Green enchantments.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-enchantments-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every green enchantments card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("{G}: Regenerate enchanted creature."), "Enchanted creature has \"{G}: Regenerate this creature.\""); // Regeneration
  assert.equal(plain("At the beginning of your upkeep, distribute two +1/+1 counters among up to two target creatures. Then if you're the monarch, double the number of +1/+1 counters on each creature you control."), "At the beginning of your upkeep, put two +1/+1 counters on target creature you control."); // Court of Garenbrig
  assert.equal(plain("Whenever a land enters, its controller creates a 1/1 green Snake creature token."), "Whenever a land you control enters, create a 1/1 green Snake creature token."); // Seed the Land
  assert.equal(plain("When this Aura enters, put six +1/+1 counters on enchanted creature."), "Enchanted creature gets +6/+6."); // Shape of the Wiitigo
  assert.equal(plain("Enchanted land is a 6/4 green Elemental creature. It's still a land."), "When this Aura enters, create a 6/4 green Elemental creature token."); // Vastwood Zendikon
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Whenever this creature becomes blocked, untap up to three lands you control."), "This ability is never activated.");
});
