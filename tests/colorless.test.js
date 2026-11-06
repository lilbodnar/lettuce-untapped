// Colorless cards: the planeswalkers (the four Karns) and the Vehicles that were left.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./colorless-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Ogre: { id: 'Ogre', name: 'Ogre', typeLine: 'Creature — Ogre', manaCost: '{4}{R}', cmc: 5, power: '5', toughness: '5', oracle: '', colors: ['R'] },
  Ninja: { id: 'Ninja', name: 'Ninja', typeLine: 'Creature — Turtle Ninja', manaCost: '{1}{U}', cmc: 2, power: '1', toughness: '1', oracle: '', colors: ['U'] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{4}', cmc: 4, oracle: '{T}: You gain 1 life.', colors: [] },
  Bot1: { id: 'Bot1', name: 'Bot1', typeLine: 'Artifact Creature — Construct', manaCost: '{1}', cmc: 1, power: '1', toughness: '1', oracle: '', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids, qty = {}) => ({ key: name, name, rows: ids.map(id => ({ id, qty: qty[id] || (id === 'Island' ? 10 : 1) })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs), { Bot1: 4 }), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'battlefield', 'exile']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id, ['library', 'hand', 'graveyard', 'exile']); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra });
const run = (game, self, text) => Bot.runEffect(game, text, ctx(game, { self }));
const st = c => Bot.stats(c, defOf(c.id));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every planeswalker and Vehicle here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test("Karn, the Great Creator stops the opponent's artifacts and animates your costliest artifact", () => {
  const game = vsOpp();
  const karn = put(game, 'Karn, the Great Creator');
  const theirs = put(game.bot.s, 'Relic');
  Bot.refreshGrants(game, defOf);
  assert.ok(theirs.boosts && theirs.boosts.karnLock && theirs.boosts.karnLock.noAbilities);
  const relic = put(game, 'Relic');
  assert.ok(!(relic.boosts && relic.boosts.karnLock));
  run(game, karn, 'Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.');
  assert.ok(Game.isCreature(relic));
  assert.equal(st(relic).pow, 4);
});

test('Karn, Scion of Urza: one card to hand, the other exiled with silver, then fetched back', () => {
  const game = vsOpp();
  const karn = put(game, 'Karn, Scion of Urza');
  const hand = game.zones.hand.length;
  run(game, karn, 'Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.');
  assert.equal(game.zones.hand.length, hand + 1);
  const silver = game.zones.exile.find(iid => (game.cards[iid].counters || {}).silver);
  assert.ok(silver);
  run(game, karn, 'Put a card you own with a silver counter on it from exile into your hand.');
  assert.equal(game.cards[silver].zone, 'hand');
});

test('Karn, Living Legacy pays with your untapped lands and digs that deep', () => {
  const game = vsOpp();
  const karn = put(game, 'Karn, Living Legacy');
  put(game, 'Island'); put(game, 'Island'); put(game, 'Island');
  const hand = game.zones.hand.length;
  run(game, karn, 'Pay any amount of mana. Look at that many cards from the top of your library, then put one of those cards into your hand and the rest on the bottom of your library in a random order.');
  assert.equal(game.zones.hand.length, hand + 1);
  assert.ok(game.zones.battlefield.map(iid => game.cards[iid]).filter(c => c.id === 'Island').every(c => c.tapped));
});

test("Karn Liberated: +4 exiles the opponent's card; −14 brings its permanents to you", () => {
  const game = vsOpp();
  const karn = put(game, 'Karn Liberated');
  const o = game.bot.s;
  o.zones.library.filter(iid => o.cards[iid].id !== 'Ogre').forEach(iid => Game.move(o, iid, 'graveyard'));
  const ogre = find(o, 'Ogre');
  Game.move(o, ogre, 'hand');
  o.zones.hand.filter(iid => iid !== ogre).forEach(iid => Game.move(o, iid, 'graveyard'));
  run(game, karn, 'Target player exiles a card from their hand.');
  assert.equal(o.cards[ogre].zone, 'exile');
  run(game, karn, 'Restart the game, leaving in exile all non-Aura permanent cards exiled with Karn. Then put those cards onto the battlefield under your control.');
  assert.ok(game.zones.battlefield.some(iid => game.cards[iid].id === 'Ogre'));
});

test("Nautiloid Ship exiles a graveyard, then takes a creature card from it on combat damage", () => {
  const game = vsOpp();
  const ship = put(game, 'Nautiloid Ship');
  const o = game.bot.s;
  Game.move(o, find(o, 'Ogre'), 'graveyard');
  run(game, ship, "Exile target player's graveyard.");
  assert.equal(o.zones.graveyard.length, 0);
  run(game, ship, 'You may put a creature card exiled with this Vehicle onto the battlefield under your control.');
  assert.ok(game.zones.battlefield.some(iid => game.cards[iid].id === 'Ogre'));
});

test('Unlicensed Hearse grows with the cards it exiles', () => {
  const game = vsOpp();
  const hearse = put(game, 'Unlicensed Hearse');
  const o = game.bot.s;
  ['Ogre', 'Bear', 'Relic'].forEach(id => Game.move(o, find(o, id), 'graveyard'));
  run(game, hearse, 'Exile up to two target cards from a single graveyard.');
  assert.equal(o.zones.graveyard.length, 1);
  hearse.crewed = true;
  Bot.refreshGrants(game, defOf);
  assert.equal(st(hearse).pow, 2);
  assert.equal(st(hearse).tou, 2);
});

test('Mechtitan Core forms Mechtitan; the parts come back when it leaves', () => {
  const game = vsOpp();
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game));
  const core = put(game, 'Mechtitan Core');
  const parts = [0, 1, 2, 3].map(() => put(game, 'Bot1'));
  assert.ok(Bot.activatedAbilities(core, defOf).some(a => /form mechtitan/i.test(a.effect || a.text)));
  run(game, core, 'Form Mechtitan.');
  const titan = game.zones.battlefield.map(iid => game.cards[iid]).find(c => c.name === 'Mechtitan');
  assert.ok(titan);
  assert.ok(parts.every(c => c.zone === 'exile'));
  Game.move(game, titan.iid, 'graveyard');
  assert.ok(parts.every(c => c.zone === 'battlefield' && c.tapped));
});

test('Crew triggers: Luxurious Locomotive, Turtle Van, Adrestia and Golden Argosy use the creatures that crewed them', () => {
  const game = vsOpp();
  const loco = put(game, 'Luxurious Locomotive');
  const ninja = put(game, 'Ninja');
  const bear = put(game, 'Bear');
  loco.crewed = true; loco.crewedBy = [ninja.iid, bear.iid];
  run(game, loco, 'Create a Treasure token for each creature that crewed it this turn.');
  assert.equal(game.zones.battlefield.filter(iid => /treasure/i.test(game.cards[iid].name)).length, 2);
  const van = put(game, 'Turtle Van');
  van.crewed = true; van.crewedBy = [ninja.iid];
  run(game, van, 'Put a +1/+1 counter on target creature that crewed it this turn. Then if that creature is a Mutant, Ninja, or Turtle, double the number of +1/+1 counters on it.');
  assert.equal(ninja.counters['+1/+1'], 2);
  const argosy = put(game, 'Golden Argosy');
  argosy.crewed = true; argosy.crewedBy = [bear.iid];
  run(game, argosy, "Exile each creature that crewed it this turn. Return them to the battlefield tapped under their owner's control at the beginning of the next end step.");
  assert.equal(bear.zone, 'exile');
});

test('Daredevil Dragster: a velocity counter each attack; the second one cashes it in for two cards', () => {
  const game = vsOpp();
  const car = put(game, 'Daredevil Dragster');
  car.crewed = true;
  Bot.endOfCombat(game, [car], defOf);
  assert.equal(car.counters.velocity, 1);
  assert.equal(car.zone, 'battlefield');
  const hand = game.zones.hand.length;
  Bot.endOfCombat(game, [car], defOf);
  assert.equal(car.zone, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 2);
});

test('Weatherlight Compleated: phyresis counters; at four it is a Phyrexian creature', () => {
  const game = vsOpp();
  const ship = put(game, 'Weatherlight Compleated');
  for (let i = 0; i < 4; i++) run(game, ship, 'Put a phyresis counter on Weatherlight Compleated. Then draw a card if it has seven or more phyresis counters on it. If it doesn\'t, scry 1.');
  assert.equal(ship.counters.phyresis, 4);
  Bot.refreshGrants(game, defOf);
  assert.ok(Game.isCreature(ship));
});

test('Dermotaxi imprints the best creature card in a graveyard and becomes a copy of it', () => {
  const game = vsOpp();
  Game.move(game.bot.s, find(game.bot.s, 'Ogre'), 'graveyard');
  const taxi = put(game, 'Dermotaxi');
  Bot.enterTrigger(game, taxi, defOf);
  assert.equal(taxi.imprintId, 'Ogre');
  run(game, taxi, "Until end of turn, this Vehicle becomes a copy of the exiled card, except it's a Vehicle artifact in addition to its other types.");
  assert.equal(taxi.id, 'Ogre');
  assert.ok(Game.isCreature(taxi));
});

test('Lifecraft Engine: Vehicles are the chosen type, and that type gets +1/+1', () => {
  const game = vsOpp();
  const engine = put(game, 'Lifecraft Engine');
  engine.chosenType = 'Bear';
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(bear).pow, 3);
  assert.equal(st(put(game, 'Ogre')).pow, 5);
});

test('Soul Shredder returns from the graveyard for two creatures', () => {
  const game = vsOpp();
  const shred = find(game, 'Soul Shredder');
  Game.move(game, shred, 'graveyard');
  put(game, 'Bear'); put(game, 'Ninja');
  const ab = Bot.graveAbilities(game.cards[shred], defOf).find(a => a.sacCreatures === 2);
  assert.ok(ab);
  assert.ok(Bot.useGraveAbility(game, game, game.cards[shred], ab, defOf, ctx(game)));
  assert.equal(game.cards[shred].zone, 'battlefield');
  assert.equal(game.zones.battlefield.filter(iid => ['Bear', 'Ninja'].includes(game.cards[iid].id)).length, 0);
});

test('Shadowed Caravel grows when a creature of yours explores', () => {
  const game = vsOpp();
  const caravel = put(game, 'Shadowed Caravel');
  const bear = put(game, 'Bear');
  run(game, bear, 'This creature explores.');
  assert.equal(caravel.counters['+1/+1'], 1);
});
