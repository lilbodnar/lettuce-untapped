// Opp's play styles (game.bot.style): balanced (default), aggressive, careful, controlling.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;

const defs = {
  island: { id: 'island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '' },
  swamp: { id: 'swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '' },
  ogre: { id: 'ogre', name: 'Gray Ogre', typeLine: 'Creature — Ogre', manaCost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle: '' },
  brute: { id: 'brute', name: 'Hill Brute', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '5', toughness: '5', oracle: '' },
  glass: { id: 'glass', name: 'Glass Golem', typeLine: 'Creature — Golem', manaCost: '{1}', cmc: 1, power: '5', toughness: '1', oracle: '' },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '' },
  counter: { id: 'counter', name: 'Counterspell', typeLine: 'Instant', manaCost: '{U}{U}', cmc: 2, oracle: 'Counter target spell.' },
  murder: { id: 'murder', name: 'Murder', typeLine: 'Instant', manaCost: '{1}{B}{B}', cmc: 3, oracle: 'Destroy target creature.' },
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const find = (s, id) => ['library', 'hand', 'graveyard'].flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -5; return s.cards[iid]; };
const toHand = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'hand'); return s.cards[iid]; };
const rows = [{ id: 'island', qty: 6 }, { id: 'swamp', qty: 6 }, { id: 'ogre', qty: 2 }, { id: 'brute', qty: 2 }, { id: 'glass', qty: 2 }, { id: 'bear', qty: 4 }, { id: 'counter', qty: 2 }, { id: 'murder', qty: 2 }];
function table(style) {
  const game = Game.create(deck('You', rows), defs);
  game.bot = Bot.create(deck('Opp', rows), defs, { onDraw: true, style });
  game.life = 20; game.oppLife = 20;
  for (const s of [game, game.bot.s]) s.turn = 5;
  return game;
}

test('Bot.create keeps the style (balanced is the default and not stored)', () => {
  assert.deepEqual(Bot.STYLES, ['balanced', 'aggressive', 'careful', 'controlling']);
  assert.equal(Bot.create(deck('Opp', rows), defs, {}).style, undefined);
  assert.equal(Bot.create(deck('Opp', rows), defs, { style: 'balanced' }).style, undefined);
  assert.equal(Bot.create(deck('Opp', rows), defs, { style: 'careful' }).style, 'careful');
  assert.equal(Bot.create(deck('Opp', rows), defs, { style: 'nonsense' }).style, undefined);
});

test('attacking into an even trade: balanced and aggressive go, careful and controlling stay home', () => {
  for (const [style, goes] of [['balanced', true], ['aggressive', true], ['careful', false], ['controlling', false]]) {
    const game = table(style);
    put(game.bot.s, 'ogre');
    put(game, 'ogre'); // your 3/3 can block and trade
    assert.equal(Bot.chooseAttackers(game, defOf).length > 0, goes, style);
  }
});

test('trading down: only aggressive sends a 5/5 into a block that kills it for a smaller creature', () => {
  for (const [style, goes] of [['balanced', false], ['aggressive', true], ['careful', false]]) {
    const game = table(style);
    put(game.bot.s, 'glass'); // Opp's 5/1
    put(game, 'bear'); // your 2/2 kills it and dies
    assert.equal(Bot.chooseAttackers(game, defOf).length > 0, goes, style);
  }
});

test('counterspells: controlling counters a 2-drop, balanced waits for 3+, aggressive for 4+', () => {
  for (const [style, spell, counters] of [['controlling', 'bear', true], ['balanced', 'bear', false], ['balanced', 'ogre', true], ['aggressive', 'ogre', false], ['aggressive', 'brute', true]]) {
    const game = table(style);
    game.bot.respond = true;
    put(game.bot.s, 'island'); put(game.bot.s, 'island');
    toHand(game.bot.s, 'counter');
    const yours = game.cards[find(game, spell)];
    assert.equal(Bot.oppCounters(game, yours, defOf), counters, `${style} vs ${spell}`);
  }
});

test('removal: balanced keeps instant removal for your turn, aggressive uses it on its own turn', () => {
  for (const [style, now] of [['balanced', false], ['aggressive', true]]) {
    const game = table(style);
    game.bot.respond = true;
    for (let i = 0; i < 3; i++) put(game.bot.s, 'swamp');
    toHand(game.bot.s, 'murder');
    put(game, 'brute');
    assert.equal(Bot.castOptions(game, defOf).some(o => o.inst.id === 'murder'), now, style);
  }
});

test('controlling keeps mana open for its counterspell instead of tapping out for a creature', () => {
  for (const [style, casts] of [['balanced', true], ['controlling', false]]) {
    const game = table(style);
    for (let i = 0; i < 4; i++) put(game.bot.s, 'island');
    toHand(game.bot.s, 'counter');
    const ogre = toHand(game.bot.s, 'ogre');
    ogre.cost = '{3}'; game.bot.s.cards[ogre.iid].bot.cost = '{3}'; // castable off Islands for this check
    assert.equal(Bot.castOptions(game, defOf).some(o => o.inst === ogre), casts, style);
  }
});
