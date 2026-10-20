const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');

const c = (id, name, typeLine, cost, cmc, pt, oracle) => {
  const [power, toughness] = pt ? pt.split('/') : [];
  return { id, name, typeLine, manaCost: cost, cmc, power, toughness, oracle };
};
const defs = {
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  bear: c('bear', 'Grizzly Bears', 'Creature — Bear', '{1}{G}', 2, '2/2', ''),
  monk: c('monk', 'Monastery Swiftspear', 'Creature — Human Monk', '{R}', 1, '1/2', 'Haste\nProwess'),
  bolt: c('bolt', 'Shock', 'Instant', '{R}', 1, null, 'Shock deals 2 damage to any target.'),
  divination: c('divination', 'Divination', 'Sorcery', '{2}{U}', 3, null, 'Draw two cards.'),
  bloodartist: c('bloodartist', 'Blood Artist', 'Creature — Vampire', '{1}{B}', 2, '0/1', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.'),
  zulaport: c('zulaport', 'Zulaport Cutthroat', 'Creature — Human Rogue Ally', '{1}{B}', 2, '1/1', 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.'),
  undying: c('undying', 'Strangleroot Geist', 'Creature — Spirit', '{G}{G}', 2, '2/1', 'Haste\nUndying (When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner\'s control with a +1/+1 counter on it.)'),
  persist: c('persist', 'Kitchen Finks', 'Creature — Ouphe', '{1}{G/W}{G/W}', 3, '3/2', 'When Kitchen Finks enters, you gain 2 life.\nPersist'),
  afterlife: c('afterlife', 'Ministrant of Obligation', 'Creature — Human Cleric', '{2}{W}', 3, '2/1', 'Afterlife 2'),
  pridemate: c('pridemate', "Ajani's Pridemate", 'Creature — Cat Soldier', '{1}{W}', 2, '2/2', "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate."),
  vortex: c('vortex', 'Sulfuric Vortex', 'Enchantment', '{1}{R}{R}', 3, null, "At the beginning of each player's upkeep, Sulfuric Vortex deals 2 damage to that player.\nIf a player would gain life, that player gains no life instead."),
  erebos: c('erebos', 'Erebos, God of the Dead', 'Legendary Enchantment Creature — God', '{3}{B}', 4, '5/7', "Indestructible\nYour opponents can't gain life."),
  prison: c('prison', 'Ghostly Prison', 'Enchantment', '{2}{W}', 3, null, "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."),
  thalia: c('thalia', 'Thalia, Guardian of Thraben', 'Legendary Creature — Human Soldier', '{1}{W}', 2, '2/1', 'First strike\nNoncreature spells cost {1} more to cast.'),
  exalted: c('exalted', 'Akrasan Squire', 'Creature — Human Soldier', '{W}', 1, '1/1', 'Exalted'),
  infect: c('infect', 'Glistener Elf', 'Creature — Phyrexian Elf Warrior', '{G}', 1, '1/1', 'Infect'),
  toxic: c('toxic', 'Bilious Skulldweller', 'Creature — Phyrexian Insect', '{B}', 1, '1/1', 'Deathtouch\nToxic 1'),
  wither: c('wither', 'Boggart Ram-Gang', 'Creature — Goblin Warrior', '{R/G}{R/G}{R/G}', 3, '3/3', 'Haste\nWither'),
  unblockable: c('unblockable', 'Phantom Warrior', 'Creature — Illusion Warrior', '{1}{U}{U}', 3, '2/2', "Phantom Warrior can't be blocked."),
  annihilator: c('annihilator', 'Ulamog\'s Crusher', 'Creature — Eldrazi', '{8}', 8, '8/8', 'Annihilator 2\nUlamog\'s Crusher attacks each combat if able.'),
  bushido: c('bushido', 'Devoted Retainer', 'Creature — Human Samurai', '{W}', 1, '1/1', 'Bushido 1'),
  flanker: c('flanker', 'Cavalry Master', 'Creature — Human Knight', '{2}{W}', 3, '2/2', 'Flanking'),
  decayed: c('decayed', 'Zombie', 'Creature — Zombie', '', 0, '2/2', 'Decayed'),
  cascade: c('cascade', 'Bloodbraid Elf', 'Creature — Elf Berserker', '{2}{R}{G}', 4, '3/2', 'Cascade\nHaste'),
  assault: c('assault', 'Relentless Assault', 'Sorcery', '{2}{R}{R}', 4, null, 'Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.'),
  monarch: c('monarch', 'Palace Jailer', 'Creature — Human Soldier', '{2}{W}{W}', 4, '2/2', 'When Palace Jailer enters, you become the monarch.'),
  pyro: c('pyro', 'Young Pyromancer', 'Creature — Human Shaman', '{1}{R}', 2, '2/1', 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.'),
  hydra: c('hydra', 'Hooded Hydra', 'Creature — Snake Hydra', '{X}{G}{G}', 2, '0/0', 'This creature enters with a +1/+1 counter on it for each other creature you control.'),
  ichor: c('ichor', 'Contagion Clasp', 'Sorcery', '{2}', 2, null, 'Proliferate.'),
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
  const game = Game.create(deck('You', yours.map(id => ({ id, qty: 3 })).concat({ id: 'forest', qty: 30 })), defs);
  game.bot = Bot.create(deck('Opp', opps.map(id => ({ id, qty: 3 })).concat({ id: 'forest', qty: 30 })), defs, { onDraw: true });
  game.life = 20;
  game.oppLife = 20;
  game.poison = 0;
  return game;
};
// The app's hooks, as app.js sets them.
const ctx = game => ({ hitOpps: n => { game.oppLife -= n; }, hitTarget: n => { game.oppLife -= n; } });
const hook = game => {
  Game.hooks.died = (s, inst, info) => Bot.afterDeath(game, s, inst, info || {}, defOf, ctx(game));
  Game.hooks.cast = (s, inst) => { if (s === game) { Bot.spellCast(game, game, inst, defOf, ctx(game)); Bot.spellResolve(game, game, inst, defOf, ctx(game)); } };
};
test.afterEach(() => { Game.hooks.died = null; Game.hooks.cast = null; });

test('prowess pumps when you cast a noncreature spell, not a creature', () => {
  const game = vsOpp(['monk', 'bolt', 'bear'], []);
  hook(game);
  const monk = put(game, 'monk');
  Game.move(game, [...game.zones.library, ...game.zones.hand].find(i => game.cards[i].id === 'bear'), 'hand');
  Game.move(game, game.zones.hand.find(i => game.cards[i].id === 'bear'), 'battlefield');
  assert.equal(monk.pump, undefined);
  const bolt = [...game.zones.library, ...game.zones.hand].find(i => game.cards[i].id === 'bolt');
  Game.move(game, bolt, 'hand');
  Game.move(game, bolt, 'battlefield');
  assert.deepEqual([monk.pump.pow, monk.pump.tou], [1, 1]);
});

test('a simple sorcery resolves by itself; Young Pyromancer makes a token', () => {
  const game = vsOpp(['divination', 'pyro'], []);
  hook(game);
  put(game, 'pyro');
  const d = [...game.zones.library, ...game.zones.hand].find(i => game.cards[i].id === 'divination');
  Game.move(game, d, 'hand');
  const hand = game.zones.hand.length - 1; // not counting Divination itself
  Game.move(game, d, 'battlefield');
  assert.equal(game.cards[d].zone, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 2);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(x => x.token && /Elemental/.test(x.typeLine)).length, 1);
});

test('Blood Artist and Zulaport drain when creatures die', () => {
  const game = vsOpp(['bloodartist', 'zulaport', 'bear'], ['bear']);
  hook(game);
  put(game, 'bloodartist');
  put(game, 'zulaport');
  const bear = put(game, 'bear');
  Game.move(game, bear.iid, 'graveyard'); // both see it: 1 + 1
  assert.equal(game.oppLife, 18);
  assert.equal(game.life, 22);
  const theirs = put(game.bot.s, 'bear');
  Game.move(game.bot.s, theirs.iid, 'graveyard'); // only Blood Artist sees Opp's creature
  assert.equal(game.oppLife, 17);
  assert.equal(game.life, 23);
});

test('undying and persist come back once; afterlife leaves Spirits', () => {
  const game = vsOpp(['undying', 'persist', 'afterlife'], []);
  hook(game);
  const g = put(game, 'undying');
  Game.move(game, g.iid, 'graveyard');
  assert.equal(g.zone, 'battlefield');
  assert.equal(g.counters['+1/+1'], 1);
  Game.move(game, g.iid, 'graveyard');
  assert.equal(g.zone, 'graveyard'); // had a +1/+1 counter
  const f = put(game, 'persist');
  Game.move(game, f.iid, 'graveyard');
  assert.equal(f.zone, 'battlefield');
  assert.equal(f.counters['-1/-1'], 1);
  const m = put(game, 'afterlife');
  Game.move(game, m.iid, 'graveyard');
  const spirits = game.zones.battlefield.map(i => game.cards[i]).filter(x => x.token && /Spirit/.test(x.typeLine));
  assert.equal(spirits.length, 2);
});

test("Ajani's Pridemate grows on life gain; Sulfuric Vortex and Erebos stop the gain", () => {
  const game = vsOpp(['pridemate', 'vortex'], ['erebos']);
  const p = put(game, 'pridemate');
  game.life += 3;
  Bot.lifeChanged(game, { you: 20, opp: 20 }, defOf, ctx(game));
  assert.equal(p.counters['+1/+1'], 1);
  const e = put(game.bot.s, 'erebos');
  game.life = 23;
  Bot.lifeChanged(game, { you: 20, opp: 20 }, defOf, ctx(game));
  assert.equal(game.life, 20); // Opp's Erebos: you can't gain life
  Game.move(game.bot.s, e.iid, 'exile');
  game.oppLife = 25;
  put(game, 'vortex');
  Bot.lifeChanged(game, { you: 20, opp: 20 }, defOf, ctx(game));
  assert.equal(game.oppLife, 20);
});

test('Ghostly Prison taxes attacks; Thalia taxes noncreature spells', () => {
  const game = vsOpp(['prison', 'thalia'], ['bear']);
  put(game, 'prison');
  const r = Bot.botRules(game, defOf);
  assert.equal(Bot.attackRules(r.all, r.you).tax, 2);
  put(game, 'thalia');
  const rules = Bot.botRules(game, defOf);
  const all = [{ rules: rules.opp, own: true }, { rules: rules.you, own: false }];
  const shock = { id: 'bolt', typeLine: 'Instant' };
  const bear = { id: 'bear', typeLine: 'Creature — Bear' };
  assert.equal(Bot.spellTax(all, shock, defOf), 1);
  assert.equal(Bot.spellTax(all, bear, defOf), 0);
  // Opp can't pay for its Bears to attack with no untapped lands.
  const s = game.bot.s;
  put(s, 'bear').enteredTurn = -1;
  game.bot.started = true;
  const res = Bot.beginCombat(game, defOf, {});
  assert.equal(res.attackers.length, 0);
});

test('exalted, infect, toxic, wither and unblockable in combat', () => {
  const game = vsOpp(['exalted', 'infect', 'toxic', 'wither', 'unblockable'], ['bear']);
  put(game, 'exalted');
  const elf = put(game, 'infect');
  Bot.resolveYourAttack(game, [elf.iid], defOf); // alone: +1/+1 from exalted, 2 poison
  assert.equal(game.bot.s.poison, 2);
  assert.equal(game.oppLife, 20);

  const g2 = vsOpp(['toxic'], []);
  const t = put(g2, 'toxic');
  Bot.resolveYourAttack(g2, [t.iid], defOf);
  assert.equal(g2.oppLife, 19);
  assert.equal(g2.bot.s.poison, 1);

  const st = (pow, tou, kw = []) => ({ pow, tou, kw: new Set(kw), cmc: 0 });
  assert.equal(Bot.canBlock(st(2, 2), st(2, 2, ['unblockable'])), false);
  assert.deepEqual(Bot.keywords(defs.unblockable.oracle), ['unblockable']);
  assert.equal(Bot.canBlock(st(2, 2, ['decayed']), st(2, 2)), false);
  const r = Bot.combat(st(3, 3, ['wither']), [st(1, 5)]);
  assert.deepEqual(Bot.witherCounters(st(3, 3, ['wither']), [st(1, 5)], r).b, [3]);
});

test('annihilator makes Opp sacrifice; bushido and flanking change the fight', () => {
  const game = vsOpp(['annihilator'], ['bear']);
  const s = game.bot.s;
  put(s, 'bear');
  put(s, 'forest');
  put(s, 'forest');
  const crusher = put(game, 'annihilator');
  const before = s.zones.battlefield.length;
  Bot.resolveYourAttack(game, [crusher.iid], defOf);
  assert.ok(s.zones.battlefield.length <= before - 2);

  const st = (pow, tou, kw = [], n = {}) => ({ pow, tou, kw: new Set(kw), n, cmc: 0 });
  // Bushido 1 attacker 1/1 blocked by a 2/2: it becomes 2/2 and trades.
  let [r] = Bot.combatAll([{ st: st(1, 1, ['bushido'], { bushido: 1 }), blockers: [{ key: 'b', st: st(2, 2) }] }]);
  assert.equal(r.b[0].dead, true);
  // Flanking 2/2 blocked by a 2/2: the blocker is 1/1, so the attacker lives.
  [r] = Bot.combatAll([{ st: st(2, 2, ['flanking']), blockers: [{ key: 'b', st: st(2, 2) }] }]);
  assert.equal(r.a.dead, false);
  assert.equal(r.b[0].dead, true);
});

test('cascade casts a cheaper card from the top for free', () => {
  const g = Game.create(deck('You', [{ id: 'cascade', qty: 1 }, { id: 'bear', qty: 1 }, { id: 'forest', qty: 10 }]), defs);
  hook(g);
  const find = id => Object.values(g.cards).find(x => x.id === id).iid;
  const bbe = find('cascade');
  const bear = find('bear');
  // Bloodbraid Elf in hand; library: two Forests, then the Bears.
  for (const iid of [...g.zones.hand]) Game.move(g, iid, 'library');
  Game.move(g, bbe, 'hand');
  g.zones.library = [...g.zones.library.filter(i => i !== bear).slice(0, 2), bear, ...g.zones.library.filter(i => i !== bear).slice(2)];
  Game.move(g, bbe, 'battlefield');
  assert.equal(g.cards[bear].zone, 'battlefield');
  assert.ok(g.zones.library.every(i => g.cards[i].id === 'forest')); // the Forests went to the bottom
});

test('Relentless Assault gives another combat; Palace Jailer makes you the monarch; proliferate', () => {
  const game = vsOpp(['assault', 'bear', 'monarch', 'ichor', 'hydra'], ['bear']);
  hook(game);
  const bear = put(game, 'bear');
  Bot.resolveYourAttack(game, [bear.iid], defOf);
  assert.equal(bear.attackedTurn, game.turn);
  const a = [...game.zones.library, ...game.zones.hand].find(i => game.cards[i].id === 'assault');
  Game.move(game, a, 'hand');
  Game.move(game, a, 'battlefield');
  assert.equal(bear.tapped, false);
  assert.equal(bear.attackedTurn, undefined);

  Game.move(game, [...game.zones.library, ...game.zones.hand].find(i => game.cards[i].id === 'monarch'), 'hand');
  const jailer = game.zones.hand.find(i => game.cards[i].id === 'monarch');
  Game.move(game, jailer, 'battlefield');
  Bot.enterTrigger(game, game.cards[jailer], defOf);
  assert.equal(Bot.monarchOf(game), 'you');
  Bot.takeMonarch(game, 'opp');
  assert.equal(Bot.monarchOf(game), 'opp');

  const hydra = put(game, 'hydra');
  Bot.enterTrigger(game, hydra, defOf);
  assert.equal(hydra.counters['+1/+1'], 2); // the Bears and the Jailer
  game.bot.s.poison = 3;
  Bot.proliferate(game, game.bot.s);
  assert.equal(hydra.counters['+1/+1'], 3);
  assert.equal(game.bot.s.poison, 4);
});

test('decayed attackers are sacrificed after combat', () => {
  const game = vsOpp(['decayed'], []);
  const z = put(game, 'decayed');
  Bot.resolveYourAttack(game, [z.iid], defOf);
  assert.equal(game.oppLife, 18);
  assert.equal(z.zone, 'graveyard');
});

test('attack triggers that make X tokens tapped and attacking', () => {
  const mk = (id, name, oracle) => ({ id, name, typeLine: 'Creature — Human Soldier', manaCost: '{3}', cmc: 3, power: '3', toughness: '3', oracle });
  const all = Object.assign({
    hero: mk('hero', 'Hero of Bladehold', 'Battle cry\nWhenever Hero of Bladehold attacks, create two 1/1 white Soldier creature tokens that are tapped and attacking.'),
    xs: mk('xs', 'X Captain', 'Whenever X Captain attacks, create X 1/1 white Soldier creature tokens that are tapped and attacking, where X is the number of opponents you have.'),
    ooze: mk('ooze', 'Ooze Caller', "Whenever Ooze Caller attacks, create an X/X green Ooze creature token that's tapped and attacking, where X is the number of creatures you control."),
  }, defs);
  const run = (id, opponents) => {
    const g = Game.create(deck('You', [{ id, qty: 3 }, { id: 'bear', qty: 2 }, { id: 'forest', qty: 30 }]), all);
    g.bot = Bot.create(deck('Opp', [{ id: 'forest', qty: 40 }]), all, { onDraw: true });
    g.oppLife = 40;
    g.opponents = opponents;
    const a = Object.values(g.cards).find(x => x.id === id);
    Game.move(g, a.iid, 'battlefield');
    a.enteredTurn = -1;
    const b = Object.values(g.cards).find(x => x.id === 'bear');
    Game.move(g, b.iid, 'battlefield');
    Bot.resolveYourAttack(g, [a.iid], id2 => all[id2]);
    return { g, tokens: g.zones.battlefield.map(i => g.cards[i]).filter(x => x.token) };
  };
  let r = run('hero', 1);
  assert.equal(r.tokens.length, 2);
  assert.ok(r.tokens.every(t => t.tapped && t.attackedTurn === r.g.turn));
  assert.equal(r.g.oppLife, 40 - 3 - 2 - 2); // battle cry: each Soldier is 2/1
  r = run('xs', 3);
  assert.equal(r.tokens.length, 3);
  r = run('ooze', 1);
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].custom.pt, '2/2'); // Ooze Caller and the Bears
});
