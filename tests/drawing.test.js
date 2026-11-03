// "drawing cards" (archidekt.com/decks/28067559, Rashmi, Eternities Crafter): Simic card draw, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./drawing-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Bolt: { id: 'Bolt', name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Bolt deals 3 damage to any target.', colors: ['R'] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{3}', cmc: 3, oracle: '', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Island' ? 10 : 1 })) });
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

test('Eligeth turns a scry into drawing that many cards', () => {
  const game = vsOpp();
  put(game, 'Eligeth, Crossroads Augur');
  const hand = game.zones.hand.length;
  run(game, { name: 'Inga Rune-Eyes' }, 'Scry 3.');
  assert.equal(game.zones.hand.length, hand + 3);
});

test('Bonny Pall makes Beau, as big as your land count; Gnarled Sage grows after two draws', () => {
  const game = vsOpp();
  put(game, 'Island');
  put(game, 'Island');
  run(game, { name: 'Bonny Pall, Clearcutter' }, 'Create Beau, a legendary blue Ox creature token with "Beau\'s power and toughness are each equal to the number of lands you control."');
  const sage = put(game, 'Gnarled Sage');
  Game.drawCards(game, 2);
  game.drawTurn = game.turn;
  game.drawCount = 2;
  Bot.refreshGrants(game, defOf);
  const beau = game.zones.battlefield.map(i => game.cards[i]).find(c => c.name === 'Beau');
  assert.equal(st(beau).pow, 2);
  assert.equal(st(sage).tou, 6);
  assert.ok(st(sage).kw.has('vigilance'));
});

test('Planar Genesis puts a land from the top four onto the battlefield tapped', () => {
  const game = vsOpp();
  const iid = find(game, 'Island', ['library']);
  game.zones.library.splice(game.zones.library.indexOf(iid), 1);
  game.zones.library.unshift(iid);
  run(game, { name: 'Planar Genesis' }, 'Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. If you don\'t, put a card from among them into your hand. Put the rest on the bottom of your library in a random order.');
  assert.equal(game.cards[iid].zone, 'battlefield');
  assert.ok(game.cards[iid].tapped);
});

test('Naiad makes spells cheaper on the opponent\'s turn; Teferi keeps Opp from countering', () => {
  const game = vsOpp();
  put(game, 'Naiad of Hidden Coves');
  const rewind = game.cards[find(game, 'Rewind')];
  game.offTurn = true;
  assert.equal(Bot.selfDiscount(game, rewind, defOf), 1);
  game.offTurn = false;
  put(game, 'Teferi, Mage of Zhalfir');
  game.bot.respond = true;
  assert.equal(Bot.oppCounters(game, rewind, defOf), false);
});
