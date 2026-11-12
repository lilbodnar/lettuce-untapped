// Colorless cards: the Equipment and the colorless (Eldrazi etc.) creatures that were left.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./equip-eldrazi-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Human: { id: 'Human', name: 'Villager', typeLine: 'Creature — Human', manaCost: '{W}', cmc: 1, power: '1', toughness: '1', oracle: '', colors: ['W'] },
  Ogre: { id: 'Ogre', name: 'Ogre', typeLine: 'Creature — Ogre', manaCost: '{4}{R}', cmc: 5, power: '5', toughness: '5', oracle: '', colors: ['R'] },
  Bolt: { id: 'Bolt', name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Bolt deals 3 damage to any target.', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids, qty = {}) => ({ key: name, name, rows: ids.map(id => ({ id, qty: qty[id] || 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs), { Island: 8, Forest: 8, Bolt: 3 }), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs), { Island: 8, Bear: 3 }), defs, { onDraw: true });
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'exile']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const equip = (s, eq, c) => Game.attach(s, eq.iid, c.iid, Bot.attachBonus(defOf(eq.id).oracle));
const ctx = (game, extra = {}) => ({ other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), hitOpps: n => { game.oppLife -= n; }, ...extra });
const run = (game, self, text) => Bot.runEffect(game, text, ctx(game, { self }));
const st = c => Bot.stats(c, defOf(c.id));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every Equipment and colorless creature here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('the Swords give +2/+2 and both protections', () => {
  const b = Bot.attachBonus(cards['Sword of Fire and Ice'].oracle);
  assert.equal(b.pow, 2);
  assert.ok(b.kw.includes('protection from R') && b.kw.includes('protection from U'));
  const r = Bot.attachBonus(cards['Brotherhood Regalia'].oracle);
  assert.ok(r.kw.includes('unblockable'));
});

test('Sword of Feast and Famine: a discard and your lands untap', () => {
  const game = vsOpp();
  const sword = put(game, 'Sword of Feast and Famine');
  const isl = put(game, 'Island');
  isl.tapped = true;
  const left = run(game, sword, 'That player discards a card and you untap all lands you control.');
  assert.deepEqual(left, ['each opponent discards a card']); // (the app makes Opp discard)
  assert.equal(isl.tapped, false);
});

test("Staff of Titania counts Forests; Butcher's Cleaver gives a Human lifelink", () => {
  const game = vsOpp();
  const staff = put(game, 'Staff of Titania');
  const bear = put(game, 'Bear');
  put(game, 'Forest'); put(game, 'Forest');
  equip(game, staff, bear);
  Bot.refreshGrants(game, defOf);
  assert.equal(st(bear).pow, 4);
  const cleaver = put(game, "Butcher's Cleaver");
  const human = put(game, 'Human');
  equip(game, cleaver, human);
  Bot.refreshGrants(game, defOf);
  assert.ok(st(human).kw.has('lifelink'));
});

test("Umezawa's Jitte pumps the equipped creature; Lost Jitte puts a counter on it", () => {
  const game = vsOpp();
  const jitte = put(game, "Umezawa's Jitte");
  const bear = put(game, 'Bear');
  equip(game, jitte, bear);
  run(game, jitte, 'Equipped creature gets +2/+2 until end of turn.');
  assert.equal(st(bear).pow, 4);
  const lost = put(game, 'Lost Jitte');
  equip(game, lost, bear);
  run(game, lost, 'Put a +1/+1 counter on equipped creature.');
  assert.equal(bear.counters['+1/+1'], 1);
});

test('equip costs that are not mana are read', () => {
  assert.deepEqual(Bot.equipAlt('Equip—Pay 3 life.'), { life: 3 });
  assert.deepEqual(Bot.equipAlt('Equip—Sacrifice a creature.'), { sacrifice: 'creature' });
  assert.deepEqual(Bot.equipAlt('Equip—{2}, Pay 2 life.'), { mana: '{2}', life: 2 });
});

test('Ingest exiles the top card; a processor uses it', () => {
  const game = vsOpp();
  const line = Bot.parts.plainLine('Ingest');
  assert.match(line, /it ingests/);
  run(game, { name: 'Salvage Drone' }, 'It ingests.');
  assert.equal(game.bot.s.zones.exile.length, 1);
  const life = game.life;
  run(game, { name: 'Ruin Processor' }, "You may put a card an opponent owns from exile into that player's graveyard. If you do, you gain 5 life.");
  assert.equal(game.life, life + 5);
  assert.equal(game.bot.s.zones.exile.length, 0);
});

test('Kozilek, Butcher of Truth shuffles your graveyard back when it goes there', () => {
  const game = vsOpp();
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game));
  const bear = find(game, 'Bear'), koz = find(game, 'Kozilek, Butcher of Truth');
  Game.move(game, bear, 'graveyard');
  // (either card can start in the opening hand, so check where they end up rather than counting)
  Game.move(game, koz, 'graveyard');
  assert.equal(game.zones.graveyard.length, 0);
  assert.ok(game.zones.library.includes(bear) && game.zones.library.includes(koz));
});

test('Ulamog, the Ceaseless Hunger exiles twenty; Emrakul, the World Anew takes their creatures', () => {
  const game = vsOpp();
  const n = game.bot.s.zones.library.length;
  run(game, { name: 'Ulamog' }, 'Defending player exiles the top twenty cards of their library.');
  assert.equal(game.bot.s.zones.library.length, Math.max(0, n - 20));
  put(game.bot.s, 'Bear');
  run(game, { name: 'Emrakul' }, 'Gain control of all creatures target player controls.');
  assert.ok(game.zones.battlefield.some(iid => game.cards[iid].id === 'Bear'));
});

test('Worldslayer destroys everything else; Mjölnir taps and stuns', () => {
  const game = vsOpp();
  const mj = put(game, 'Mjölnir, Storm Hammer');
  const ogre = put(game.bot.s, 'Ogre');
  run(game, mj, 'Tap target creature defending player controls and put a stun counter on it. Then Mjölnir deals damage to each opponent equal to the number of tapped creatures that opponent controls.');
  assert.ok(ogre.tapped);
  assert.equal(ogre.counters.stun, 1);
  const ws = put(game, 'Worldslayer');
  put(game, 'Bear');
  run(game, ws, 'Destroy all permanents other than this Equipment.');
  assert.deepEqual(game.zones.battlefield.map(iid => game.cards[iid].id), ['Worldslayer']);
});

test('Bilbo\'s Ring draws when its creature attacks alone; Infiltration Lens draws two when blocked', () => {
  const game = vsOpp();
  const ring = put(game, "Bilbo's Ring");
  const bear = put(game, 'Bear');
  equip(game, ring, bear);
  // (put the Lens out before counting: put() can take it from the opening hand)
  const lens = put(game, 'Infiltration Lens');
  const hand = game.zones.hand.length;
  Bot.attackWatch(game, game, defOf, ctx(game), [bear]);
  assert.equal(game.zones.hand.length, hand + 1);
  equip(game, lens, bear);
  Bot.becameBlocked(game, bear, 1, defOf, [], game);
  assert.equal(game.zones.hand.length, hand + 3);
});
