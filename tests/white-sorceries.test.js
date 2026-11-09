// White sorceries (mono and multicolor).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-sorceries-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Gold: { id: 'Gold', name: 'Gold Bear', typeLine: 'Creature — Bear', manaCost: '{G}{W}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G', 'W'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids, qty = {}) => ({ key: name, name, rows: ids.map(id => ({ id, qty: qty[id] || 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs), { Plains: 10 }), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs), { Plains: 10 }), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'exile']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const run = (game, name, text) => Bot.runEffect(game, text, { self: { name }, other: game.bot.s, defOf });
const plain = l => Bot.parts.plainLine(l);
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every white sorcery here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Armageddon destroys every land on both sides', () => {
  const game = vsOpp();
  put(game, 'Plains');
  put(game.bot.s, 'Plains');
  run(game, 'Armageddon', 'destroy all lands');
  assert.equal(game.zones.battlefield.filter(i => Game.isLand(game.cards[i])).length, 0);
  assert.equal(game.bot.s.zones.battlefield.filter(i => Game.isLand(game.bot.s.cards[i])).length, 0);
});

test('Providence sets your life to 26; Revival // Revenge doubles it', () => {
  const game = vsOpp();
  run(game, 'Providence', 'your life total becomes 26');
  assert.equal(game.life, 26);
  run(game, 'Revenge', 'double your life total');
  assert.equal(game.life, 52);
});

test('Ravnica at War exiles only multicolored permanents', () => {
  const game = vsOpp();
  put(game.bot.s, 'Gold');
  const bear = put(game.bot.s, 'Bear');
  run(game, 'Ravnica at War', 'exile all multicolored permanents');
  assert.deepEqual(game.bot.s.zones.battlefield, [bear.iid]);
});

test('lines read as the simpler spells they amount to', () => {
  assert.equal(plain('If you have less life than an opponent, you gain 6 life. If you control fewer creatures than an opponent, create three 1/1 white Soldier creature tokens.'), 'You gain 6 life. Create three 1/1 white Soldier creature tokens.'); // Timely Reinforcements
  assert.equal(plain('Destroy all creatures and all permanents attached to creatures.'), 'Destroy all creatures.'); // End Hostilities
  assert.equal(plain('Choose up to four. You may choose the same mode more than once.'), 'Choose one —'); // Moment of Reckoning
  assert.equal(plain('Draw a card.'), 'Draw a card.'); // (shared lines that work elsewhere stay as they are)
});
