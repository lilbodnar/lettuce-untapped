// "Is Your Turn Over Yet?" (Etali, Primal Conqueror, archidekt.com/decks/19262701): every card done for you, and the copies, free spells
// and mana tricks it plays with.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { deck: list, cards } = require('./etali-cards.json');
const ETALI = 'Etali, Primal Conqueror // Etali, Primal Sickness';
const basics = {
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Dino: { id: 'Dino', name: 'Carnage Tyrant', typeLine: 'Creature — Dinosaur', manaCost: '{4}{G}{G}', cmc: 6, power: '7', toughness: '6', oracle: 'Trample', colors: ['G'] },
  Mind: { id: 'Mind', name: 'Divination', typeLine: 'Sorcery', manaCost: '{2}{U}', cmc: 3, oracle: 'Draw two cards.', colors: ['U'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', [...list, ...Object.keys(basics)]), defs);
  game.bot = Bot.create(deck('Opp', [...list, ...Object.keys(basics)]), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const toHand = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'hand'); return s.cards[iid]; };
const toTop = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'library', { index: 0 }); return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, self: { name: 'Test' }, ...extra });
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const id of list) {
    const r = Coverage.check(cards[id]);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test("Etali's enter trigger: each player's first nonland card from the top, cast for free", () => {
  const game = vsOpp();
  const s = game.bot.s;
  const etali = put(game, ETALI);
  toTop(game, 'Bear');
  toTop(game, 'Forest'); // a land on top of yours: exiled on the way
  toTop(s, 'Dino');
  Bot.enterEffects(game, game, etali, defOf, ctx(game, { self: etali }));
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Bear'));
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Dino'), "Opp's card is cast by you");
  assert.ok(game.zones.exile.some(i => game.cards[i].id === 'Forest'));
});

test('Panharmonicon makes Etali trigger twice', () => {
  const game = vsOpp();
  put(game, 'Panharmonicon');
  const etali = put(game, ETALI);
  const before = game.zones.exile.length + game.zones.battlefield.length;
  Bot.enterEffects(game, game, etali, defOf, ctx(game, { self: etali }));
  const s = game.bot.s;
  assert.equal(s.zones.library.length + s.zones.exile.length + s.zones.battlefield.length + s.zones.hand.length < 99 + 10 * 4, true);
  assert.ok(game.zones.exile.length + game.zones.battlefield.length >= before + 2);
});

test('Etali transforms into an 11/11 that gives poison counters', () => {
  const game = vsOpp();
  const etali = put(game, ETALI);
  const ab = Bot.activatedAbilities(etali, defOf)[0];
  Bot.runEffect(game, ab.effect, ctx(game, { self: etali }));
  assert.equal(etali.flipped, true);
  const st = Bot.stats(etali, defOf(etali.id));
  assert.deepEqual([st.pow, st.tou], [11, 11]);
  assert.ok(st.kw.has('indestructible'));
  Bot.runEffect(game, 'they get 11 poison counters', ctx(game, { self: etali }));
  assert.equal(game.bot.s.poison, 11);
});

test('Heat Shimmer, Electroduplicate, Molten Duplication, Orthion and Jaxis read as hasty token copies that go at the end step', () => {
  const text = id => Bot.parts.settleIfYouDo(cards[id].oracle.split('\n').find(l => /create/i.test(l)).replace(/^[^:]*\{T\}[^:]*: /, ''), null);
  const shimmer = Bot.targetEffect(text('Heat Shimmer'));
  assert.ok(shimmer.haste && shimmer.exileAtEnd);
  for (const id of ['Electroduplicate', 'Molten Duplication', 'Kindle the Inner Flame', 'Orthion, Hero of Lavabrink']) {
    const e = Bot.targetEffect(text(id));
    assert.ok(e && e.action === 'copy' && e.haste && e.sacAtEnd, id);
  }
  const jaxis = Bot.targetEffect(text('Jaxis, the Troublemaker'));
  assert.ok(jaxis.another && jaxis.haste && jaxis.sacAtEnd && jaxis.diesDraw);
});

test("A token copy of Jaxis's draws a card when it dies", () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  Bot.applyTarget(game, game, bear, { action: 'copy', n: 1, what: 'creature', haste: true, sacAtEnd: true, diesDraw: true }, 'Jaxis', defOf);
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token);
  assert.ok(tok && tok.diesDraw);
  const hand = game.zones.hand.length;
  Bot.died(game, tok, defOf, null, game, { to: 'graveyard' });
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Blitz and dash: haste, then sacrificed or back to your hand at the end step', () => {
  const game = vsOpp();
  const jaxis = toHand(game, 'Jaxis, the Troublemaker');
  assert.ok(Bot.costChoices(game, jaxis, defOf).some(c => c.key === 'blitz' && c.cost === '{1}{R}'));
  const ragavan = toHand(game, 'Ragavan, Nimble Pilferer');
  assert.ok(Bot.costChoices(game, ragavan, defOf).some(c => c.key === 'dash'));
  Game.move(game, jaxis.iid, 'battlefield');
  jaxis.fastCast = 'blitz';
  Bot.fastCast(game, game, jaxis);
  Game.move(game, ragavan.iid, 'battlefield');
  ragavan.fastCast = 'dash';
  Bot.fastCast(game, game, ragavan);
  assert.ok(Bot.stats(ragavan, defOf(ragavan.id)).kw.has('haste'));
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(jaxis.zone, 'graveyard');
  assert.equal(ragavan.zone, 'hand');
});

test('Exploration: two lands a turn', () => {
  const game = vsOpp();
  put(game, 'Exploration');
  toHand(game, 'Forest');
  toHand(game, 'Mountain');
  Game.move(game, find(game, 'Forest', ['hand']), 'battlefield');
  assert.equal(game.landPlayed, false);
  Game.move(game, find(game, 'Mountain', ['hand']), 'battlefield');
  assert.equal(game.landPlayed, true);
});

test('Wild Growth and Utopia Sprawl add mana to their land', () => {
  const game = vsOpp();
  const forest = put(game, 'Forest');
  const growth = put(game, 'Wild Growth');
  Game.attach(game, growth.iid, forest.iid, {});
  assert.equal(Game.sourceOf(game, forest).amount, 2);
  const sprawl = put(game, 'Utopia Sprawl');
  sprawl.chosenColor = 'R';
  Game.attach(game, sprawl.iid, forest.iid, {});
  const src = Game.sourceOf(game, forest);
  assert.equal(src.amount, 3);
  assert.deepEqual(src.makes.slice(1), [['G'], ['R']]);
  Game.setTapped(game, forest.iid, true, 'G');
  assert.deepEqual([game.mana.G, game.mana.R], [2, 1]);
});

test("Chrome Mox taps for the exiled card's colors", () => {
  const game = vsOpp();
  const mox = put(game, 'Chrome Mox');
  assert.equal(Game.sourceOf(game, mox), null);
  game.zones.hand.slice().forEach(i => Game.move(game, i, 'library'));
  toHand(game, 'Bear');
  Bot.runEffect(game, 'exile a nonartifact, nonland card from your hand', { ...ctx(game), self: mox });
  assert.deepEqual(Game.sourceOf(game, mox).colors, ['G']);
  assert.equal(game.zones.hand.length, 0);
});

test('Spirit Guides, Treasonous Ogre, Orcish Lumberjack and Food Chain are mana you activate', () => {
  for (const id of ['Elvish Spirit Guide', 'Simian Spirit Guide']) assert.equal(Bot.handAbilities({ id, name: id, typeLine: cards[id].typeLine }, defOf)[0].kind, 'handMana');
  const game = vsOpp();
  const ogre = put(game, 'Treasonous Ogre');
  const pay = Bot.activatedAbilities(ogre, defOf)[0];
  assert.equal(pay.life, 3);
  const jack = put(game, 'Orcish Lumberjack');
  const sac = Bot.activatedAbilities(jack, defOf)[0];
  assert.equal(sac.sacOther.toLowerCase(), 'forest');
  Bot.runEffect(game, sac.effect, ctx(game, { self: jack }));
  assert.equal(game.mana.R + game.mana.G, 3);
  const chain = put(game, 'Food Chain');
  const ex = Bot.activatedAbilities(chain, defOf)[0];
  assert.equal(ex.exileOther, 'creature');
  game.lastExiledMv = 7;
  const before = Object.values(game.mana).reduce((a, b) => a + b, 0);
  Bot.runEffect(game, ex.effect, ctx(game, { self: chain }));
  assert.equal(Object.values(game.mana).reduce((a, b) => a + b, 0), before + 8);
});

test('Braid of Fire adds one more {R} each upkeep', () => {
  const game = vsOpp();
  put(game, 'Braid of Fire');
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  assert.equal(game.mana.R, 1);
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  assert.equal(game.mana.R, 3);
});

test('Sylvan Library: Opp draws two and puts two back', () => {
  const game = vsOpp();
  const s = game.bot.s;
  const lib = put(s, 'Sylvan Library');
  const hand = s.zones.hand.length;
  const life = s.life;
  const lines = Bot.parts.effectParts(Bot.parts.settleIfYouDo(cards['Sylvan Library'].oracle.replace(/^at the beginning of your draw step, /i, ''), null));
  assert.equal(lines.length, 1);
  Bot.runEffect(s, cards['Sylvan Library'].oracle.replace(/^at the beginning of your draw step, /i, ''), { other: game, defOf, self: lib });
  assert.equal(s.zones.hand.length, hand);
  assert.equal(s.life, life);
});

test("Tibalt's Trickery: the countered spell's controller casts the next nonland card from the top", () => {
  const game = vsOpp();
  const s = game.bot.s;
  toTop(s, 'Bear');
  // four different Forests above it: milled 1 to 3, then the rest exiled on the way to the Bear
  s.zones.library.filter(i => s.cards[i].id === 'Forest').slice(0, 4).forEach(i => Game.move(s, i, 'library', { index: 0 }));
  Bot.counterExtras(game, game, s, cards["Tibalt's Trickery"].oracle, "Tibalt's Trickery");
  assert.ok(s.zones.battlefield.some(i => s.cards[i].id === 'Bear'));
});

test('Eldritch Evolution finds a creature with mana value up to 2 more than the sacrificed one', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const evo = toHand(game, 'Eldritch Evolution');
  const left = Bot.runEffect(game, cards['Eldritch Evolution'].oracle, ctx(game, { self: evo }));
  assert.deepEqual(left, []);
  assert.equal(bear.zone, 'graveyard');
  const found = game.zones.battlefield.map(i => game.cards[i]).filter(c => Game.isCreature(c));
  assert.equal(found.length, 1);
  assert.ok((found[0].cmc || defOf(found[0].id).cmc) <= 4);
});

test('Rhythm of the Wild gives riot: haste on your turn', () => {
  const game = vsOpp();
  put(game, 'Rhythm of the Wild');
  const bear = put(game, 'Bear');
  Bot.enterTrigger(game, bear, defOf);
  assert.ok(Bot.stats(bear, defOf('Bear')).kw.has('haste'));
  game.offTurn = true;
  const dino = put(game, 'Dino');
  Bot.enterTrigger(game, dino, defOf);
  assert.equal(dino.counters['+1/+1'], 1);
});

test('Squee can be cast from the graveyard and from exile', () => {
  const game = vsOpp();
  const squee = game.cards[find(game, 'Squee, the Immortal')];
  Game.move(game, squee.iid, 'graveyard');
  assert.equal(Bot.graveCast(game, squee, defOf), true);
  Game.move(game, squee.iid, 'exile');
  Bot.cardMoved(game, game, squee, 'graveyard', 'exile', defOf, ctx(game));
  assert.ok(squee.playable && squee.playable.forever);
});

test('Hunting Velociraptor: prowl for Dinosaurs after a Dinosaur hits', () => {
  const game = vsOpp();
  put(game, 'Hunting Velociraptor');
  const raptor = game.zones.battlefield.map(i => game.cards[i]).find(c => c.id === 'Hunting Velociraptor');
  const dino = toHand(game, 'Dino');
  assert.ok(!Bot.costChoices(game, dino, defOf).some(c => c.key === 'prowl'));
  Bot.combatDamage(game, [{ inst: raptor, st: Bot.stats(raptor, defOf(raptor.id)), dmg: 3 }], defOf, ctx(game));
  assert.ok(Bot.costChoices(game, dino, defOf).some(c => c.key === 'prowl' && c.cost === '{2}{R}'));
});

test("Deflecting Swat sends Opp's removal back at Opp's own creature", () => {
  const game = vsOpp();
  const s = game.bot.s;
  const mine = put(game, 'Bear');
  const theirs = put(s, 'Dino');
  const bolt = toHand(s, 'Lightning Bolt');
  s.zones.hand.splice(s.zones.hand.indexOf(bolt.iid), 1);
  bolt.zone = 'stack';
  s.stack = { iid: bolt.iid, from: 'hand', target: mine.iid };
  Bot.runEffect(game, 'You may choose new targets for target spell or ability.', ctx(game));
  Bot.resolveStack(game, defOf);
  assert.equal(mine.zone, 'battlefield');
  assert.ok(theirs.zone === 'battlefield' && game.oppLife === 37, "Bolt can't kill the 7/6, so it hits Opp");
});

test("Ragavan's hit: a Treasure and Opp's top card to cast this turn", () => {
  const game = vsOpp();
  const s = game.bot.s;
  const rag = put(game, 'Ragavan, Nimble Pilferer');
  toTop(s, 'Bear');
  Bot.combatDamage(game, [{ inst: rag, st: Bot.stats(rag, defOf(rag.id)), dmg: 2 }], defOf, ctx(game, { self: rag }));
  assert.ok(game.zones.battlefield.some(i => /treasure/i.test(game.cards[i].name)));
  const stolen = game.zones.exile.map(i => game.cards[i]).find(c => c.id === 'Bear');
  assert.ok(stolen && stolen.playable);
});

test("Nature's Claim: the artifact's controller gains 4 life", () => {
  const game = vsOpp();
  const s = game.bot.s;
  const ring = put(s, 'Sol Ring');
  Bot.applyTarget(game, s, ring, Bot.targetEffect(cards["Nature's Claim"].oracle), "Nature's Claim", defOf, game);
  assert.equal(ring.zone, 'graveyard');
  assert.equal(game.oppLife, 44);
});

test("Hexing Squelcher's ward (pay 2 life) keeps Opp from targeting your creatures", () => {
  const game = vsOpp();
  put(game, 'Hexing Squelcher');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(bear, defOf('Bear')).kw.has('ward'));
});
