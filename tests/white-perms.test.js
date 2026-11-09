// White cards: Sagas, planeswalkers, artifacts and Auras.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-perms-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
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
const plain = l => Bot.parts.plainLine(l);
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every white Saga, planeswalker, artifact and Aura here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Auras read as the simpler lines they amount to', () => {
  assert.equal(plain('Whenever enchanted creature deals damage, you gain that much life.'), 'Enchanted creature has lifelink.'); // Spirit Link
  assert.equal(plain("Enchanted permanent can't attack or block, and its activated abilities can't be activated."), "Enchanted creature can't attack or block, and its activated abilities can't be activated."); // Detention Vortex
  assert.equal(plain("Enchanted creature has protection from blue. This effect doesn't remove this Aura."), 'Enchanted creature has protection from blue.'); // Blue Ward
  assert.equal(plain('Prevent all damage that would be dealt by enchanted creature.'), "Enchanted creature can't attack or block."); // Defang
});

test('switched-off Saga chapters keep their number; switched-off loyalty abilities keep a plus cost but lose a minus one', () => {
  assert.equal(plain('III — Each player chooses three nonland permanents they control. Destroy all other nonland permanents.'), 'III — Nothing happens here.');
  assert.equal(plain('+1: Up to one target artifact or creature loses all abilities until your next turn.'), '+1: Nothing happens here.');
  assert.equal(plain('−1: Whenever a creature attacks this turn, put a +1/+1 counter on it.'), 'This ability is never activated.'); // Basri, Devoted Paladin
});

test('Carrot Cake makes a Rabbit when it enters', () => {
  const game = vsOpp();
  const line = cards['Carrot Cake'].oracle.split('\n')[0];
  assert.match(plain(line), /^When this artifact enters, create a 1\/1 white Rabbit creature token and scry 1\./);
  Bot.runEffect(game, 'create a 1/1 white Rabbit creature token and scry 1', { self: put(game, 'Carrot Cake'), defOf, other: game.bot.s });
  assert.ok(game.zones.battlefield.some(i => game.cards[i].token && /rabbit/i.test(game.cards[i].typeLine || game.cards[i].name)));
});
