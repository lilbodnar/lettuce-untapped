// "vampires" (archidekt.com/decks/27914654, Edgar Markov): Mardu Vampires and their enchantments, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./vampires-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Bolt: { id: 'Bolt', name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Bolt deals 3 damage to any target.', colors: ['R'] },
  Rags: { id: 'Rags', name: 'Rags', typeLine: 'Creature — Zombie', manaCost: '{B}', cmc: 1, power: '1', toughness: '1', oracle: 'Madness {B}', colors: ['B'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const EDGAR = "Edgar, Charmed Groom // Edgar Markov's Coffin";
const HENRIKA = 'Henrika Domnathi // Henrika, Infernal Seer';
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Plains' ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
// The hooks app.js sets: deaths and moves on either table.
const wire = game => {
  Game.hooks.died = (s, inst, info) => {
    if (s === game) Bot.died(game, inst, defOf, ctx(game), game, info || {});
    else Bot.died(s, inst, defOf, null, game, info || {});
    Bot.afterDeath(game, s, inst, info || {}, defOf, ctx(game));
  };
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game));
  Game.hooks.discard = (s, inst) => Bot.discardWatch(s, inst, defOf, game);
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'battlefield']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); if (s.cards[iid].zone !== 'battlefield') Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const st = c => Bot.stats(c, defOf(c.id));
const run = (game, who, text, extra = {}) => Bot.runEffect(game, text, ctx(game, { self: who, ...extra }));
const lineOf = (id, re) => cards[id].oracle.split('\n').map(l => l.replace(/^[^:]+: /, '')).find(l => re.test(l));
const effectOf = (id, re) => lineOf(id, re).replace(/^[^,]+, /, '');
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Bloodletter of Aclazotz doubles what the opponent loses on your turn only', () => {
  const game = vsOpp();
  put(game, 'Bloodletter of Aclazotz');
  game.offTurn = false;
  game.oppLife = 37;
  Bot.lifeChanged(game, { you: 40, opp: 40 }, defOf, ctx(game));
  assert.equal(game.oppLife, 34);
  game.offTurn = true;
  game.oppLife = 37;
  Bot.lifeChanged(game, { you: 40, opp: 40 }, defOf, ctx(game));
  assert.equal(game.oppLife, 37);
});

test("Henrika, Infernal Seer: creatures with flying, deathtouch and/or lifelink get +1/+0", () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const vito = put(game, 'Vito, Fanatic of Aclazotz'); // flying
  const salt = put(game, 'Salt Vampire'); // lifelink
  const before = [st(bear).pow, st(vito).pow, st(salt).pow];
  assert.deepEqual(run(game, vito, 'Each creature you control with flying, deathtouch, and/or lifelink gets +1/+0 until end of turn.'), []);
  assert.deepEqual([st(bear).pow, st(vito).pow, st(salt).pow], [before[0], before[1] + 1, before[2] + 1]);
});

test('Vito: 2 life the first time, the opponent loses 2 the second, a 4/3 flier the third', () => {
  const game = vsOpp();
  const vito = put(game, 'Vito, Fanatic of Aclazotz');
  const eff = effectOf('Vito, Fanatic of Aclazotz', /^whenever you sacrifice/i);
  const tokens = () => game.zones.battlefield.filter(i => game.cards[i].token).length;
  assert.deepEqual(run(game, vito, eff), []);
  assert.equal(game.life, 42);
  run(game, vito, eff);
  assert.equal(game.oppLife, 38);
  assert.equal(tokens(), 0);
  run(game, vito, eff);
  assert.equal(tokens(), 1);
  const tok = game.cards[game.zones.battlefield.find(i => game.cards[i].token)];
  assert.equal(st(tok).pow, 4);
  run(game, vito, eff); // a fourth time does nothing
  assert.equal(tokens(), 1);
  assert.equal(game.life, 42);
});

test("Salt Vampire takes a nonland card from the opponent's hand, and they draw", () => {
  const game = vsOpp();
  const salt = put(game, 'Salt Vampire');
  let picked = null;
  let drew = 0;
  const left = run(game, salt, effectOf('Salt Vampire', /^when this creature enters/i), { oppsHandPick: spec => { picked = spec; }, oppsDraw: n => { drew += n; } });
  assert.deepEqual(left, []);
  assert.equal(picked.what, 'nonland');
  assert.equal(picked.to, 'exile');
  assert.equal(drew, 1);
});

test('All-Out Assault: an extra combat, and your creatures untap when you next attack', () => {
  const game = vsOpp();
  const aoa = put(game, 'All-Out Assault');
  const bear = put(game, 'Bear');
  bear.attackedTurn = game.turn;
  assert.deepEqual(run(game, aoa, effectOf('All-Out Assault', /^when this enchantment enters/i)), []);
  assert.equal(bear.attackedTurn, undefined);
  bear.tapped = true;
  Bot.attackWatch(game, game, defOf, ctx(game), [bear]);
  assert.equal(bear.tapped, false);
  bear.tapped = true;
  Bot.attackWatch(game, game, defOf, ctx(game), [bear]); // only the next attack
  assert.equal(bear.tapped, true);
});

test("Mathas's bounty counter: when that creature dies, Mathas's controller draws and gains 2", () => {
  const game = vsOpp();
  wire(game);
  const mathas = put(game, 'Mathas, Fiend Seeker');
  const giant = put(game.bot.s, 'Giant');
  assert.deepEqual(run(game, mathas, effectOf('Mathas, Fiend Seeker', /^at the beginning of your end step/i)), []);
  assert.equal(giant.counters.bounty, 1);
  const hand = game.zones.hand.length;
  Game.move(game.bot.s, giant.iid, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 1);
  assert.equal(game.life, 42);
});

test('Anje Falkenrath untaps when you discard a card with madness', () => {
  const game = vsOpp();
  wire(game);
  const anje = put(game, 'Anje Falkenrath');
  anje.tapped = true;
  const bolt = find(game, 'Bolt');
  Game.move(game, bolt, 'hand');
  Bot.discardWatch(game, game.cards[bolt], defOf, game);
  assert.equal(anje.tapped, true);
  const rags = find(game, 'Rags');
  Bot.discardWatch(game, game.cards[rags], defOf, game);
  assert.equal(anje.tapped, false);
});

test('Amazing Alliance: you gain 1 life for each legendary creature that attacks', () => {
  const game = vsOpp();
  put(game, 'Amazing Alliance');
  const a = put(game, 'Mathas, Fiend Seeker');
  const b = put(game, 'Anje Falkenrath');
  const c = put(game, 'Bear');
  Bot.attackWatch(game, game, defOf, ctx(game), [a, b, c]);
  assert.equal(game.life, 42);
});

test('Aether Sting deals 1 damage to the opponent for each creature spell they cast', () => {
  const game = vsOpp();
  put(game, 'Aether Sting');
  const bear = game.bot.s.cards[find(game.bot.s, 'Bear')];
  Bot.spellCast(game, game.bot.s, bear, defOf, null);
  assert.equal(game.oppLife, 39);
});

test('Edgar dies and comes back as his Coffin, which makes Vampires and turns back at three bloodline counters', () => {
  const game = vsOpp();
  wire(game);
  const edgar = put(game, EDGAR);
  Game.move(game, edgar.iid, 'graveyard');
  assert.equal(edgar.zone, 'battlefield');
  assert.equal(edgar.flipped, true);
  assert.equal(Game.isCreature(edgar), false);
  const upkeep = effectOf(EDGAR, /^at the beginning of your upkeep/i);
  for (let i = 0; i < 2; i++) assert.deepEqual(run(game, edgar, upkeep), []);
  assert.equal(edgar.counters.bloodline, 2);
  assert.equal(edgar.flipped, true);
  run(game, edgar, upkeep);
  assert.equal(edgar.flipped, false);
  assert.ok(!(edgar.counters.bloodline > 0));
  assert.equal(Game.isCreature(edgar), true);
  assert.equal(game.zones.battlefield.filter(i => game.cards[i].token).length, 3);
});

test('Battle Strain: each blocking creature deals 1 damage to its controller', () => {
  const game = vsOpp();
  put(game, 'Battle Strain');
  const giant = put(game.bot.s, 'Giant');
  const bear = put(game.bot.s, 'Bear');
  Bot.blockWatch(game, game.bot.s, defOf, null, [giant, bear]);
  assert.equal(game.oppLife, 38);
  const mine = put(game, 'Bear');
  Bot.blockWatch(game, game, defOf, ctx(game), [mine]);
  assert.equal(game.life, 39);
});

test("Aegis of Honor sends the damage of Opp's next instant or sorcery back to Opp", () => {
  const game = vsOpp();
  const aegis = put(game, 'Aegis of Honor');
  assert.deepEqual(run(game, aegis, cards['Aegis of Honor'].oracle.replace(/^\{1\}: /, '')), []);
  const bolt = game.bot.s.cards[find(game.bot.s, 'Bolt')];
  const octx = Bot.parts.oppCtx(game, bolt, defOf);
  octx.hitOpps(3, true);
  assert.equal(game.life, 40);
  assert.equal(game.oppLife, 37);
  octx.hitOpps(3, true); // only the next one
  assert.equal(game.life, 37);
});

test('Along the Crooked Way amasses when a creature card leaves your graveyard', () => {
  const game = vsOpp();
  wire(game);
  put(game, 'Along the Crooked Way');
  const bear = find(game, 'Bear');
  Game.move(game, bear, 'graveyard');
  Game.move(game, bear, 'hand');
  const army = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token);
  assert.ok(army, 'an Army token');
  assert.equal(army.counters['+1/+1'], 1);
});

test('Angelic Renewal is sacrificed to bring back the next creature of yours that dies', () => {
  const game = vsOpp();
  wire(game);
  const renewal = put(game, 'Angelic Renewal');
  const giant = put(game, 'Giant');
  Game.move(game, giant.iid, 'graveyard');
  assert.equal(giant.zone, 'battlefield');
  assert.equal(renewal.zone, 'graveyard');
  Game.move(game, giant.iid, 'graveyard');
  assert.equal(giant.zone, 'graveyard');
});

test('Brimstone Roundup can be plotted from your hand', () => {
  const game = vsOpp();
  const iid = find(game, 'Brimstone Roundup');
  Game.move(game, iid, 'hand');
  assert.ok(Bot.handAbilities(game.cards[iid], defOf).some(a => a.kind === 'plot' && a.cost === '{2}{R}'));
});
