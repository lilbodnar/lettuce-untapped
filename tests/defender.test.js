const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
global.Bot = require('../simulator/js/bot.js');
const Coverage = require('../simulator/js/coverage.js');

const c = (id, name, typeLine, cost, cmc, pt, oracle) => {
  const [power, toughness] = pt ? pt.split('/') : [];
  return { id, name, typeLine, manaCost: cost, cmc, power, toughness, oracle };
};
const defs = {
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  arcades: c('arcades', 'Arcades, the Strategist', 'Legendary Creature — Elder Dragon', '{1}{G}{W}{U}', 4, '3/5',
    "Flying, vigilance\nWhenever a creature with defender you control enters, draw a card.\nEach creature you control with defender assigns combat damage equal to its toughness rather than its power and can attack as though it didn't have defender."),
  captain: c('captain', 'Perimeter Captain', 'Creature — Human Soldier', '{W}', 1, '0/4', 'Defender\nWhenever a creature you control with defender blocks, you may gain 2 life.'),
  doran: c('doran', 'Doran, the Siege Tower', 'Legendary Creature — Treefolk Shaman', '{B}{G}{W}', 3, '0/5', 'Each creature assigns combat damage equal to its toughness rather than its power.'),
  wall: c('wall', 'Wall of Wood', 'Creature — Wall', '{G}', 1, '0/3', 'Defender'),
  bear: c('bear', 'Grizzly Bears', 'Creature — Bear', '{1}{G}', 2, '2/2', ''),
};
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: 3 })).concat({ id: 'forest', qty: 30 }) });
const put = (s, id) => {
  const iid = [...s.zones.library, ...s.zones.hand].find(i => s.cards[i].id === id);
  Game.move(s, iid, 'battlefield');
  s.cards[iid].enteredTurn = -1;
  return s.cards[iid];
};
const vsOpp = (yours, opps) => {
  const game = Game.create(deck('You', yours), defs);
  game.bot = Bot.create(deck('Opp', opps), defs, { onDraw: true });
  game.life = 20;
  game.oppLife = 20;
  return game;
};
const st = (game, inst) => Bot.stats(inst, defOf(inst.id));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('Arcades: a creature with defender entering draws a card; one without does not', () => {
  const game = vsOpp(['arcades', 'wall', 'bear'], []);
  Game.hooks.entered = (s, inst) => Bot.creatureEntered(game, inst, defOf, {}, s);
  put(game, 'arcades');
  const hand = game.zones.hand.length;
  put(game, 'wall');
  assert.equal(game.zones.hand.length, hand + 1);
  put(game, 'bear');
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Arcades: your defenders can attack and deal damage equal to their toughness', () => {
  const game = vsOpp(['arcades', 'wall', 'bear'], []);
  const wall = put(game, 'wall');
  assert.ok(Bot.noAttack(st(game, wall)));
  const arcades = put(game, 'arcades');
  const bear = put(game, 'bear');
  Bot.refreshGrants(game, defOf);
  const w = st(game, wall);
  assert.ok(!Bot.noAttack(w));
  assert.equal(Bot.hitOf(w), 3);
  assert.equal(Bot.combat(w, []).player, 3);
  assert.ok(Bot.fight(w, st(game, bear)).b.dead); // a 0/3 kills a 2/2 blocking it
  assert.equal(Bot.hitOf(st(game, bear)), 2); // no defender: its power, as usual
  assert.ok(!st(game, arcades).kw.has('defender'));

  Bot.resolveYourAttack(game, [wall.iid], defOf);
  assert.equal(game.oppLife, 17);
});

test("Arcades on Opp's table only helps Opp's defenders; Doran helps everyone's creatures", () => {
  const game = vsOpp(['wall', 'bear'], ['arcades', 'wall', 'doran']);
  const yours = put(game, 'wall');
  const theirs = put(game.bot.s, 'wall');
  put(game.bot.s, 'arcades');
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.noAttack(Bot.botStats(theirs)));
  assert.ok(Bot.noAttack(st(game, yours)));
  assert.equal(Bot.hitOf(st(game, yours)), 0);

  put(game.bot.s, 'doran');
  const bear = put(game, 'bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.hitOf(st(game, yours)), 3);
  assert.ok(Bot.noAttack(st(game, yours))); // still can't attack: Doran doesn't do that
  assert.equal(Bot.hitOf(st(game, bear)), 2);
});

test('Perimeter Captain: you gain 2 life for each of your defenders that blocks', () => {
  const game = vsOpp(['captain', 'wall'], ['bear']);
  const captain = put(game, 'captain');
  const wall = put(game, 'wall');
  const s = game.bot.s;
  const a = put(s, 'bear');
  const b = put(s, 'bear');
  game.bot.pending = { attackers: [a.iid, b.iid], targets: {} };
  Bot.resolveOppAttack(game, { [a.iid]: [captain.iid], [b.iid]: [wall.iid] }, defOf);
  assert.equal(game.life, 24);
});

test("Opp's Perimeter Captain gains Opp life when it blocks", () => {
  const game = vsOpp(['bear'], ['captain']);
  put(game.bot.s, 'captain');
  const bear = put(game, 'bear');
  Bot.resolveYourAttack(game, [bear.iid], defOf);
  assert.equal(game.oppLife, 22);
});

test('coverage: Arcades, Perimeter Captain and Doran are all done; an unknown "with" is not', () => {
  for (const id of ['arcades', 'captain', 'doran']) {
    const r = Coverage.check(defs[id]);
    assert.equal(r.you, 'all', id);
    assert.equal(r.opp, 'all', id);
  }
  const odd = c('odd', 'Odd Watcher', 'Creature — Human', '{W}', 1, '1/1', 'Whenever a creature you control with toughness 4 or greater enters, draw a card.');
  assert.equal(Coverage.check(odd).you, 'none');
});
