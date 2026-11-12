// The Commander pod's engine part: one computer player's turn against another (Autoplay.botTurn).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
global.Bot = require('../simulator/js/bot.js');
const Autoplay = require('../simulator/js/autoplay.js');

const defs = {
  mountain: { id: 'mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'] },
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  goblin: { id: 'goblin', name: 'Raging Goblin', typeLine: 'Creature — Goblin', manaCost: '{R}', cmc: 1, power: '1', toughness: '1', oracle: 'Haste' },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '' },
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const red = deck('Red', [{ id: 'mountain', qty: 17 }, { id: 'goblin', qty: 23 }]);
const green = deck('Green', [{ id: 'forest', qty: 17 }, { id: 'bear', qty: 23 }]);

test('a computer player takes whole turns against another and the damage lands on the other one', () => {
  const before = { ...Game.hooks };
  const A = { bot: Bot.create(red, defs, { style: 'aggressive' }), life: 40 };
  const D = { bot: Bot.create(green, defs, { onDraw: true }), life: 40 };
  let out = { defender: '', active: '' };
  for (let t = 0; t < 8 && !out.defender; t++) {
    out = Autoplay.botTurn(A, D, defOf);
    if (D.life > 0) Autoplay.botTurn(D, A, defOf); // the other one's turn back, as in a pod
  }
  assert.deepEqual({ ...Game.hooks }, before, 'the app\'s hooks are put back');
  assert.ok(A.bot.s.turn >= 3 && D.bot.s.turn >= 3, `both took turns (${A.bot.s.turn}, ${D.bot.s.turn})`);
  assert.ok(D.life < 40 || A.life < 40, `someone took damage (red ${A.life}, green ${D.life})`);
  assert.ok(A.bot.s.zones.battlefield.length > 0, 'red played its cards');
  assert.equal(typeof out.defender, 'string');
});
