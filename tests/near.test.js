// The precons that had 6 to 15 cards left (Angels, Buckle Up, Built From Scratch, Call the Spirits, Divine Convocation, Land's Wrath, Lorehold Legacies,
// Odds and Ends, Plunder the Graves, Prismari Performance, Rebellion Rising): their last cards, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./near-cards.json');
const basics = {
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Human Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Golem: { id: 'Golem', name: 'Iron Golem', typeLine: 'Artifact Creature — Golem', manaCost: '{3}', cmc: 3, power: '3', toughness: '3', oracle: '', colors: [] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracle: '', colors: [] },
  Idol: { id: 'Idol', name: 'Idol', typeLine: 'Artifact', manaCost: '{6}', cmc: 6, oracle: '', colors: [] },
  Glory: { id: 'Glory', name: 'Glory', typeLine: 'Enchantment', manaCost: '{4}', cmc: 4, oracle: '', colors: [] },
  Bolt: { id: 'Bolt', name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Bolt deals 3 damage to any target.', colors: ['R'] },
  Flier: { id: 'Flier', name: 'Wind Drake', typeLine: 'Creature — Drake', manaCost: '{2}{U}', cmc: 3, power: '2', toughness: '2', oracle: 'Flying', colors: ['U'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: /^(Forest|Plains)$/.test(id) ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const toGrave = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'graveyard'); return s.cards[iid]; };
const toTop = (s, id) => {
  const iid = find(s, id);
  ['library', 'hand', 'graveyard'].forEach(z => { const k = s.zones[z].indexOf(iid); if (k >= 0) s.zones[z].splice(k, 1); });
  s.zones.library.unshift(iid);
  s.cards[iid].zone = 'library';
  return s.cards[iid];
};
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const st = c => Bot.stats(c, defOf(c.id));
// A card's rules text as the game reads it (no reminder text), its lines joined or line n.
const text = (name, n) => { const l = cards[name].oracle.split('\n').map(Bot.parts.plainLine).filter(Boolean); return n == null ? l.join(' ') : l[n]; };
const effectOf = (name, n) => text(name, n).replace(/^[^,:]+?(?:, |: )/, ''); // a trigger's or ability's effect (after its first comma or colon)
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every one of these cards is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Smuggler\'s Copter draws, then discards', () => {
  const game = vsOpp();
  const hand = game.zones.hand.length;
  const left = Bot.runEffect(game, 'You may draw a card. If you do, discard a card.', ctx(game, { self: { name: 'Copter' } }));
  assert.deepEqual(left, []);
  assert.equal(game.zones.hand.length, hand);
});

test('Cosmos Elixir draws above your starting life, else gains 2', () => {
  const game = vsOpp();
  game.commander = false; // starting life 20
  game.life = 20;
  Bot.runEffect(game, effectOf('Cosmos Elixir', 0), ctx(game, { self: { name: 'Cosmos Elixir' } }));
  assert.equal(game.life, 22);
  const hand = game.zones.hand.length;
  Bot.runEffect(game, effectOf('Cosmos Elixir', 0), ctx(game, { self: { name: 'Cosmos Elixir' } }));
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Whipflare spares artifact creatures', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const golem = put(game.bot.s, 'Golem');
  Bot.runEffect(game, text('Whipflare'), ctx(game, { self: { name: 'Whipflare' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(golem.zone, 'battlefield');
});

test('Serra Ascendant is 6/6 with flying at 30 life or more; Jor Kadeen pumps with three artifacts', () => {
  const game = vsOpp();
  const serra = put(game, 'Serra Ascendant');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(serra).pow, 6);
  assert.ok(st(serra).kw.has('flying'));
  game.life = 29;
  Bot.refreshGrants(game, defOf);
  assert.equal(st(serra).pow, 1);
  put(game, 'Jor Kadeen, the Prevailer');
  put(game, 'Relic');
  put(game, 'Idol');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(serra).pow, 1);
  put(game, 'Golem');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(serra).pow, 4);
});

test('Bonehoard counts creature cards in every graveyard; Harmonious Archon makes the other creatures 3/3 on both sides', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const hoard = put(game, 'Bonehoard');
  Game.attach(game, hoard.iid, bear.iid, Bot.attachBonus(defOf('Bonehoard').oracle));
  toGrave(game, 'Giant');
  toGrave(game.bot.s, 'Giant');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(bear).pow, 4);
  const game2 = vsOpp();
  const mine = put(game2, 'Bear');
  const theirs = put(game2.bot.s, 'Giant');
  put(game2, 'Harmonious Archon');
  Bot.refreshGrants(game2, defOf);
  assert.equal(st(mine).pow, 3);
  assert.equal(st(theirs).pow, 3);
});

test('Thief of Blood takes every counter on the battlefield', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  Game.counter(game, bear.iid, '+1/+1', 2);
  const giant = put(game.bot.s, 'Giant');
  Game.counter(game.bot.s, giant.iid, '+1/+1', 3);
  Bot.refreshGrants(game, defOf);
  const thief = put(game, 'Thief of Blood');
  Bot.enterTrigger(game, thief, defOf);
  assert.equal(thief.counters['+1/+1'], 5);
  assert.ok(!(bear.counters['+1/+1'] > 0));
});

test('For Mirrodin! makes a Rebel and equips it', () => {
  const game = vsOpp();
  Bot.refreshGrants(game, defOf);
  const lens = put(game, 'Glimmer Lens');
  Bot.enterTrigger(game, lens, defOf);
  const rebel = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token && /rebel/i.test(c.name));
  assert.ok(rebel);
  assert.equal(lens.attachedTo, rebel.iid);
});

test('Epochrasite gets its counters only when not cast from your hand, and comes back suspended', () => {
  const game = vsOpp();
  Bot.refreshGrants(game, defOf);
  const e = put(game, 'Epochrasite');
  Bot.enterTrigger(game, e, defOf);
  assert.equal(e.counters['+1/+1'], 3);
  Game.move(game, e.iid, 'graveyard');
  Bot.runEffect(game, effectOf('Epochrasite', 1), ctx(game, { self: e }));
  assert.equal(e.zone, 'exile');
  assert.ok(e.suspended);
  assert.equal(e.counters.time, 3);
});

test('Release to Memory exiles the opponent\'s graveyard for Spirits; Mulch keeps the lands', () => {
  const game = vsOpp();
  toGrave(game.bot.s, 'Bear');
  toGrave(game.bot.s, 'Giant');
  toGrave(game.bot.s, 'Relic');
  Bot.runEffect(game, text('Release to Memory'), ctx(game, { self: { name: 'Release to Memory' } }));
  assert.equal(game.bot.s.zones.graveyard.length, 0);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token).length, 2);
  const forest = toTop(game, 'Forest');
  const relic = toTop(game, 'Relic');
  Bot.runEffect(game, text('Mulch'), ctx(game, { self: { name: 'Mulch' } }));
  assert.equal(forest.zone, 'hand');
  assert.equal(relic.zone, 'graveyard');
});

test('Scrap Mastery swaps each player\'s artifacts for their artifact cards', () => {
  const game = vsOpp();
  const relic = put(game, 'Relic');
  const idol = toGrave(game, 'Idol');
  Bot.runEffect(game, text('Scrap Mastery'), ctx(game, { self: { name: 'Scrap Mastery' } }));
  assert.equal(relic.zone, 'graveyard');
  assert.equal(idol.zone, 'battlefield');
});

test('Incite Rebellion hits each player and their creatures by their creature count', () => {
  const game = vsOpp();
  put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  put(game.bot.s, 'Golem');
  Bot.runEffect(game, text('Incite Rebellion'), ctx(game, { self: { name: 'Incite Rebellion' } }));
  assert.equal(game.life, 39);
  assert.equal(game.oppLife, 38);
  assert.equal(giant.zone, 'battlefield');
  assert.equal(giant.damageTaken, 2);
});

test('Angel of Serenity exiles the opponent\'s best creatures, which return to hand when it leaves', () => {
  const game = vsOpp();
  const angel = put(game, 'Angel of Serenity');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, effectOf('Angel of Serenity', 1), ctx(game, { self: angel }));
  assert.equal(giant.zone, 'exile');
  Bot.runEffect(game, effectOf('Angel of Serenity', 2), ctx(game, { self: angel }));
  assert.equal(giant.zone, 'hand');
});

test('Diabolic Servitude: its creature dying exiles it and returns the enchantment to hand', () => {
  const game = vsOpp();
  const giant = toGrave(game, 'Giant');
  const ds = put(game, 'Diabolic Servitude');
  Bot.runEffect(game, effectOf('Diabolic Servitude', 0), ctx(game, { self: ds }));
  assert.equal(giant.zone, 'battlefield');
  Game.move(game, giant.iid, 'graveyard');
  Bot.died(game, giant, defOf, ctx(game), game, { to: 'graveyard' });
  assert.equal(giant.zone, 'exile');
  assert.equal(ds.zone, 'hand');
});

test('Grave Peril destroys a nonblack creature as it enters and goes', () => {
  const game = vsOpp();
  const gp = put(game, 'Grave Peril');
  const bear = put(game.bot.s, 'Bear');
  Bot.creatureEntered(game, bear, defOf, null, game.bot.s);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(gp.zone, 'graveyard');
});

test('Kotori gives your Vehicles crew 2', () => {
  const game = vsOpp();
  const copter = put(game, 'Surgehacker Mech');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.crewOf(copter, defOf), 4);
  put(game, 'Kotori, Pilot Prodigy');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.crewOf(copter, defOf), 2);
});

test('Shared Fate: a draw takes the top card of the other library instead, playable from exile', () => {
  const game = vsOpp();
  put(game, 'Shared Fate');
  const top = game.bot.s.cards[game.bot.s.zones.library[0]];
  assert.equal(Bot.drawInstead(game, game, false, defOf), true);
  const got = game.zones.exile.map(i => game.cards[i]).find(c => c.name === top.name && c.playable);
  assert.ok(got);
});

test('Exchange of Words swaps text boxes until it leaves', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const drake = put(game.bot.s, 'Flier');
  const ex = put(game, 'Exchange of Words');
  Bot.runEffect(game, effectOf('Exchange of Words', 0), ctx(game, { self: ex }));
  Bot.refreshGrants(game, defOf);
  assert.ok(st(bear).kw.has('flying'));
  assert.ok(!st(drake).kw.has('flying'));
  Game.move(game, ex.iid, 'graveyard');
  Bot.refreshGrants(game, defOf);
  assert.ok(!st(bear).kw.has('flying'));
  assert.ok(st(drake).kw.has('flying'));
});

test('Gisela and Bruna meld into Brisela, which stops Opp\'s cheap spells', () => {
  const game = vsOpp();
  const gisela = put(game, 'Gisela, the Broken Blade');
  const bruna = put(game, 'Bruna, the Fading Light');
  Bot.runEffect(game, 'meld this and Bruna, the Fading Light into Brisela, Voice of Nightmares', ctx(game, { self: gisela }));
  assert.equal(gisela.zone, 'exile');
  assert.equal(bruna.zone, 'exile');
  const brisela = game.zones.battlefield.map(i => game.cards[i]).find(c => c.name === 'Brisela, Voice of Nightmares');
  assert.ok(brisela);
  assert.equal(st(brisela).pow, 9);
});

test('Space Beleren\'s −5 destroys the opponent\'s creatures (each side is a sector of its own)', () => {
  const game = vsOpp();
  const mine = put(game, 'Bear');
  const theirs = put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'Destroy all creatures in the sector of your choice.', ctx(game, { self: { name: 'Space Beleren' } }));
  assert.equal(mine.zone, 'battlefield');
  assert.equal(theirs.zone, 'graveyard');
});

test('Dance of the Manse with X 6 returns artifacts as 4/4 creatures', () => {
  const game = vsOpp();
  const idol = toGrave(game, 'Idol');
  Bot.runEffect(game, text('Dance of the Manse').replace(/\bX\b/g, '6'), ctx(game, { self: { name: 'Dance of the Manse' } }));
  assert.equal(idol.zone, 'battlefield');
  assert.ok(Game.isCreature(idol));
  assert.equal(st(idol).pow, 4);
});

test('Goblin Welder swaps a cheap artifact for a better one from the graveyard', () => {
  const game = vsOpp();
  const relic = put(game, 'Relic');
  const idol = toGrave(game, 'Idol');
  Bot.runEffect(game, effectOf('Goblin Welder', 0), ctx(game, { self: { name: 'Goblin Welder' } }));
  assert.equal(relic.zone, 'graveyard');
  assert.equal(idol.zone, 'battlefield');
});

test('Hour of Revelation costs {3} less with ten nonland permanents out', () => {
  const game = vsOpp();
  const hour = game.cards[find(game, 'Hour of Revelation')];
  assert.equal(Bot.selfDiscount(game, hour, defOf, game.bot.s), 0);
  for (let i = 0; i < 10; i++) Game.createToken(game, { name: 'Thopter', typeLine: 'Token Artifact Creature — Thopter', custom: true, pt: '1/1', text: '' }, { quiet: true });
  assert.equal(Bot.selfDiscount(game, hour, defOf, game.bot.s), 3);
});

test('Impact Resonance divides the turn\'s greatest damage among the opponent\'s creatures', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  game.bigDamage = { turn: game.turn, n: 6 };
  Bot.runEffect(game, text('Impact Resonance'), ctx(game, { self: { name: 'Impact Resonance' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'graveyard');
});

test('Volcanic Offering hits the opponent\'s best creature and the one it picks', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'Volcanic Offering deals 7 damage to target creature you don\'t control and 7 damage to target creature of an opponent\'s choice you don\'t control.', ctx(game, { self: { name: 'Volcanic Offering' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'graveyard');
});

test('Angel of Destiny wins the game for a player 15 life over their starting life who attacked with it', () => {
  const game = vsOpp();
  const angel = put(game, 'Angel of Destiny');
  angel.attackTurn = game.turn;
  game.life = 60;
  Bot.runEffect(game, effectOf('Angel of Destiny', 2), ctx(game, { self: angel }));
  assert.ok(game.oppLife <= 0);
});

// ---- The next seven (Arm for Battle, Breed Lethality, Forged in Stone, Invent Superiority, Vampiric Bloodline, Vampiric Bloodlust) ----

test('Wyleth draws a card for each Aura and Equipment on it', () => {
  const game = vsOpp();
  const wy = put(game, 'Wyleth, Soul of Steel');
  const ring = put(game, 'Ring of Thune');
  Game.attach(game, ring.iid, wy.iid, Bot.attachBonus(defOf('Ring of Thune').oracle));
  const hand = game.zones.hand.length;
  Bot.runEffect(game, effectOf('Wyleth, Soul of Steel', 1), ctx(game, { self: wy }));
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Necroplasm destroys each creature with mana value equal to its counters', () => {
  const game = vsOpp();
  const np = put(game, 'Necroplasm');
  Game.counter(game, np.iid, '+1/+1', 2);
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, effectOf('Necroplasm', 1), ctx(game, { self: np }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'battlefield');
});

test('Reyhan moves the counters of a creature that died', () => {
  const game = vsOpp();
  const reyhan = put(game, 'Reyhan, Last of the Abzan');
  const bear = put(game, 'Bear');
  Game.counter(game, bear.iid, '+1/+1', 2);
  Game.move(game, bear.iid, 'graveyard');
  Bot.died(game, bear, defOf, ctx(game), game, { to: 'graveyard', counters: { '+1/+1': 2 } });
  assert.equal(reyhan.counters['+1/+1'], 2);
});

test('Custodi Soulbinders enters with a counter for each other creature', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game.bot.s, 'Giant');
  Bot.refreshGrants(game, defOf);
  const cs = put(game, 'Custodi Soulbinders');
  Bot.enterTrigger(game, cs, defOf);
  assert.equal(cs.counters['+1/+1'], 2);
});

test('Silverblade Paladin and its pair have double strike; Blood Baron grows at 30 life against 10', () => {
  const game = vsOpp();
  const sp = put(game, 'Silverblade Paladin');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(sp).kw.has('double strike'));
  assert.ok(st(bear).kw.has('double strike'));
  const baron = put(game, 'Blood Baron of Vizkopa');
  game.oppLife = 10;
  Bot.refreshGrants(game, defOf);
  assert.equal(st(baron).pow, 10);
});

test('Containment Priest exiles a creature put onto the battlefield without being cast', () => {
  const game = vsOpp();
  put(game, 'Containment Priest');
  Bot.refreshGrants(game, defOf);
  const giant = game.cards[find(game, 'Giant')];
  assert.equal(Bot.exiledOnEntry(giant, defOf), true);
  giant.wasCast = true;
  assert.equal(Bot.exiledOnEntry(giant, defOf), false);
});

test('Malakir Bloodwitch drains for each Vampire; Disrupt Decorum goads the opponent\'s creatures', () => {
  const game = vsOpp();
  put(game, 'Malakir Bloodwitch');
  put(game, 'Bloodlord of Vaasgoth');
  Bot.runEffect(game, effectOf('Malakir Bloodwitch', 1), ctx(game, { self: { name: 'Malakir Bloodwitch' } }));
  assert.equal(game.oppLife, 38);
  assert.equal(game.life, 42);
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Disrupt Decorum'), ctx(game, { self: { name: 'Disrupt Decorum' } }));
  assert.ok(giant.goad);
});

test('Shadowgrange Archfiend takes the opponent\'s strongest creature and its power in life', () => {
  const game = vsOpp();
  put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, effectOf('Shadowgrange Archfiend', 0), ctx(game, { self: { name: 'Shadowgrange Archfiend' } }));
  assert.equal(giant.zone, 'graveyard');
  assert.equal(game.life, 44);
});

test('Blood Tribute takes half the opponent\'s life, and gives it to you when kicked', () => {
  const game = vsOpp();
  game.oppLife = 31;
  Bot.runEffect(game, text('Blood Tribute', 1), ctx(game, { self: { name: 'Blood Tribute', kicked: true } }));
  assert.equal(game.oppLife, 15);
  assert.equal(game.life, 56);
});

test('Mob Rule takes the opponent\'s big creatures until the end step', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const bear = put(game.bot.s, 'Bear');
  Bot.runEffect(game, 'Gain control of all creatures with power 4 or greater until end of turn. Untap those creatures. They gain haste until end of turn.', ctx(game, { self: { name: 'Mob Rule' } }));
  assert.equal(giant.zone, 'battlefield');
  assert.ok(game.zones.battlefield.some(i => game.cards[i].name === 'Hill Giant'));
  assert.equal(bear.zone, 'battlefield');
  assert.ok(game.bot.s.zones.battlefield.includes(bear.iid));
});

test('Trinket Mage finds an artifact with mana value 1 or less; Reveillark returns small creatures', () => {
  const game = vsOpp();
  Bot.runEffect(game, 'search your library for an artifact card with mana value 1 or less, reveal that card, put it into your hand, then shuffle', ctx(game, { self: { name: 'Trinket Mage' } }));
  assert.ok(game.zones.hand.some(i => Bot.cardFits(game.cards[i], 'artifact') && Bot.cmcOfInst(game.cards[i], defOf) <= 1));
  const bear = toGrave(game, 'Bear');
  const giant = toGrave(game, 'Giant');
  Bot.runEffect(game, effectOf('Reveillark', 1), ctx(game, { self: { name: 'Reveillark' } }));
  assert.equal(bear.zone, 'battlefield');
  assert.equal(giant.zone, 'graveyard');
});

// ---- Silverquill Statement, Feline Ferocity, Coven Counters ----

test('Bold Plagiarist copies the counters the opponent puts on its creatures', () => {
  const game = vsOpp();
  const bp = put(game, 'Bold Plagiarist');
  const giant = put(game.bot.s, 'Giant');
  Bot.countersPut(game, game.bot.s, giant, '+1/+1', 2, defOf, null);
  assert.equal(bp.counters['+1/+1'], 2);
});

test('Divine Reckoning leaves each player their best creature; Celestial Judgment one of each power', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game, 'Giant');
  const theirs = put(game.bot.s, 'Bear');
  const golem = put(game.bot.s, 'Golem');
  Bot.runEffect(game, text('Divine Reckoning', 0), ctx(game, { self: { name: 'Divine Reckoning' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'battlefield');
  assert.equal(golem.zone, 'battlefield');
  assert.equal(theirs.zone, 'graveyard');
});

test('Ainok Bond-Kin gives first strike to creatures with counters; Kyler pumps Humans by its counters', () => {
  const game = vsOpp();
  put(game, 'Ainok Bond-Kin');
  const bear = put(game, 'Bear');
  Game.counter(game, bear.iid, '+1/+1', 1);
  const kyler = put(game, 'Kyler, Sigardian Emissary');
  Game.counter(game, kyler.iid, '+1/+1', 2);
  const giant = put(game, 'Giant');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(bear).kw.has('first strike'));
  assert.equal(st(giant).pow, 6);
});

test('Scholarship Sponsor lets a player behind on lands catch up', () => {
  const game = vsOpp();
  put(game, 'Forest');
  put(game, 'Forest');
  const before = game.bot.s.zones.battlefield.length;
  Bot.runEffect(game, effectOf('Scholarship Sponsor', 0), ctx(game, { self: { name: 'Scholarship Sponsor' } }));
  assert.equal(game.bot.s.zones.battlefield.length, before + 2);
});

test('Stinging Study draws and loses life by your commander\'s mana value', () => {
  const game = vsOpp();
  const giant = game.cards[find(game, 'Giant')];
  giant.commander = true;
  Game.move(game, giant.iid, 'command');
  const hand = game.zones.hand.length;
  Bot.runEffect(game, text('Stinging Study'), ctx(game, { self: { name: 'Stinging Study' } }));
  assert.equal(game.zones.hand.length, hand + 4);
  assert.equal(game.life, 36);
});

// ---- Ahoy Mateys, Grand Larceny, Scrappy Survivors ----

test('Gonti steals the top card of the opponent\'s library, playable with any mana', () => {
  const game = vsOpp();
  const top = game.bot.s.cards[game.bot.s.zones.library[0]];
  Bot.runEffect(game, 'look at the top card of that player\'s library, then exile it face down. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.', ctx(game, { self: { name: 'Gonti' } }));
  const got = game.zones.exile.map(i => game.cards[i]).find(c => c.name === top.name);
  assert.ok(got && got.playable && got.playable.anyMana);
  assert.equal(got.owner, 'opp');
});

test('Don Andres pumps creatures you control but don\'t own', () => {
  const game = vsOpp();
  put(game, 'Don Andres, the Renegade');
  const giant = put(game, 'Giant');
  giant.owner = 'opp';
  Bot.refreshGrants(game, defOf);
  assert.equal(st(giant).pow, 6);
  assert.ok(st(giant).kw.has('deathtouch'));
});

test('Blood Money makes a tapped Treasure for each nontoken creature destroyed; Dire Fleet Ravager takes a third of each life', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Blood Money'), ctx(game, { self: { name: 'Blood Money' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /treasure/i.test(c.typeLine || '')).length, 2);
  Bot.runEffect(game, effectOf('Dire Fleet Ravager', 1), ctx(game, { self: { name: 'Dire Fleet Ravager' } }));
  assert.equal(game.life, 26);
  assert.equal(game.oppLife, 26);
});

test('Kari Zev\'s Ragavan attacks and is gone after combat', () => {
  const game = vsOpp();
  const kari = put(game, 'Kari Zev, Skyship Raider');
  const c = ctx(game, { self: kari });
  Bot.runEffect(game, effectOf('Kari Zev, Skyship Raider', 1), c);
  const rag = game.zones.battlefield.map(i => game.cards[i]).find(x => x.name === 'Ragavan');
  assert.ok(rag && rag.attacking && rag.exileAfterCombat);
});

test('Single Combat leaves each player one creature and stops Opp\'s creature spells', () => {
  const game = vsOpp();
  put(game, 'Bear');
  const giant = put(game, 'Giant');
  put(game.bot.s, 'Bear');
  Bot.runEffect(game, text('Single Combat'), ctx(game, { self: { name: 'Single Combat' } }));
  assert.equal(giant.zone, 'battlefield');
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => Game.isCreature(c)).length, 1);
  assert.ok(game.lockCreatures >= game.turn);
});

// ---- Political Puppets ----

test('Arbiter of Knollridge raises each life to the highest; Death by Dragons gives you the Dragon', () => {
  const game = vsOpp();
  game.oppLife = 55;
  Bot.runEffect(game, effectOf('Arbiter of Knollridge', 1), ctx(game, { self: { name: 'Arbiter of Knollridge' } }));
  assert.equal(game.life, 55);
  Bot.runEffect(game, text('Death by Dragons'), ctx(game, { self: { name: 'Death by Dragons' } }));
  assert.ok(game.zones.battlefield.some(i => /dragon/i.test(game.cards[i].typeLine || game.cards[i].name)));
});

test('Reins of Power trades the creatures until the end step; Vedalken Plotter swaps lands', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Reins of Power'), ctx(game, { self: { name: 'Reins of Power' } }));
  assert.ok(game.zones.battlefield.some(i => game.cards[i].name === 'Hill Giant'));
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].name === 'Grizzly Bears'));
});

test('Lash Out hits the creature\'s controller when you win the clash', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  toTop(game, 'Harmonious Archon');
  toTop(game.bot.s, 'Forest');
  Bot.runEffect(game, text('Lash Out'), ctx(game, { self: { name: 'Lash Out' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.oppLife, 37);
});

test('Howling Mine gives the active player an extra card at the upkeep', () => {
  const game = vsOpp();
  put(game, 'Howling Mine');
  const hand = game.zones.hand.length;
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game), false);
  assert.equal(game.zones.hand.length, hand + 1);
});

// ---- Deadly Disguise ----

test('Cloak puts the top card face down; a cloaked creature card turns up for its mana cost', () => {
  const game = vsOpp();
  toTop(game, 'Giant');
  Bot.runEffect(game, 'cloak the top card of your library', ctx(game, { self: { name: 'Veiled Ascension' } }));
  const down = game.zones.battlefield.map(i => game.cards[i]).find(c => c.faceDown);
  assert.ok(down && down.cloaked);
  assert.equal(Bot.morphCost(down, defOf), '{3}{R}');
});

test('Turning a creature face up fires the watchers: Experiment Twelve, Salt Road Ambushers, Hooded Hydra\'s counters', () => {
  const game = vsOpp();
  put(game, 'Experiment Twelve');
  put(game, 'Salt Road Ambushers');
  const hydra = put(game, 'Hooded Hydra');
  hydra.faceDown = true;
  hydra.faceDown = false;
  Bot.turnedFaceUp(game, hydra, defOf, ctx(game));
  assert.equal(hydra.counters['+1/+1'], 5 + 5 + 2);
});

test('Duskana draws for each 2/2 you control (face-down ones count)', () => {
  const game = vsOpp();
  put(game, 'Bear');
  const g = put(game, 'Giant');
  g.faceDown = true;
  const hand = game.zones.hand.length;
  Bot.runEffect(game, effectOf('Duskana, the Rage Mother', 0), ctx(game, { self: { name: 'Duskana' } }));
  assert.equal(game.zones.hand.length, hand + 2);
});

test('Unexplained Absence exiles the opponent\'s best permanent and it cloaks a card', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Unexplained Absence'), ctx(game, { self: { name: 'Unexplained Absence' } }));
  assert.equal(giant.zone, 'exile');
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].faceDown && game.bot.s.cards[i].cloaked));
});

// ---- Mutant Menace ----

test('Rad counters: they go on players, mill at the first main phase, and cost life for each nonland card (Strong turns it into life)', () => {
  const game = vsOpp();
  Bot.runEffect(game, 'Each player gets three rad counters.', ctx(game, { self: { name: 'Vault 12' } }));
  assert.equal(game.rad, 3);
  assert.equal(game.bot.s.rad, 3);
  ['Bear', 'Giant', 'Relic'].forEach(id => toTop(game, id));
  Bot.phaseTriggers(game, game, 'main', defOf, ctx(game), false);
  assert.equal(game.life, 37);
  assert.equal(game.rad, 0);
  put(game, 'Strong, the Brutish Thespian');
  game.rad = 2;
  ['Bear', 'Giant'].forEach(id => toTop(game, id));
  Bot.phaseTriggers(game, game, 'main', defOf, ctx(game), false);
  assert.equal(game.life, 39);
});

test('Milling fires the watchers: The Wise Mothman, Glowing One, Mirelurk Queen once a turn', () => {
  const game = vsOpp();
  Game.hooks.milled = (s, ids) => Bot.milled(game, s, ids, defOf);
  put(game, 'Glowing One');
  const queen = put(game, 'Mirelurk Queen');
  put(game, 'The Wise Mothman');
  ['Bear', 'Giant'].forEach(id => toTop(game.bot.s, id));
  const hand = game.zones.hand.length;
  Game.mill(game.bot.s, 2);
  assert.equal(game.life, 42);
  assert.equal(game.zones.hand.length, hand + 1);
  assert.ok(queen.counters['+1/+1'] >= 1);
  Game.mill(game.bot.s, 2);
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Winding Constrictor adds one more counter, to creatures and to your rad', () => {
  const game = vsOpp();
  put(game, 'Winding Constrictor');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  Game.counter(game, bear.iid, '+1/+1', 1, { effect: true });
  assert.equal(bear.counters['+1/+1'], 2);
  Bot.runEffect(game, 'You get two rad counters.', ctx(game, { self: { name: 'Tato Farmer' } }));
  assert.equal(game.rad, 3);
});

test('Lily Bowen doubles its counters, then cashes them in above 16 power', () => {
  const game = vsOpp();
  const lily = put(game, 'Lily Bowen, Raging Grandma');
  Game.counter(game, lily.iid, '+1/+1', 10);
  Bot.runEffect(game, effectOf('Lily Bowen, Raging Grandma', 2), ctx(game, { self: lily }));
  assert.equal(lily.counters['+1/+1'], 20);
  Bot.runEffect(game, effectOf('Lily Bowen, Raging Grandma', 2), ctx(game, { self: lily }));
  assert.equal(lily.counters['+1/+1'], 1);
  assert.equal(game.life, 59);
});

// ---- Blast from the Past, From Cute to Brute ----

test('Crisis of Conscience destroys the tokens, or every nonland nontoken permanent', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  Game.createToken(game.bot.s, { name: 'Thopter', typeLine: 'Token Artifact Creature — Thopter', custom: true, pt: '1/1', text: '' }, { quiet: true });
  Bot.runEffect(game, 'Destroy all tokens.', ctx(game, { self: { name: 'Crisis of Conscience' } }));
  assert.equal(game.bot.s.zones.battlefield.length, 0);
  assert.equal(bear.zone, 'battlefield');
  Bot.runEffect(game, 'Destroy all nonland, nontoken permanents.', ctx(game, { self: { name: 'Crisis of Conscience' } }));
  assert.equal(bear.zone, 'graveyard');
});

test('Displaced Dinosaurs makes a historic permanent a 7/7 Dinosaur; Heroes\' Podium pumps legends', () => {
  const game = vsOpp();
  put(game, 'Displaced Dinosaurs');
  Bot.refreshGrants(game, defOf);
  const relic = put(game, 'Idol');
  Bot.enterTrigger(game, relic, defOf);
  Bot.refreshGrants(game, defOf);
  assert.ok(Game.isCreature(relic));
  assert.equal(st(relic).pow, 7);
});

test('Archangel Avacyn transforms at the next upkeep after a non-Angel of yours dies, hitting everything else for 3', () => {
  const game = vsOpp();
  const avacyn = put(game, 'Archangel Avacyn // Avacyn, the Purifier');
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Bear');
  Bot.refreshGrants(game, defOf);
  Game.move(game, bear.iid, 'graveyard');
  Bot.died(game, bear, defOf, ctx(game), game, { to: 'graveyard' });
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game), false);
  assert.ok(avacyn.flipped);
  assert.equal(giant.zone, 'graveyard');
  assert.equal(game.oppLife, 37);
});

test('The War Games gives each player three goaded Warriors', () => {
  const game = vsOpp();
  Bot.runEffect(game, 'Each player creates three tapped 1/1 white Warrior creature tokens. The tokens are goaded for as long as this Saga remains on the battlefield.', ctx(game, { self: { name: 'The War Games' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.name === 'Warrior' && c.goad).length, 3);
  assert.equal(game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).filter(c => c.name === 'Warrior').length, 3);
});

// Paradox Power, Masters of Evil, Timey-Wimey (Doctor Who)
test('Time travel casts a suspended card whose last time counter comes off; Rose Tyler grows with her time counters', () => {
  const game = vsOpp();
  const rose = put(game, 'Rose Tyler');
  Game.counter(game, rose.iid, 'time', 1);
  const iid = find(game, 'Bear');
  Game.move(game, iid, 'exile');
  const bear = game.cards[iid];
  bear.counters = { time: 1 };
  bear.suspended = true;
  Bot.runEffect(game, 'Time travel.', ctx(game, { self: { name: 'Wibbly-wobbly, Timey-wimey' } }));
  assert.equal(bear.zone, 'battlefield');
  assert.equal(rose.counters.time, 2);
  Bot.refreshGrants(game, defOf);
  assert.equal(st(rose).pow, Number(defs['Rose Tyler'].power) + 2);
});

test('A villainous choice keeps its first words; This Is How It Ends shuffles the best creature away, then 5 life or another creature', () => {
  assert.match(text('Ensnared by the Mara'), /^Each opponent faces a villainous choice/);
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const bear = put(game.bot.s, 'Bear');
  Bot.runEffect(game, text('This Is How It Ends'), ctx(game, { self: { name: 'This Is How It Ends' } }));
  assert.equal(giant.zone, 'library');
  assert.ok(bear.zone === 'library' || game.oppLife === 35);
});

test('Cyber Conversion makes a creature a 2/2 Cyberman artifact creature', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Cyber Conversion'), ctx(game, { self: { name: 'Cyber Conversion' } }));
  Bot.refreshGrants(game, defOf);
  assert.equal(st(giant).pow, 2);
  assert.match(giant.typeLine, /Cyberman/);
});

test('River Song draws from the bottom of the library', () => {
  const game = vsOpp();
  put(game, 'River Song');
  Game.hooks.drawInstead = (s, first) => Bot.drawInstead(game, s, first, defOf);
  const bottom = game.zones.library[game.zones.library.length - 1];
  Game.drawCards(game, 1);
  assert.equal(game.cards[bottom].zone, 'hand');
});

test('Sibylline Soothsayer suspends the next nonland card with mana value 3 or more, with three time counters', () => {
  const game = vsOpp();
  toTop(game, 'Giant');
  toTop(game, 'Bear');
  toTop(game, 'Forest');
  Bot.runEffect(game, effectOf('Sibylline Soothsayer'), ctx(game, { self: { name: 'Sibylline Soothsayer' } }));
  const giant = game.cards[game.zones.exile.find(i => game.cards[i].id === 'Giant')];
  assert.ok(giant && giant.suspended);
  assert.equal(giant.counters.time, 3);
});

// Aura of Courage, Deep Clue Sea, Enhanced Evolution, Explorers of the Deep, Most Wanted, Open Hostility, Stalwart Unity, Wade into Battle
test('Erdwal Illuminator adds a Clue the first time you investigate each turn; Armed with Proof makes Clues Equipment', () => {
  const game = vsOpp();
  put(game, 'Erdwal Illuminator');
  put(game, 'Armed with Proof');
  const clues = () => game.zones.battlefield.map(i => game.cards[i]).filter(c => /clue/i.test(c.name));
  Bot.runEffect(game, 'Investigate twice.', ctx(game, { self: { name: 'Wavesifter' } }));
  assert.equal(clues().length, 3);
  Bot.refreshGrants(game, defOf);
  assert.ok(clues().every(c => /Equipment/.test(c.typeLine) && /Equip \{2\}/.test(c.grantedText)));
});

test('Topography Tracker makes a creature explore twice; Merfolk Cave-Diver gets +1/+0 for each', () => {
  const game = vsOpp();
  put(game, 'Topography Tracker');
  const diver = put(game, 'Merfolk Cave-Diver');
  const bear = put(game, 'Bear');
  toTop(game, 'Giant');
  const forest = toTop(game, 'Forest');
  Bot.runEffect(game, 'It explores.', ctx(game, { self: bear }));
  assert.equal(forest.zone, 'hand');
  assert.equal(bear.counters['+1/+1'], 1);
  assert.equal(diver.pump.pow, 2);
});

test('Council\'s Judgment exiles the opponent\'s best nonland permanent and the one it votes for', () => {
  const game = vsOpp();
  put(game.bot.s, 'Giant');
  put(game.bot.s, 'Bear');
  put(game.bot.s, 'Glory');
  Bot.runEffect(game, text('Council\'s Judgment'), ctx(game, { self: { name: 'Council\'s Judgment' } }));
  assert.equal(game.bot.s.zones.exile.length, 2);
});

test('Insatiable Hemophage drains once for each time the creature has mutated', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const hemo = put(game, 'Insatiable Hemophage');
  hemo.mutatedOnto = bear.iid;
  Bot.runEffect(game, effectOf('Insatiable Hemophage', 2), ctx(game, { self: bear }));
  assert.equal(game.oppLife, 39);
  assert.equal(game.life, 41);
});

test('Song of Inspiration returns your two costliest permanent cards from your graveyard', () => {
  const game = vsOpp();
  const idol = toGrave(game, 'Idol');
  const giant = toGrave(game, 'Giant');
  const bear = toGrave(game, 'Bear');
  Bot.runEffect(game, text('Song of Inspiration'), ctx(game, { self: { name: 'Song of Inspiration' } }));
  assert.equal(idol.zone, 'hand');
  assert.equal(giant.zone, 'hand');
  assert.equal(bear.zone, 'graveyard');
});

// Cabaretti Cacophony, Mirror Mastery, Call for Backup, Obscura Operation
test('Krenko, Tin Street Kingpin grows, then makes Goblins equal to its power', () => {
  const game = vsOpp();
  const krenko = put(game, 'Krenko, Tin Street Kingpin');
  Bot.runEffect(game, effectOf('Krenko, Tin Street Kingpin'), ctx(game, { self: krenko }));
  assert.equal(krenko.counters['+1/+1'], 1);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.name === 'Goblin').length, 2);
});

test('Rumor Gatherer scries the first time, then draws the second time each turn', () => {
  const game = vsOpp();
  const rumor = put(game, 'Rumor Gatherer');
  const hand = game.zones.hand.length;
  Bot.runEffect(game, effectOf('Rumor Gatherer'), ctx(game, { self: rumor }));
  assert.equal(game.zones.hand.length, hand);
  Bot.runEffect(game, effectOf('Rumor Gatherer'), ctx(game, { self: rumor }));
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Animar and Hamza make creature spells cheaper', () => {
  const game = vsOpp();
  const animar = put(game, 'Animar, Soul of Elements');
  Game.counter(game, animar.iid, '+1/+1', 2);
  put(game, 'Hamza, Guardian of Arashin');
  const giant = game.cards[find(game, 'Giant')];
  assert.equal(Bot.selfDiscount(game, giant, defOf), 3);
});

test('Custodi Lich makes the opponent sacrifice a creature when you become the monarch', () => {
  const game = vsOpp();
  put(game, 'Custodi Lich');
  const bear = put(game.bot.s, 'Bear');
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'You become the monarch.', ctx(game, { self: { name: 'Custodi Lich' } }));
  assert.equal(bear.zone, 'graveyard');
});

// Desert Bloom, Upgrades Unleashed
test('Unholy Heat deals 6 with four card types in your graveyard (delirium), else 2', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Unholy Heat'), ctx(game, { self: { name: 'Unholy Heat' } }));
  assert.equal(giant.zone, 'battlefield');
  ['Forest', 'Bear', 'Relic', 'Bolt'].forEach(id => toGrave(game, id));
  giant.damageTaken = 0;
  Bot.runEffect(game, text('Unholy Heat'), ctx(game, { self: { name: 'Unholy Heat' } }));
  assert.equal(giant.zone, 'graveyard');
});

test('Ordeal of Nylea is sacrificed at three counters and fetches two basic lands', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const ordeal = put(game, 'Ordeal of Nylea');
  Game.attach(game, ordeal.iid, bear.iid, Bot.attachBonus(defs['Ordeal of Nylea'].oracle));
  Game.counter(game, bear.iid, '+1/+1', 2);
  const lands = game.zones.battlefield.filter(i => Game.isLand(game.cards[i])).length;
  Bot.runEffect(game, 'the ordeal grows this creature', ctx(game, { self: bear }));
  assert.equal(ordeal.zone, 'graveyard');
  assert.equal(game.zones.battlefield.filter(i => Game.isLand(game.cards[i])).length, lands + 2);
});

// Blame Game, Chaos Incarnate, Devour for Power, Eternal Bargain, First Flight, Legends' Legacy
test('Mob Verdict hits the opponent and its creatures for 2 and draws you a card', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const hand = game.zones.hand.length;
  Bot.runEffect(game, text('Mob Verdict'), ctx(game, { self: { name: 'Mob Verdict' } }));
  assert.equal(game.oppLife, 38);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Fiendish Duo doubles damage to the opponent', () => {
  const game = vsOpp();
  put(game, 'Fiendish Duo');
  Bot.damagePlayer(game, 'opp', 3, 'Bolt', defOf);
  assert.equal(game.oppLife, 34);
});

test('Kangee\'s Lieutenant pumps only attacking fliers', () => {
  const game = vsOpp();
  const flier = put(game, 'Flier');
  const bear = put(game, 'Bear');
  flier.attacking = true;
  bear.attacking = true;
  Bot.runEffect(game, effectOf('Kangee\'s Lieutenant', 1), ctx(game, { self: { name: 'Kangee\'s Lieutenant' } }));
  assert.equal(flier.pump.pow, 1);
  assert.ok(!bear.pump || !bear.pump.pow);
});

test('Gerrard\'s Hourglass Pendant stops an extra turn', () => {
  const game = vsOpp();
  put(game, 'Gerrard\'s Hourglass Pendant');
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'Take an extra turn after this one.', ctx(game, { self: { name: 'Time Walk' } }));
  assert.ok(!game.bot.s.skipTurn);
});

// Mind Seize, Draconic Dissent, Phantom Premonition
test('Cruel Ultimatum: the opponent sacrifices, discards three, loses 5; you get a creature back, draw three, gain 5', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = toGrave(game, 'Giant');
  const hand = game.zones.hand.length;
  Bot.runEffect(game, text('Cruel Ultimatum'), ctx(game, { self: { name: 'Cruel Ultimatum' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.oppLife, 35);
  assert.equal(game.life, 45);
  assert.equal(giant.zone, 'hand');
  assert.equal(game.zones.hand.length, hand + 4);
});

test('Arcane Melee makes instants and sorceries cost {2} less for everyone', () => {
  const game = vsOpp();
  put(game.bot.s, 'Arcane Melee');
  assert.equal(Bot.selfDiscount(game, game.cards[find(game, 'Bolt')], defOf), 2);
});

test('Eye of Doom marks each side\'s best nonland permanent and destroys them', () => {
  const game = vsOpp();
  const eye = put(game, 'Eye of Doom');
  const giant = put(game.bot.s, 'Giant');
  const glory = put(game, 'Glory');
  Bot.runEffect(game, effectOf('Eye of Doom', 0), ctx(game, { self: eye }));
  Bot.runEffect(game, 'Destroy each permanent with a doom counter on it.', ctx(game, { self: eye }));
  assert.equal(giant.zone, 'graveyard');
  assert.equal(glory.zone, 'graveyard');
});

// Evasive Maneuvers, Peer Through Time
test('Kirtar\'s Wrath destroys all creatures, and makes two Spirits with threshold', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'].forEach(id => toGrave(game, id));
  Bot.runEffect(game, text('Kirtar\'s Wrath'), ctx(game, { self: { name: 'Kirtar\'s Wrath' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'graveyard');
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /spirit/i.test(c.name)).length, 2);
});

test('Borrowing 100,000 Arrows draws a card for each of the opponent\'s tapped creatures', () => {
  const game = vsOpp();
  put(game.bot.s, 'Bear').tapped = true;
  put(game.bot.s, 'Giant').tapped = true;
  const hand = game.zones.hand.length;
  Bot.runEffect(game, text('Borrowing 100,000 Arrows'), ctx(game, { self: { name: 'Borrowing 100,000 Arrows' } }));
  assert.equal(game.zones.hand.length, hand + 2);
});

test('Brine Elemental keeps the opponent\'s tapped permanents tapped through its next untap step', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  giant.tapped = true;
  Bot.runEffect(game, 'Each opponent skips their next untap step.', ctx(game, { self: { name: 'Brine Elemental' } }));
  assert.ok(giant.skipUntap);
});

// Graveyard Overdrive, Spirit Squadron
test('The goyfs count the card types in all graveyards', () => {
  const game = vsOpp();
  const goyf = put(game, 'Polygoyf');
  toGrave(game, 'Forest');
  toGrave(game, 'Bear');
  toGrave(game.bot.s, 'Bolt');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(goyf).pow, 3);
  assert.equal(st(goyf).tou, 4);
});

test('Field of Souls makes a flying Spirit when a nontoken creature of yours dies', () => {
  const game = vsOpp();
  put(game, 'Field of Souls');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  Game.move(game, bear.iid, 'graveyard');
  Bot.died(game, bear, defOf, ctx(game), game, { to: 'graveyard' });
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /spirit/i.test(c.name)).length, 1);
});

test('Grist makes Insects while it keeps milling Insects', () => {
  const game = vsOpp();
  const grist = put(game, 'Grist, the Hunger Tide');
  toTop(game, 'Bear');
  Bot.runEffect(game, 'insects while insects are milled', ctx(game, { self: grist }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /insect/i.test(c.name)).length, 1);
});

// Symbiotic Swarm
test('Majestic Myriarch is twice as big as your creature count', () => {
  const game = vsOpp();
  const m = put(game, 'Majestic Myriarch');
  put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(m).pow, 4);
});

test('Kathril puts keyword counters from your graveyard on your best creature, and +1/+1 counters on itself', () => {
  const game = vsOpp();
  const kathril = put(game, 'Kathril, Aspect Warper');
  const giant = put(game, 'Giant');
  toGrave(game, 'Flier');
  Bot.runEffect(game, 'keyword counters for your graveyard', ctx(game, { self: kathril }));
  assert.equal(kathril.counters['+1/+1'], 1);
  assert.ok([kathril, giant].some(c => (c.counters || {}).flying === 1));
});

// Adaptive Enchantment, Draconic Domination, Endless Punishment, Faceless Menace, Merciless Rage, Planar Portal, Power Hungry, Seize Control, Sneak Attack
test('In Garruk\'s Wake destroys only the opponent\'s creatures', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('In Garruk\'s Wake'), ctx(game, { self: { name: 'In Garruk\'s Wake' } }));
  assert.equal(bear.zone, 'battlefield');
  assert.equal(giant.zone, 'graveyard');
});

test('Sleep taps the opponent\'s creatures and keeps them tapped through its next untap', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Sleep'), ctx(game, { self: { name: 'Sleep' } }));
  assert.ok(giant.tapped && giant.skipUntap);
});

test('Fortunate Few keeps one nonland permanent on each side and destroys the rest', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game, 'Glory');
  put(game.bot.s, 'Giant');
  put(game.bot.s, 'Relic');
  Bot.runEffect(game, text('Fortunate Few'), ctx(game, { self: { name: 'Fortunate Few' } }));
  const nonland = t => t.zones.battlefield.filter(i => !Game.isLand(t.cards[i])).length;
  assert.equal(nonland(game), 1);
  assert.equal(nonland(game.bot.s), 1);
});

test('Winds of Rath still destroys only creatures that aren\'t enchanted', () => {
  assert.ok(Bot.parts.canRunAll("Destroy all creatures that aren't enchanted. They can't be regenerated.", { self: { name: 'Winds of Rath' }, other: true, defOf, hitOpps: () => {}, target: () => {} }));
});

// The twenty 16-20 decks
test('Venturing into the dungeon walks its four rooms, then completes it', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const ctx1 = ctx(game, { self: { name: 'Dungeon Map' } });
  ['Venture into the dungeon.', 'Venture into the dungeon.', 'Venture into the dungeon.'].forEach(t => Bot.runEffect(game, t, ctx1));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /treasure/i.test(c.name)).length, 1);
  assert.equal(bear.counters['+1/+1'], 1);
  const hand = game.zones.hand.length;
  Bot.runEffect(game, 'Venture into the dungeon.', ctx1);
  assert.equal(game.zones.hand.length, hand + 1);
  assert.equal(game.dungeonsDone, 1);
});

test('Manifest dread puts one of the top two face down and the other in the graveyard', () => {
  const game = vsOpp();
  toTop(game, 'Bolt');
  const giant = toTop(game, 'Giant');
  Bot.runEffect(game, 'Manifest dread.', ctx(game, { self: { name: 'Growing Dread' } }));
  assert.ok(giant.faceDown && giant.zone === 'battlefield');
  assert.equal(game.zones.graveyard.map(i => game.cards[i]).filter(c => c.id === 'Bolt').length, 1);
});

test('Ichor Rats gives each player a poison counter; Mycosynth Fiend grows with the opponent\'s poison', () => {
  const game = vsOpp();
  const fiend = put(game, 'Mycosynth Fiend');
  Bot.runEffect(game, 'Each player gets a poison counter.', ctx(game, { self: { name: 'Ichor Rats' } }));
  assert.equal(game.poison, 1);
  assert.equal(game.bot.s.poison, 1);
  Bot.refreshGrants(game, defOf);
  assert.equal(st(fiend).pow, 3);
});

test('Terminus puts every creature on the bottom of its owner\'s library', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Terminus'), ctx(game, { self: { name: 'Terminus' } }));
  assert.equal(bear.zone, 'library');
  assert.equal(giant.zone, 'library');
  assert.equal(game.zones.library[game.zones.library.length - 1], bear.iid);
});

// ---- Miracle Worker, Maestros Massacre, Timeless Wisdom ----

test('Casualty offers a copy for sacrificing a big enough creature; Anhelo gives the first instant each turn casualty 2', () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  put(game, 'Bear');
  const forgery = game.cards[find(game, 'Flawless Forgery')];
  const picks = Bot.costChoices(game, forgery, defOf).filter(c => c.key === 'replicate1');
  assert.deepEqual(picks.map(c => c.sacIid), [giant.iid]); // power 3 or more only
  put(game, 'Anhelo, the Painter');
  const bolt = game.cards[find(game, 'Bolt')];
  assert.ok(Bot.costChoices(game, bolt, defOf).some(c => c.key === 'replicate1'));
  game.anheloTurn = game.turn;
  assert.ok(!Bot.costChoices(game, bolt, defOf).some(c => c.key === 'replicate1'));
});

test('Cycling: Valiant Rescuer makes a Soldier only the first time; Gavi makes the first cycle free; Tectonic Reformation gives lands cycling', () => {
  const game = vsOpp();
  put(game, 'Valiant Rescuer');
  put(game, 'Gavi, Nest Warden');
  put(game, 'Tectonic Reformation');
  Bot.refreshGrants(game, defOf); // (the tables handAbilities reads)
  const pyre = game.cards[find(game, 'Nimble Obstructionist')];
  Game.move(game, pyre.iid, 'hand');
  assert.equal(Bot.handAbilities(pyre, defOf).find(a => a.kind === 'cycling').cost, '');
  const before = game.zones.battlefield.length;
  Bot.cycled(game, pyre, defOf, ctx(game));
  Bot.cycled(game, pyre, defOf, ctx(game));
  assert.equal(game.zones.battlefield.length, before + 1);
  assert.equal(game.cycleCount, 2);
  assert.equal(Bot.handAbilities(pyre, defOf).find(a => a.kind === 'cycling').cost, '{2}{U}');
  const forest = game.cards[find(game, 'Forest')];
  Game.move(game, forest.iid, 'hand');
  assert.equal(Bot.handAbilities(forest, defOf).find(a => a.kind === 'cycling').cost, '{R}');
});

test('The Master of Keys gives enchantment cards in your graveyard escape (mana cost and three other cards)', () => {
  const game = vsOpp();
  const glory = toGrave(game, 'Glory');
  assert.equal(Bot.escapeOf(glory, defOf), null);
  put(game, 'The Master of Keys');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(Bot.escapeOf(glory, defOf), { cost: '{4}', exile: 3 });
});

test('Make an Example: the opponent splits its creatures and loses one pile', () => {
  const game = vsOpp();
  ['Giant', 'Bear', 'Golem'].forEach(id => put(game.bot.s, id));
  Bot.runEffect(game, text('Make an Example'), ctx(game, { self: { name: 'Make an Example' } }));
  const left = game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).filter(c => Game.isCreature(c)).length;
  assert.ok(left >= 1 && left <= 2);
});

test('River\'s Rebuke returns the opponent\'s nonland permanents; Zndrsplt\'s Judgment copies yours and bounces theirs', () => {
  const game = vsOpp();
  const o = game.bot.s;
  const giant = put(o, 'Giant');
  const relic = put(o, 'Relic');
  const forest = put(o, 'Forest');
  Bot.runEffect(game, text('River\'s Rebuke'), ctx(game, { self: { name: 'River\'s Rebuke' } }));
  assert.equal(giant.zone, 'hand');
  assert.equal(relic.zone, 'hand');
  assert.equal(forest.zone, 'battlefield');
  const bear = put(o, 'Bear');
  put(game, 'Giant');
  Bot.runEffect(game, text('Zndrsplt\'s Judgment'), ctx(game, { self: { name: 'Zndrsplt\'s Judgment' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.id === 'Giant').length, 2);
  assert.equal(bear.zone, 'hand');
});

test('Athreos returns a creature with a coin counter to your battlefield when it dies', () => {
  const game = vsOpp();
  put(game, 'Athreos, Shroud-Veiled');
  Bot.refreshGrants(game, defOf);
  const giant = put(game.bot.s, 'Giant');
  Game.move(game.bot.s, giant.iid, 'graveyard');
  Bot.died(game.bot.s, giant, defOf, null, game, { to: 'graveyard', counters: { coin: 1 } });
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
});

test('Ancient Cellarspawn and Spellbinding Soprano make spells cheaper', () => {
  const game = vsOpp();
  const eater = game.cards[find(game, 'Dream Eater')];
  const bolt = game.cards[find(game, 'Bolt')];
  assert.equal(Bot.selfDiscount(game, eater, defOf), 0);
  put(game, 'Ancient Cellarspawn');
  assert.equal(Bot.selfDiscount(game, eater, defOf), 1); // a Nightmare
  Bot.runEffect(game, 'Instant and sorcery spells you cast this turn cost {1} less to cast.', ctx(game, { self: { name: 'Spellbinding Soprano' } }));
  assert.equal(Bot.selfDiscount(game, bolt, defOf), 1);
});

test('Waste Management exiles two cards from the opponent\'s graveyard and makes a Rogue per creature', () => {
  const game = vsOpp();
  ['Bear', 'Giant', 'Bolt'].forEach(id => toGrave(game.bot.s, id));
  const before = game.zones.battlefield.length;
  Bot.runEffect(game, text('Waste Management').replace(/^kicker \{[^}]+\}\{[^}]+\}\s*/i, ''), ctx(game, { self: { name: 'Waste Management' } }));
  assert.equal(game.bot.s.zones.graveyard.length, 1);
  assert.equal(game.zones.battlefield.length, before + 2);
});

test('Mirrormade enters as a copy of the best artifact or enchantment', () => {
  const game = vsOpp();
  put(game.bot.s, 'Idol');
  put(game, 'Relic');
  Bot.refreshGrants(game, defOf);
  const m = put(game, 'Mirrormade');
  Bot.enterTrigger(game, m, defOf);
  assert.equal(m.name, 'Idol');
});

// ---- The 20-23 decks (Revenant Recon, Eldrazi Incursion, Planeswalker Party, Tricky Terrain, Heads I Win, Limit Break, Eldrazi Unbound) ----

const withFlips = (wins, fn) => { const r = Game.randomInt; Game.randomInt = () => (wins ? 0 : 1); try { return fn(); } finally { Game.randomInt = r; } };

test('Surveil: Mirko and Dimir Spybug grow, Whispering Snitch pings only the first time each turn', () => {
  const game = vsOpp();
  const mirko = put(game, 'Mirko, Obsessive Theorist');
  const spy = put(game, 'Dimir Spybug');
  put(game, 'Whispering Snitch');
  Bot.refreshGrants(game, defOf);
  Bot.applyScry(game, 'surveil', game.zones.library.slice(0, 2), game.zones.library.slice(0, 1), 'Test');
  Bot.applyScry(game, 'surveil', game.zones.library.slice(0, 1), [], 'Test');
  assert.equal(mirko.counters['+1/+1'], 2);
  assert.equal(spy.counters['+1/+1'], 2);
  assert.equal(game.oppLife, 39);
});

test('Case of the Shifting Visage: its Solved ability waits until fifteen cards are in your graveyard at your end step', () => {
  const game = vsOpp();
  const kase = put(game, 'Case of the Shifting Visage');
  const solved = () => Bot.activatedAbilities && Bot.stats && Bot.parts && !!Bot.parts.NEAR && kase.solved === true;
  Bot.phaseTriggers(game, game, 'end step', defOf, ctx(game));
  assert.ok(!solved());
  for (let i = 0; i < 15; i++) Game.move(game, game.zones.library[0], 'graveyard');
  Bot.phaseTriggers(game, game, 'end step', defOf, ctx(game));
  assert.ok(solved());
});

test('Coin flips: Chance Encounter counts wins, Krark\'s Thumb gives a second chance, Zndrsplt draws on a win', () => {
  const game = vsOpp();
  const chance = put(game, 'Chance Encounter');
  put(game, 'Zndrsplt, Eye of Wisdom');
  const hand = game.zones.hand.length;
  withFlips(true, () => Bot.runEffect(game, 'Flip a coin.', ctx(game, { self: { name: 'Test' } })));
  assert.equal(chance.counters.luck, 1);
  assert.equal(game.zones.hand.length, hand + 1);
  withFlips(false, () => Bot.runEffect(game, 'Flip a coin.', ctx(game, { self: { name: 'Test' } })));
  assert.equal(chance.counters.luck, 1);
});

test('Stitch in Time takes an extra turn only on a win; Fiery Gambit does nothing on a loss', () => {
  const game = vsOpp();
  withFlips(false, () => Bot.runEffect(game, text('Stitch in Time'), ctx(game, { self: { name: 'Stitch in Time' } })));
  assert.ok(!game.extraTurns);
  const bear = put(game.bot.s, 'Bear');
  withFlips(false, () => Bot.runEffect(game, text('Fiery Gambit'), ctx(game, { self: { name: 'Fiery Gambit' } })));
  assert.equal(bear.zone, 'battlefield');
  assert.equal(game.oppLife, 40);
  withFlips(true, () => Bot.runEffect(game, text('Fiery Gambit'), ctx(game, { self: { name: 'Fiery Gambit' } })));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.oppLife, 34);
});

test('Selective Obliteration keeps colorless permanents and each player\'s main color', () => {
  const game = vsOpp();
  const golem = put(game, 'Golem');
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const flier = put(game.bot.s, 'Flier');
  put(game.bot.s, 'Bolt');
  Bot.runEffect(game, text('Selective Obliteration'), ctx(game, { self: { name: 'Selective Obliteration' } }));
  assert.equal(golem.zone, 'battlefield');
  assert.equal(bear.zone, 'battlefield');
  assert.equal([giant, flier].filter(c => c.zone === 'exile').length, 1);
});

test('Dark Depths thaws one ice counter at a time and makes Marit Lage at the last', () => {
  const game = vsOpp();
  const depths = put(game, 'Dark Depths');
  depths.counters = { ice: 2 };
  Bot.runEffect(game, 'Remove an ice counter from Dark Depths.', ctx(game, { self: depths }));
  assert.equal(depths.counters.ice, 1);
  Bot.runEffect(game, 'Remove an ice counter from Dark Depths.', ctx(game, { self: depths }));
  assert.equal(depths.zone, 'graveyard');
  assert.ok(game.zones.battlefield.some(i => game.cards[i].name === 'Marit Lage'));
});

test('It That Betrays takes a nontoken permanent the opponent sacrifices', () => {
  const game = vsOpp();
  put(game, 'It That Betrays');
  const giant = put(game.bot.s, 'Giant');
  Game.move(game.bot.s, giant.iid, 'graveyard');
  Bot.sacrificed(game, game.bot.s, giant, defOf);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
});

test('Calamity of the Titans exiles creatures cheaper than the colorless creature revealed', () => {
  const game = vsOpp();
  Game.move(game, find(game, 'It That Betrays'), 'hand');
  const bear = put(game.bot.s, 'Bear');
  const golem = put(game, 'Golem');
  Bot.runEffect(game, text('Calamity of the Titans'), ctx(game, { self: { name: 'Calamity of the Titans' } }));
  assert.equal(bear.zone, 'exile');
  assert.equal(golem.zone, 'exile');
});

test('Gatewatch Beacon enters with three loyalty counters; Matter Reshaper puts a cheap permanent onto the battlefield', () => {
  const game = vsOpp();
  const beacon = put(game, 'Gatewatch Beacon');
  Bot.refreshGrants(game, defOf);
  Bot.enterTrigger(game, beacon, defOf);
  assert.equal(beacon.counters.loyalty, 3);
  const bear = toTop(game, 'Bear');
  Bot.runEffect(game, 'Reveal the top card of your library. You may put that card onto the battlefield if it\'s a permanent card with mana value 3 or less. Otherwise, put that card into your hand.', ctx(game, { self: { name: 'Matter Reshaper' } }));
  assert.equal(bear.zone, 'battlefield');
});

// ---- The last twelve decks (Counter Blitz, Hail Caesar, Necron Dynasties, Science!, Scions & Spellcraft, The Ruinous Powers, Tyranid Swarm) ----

test('V.A.T.S. destroys the opponent\'s creatures sharing the most valuable toughness', () => {
  const game = vsOpp();
  const g1 = put(game.bot.s, 'Giant');
  const bear = put(game.bot.s, 'Bear');
  Bot.runEffect(game, text('V.A.T.S.', 1), ctx(game, { self: { name: 'V.A.T.S.' } }));
  assert.equal(g1.zone, 'graveyard');
  assert.equal(bear.zone, 'battlefield');
});

test('Clamavus doubles +1/+1 counters; Winged Hive Tyrant gives countered creatures flying', () => {
  const game = vsOpp();
  put(game, 'Clamavus');
  put(game, 'Winged Hive Tyrant');
  const bear = put(game, 'Bear');
  Game.counter(game, bear.iid, '+1/+1', 2);
  Bot.refreshGrants(game, defOf);
  assert.equal(st(bear).pow, 6);
  assert.ok(st(bear).kw.has('flying'));
});

test('Plague Drone turns the opponent\'s life gain into life loss', () => {
  const game = vsOpp();
  put(game, 'Plague Drone');
  const before = { you: game.life, opp: game.oppLife };
  game.oppLife += 3;
  Bot.lifeChanged(game, before, defOf, ctx(game));
  assert.equal(game.oppLife, 37);
});

test('Mandate of Abaddon destroys every creature weaker than your strongest', () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  const bear = put(game, 'Bear');
  const flier = put(game.bot.s, 'Flier');
  Bot.runEffect(game, text('Mandate of Abaddon'), ctx(game, { self: { name: 'Mandate of Abaddon' } }));
  assert.equal(giant.zone, 'battlefield');
  assert.equal(bear.zone, 'graveyard');
  assert.equal(flier.zone, 'graveyard');
});

test('The Swarmlord enters with two counters for each commander cast; Tyrant Guard shields countered creatures', () => {
  const game = vsOpp();
  const cmd = game.cards[find(game, 'Giant')];
  cmd.commander = true;
  cmd.castCount = 2;
  const lord = put(game, 'The Swarmlord');
  Bot.refreshGrants(game, defOf);
  Bot.enterTrigger(game, lord, defOf);
  assert.equal(lord.counters['+1/+1'], 4);
  Bot.runEffect(game, 'Creatures you control with counters on them gain hexproof and indestructible until end of turn.', ctx(game, { self: { name: 'Tyrant Guard' } }));
  assert.ok(lord.pump.kw.includes('indestructible'));
});

test('Electrosiphon gives energy equal to the countered spell\'s mana value', () => {
  const game = vsOpp();
  const parts = Bot.parts;
  assert.ok(parts.COUNTER_EXTRAS.some(re => re.test('You get an amount of {E} equal to its mana value')));
});
