// "merfolk" (archidekt.com/decks/28127408, Svyelun of Sea and Sky): mono-blue Merfolk. The blue cards were already done; this covers
// the two colorless ones that choose one of Lorwyn's eight types (Eclipsed Realms, Dawn-Blessed Pennant).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./merfolk-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Island' ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'battlefield']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); if (s.cards[iid].zone !== 'battlefield') Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra });
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test("Eclipsed Realms and Dawn-Blessed Pennant choose only from Lorwyn's eight types", () => {
  const eight = ['Elemental', 'Elf', 'Faerie', 'Giant', 'Goblin', 'Kithkin', 'Merfolk', 'Treefolk'];
  assert.deepEqual(Game.typeChoices(cards['Eclipsed Realms'].oracle), eight);
  assert.deepEqual(Game.typeChoices(cards['Dawn-Blessed Pennant'].oracle), eight);
  assert.ok(Game.choosesType(cards['Eclipsed Realms'].oracle));
  assert.equal(Game.typeChoices(cards['Cavern of Souls'].oracle), null); // any creature type
  assert.ok(Game.choosesType(cards['Cavern of Souls'].oracle));
  assert.equal(Game.typeChoices('As this artifact enters, choose artifact, creature, enchantment, instant, or sorcery.'), null); // Cloud Key
});

test('Dawn-Blessed Pennant: a Merfolk entering gains 1 life; a Bear does not', () => {
  const game = vsOpp();
  const pennant = put(game, 'Dawn-Blessed Pennant');
  pennant.chosenType = 'Merfolk';
  const life = game.life;
  const adept = put(game, 'Silvergill Adept');
  Bot.creatureEntered(game, adept, defOf, ctx(game));
  assert.equal(game.life, life + 1);
  const bear = put(game, 'Bear');
  Bot.creatureEntered(game, bear, defOf, ctx(game));
  assert.equal(game.life, life + 1);
});

test('Dawn-Blessed Pennant returns a card of the chosen type from your graveyard', () => {
  const game = vsOpp();
  const pennant = put(game, 'Dawn-Blessed Pennant');
  pennant.chosenType = 'Merfolk';
  Game.move(game, find(game, 'Bear'), 'graveyard');
  const lord = find(game, 'Lord of Atlantis');
  Game.move(game, lord, 'graveyard');
  Bot.runEffect(game, 'Return target card of the chosen type from your graveyard to your hand.', ctx(game, { self: pennant }));
  assert.equal(game.cards[lord].zone, 'hand');
  assert.equal(game.cards[find(game, 'Bear', ['graveyard'])].zone, 'graveyard');
});
