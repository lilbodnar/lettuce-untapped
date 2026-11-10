// White non-Aura enchantments (mono and multicolor).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-enchantments-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every white enchantment here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('When this enchantment enters, airbend up to one target creature.'), "When this enchantment enters, return up to one target creature to its owner's hand."); // Airbender Ascension
  assert.equal(plain('Whenever a creature you control deals combat damage, you gain that much life.'), 'Creatures you control have lifelink.'); // Noble Purpose
  assert.equal(plain('When this enchantment enters, exile all artifacts your opponents control until this enchantment leaves the battlefield.'), 'When this enchantment enters, exile target artifact an opponent controls until this enchantment leaves the battlefield.'); // Consulate Crackdown (one)
  assert.equal(plain('At the beginning of your upkeep, choose one at random. Create a red and white creature token with those characteristics.'), 'At the beginning of your upkeep, create a 2/1 red and white Human Cleric creature token with lifelink and haste.'); // Outlaws' Merriment (always the Cleric)
  assert.equal(plain('• 3/1 Human Warrior with trample and haste.'), '');
  assert.equal(plain('All creatures lose all abilities and have base power and toughness 1/1.'), 'This ability is never activated.'); // Humility (not applied)
  assert.equal(plain('{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.'), 'This ability is never activated.'); // Circles of Protection
});
