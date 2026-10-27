// The last cards of the 2026 precons (Foundations, Marvel, Strixhaven, Secret Lair): the ones hidden by art-series card data, played out
// against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./precons-finish-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Gate: { id: 'Gate', name: 'Gate', typeLine: 'Land — Gate', producedMana: ['C'], oracle: '{T}: Add {C}.', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
// From wherever it is (the opening hand may have drawn it) to the top of the library.
const toTop = (s, id) => {
  const iid = find(s, id);
  for (const z of ['library', 'hand', 'graveyard']) { const k = s.zones[z].indexOf(iid); if (k >= 0) s.zones[z].splice(k, 1); }
  s.cards[iid].zone = 'library';
  s.zones.library.unshift(iid);
  return s.cards[iid];
};
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const ids = s => s.zones.battlefield.map(i => s.cards[i]);
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every one of these cards is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Giada: another Angel enters with a +1/+1 counter for each Angel already there', () => {
  const game = vsOpp();
  put(game, 'Giada, Font of Hope');
  const angel = put(game, 'Archangel of Tithes');
  Bot.enterTrigger(game, angel, defOf);
  assert.equal(angel.counters['+1/+1'], 1);
});

test('Archangel of Tithes: attacking you costs {1} each while she is untapped; blocking her costs {1} each', () => {
  const game = vsOpp();
  const angel = put(game, 'Archangel of Tithes');
  assert.equal(Bot.tableRules(game, defOf).attackTax, 1);
  angel.tapped = true;
  assert.equal(Bot.tableRules(game, defOf).attackTax, 0);
  assert.equal(Bot.blockRules([], [angel], defOf).tax, 1);
});

test('Batroc, kicked twice, deals his power to up to two targets', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const batroc = put(game, 'Batroc the Leaper');
  batroc.kickCount = 2;
  Game.counter(game, batroc.iid, '+1/+1', 2);
  const left = Bot.runEffect(game, 'he deals damage equal to his power to each of up to X targets, where X is the number of times he was kicked', ctx(game, { self: batroc }));
  assert.deepEqual(left, []);
  assert.ok(giant.zone !== 'battlefield' || game.oppLife < 40);
});

test('Den of the Bugbear enters tapped with two or more other lands; Timeless Lotus taps for WUBRG', () => {
  const den = cards['Den of the Bugbear'];
  assert.deepEqual(Game.entersTapped(den.name, den.oracle), { maxOther: 1 });
  const lotus = cards['Timeless Lotus'];
  assert.deepEqual(Game.manaAbility(lotus.name, lotus.oracle).makes, ['W', 'U', 'B', 'R', 'G']);
  const game = vsOpp();
  put(game, 'Timeless Lotus').tapped = false;
  assert.ok(Game.autoPay(game, '{W}{U}{B}{R}{G}'));
});

test('Expansion Algorithm proliferates X times', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  Game.counter(game, bear.iid, '+1/+1', 1);
  Bot.runEffect(game, 'Proliferate 3 times.', ctx(game, { self: { name: 'Expansion Algorithm' } }));
  assert.equal(bear.counters['+1/+1'], 4);
});

test('Culling Ritual destroys the cheap permanents and adds a mana for each', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  put(game.bot.s, 'Giant');
  Bot.runEffect(game, cards['Culling Ritual'].oracle, ctx(game, { self: { name: 'Culling Ritual' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.mana.B, 1);
});

test('Hit the Mother Lode: Treasures for the difference under 10', () => {
  const game = vsOpp();
  toTop(game, 'Bear');
  Bot.runEffect(game, cards['Hit the Mother Lode'].oracle, ctx(game, { self: { name: 'Hit the Mother Lode' } }));
  const treasures = ids(game).filter(c => c.name === 'Treasure');
  assert.equal(treasures.length, 8);
  assert.ok(treasures.every(c => c.tapped));
});

test('Bebop draws and loses life for each counter on him; Zimone draws two with eight lands', () => {
  const game = vsOpp();
  const bebop = put(game, 'Bebop, Skull & Crossbones');
  Game.counter(game, bebop.iid, '+1/+1', 3);
  const hand = game.zones.hand.length;
  Bot.runEffect(game, 'you may draw X cards, where X is the number of counters on Bebop. If you do, you lose X life.', ctx(game, { self: bebop }));
  assert.equal(game.zones.hand.length, hand + 3);
  assert.equal(game.life, 37);
  const zimone = put(game, 'Zimone, Quandrix Prodigy');
  const draw = 'Draw a card. If you control eight or more lands, draw two cards instead.';
  let before = game.zones.hand.length;
  Bot.runEffect(game, draw, ctx(game, { self: zimone }));
  assert.equal(game.zones.hand.length, before + 1);
  for (let i = 0; i < 8; i++) put(game, 'Forest');
  before = game.zones.hand.length;
  Bot.runEffect(game, draw, ctx(game, { self: zimone }));
  assert.equal(game.zones.hand.length, before + 2);
});

test('Captain Marvel gets the same counters you put on another creature', () => {
  const game = vsOpp();
  const marvel = put(game, 'Captain Marvel, Apex Avenger');
  const bear = put(game, 'Bear');
  Game.hooks.counters = (s, inst, kind, n) => Bot.countersPut(game, s, inst, kind, n, defOf, ctx(game));
  Game.counter(game, bear.iid, '+1/+1', 2, { effect: true });
  assert.equal(marvel.counters['+1/+1'], 2);
});

test('Black Bolt destroys a nonland permanent of the opponent who targets him', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const bolt = put(game, 'Black Bolt, Inhuman King');
  Bot.applyTarget(game, game, bolt, { action: 'damage', n: 1, what: 'creature' }, 'Shock', defOf, game.bot.s);
  assert.equal(giant.zone, 'graveyard');
});

test('Replicate: Super Combo is copied for each payment; Changing Loyalty makes token Aura copies', () => {
  const game = vsOpp();
  const combo = game.cards[find(game, 'Super Combo')];
  Game.move(game, combo.iid, 'hand');
  assert.ok(Bot.costChoices(game, combo, defOf).some(c => c.key === 'replicate2' && c.kicks === 2));
  combo.replicateCount = 2;
  Bot.spellCast(game, game, combo, defOf, ctx(game));
  assert.equal(combo.extraCopies, 2);
  put(game, 'Bear');
  const loyalty = put(game, 'Changing Loyalty');
  loyalty.replicateCount = 1;
  Bot.enterTrigger(game, loyalty, defOf);
  assert.equal(ids(game).filter(c => c.name === 'Changing Loyalty' && c.token).length, 1);
});

test("Halo Fountain's untap costs; Razorlash returns for {4} less against four nonbasic lands", () => {
  const halo = Bot.activatedAbilities({ id: 'Halo Fountain', name: 'Halo Fountain', typeLine: 'Artifact' }, defOf);
  assert.deepEqual(halo.map(a => a.untapOthers.n), [1, 2, 15]);
  const game = vsOpp();
  const razor = game.cards[find(game, 'Razorlash Transmogrant')];
  const [ab] = Bot.graveAbilities(razor, defOf);
  assert.equal(ab.cost, '{4}{B}{B}');
  assert.equal(Bot.graveCost(ab, game.bot.s), '{4}{B}{B}');
  for (let i = 0; i < 4; i++) put(game.bot.s, 'Gate');
  assert.equal(Bot.graveCost(ab, game.bot.s), '{B}{B}');
});

test('Killian: spells that target a creature cost {2} less', () => {
  const game = vsOpp();
  put(game, 'Killian, Ink Duelist');
  const text = c => (defOf(c.id) || {}).oracle || '';
  assert.equal(Game.discount(game, game.cards[find(game, 'Super Combo')], text), 2);
  assert.equal(Game.discount(game, game.cards[find(game, 'Expansion Algorithm')], text), 0);
});

test('Scarlet Witch exiles the top two face down and casts a noncreature spell among them for free', () => {
  const game = vsOpp();
  const witch = put(game, 'Scarlet Witch, Chaotic Avenger');
  toTop(game, 'Bear');
  const algo = toTop(game, 'Expansion Algorithm');
  Bot.runEffect(game, 'look at the top two cards of your library, then exile them face down. Then you may cast a Hero or noncreature spell from among cards exiled with Scarlet Witch without paying its mana cost.', ctx(game, { self: witch }));
  assert.equal(algo.zone, 'graveyard');
  assert.equal(game.zones.exile.filter(i => game.cards[i].exiledBy === witch.iid).length, 1);
});

test('Wakanda Forever!, The Goose Mother, Jadar and Loot', () => {
  const game = vsOpp();
  const self = { name: 'Test' };
  Bot.runEffect(game, cards['Wakanda Forever!'].oracle, ctx(game, { self }));
  assert.ok(ids(game).some(c => (c.counters || {}).indestructible === 1));
  Bot.runEffect(game, 'create half 5 Food tokens, rounded up', ctx(game, { self }));
  assert.equal(ids(game).filter(c => c.name === 'Food').length, 3);
  const jadar = 'if you control no creatures with decayed, create a 2/2 black Zombie creature token with decayed';
  Bot.runEffect(game, jadar, ctx(game, { self }));
  Bot.runEffect(game, jadar, ctx(game, { self }));
  assert.equal(ids(game).filter(c => c.name === 'Zombie').length, 1);
  for (let i = 0; i < 3; i++) put(game, 'Forest');
  const giant = toTop(game, 'Giant');
  const bear = toTop(game, 'Bear');
  // No other creatures in the top six (a random costlier one would be picked instead).
  game.zones.library = game.zones.library.filter(i => i === bear.iid || i === giant.iid || !Game.isCreature(game.cards[i]));
  Bot.runEffect(game, cards['Loot, Exuberant Explorer'].oracle.split('\n')[1].replace(/^[^:]+:\s*/, ''), ctx(game, { self, choose: null }));
  assert.equal(bear.zone, 'battlefield');
});

test("Yavimaya makes every land tap for {G}; Vega draws for a spell cast from the graveyard", () => {
  const game = vsOpp();
  const plains = put(game, 'Plains');
  put(game.bot.s, 'Yavimaya, Cradle of Growth');
  Bot.refreshGrants(game, defOf);
  assert.ok(Game.sourceOf(game, plains).colors.includes('G'));
  put(game, 'Vega, the Watcher');
  const spell = game.cards[find(game, 'Expansion Algorithm')];
  spell.castFrom = 'graveyard';
  const hand = game.zones.hand.length;
  Bot.spellCast(game, game, spell, defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Redemption Arc exiles the creature it enchants; Zul Ashur lets a Zombie be cast from the graveyard', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const arc = put(game, 'Redemption Arc');
  arc.enchanting = { pid: 'bot', iid: giant.iid, name: giant.name, bonus: {} };
  Bot.runEffect(game, 'Exile enchanted creature.', ctx(game, { self: arc }));
  assert.equal(giant.zone, 'exile');
  const razor = game.cards[find(game, 'Razorlash Transmogrant')];
  Game.move(game, razor.iid, 'graveyard');
  Bot.runEffect(game, 'You may cast target Zombie creature card from your graveyard this turn.', ctx(game, { self: { name: 'Zul Ashur' } }));
  assert.equal(razor.graveOkTurn, game.turn);
});
