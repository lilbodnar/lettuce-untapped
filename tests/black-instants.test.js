// Black instants.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-instants-cards.json');
const plain = l => Bot.parts.plainLine(l);
const check = (name, oracle) => Coverage.check({ id: name, name, typeLine: 'Instant', manaCost: '{3}{B}{B}', cmc: 5, colors: ['B'], oracle }).you;

test('every black instant here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler spells they amount to', () => {
  assert.equal(plain('Destroy target creature if it has mana value 2 or less.'), 'Destroy target creature with mana value 2 or less.'); // Fatal Push
  assert.equal(plain('Search your library for a card, then shuffle and put that card on top. You lose 2 life.'), 'Search your library for a card, put it into your hand, then shuffle. You lose 2 life.'); // Vampiric Tutor
  assert.equal(plain('Search your library for a card, put that card into your graveyard, then shuffle.'), 'Mill three cards.'); // Entomb
  assert.equal(plain('Choose a creature type. Target player reveals their hand and discards all creature cards of that type. Then destroy all creatures of that type that player controls. They can\'t be regenerated.'), 'Destroy all creatures your opponents control.'); // Tsabo's Decree
});

test('spell-only costs are not applied, and pay-X-life spells still work elsewhere', () => {
  assert.equal(check('Corpse Lunge', 'As an additional cost to cast this spell, exile a creature card from your graveyard.\nThis spell deals 3 damage to target creature.'), 'all');
  assert.equal(check('Hatred', 'As an additional cost to cast this spell, pay X life.\nTarget creature gets +X/+0 until end of turn.'), 'all');
  assert.equal(check('Toxic Deluge', 'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.'), 'all');
});
