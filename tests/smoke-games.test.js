// Whole games with random decks of real cards (see smoke-games.js): nothing may throw, and the game state
// must stay sound after every turn. The same seeds every run; a longer run: node tests/smoke-games.js 300 1000.
const test = require('node:test');
const assert = require('node:assert/strict');
const Smoke = require('./smoke-games.js');

test('random decks of real cards play whole games without breaking', () => {
  const games = Number(process.env.MTG_SMOKE_GAMES) || 12;
  const fails = Smoke.run(games, 1);
  assert.deepEqual(fails.map(f => `seed ${f.seed}: ${f.error.split('\n')[0]}`), []);
});
