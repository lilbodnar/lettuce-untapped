// White cards, batch by batch: white cards that weren't automatic yet, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Squire: { id: 'Squire', name: 'Squire', typeLine: 'Creature — Human Soldier', manaCost: '{1}{W}', cmc: 2, power: '1', toughness: '2', oracle: '', colors: ['W'] },
  Smith: { id: 'Smith', name: 'Smith', typeLine: 'Creature — Dwarf', manaCost: '{1}{R}', cmc: 2, power: '1', toughness: '1', oracle: '{2}: This creature gets +1/+0 until end of turn.', colors: ['R'] },
  Cat: { id: 'Cat', name: 'Kitten', typeLine: 'Creature — Cat Familiar', manaCost: '{G}', cmc: 1, power: '1', toughness: '1', oracle: '', colors: ['G'] },
  // The mana lines of three white cards that still have other lines to do
  Tazri: { id: 'Tazri', name: 'Tazri, Stalwart Survivor', typeLine: 'Legendary Creature — Human Warrior', manaCost: '{2}{W}', cmc: 3, power: '3', toughness: '3', colors: ['W'],
    oracle: 'Creatures you control have "{T}: Add one mana of any of this creature\'s colors. Spend this mana only to activate an ability of a creature. Activate only if this creature has another activated ability."' },
  Brigid: { id: 'Brigid', name: "Brigid, Doun's Mind", typeLine: 'Legendary Creature — Kithkin Soldier', manaCost: '{2}{W}', cmc: 3, power: '3', toughness: '2', colors: ['G', 'W'],
    oracle: '{T}: Add X {G} or X {W}, where X is the number of other creatures you control.' },
  Chea: { id: 'Chea', name: 'Chea, Friend to Maybe Too Many', typeLine: 'Legendary Creature — Elf Druid', manaCost: '{1}{G}{W}', cmc: 3, power: '2', toughness: '2', colors: ['G', 'W'],
    oracle: '{T}: Add X {G} and each opponent loses X life, where X is the number of Familiars you control.' },
  Token: { id: 'Token', name: 'Soldier', typeLine: 'Token Creature — Soldier', manaCost: '', cmc: 0, power: '1', toughness: '1', oracle: '', colors: ['W'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Plains' ? 10 : id === 'Token' ? 4 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'battlefield']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id && s.cards[i].zone !== 'battlefield') || zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); if (s.cards[iid].zone !== 'battlefield') Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const clearBoard = s => s.zones.battlefield.slice().forEach(iid => Game.move(s, iid, 'graveyard'));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every white card done so far is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

// ---- White cards, batch 1: mana abilities ----

test('Adarkar Unicorn taps for {U}; Farrelite Priest turns {1} into {W}', () => {
  const game = vsOpp();
  clearBoard(game);
  assert.deepEqual(Game.sourceOf(game, put(game, 'Adarkar Unicorn')).colors, ['U']);
  const priest = Game.sourceOf(game, put(game, 'Farrelite Priest'));
  assert.equal(priest.filter, 1);
  assert.deepEqual(priest.makes, ['W']);
});

test("Katilda gives Humans her mana; Tazri only to creatures with another activated ability", () => {
  const game = vsOpp();
  clearBoard(game);
  put(game, 'Katilda, Dawnhart Prime');
  const squire = put(game, 'Squire');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(Game.sourceOf(game, squire).colors, ['W']);
  assert.equal(Game.sourceOf(game, bear), null);
  clearBoard(game);
  put(game, 'Tazri');
  const smith = put(game, 'Smith');
  const bear2 = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(Game.sourceOf(game, smith).colors, ['R']);
  assert.equal(Game.sourceOf(game, bear2), null);
});

test('Brigid makes X mana for the other creatures; Chea drains for each Familiar', () => {
  const game = vsOpp();
  clearBoard(game);
  const brigid = put(game, 'Brigid');
  assert.equal(Game.sourceOf(game, brigid), null);
  put(game, 'Bear');
  put(game, 'Squire');
  assert.equal(Game.sourceOf(game, brigid).amount, 2);
  clearBoard(game);
  const chea = put(game, 'Chea');
  put(game, 'Cat');
  assert.equal(Game.sourceOf(game, chea).amount, 1);
  Game.hooks.manaTapped = (s, inst) => Bot.manaTapped(s, inst);
  Bot.refreshGrants(game, defOf);
  const before = game.oppLife;
  assert.ok(Game.autoPay(game, '{G}'));
  assert.ok(chea.tapped);
  assert.equal(game.oppLife, before - 1);
});

test('Baylen taps two tokens for one mana of any color', () => {
  const game = vsOpp();
  clearBoard(game);
  put(game, 'Baylen, the Haymaker');
  const toks = game.zones.library.filter(iid => game.cards[iid].id === 'Token').slice(0, 2).map(iid => { Game.move(game, iid, 'battlefield', { put: true }); const c = game.cards[iid]; c.token = true; return c; });
  assert.ok(Game.autoPay(game, '{U}'));
  assert.ok(toks.every(c => c.tapped));
});
