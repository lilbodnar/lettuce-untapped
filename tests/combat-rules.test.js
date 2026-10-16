const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');

const defs = {
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '' },
  ogre: { id: 'ogre', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '3', toughness: '3', oracle: '' },
  arboria: { id: 'arboria', name: 'Arboria', typeLine: 'World Enchantment', manaCost: '{2}{G}{G}', cmc: 4,
    oracle: "Creatures can't attack a player unless that player cast a spell or put a nontoken permanent onto the battlefield during their last turn." },
  mirri: { id: 'mirri', name: 'Mirri, Weatherlight Duelist', typeLine: 'Legendary Creature — Cat Warrior', manaCost: '{1}{G}{W}', cmc: 3, power: '3', toughness: '2',
    oracle: "First strike\nWhenever Mirri, Weatherlight Duelist attacks, each opponent can't block with more than one creature this combat.\nAs long as Mirri, Weatherlight Duelist is tapped, no more than one creature can attack you each combat." },
  silverwing: { id: 'silverwing', name: 'Silverwing Squadron', typeLine: 'Creature — Human Knight', manaCost: '{5}{W}', cmc: 6, power: '*', toughness: '*',
    oracle: "Flying, vigilance\nSilverwing Squadron's power and toughness are each equal to the number of creatures you control.\nWhenever Silverwing Squadron attacks, create a number of 2/2 white Knight creature tokens with vigilance equal to the number of opponents you have." },
  sands: { id: 'sands', name: 'Brave the Sands', typeLine: 'Enchantment', manaCost: '{1}{W}', cmc: 2,
    oracle: 'Creatures you control have vigilance.\nEach creature you control can block an additional creature each combat.' },
  chaser: { id: 'chaser', name: 'Goblin Glory Chaser', typeLine: 'Creature — Goblin Warrior', manaCost: '{R}', cmc: 1, power: '1', toughness: '1',
    oracle: "Renown 1\nAs long as Goblin Glory Chaser is renowned, it has menace. (It can't be blocked except by two or more creatures.)" },
  oldMenace: { id: 'oldMenace', name: 'Old Brute', typeLine: 'Creature — Ogre', manaCost: '{2}{R}', cmc: 3, power: '3', toughness: '3',
    oracle: "Old Brute can't be blocked except by two or more creatures." },
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
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

test('Arboria: no attacking a player who did nothing last turn', () => {
  const game = vsOpp([{ id: 'arboria', qty: 1 }, { id: 'forest', qty: 39 }], [{ id: 'ogre', qty: 40 }]);
  const s = game.bot.s;
  put(game, 'arboria'); // you played it this turn
  put(s, 'ogre');
  s.actedTurn = undefined; // Opp's ogre came in before its last turn
  const rules = Bot.botRules(game, defOf);
  assert.equal(rules.you.arboria, true);
  assert.equal(rules.you.acted, true);
  assert.equal(Bot.attackRules(rules.all, rules.opp).cap, 0);
  assert.equal(Bot.attackRules(rules.all, rules.you).cap, Infinity);
  // Something played on someone else's turn doesn't count.
  game.offTurn = true;
  game.turn++;
  put(game, 'forest');
  assert.equal(Bot.tableRules(game, defOf).acted, false);
});

test('Mirri: tapped, only one creature can attack you; attacking, Opp blocks with only one', () => {
  const game = vsOpp([{ id: 'mirri', qty: 1 }, { id: 'bear', qty: 39 }], [{ id: 'bear', qty: 40 }]);
  const s = game.bot.s;
  const mirri = put(game, 'mirri');
  assert.equal(Bot.tableRules(game, defOf).attackCap, null);
  mirri.tapped = true;
  assert.equal(Bot.tableRules(game, defOf).attackCap, 1);
  const rules = Bot.botRules(game, defOf);
  assert.equal(Bot.attackRules(rules.all, rules.you).cap, 1);

  mirri.tapped = false;
  const bear = put(game, 'bear');
  put(s, 'bear');
  put(s, 'bear');
  assert.equal(Bot.blockRules([], [mirri, bear], defOf).cap, 1);
  Bot.resolveYourAttack(game, [mirri.iid, bear.iid], defOf);
  // Opp could block both with its two Bears, but only one may block.
  assert.ok(game.oppLife <= 18, `Opp at ${game.oppLife}`);
});

test("Silverwing Squadron: */* is the number of creatures you control, and it makes a Knight per opponent", () => {
  const game = vsOpp([{ id: 'silverwing', qty: 1 }, { id: 'bear', qty: 39 }], [{ id: 'forest', qty: 40 }]);
  game.opponents = 3;
  const sq = put(game, 'silverwing');
  put(game, 'bear');
  Bot.refreshGrants(game, defOf);
  let st = Bot.stats(sq, defOf('silverwing'));
  assert.deepEqual([st.pow, st.tou], [2, 2]);
  Bot.combatTrigger(game, sq, 'attacks', defOf);
  const knights = game.zones.battlefield.map(iid => game.cards[iid]).filter(c => c.token);
  assert.equal(knights.length, 3);
  assert.ok(knights.every(k => /Knight/.test(k.typeLine) && !k.tapped));
  Bot.refreshGrants(game, defOf);
  st = Bot.stats(sq, defOf('silverwing'));
  assert.deepEqual([st.pow, st.tou], [5, 5]);
});

test('Brave the Sands: one creature blocks two attackers and splits its damage', () => {
  const game = vsOpp([{ id: 'sands', qty: 1 }, { id: 'ogre', qty: 39 }], [{ id: 'bear', qty: 40 }]);
  const s = game.bot.s;
  put(game, 'sands');
  const ogre = put(game, 'ogre');
  assert.equal(Bot.blocksAllowed(game, ogre, defOf), 2);
  assert.equal(Bot.blocksAllowed(s, s.cards[s.zones.library[0]], defOf), 1);
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(ogre, defOf('ogre')).kw.has('vigilance'));

  // Two 2/2 Bears attack; the 3/3 blocks both: 2 kills the first, 1 to the second, and it takes 4.
  const a1 = put(s, 'bear');
  const a2 = put(s, 'bear');
  game.bot.pending = { attackers: [a1.iid, a2.iid], targets: {} };
  Bot.resolveOppAttack(game, { [a1.iid]: [ogre.iid], [a2.iid]: [ogre.iid] }, defOf);
  assert.equal(a1.zone, 'graveyard');
  assert.equal(a2.zone, 'battlefield');
  assert.equal(ogre.zone, 'graveyard');
  assert.equal(game.life, 20);
});

test('combatAll: a shared blocker that survives both fights', () => {
  const st = (pow, tou, kw = []) => ({ pow, tou, kw: new Set(kw), cmc: 0 });
  const wall = st(4, 5);
  const r = Bot.combatAll([
    { st: st(2, 2), blockers: [{ key: 'w', st: wall }] },
    { st: st(2, 2), blockers: [{ key: 'w', st: wall }] },
  ]);
  assert.equal(r[0].a.dead, true);
  assert.equal(r[1].a.dead, true);
  assert.equal(r[0].b[0].dead, false);
  assert.equal(r[1].b[0].dead, false); // 4 damage on a 5 toughness
});

test('menace in older words', () => {
  assert.deepEqual(Bot.keywords(defs.oldMenace.oracle), ['menace']);
  assert.deepEqual(Bot.keywords("Creatures you control can't be blocked except by two or more creatures."), []);
  assert.ok(Bot.attachBonus("Enchanted creature can't be blocked except by two or more creatures.").kw.includes('menace'));
});
