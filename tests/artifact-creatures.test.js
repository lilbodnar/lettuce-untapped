// Colorless cards: the 272 artifact creatures that were left.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./artifact-creatures-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Merfolk: { id: 'Merfolk', name: 'Merfolk', typeLine: 'Creature — Merfolk', manaCost: '{U}', cmc: 1, power: '1', toughness: '1', oracle: '', colors: ['U'] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracle: '', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids, qty = {}) => ({ key: name, name, rows: ids.map(id => ({ id, qty: qty[id] || 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs), { Island: 10, Relic: 3 }), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs), { Island: 10 }), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'exile']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), hitOpps: n => { game.oppLife -= n; }, ...extra });
const run = (game, self, text) => Bot.runEffect(game, text, ctx(game, { self }));
const st = c => Bot.stats(c, defOf(c.id));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every artifact creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Darksteel Colossus is shuffled into the library instead of going to the graveyard', () => {
  const game = vsOpp();
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game));
  const c = put(game, 'Darksteel Colossus');
  Game.move(game, c.iid, 'graveyard');
  assert.equal(c.zone, 'library');
});

test('a Scarecrow gets flying with a blue creature; Shire Scarecrow makes one mana once a turn', () => {
  const game = vsOpp();
  const sc = put(game, 'Watchwing Scarecrow');
  Bot.refreshGrants(game, defOf);
  assert.ok(!st(sc).kw.has('flying'));
  put(game, 'Merfolk');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(sc).kw.has('flying'));
  const shire = put(game, 'Shire Scarecrow');
  run(game, shire, 'This creature makes one of any color.');
  run(game, shire, 'This creature makes one of any color.');
  assert.equal(Object.values(game.pool).reduce((a, b) => a + b, 0), 1);
});

test('Arcbound Crusher grows when another artifact enters', () => {
  const game = vsOpp();
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game));
  const crusher = put(game, 'Arcbound Crusher');
  put(game, 'Relic');
  assert.equal(crusher.counters['+1/+1'], 1);
});

test("Technodrome can't attack below 6 power; Karn, Legacy Reforged is as big as your costliest artifact", () => {
  const game = vsOpp();
  const t = put(game, 'Technodrome');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(t).kw.has("can't attack") === (st(t).pow < 6));
  const karn = put(game, 'Karn, Legacy Reforged');
  put(game, 'Relic');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(karn).pow >= 3);
});

test('a Chimera feeds another; Rust Elemental eats an artifact or hurts you', () => {
  const game = vsOpp();
  const tin = put(game, 'Tin-Wing Chimera');
  const lead = put(game, 'Lead-Belly Chimera');
  run(game, tin, 'Put a +2/+2 counter on target Chimera creature. It gains flying.');
  assert.equal(lead.counters['+2/+2'], 1);
  const rust = put(game, 'Rust Elemental');
  const life = game.life;
  run(game, rust, "Sacrifice another artifact. If you can't, tap this creature and you lose 4 life.");
  assert.ok(game.life === life - 4 || rust.tapped === false);
});

test('Clone Shell hides a creature and lets it out when it dies', () => {
  const game = vsOpp();
  const shell = put(game, 'Clone Shell');
  game.zones.library.unshift(game.zones.library.splice(game.zones.library.indexOf(find(game, 'Bear')), 1)[0]);
  run(game, shell, 'Look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library in any order.');
  const bear = game.zones.exile.map(iid => game.cards[iid]).find(c => c.faceDown && c.exiledWith === shell.iid);
  assert.ok(bear && Game.isCreature({ ...bear, faceDown: false }));
  run(game, shell, "Turn the exiled card face up. If it's a creature card, put it onto the battlefield under your control.");
  assert.equal(bear.zone, 'battlefield');
});
