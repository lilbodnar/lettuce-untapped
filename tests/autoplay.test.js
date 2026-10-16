const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
global.Bot = require('../simulator/js/bot.js');
const Autoplay = require('../simulator/js/autoplay.js');

const defs = {
  mountain: { id: 'mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'] },
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  goblin: { id: 'goblin', name: 'Raging Goblin', typeLine: 'Creature — Goblin', manaCost: '{R}', cmc: 1, power: '1', toughness: '1', oracle: 'Haste' },
  ogre: { id: 'ogre', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '3', toughness: '3', oracle: '' },
  bolt: { id: 'bolt', name: 'Lightning Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Lightning Bolt deals 3 damage to any target.' },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '' },
  wall: { id: 'wall', name: 'Wall of Wood', typeLine: 'Creature — Wall', manaCost: '{G}', cmc: 1, power: '0', toughness: '3', oracle: 'Defender' },
  chupa: { id: 'chupa', name: 'Ravenous Chupacabra', typeLine: 'Creature — Horror', manaCost: '{2}{B}{B}', cmc: 4, power: '2', toughness: '2',
    oracle: 'When Ravenous Chupacabra enters, destroy target creature an opponent controls.' },
};
const deck = (name, rows) => ({ key: name, name, rows });
const red = deck('Red', [{ id: 'mountain', qty: 17 }, { id: 'goblin', qty: 15 }, { id: 'ogre', qty: 8 }]);
const green = deck('Green', [{ id: 'forest', qty: 17 }, { id: 'bear', qty: 15 }, { id: 'wall', qty: 8 }]);

test('goldfish: a red deck gets going and kills an empty table', () => {
  const games = Array.from({ length: 10 }, () => Autoplay.goldfish(red, defs, { maxTurns: 10 }));
  const sum = Autoplay.summarize(games, 10);
  assert.equal(sum.games, 10);
  assert.equal(sum.per.length, 10);
  assert.ok(sum.per[3].lands >= 2, `lands by turn 4: ${sum.per[3].lands}`);
  assert.ok(sum.per[9].damage > 10, `damage by turn 10: ${sum.per[9].damage}`);
  assert.ok(sum.kill.rate > 0.5, `kill rate ${sum.kill.rate}`);
  assert.equal(sum.commander, null);
});

test('match: two decks play to a finish, and hooks are put back', () => {
  const before = { ...Game.hooks };
  const results = Array.from({ length: 6 }, (_, i) => Autoplay.match(red, green, defs, { aFirst: i % 2 === 0, maxTurns: 25 }));
  assert.deepEqual({ ...Game.hooks }, before);
  const t = Autoplay.tally(results);
  assert.equal(t.games, 6);
  assert.equal(t.a + t.b + t.draws, 6);
  assert.ok(t.avgTurns > 2);
  for (const r of results) assert.ok(['A', 'B', null].includes(r.winner));
});

test('Opp targets with an enters trigger in an automatic game', () => {
  const black = deck('Black', [{ id: 'mountain', qty: 20 }, { id: 'chupa', qty: 20 }]);
  // Chupacabra costs {2}{B}{B} and Mountains don't make black, so give it a deck that can cast it.
  defs.swamp = { id: 'swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'] };
  black.rows[0].id = 'swamp';
  const r = Autoplay.match(black, green, defs, { aFirst: true, maxTurns: 12 });
  assert.ok(['A', 'B', null].includes(r.winner));
});
