// Colorless cards: 38 of the most-played lands that were left.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./lands-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Bear2: { id: 'Bear2', name: 'Bear Cub', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Frog: { id: 'Frog', name: 'Frog', typeLine: 'Creature — Frog', manaCost: '{G}', cmc: 1, power: '1', toughness: '1', oracle: '', colors: ['G'] },
  Ring: { id: 'Ring', name: 'The One Ring', typeLine: 'Legendary Artifact', manaCost: '{4}', cmc: 4, oracle: '', colors: [] },
  Mox: { id: 'Mox', name: 'Mox', typeLine: 'Artifact', manaCost: '{0}', cmc: 0, oracle: '', colors: [] },
  Wurm: { id: 'Wurm', name: 'Big Wurm', typeLine: 'Creature — Eldrazi', manaCost: '{9}', cmc: 9, power: '9', toughness: '9', oracle: '', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids, qty = {}) => ({ key: name, name, rows: ids.map(id => ({ id, qty: qty[id] || 1 })) });
const vsOpp = (qty = { Island: 10, Mountain: 8 }) => {
  const game = Game.create(deck('You', Object.keys(defs), qty), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs), qty), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'exile']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra });
const run = (game, self, text) => Bot.runEffect(game, text, ctx(game, { self }));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every land here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('enters tapped unless you control a basic land; Starting Town untapped early', () => {
  assert.deepEqual(Game.entersTapped('Ba Sing Se', cards['Ba Sing Se'].oracle), { minBasics: 1 });
  assert.deepEqual(Game.entersTapped('Starting Town', cards['Starting Town'].oracle), { earlyTurns: 3 });
  assert.deepEqual(Game.entersTapped('Multiversal Passage', cards['Multiversal Passage'].oracle), { payLife: 2 });
});

test('Urborg makes every land tap for {B} too', () => {
  const game = vsOpp();
  const isl = put(game, 'Island');
  put(game, 'Urborg, Tomb of Yawgmoth');
  Bot.refreshGrants(game, defOf);
  assert.ok(game.allSwamps);
  assert.ok((Game.sourceOf(game, isl) || { colors: [] }).colors.includes('B'));
});

test("Urza's Saga gains its abilities, then fetches a cheap artifact", () => {
  const game = vsOpp();
  const saga = put(game, "Urza's Saga");
  run(game, saga, 'This Saga gains "{T}: Add {C}."');
  assert.ok(saga.grantedLines.includes('{T}: Add {C}.'));
  run(game, saga, 'Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.');
  assert.ok(game.zones.battlefield.some(iid => game.cards[iid].id === 'Mox'));
});

test('City of Traitors goes when you play another land', () => {
  const game = vsOpp();
  const city = put(game, 'City of Traitors');
  const isl = game.cards[find(game, 'Island')];
  Game.move(game, isl.iid, 'battlefield');
  Bot.landEntered(game, isl, defOf, ctx(game));
  assert.equal(city.zone, 'graveyard');
});

test('Valakut deals 3 with five other Mountains; Arid Archway bounces a land', () => {
  const game = vsOpp();
  const v = put(game, 'Valakut, the Molten Pinnacle');
  for (let i = 0; i < 5; i++) put(game, 'Mountain');
  const life = game.oppLife;
  const m = put(game, 'Mountain');
  Bot.landEntered(game, m, defOf, ctx(game, { hitOpps: n => { game.oppLife -= n; } }));
  assert.ok(game.oppLife < life || game.bot.s.zones.graveyard.length > 0, 'Valakut hit something');
  const arch = put(game, 'Arid Archway');
  const lands = game.zones.battlefield.filter(iid => Game.isLand(game.cards[iid])).length;
  run(game, arch, "Return a land you control to its owner's hand. If another Desert was returned this way, surveil 1.");
  assert.equal(game.zones.battlefield.filter(iid => Game.isLand(game.cards[iid])).length, lands - 1);
  assert.equal(v.zone, 'battlefield');
});

test('Mount Doom keeps your two best creatures and destroys the rest', () => {
  const game = vsOpp();
  const doom = put(game, 'Mount Doom');
  put(game, 'Ring');
  ['Bear', 'Bear2', 'Frog'].forEach(id => put(game, id));
  put(game.bot.s, 'Bear');
  run(game, doom, 'Mount Doom erupts.');
  assert.equal(game.zones.battlefield.filter(iid => Game.isCreature(game.cards[iid])).length, 2);
  assert.equal(game.bot.s.zones.battlefield.filter(iid => Game.isCreature(game.bot.s.cards[iid])).length, 0);
  assert.ok(!game.zones.battlefield.some(iid => game.cards[iid].id === 'Ring'));
});

test('Secret Tunnel: two creatures sharing a type become unblockable; Oakhollow grows new Frogs', () => {
  const game = vsOpp();
  const tunnel = put(game, 'Secret Tunnel');
  const a = put(game, 'Bear');
  const b = put(game, 'Bear2');
  run(game, tunnel, "Two target creatures you control that share a creature type can't be blocked this turn.");
  assert.ok(a.pump.kw.includes('unblockable') && b.pump.kw.includes('unblockable'));
  const village = put(game, 'Oakhollow Village');
  const frog = put(game, 'Frog');
  frog.enteredTurn = game.turn;
  run(game, village, 'Put a +1/+1 counter on each Frog, Rabbit, Raccoon, or Squirrel you control that entered the battlefield this turn.');
  assert.equal(frog.counters['+1/+1'], 1);
});

test("Overture mills half the opponent's library; Gemstone Mine goes with its last counter", () => {
  const game = vsOpp();
  const n = game.bot.s.zones.library.length;
  run(game, { name: 'Overture' }, 'Target opponent mills half their library, rounded down.');
  assert.equal(game.bot.s.zones.library.length, n - Math.floor(n / 2));
  const mine = put(game, 'Gemstone Mine');
  mine.counters = { mining: 1 };
  Bot.refreshGrants(game, defOf);
  mine.counters.mining = 0;
  Bot.refreshGrants(game, defOf);
  assert.equal(mine.zone, 'graveyard');
});

test("Glacial Chasm: your creatures can't attack, and its upkeep costs more life each time", () => {
  const game = vsOpp();
  const chasm = put(game, 'Glacial Chasm');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(bear, defOf('Bear')).kw.has("can't attack"));
  const life = game.life;
  run(game, chasm, 'Pay cumulative upkeep of 2 life or sacrifice this permanent.');
  run(game, chasm, 'Pay cumulative upkeep of 2 life or sacrifice this permanent.');
  assert.equal(game.life, life - 6);
});

test("Ugin's Labyrinth exiles a big colorless card; Command Bridge taps something or goes", () => {
  const game = vsOpp();
  const lab = put(game, "Ugin's Labyrinth");
  const wurm = find(game, 'Wurm');
  Game.move(game, wurm, 'hand');
  run(game, lab, 'You may exile a colorless card with mana value 7 or greater from your hand.');
  assert.equal(game.cards[wurm].zone, 'exile');
  const bridge = put(game, 'Command Bridge');
  const isl = put(game, 'Island');
  run(game, bridge, 'Sacrifice it unless you tap an untapped permanent you control.');
  assert.equal(bridge.zone, 'battlefield');
  assert.ok(isl.tapped || game.cards[game.zones.battlefield.find(iid => game.cards[iid].id === "Ugin's Labyrinth")].tapped);
});

test('Dalkovan Encampment adds two attacking Warriors when you attack this turn', () => {
  const game = vsOpp();
  const camp = put(game, 'Dalkovan Encampment');
  const bear = put(game, 'Bear');
  run(game, camp, 'Whenever you attack this turn, create two 1/1 red Warrior creature tokens that are tapped and attacking. Sacrifice them at the beginning of the next end step.');
  bear.attacking = true;
  Bot.attackWatch(game, game, defOf, ctx(game), [bear]);
  assert.equal(game.zones.battlefield.filter(iid => /warrior/i.test(game.cards[iid].name)).length, 2);
});

test('Gemstone Caverns begins on the battlefield with a luck counter when you are on the draw', () => {
  const only = { 'Gemstone Caverns': cards['Gemstone Caverns'], ...basics };
  let s;
  for (let i = 0; i < 30; i++) {
    s = Game.create({ key: 'D', name: 'D', rows: [{ id: 'Gemstone Caverns', qty: 1 }, { id: 'Island', qty: 6 }] }, only, { onDraw: true });
    if (s.zones.battlefield.length) break;
  }
  const c = s.cards[s.zones.battlefield[0]];
  assert.equal(c.id, 'Gemstone Caverns');
  assert.equal(c.counters.luck, 1);
  assert.equal(s.zones.exile.length, 1);
});
