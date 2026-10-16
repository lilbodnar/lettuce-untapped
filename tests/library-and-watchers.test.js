const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
global.Bot = require('../simulator/js/bot.js');
const Coverage = require('../simulator/js/coverage.js');

const c = (id, name, typeLine, cost, cmc, pt, oracle) => {
  const [power, toughness] = pt ? pt.split('/') : [];
  return { id, name, typeLine, manaCost: cost, cmc, power, toughness, oracle };
};
const defs = {
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  mountain: { id: 'mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'] },
  bear: c('bear', 'Grizzly Bears', 'Creature — Bear', '{1}{G}', 2, '2/2', ''),
  dragon: c('dragon', 'Shivan Dragon', 'Creature — Dragon', '{4}{R}{R}', 6, '5/5', 'Flying'),
  wooded: c('wooded', 'Wooded Foothills', 'Land', '', 0, null, '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.'),
  cultivate: c('cultivate', 'Cultivate', 'Sorcery', '{2}{G}', 3, null, 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.'),
  opt: c('opt', 'Opt', 'Instant', '{U}', 1, null, 'Scry 1.\nDraw a card.'),
  mantra: c('mantra', "Ajani's Mantra", 'Enchantment', '{1}{W}', 2, null, 'At the beginning of your upkeep, you may gain 1 life.'),
  scourge: c('scourge', 'Dragon Tempest', 'Enchantment', '{1}{R}', 2, null, 'Whenever a creature you control with flying enters, it gains haste until end of turn.'),
  utvara: c('utvara', 'Utvara Hellkite', 'Creature — Dragon', '{6}{R}{R}', 8, '6/6', 'Flying\nWhenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.'),
  banner: c('banner', "Vanquisher's Banner", 'Artifact', '{5}', 5, null, 'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.'),
  wall: c('wall', 'Hulking Cyclops', 'Creature — Cyclops', '{3}{R}{R}', 5, '5/5', "This creature can't block."),
  vista: c('vista', 'Canopy Vista', 'Land — Forest Plains', '', 0, null, '({T}: Add {G} or {W}.)\nThis land enters tapped unless you control two or more basic lands.'),
  hunter: c('hunter', 'Treasure Hunter', 'Creature — Pirate', '{2}{R}', 3, '2/2', 'When this creature enters, create a Treasure token.'),
  dfc: c('dfc', 'Delver of Secrets // Insectile Aberration', 'Creature — Human Wizard // Creature — Human Insect', '{U}', 1, '1/1',
    'Delver of Secrets: At the beginning of your upkeep, look at the top card of your library.\n\nInsectile Aberration: Flying'),
  solemn: c('solemn', 'Solemn Simulacrum', 'Artifact Creature — Golem', '{4}', 4, '2/2', 'When this creature dies, you may draw a card.'),
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const find = (s, id) => [...s.zones.library, ...s.zones.hand].find(i => s.cards[i].id === id);
const put = (s, id) => {
  const iid = find(s, id);
  Game.move(s, iid, 'battlefield');
  s.cards[iid].enteredTurn = -1;
  return s.cards[iid];
};
const vsOpp = (yours, opps) => {
  const game = Game.create(deck('You', yours.map(id => ({ id, qty: 3 })).concat({ id: 'forest', qty: 20 }, { id: 'mountain', qty: 10 })), defs);
  game.bot = Bot.create(deck('Opp', opps.map(id => ({ id, qty: 3 })).concat({ id: 'forest', qty: 20 }, { id: 'mountain', qty: 10 })), defs, { onDraw: true });
  game.life = 20;
  game.oppLife = 20;
  return game;
};
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('fetch lands and Cultivate read as library searches', () => {
  assert.deepEqual(Bot.searchSpec('Search your library for a Mountain or Forest card, put it onto the battlefield'),
    { n: 1, what: 'Mountain or Forest', to: 'battlefield', tapped: false, rest: null });
  assert.deepEqual(Bot.searchSpec('Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand'),
    { n: 2, what: 'basic land', to: 'battlefield', tapped: true, rest: { to: 'hand', tapped: false } });
  assert.equal(Bot.searchSpec('Search your library for a card with mana value 3, put it into your hand'), null);
});

test('your fetch land asks you to pick (ctx.search); Opp cracks its own right away', () => {
  const game = vsOpp(['wooded'], ['wooded']);
  const asked = [];
  const fetch = put(game, 'wooded');
  const ab = Bot.activatedAbilities(fetch, defOf)[0];
  assert.deepEqual([ab.tap, ab.life, ab.sacrifice], [true, 1, true]);
  const later = [];
  const left = Bot.runEffect(game, ab.effect, { self: fetch, search: (spec, src) => asked.push([spec.what, src]), later: t => later.push(t) });
  assert.deepEqual(left, []);
  assert.deepEqual(later, ['shuffle']); // after you've picked
  assert.deepEqual(asked, [['Mountain or Forest', 'Wooded Foothills']]);

  const s = game.bot.s;
  const theirs = put(s, 'wooded');
  Bot.crackFetches(game, defOf);
  assert.equal(theirs.zone, 'graveyard');
  assert.equal(game.oppLife, 19);
  assert.equal(s.zones.battlefield.map(i => s.cards[i]).filter(x => /Basic Land/.test(x.typeLine)).length, 1);
});

test('Cultivate on its own puts one land onto the battlefield tapped and one into the hand', () => {
  const game = vsOpp(['cultivate'], []);
  const hand = game.zones.hand.length;
  Bot.runEffect(game, defs.cultivate.oracle, { self: { name: 'Cultivate' } });
  const lands = game.zones.battlefield.map(i => game.cards[i]);
  assert.equal(lands.length, 1);
  assert.ok(lands[0].tapped);
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Opt: the draw waits until you have scried (ctx.later)', () => {
  const game = vsOpp(['opt'], []);
  const hand = game.zones.hand.length;
  const later = [];
  const left = Bot.runEffect(game, 'Scry 1. Draw a card.', { self: { name: 'Opt' }, scry: () => {}, later: t => later.push(t) });
  assert.deepEqual(left, []);
  assert.equal(game.zones.hand.length, hand); // not drawn yet
  assert.deepEqual(later, ['Draw a card']);
  // Opp scries on its own, then draws.
  Bot.runEffect(game, 'Scry 1. Draw a card.', { self: { name: 'Opt' } });
  assert.equal(game.zones.hand.length, hand + 1);
});

test('upkeep and end step triggers run for whoever has them', () => {
  const game = vsOpp(['mantra'], ['mantra']);
  put(game, 'mantra');
  put(game.bot.s, 'mantra');
  Bot.phaseTriggers(game, game, 'upkeep', defOf, null);
  assert.equal(game.life, 21);
  assert.equal(game.oppLife, 20); // only "your upkeep"
  Bot.phaseTriggers(game, game.bot.s, 'upkeep', defOf, null);
  assert.equal(game.oppLife, 21);
  assert.equal(Bot.phaseTriggers(game, game, 'end step', defOf, null, true), 0);
});

test('"a creature you control with flying enters": "it" is the creature that entered', () => {
  const game = vsOpp(['scourge', 'dragon', 'bear'], []);
  Game.hooks.entered = (s, inst) => Bot.creatureEntered(game, inst, defOf, {}, s);
  const tempest = put(game, 'scourge');
  const dragon = put(game, 'dragon');
  const bear = put(game, 'bear');
  assert.deepEqual(dragon.pump.kw, ['haste']);
  assert.equal(bear.pump, undefined);
  assert.equal(tempest.pump, undefined);
});

test('"Whenever a Dragon you control attacks" makes a token for each attacking Dragon', () => {
  const game = vsOpp(['utvara', 'dragon', 'bear'], []);
  const utvara = put(game, 'utvara');
  const dragon = put(game, 'dragon');
  const bear = put(game, 'bear');
  Bot.attackWatch(game, game, defOf, {}, [utvara, dragon, bear]);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(x => x.token && /Dragon/.test(x.typeLine)).length, 2);
});

test("a banner pumps the chosen type, and \"can't block\" keeps a creature home", () => {
  const game = vsOpp(['banner', 'dragon', 'bear', 'wall'], []);
  const banner = put(game, 'banner');
  banner.chosenType = 'Dragon';
  const dragon = put(game, 'dragon');
  const bear = put(game, 'bear');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(dragon.anthem, { pow: 1, tou: 1 });
  assert.equal(bear.anthem, undefined);
  const wall = put(game, 'wall');
  assert.ok(Bot.stats(wall, defs.wall).kw.has("can't block"));
});

test('battle lands enter tapped until you control two basic lands', () => {
  assert.deepEqual(Game.entersTapped('Canopy Vista', defs.vista.oracle), { minBasics: 2 });
  const s = Game.create(deck('You', [{ id: 'forest', qty: 10 }, { id: 'vista', qty: 10 }]), defs);
  const v = s.cards[find(s, 'vista')];
  v.entersTapped = { minBasics: 2 };
  assert.equal(Game.tapsOnEntry(s, v), true);
  put(s, 'forest');
  put(s, 'forest');
  assert.equal(Game.tapsOnEntry(s, v), false);
});

test('"create a Treasure token" makes a Treasure that taps for any color', () => {
  const game = vsOpp(['hunter'], []);
  Bot.runEffect(game, 'create a Treasure token', { self: { name: 'Treasure Hunter' } });
  const [t] = game.zones.battlefield.map(i => game.cards[i]).filter(x => x.token);
  assert.equal(t.name, 'Treasure');
  assert.deepEqual(t.mana.colors, ['W', 'U', 'B', 'R', 'G']);
  assert.ok(t.mana.sacrifice);
});

test("Opp's \"when this dies, draw a card\" draws for Opp now", () => {
  const game = vsOpp([], ['solemn']);
  const s = game.bot.s;
  const golem = put(s, 'solemn');
  const hand = s.zones.hand.length;
  Game.hooks.died = (t, inst) => Bot.died(t, inst, defOf, null, game);
  Game.move(s, golem.iid, 'graveyard');
  assert.equal(s.zones.hand.length, hand + 1);
});

test('a two-faced card reads the face that is up', () => {
  assert.equal(Bot.faceOracle(defs.dfc.oracle, defs.dfc.name, false), 'At the beginning of your upkeep, look at the top card of your library.');
  assert.equal(Bot.faceOracle(defs.dfc.oracle, defs.dfc.name, true), 'Flying');
  const game = vsOpp(['dfc'], []);
  const delver = put(game, 'dfc');
  assert.ok(!Bot.stats(delver, defs.dfc).kw.has('flying'));
  delver.flipped = true;
  assert.ok(Bot.stats(delver, defs.dfc).kw.has('flying'));
});

test('coverage: what the Simulator does with a card, yours and Opp\'s', () => {
  assert.deepEqual([Coverage.check(defs.bear).you, Coverage.check(defs.bear).opp], ['all', 'all']);
  const fetch = Coverage.check(defs.wooded);
  assert.deepEqual([fetch.you, fetch.opp], ['all', 'all']);
  const delver = Coverage.check(defs.dfc);
  assert.equal(delver.you, 'some'); // flying yes, "look at the top card" no
  const aura = Coverage.check(c('x', 'Pacifism', 'Enchantment — Aura', '{1}{W}', 2, null, "Enchant creature\nEnchanted creature can't attack or block."));
  assert.deepEqual([aura.you, aura.opp], ['all', 'never']);
});
