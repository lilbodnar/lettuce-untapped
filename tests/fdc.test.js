// The five Foundations Commander decks (Wretched Ranks, Tramplesaurus Rex, Calling All Angels, Reign of
// Dragons, Keen Engineering), played out against Opp: sagas, living weapon, extra counters on entering,
// Plains landfall, restricted mana, improvise, casting from the top of the library.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./fdc-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Swamp: { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Zombie: { id: 'Zombie', name: 'Walking Corpse', typeLine: 'Creature — Zombie', manaCost: '{1}{B}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['B'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
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
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the five Foundations Commander decks is done for you', () => {
  for (const d of Object.values(cards)) {
    const r = Coverage.check(d);
    assert.equal(r.you, 'all', `${d.name}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Metallic Mimic and Dragonstorm Globe: creatures enter with an additional +1/+1 counter', () => {
  const game = vsOpp();
  const mimic = put(game, 'Metallic Mimic');
  mimic.chosenType = 'bear';
  const bear = put(game, 'Bear');
  Bot.enterTrigger(game, bear, defOf);
  assert.equal(bear.counters['+1/+1'], 1);
  const giant = put(game, 'Giant');
  Bot.enterTrigger(game, giant, defOf);
  assert.ok(!giant.counters['+1/+1'], 'not the chosen type');
  put(game, 'Dragonstorm Globe');
  const dragon = put(game, 'Thundermane Dragon');
  Bot.enterTrigger(game, dragon, defOf);
  assert.equal(dragon.counters['+1/+1'], 1);
});

test('Shivan Devastator enters with X counters; Diregraf Colossus with one per Zombie card in the graveyard', () => {
  const game = vsOpp();
  const iid = find(game, 'Shivan Devastator');
  game.cards[iid].xValue = 3;
  const shivan = put(game, 'Shivan Devastator');
  Bot.enterTrigger(game, shivan, defOf);
  assert.equal(shivan.counters['+1/+1'], 3);
  Game.move(game, find(game, 'Zombie'), 'graveyard');
  Game.move(game, find(game, 'Vengeful Dead'), 'graveyard');
  const colossus = put(game, 'Diregraf Colossus');
  Bot.enterTrigger(game, colossus, defOf);
  assert.equal(colossus.counters['+1/+1'], 2);
});

test('Living weapon: Nettlecyst comes with a 0/0 Germ it is attached to', () => {
  const game = vsOpp();
  const cyst = put(game, 'Nettlecyst');
  Bot.enterTrigger(game, cyst, defOf);
  const germ = named(game, 'Phyrexian Germ')[0];
  assert.ok(germ, 'a Germ token');
  assert.equal(cyst.attachedTo, germ.iid);
  Bot.refreshGrants(game, defOf);
  assert.ok(st(germ).tou >= 1, 'it lives: +1/+1 for each artifact and enchantment');
});

test("Witch's Cottage enters tapped unless you control three other Swamps", () => {
  const game = vsOpp();
  const first = put(game, "Witch's Cottage");
  assert.equal(first.tapped, true);
  Game.move(game, first.iid, 'hand');
  for (let i = 0; i < 3; i++) put(game, 'Swamp');
  const second = put(game, "Witch's Cottage");
  assert.equal(second.tapped, false);
});

test('Emeria Shepherd: a Plains returns the card to the battlefield, another land to your hand', () => {
  const game = vsOpp();
  put(game, 'Emeria Shepherd');
  const bear = find(game, 'Bear');
  Game.move(game, bear, 'graveyard');
  Bot.landEntered(game, put(game, 'Island'), defOf, ctx(game));
  assert.equal(game.cards[bear].zone, 'hand');
  Game.move(game, bear, 'graveyard');
  Bot.landEntered(game, put(game, 'Plains'), defOf, ctx(game));
  assert.equal(game.cards[bear].zone, 'battlefield');
});

test('Parapet Thrasher picks a mode not chosen yet this turn', () => {
  const game = vsOpp();
  const thrasher = put(game, 'Parapet Thrasher');
  const c = ctx(game, { self: thrasher });
  Bot.runEffect(game, "choose one that hasn't been chosen this turn —", c);
  Bot.runEffect(game, "choose one that hasn't been chosen this turn —", c);
  assert.equal(thrasher.modesUsed.length, 2);
  assert.notEqual(thrasher.modesUsed[0], thrasher.modesUsed[1]);
  Game.endOfTurn(game);
  assert.equal(thrasher.modesUsed, undefined);
});

test('The Elder Dragon War: a chapter as it enters and at each first main phase, then sacrificed', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const saga = put(game, 'The Elder Dragon War');
  Bot.enterEffects(game, game, saga, defOf, ctx(game));
  assert.equal(saga.counters.lore, 1);
  assert.equal(game.oppLife, 38, 'chapter I: 2 damage to each opponent');
  assert.equal(game.cards[bear.iid].zone, 'graveyard', 'and to each creature');
  Bot.phaseTriggers(game, game, 'main', defOf, ctx(game));
  assert.equal(saga.counters.lore, 2);
  Bot.phaseTriggers(game, game, 'main', defOf, ctx(game));
  assert.equal(named(game, 'Dragon').length, 1, 'chapter III: a 4/4 Dragon');
  assert.equal(saga.zone, 'graveyard');
});

test('Read ahead: you pick the chapter it starts on', () => {
  const game = vsOpp();
  const saga = put(game, 'The Elder Dragon War');
  let asked = null;
  Bot.enterEffects(game, game, saga, defOf, ctx(game, { chooseModes: modes => { asked = modes; } }));
  assert.deepEqual(asked, ['Start at chapter I', 'Start at chapter II', 'Start at chapter III']);
  Bot.runEffect(game, 'Start at chapter III', ctx(game, { self: saga }));
  assert.equal(named(game, 'Dragon').length, 1);
  assert.equal(game.oppLife, 40, 'chapter I was skipped');
  assert.equal(saga.zone, 'graveyard');
});

test('Orb of Dragonkind: its mana only pays for Dragon spells', () => {
  const game = vsOpp();
  game.zones.battlefield.filter(i => Game.isLand(game.cards[i])).forEach(i => Game.move(game, i, 'hand'));
  put(game, 'Orb of Dragonkind');
  put(game, 'Mountain');
  const dragon = game.cards[find(game, 'Thundermane Dragon')];
  const copy = () => JSON.parse(JSON.stringify(game));
  assert.equal(Game.autoPay(copy(), '{R}{R}', 0, game.cards[find(game, 'Giant')]), null);
  assert.ok(Game.autoPay(copy(), '{R}{R}', 0, dragon));
});

test('Duplicant takes the power, toughness and creature types of the creature it exiled', () => {
  const game = vsOpp();
  const dup = put(game, 'Duplicant');
  const giant = put(game.bot.s, 'Giant');
  Bot.applyTarget(game, game.bot.s, giant, { action: 'exile', what: 'nontoken creature', srcIid: dup.iid }, 'Duplicant', defOf, game);
  assert.equal(giant.zone, 'exile');
  Bot.refreshGrants(game, defOf);
  const s = st(dup);
  assert.equal(s.pow, 4);
  assert.equal(s.tou, 3);
  assert.ok((dup.extraTypes || []).includes('giant'));
});

test('Thundermane Dragon: a creature with power 4 or greater can be cast from the top, with haste', () => {
  const game = vsOpp();
  put(game, 'Thundermane Dragon');
  const giant = find(game, 'Giant');
  const bear = find(game, 'Bear');
  game.zones.library = [bear, ...game.zones.library.filter(i => i !== bear)];
  assert.equal(Bot.topCastable(game, game.cards[bear], defOf), null);
  game.zones.library = [giant, ...game.zones.library.filter(i => i !== giant)];
  assert.ok(Bot.topCastable(game, game.cards[giant], defOf));
  Game.move(game, giant, 'battlefield');
  Bot.topHaste(game.cards[giant]);
  assert.ok(st(game.cards[giant]).kw.has('haste'));
});

test('Opp casts a big creature from the top of its library with Thundermane Dragon', () => {
  const game = vsOpp();
  const s = game.bot.s;
  put(s, 'Thundermane Dragon');
  for (let i = 0; i < 6; i++) put(s, 'Mountain');
  s.zones.hand.forEach(i => Game.move(s, i, 'graveyard'));
  const giant = find(s, 'Giant');
  s.zones.library = [giant, ...s.zones.library.filter(i => i !== giant)];
  const opts = Bot.castOptions(game, defOf);
  assert.ok(opts.some(o => o.iid === giant && o.zone === 'library'));
});

test('Improvise: Kappa Cannoneer taps artifacts for its generic mana', () => {
  const game = vsOpp();
  game.zones.battlefield.filter(i => Game.isLand(game.cards[i])).forEach(i => Game.move(game, i, 'hand'));
  const kappa = game.cards[find(game, 'Kappa Cannoneer')];
  assert.ok(Bot.hasImprovise(game, kappa, defOf));
  put(game, 'Island');
  put(game, 'Nettlecyst');
  put(game, 'Dragonstorm Globe');
  put(game, 'Metallic Mimic');
  const tapped = Bot.improviseTap(JSON.parse(JSON.stringify(game)), '{5}{U}', 0, kappa); // on a copy, as app.js checks it
  assert.equal(tapped, null, 'three artifacts and an Island can\'t pay six');
  put(game, 'Orb of Dragonkind');
  put(game, 'Island');
  const ok = Bot.improviseTap(game, '{5}{U}', 0, kappa);
  assert.ok(ok && ok.length >= 3);
  assert.ok(Game.autoPay(game, '{5}{U}', 0, kappa));
});

test('Arachnogenesis makes a Spider for each creature attacking you; Endless Ranks counts half your Zombies', () => {
  const game = vsOpp();
  const s = game.bot.s;
  const attackers = [put(s, 'Bear'), put(s, 'Giant')];
  Bot.declareAttack(s, attackers, defOf, { game });
  assert.equal(game.attackersNow, 2);
  Bot.runEffect(game, 'Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures attacking you.', ctx(game, { self: { name: 'Arachnogenesis' } }));
  assert.equal(named(game, 'Spider').length, 2);
  for (let i = 0; i < 5; i++) Game.createToken(game, { custom: true, name: 'Zombie', typeLine: 'Token Creature — Zombie', pt: '2/2', text: '' });
  const ranks = put(game, 'Endless Ranks of the Dead');
  Bot.runEffect(game, 'create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down.', ctx(game, { self: ranks }));
  assert.equal(named(game, 'Zombie').length, 7);
});

test("Liliana's Reaver makes a tapped Zombie; Scrawling Crawler drains Opp as it draws", () => {
  const game = vsOpp();
  const reaver = put(game, "Liliana's Reaver");
  Bot.runEffect(game, 'you create a tapped 2/2 black Zombie creature token.', ctx(game, { self: reaver }));
  const z = named(game, 'Zombie')[0];
  assert.ok(z && z.tapped);
  put(game, 'Scrawling Crawler');
  Bot.opponentActed(game, game.bot.s, 'draw', 1, defOf, null);
  assert.equal(game.oppLife, 39);
});

test('Hellkite Charger: attackers untap and can attack again', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  bear.attacking = true;
  bear.tapped = true;
  bear.attackedTurn = game.turn;
  Bot.runEffect(game, 'untap all attacking creatures and after this phase, there is an additional combat phase', ctx(game));
  assert.equal(bear.tapped, false);
  assert.equal(bear.attackedTurn, undefined);
});
