// Colorless cards: the last other artifacts and colorless spells.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./artifacts-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Ogre: { id: 'Ogre', name: 'Ogre', typeLine: 'Creature — Ogre', manaCost: '{4}{R}', cmc: 5, power: '5', toughness: '5', oracle: '', colors: ['R'] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracle: '{T}: You gain 1 life.', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids, qty = {}) => ({ key: name, name, rows: ids.map(id => ({ id, qty: qty[id] || 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs), { Island: 10 }), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs), { Island: 10, Ogre: 2 }), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'exile']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), hitOpps: n => { game.oppLife -= n; }, ...extra });
const run = (game, self, text) => Bot.runEffect(game, text, ctx(game, { self }));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every artifact and colorless spell here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('sacrifice-for-mana artifacts add their mana (and draw when they say so)', () => {
  const game = vsOpp();
  const egg = put(game, 'Darkwater Egg');
  const hand = game.zones.hand.length;
  run(game, egg, 'This artifact makes {U}{B}. Draw a card.');
  assert.equal(game.pool.U, 1);
  assert.equal(game.pool.B, 1);
  assert.equal(game.zones.hand.length, hand + 1);
  assert.match(Bot.parts.plainLine("{1}, {T}, Sacrifice this artifact: Add one mana of any color."), /This artifact makes one mana of any color/);
});

test('Amulet of Vigor untaps what enters tapped; Mox Diamond needs a land to discard', () => {
  const game = vsOpp();
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game));
  put(game, 'Amulet of Vigor');
  const isl = game.cards[find(game, 'Island')];
  isl.tapped = true;
  Game.move(game, isl.iid, 'battlefield', { put: true });
  assert.equal(isl.tapped, false);
  game.zones.hand.filter(iid => Game.isLand(game.cards[iid])).forEach(iid => Game.move(game, iid, 'library'));
  const mox = put(game, 'Mox Diamond');
  Bot.enterTrigger(game, mox, defOf);
  assert.equal(mox.zone, 'graveyard');
});

test('Ensnaring Bridge stops big attackers; Null Rod stops artifact abilities', () => {
  const game = vsOpp();
  put(game, 'Ensnaring Bridge');
  [...game.zones.hand].slice(2).forEach(iid => Game.move(game, iid, 'library')); // two cards in hand
  const ogre = put(game.bot.s, 'Ogre');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(ogre, defOf('Ogre')).kw.has("can't attack"));
  put(game, 'Null Rod');
  const relic = put(game.bot.s, 'Relic');
  Bot.refreshGrants(game, defOf);
  assert.ok(relic.boosts.rodLock.noAbilities);
});

test('Throne of the God-Pharaoh drains per tapped creature; Doubling Cube doubles your mana', () => {
  const game = vsOpp();
  const throne = put(game, 'Throne of the God-Pharaoh');
  put(game, 'Bear').tapped = true;
  const life = game.oppLife;
  run(game, throne, 'Each opponent loses life equal to the number of tapped creatures you control.');
  assert.equal(game.oppLife, life - 1);
  game.pool = { U: 2 };
  run(game, put(game, 'Doubling Cube'), 'Double the amount of each type of unspent mana you have.');
  assert.equal(game.pool.U, 4);
});

test('devoid spells: Grip of Desolation exiles a creature and a land', () => {
  const game = vsOpp();
  put(game.bot.s, 'Ogre');
  put(game.bot.s, 'Island');
  run(game, { name: 'Grip of Desolation' }, 'Exile target creature and target land.');
  assert.equal(game.bot.s.zones.battlefield.length, 0);
});
