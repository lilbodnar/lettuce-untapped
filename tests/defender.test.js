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
  plains: { id: 'plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'] },
  arcades: c('arcades', 'Arcades, the Strategist', 'Legendary Creature — Elder Dragon', '{1}{G}{W}{U}', 4, '3/5',
    "Flying, vigilance\nWhenever a creature with defender you control enters, draw a card.\nEach creature you control with defender assigns combat damage equal to its toughness rather than its power and can attack as though it didn't have defender."),
  captain: c('captain', 'Perimeter Captain', 'Creature — Human Soldier', '{W}', 1, '0/4', 'Defender\nWhenever a creature you control with defender blocks, you may gain 2 life.'),
  doran: c('doran', 'Doran, the Siege Tower', 'Legendary Creature — Treefolk Shaman', '{B}{G}{W}', 3, '0/5', 'Each creature assigns combat damage equal to its toughness rather than its power.'),
  wall: c('wall', 'Wall of Wood', 'Creature — Wall', '{G}', 1, '0/3', 'Defender'),
  bearers: c('bearers', 'Stalwart Shield-Bearers', 'Creature — Human Soldier', '{1}{W}', 2, '0/3', 'Defender\nOther creatures you control with defender get +0/+2.'),
  expel: c('expel', 'Expel the Interlopers', 'Sorcery', '{3}{W}{W}', 5, null,
    'Choose a number between 0 and 10.\nDestroy all creatures with power greater than or equal to the chosen number.'),
  ogre: c('ogre', 'Hill Giant', 'Creature — Giant', '{3}{R}', 4, '3/3', ''),
  pride: c('pride', 'The Pride of Hull Clade', 'Legendary Creature — Crocodile Elk Turtle', '{10}{G}', 11, '2/15',
    'This spell costs {X} less to cast, where X is the total toughness of creatures you control.\nDefender\n{2}{U}{U}: Until end of turn, target creature you control gets +1/+0 and gains "Whenever this creature deals combat damage to a player, draw cards equal to its toughness" and can attack as though it didn\'t have defender.'),
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

test('Stalwart Shield-Bearers: other creatures you control with defender get +0/+2', () => {
  const game = vsOpp(['bearers', 'wall', 'bear'], ['wall']);
  const bearers = put(game, 'bearers');
  const wall = put(game, 'wall');
  const bear = put(game, 'bear');
  const theirs = put(game.bot.s, 'wall');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(game, wall).tou, 5);
  assert.equal(st(game, bearers).tou, 3); // "other"
  assert.equal(st(game, bear).tou, 2); // no defender
  assert.equal(Bot.botStats(theirs).tou, 3); // not Opp's
});

test('The Pride of Hull Clade costs {X} less, X being the total toughness of your creatures', () => {
  const game = vsOpp(['pride', 'bearers', 'wall', 'bear'], []);
  const pride = game.cards[game.zones.library.find(i => game.cards[i].id === 'pride')];
  assert.equal(Bot.selfDiscount(game, pride, defOf), 0);
  put(game, 'bearers');
  put(game, 'wall');
  put(game, 'bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.selfDiscount(game, pride, defOf), 3 + 5 + 2); // the wall has +0/+2 from the Shield-Bearers
});

test('The Pride of Hull Clade: its ability lets a wall attack and draw cards equal to its toughness', () => {
  const game = vsOpp(['pride', 'wall'], []);
  const pride = put(game, 'pride');
  const wall = put(game, 'wall');
  const ab = Bot.activatedAbilities(pride, defOf)[0];
  assert.equal(ab.mana, '{2}{U}{U}');
  const eff = Bot.targetEffect(ab.effect);
  assert.equal(eff.action, 'pump');
  assert.ok(eff.attack);
  assert.ok(Bot.canTarget(eff, wall, st(game, wall), true));
  Bot.applyTarget(game, game, wall, eff, pride.name, defOf);
  const w = st(game, wall);
  assert.equal(w.pow, 1);
  assert.ok(!Bot.noAttack(w));

  const hand = game.zones.hand.length;
  Bot.resolveYourAttack(game, [wall.iid], defOf);
  assert.equal(game.oppLife, 19);
  assert.equal(game.zones.hand.length, hand + 3);

  Game.endOfTurn(game);
  assert.ok(Bot.noAttack(st(game, wall)));
  assert.equal(Bot.activatedAbilities(wall, defOf).length, 0);
});

// Expel the Interlopers cast from your hand, resolved the way app.js does it (ctx from effectCtx).
const castExpel = (game, ctx) => {
  const expel = put(game, 'expel');
  Bot.spellResolve(game, game, expel, defOf, ctx);
  return expel;
};

test('Expel the Interlopers: you choose the number, then everything with that much power or more is destroyed', () => {
  const game = vsOpp(['expel', 'wall', 'bear'], ['ogre', 'wall']);
  const wall = put(game, 'wall');
  const bear = put(game, 'bear');
  const ogre = put(game.bot.s, 'ogre');
  const theirWall = put(game.bot.s, 'wall');
  const asked = [];
  const expel = castExpel(game, { defOf, chooseNumber: (min, max, src, then) => asked.push({ min, max, src, then }) });
  assert.deepEqual(asked, [{ min: 0, max: 10, src: 'Expel the Interlopers', then: 'Destroy all creatures with power greater than or equal to the chosen number' }]);
  assert.equal(expel.zone, 'graveyard');
  assert.equal(bear.zone, 'battlefield'); // nothing yet: it waits for your number

  // You pick 1 (app.js fills in the number): the walls stay.
  const v = Bot.wipeVictims(game, game.bot.s, asked[0].then.replace('the chosen number', '1'), defOf);
  assert.deepEqual(v.mine.map(x => x.c.name), ['Grizzly Bears']);
  assert.deepEqual(v.theirs.map(x => x.c.name), ['Hill Giant']);
  Bot.runEffect(game, asked[0].then.replace('the chosen number', '1'), { self: expel, other: game.bot.s, defOf });
  assert.equal(bear.zone, 'graveyard');
  assert.equal(ogre.zone, 'graveyard');
  assert.equal(wall.zone, 'battlefield');
  assert.equal(theirWall.zone, 'battlefield');
});

test('Expel the Interlopers with no one to ask (automatic games) picks the best number for its caster', () => {
  const game = vsOpp(['expel', 'wall', 'bear'], ['ogre']);
  const wall = put(game, 'wall');
  const bear = put(game, 'bear');
  const ogre = put(game.bot.s, 'ogre');
  castExpel(game, { defOf });
  assert.equal(ogre.zone, 'graveyard'); // 3 kills the ogre and spares your 2/2 and 0/3
  assert.equal(bear.zone, 'battlefield');
  assert.equal(wall.zone, 'battlefield');
});

test("Opp casts Expel the Interlopers only when it's worth it, and picks its own number", () => {
  const game = vsOpp(['bear', 'ogre'], ['expel', 'wall', 'plains']);
  const s = game.bot.s;
  const theirWall = put(s, 'wall');
  ['plains', 'plains', 'forest', 'forest', 'forest'].forEach(id => put(s, id));
  const expel = [...s.zones.library, ...s.zones.hand].find(i => s.cards[i].id === 'expel');
  Game.move(s, expel, 'hand');
  assert.ok(Bot.castOptions(game, defOf).every(o => o.iid !== expel), 'nothing of yours to destroy');

  const bear = put(game, 'bear');
  const ogre = put(game, 'ogre');
  assert.ok(Bot.castOptions(game, defOf).some(o => o.iid === expel));
  const notes = [];
  Bot.castOne(game, defOf, notes);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(ogre.zone, 'graveyard');
  assert.equal(theirWall.zone, 'battlefield');
});

test('coverage: the defender cards are all done; an unknown "with" is not', () => {
  assert.equal(Coverage.check(defs.pride).you, 'all');
  for (const id of ['arcades', 'captain', 'doran', 'bearers', 'expel']) {
    const r = Coverage.check(defs[id]);
    assert.equal(r.you, 'all', id);
    assert.equal(r.opp, 'all', id);
  }
  const odd = c('odd', 'Odd Watcher', 'Creature — Human', '{W}', 1, '1/1', 'Whenever a creature you control with toughness 4 or greater enters, draw a card.');
  assert.equal(Coverage.check(odd).you, 'none');
});
