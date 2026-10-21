// "NO! Just Birds!" (Grand Arbiter Augustin IV, archidekt.com/decks/27307042): every card done for you, and the rules its stax pieces,
// counterspells and tutors use played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { deck: list, cards } = require('./birds-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Growth: { id: 'Growth', name: 'Giant Growth', typeLine: 'Instant', manaCost: '{G}', cmc: 1, oracle: 'Draw a card.', colors: ['G'] },
  Mind: { id: 'Mind', name: 'Divination', typeLine: 'Sorcery', manaCost: '{2}{U}', cmc: 3, oracle: 'Draw two cards.', colors: ['U'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', [...list, ...Object.keys(basics)]), defs);
  game.bot = Bot.create(deck('Opp', [...list, ...Object.keys(basics)]), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const toHand = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'hand'); return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, self: { name: 'Test' }, ...extra });
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const id of list) {
    const r = Coverage.check(cards[id]);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Enlightened Tutor puts an artifact or enchantment on top of your library', () => {
  const game = vsOpp();
  Bot.runEffect(game, cards['Enlightened Tutor'].oracle, ctx(game));
  assert.match(game.cards[game.zones.library[0]].typeLine, /\b(artifact|enchantment)\b/i);
});

test("Swan Song's caster's opponent gets a 2/2 Bird; Mana Drain's mana comes at the next main phase", () => {
  const game = vsOpp();
  const s = game.bot.s;
  Bot.counterExtras(game, game, s, cards['Swan Song'].oracle, 'Swan Song');
  assert.ok(s.zones.battlefield.some(i => s.cards[i].token && /bird/i.test(s.cards[i].typeLine || s.cards[i].name)));
  Bot.counterExtras(game, game, s, cards['Mana Drain'].oracle, 'Mana Drain', 4);
  Bot.phaseTriggers(game, game, 'main', defOf, ctx(game));
  assert.equal(game.mana.C, 4);
});

test('Opp casts nothing after your Silence, and nothing but from its hand past Drannith Magistrate', () => {
  const game = vsOpp();
  const s = game.bot.s;
  for (let i = 0; i < 4; i++) put(s, 'Forest');
  toHand(s, 'Bear');
  assert.ok(Bot.castOptions(game, defOf).length > 0);
  Bot.runEffect(game, "Your opponents can't cast spells this turn.", ctx(game));
  assert.equal(Bot.castOptions(game, defOf).length, 0);
  Game.endOfTurn(s);
  put(game, 'Drannith Magistrate');
  const bear = s.cards[find(s, 'Bear', ['hand'])];
  Game.move(s, bear.iid, 'graveyard');
  bear.playable = { forever: true };
  Game.move(s, bear.iid, 'exile');
  assert.ok(!Bot.castOptions(game, defOf).some(o => o.inst === bear));
});

test("Narset: Opp can't draw more than one card each turn", () => {
  const game = vsOpp();
  const s = game.bot.s;
  put(game, 'Narset, Parter of Veils');
  Bot.refreshGrants(game, defOf);
  Game.endOfTurn(s); // a new turn (Opp, on the draw, already drew its card this one)
  const hand = s.zones.hand.length;
  Game.drawCards(s, 3, true);
  assert.equal(s.zones.hand.length, hand + 1);
});

test("Soulless Jailer: cards in graveyards can't enter the battlefield", () => {
  const game = vsOpp();
  put(game, 'Soulless Jailer');
  Bot.refreshGrants(game, defOf);
  const bear = game.cards[find(game, 'Bear')];
  Game.move(game, bear.iid, 'graveyard');
  Game.move(game, bear.iid, 'battlefield', { put: true });
  assert.equal(bear.zone, 'graveyard');
});

test("Thalia, Heretic Cathar: Opp's creatures enter tapped", () => {
  const game = vsOpp();
  const s = game.bot.s;
  put(game, 'Thalia, Heretic Cathar');
  Bot.refreshGrants(game, defOf);
  const bear = put(s, 'Bear');
  assert.equal(bear.tapped, true);
});

test('Dovescape counters a noncreature spell and its caster gets that many Birds', () => {
  const game = vsOpp();
  const s = game.bot.s;
  put(game, 'Dovescape');
  const mind = toHand(s, 'Mind');
  assert.equal(Bot.doveCounter(game, s, mind, defOf), true);
  assert.equal(mind.zone, 'graveyard');
  assert.equal(s.zones.battlefield.filter(i => s.cards[i].token).length, 3);
  assert.equal(Bot.doveCounter(game, s, toHand(s, 'Bear'), defOf), false);
});

test('Lost Auramancers loses a time counter each upkeep and is sacrificed when the last comes off', () => {
  const game = vsOpp();
  const iid = find(game, 'Lost Auramancers');
  Game.move(game, iid, 'battlefield', { put: true });
  const inst = game.cards[iid];
  for (const [kind, n] of Object.entries(Game.entersWithCounters(cards['Lost Auramancers'].oracle))) Game.counter(game, iid, kind, n, { effect: true });
  assert.equal(inst.counters.time, 3);
  for (let i = 0; i < 3; i++) Bot.upkeepSuspend(game, game, defOf);
  assert.equal(inst.zone, 'graveyard');
});

test("Spelltithe Enforcer: Opp sacrifices a permanent when it can't pay {1} for its spell", () => {
  const game = vsOpp();
  const s = game.bot.s;
  put(game, 'Spelltithe Enforcer');
  put(s, 'Bear');
  const before = s.zones.battlefield.length;
  Bot.opponentActed(game, s, 'cast', 1, defOf, null, toHand(s, 'Growth'));
  assert.equal(s.zones.battlefield.length, before - 1);
});

test("Absolute Virtue: damage from Opp's side to you is prevented", () => {
  const game = vsOpp();
  put(game, 'Absolute Virtue');
  Bot.refreshGrants(game, defOf);
  Bot.damagePlayer(game, 'you', 5, "Opp's Shock", defOf);
  assert.equal(game.life, 40);
  assert.equal(Bot.playerShielded(game, 'you', defOf), true);
});

test('Aetherstorm Roc: energy in, then spent on a +1/+1 counter', () => {
  const game = vsOpp();
  const roc = put(game, 'Aetherstorm Roc');
  Bot.runEffect(game, 'you get {E}{E}', ctx(game, { self: roc }));
  assert.equal(game.energy, 2);
  Bot.runEffect(game, 'you may pay {E}{E}. If you do, put a +1/+1 counter on it and tap up to one target creature defending player controls.', ctx(game, { self: roc, target: () => {} }));
  assert.equal(game.energy, 0);
  assert.equal(roc.counters['+1/+1'], 1);
});

test('Emrakul, the Promised End costs {1} less for each card type in your graveyard', () => {
  const game = vsOpp();
  ['Bear', 'Growth', 'Mind', 'Forest'].forEach(id => Game.move(game, find(game, id), 'graveyard'));
  const emrakul = toHand(game, 'Emrakul, the Promised End');
  assert.equal(Bot.selfDiscount(game, emrakul, defOf), 4);
});
