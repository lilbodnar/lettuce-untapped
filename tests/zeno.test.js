// "zeno deck" (archidekt.com/decks/28056764, Zenos yae Galvus): mono-black artifacts and removal, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./zeno-cards.json');
const basics = {
  Swamp: { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Bolt: { id: 'Bolt', name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Bolt deals 3 damage to any target.', colors: ['R'] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracle: '', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const ZENOS = 'Zenos yae Galvus // Shinryu, Transcendent Rival';
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Swamp' ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'battlefield']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); if (s.cards[iid].zone !== 'battlefield') Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const st = c => Bot.stats(c, defOf(c.id));
const run = (game, who, text, extra = {}) => Bot.runEffect(game, text, ctx(game, { self: who, ...extra }));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Zenos shrinks every other creature but its chosen one, and transforms when that one leaves', () => {
  const game = vsOpp();
  const zenos = put(game, ZENOS);
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  run(game, zenos, 'Choose a creature an opponent controls. Until end of turn, creatures other than Zenos yae Galvus and the chosen creature get -2/-2.');
  assert.equal(bear.zenosOf, zenos.iid);
  assert.equal(st(giant).pow, 2);
  assert.equal(st(bear).pow, 2);
  Game.move(game.bot.s, bear.iid, 'graveyard');
  Bot.cardMoved(game, game.bot.s, bear, 'battlefield', 'graveyard', defOf, ctx(game));
  assert.ok(zenos.flipped);
});

test('Death Is Irrelevant assimilates the best creature card in a graveyard as an artifact', () => {
  const game = vsOpp();
  Game.move(game.bot.s, find(game.bot.s, 'Giant'), 'graveyard');
  run(game, { name: 'Death Is Irrelevant' }, 'Assimilate target creature card from a graveyard.');
  const giant = game.zones.battlefield.map(i => game.cards[i]).find(c => c.id === 'Giant');
  assert.ok(giant);
  assert.equal(giant.counters['+1/+1'], 1);
  assert.ok(giant.extraTypes.includes('artifact'));
});

test('Platinum Emperion keeps your life total where it is', () => {
  const game = vsOpp();
  put(game, 'Platinum Emperion');
  const before = { you: game.life, opp: game.oppLife };
  game.life -= 7;
  Bot.lifeChanged(game, before, defOf, ctx(game));
  assert.equal(game.life, 40);
});

test('Brain Maggot holds the opponent\'s best card and gives it back when it leaves', () => {
  const game = vsOpp();
  const maggot = put(game, 'Brain Maggot');
  const o = game.bot.s;
  Game.move(o, find(o, 'Giant'), 'hand');
  run(game, maggot, 'Target opponent reveals their hand and you choose a nonland card from it. Exile that card until this creature leaves the battlefield.');
  const held = o.zones.exile.map(i => o.cards[i]).find(c => c.exiledWith === maggot.iid);
  assert.ok(held);
  Game.move(game, maggot.iid, 'graveyard');
  Bot.refreshGrants(game, defOf);
  assert.equal(held.zone, 'hand');
});

test('Crumbling Colossus is sacrificed after combat; Assassin\'s Ink costs less with an artifact and an enchantment', () => {
  const game = vsOpp();
  const col = put(game, 'Crumbling Colossus');
  run(game, col, 'Sacrifice it at end of combat.');
  Bot.phaseTriggers(game, game, 'second main', defOf, ctx(game));
  assert.equal(col.zone, 'graveyard');
  const ink = game.cards[find(game, "Assassin's Ink")];
  put(game, 'Relic');
  put(game, 'Bad Moon');
  assert.equal(Bot.selfDiscount(game, ink, defOf), 2);
});
