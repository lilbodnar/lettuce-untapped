// Black sorceries.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-sorceries-cards.json');
const plain = l => Bot.parts.plainLine(l);
const check = (name, oracle, manaCost = '{2}{B}') => Coverage.check({ id: name, name, typeLine: 'Sorcery', manaCost, cmc: 3, colors: ['B'], oracle }).you;

test('every black sorcery here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('hand attacks and tutors read as the simpler spells they amount to', () => {
  assert.equal(plain('Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.'), 'Each opponent discards a card.'); // Thoughtseize
  assert.equal(plain('Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.'), 'Each opponent discards a card.'); // Duress
  assert.equal(plain('Target player discards two cards at random.'), 'Each opponent discards two cards.'); // Hymn to Tourach
  assert.equal(plain('Search your library for a nonlegendary card, put that card into your graveyard, then shuffle.'), 'Mill three cards.'); // Unmarked Grave
  assert.equal(plain('Draw four cards. You lose half your life, rounded up.'), 'Draw four cards. You lose 8 life.'); // Infernal Contract, Cruel Bargain
});

test('cards that share a cost line with working cards keep working', () => {
  assert.equal(check('Toxic Deluge', 'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.'), 'all');
  assert.equal(check('Bond of Agony', 'As an additional cost to cast this spell, pay X life.\nEach other player loses X life.', '{X}{B}'), 'all');
  assert.equal(check('Unhinge', 'Target player discards a card.\nDraw a card.'), 'all');
});
