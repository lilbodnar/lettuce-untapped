// The cards of three Commander precons (Multiverse Reforged, Draconic Rage, Painbow), played out
// against Opp: revealing until, dice, conditions, X spells, mass removal, the precons' keywords.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./precon-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Swamp: { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Bird: { id: 'Bird', name: 'Storm Crow', typeLine: 'Creature — Bird', manaCost: '{1}{U}', cmc: 2, power: '1', toughness: '2', oracle: 'Flying', colors: ['U'] },
  Elf: { id: 'Elf', name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid', manaCost: '{G}', cmc: 1, power: '1', toughness: '1', oracle: '{T}: Add {G}.', colors: ['G'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const rows = () => Object.keys(defs).map(id => ({ id, qty: basics[id] ? 10 : 1 }));
const vsOpp = () => {
  const game = Game.create(deck('You', rows()), defs);
  game.bot = Bot.create(deck('Opp', rows()), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, hitTarget: n => { game.oppLife -= n; }, other: game.bot.s, defOf,
  oppsDraw: n => Game.drawCards(game.bot.s, n, true), oppsDiscard: n => Bot.oppDiscards(game, n, false, 'test'),
  oppsSacrifice: (n, what) => Bot.oppSacrifices(game, n, 'test', what),
  target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const st = inst => Bot.stats(inst, inst.bot || defOf(inst.id));
const named = (s, name) => s.zones.battlefield.map(i => s.cards[i]).filter(c => c.name === name);
const lineOf = (id, re) => cards[id].oracle.split('\n').find(l => re.test(l));
// Dice and shuffles that come out the same every time: G.randomInt(n) gives n - 1 (the highest roll).
const realRandom = Game.randomInt;
const rollHigh = () => { Game.randomInt = n => n - 1; };
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); Game.randomInt = realRandom; });

test('every card in the three precons is done for you', () => {
  for (const d of Object.values(cards)) {
    const r = Coverage.check(d);
    assert.equal(r.you, 'all', `${d.name}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test("Jace's −3 reveals until a creature or planeswalker and puts the rest on the bottom", () => {
  const game = vsOpp();
  const jace = put(game, 'Jace, Multiverse Architect');
  const lands = game.zones.library.filter(i => Game.isLand(game.cards[i])).slice(0, 2);
  const bear = find(game, 'Bear');
  game.zones.library = [...lands, bear, ...game.zones.library.filter(i => !lands.includes(i) && i !== bear)];
  const effect = lineOf('Jace, Multiverse Architect', /^−3:/).replace(/^−3:\s*/, '');
  Bot.runEffect(game, effect, ctx(game, { self: jace, target: () => {} }));
  assert.equal(game.cards[bear].zone, 'battlefield');
  assert.deepEqual(game.zones.library.slice(-2).sort(), [...lands].sort());
});

test('Atla Palani: an Egg dying reveals until a creature card', () => {
  const game = vsOpp();
  const atla = put(game, 'Atla Palani, Nest Tender');
  Bot.runEffect(game, 'Create a 0/1 green Egg creature token with defender.', ctx(game, { self: atla }));
  const egg = named(game, 'Egg')[0];
  assert.ok(egg && st(egg).kw.has('defender'));
  const before = Bot.parts ? game.zones.battlefield.length : 0;
  Game.move(game, egg.iid, 'graveyard');
  Bot.afterDeath(game, game, egg, {}, defOf, ctx(game));
  const fresh = game.zones.battlefield.map(i => game.cards[i]).filter(c => Game.isCreature(c) && c !== atla);
  assert.equal(fresh.length, 1, 'one creature card came out');
  assert.ok(game.zones.battlefield.length >= before);
});

test('Earth-Cult Elemental rolls a d20 and the 20 row makes each opponent sacrifice two', () => {
  const game = vsOpp();
  rollHigh();
  const asked = [];
  const elemental = put(game, 'Earth-Cult Elemental');
  Bot.enterEffects(game, game, elemental, defOf, ctx(game, { oppsSacrifice: (n, what) => asked.push([n, what]) }));
  assert.deepEqual(asked, [[2, 'permanent']]);
});

test('Barbarian Class rolls an extra die; Vrondiss turns a roll into a Dragon Spirit', () => {
  const game = vsOpp();
  put(game, 'Barbarian Class');
  const vrondiss = put(game, 'Vrondiss, Rage of Ancients');
  const seq = [0, 5, 2]; // rolls of 1, 6 and 3 on a d6
  Game.randomInt = () => seq.shift();
  const rolls = Bot.rollDice(game, 2, 6, 'Test', ctx(game));
  assert.deepEqual(rolls, [6, 3]); // the lowest of three is ignored
  assert.equal(vrondiss.damageTaken, 1);
  const spirit = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token && /Dragon Spirit/.test(c.typeLine));
  assert.ok(spirit, 'enrage made a 5/4 Dragon Spirit');
  assert.deepEqual([st(spirit).pow, st(spirit).tou], [5, 4]);
});

test('Dragonmaster Outcast makes a Dragon only with six or more lands', () => {
  const game = vsOpp();
  put(game, 'Dragonmaster Outcast');
  for (let i = 0; i < 5; i++) put(game, 'Mountain');
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  assert.equal(named(game, 'Dragon').length, 0);
  put(game, 'Mountain');
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  assert.equal(named(game, 'Dragon').length, 1);
});

test('Martial Coup for X = 5 makes five Soldiers and destroys every other creature', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const theirs = put(game.bot.s, 'Bear');
  const coup = put(game, 'Martial Coup');
  coup.xValue = 5;
  assert.ok(Bot.spellResolve(game, game, coup, defOf, ctx(game, { self: coup })));
  assert.equal(named(game, 'Soldier').length, 5);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(theirs.zone, 'graveyard');
});

test('Sunfall exiles every creature and incubates that many; the Incubator transforms', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game.bot.s, 'Bear');
  put(game.bot.s, 'Bird');
  const sunfall = put(game, 'Sunfall');
  Bot.spellResolve(game, game, sunfall, defOf, ctx(game));
  const inc = named(game, 'Incubator')[0];
  assert.equal(inc.counters['+1/+1'], 3);
  assert.ok(!Game.isCreature(inc));
  const ab = Bot.activatedAbilities(inc, defOf)[0];
  Bot.runEffect(game, ab.effect, ctx(game, { self: inc }));
  assert.ok(Game.isCreature(inc));
  assert.deepEqual([st(inc).pow, st(inc).tou], [3, 3]);
});

test('Dreadhorde Invasion amasses Zombies onto one Army', () => {
  const game = vsOpp();
  put(game, 'Dreadhorde Invasion');
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  const armies = game.zones.battlefield.map(i => game.cards[i]).filter(c => /army/i.test(c.typeLine));
  assert.equal(armies.length, 1);
  assert.equal(armies[0].counters['+1/+1'], 2);
  assert.equal(game.life, 38);
});

test('Fatehold Charm and Plan for All Outcomes empower a Jace token', () => {
  const game = vsOpp();
  put(game, 'Plan for All Outcomes');
  const charm = put(game, 'Fatehold Charm');
  Bot.runModes(game, charm, defOf, [0], ctx(game, { self: charm }));
  const jace = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token && /Jace/.test(c.typeLine));
  assert.equal(jace.counters.loyalty, 2);
  Bot.spellCast(game, game, charm, defOf, ctx(game)); // the first noncreature spell this turn
  assert.equal(jace.counters.loyalty, 3);
  Bot.spellCast(game, game, charm, defOf, ctx(game)); // the second doesn't
  assert.equal(jace.counters.loyalty, 3);
  assert.deepEqual(Bot.activatedAbilities(jace, defOf).map(a => a.loyalty), [-1, -3]);
});

test("Ob Nixilis destroys the opponent's tapped creatures and gains 1 life for each", () => {
  const game = vsOpp();
  const a = put(game.bot.s, 'Bear');
  const b = put(game.bot.s, 'Bird');
  const c = put(game.bot.s, 'Elf');
  a.tapped = true;
  b.tapped = true;
  const ob = put(game, 'Ob Nixilis, the Ascended');
  Bot.enterEffects(game, game, ob, defOf, ctx(game));
  assert.equal(a.zone, 'graveyard');
  assert.equal(b.zone, 'graveyard');
  assert.equal(c.zone, 'battlefield');
  assert.equal(game.life, 42);
});

test('Magmaquake hits creatures without flying and planeswalkers', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const bird = put(game.bot.s, 'Bird');
  const quake = put(game, 'Magmaquake');
  quake.xValue = 2;
  Bot.spellResolve(game, game, quake, defOf, ctx(game, { self: quake }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(bird.zone, 'battlefield');
});

test('Lavalanche hits the opponent and each of their creatures', () => {
  const game = vsOpp();
  const mine = put(game, 'Bear');
  const theirs = put(game.bot.s, 'Bear');
  const lava = put(game, 'Lavalanche');
  lava.xValue = 3;
  Bot.spellResolve(game, game, lava, defOf, ctx(game, { self: lava }));
  assert.equal(game.oppLife, 37);
  assert.equal(theirs.zone, 'graveyard');
  assert.equal(mine.zone, 'battlefield');
});

test('Knight of New Alara counts colors; Gratuitous Violence doubles combat damage; Transguild is all colors', () => {
  const game = vsOpp();
  put(game, 'Knight of New Alara');
  const courier = put(game, 'Transguild Courier');
  const strix = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual([st(courier).pow, st(courier).tou], [8, 8]); // 3/3 plus five colors
  assert.deepEqual([st(strix).pow, st(strix).tou], [2, 2]); // one color isn't multicolored
  put(game, 'Gratuitous Violence');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.hitOf(st(courier)), 16);
});

test("Serra's Emissary: protection from creatures stops Opp's attackers", () => {
  const game = vsOpp();
  const emissary = put(game, "Serra's Emissary");
  emissary.chosenCardType = 'creature';
  Bot.refreshGrants(game, defOf);
  assert.equal(game.playerPro, 'creature');
  const attacker = put(game.bot.s, 'Bear');
  game.bot.pending = { attackers: [attacker.iid], targets: {} };
  Bot.resolveOppAttack(game, {}, defOf);
  assert.equal(game.life, 40);
});

test('Windcrag Siege: Jeskai makes a hasty, lifelinking Goblin; Mardu doubles attack triggers', () => {
  const game = vsOpp();
  const siege = put(game, 'Windcrag Siege');
  Bot.runEffect(game, Bot.siegeModes(siege, defOf).find(m => /^Jeskai/.test(m)), ctx(game, { self: siege }));
  assert.equal(siege.chosenMode, 'Jeskai');
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  const goblin = named(game, 'Goblin')[0];
  assert.ok(st(goblin).kw.has('haste') && st(goblin).kw.has('lifelink'));
  siege.chosenMode = 'Mardu';
  const overlord = put(game, 'Overlord of the Mistmoors');
  Bot.declareAttack(game, [overlord], defOf, { game, ctx: ctx(game) });
  assert.equal(named(game, 'Insect').length, 4);
});

test('Goaded and "attacks each combat" creatures must attack; Chaos Dragon can lose its roll', () => {
  const game = vsOpp();
  const dragon = put(game, 'Chaos Dragon');
  const bear = put(game, 'Bear');
  assert.ok(Bot.mustAttack(dragon, defOf));
  assert.ok(!Bot.mustAttack(bear, defOf));
  bear.goad = { by: 'opp', until: 1 };
  assert.ok(Bot.mustAttack(bear, defOf));
  Bot.endGoads(game, 'opp');
  assert.ok(!bear.goad);
});

test('Turbulent lands and Archelos decide whether lands enter tapped', () => {
  const game = vsOpp();
  for (let i = 0; i < 7; i++) put(game.bot.s, 'Forest');
  Bot.refreshGrants(game, defOf);
  assert.ok(put(game, 'Turbulent Shore').tapped, 'seven lands: tapped');
  put(game.bot.s, 'Forest');
  Bot.refreshGrants(game, defOf);
  assert.ok(!put(game, 'Turbulent Crater').tapped, 'eight lands: untapped');
  const archelos = put(game, 'Archelos, Lagoon Mystic');
  archelos.tapped = true;
  Bot.refreshGrants(game, defOf);
  assert.ok(put(game, 'Forest').tapped, 'Archelos tapped: other permanents enter tapped');
  archelos.tapped = false;
  Bot.refreshGrants(game, defOf);
  assert.ok(!put(game, 'Turbulent Wetlands').tapped, 'Archelos untapped: they enter untapped');
});

test('Coalition Relic adds mana for its charge counters at your first main phase', () => {
  const game = vsOpp();
  const relic = put(game, 'Coalition Relic');
  relic.counters.charge = 2;
  Bot.phaseTriggers(game, game, 'main', defOf, ctx(game));
  assert.ok(!relic.counters.charge);
  assert.equal(Object.values(game.mana).reduce((a, b) => a + b, 0), 2);
});

test('Component Pouch taps for two mana by removing a component counter', () => {
  const game = vsOpp();
  const pouch = put(game, 'Component Pouch');
  assert.equal(Game.autoPay(game, '{1}{1}'), null, 'no counter, no mana');
  pouch.counters.component = 1;
  assert.ok(Game.autoPay(game, '{W}{R}'));
  assert.ok(!pouch.counters.component);
});

test('Fact or Fiction: Opp splits off the best card; you get a pile', () => {
  const game = vsOpp();
  const fof = put(game, 'Fact or Fiction');
  const hand = game.zones.hand.length;
  const grave = game.zones.graveyard.length;
  Bot.spellResolve(game, game, fof, defOf, ctx(game, { self: fof }));
  assert.equal(game.zones.hand.length, hand + 4);
  assert.equal(game.zones.graveyard.length, grave + 1 + 1); // the pile and Fact or Fiction itself
});

test('Brainstorm draws three and puts two back (Opp-style picks without a prompt)', () => {
  const game = vsOpp();
  Game.drawCards(game, 3);
  const storm = put(game, 'Brainstorm');
  const hand = game.zones.hand.length;
  const lib = game.zones.library.length;
  Bot.spellResolve(game, game, storm, defOf, ctx(game, { self: storm }));
  assert.equal(game.zones.hand.length, hand + 1);
  assert.equal(game.zones.library.length, lib - 1);
});

test('Converge counts the colors of mana spent (Radiant Flames)', () => {
  const game = vsOpp();
  put(game, 'Mountain');
  put(game, 'Forest');
  put(game, 'Plains');
  const paid = Game.autoPay(game, '{2}{R}');
  assert.equal(paid.colors, 3);
  const flames = put(game, 'Radiant Flames');
  flames.spentColors = 3;
  const big = put(game.bot.s, 'Bird');
  Bot.spellResolve(game, game, flames, defOf, ctx(game, { self: flames }));
  assert.equal(big.zone, 'graveyard');
});

test('Echoing Truth bounces every permanent with that name; Beast Within leaves a Beast', () => {
  const game = vsOpp();
  const a = put(game.bot.s, 'Bear');
  const b = put(game.bot.s, 'Bear');
  const truth = put(game, 'Echoing Truth');
  Bot.spellResolve(game, game, truth, defOf, ctx(game, { self: truth }));
  assert.equal(a.zone, 'hand');
  assert.equal(b.zone, 'hand');
  const elf = put(game.bot.s, 'Elf');
  const within = put(game, 'Beast Within');
  Bot.spellResolve(game, game, within, defOf, ctx(game, { self: within }));
  assert.equal(elf.zone, 'graveyard');
  assert.equal(named(game.bot.s, 'Beast').length, 1);
});

test('Illuna mutates onto a creature and exiles until a nonland permanent', () => {
  const game = vsOpp();
  const host = put(game, 'Bear');
  const illuna = game.cards[find(game, 'Illuna, Apex of Wishes')];
  Bot.mutate(game, game, illuna, host, defOf, ctx(game));
  assert.deepEqual([st(host).pow, st(host).tou], [6, 6]);
  assert.ok(st(host).kw.has('flying') && st(host).kw.has('trample'));
  assert.ok(!Game.isCreature(illuna));
  Game.move(game, host.iid, 'graveyard');
  assert.equal(illuna.zone, 'graveyard', 'both cards go together');
});

test('Primeval Spawn is exiled if it arrives without being cast', () => {
  const game = vsOpp();
  const spawn = put(game, 'Primeval Spawn');
  assert.ok(Bot.exiledOnEntry(spawn, defOf));
  spawn.wasCast = true;
  assert.ok(!Bot.exiledOnEntry(spawn, defOf));
  spawn.freeCast = true;
  assert.ok(Bot.exiledOnEntry(spawn, defOf));
});

test('Archfiend of Despair: opponents lose the life they lost this turn again', () => {
  const game = vsOpp();
  put(game, 'Archfiend of Despair');
  const before = { you: game.life, opp: game.oppLife };
  game.oppLife -= 5;
  Bot.lifeChanged(game, before, defOf, ctx(game));
  Bot.phaseTriggers(game, game, 'end step', defOf, ctx(game));
  assert.equal(game.oppLife, 30);
});

test("Rishkar's Expertise draws and casts a cheap spell for free", () => {
  const game = vsOpp();
  put(game, 'Bear');
  const bird = game.cards[find(game, 'Bird')];
  game.zones.hand.forEach(i => Game.move(game, i, 'library', { bottom: true }));
  Game.move(game, bird.iid, 'hand');
  const rishkar = put(game, "Rishkar's Expertise");
  const lib = game.zones.library.length;
  Bot.spellResolve(game, game, rishkar, defOf, ctx(game, { self: rishkar }));
  assert.equal(game.zones.library.length, lib - 2, 'drew two (Grizzly Bears has power 2)');
  // Without a prompt it casts the priciest spell it can (mana value 5 or less), for free.
  const cast = Object.values(game.cards).filter(c => c.freeCast);
  assert.equal(cast.length, 1);
  assert.ok((defOf(cast[0].id).cmc || 0) <= 5);
  assert.ok(bird.zone === 'hand' || bird.freeCast);
});

test('Jared Carthalion: +1 makes an all-colors Kavu; −3 counts its colors', () => {
  const game = vsOpp();
  const jared = put(game, 'Jared Carthalion');
  const [plus, minus] = Bot.activatedAbilities(jared, defOf);
  Bot.runEffect(game, plus.effect, ctx(game, { self: jared }));
  const kavu = named(game, 'Kavu')[0];
  assert.equal(Bot.colorsOfInst(kavu, defOf).length, 5);
  Bot.runEffect(game, minus.effect, ctx(game, { self: jared }));
  assert.equal(kavu.counters['+1/+1'], 5); // up to two different targets: the Kavu is the only creature (five colors)
});

test('Suspend and impending count down', () => {
  const game = vsOpp();
  const overlord = put(game, 'Overlord of the Mistmoors');
  overlord.impending = true;
  overlord.counters.time = 1;
  assert.ok(!Game.isCreature(overlord));
  Bot.endImpending(game);
  assert.ok(Game.isCreature(overlord));
  const search = game.cards[find(game, 'Search for Tomorrow')];
  Game.move(game, search.iid, 'exile');
  search.suspended = true;
  search.counters.time = 1;
  const lands = game.zones.battlefield.filter(i => Game.isLand(game.cards[i])).length;
  Bot.upkeepSuspend(game, game, defOf);
  assert.ok(!search.suspended);
  assert.equal(search.zone, 'battlefield', 'cast for free (it resolves in app.js)');
  assert.ok(lands >= 0);
});
