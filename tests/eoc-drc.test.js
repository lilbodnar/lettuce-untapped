// The Edge of Eternities (Counter Intelligence, World Shaper) and Aetherdrift (Eternal Might, Living Energy) Commander precons: every card done for
// you, and the rules they brought (energy, station, afflict, …) played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { decks, cards } = require('./eoc-drc-cards.json');
const basics = {
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const pool = ['Uthros Research Craft', 'Whirler Virtuoso', 'Lost Monarch of Ifnir', 'Stridehangar Automaton', 'The Gitrog Monster', 'Horizon Explorer',
  'Moraug, Fury of Akoum', 'Darksteel Reactor', 'The Scarab God', 'Saheeli, Radiant Creator', ...Object.keys(basics)].filter(id => defs[id]);
const vsOpp = () => {
  const game = Game.create(deck('You', pool), defs);
  game.bot = Bot.create(deck('Opp', pool), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const tokens = s => s.zones.battlefield.map(i => s.cards[i]).filter(c => c.token);
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in Counter Intelligence, World Shaper, Eternal Might and Living Energy is done for you', () => {
  for (const [name, list] of Object.entries(decks)) {
    for (const id of list) {
      const r = Coverage.check(cards[id]);
      assert.equal(r.you, 'all', `${name}, ${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
    }
  }
});

test('Energy: "you get {E}{E}{E}" adds it, and "Pay {E}{E}{E}: …" costs it', () => {
  const game = vsOpp();
  const whirler = put(game, 'Whirler Virtuoso');
  Bot.runEffect(game, 'you get {E}{E}{E}', ctx(game, { self: whirler }));
  assert.equal(game.energy, 3);
  const ab = Bot.activatedAbilities(whirler, defOf).find(a => a.energy);
  assert.equal(ab.energy, 3);
  Bot.runEffect(game, 'you get six {E}', ctx(game, { self: whirler }));
  assert.equal(game.energy, 9);
});

test("Station: charge counters from a tapped creature's power; a creature with flying at its last threshold", () => {
  const game = vsOpp();
  const craft = put(game, 'Uthros Research Craft');
  Bot.refreshGrants(game, defOf);
  assert.equal(Game.isCreature(craft), false);
  assert.ok(Bot.activatedAbilities(craft, defOf).some(a => a.station));
  game.lastTappedPower = 4;
  Bot.runEffect(game, "put charge counters equal to the tapped creature's power on this spacecraft", ctx(game, { self: craft }));
  assert.equal(craft.counters.charge, 4);
  craft.counters.charge = 12;
  Bot.refreshGrants(game, defOf);
  assert.equal(Game.isCreature(craft), true);
  assert.ok(Bot.stats(craft, defOf(craft.id)).kw.has('flying'));
});

test('Saheeli, Radiant Creator copies a nonlegendary permanent as a 5/5 with haste, sacrificed at the next end step', () => {
  const game = vsOpp();
  const saheeli = put(game, 'Saheeli, Radiant Creator');
  put(game, 'Bear');
  game.energy = 3;
  Bot.runEffect(game, `you may pay {E}{E}{E} to do "create a token that's a copy of target permanent you control, except it's a 5/5 artifact creature in addition to its other types and has haste. Sacrifice it at the beginning of the next end step"`, ctx(game, { self: saheeli }));
  assert.equal(game.energy, 0);
  const tok = tokens(game)[0];
  assert.equal(tok.name, 'Grizzly Bears');
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(tokens(game).length, 0);
});

test('Stridehangar Automaton: a Thopter comes with artifact tokens', () => {
  const game = vsOpp();
  put(game, 'Stridehangar Automaton');
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'create a Treasure token', ctx(game));
  assert.deepEqual(tokens(game).map(t => t.name).sort(), ['Thopter', 'Treasure']);
});

test('Lost Monarch of Ifnir: afflict 3 when it becomes blocked', () => {
  const game = vsOpp();
  const monarch = put(game, 'Lost Monarch of Ifnir');
  Bot.becameBlocked(game, monarch, 1, defOf, [], game);
  assert.equal(game.oppLife, 37);
});

test("The Scarab God makes a 4/4 black Zombie copy of the best creature card in a graveyard (Opp's too)", () => {
  const game = vsOpp();
  const god = put(game, 'The Scarab God');
  const s = game.bot.s;
  const giant = s.cards[find(s, 'Giant')];
  Game.move(s, giant.iid, 'graveyard');
  Bot.runEffect(game, 'zombify the best creature card from a graveyard', ctx(game, { self: god }));
  const tok = tokens(game)[0];
  assert.equal(tok.name, 'Hill Giant');
  assert.equal(giant.zone, 'exile');
  assert.match(tok.typeLine, /Zombie/);
});

test('The Gitrog Monster draws when a land card goes to your graveyard; Horizon Explorer: lands enter untapped', () => {
  const game = vsOpp();
  put(game, 'The Gitrog Monster');
  const hand = game.zones.hand.length;
  const forest = put(game, 'Forest');
  Game.move(game, forest.iid, 'graveyard');
  Bot.cardMoved(game, game, forest, 'battlefield', 'graveyard', defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 1);
  put(game, 'Horizon Explorer');
  Bot.refreshGrants(game, defOf);
  assert.equal(Game.tapsOnEntry(game, { iid: 'x', typeLine: 'Land', entersTapped: true }), false);
});

test('Moraug: +1/+0 for each time a creature attacked this turn; Darksteel Reactor wins at twenty charge counters', () => {
  const game = vsOpp();
  put(game, 'Moraug, Fury of Akoum');
  const bear = put(game, 'Bear');
  Bot.declareAttack(game, [bear], defOf, { game });
  Bot.declareAttack(game, [bear], defOf, { game }); // an extra combat
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(bear, defOf('Bear')).pow, 4);
  const reactor = put(game, 'Darksteel Reactor');
  reactor.counters = { charge: 20 };
  Bot.refreshGrants(game, defOf);
  assert.ok(game.oppLife <= 0);
});
