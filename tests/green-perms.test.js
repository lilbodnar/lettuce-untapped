// Green artifacts, planeswalkers, battles and other cards.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-perms-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every green artifacts, planeswalkers, battles and other cards card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("+1: Up to one target creature gets +3/+3 and gains trample until end of turn."), "+1: Target creature gets +3/+3 and gains trample until end of turn."); // Garruk, Unleashed
  assert.equal(plain("+1: Target land you control becomes a 4/4 Elemental creature with trample. It's still a land."), "+1: Create a 4/4 green Elemental creature token with trample."); // Nissa, Worldwaker
  assert.equal(plain("Equipped creature gets +2/+0 and has \"Whenever this creature attacks, it gains your choice of trample or deathtouch until end of turn.\""), "Equipped creature gets +2/+0 and has trample."); // Hunter's Axe
  assert.equal(plain("+1: Distribute two +1/+1 counters among up to two target creatures. They gain trample until end of turn."), "+1: Put two +1/+1 counters on target creature. It gains trample until end of turn."); // Vivien, Arkbow Ranger
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Each creature you control with a +1/+1 counter on it has \"{T}: Add one mana of any color.\""), "This ability is never activated.");
});
