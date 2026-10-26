// The Tarkir: Dragonstorm Commander precons (Abzan Armor, Jeskai Striker, Mardu Surge, Sultai Arisen, Temur Roar): every card done for you,
// and the rules they brought (mobilize, Kotis, Dauthi Voidwalker, dredge, …) played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { decks, cards } = require('./tdc-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Swamp: { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
  Wall: { id: 'Wall', name: 'Wall of Stone', typeLine: 'Creature — Wall', manaCost: '{1}{R}{R}', cmc: 3, power: '0', toughness: '8', oracle: 'Defender', colors: ['R'] },
  Opt: { id: 'Opt', name: 'Opt', typeLine: 'Instant', manaCost: '{U}', cmc: 1, oracle: 'Scry 1. Draw a card.', colors: ['U'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const pool = ['Zurgo Stormrender', 'Kotis, Sibsig Champion', 'Dauthi Voidwalker', 'Sidar Kondo of Jamuraa', 'Seedborn Muse', 'Haughty Djinn',
  'Lier, Disciple of the Drowned', "Colfenor's Urn", 'Life from the Loam', 'Glorybringer', 'Angel of Invention', 'Felothar the Steadfast',
  ...Object.keys(basics)].filter(id => defs[id]);
const vsOpp = () => {
  const game = Game.create(deck('You', pool), defs);
  game.bot = Bot.create(deck('Opp', pool), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const toGrave = (s, id) => { const iid = find(s, id, ['library', 'hand']); Game.move(s, iid, 'graveyard'); return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the Tarkir: Dragonstorm precons is done for you', () => {
  for (const [name, list] of Object.entries(decks)) {
    for (const id of list) {
      const r = Coverage.check(cards[id]);
      assert.equal(r.you, 'all', `${name}, ${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
    }
  }
});

test('Mobilize: tapped and attacking Warriors, sacrificed at the next end step', () => {
  const game = vsOpp();
  const zurgo = put(game, 'Zurgo Stormrender');
  const c = ctx(game, { self: zurgo });
  Bot.runEffect(game, 'mobilize 2', c);
  const warriors = game.zones.battlefield.map(i => game.cards[i]).filter(x => x.token && /warrior/i.test(x.name));
  assert.equal(warriors.length, 2);
  assert.ok(warriors.every(w => w.tapped && w.attacking));
  assert.equal(c.joined.length, 2);
  Bot.runAtEnd(game, defOf, c);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(x => x.token).length, 0);
});

test('Kotis lets you cast a creature from your graveyard by exiling three other cards, once a turn', () => {
  const game = vsOpp();
  put(game, 'Kotis, Sibsig Champion');
  const giant = toGrave(game, 'Giant');
  ['Bear', 'Opt', 'Forest'].forEach(id => toGrave(game, id));
  assert.equal(Bot.graveCast(game, giant, defOf), true);
  Bot.payKotis(game, giant, defOf);
  assert.equal(game.zones.exile.length, 3);
  assert.equal(Bot.kotisOk(game, giant, defOf), false, 'once each turn');
});

test("Dauthi Voidwalker exiles the opponent's cards headed to the graveyard, with a void counter", () => {
  const game = vsOpp();
  put(game, 'Dauthi Voidwalker');
  Game.hooks.graveInstead = (s, inst) => Bot.graveInstead(game, s, inst, defOf);
  const s = game.bot.s;
  const bear = s.cards[find(s, 'Bear')];
  Game.move(s, bear.iid, 'graveyard');
  assert.equal(bear.zone, 'exile');
  assert.ok(bear.voidCounter);
  Game.mill(s, 2);
  assert.equal(s.zones.graveyard.length, 0);
});

test("Sidar Kondo: the opponent's creatures without flying or reach can't block your small creatures", () => {
  const game = vsOpp();
  put(game, 'Sidar Kondo of Jamuraa');
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.canBlock(Bot.stats(giant, giant.bot), Bot.stats(bear, defOf('Bear')), game), false);
});

test("Seedborn Muse untaps all your permanents during the other player's untap step", () => {
  const game = vsOpp();
  put(game, 'Seedborn Muse');
  const forest = put(game, 'Forest');
  forest.tapped = true;
  Bot.upkeepSuspend(game, game.bot.s, defOf);
  assert.equal(forest.tapped, false);
});

test("Haughty Djinn's power is the instants and sorceries in your graveyard", () => {
  const game = vsOpp();
  const djinn = put(game, 'Haughty Djinn');
  toGrave(game, 'Opt');
  toGrave(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(djinn, defOf(djinn.id)).pow, 1);
});

test('Lier gives your instants and sorceries in the graveyard flashback for their mana cost', () => {
  const game = vsOpp();
  put(game, 'Lier, Disciple of the Drowned');
  const opt = toGrave(game, 'Opt');
  Bot.refreshGrants(game, defOf);
  assert.equal(opt.lierFlashback, '{U}');
});

test("Colfenor's Urn exiles your dying creatures with toughness 4 or greater", () => {
  const game = vsOpp();
  put(game, "Colfenor's Urn");
  const wall = put(game, 'Wall');
  Game.move(game, wall.iid, 'graveyard');
  Bot.cardMoved(game, game, wall, 'battlefield', 'graveyard', defOf, ctx(game));
  assert.equal(wall.zone, 'exile');
});

test('Dredge: Life from the Loam comes back instead of a draw (marked from the graveyard menu)', () => {
  const game = vsOpp();
  const loam = toGrave(game, 'Life from the Loam');
  loam.dredgeNext = true;
  Game.hooks.drawInstead = (s, first) => Bot.drawInstead(game, s, first, defOf);
  const lib = game.zones.library.length;
  Game.drawCards(game, 1);
  assert.equal(loam.zone, 'hand');
  assert.equal(game.zones.library.length, lib - 3);
});

test('Fabricate: Opp makes the Servos; Glorybringer exerts to deal 4 damage', () => {
  const game = vsOpp();
  const s = game.bot.s;
  const angel = put(s, 'Angel of Invention');
  Bot.runEffect(s, 'fabricate 2', { self: angel, other: game, defOf });
  assert.equal(s.zones.battlefield.map(i => s.cards[i]).filter(c => c.token).length, 2);
  const glory = put(game, 'Glorybringer');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'exert this creature to deal 4 damage to target non-Dragon creature an opponent controls', ctx(game, { self: glory }));
  assert.equal(glory.skipUntap, true);
  assert.ok(!game.bot.s.zones.battlefield.includes(giant.iid));
});
