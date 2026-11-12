// Bugs the random-deck games (smoke-games.js) found, each checked on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Autoplay = require('../simulator/js/autoplay.js');
const green5 = require('./green-5drops-cards.json');

const forest = { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] };
const bear = { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] };

// Seed 1115: the line read as "create a token that's a copy of it" without "if it isn't a token", so every
// copy made another one until the stack ran out.
test('The Notary Hobbits copy themselves once, not forever', () => {
  const hobbits = { ...green5['The Notary Hobbits'], id: 'hobbits' };
  const defs = { forest, bear, hobbits };
  const deck = name => ({ key: name, name, rows: [{ id: 'forest', qty: 20 }, { id: 'hobbits', qty: 20 }] });
  let most = 0;
  const r = Autoplay.match(deck('A'), { key: 'B', name: 'B', rows: [{ id: 'forest', qty: 20 }, { id: 'bear', qty: 20 }] }, defs, {
    aFirst: true, maxTurns: 8,
    check: players => { const s = players[0].s; most = Math.max(most, s.zones.battlefield.filter(iid => s.cards[iid].id === 'hobbits').length); },
  });
  assert.ok(['A', 'B', null].includes(r.winner));
  assert.ok(most >= 2, `the Hobbits should come with a copy (most on the battlefield: ${most})`);
  assert.ok(most <= 8, `at most a copy for each one cast (most on the battlefield: ${most})`);
});

// Seed 1174: "put a +1/+1 counter on each of up to X target creatures" ran runEffect('support x'), which
// reads back into that same line: endless.
test('support X spelled out puts its counters and stops', () => {
  const game = Bot.create({ key: 'Opp', name: 'Opp', rows: [{ id: 'bear', qty: 9 }] }, { bear }).s; // (Opp's table: its cards carry the facts Opp reads)
  const bears = game.zones.library.slice(0, 3).map(iid => { Game.move(game, iid, 'battlefield', { put: true }); return game.cards[iid]; });
  const self = { name: 'Blitzball Stadium', xValue: 2 };
  Bot.runEffect(game, 'Put a +1/+1 counter on each of up to X target creatures.', { self, defOf: id => ({ bear })[id], other: null });
  const counted = bears.map(b => (b.counters || {})['+1/+1'] || 0);
  assert.equal(counted.reduce((a, b) => a + b, 0), 2);
});
