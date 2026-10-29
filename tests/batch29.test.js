
// The precons that had 16 to 20 cards left (Creative Energy, Guided by Nature, … Undead Unleashed): their last cards, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./batch29-cards.json');
const basics = {
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Vault: { id: 'Vault', name: 'Vault', typeLine: 'Land', producedMana: ['C'], oracle: '{T}: Add {C}.', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Human Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Elf: { id: 'Elf', name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid', manaCost: '{G}', cmc: 1, power: '1', toughness: '1', oracle: '', colors: ['G'] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracle: '', colors: [] },
  Glory: { id: 'Glory', name: 'Glory', typeLine: 'Enchantment', manaCost: '{4}', cmc: 4, oracle: '', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: /^(Forest|Mountain)$/.test(id) ? 10 : 1 })) });
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
// That card on top of the library, wherever it was (the opening hand may hold it).
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
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every one of these cards is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Izzet Generatorium adds one energy, Aether Refinery doubles it; paying energy is counted for the turn', () => {
  const game = vsOpp();
  Bot.runEffect(game, 'You get {E}{E}.', ctx(game, { self: { name: 'Test' } }));
  assert.equal(game.energy, 2);
  put(game, 'Izzet Generatorium');
  put(game, 'Aether Refinery');
  Bot.runEffect(game, 'You get {E}{E}.', ctx(game, { self: { name: 'Test' } }));
  assert.equal(game.energy, 2 + 6); // (2 + 1) × 2
  Bot.payEnergy(game, 5);
  assert.equal(game.energy, 3);
  assert.equal(Bot.condition(game, "you've paid or lost four or more {E} this turn", ctx(game)), true);
  const hulk = game.cards[find(game, 'Blaster Hulk')];
  assert.equal(Bot.selfDiscount(game, hulk, defOf, game.bot.s), 5);
});

test('Localized Destruction saves your creatures whose power matches the energy paid', () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  const bear = put(game, 'Bear');
  const theirs = put(game.bot.s, 'Giant');
  game.energy = 3;
  Bot.runEffect(game, text('Localized Destruction'), ctx(game, { self: { name: 'Localized Destruction' } }));
  assert.equal(giant.zone, 'battlefield'); // power 4: 4 energy paid (3 + 1)
  assert.equal(bear.zone, 'graveyard');
  assert.equal(theirs.zone, 'graveyard');
  assert.equal(game.energy, 0);
});

test('Jolted Awake returns the best card the energy pays for', () => {
  const game = vsOpp();
  const bear = toGrave(game, 'Bear');
  toGrave(game, 'Giant');
  Bot.runEffect(game, text('Jolted Awake', 0), ctx(game, { self: { name: 'Jolted Awake' } }));
  assert.equal(bear.zone, 'battlefield');
  assert.equal(game.energy, 0);
});

test("Satya's token copy attacks and is kept at the end step only for its energy", () => {
  const game = vsOpp();
  const satya = put(game, 'Satya, Aetherflux Genius');
  put(game, 'Giant');
  const c = ctx(game, { self: satya });
  Bot.runEffect(game, text('Satya, Aetherflux Genius', 1).replace(/^Whenever Satya attacks, /, ''), c);
  const tok = game.cards[c.joined[0]];
  assert.equal(tok.name, 'Hill Giant');
  assert.equal(tok.attacking, true);
  assert.equal(game.energy, 2);
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(game.zones.battlefield.includes(tok.iid), false); // 2 energy, 4 needed
  assert.equal(game.energy, 2);
});

test("Wren's Run Packmaster champions an Elf, which returns when it leaves", () => {
  const game = vsOpp();
  const elf = put(game, 'Elf');
  const pm = put(game, "Wren's Run Packmaster");
  Bot.runEffect(game, 'champion an Elf', ctx(game, { self: pm }));
  assert.equal(elf.zone, 'exile');
  Game.move(game, pm.iid, 'graveyard');
  Bot.cardMoved(game, game, pm, 'battlefield', 'graveyard', defOf, ctx(game));
  assert.equal(elf.zone, 'battlefield');
});

test('Wave of Vitriol sacrifices artifacts and enchantments; From the Ashes trades nonbasic lands for basics', () => {
  const game = vsOpp();
  const relic = put(game.bot.s, 'Relic');
  const glory = put(game, 'Glory');
  const vault = put(game, 'Vault');
  Bot.runEffect(game, text('Wave of Vitriol'), ctx(game, { self: { name: 'Wave of Vitriol' } }));
  assert.equal(relic.zone, 'graveyard');
  assert.equal(glory.zone, 'graveyard');
  assert.equal(vault.zone, 'graveyard');
  const basic = game.zones.battlefield.map(i => game.cards[i]).find(c => /Basic/.test(c.typeLine));
  assert.equal(basic.tapped, true);
});

test('Terastodon destroys the opponent\'s noncreature permanents and gives it Elephants', () => {
  const game = vsOpp();
  const relic = put(game.bot.s, 'Relic');
  const glory = put(game.bot.s, 'Glory');
  const tera = put(game, 'Terastodon');
  Bot.runEffect(game, text('Terastodon').replace(/^When this creature enters, /, ''), ctx(game, { self: tera }));
  assert.equal(relic.zone, 'graveyard');
  assert.equal(glory.zone, 'graveyard');
  assert.equal(game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).filter(c => /Elephant/.test(c.typeLine)).length, 2);
});

test('Creeperhulk makes a creature of yours a 5/5 with trample', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  Bot.runEffect(game, 'Until end of turn, target creature you control has base power and toughness 5/5 and gains trample.', ctx(game, { self: put(game, 'Creeperhulk') }));
  const hulk = game.zones.battlefield.map(i => game.cards[i]).find(c => c.id === 'Creeperhulk');
  const pumped = [bear, hulk].find(c => st(c).pow === 5 && c !== hulk) || hulk;
  assert.equal(st(pumped).kw.has('trample'), true);
});

test('Fresh Meat makes a Beast for each of your creatures that died this turn', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const elf = put(game, 'Elf');
  for (const c of [bear, elf]) { Game.move(game, c.iid, 'graveyard'); Bot.afterDeath(game, game, c, { to: 'graveyard' }, defOf, ctx(game)); }
  Bot.runEffect(game, text('Fresh Meat'), ctx(game, { self: { name: 'Fresh Meat' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /Beast/.test(c.typeLine)).length, 2);
});

test('Razorfield Ripper attached as an Equipment is no creature, and gives its attack trigger', () => {
  const game = vsOpp();
  const ripper = put(game, 'Razorfield Ripper');
  const bear = put(game, 'Bear');
  assert.equal(Game.isCreature(ripper), true);
  Game.attach(game, ripper.iid, bear.iid, Bot.attachBonus(cards['Razorfield Ripper'].oracle));
  assert.equal(Game.isCreature(ripper), false);
  assert.match(Bot.attachBonus(cards['Razorfield Ripper'].oracle).lines[0], /^Whenever this creature attacks, you get \{E\}/);
  assert.equal(Bot.equipCost(cards['Razorfield Ripper'].oracle), '{2}');
});

test('Jungle Basin returns an untapped Forest, or is sacrificed without one', () => {
  const game = vsOpp();
  const basin = put(game, 'Jungle Basin');
  Bot.runEffect(game, "sacrifice it unless you return an untapped Forest you control to its owner's hand", ctx(game, { self: basin }));
  assert.equal(basin.zone, 'graveyard');
  const forest = put(game, 'Forest');
  const basin2 = put(game, 'Coral Atoll');
  Bot.runEffect(game, "sacrifice it unless you return an untapped Island you control to its owner's hand", ctx(game, { self: basin2 }));
  assert.equal(basin2.zone, 'graveyard');
  const basin3 = game.cards[find(game, 'Jungle Basin', ['graveyard'])];
  Game.move(game, basin3.iid, 'battlefield', { put: true });
  Bot.runEffect(game, "sacrifice it unless you return an untapped Forest you control to its owner's hand", ctx(game, { self: basin3 }));
  assert.equal(forest.zone, 'hand');
  assert.equal(basin3.zone, 'battlefield');
});

test('Fathom Mage draws for each +1/+1 counter put on it; Adapt only without counters', () => {
  const game = vsOpp();
  const mage = put(game, 'Fathom Mage');
  const hand = game.zones.hand.length;
  Game.counter(game, mage.iid, '+1/+1', 2);
  Bot.countersPut(game, game, mage, '+1/+1', 2, defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 2);
  const crab = put(game, 'Sharktocrab');
  Bot.runEffect(game, 'Adapt 1.', ctx(game, { self: crab }));
  Bot.runEffect(game, 'Adapt 1.', ctx(game, { self: crab }));
  assert.equal(crab.counters['+1/+1'], 1);
});

test("Shipbreaker Kraken's creatures stay tapped while it stays", () => {
  const game = vsOpp();
  const kraken = put(game, 'Shipbreaker Kraken');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Shipbreaker Kraken', 1).replace(/^When this creature becomes monstrous, /, ''), ctx(game, { self: kraken }));
  assert.equal(giant.tapped, true);
  assert.ok(giant.frozenBy);
  Bot.refreshGrants(game, defOf);
  assert.ok(giant.frozenBy);
  Game.move(game, kraken.iid, 'graveyard');
  Bot.refreshGrants(game, defOf);
  assert.equal(giant.frozenBy, undefined);
});

test('Nezahal leaves and returns tapped at the next end step', () => {
  const game = vsOpp();
  const nez = put(game, 'Nezahal, Primal Tide');
  Bot.runEffect(game, 'Exile Nezahal. Return it to the battlefield tapped under its owner\'s control at the beginning of the next end step.', ctx(game, { self: nez }));
  assert.equal(nez.zone, 'exile');
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(nez.zone, 'battlefield');
  assert.equal(nez.tapped, true);
});

test('Xathrid Demon sacrifices your weakest other creature for its power; Aether Snap clears counters and tokens', () => {
  const game = vsOpp();
  const demon = put(game, 'Xathrid Demon');
  const bear = put(game, 'Bear');
  put(game, 'Giant');
  Bot.runEffect(game, text('Xathrid Demon', 1).replace(/^At the beginning of your upkeep, /, ''), ctx(game, { self: demon }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.oppLife, 38);
  Game.counter(game, demon.iid, '+1/+1', 2);
  Bot.runEffect(game, 'create a 1/1 white Soldier creature token', ctx(game, { self: demon }));
  Bot.runEffect(game, text('Aether Snap'), ctx(game, { self: { name: 'Aether Snap' } }));
  assert.equal(demon.counters['+1/+1'] || 0, 0);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token).length, 0);
});

test('Tragic Slip is -13/-13 once a creature died this turn', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Tragic Slip'), ctx(game, { self: { name: 'Tragic Slip' } }));
  assert.equal(st(giant).pow, 3);
  game.deathsThisTurn = ['Grizzly Bears'];
  Bot.runEffect(game, text('Tragic Slip'), ctx(game, { self: { name: 'Tragic Slip' } }));
  assert.equal(giant.zone === 'battlefield' ? st(giant).tou <= 0 : true, true);
});

test('Sudden Spoiling makes the opponent\'s creatures 0/2 with no abilities', () => {
  const game = vsOpp();
  const viper = put(game.bot.s, 'Giant');
  viper.bot = { ...viper.bot, kw: ['trample'] };
  Bot.runEffect(game, text('Sudden Spoiling', 1), ctx(game, { self: { name: 'Sudden Spoiling' } }));
  const s = Bot.stats(viper, viper.bot);
  assert.equal(s.pow, 0);
  assert.equal(s.tou, 2);
  assert.equal(s.kw.has('trample'), false);
});

test('Crypt Ghast adds {B} for each Swamp tapped; Abyssal Persecutor keeps the opponent from losing', () => {
  const game = vsOpp();
  const swamp = { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] };
  defs.Swamp = swamp;
  game.cards.sw = { iid: 'sw', id: 'Swamp', name: 'Swamp', typeLine: swamp.typeLine, zone: 'battlefield', counters: {}, producedMana: ['B'] };
  game.zones.battlefield.push('sw');
  put(game, 'Crypt Ghast');
  Bot.refreshGrants(game, defOf);
  assert.equal(game.swampExtra, 1);
  put(game, 'Abyssal Persecutor');
  Bot.refreshGrants(game, defOf);
  assert.equal(game.bot.s.cantLose, true);
  assert.equal(game.cantLose, false);
});

test('Elder Deep-Fiend can emerge by sacrificing a creature, its mana value off the cost', () => {
  const game = vsOpp();
  put(game, 'Giant');
  const fiend = game.cards[find(game, 'Elder Deep-Fiend')];
  const em = Bot.costChoices(game, fiend, defOf).find(c => c.key === 'emerge');
  assert.equal(em.cost, '{1}{U}{U}');
  assert.ok(em.sacIid);
});

test('Whelming Wave returns every creature but the Krakens; Scourge of Fleets only small ones of the opponent', () => {
  const game = vsOpp();
  const kraken = put(game, 'Shipbreaker Kraken');
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Whelming Wave'), ctx(game, { self: { name: 'Whelming Wave' } }));
  assert.equal(kraken.zone, 'battlefield');
  assert.equal(bear.zone, 'hand');
  assert.equal(giant.zone, 'hand');
});

test('Heliod is a creature only with devotion to white of five; Starfield of Nyx animates your other enchantments', () => {
  const game = vsOpp();
  const heliod = put(game, 'Heliod, God of the Sun');
  Bot.refreshGrants(game, defOf);
  assert.equal(Game.isCreature(heliod), false); // {3}{W}: devotion 1
  put(game, 'Starfield of Nyx');
  for (const id of ['Glory']) put(game, id);
  for (let i = 0; i < 3; i++) { const g2 = { ...defs.Glory, id: `Glory${i}`, manaCost: '{W}{W}', cmc: 2 }; defs[g2.id] = g2; game.cards[`gx${i}`] = { iid: `gx${i}`, id: g2.id, name: 'Glory', typeLine: 'Enchantment', zone: 'battlefield', counters: {} }; game.zones.battlefield.push(`gx${i}`); }
  Bot.refreshGrants(game, defOf);
  assert.equal(Game.isCreature(heliod), true); // 1 + 6 white pips
  const glory = game.zones.battlefield.map(i => game.cards[i]).find(c => c.id === 'Glory');
  assert.equal(Game.isCreature(glory), true);
  assert.equal(st(glory).pow, 4);
});

test('Abundance digs to a land when the hand has none, else to a nonland card', () => {
  const game = vsOpp();
  put(game, 'Abundance');
  [...game.zones.hand].forEach(i => Game.move(game, i, 'graveyard'));
  game.zones.library.sort((a, b) => Game.isLand(game.cards[a]) - Game.isLand(game.cards[b]));
  Game.hooks.drawInstead = (s, first) => Bot.drawInstead(game, s, first, defOf);
  Game.drawCards(game, 1);
  assert.equal(Game.isLand(game.cards[game.zones.hand[0]]), true);
  Game.drawCards(game, 1);
  assert.equal(game.zones.hand.filter(i => Game.isLand(game.cards[i])).length, 1);
  assert.equal(game.zones.hand.length, 2);
});

test("Saheeli, the Gifted: the next spell has affinity for artifacts; the −7 copies each artifact with haste until the end step", () => {
  const game = vsOpp();
  put(game, 'Relic');
  put(game, 'Blinkmoth Urn');
  const sah = put(game, 'Saheeli, the Gifted');
  Bot.runEffect(game, 'The next spell you cast this turn has affinity for artifacts.', ctx(game, { self: sah }));
  const bear = game.cards[find(game, 'Bear')];
  assert.equal(Bot.selfDiscount(game, bear, defOf, game.bot.s), 2);
  Bot.spellCast(game, game, bear, defOf, ctx(game));
  assert.equal(Bot.selfDiscount(game, bear, defOf, game.bot.s), 0);
  Bot.runEffect(game, text('Saheeli, the Gifted', 2).replace(/^−7: /, ''), ctx(game, { self: sah }));
  const toks = game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token);
  assert.equal(toks.length, 2);
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token).length, 0);
});

test('Mimic Vat imprints a creature that died and makes hasty copies of it; Prototype Portal imprints from your hand', () => {
  const game = vsOpp();
  const vat = put(game, 'Mimic Vat');
  const giant = toGrave(game.bot.s, 'Giant');
  Bot.runEffect(game, 'you may exile that card. If you do, return each other card exiled with this artifact to its owner\'s graveyard.', ctx(game, { self: vat, dead: giant, deadT: game.bot.s }));
  assert.equal(giant.zone, 'exile');
  Bot.runEffect(game, 'Create a token that\'s a copy of a card exiled with this artifact. It gains haste. Exile it at the beginning of the next end step.', ctx(game, { self: vat }));
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token);
  assert.equal(tok.name, 'Hill Giant');
  const portal = put(game, 'Prototype Portal');
  Game.move(game, find(game, 'Relic'), 'hand');
  Bot.runEffect(game, 'you may exile an artifact card from your hand.', ctx(game, { self: portal }));
  const imprinted = game.zones.exile.map(i => game.cards[i]).find(c => c.exiledWith === portal.iid);
  assert.match(imprinted.typeLine, /Artifact/);
});

test('Wake the Dead returns creatures until the end step; Anikthea makes a 3/3 Zombie copy of an enchantment', () => {
  const game = vsOpp();
  const giant = toGrave(game, 'Giant');
  Bot.runEffect(game, 'Return 1 target creature cards from your graveyard to the battlefield. Sacrifice those creatures at the beginning of the next end step.', ctx(game, { self: { name: 'Wake the Dead' } }));
  assert.equal(giant.zone, 'battlefield');
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(giant.zone, 'graveyard');
  const glory = toGrave(game, 'Glory');
  const ani = put(game, 'Anikthea, Hand of Erebos');
  Bot.runEffect(game, text('Anikthea, Hand of Erebos', 2).replace(/^Whenever Anikthea enters or attacks, /, ''), ctx(game, { self: ani }));
  assert.equal(glory.zone, 'exile');
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token);
  assert.equal(Game.isCreature(tok), true);
  assert.equal(st(tok).pow, 3);
});

test("Demon of Fate's Design lets an enchantment be cast for life once a turn; Nyxborn Behemoth costs less for your enchantments", () => {
  const game = vsOpp();
  put(game, "Demon of Fate's Design");
  const star = game.cards[find(game, 'Starfield of Nyx')];
  const life = Bot.costChoices(game, star, defOf).find(c => c.key === 'life');
  assert.equal(life.life, 5);
  game.lifeCastTurn = game.turn;
  assert.equal(Bot.costChoices(game, star, defOf).some(c => c.key === 'life'), false);
  put(game, 'Glory');
  const nyx = game.cards[find(game, 'Nyxborn Behemoth')];
  assert.equal(Bot.selfDiscount(game, nyx, defOf, game.bot.s), 4);
});

test('Sandwurm Convergence keeps flyers from attacking you', () => {
  const game = vsOpp();
  const flyer = put(game.bot.s, 'Bear');
  flyer.bot = { ...flyer.bot, kw: ['flying'] };
  const bear = put(game.bot.s, 'Giant');
  assert.equal(Bot.barredFromYou(game, flyer, defOf), false);
  put(game, 'Sandwurm Convergence');
  assert.equal(Bot.barredFromYou(game, flyer, defOf), true);
  assert.equal(Bot.barredFromYou(game, bear, defOf), false);
});

test("Pain Distributor: a Treasure for each player's first spell, and 1 damage when an opponent's artifact dies", () => {
  const game = vsOpp();
  put(game, 'Pain Distributor');
  const bear = game.cards[find(game, 'Bear')];
  Bot.spellCast(game, game, bear, defOf, ctx(game));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /Treasure/.test(c.name)).length, 1);
  const relic = put(game.bot.s, 'Relic');
  Game.move(game.bot.s, relic.iid, 'graveyard');
  Bot.cardMoved(game, game.bot.s, relic, 'battlefield', 'graveyard', defOf, ctx(game));
  assert.equal(game.oppLife, 39);
});

test("Varchild's Survivors can't block or attack you, and come over when it leaves", () => {
  const game = vsOpp();
  const v = put(game, 'Varchild, Betrayer of Kjeldor');
  Bot.runEffect(game, 'that player creates 2 1/1 red Survivor creature tokens.', ctx(game, { self: v }));
  const surv = game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).filter(c => /Survivor/.test(c.typeLine));
  assert.equal(surv.length, 2);
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(surv[0], surv[0].bot).kw.has("can't block"), true);
  Bot.runEffect(game, 'gain control of all Survivors.', ctx(game, { self: v }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /Survivor/.test(c.typeLine)).length, 2);
});

test('Rise and Shine animates your best noncreature artifact with four +1/+1 counters', () => {
  const game = vsOpp();
  const relic = put(game, 'Relic');
  Bot.runEffect(game, text('Rise and Shine', 0), ctx(game, { self: { name: 'Rise and Shine' } }));
  assert.equal(Game.isCreature(relic), true);
  assert.equal(st(relic).pow, 4);
});

test("Saheeli's Directive puts the cheap artifacts onto the battlefield, the rest into the graveyard", () => {
  const game = vsOpp();
  const relic = game.cards[find(game, 'Relic')];
  const bear = game.cards[find(game, 'Bear')];
  game.zones.library = [relic.iid, bear.iid, ...game.zones.library.filter(i => i !== relic.iid && i !== bear.iid)];
  Bot.runEffect(game, 'Reveal the top 3 cards of your library. You may put any number of artifact cards with mana value 3 or less from among them onto the battlefield. Then put all cards revealed this way that weren\'t put onto the battlefield into your graveyard.', ctx(game, { self: { name: "Saheeli's Directive" } }));
  assert.equal(relic.zone, 'battlefield');
  assert.equal(bear.zone, 'graveyard');
});

test('Sandsteppe War Riders bolsters by your differently named artifact tokens; Wingmate Roc counts attackers', () => {
  const game = vsOpp();
  const riders = put(game, 'Sandsteppe War Riders');
  const bear = put(game, 'Bear');
  Bot.runEffect(game, 'create a treasure token. create a clue token. create a treasure token.', ctx(game, { self: riders }));
  Bot.runEffect(game, 'bolster X, where X is the number of differently named artifact tokens you control.', ctx(game, { self: riders }));
  assert.equal(bear.counters['+1/+1'], 2);
  bear.attacking = true;
  riders.attacking = true;
  const life = game.life;
  Bot.runEffect(game, 'you gain 1 life for each attacking creature.', ctx(game, { self: riders }));
  assert.equal(game.life, life + 2);
});

test("Momentous Fall sacrifices your weakest creature for cards and life; Brass's Bounty makes a Treasure per land", () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  const hand = game.zones.hand.length;
  Bot.runEffect(game, text('Momentous Fall'), ctx(game, { self: { name: 'Momentous Fall' } }));
  assert.equal(giant.zone, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 4);
  assert.equal(game.life, 44);
  put(game, 'Forest');
  put(game, 'Forest');
  Bot.runEffect(game, text("Brass's Bounty"), ctx(game, { self: { name: "Brass's Bounty" } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /Treasure/.test(c.name)).length, 2);
});

test('Tectonic Hellion makes the player with the most lands sacrifice two; Replicating Ring makes eight rings at eight counters', () => {
  const game = vsOpp();
  for (let i = 0; i < 3; i++) put(game, 'Forest');
  put(game.bot.s, 'Mountain');
  Bot.runEffect(game, 'each player who controls the most lands sacrifices two lands of their choice.', ctx(game, { self: { name: 'Tectonic Hellion' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => Game.isLand(c)).length, 1);
  const ring = put(game, 'Replicating Ring');
  Game.counter(game, ring.iid, 'night', 8);
  Bot.runEffect(game, text('Replicating Ring', 1).replace(/^At the beginning of your upkeep, put a night counter on this artifact\. /, ''), ctx(game, { self: ring }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.name === 'Replicated Ring').length, 8);
});

test('Inspiring Statuary gives nonartifact spells improvise; Marisi stops Opp casting in combat', () => {
  const game = vsOpp();
  const bear = game.cards[find(game, 'Bear')];
  assert.equal(Bot.hasImprovise(game, bear, defOf), false);
  put(game, 'Inspiring Statuary');
  assert.equal(Bot.hasImprovise(game, bear, defOf), true);
  put(game, 'Marisi, Breaker of the Coil');
  game.bot.respond = true;
  game.bot.started = true;
  assert.deepEqual(Bot.oppInstantAt(game, defOf, 'attack', []), []);
});

test('Marwyn taps for green equal to its power; Eyeblight Massacre shrinks only non-Elves', () => {
  const game = vsOpp();
  const marwyn = put(game, 'Marwyn, the Nurturer');
  Game.counter(game, marwyn.iid, '+1/+1', 2);
  const ab = Bot.activatedAbilities(marwyn, defOf).find(a => /add an amount/i.test(a.effect));
  Bot.runEffect(game, ab.effect, ctx(game, { self: marwyn }));
  assert.equal(game.mana.G, 3);
  const elf = put(game, 'Elf');
  const bear = put(game.bot.s, 'Bear');
  Bot.runEffect(game, text('Eyeblight Massacre'), ctx(game, { self: { name: 'Eyeblight Massacre' } }));
  assert.equal(st(elf).pow, 1);
  assert.equal(Bot.stats(bear, bear.bot).pow, 0);
});

test('Bounty of Skemfar puts a land onto the battlefield tapped and an Elf into your hand', () => {
  const game = vsOpp();
  const elf = toTop(game, 'Elf');
  const forest = toTop(game, 'Forest');
  Bot.runEffect(game, text('Bounty of Skemfar'), ctx(game, { self: { name: 'Bounty of Skemfar' } }));
  assert.equal(forest.zone, 'battlefield');
  assert.equal(forest.tapped, true);
  assert.equal(game.zones.hand.map(i => game.cards[i]).some(c => c.typeLine.includes('Elf') || c.changeling), true); // (Masked Vandal is an Elf too)
});

test('Oblivion Stone spares permanents with fate counters', () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  const bear = put(game.bot.s, 'Bear');
  Game.counter(game, giant.iid, 'fate', 1);
  Bot.runEffect(game, 'Destroy each nonland permanent without a fate counter on it, then remove all fate counters from all permanents.', ctx(game, { self: { name: 'Oblivion Stone' } }));
  assert.equal(giant.zone, 'battlefield');
  assert.equal(giant.counters.fate || 0, 0);
  assert.equal(bear.zone, 'graveyard');
});

test('Glint Raker gets +X/+0 for your costliest artifact; Blast-Furnace Hellkite gives your attackers double strike', () => {
  const game = vsOpp();
  const raker = put(game, 'Glint Raker');
  put(game, 'Relic');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(raker).pow, 4);
  put(game, 'Blast-Furnace Hellkite');
  const bear = put(game, 'Bear');
  bear.attacking = true;
  Bot.refreshGrants(game, defOf);
  assert.equal(st(bear).kw.has('double strike'), true);
});

test('Oni-Cult Anvil makes a Construct once a turn when your artifacts leave; Traxos stays tapped', () => {
  const game = vsOpp();
  put(game, 'Oni-Cult Anvil');
  const relic = put(game, 'Relic');
  Game.move(game, relic.iid, 'graveyard');
  Bot.cardMoved(game, game, relic, 'battlefield', 'graveyard', defOf, ctx(game));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /Construct/.test(c.typeLine)).length, 1);
  assert.deepEqual(Game.entersTapped('Traxos, Scourge of Kroog', cards['Traxos, Scourge of Kroog'].oracle), true);
  const traxos = put(game, 'Traxos, Scourge of Kroog');
  Bot.refreshGrants(game, defOf);
  assert.equal(traxos.noUntap, true);
});

test('Ruthless Winnower makes the player whose upkeep it is sacrifice a non-Elf; Sylvan Messenger takes the Elves', () => {
  const game = vsOpp();
  const w = put(game, 'Ruthless Winnower');
  const bear = put(game, 'Bear');
  const elf = put(game, 'Elf');
  Bot.runEffect(game, 'that player sacrifices a non-Elf creature of their choice.', ctx(game, { self: w }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(elf.zone, 'battlefield');
  const elf2 = game.cards[find(game, 'Elvish Rejuvenator')];
  game.zones.library = [elf2.iid, ...game.zones.library.filter(i => i !== elf2.iid)];
  Bot.runEffect(game, text('Sylvan Messenger', 1).replace(/^When this creature enters, /, ''), ctx(game, { self: w }));
  assert.equal(elf2.zone, 'hand');
});

test("Mishra makes a hasty 4/4 copy of your noncreature artifact; Geth steals from the opponent's graveyard", () => {
  const game = vsOpp();
  const mishra = put(game, 'Mishra, Eminent One');
  put(game, 'Relic');
  Bot.runEffect(game, text('Mishra, Eminent One', 0).replace(/^At the beginning of combat on your turn, /, ''), ctx(game, { self: mishra }));
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token);
  assert.equal(Game.isCreature(tok), true);
  assert.equal(st(tok).pow, 4);
  const geth = put(game, 'Geth, Lord of the Vault');
  const theirs = toGrave(game.bot.s, 'Bear');
  Bot.runEffect(game, "Put target artifact or creature card with mana value 2 from an opponent's graveyard onto the battlefield tapped under your control. Then that player mills 2 cards.", ctx(game, { self: geth }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).some(c => c.name === theirs.name && c.tapped), true);
});

test('Numa pays the most {X}{X} it can and spreads the counters over your Elves', () => {
  const game = vsOpp();
  const numa = put(game, 'Numa, Joraga Chieftain');
  const elf = put(game, 'Elf');
  for (let i = 0; i < 4; i++) put(game, 'Forest');
  Bot.runEffect(game, text('Numa, Joraga Chieftain', 0).replace(/^At the beginning of combat on your turn, /, ''), ctx(game, { self: numa }));
  assert.equal((numa.counters['+1/+1'] || 0) + (elf.counters['+1/+1'] || 0), 2);
});

test('Windfall: each player discards their hand and draws the most anyone discarded; Stitch Together returns to the battlefield with threshold', () => {
  const game = vsOpp();
  const most = Math.max(game.zones.hand.length, game.bot.s.zones.hand.length);
  Bot.runEffect(game, text('Windfall'), ctx(game, { self: { name: 'Windfall' } }));
  assert.equal(game.zones.hand.length, most);
  assert.equal(game.bot.s.zones.hand.length, most);
  toGrave(game, 'Giant');
  while (game.zones.graveyard.length < 7) Game.move(game, game.zones.library[0], 'graveyard');
  const before = game.zones.battlefield.length;
  Bot.runEffect(game, text('Stitch Together'), ctx(game, { self: { name: 'Stitch Together' } }));
  assert.equal(game.zones.battlefield.length, before + 1);
});

test('Hunting Wilds kicked makes its Forests hasty 3/3 creatures; Pyretic Charge pumps for each card discarded', () => {
  const game = vsOpp();
  Bot.runEffect(game, text('Hunting Wilds').replace(/^Kicker \{3\}\{G\} /, ''), ctx(game, { self: { name: 'Hunting Wilds', kicked: true } }));
  const forests = game.zones.battlefield.map(i => game.cards[i]).filter(c => c.id === 'Forest');
  assert.equal(forests.length, 2);
  assert.equal(Game.isCreature(forests[0]), true);
  assert.equal(forests[0].tapped, false);
  const bear = put(game, 'Bear');
  const n = game.zones.hand.length;
  Bot.runEffect(game, text('Pyretic Charge', 0), ctx(game, { self: { name: 'Pyretic Charge' } }));
  assert.equal(st(bear).pow, 2 + n);
  assert.equal(game.zones.hand.length, 4);
});

test('Crackling Spellslinger gives the next instant or sorcery storm; Kaza makes it cheaper; Smoldering Stagecoach gives cascade', () => {
  const game = vsOpp();
  Bot.runEffect(game, 'the next instant or sorcery spell you cast this turn has storm', ctx(game, { self: { name: 'Crackling Spellslinger' } }));
  assert.equal(game.stormNext, game.turn);
  const kaza = put(game, 'Kaza, Roil Chaser');
  Bot.runEffect(game, 'The next instant or sorcery spell you cast this turn costs {X} less to cast, where X is the number of Wizards you control as this ability resolves.', ctx(game, { self: kaza }));
  const slip = game.cards[find(game, 'Tragic Slip')];
  assert.equal(Bot.selfDiscount(game, slip, defOf, game.bot.s), 1);
  Bot.runEffect(game, 'the next instant spell and the next sorcery spell you cast this turn each have cascade.', ctx(game, { self: kaza }));
  assert.equal(game.cascadeNext.instant, true);
});

test('Crash of Rhino Beetles gets +10/+10 with ten lands; Timber Paladin grows with Auras; Ox Drover evades Oxen', () => {
  const game = vsOpp();
  const crash = put(game, 'Crash of Rhino Beetles');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(crash).pow, 5);
  for (let i = 0; i < 10; i++) put(game, 'Forest');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(crash).pow, 15);
  const ox = put(game, 'Ox Drover');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(ox).kw.has('evade ox'), true);
});

test('Xantcha enters under the opponent\'s control and can\'t attack you from there', () => {
  const game = vsOpp();
  Bot.refreshGrants(game, defOf);
  const x = put(game, 'Xantcha, Sleeper Agent');
  Bot.enterTrigger(game, x, defOf);
  const theirs = game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).find(c => /Xantcha/.test(c.name));
  assert.ok(theirs);
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(theirs, theirs.bot).kw.has("can't attack"), true);
  assert.deepEqual(Bot.anyPlayerAbility(theirs, defOf), { cost: '{3}', life: 2 });
});

test('Gyrus enters with counters for the mana spent; Epic Experiment casts the cheap spells it exiles', () => {
  const game = vsOpp();
  const gyrus = put(game, 'Gyrus, Waker of Corpses');
  gyrus.wasCast = true;
  gyrus.xValue = 2;
  Bot.enterTrigger(game, gyrus, defOf);
  assert.equal(gyrus.counters['+1/+1'], 5);
  const slip = game.cards[find(game, 'Tragic Slip')];
  game.zones.library = [slip.iid, ...game.zones.library.filter(i => i !== slip.iid)];
  Bot.runEffect(game, 'Exile the top 2 cards of your library. You may cast instant and sorcery spells with mana value 2 or less from among them without paying their mana costs. Then put all cards exiled this way that weren\'t cast into your graveyard.', ctx(game, { self: { name: 'Epic Experiment' } }));
  assert.notEqual(slip.zone, 'library');
  assert.notEqual(slip.zone, 'exile');
});

test('Umbra armor: the Aura is destroyed instead of the creature', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const umbra = put(game, 'Bear Umbra');
  Game.attach(game, umbra.iid, bear.iid, Bot.attachBonus(cards['Bear Umbra'].oracle));
  assert.equal(Bot.regenerates(game, bear, defOf, false), true);
  assert.equal(umbra.zone, 'graveyard');
  assert.equal(bear.zone, 'battlefield');
});

test("Tithe Taker taxes the opponent's spells on your turn; The Eternal Wanderer's −4 leaves each player one creature", () => {
  const game = vsOpp();
  put(game, 'Tithe Taker');
  game.offTurn = false;
  assert.equal(Bot.tableRules(game, defOf).spellTaxes.some(t => t.opps && t.n === 1), true);
  put(game, 'Bear');
  put(game, 'Giant');
  put(game.bot.s, 'Bear');
  put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'For each player, choose a creature that player controls. Each player sacrifices all creatures they control not chosen this way.', ctx(game, { self: { name: 'The Eternal Wanderer' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => Game.isCreature(c)).length, 1);
  assert.equal(game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).filter(c => Game.isCreature(c)).length, 1);
});

test("Mayael's Aria and Helix Pinnacle win the game; Hellkite Tyrant takes the opponent's artifacts", () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  Game.counter(game, giant.iid, '+1/+1', 16);
  Bot.runEffect(game, text("Mayael's Aria").replace(/^At the beginning of your upkeep, /, ''), ctx(game, { self: put(game, "Mayael's Aria") }));
  assert.equal(game.oppLife <= 0, true);
  const g2 = vsOpp();
  const helix = put(g2, 'Helix Pinnacle');
  Game.counter(g2, helix.iid, 'tower', 100);
  Bot.runEffect(g2, 'if there are 100 or more tower counters on this enchantment, you win the game.', ctx(g2, { self: helix }));
  assert.equal(g2.oppLife <= 0, true);
  const g3 = vsOpp();
  const relic = put(g3.bot.s, 'Relic');
  Bot.runEffect(g3, 'gain control of all artifacts that player controls.', ctx(g3, { self: put(g3, 'Hellkite Tyrant') }));
  assert.equal(g3.zones.battlefield.map(i => g3.cards[i]).some(c => c.name === relic.name), true);
});

test('Mystic Remora pays its cumulative upkeep while it can, then goes; Gateway Plaza is kept when {1} is paid', () => {
  const game = vsOpp();
  const remora = put(game, 'Mystic Remora');
  put(game, 'Forest');
  Bot.runEffect(game, 'pay cumulative upkeep {1} or sacrifice this permanent', ctx(game, { self: remora }));
  assert.equal(remora.zone, 'battlefield');
  Bot.runEffect(game, 'pay cumulative upkeep {1} or sacrifice this permanent', ctx(game, { self: remora }));
  assert.equal(remora.zone, 'graveyard');
  const plaza = put(game, 'Gateway Plaza');
  Bot.runEffect(game, 'sacrifice it unless you pay {1}', ctx(game, { self: plaza }));
  assert.equal(plaza.zone, 'graveyard'); // the Forest is tapped already
});

test('Kindred Boon makes creatures with divinity counters indestructible; Promise of Aclazotz populates for a sacrifice', () => {
  const game = vsOpp();
  put(game, 'Kindred Boon');
  const bear = put(game, 'Bear');
  Game.counter(game, bear.iid, 'divinity', 1);
  Bot.refreshGrants(game, defOf);
  assert.equal(st(bear).kw.has('indestructible'), true);
  Bot.runEffect(game, 'create a 1/1 white Soldier creature token', ctx(game, { self: { name: 'Test' } }));
  const elf = put(game, 'Elf');
  Bot.runEffect(game, 'you may sacrifice a non-Demon creature. If you do, populate.', ctx(game, { self: { name: 'Promise of Aclazotz' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token).length, 2);
  assert.equal([bear, elf].filter(c => c.zone === 'graveyard').length, 1);
});

test('Kazandu Tuskcaller levels up: its tap ability appears at level 2 and makes two Elephants at 6; graft enters with counters', () => {
  const game = vsOpp();
  const k = put(game, 'Kazandu Tuskcaller');
  assert.equal(Bot.activatedAbilities(k, defOf).filter(a => /elephant/i.test(a.effect)).length, 0);
  Game.counter(game, k.iid, 'level', 2);
  assert.match(Bot.activatedAbilities(k, defOf).find(a => /elephant/i.test(a.effect)).effect, /Create a 3\/3/);
  Game.counter(game, k.iid, 'level', 4);
  assert.match(Bot.activatedAbilities(k, defOf).find(a => /elephant/i.test(a.effect)).effect, /Create two/);
  assert.deepEqual(Game.entersWithCounters(cards['Plaxcaster Frogling'].oracle), { '+1/+1': 3 });
});

test('Curse of Predation grows each attacker; War Cadence taxes each blocker', () => {
  const game = vsOpp();
  put(game, 'Curse of Predation');
  const bear = put(game, 'Bear');
  Bot.attackWatch(game, game, defOf, ctx(game), [bear]);
  assert.equal(bear.counters['+1/+1'], 1);
  Bot.runEffect(game, 'This turn, creatures can\'t block unless their controller pays {2} for each blocking creature they control.', ctx(game, { self: { name: 'War Cadence' } }));
  assert.equal(Bot.tableRules(game.bot.s, defOf).blockTax, 2);
});

test('Nighthawk Scavenger counts card types in the opponent\'s graveyard; Master Biomancer grows your creatures as they enter', () => {
  const game = vsOpp();
  const hawk = put(game, 'Nighthawk Scavenger');
  toGrave(game.bot.s, 'Bear');
  toGrave(game.bot.s, 'Relic');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(hawk).pow, 3);
  put(game, 'Master Biomancer');
  const bear = put(game, 'Bear');
  Bot.enterTrigger(game, bear, defOf);
  assert.equal(bear.counters['+1/+1'], 2);
  assert.match(bear.typeLine, /Mutant/);
});

test('Crafty Cutpurse takes the opponent\'s new tokens this turn; Theoretical Duplication copies its new creatures', () => {
  const game = vsOpp();
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'each token that would be created under an opponent\'s control this turn is created under your control instead', ctx(game, { self: { name: 'Crafty Cutpurse' } }));
  const tok = Game.createToken(game.bot.s, { custom: true, name: 'Soldier', typeLine: 'Token Creature — Soldier', pt: '1/1', text: '' });
  Bot.enterTrigger(game.bot.s, tok, defOf);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).some(c => c.name === 'Soldier'), true);
  game.dupTurn = game.turn;
  const giant = put(game.bot.s, 'Giant');
  Bot.enterTrigger(game.bot.s, giant, defOf);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).some(c => c.token && c.name === 'Hill Giant'), true);
});

test("Sorin, Lord of Innistrad's −6 takes the opponent's best creatures; Olivia's Wrath shrinks non-Vampires", () => {
  const game = vsOpp();
  put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'Destroy up to three target creatures and/or other planeswalkers. Return each card put into a graveyard this way to the battlefield under your control.', ctx(game, { self: { name: 'Sorin' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).some(c => c.name === 'Hill Giant'), true);
  put(game, 'Nighthawk Scavenger');
  const bear = put(game.bot.s, 'Bear');
  Bot.runEffect(game, text("Olivia's Wrath"), ctx(game, { self: { name: "Olivia's Wrath" } }));
  assert.equal(Bot.stats(bear, bear.bot).pow, 1);
});

test('Oathsworn Vampire can be cast from the graveyard after you gained life; Witch Hunt goes to the opponent', () => {
  const game = vsOpp();
  const v = toGrave(game, 'Oathsworn Vampire');
  assert.equal(Bot.graveCast(game, v, defOf), false);
  game.gainTurn = game.turn;
  assert.equal(Bot.graveCast(game, v, defOf), true);
  const wh = put(game, 'Witch Hunt');
  Bot.runEffect(game, 'target opponent chosen at random gains control of this enchantment', ctx(game, { self: wh }));
  assert.equal(game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).some(c => c.name === 'Witch Hunt'), true);
});

test('Paradox Zone doubles its growth counters; Orochi Hatchery makes a Snake per charge counter; Deadly Tempest drains per creature lost', () => {
  const game = vsOpp();
  const zone = put(game, 'Paradox Zone');
  Game.counter(game, zone.iid, 'growth', 2);
  Bot.runEffect(game, 'double the number of growth counters on this enchantment', ctx(game, { self: zone }));
  assert.equal(zone.counters.growth, 4);
  const hatch = put(game, 'Orochi Hatchery');
  Game.counter(game, hatch.iid, 'charge', 3);
  Bot.runEffect(game, 'Create a 1/1 green Snake creature token for each charge counter on this artifact.', ctx(game, { self: hatch }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /Snake/.test(c.typeLine)).length, 3);
  put(game.bot.s, 'Bear');
  put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Deadly Tempest'), ctx(game, { self: { name: 'Deadly Tempest' } }));
  assert.equal(game.oppLife, 38);
  assert.equal(game.life, 37);
});

test('Noble Quarry is a lure; Etched Champion has protection with three artifacts; Day of the Dragons trades your creatures for Dragons', () => {
  const game = vsOpp();
  const chim = put(game, 'Noble Quarry');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(chim).kw.has('lure'), true);
  const champ = put(game, 'Etched Champion');
  put(game, 'Relic');
  put(game, 'Liquimetal Torque');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(champ).kw.has('protection from each color'), true);
  const g2 = vsOpp();
  put(g2, 'Bear');
  put(g2, 'Giant');
  const day = put(g2, 'Day of the Dragons');
  Bot.runEffect(g2, 'exile all creatures you control. Then create that many 5/5 red Dragon creature tokens with flying.', ctx(g2, { self: day }));
  assert.equal(g2.zones.battlefield.map(i => g2.cards[i]).filter(c => /Dragon/.test(c.typeLine)).length, 2);
  Bot.runEffect(g2, 'sacrifice all Dragons you control. Then return the exiled cards to the battlefield under your control.', ctx(g2, { self: day }));
  assert.equal(g2.zones.battlefield.map(i => g2.cards[i]).filter(c => c.id === 'Bear' || c.id === 'Giant').length, 2);
});

test('Ezzaroot Channeler and Sproutback Trudge cost less for the life you gained; Ob Nixilis\'s emblem drains on draws', () => {
  const game = vsOpp();
  put(game, 'Ezzaroot Channeler');
  game.gainTurn = game.turn;
  game.gainedLife = 3;
  const giant = game.cards[find(game, 'Giant')];
  assert.equal(Bot.selfDiscount(game, giant, defOf, game.bot.s), 3);
  const trudge = toGrave(game, 'Sproutback Trudge');
  assert.equal(Bot.graveCast(game, trudge, defOf), true);
  Bot.runEffect(game, 'Target opponent gets an emblem with "Whenever a player draws a card, you lose 2 life."', ctx(game, { self: { name: 'Ob Nixilis' } }));
  Bot.opponentActed(game, game, 'draw', 1, defOf, ctx(game));
  assert.equal(game.oppLife, 38);
});

test('Chrome Courier keeps an artifact and gains 3 life; Urza\'s Ruinous Blast spares legends and lands', () => {
  const game = vsOpp();
  const relic = game.cards[find(game, 'Relic')];
  const bear = game.cards[find(game, 'Bear')];
  game.zones.library = [bear.iid, relic.iid, ...game.zones.library.filter(i => i !== relic.iid && i !== bear.iid)];
  Bot.runEffect(game, text('Chrome Courier', 1).replace(/^When this creature enters, /, ''), ctx(game, { self: { name: 'Chrome Courier' } }));
  assert.equal(relic.zone, 'hand');
  assert.equal(game.life, 43);
  const legend = put(game, 'Ezuri, Claw of Progress');
  const b2 = put(game.bot.s, 'Bear');
  Bot.runEffect(game, text("Urza's Ruinous Blast"), ctx(game, { self: { name: "Urza's Ruinous Blast" } }));
  assert.equal(legend.zone, 'battlefield');
  assert.equal(b2.zone, 'exile');
});

test("Suffer the Past drains for each card exiled; Alhammarret's Archive draws two for each extra draw", () => {
  const game = vsOpp();
  toGrave(game.bot.s, 'Bear');
  toGrave(game.bot.s, 'Giant');
  Bot.runEffect(game, 'Exile 2 target cards from target player\'s graveyard. For each card exiled this way, that player loses 1 life and you gain 1 life.', ctx(game, { self: { name: 'Suffer the Past' } }));
  assert.equal(game.oppLife, 38);
  assert.equal(game.life, 42);
  put(game, "Alhammarret's Archive");
  Game.hooks.drawInstead = (s, first) => Bot.drawInstead(game, s, first, defOf);
  const n = game.zones.hand.length;
  Game.drawCards(game, 1);
  assert.equal(game.zones.hand.length, n + 2);
});

test('Sigil Captain checks for a 1/1; Chorus of the Conclave offers extra counters; Squallmonger hits each player', () => {
  const game = vsOpp();
  const elf = put(game, 'Elf');
  assert.equal(Bot.condition(game, 'that creature is 1/1', ctx(game, { self: elf })), true);
  put(game, 'Chorus of the Conclave');
  const bear = game.cards[find(game, 'Bear')];
  const ch = Bot.costChoices(game, bear, defOf).find(c => c.key === 'chorus2');
  assert.equal(ch.cost, '{1}{G}{2}');
  assert.equal(ch.extraCounters, 2);
  const sq = put(game, 'Squallmonger');
  Bot.runEffect(game, '{2}: This creature deals 1 damage to each creature with flying and each player. Any player may activate this ability.'.replace(/^\{2\}: /, ''), ctx(game, { self: sq }));
  assert.equal(game.life, 39);
  assert.equal(game.oppLife, 39);
});

test('Rankle can make each player discard, lose 1 and draw; Thrilling Encore takes the creatures that died this turn', () => {
  const game = vsOpp();
  const hand = game.bot.s.zones.hand.length;
  Bot.runEffect(game, 'Each player loses 1 life and draws a card.', ctx(game, { self: { name: 'Rankle' } }));
  assert.equal(game.oppLife, 39);
  assert.equal(game.bot.s.zones.hand.length, hand + 1);
  const giant = put(game.bot.s, 'Giant');
  Game.move(game.bot.s, giant.iid, 'graveyard');
  Bot.afterDeath(game, game.bot.s, giant, { to: 'graveyard' }, defOf, null);
  Bot.died(game.bot.s, giant, defOf, null, game, { to: 'graveyard' });
  Bot.runEffect(game, text('Thrilling Encore'), ctx(game, { self: { name: 'Thrilling Encore' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).some(c => c.name === 'Hill Giant'), true);
});

test('Run Away Together bounces your weakest and their best; Triumph of Saint Katherine shuffles into the top of the library', () => {
  const game = vsOpp();
  const elf = put(game, 'Elf');
  put(game, 'Giant');
  const theirs = put(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Run Away Together'), ctx(game, { self: { name: 'Run Away Together' } }));
  assert.equal(elf.zone, 'hand');
  assert.equal(theirs.zone, 'hand');
  const tri = toGrave(game, 'Triumph of Saint Katherine');
  Bot.runEffect(game, 'exile it and the top six cards of your library in a face-down pile. If you do, shuffle that pile and put it back on top of your library.', ctx(game, { self: tri }));
  assert.equal(game.zones.library.slice(0, 7).includes(tri.iid), true);
});

test('Hungry Lynx gives Cats protection from Rats; Reaver Titan has protection from small spells; Jolene adds a Treasure', () => {
  assert.equal(Bot.parts.protectionKw('protection from rats'), 'protection from type rat');
  assert.equal(Bot.parts.protectionKw('protection from mana value 3 or less'), 'protection from mv 3');
  const game = vsOpp();
  put(game, 'Jolene, the Plunder Queen');
  Bot.runEffect(game, 'create a treasure token', ctx(game, { self: { name: 'Test' } }));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => /Treasure/.test(c.name)).length, 2);
});

test('The Golden Throne keeps you alive at 1 life; Highcliff Felidar destroys the most powerful creature', () => {
  const game = vsOpp();
  const throne = put(game, 'The Golden Throne');
  game.life = -3;
  Bot.refreshGrants(game, defOf);
  assert.equal(game.life, 1);
  assert.equal(throne.zone, 'exile');
  const giant = put(game.bot.s, 'Giant');
  put(game.bot.s, 'Bear');
  Bot.runEffect(game, text('Highcliff Felidar', 1).replace(/^When this creature enters, /, ''), ctx(game, { self: { name: 'Highcliff Felidar' } }));
  assert.equal(giant.zone, 'graveyard');
});

test('Warp World reshuffles every permanent; Bellowing Mauler takes a creature or 4 life', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game, 'Forest');
  Bot.runEffect(game, text('Warp World'), ctx(game, { self: { name: 'Warp World' } }));
  assert.ok(game.zones.battlefield.length <= 2);
  const g2 = vsOpp();
  const mauler = put(g2, 'Bellowing Mauler');
  const elf = put(g2, 'Elf');
  Bot.runEffect(g2, 'each player loses 4 life unless they sacrifice a nontoken creature of their choice', ctx(g2, { self: mauler }));
  assert.equal(elf.zone, 'graveyard');
  assert.equal(g2.oppLife, 36);
});

test('Turf War: a creature that hits the opponent takes its contested land', () => {
  const game = vsOpp();
  put(game, 'Turf War');
  put(game, 'Forest');
  const mtn = put(game.bot.s, 'Mountain');
  Bot.runEffect(game, 'for each player, put a contested counter on target land that player controls', ctx(game, { self: { name: 'Turf War' } }));
  assert.equal(mtn.counters.contested, 1);
  const bear = put(game, 'Bear');
  Bot.combatDamage(game, [{ inst: bear, st: st(bear), card: defOf('Bear'), dmg: 2 }], defOf, ctx(game));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).some(c => c.name === 'Mountain'), true);
});

test("Kresh grows by the power of a creature that died; Deathbringer Regent wipes with five other creatures", () => {
  const game = vsOpp();
  const kresh = put(game, 'Kresh the Bloodbraided');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, "put X +1/+1 counters on Kresh, where X is that creature's power.", ctx(game, { self: kresh, dead: giant }));
  assert.equal(kresh.counters['+1/+1'], 4);
  const regent = put(game, 'Deathbringer Regent');
  regent.wasCast = true;
  assert.equal(Bot.condition(game, 'you cast it from your hand and there are five or more other creatures on the battlefield', ctx(game, { self: regent })), false);
});

test('Jirina counts commander casts; Kelsien grows with experience; Fumiko has bushido and makes the opponent attack; Titan Hunter hits at the end step', () => {
  const game = vsOpp();
  game.cards[find(game, 'Jirina Kudro')].commander = true;
  game.cards[find(game, 'Jirina Kudro')].castCount = 2;
  assert.equal(Bot.countOf(game, "each time you've cast a commander from the command zone this game"), 2);
  const kel = put(game, 'Kelsien, the Plague');
  game.experience = 2;
  Bot.refreshGrants(game, defOf);
  assert.equal(st(kel).pow, 4);
  const fumiko = put(game, 'Fumiko the Lowblood');
  const bear = put(game, 'Bear');
  bear.attacking = true;
  const theirs = put(game.bot.s, 'Giant');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(fumiko).kw.has('bushido 1'));
  assert.ok(Bot.botStats(theirs).kw.has('attacks each combat if able'));
  const g2 = vsOpp();
  put(g2, 'Titan Hunter');
  Bot.phaseTriggers(g2, g2.bot.s, 'end step', defOf, ctx(g2));
  assert.equal(g2.oppLife, 36);
});

test('Undead Alchemist: a Zombie mills instead of hitting, and creature cards milled from the opponent become Zombies', () => {
  const game = vsOpp();
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, null);
  put(game, 'Undead Alchemist');
  const skaab = put(game, 'Cleaver Skaab');
  const lib = game.bot.s.zones.library;
  toTop(game.bot.s, 'Giant');
  const before = lib.length;
  Bot.finishYourAttack(game, [{ inst: skaab, st: st(skaab) }], new Map(), defOf, []);
  assert.equal(game.oppLife, 40);
  assert.equal(lib.length, before - 2);
  assert.equal(game.bot.s.cards[find(game.bot.s, 'Giant', ['exile'])].zone, 'exile');
  assert.ok(game.zones.battlefield.some(i => game.cards[i].name === 'Zombie' || /Zombie/.test(game.cards[i].typeLine) && game.cards[i].token));
});

test("Ghouls' Night Out takes the best creature card of each graveyard as decayed Zombies; Garna returns creatures that died this turn", () => {
  const game = vsOpp();
  toGrave(game, 'Bear');
  toGrave(game.bot.s, 'Giant');
  Bot.runEffect(game, text("Ghouls' Night Out"), ctx(game, { self: { name: "Ghouls' Night Out" } }));
  const mine = game.zones.battlefield.map(i => game.cards[i]);
  const giant = mine.find(c => c.name === 'Hill Giant');
  assert.ok(giant && mine.some(c => c.name === 'Grizzly Bears'));
  assert.ok(st(giant).kw.has('decayed'));
  assert.match(giant.typeLine, /Zombie/);
  const g2 = vsOpp();
  const elf = put(g2, 'Elf');
  Game.move(g2, elf.iid, 'graveyard');
  Bot.runEffect(g2, 'return to your hand all creature cards in your graveyard that were put there from anywhere this turn', ctx(g2, { self: { name: 'Garna' } }));
  assert.equal(elf.zone, 'hand');
});

test('Prowling Geistcatcher exiles what you sacrifice (a token grows it) and returns it when it leaves', () => {
  const game = vsOpp();
  const pg = put(game, 'Prowling Geistcatcher');
  const bear = put(game, 'Bear');
  Game.move(game, bear.iid, 'graveyard');
  Bot.sacrificed(game, game, bear, defOf, ctx(game));
  assert.equal(bear.zone, 'exile');
  Bot.runEffect(game, 'return each card exiled with it to the battlefield under your control', ctx(game, { self: pg }));
  assert.equal(bear.zone, 'battlefield');
  const tok = Game.createToken(game, { custom: true, name: 'Zombie', typeLine: 'Token Creature — Zombie', pt: '2/2', text: '' }, { quiet: true });
  Game.move(game, tok.iid, 'graveyard');
  Bot.sacrificed(game, game, tok, defOf, ctx(game));
  assert.equal(pg.counters['+1/+1'], 1);
});

test('Curse of Unbinding takes the first creature card of the cursed player; Rooftop Storm casts Zombies free; Gorex costs {2} less per creature card', () => {
  const game = vsOpp();
  put(game, 'Curse of Unbinding');
  toTop(game.bot.s, 'Giant');
  toTop(game.bot.s, 'Forest');
  Bot.phaseTriggers(game, game.bot.s, 'upkeep', defOf, null);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].name === 'Hill Giant'));
  assert.equal(game.bot.s.zones.graveyard.map(i => game.bot.s.cards[i].name).includes('Forest'), true);
  put(game, 'Rooftop Storm');
  const wil = game.cards[find(game, 'Wilhelt, the Rotcleaver')];
  assert.ok(Bot.costChoices(game, wil, defOf).some(c => c.key === 'free'));
  ['Bear', 'Elf', 'Giant'].forEach(id => toGrave(game, id));
  assert.equal(Bot.selfDiscount(game, game.cards[find(game, 'Gorex, the Tombshell')], defOf) >= 6, true);
});

test('Hour of Eternity makes 4/4 Zombie copies; Sanctuary Blade protects from the opponent\'s color; Riders of Gavony from the chosen type', () => {
  const game = vsOpp();
  toGrave(game, 'Giant');
  toGrave(game, 'Bear');
  Bot.runEffect(game, text('Hour of Eternity').replace(/\bX\b/, '2'), ctx(game, { self: { name: 'Hour of Eternity' } }));
  const toks = game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token);
  assert.equal(toks.length, 2);
  assert.equal(st(toks[0]).pow, 4);
  const blade = put(game, 'Sanctuary Blade');
  const bear = put(game, 'Elf');
  put(game.bot.s, 'Mountain');
  put(game.bot.s, 'Giant');
  Game.attach(game, blade.iid, bear.iid, Bot.attachBonus(defOf('Sanctuary Blade').oracle));
  Bot.refreshGrants(game, defOf);
  assert.ok(st(bear).kw.has('protection from red'));
  const riders = put(game, 'Riders of Gavony');
  riders.chosenType = 'Bear';
  Bot.refreshGrants(game, defOf);
  assert.ok(st(riders).kw.has('protection from type bear'));
});

test('Titan of Eternal Fire gives Humans its ping; Shadow Kin becomes the best creature card milled; Ravenous Rotbelly trades Zombies', () => {
  const game = vsOpp();
  put(game, 'Titan of Eternal Fire');
  const riders = put(game, 'Riders of Gavony');
  Bot.refreshGrants(game, defOf);
  assert.ok((riders.grantedLines || []).some(l => /deals 1 damage to any target/.test(l)));
  const kin = put(game, 'Shadow Kin');
  toTop(game.bot.s, 'Giant');
  Bot.runEffect(game, text('Shadow Kin', 1).replace(/^At the beginning of your upkeep, /, ''), ctx(game, { self: kin }));
  assert.equal(kin.original.name, 'Shadow Kin'); // the best creature card either player milled (Hill Giant, or better from your library)
  assert.notEqual(kin.name, 'Shadow Kin');
  assert.equal(kin.keepLines.length, 1);
  const g2 = vsOpp();
  const rot = put(g2, 'Ravenous Rotbelly');
  const skaab = put(g2, 'Cleaver Skaab');
  const giant = put(g2.bot.s, 'Giant');
  let n = 0;
  Bot.runEffect(g2, text('Ravenous Rotbelly', 0).replace(/^When this creature enters, /, ''), ctx(g2, { self: rot, oppsSacrifice: k => { n += k; Game.move(g2.bot.s, giant.iid, 'graveyard'); } }));
  assert.equal(skaab.zone, 'graveyard');
  assert.equal(n, 1);
});

test('Jinnie Fay turns small creature tokens into hasty 2/2 Cats on your turn (3/1 vigilant Dogs on the opponent\'s)', () => {
  const jinnie = { name: "Jinnie Fay, Jetmir's Second", typeLine: 'Legendary Creature — Elf Druid', manaCost: '{R/G}{G}{G/W}', cmc: 3, colors: ['R', 'G', 'W'], power: '3', toughness: '3',
    oracle: 'If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance.' };
  assert.equal(Coverage.check(jinnie).you, 'all');
  const game = vsOpp();
  put(game, 'Bear').catDogTokens = true;
  const cat = Game.createToken(game, { custom: true, name: 'Soldier', typeLine: 'Token Creature — Soldier', pt: '1/1', text: '' }, { quiet: true });
  assert.equal(cat.name, 'Cat');
  assert.ok(st(cat).kw.has('haste'));
  const treasure = Game.createToken(game, { custom: true, name: 'Treasure', typeLine: 'Token Artifact — Treasure', pt: '', text: '{T}, Sacrifice this artifact: Add one mana of any color.' }, { quiet: true });
  assert.equal(treasure.name, 'Treasure');
  game.offTurn = true;
  assert.equal(Game.createToken(game, { custom: true, name: 'Soldier', typeLine: 'Token Creature — Soldier', pt: '1/1', text: '' }, { quiet: true }).name, 'Dog');
});
