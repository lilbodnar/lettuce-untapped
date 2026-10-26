// The Bloomburrow Commander precons (Animated Army, Family Matters, Peace Offering, Squirreled Away): every card done for you, and the rules they
// brought (expend, Chatterfang's Squirrels, gifts, alternate wins, …) played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { decks, cards } = require('./blc-cards.json');
const basics = {
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const pool = ['Teapot Slinger', 'Chatterfang, Squirrel General', 'Academy Manufactor', "Fisher's Talent", 'Simic Ascendancy', 'Kalonian Hydra', 'Saw in Half',
  'Jolly Gerbils', ...Object.keys(basics)].filter(id => defs[id]);
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

test('every card in the Bloomburrow precons is done for you', () => {
  for (const [name, list] of Object.entries(decks)) {
    for (const id of list) {
      const r = Coverage.check(cards[id]);
      assert.equal(r.you, 'all', `${name}, ${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
    }
  }
});

test('Expend 4: Teapot Slinger fires once as the fourth mana of the turn is spent (not for a trial payment)', () => {
  const game = vsOpp();
  put(game, 'Teapot Slinger');
  for (let i = 0; i < 5; i++) put(game, 'Mountain');
  Game.hooks.spent = (s, before, after) => Bot.manaSpent(game, s, before, after, defOf, ctx(game));
  Game.autoPay(JSON.parse(JSON.stringify(game)), '{4}');
  assert.equal(game.oppLife, 40);
  Game.autoPay(game, '{2}');
  assert.equal(game.oppLife, 40);
  Game.autoPay(game, '{2}');
  assert.equal(game.oppLife, 38);
  Game.autoPay(game, '{1}');
  assert.equal(game.oppLife, 38);
});

test('Chatterfang adds that many Squirrels; Academy Manufactor makes a Clue, a Food and a Treasure', () => {
  const game = vsOpp();
  put(game, 'Chatterfang, Squirrel General');
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'create two 1/1 white Rabbit creature tokens', ctx(game));
  assert.equal(tokens(game).filter(t => /squirrel/i.test(t.name)).length, 2);
  const g2 = vsOpp();
  put(g2, 'Academy Manufactor');
  Bot.runEffect(g2, 'create a Treasure token', ctx(g2));
  assert.deepEqual(tokens(g2).map(t => t.name).sort(), ['Clue', 'Food', 'Treasure']);
});

test("Fisher's Talent at level 2: a Fish token is a 3/3 Shark instead", () => {
  const game = vsOpp();
  const talent = put(game, "Fisher's Talent");
  talent.level = 2;
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'create a 1/1 blue Fish creature token', ctx(game));
  const t = tokens(game)[0];
  assert.equal(t.name, 'Shark');
  assert.equal(`${Bot.stats(t, {}).pow}/${Bot.stats(t, {}).tou}`, '3/3');
});

test('Simic Ascendancy grows with +1/+1 counters and wins at twenty; Kalonian Hydra doubles them', () => {
  const game = vsOpp();
  const asc = put(game, 'Simic Ascendancy');
  const hydra = put(game, 'Kalonian Hydra');
  hydra.counters = { '+1/+1': 4 };
  Bot.runEffect(game, 'double the +1/+1 counters on each creature you control', ctx(game, { self: hydra }));
  assert.equal(hydra.counters['+1/+1'], 8);
  Bot.countersPut(game, game, hydra, '+1/+1', 4, defOf, ctx(game));
  assert.equal(asc.counters.growth, 4);
  asc.counters.growth = 20;
  Bot.runEffect(game, 'if this enchantment has twenty or more growth counters on it, you win the game', ctx(game, { self: asc }));
  assert.ok(game.oppLife <= 0);
});

test('Saw in Half: the creature comes back as two half-size copies; Jolly Gerbils draws when you give a gift', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'saw a creature in half', ctx(game));
  assert.equal(giant.zone, 'graveyard');
  const copies = tokens(game.bot.s);
  assert.equal(copies.length, 2);
  assert.equal(copies[0].basePT, '2/2');
  put(game, 'Jolly Gerbils');
  const hand = game.zones.hand.length;
  Bot.giftGiven(game, game, defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 1);
});
