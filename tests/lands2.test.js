// Colorless cards: the other 148 lands that were left.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./lands2-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Swamp: { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Ogre: { id: 'Ogre', name: 'Ogre', typeLine: 'Creature — Ogre', manaCost: '{4}{R}', cmc: 5, power: '5', toughness: '5', oracle: '', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids, qty = {}) => ({ key: name, name, rows: ids.map(id => ({ id, qty: qty[id] || 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs), { Island: 6, Swamp: 6, Forest: 8 }), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs), { Island: 8 }), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'exile']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), hitOpps: n => { game.oppLife -= n; }, ...extra });
const run = (game, self, text) => Bot.runEffect(game, text, ctx(game, { self }));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every land here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('new enters-tapped conditions', () => {
  assert.deepEqual(Game.entersTapped('Murky Sewer', cards['Murky Sewer'].oracle), { lifeAtMost: 13 });
  assert.deepEqual(Game.entersTapped('Country Roads', cards['Country Roads'].oracle), { control: ['mount', 'vehicle'] });
  assert.deepEqual(Game.entersTapped('Desert Cenote', cards['Desert Cenote'].oracle), { starter: true });
  const s = { zones: { battlefield: [] }, cards: {}, life: 40, oppLife: 12 };
  assert.equal(Game.tapsOnEntry(s, { entersTapped: { lifeAtMost: 13 } }), false);
  s.oppLife = 30;
  assert.equal(Game.tapsOnEntry(s, { entersTapped: { lifeAtMost: 13 } }), true);
});

test('Lake of the Dead sacrifices a Swamp, or goes to the graveyard without one', () => {
  const game = vsOpp();
  const swamp = put(game, 'Swamp');
  const lake = put(game, 'Lake of the Dead');
  Bot.enterTrigger(game, lake, defOf);
  assert.equal(swamp.zone, 'graveyard');
  assert.equal(lake.zone, 'battlefield');
  const vale = put(game, 'Lotus Vale');
  Bot.enterTrigger(game, vale, defOf);
  assert.equal(vale.zone, 'graveyard'); // no two untapped lands left
});

test("A Lair returns another land; the depletion lands make two and go when empty", () => {
  const game = vsOpp();
  const isl = put(game, 'Island');
  const lair = put(game, "Dromar's Cavern");
  run(game, lair, 'Sacrifice it unless you return a non-Lair land you control to its owner\'s hand.');
  assert.equal(isl.zone, 'hand');
  const peat = put(game, 'Peat Bog');
  peat.counters = { depletion: 1 };
  Bot.refreshGrants(game, defOf);
  run(game, peat, 'This land makes {B}{B}.');
  assert.equal(game.pool.B, 2);
  peat.counters.depletion = 0;
  Bot.refreshGrants(game, defOf);
  assert.equal(peat.zone, 'graveyard');
});

test('manlands animate; River Delta stays tapped while depleted', () => {
  const game = vsOpp();
  const stones = put(game, 'Stalking Stones');
  run(game, stones, "This land becomes a 3/3 Elemental artifact creature that's still a land.");
  assert.ok(Game.isCreature(stones));
  assert.ok(stones.becomes.forever);
  const delta = put(game, 'River Delta');
  delta.counters = { depletion: 1 };
  Bot.refreshGrants(game, defOf);
  assert.ok(delta.skipUntap);
  run(game, delta, 'Remove a depletion counter from this land.');
  Bot.refreshGrants(game, defOf);
  assert.ok(!delta.skipUntap);
});

test('Kor Haven blanks an attacker; Pit of Offerings exiles three', () => {
  const game = vsOpp();
  const ogre = put(game.bot.s, 'Ogre');
  ogre.attacking = true;
  run(game, put(game, 'Kor Haven'), 'Prevent all combat damage that would be dealt by target attacking creature this turn.');
  assert.equal(Bot.stats(ogre, defOf('Ogre')).pow, 0);
  ['Island', 'Island', 'Island', 'Island'].forEach(id => Game.move(game.bot.s, find(game.bot.s, id), 'graveyard'));
  run(game, put(game, 'Pit of Offerings'), 'Exile up to three target cards from graveyards.');
  assert.equal(game.bot.s.zones.graveyard.length, 1);
});

test('Magosi takes an extra turn with an eon counter; Tomb of Urami sacrifices your lands', () => {
  const game = vsOpp();
  const magosi = put(game, 'Magosi, the Waterveil');
  magosi.counters = { eon: 1 };
  run(game, magosi, 'Magosi takes an extra turn.');
  assert.equal(magosi.zone, 'hand');
  put(game, 'Island'); put(game, 'Swamp');
  run(game, put(game, 'Tomb of Urami'), 'Sacrifice all your lands.');
  assert.equal(game.zones.battlefield.filter(iid => Game.isLand(game.cards[iid])).length, 0);
});
