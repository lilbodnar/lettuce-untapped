// The Lord of the Rings Commander precons (Elven Council, Food and Fellowship, Riders of Rohan, The Hosts of Mordor): every card done for
// you, and the rules they brought (the Ring, voting, extra turns) played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { decks, cards } = require('./ltc-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Swamp: { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
  Bolt: { id: 'Bolt', name: 'Lightning Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Lightning Bolt deals 3 damage to any target.', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const pool = ['Galadriel, Elven-Queen', 'Plea for Power', 'Erestor of the Council', 'Travel Through Caradhras', 'Trap the Trespassers', 'Círdan the Shipwright',
  'Lignify', 'Rapacious Guest', 'Champions of Minas Tirith', 'Notion Thief', 'Treasure Nabber', 'Troll of Khazad-dûm', 'Hostage Taker', 'Living Death',
  'Everflowing Chalice', 'Frodo, Adventurous Hobbit', 'Lord of the Nazgûl', 'Mind Stone', 'Fiendish Duo', ...Object.keys(basics)].filter(id => defs[id]);
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
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the Lord of the Rings precons is done for you', () => {
  for (const [name, list] of Object.entries(decks)) {
    for (const id of list) {
      const r = Coverage.check(cards[id]);
      assert.equal(r.you, 'all', `${name}, ${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
    }
  }
});

test('The Ring tempts you: a legendary Ring-bearer that grows with each temptation', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'the Ring tempts you', ctx(game, { self: { name: 'Test' } }));
  assert.equal(game.ringBearer, bear.iid, 'the only creature is the Ring-bearer');
  Bot.refreshGrants(game, defOf);
  const st = Bot.stats(bear, defOf(bear.id));
  assert.ok(st.types.includes('legendary'));
  assert.equal(Bot.canBlock(Bot.stats(giant, giant.bot), st, game.bot.s), false, 'a bigger creature can\'t block it');
  for (let i = 0; i < 3; i++) Bot.runEffect(game, 'the Ring tempts you', ctx(game, { self: { name: 'Test' } }));
  Bot.refreshGrants(game, defOf);
  assert.equal(game.ringTempts, 4);
  assert.ok((bear.grantedLines || []).some(l => /draw a card, then discard a card/.test(l)));
  assert.ok((bear.grantedLines || []).some(l => /each opponent loses 3 life/.test(l)));
  // Third temptation: a creature that blocks it is sacrificed at end of combat.
  Bot.becameBlocked(game, bear, 1, defOf, [giant]);
  Bot.combatOver(game);
  assert.ok(!game.bot.s.zones.battlefield.includes(giant.iid), 'the blocker was sacrificed');
});

test('Will of the council: the other player votes for the choice that wins ties (Plea for Power draws three)', () => {
  const game = vsOpp();
  const hand = game.zones.hand.length;
  const text = Bot.parts.settleIfYouDo(cards['Plea for Power'].oracle.split('\n').slice(-1)[0].replace(/^Will of the council — /, ''), null);
  assert.match(text, /^will of the council:/);
  Bot.runEffect(game, text, ctx(game, { self: { name: 'Plea for Power' } }));
  assert.equal(game.zones.hand.length, hand + 3);
});

test('An extra turn: the other player skips their next one', () => {
  const game = vsOpp();
  Bot.runEffect(game, 'take an extra turn after this one', ctx(game, { self: { name: 'Plea for Power' } }));
  assert.equal(game.bot.s.skipTurn, 1);
  game.bot.started = true;
  const res = Bot.beginTurn(game, defOf);
  assert.ok(res.notes.some(n => /skipped its turn/.test(n)));
  assert.equal(game.bot.s.skipTurn, 0);
  Bot.endTurn(game, defOf);
});

test("Erestor of the Council: players finish voting, and its controller scries and draws", () => {
  const game = vsOpp();
  put(game, 'Erestor of the Council');
  const hand = game.zones.hand.length;
  const text = Bot.parts.settleIfYouDo(cards['Plea for Power'].oracle.split('\n').slice(-1)[0].replace(/^Will of the council — /, ''), null);
  Bot.runEffect(game, text, ctx(game, { self: { name: 'Plea for Power' } }));
  assert.equal(game.zones.hand.length, hand + 3 + 1, 'three from the vote, one from Erestor');
});

test("Council's dilemma: each vote does its part (Travel Through Caradhras)", () => {
  const game = vsOpp();
  const lands = game.zones.battlefield.length;
  const text = Bot.parts.settleIfYouDo(cards['Travel Through Caradhras'].oracle.split('\n').slice(0, 1)[0].replace(/^Council's dilemma — /, ''), null);
  assert.match(text, /^council's dilemma:/);
  Bot.runEffect(game, text, ctx(game, { self: { name: 'Travel Through Caradhras' } }));
  assert.equal(game.zones.battlefield.length, lands + 2, 'two Redhorn Pass votes: two basic lands');
});

test('Secret council: Trap the Trespassers stuns the creature the votes go to', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, Bot.parts.plainLine(cards['Trap the Trespassers'].oracle), ctx(game, { self: { name: 'Trap the Trespassers' } }));
  assert.equal(giant.tapped, true);
  assert.equal(giant.counters.stun, 2, "both votes: yours, and Opp's on its only creature");
});

test('Lignify makes the creature a 0/4 Treefolk with no abilities', () => {
  const b = Bot.attachBonus(cards.Lignify.oracle);
  assert.equal(b.setPT, '0/4');
  assert.ok(b.loseAll);
});

test('Opp eats its Foods at the end of its turn, and Rapacious Guest grows', () => {
  const game = vsOpp();
  const s = game.bot.s;
  game.oppLife = 30;
  for (let i = 0; i < 4; i++) put(s, 'Swamp');
  const guest = put(s, 'Rapacious Guest');
  Bot.runEffect(s, 'create a Food token', { self: { name: 'Test', bot: {} }, other: game, defOf });
  Bot.refreshGrants(game, defOf);
  Bot.endTurn(game, defOf);
  assert.ok(!s.zones.battlefield.some(i => /food/i.test(s.cards[i].name)), 'the Food was eaten');
  assert.equal(guest.counters['+1/+1'], 1);
});

test('Champions of Minas Tirith: attacking the monarch costs the attacker their hand size', () => {
  const game = vsOpp();
  put(game, 'Champions of Minas Tirith');
  game.monarch = Date.now();
  Bot.refreshGrants(game, defOf);
  const r = Bot.attackRules([Bot.tableRules(game, defOf)], Bot.tableRules(game, defOf));
  assert.equal(r.handTax, true);
});

test("Notion Thief takes the other player's extra draws", () => {
  const game = vsOpp();
  put(game, 'Notion Thief');
  Game.hooks.drawInstead = (s, first) => Bot.drawInstead(game, s, first, defOf);
  const mine = game.zones.hand.length;
  const theirs = game.bot.s.zones.hand.length;
  Game.drawCards(game.bot.s, 2, true);
  assert.equal(game.bot.s.zones.hand.length, theirs);
  assert.equal(game.zones.hand.length, mine + 2);
});

test('Treasure Nabber takes an artifact tapped for mana until the end of its next turn', () => {
  const game = vsOpp();
  put(game.bot.s, 'Treasure Nabber');
  const chalice = put(game, 'Everflowing Chalice');
  Game.counter(game, chalice.iid, 'charge', 2);
  Game.hooks.manaTapped = (s, inst) => Bot.manaTapped(s, inst);
  const paid = Game.autoPay(game, '{2}');
  assert.ok(paid, 'two charge counters: {C}{C}');
  Bot.refreshGrants(game, defOf);
  assert.ok(!game.zones.battlefield.includes(chalice.iid));
  const took = game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).find(c => c.name === 'Everflowing Chalice');
  assert.ok(took && took.lentUntil);
  game.bot.s.turn = took.lentUntil;
  Bot.returnLent(game, game.bot.s, defOf);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].name === 'Everflowing Chalice'));
});

test('Troll of Khazad-dûm needs three blockers', () => {
  const game = vsOpp();
  const troll = put(game.bot.s, 'Troll of Khazad-dûm');
  Bot.refreshGrants(game, defOf);
  const st = Bot.stats(troll, troll.bot);
  assert.ok(st.kw.has('three blockers'));
  assert.equal(Bot.legalBlock(st, 2), false);
  assert.equal(Bot.legalBlock(st, 3), true);
});

test("Hostage Taker exiles Opp's creature, and you may cast it with any mana while it stays exiled", () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const taker = put(game, 'Hostage Taker');
  Bot.enterEffects(game, game, taker, defOf, ctx(game));
  const held = game.zones.exile.map(i => game.cards[i]).find(c => c.name === 'Hill Giant');
  assert.ok(held && held.playable && held.playable.anyMana, 'kept on your side, castable');
  assert.ok(!game.bot.s.cards[giant.iid], "it left Opp's side");
  Game.move(game, taker.iid, 'graveyard');
  Bot.cardMoved(game, game, taker, 'battlefield', 'graveyard', defOf, ctx(game));
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].name === 'Hill Giant'), 'back to Opp when Hostage Taker leaves');
});

test('Living Death swaps the creatures on the battlefield and in the graveyards', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = game.cards[find(game, 'Giant')];
  Game.move(game, giant.iid, 'graveyard');
  Bot.runEffect(game, Bot.parts.settleIfYouDo(cards['Living Death'].oracle, null), ctx(game, { self: { name: 'Living Death' } }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'battlefield');
});

test('Everflowing Chalice taps for {C} for each charge counter; Relic of Sauron for two of U, B and R', () => {
  assert.equal(Game.manaAbility('Everflowing Chalice', cards['Everflowing Chalice'].oracle).perCounter, 'charge');
  const relic = Game.manaAbility('Relic of Sauron', cards['Relic of Sauron'].oracle);
  assert.deepEqual([relic.amount, relic.colors], [2, ['U', 'B', 'R']]);
});
