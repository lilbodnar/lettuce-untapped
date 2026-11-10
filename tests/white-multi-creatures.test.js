// White multicolor creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-multi-creatures-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every white multicolor creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain('Whenever you attack a player with one or more equipped creatures, draw a card.'), 'Whenever an equipped creature you control attacks, draw a card.'); // Akiri
  assert.equal(plain('Each creature you control gets +2/+0 for each Equipment attached to it.'), 'Equipped creatures you control get +2/+0.'); // Bruenor (one Equipment's worth)
  assert.equal(plain('Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.'), "Whenever another creature you control dies, return it to its owner's hand."); // Athreos (Opp never pays)
  assert.equal(plain('Whenever a player casts a spell, they lose 2 life.'), 'Whenever an opponent casts a spell, that player loses 2 life.'); // Liesa
  assert.equal(plain('Web-slinging {1}{G}{W}'), ''); // (alternative cost not offered)
  assert.equal(plain('Activated abilities of creatures your opponents control can\'t be activated.'), 'This ability is never activated.'); // Drana and Linvala (not applied)
});
