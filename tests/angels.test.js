// "angels" (archidekt.com/decks/27847429, Lyra, Archangel of Dawn): an Angels and lifegain deck, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./angels-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Bolt: { id: 'Bolt', name: 'Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Bolt deals 3 damage to any target.', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Plains' ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const ids = s => s.zones.battlefield.map(i => s.cards[i]);
const st = c => Bot.stats(c, defOf(c.id));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Archangel Elspeth −2: two counters, and it becomes a flying Angel', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  Bot.runEffect(game, 'Put two +1/+1 counters on target creature. It becomes an Angel in addition to its other types and gains flying.', ctx(game, { self: { name: 'Archangel Elspeth' } }));
  assert.equal(bear.counters['+1/+1'], 2);
  assert.ok(Bot.cardFits(bear, 'angel'));
  assert.ok(st(bear).kw.has('flying'));
});

test("Ajani, Inspiring Leader −3: the creature is exiled and its controller gains 2 life", () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, 'Exile target creature. Its controller gains 2 life.', ctx(game, { self: { name: 'Ajani' } }));
  assert.equal(giant.zone, 'exile');
  assert.equal(game.oppLife, 42);
});

test('Angelic Guardian: your attackers gain indestructible', () => {
  const game = vsOpp();
  put(game, 'Angelic Guardian');
  const bear = put(game, 'Bear');
  bear.attacking = true;
  Bot.attackWatch(game, game, defOf, ctx(game), [bear]);
  assert.ok(st(bear).kw.has('indestructible'));
});

test('Ajani, Outland Chaperone −8 puts the cheap permanents from the top X cards onto the battlefield', () => {
  const game = vsOpp();
  game.life = 3;
  const top = game.zones.library.slice(0, 3).map(i => game.cards[i]);
  Bot.runEffect(game, 'Look at the top X cards of your library, where X is your life total. You may put any number of nonland permanent cards with mana value 3 or less from among them onto the battlefield. Then shuffle.', ctx(game, { self: { name: 'Ajani' } }));
  const fit = top.filter(c => !Game.isLand(c) && !/instant|sorcery/i.test(c.typeLine) && (defOf(c.id).cmc || 0) <= 3);
  fit.forEach(c => assert.equal(c.zone, 'battlefield', c.name));
});

test('Glorious Enforcer gets double strike only while you have more life', () => {
  const game = vsOpp();
  const cond = 'you have more life than an opponent';
  game.life = 41;
  assert.equal(Bot.condition(game, cond, ctx(game)), true);
  game.life = 40;
  assert.equal(Bot.condition(game, cond, ctx(game)), false);
});

test("Fiendslayer Paladin can't be targeted by Opp's red spell", () => {
  const game = vsOpp();
  const paladin = put(game, 'Fiendslayer Paladin');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.canTarget({ action: 'damage', n: 3, what: 'creature', colors: ['R'] }, paladin, st(paladin), false, true), false);
  assert.equal(Bot.canTarget({ action: 'damage', n: 3, what: 'creature', colors: ['W'] }, paladin, st(paladin), false, true), true);
});

test('Arcbound Mouser (modular): its counters move to an artifact creature when it dies', () => {
  const game = vsOpp();
  const mouser = put(game, 'Arcbound Mouser');
  Game.counter(game, mouser.iid, '+1/+1', 1);
  const other = put(game, 'Bear');
  other.typeLine = 'Artifact Creature — Bear';
  Game.move(game, mouser.iid, 'graveyard');
  Bot.afterDeath(game, game, mouser, { counters: { '+1/+1': 1 } }, defOf, ctx(game));
  assert.equal(other.counters['+1/+1'], 1);
});

test('Elspeth Tirel −5 destroys everything but lands, tokens and herself', () => {
  const game = vsOpp();
  const elspeth = put(game, 'Elspeth Tirel');
  const giant = put(game.bot.s, 'Giant');
  const plains = put(game, 'Plains');
  Bot.runEffect(game, 'Create three 1/1 white Soldier creature tokens.', ctx(game, { self: elspeth }));
  Bot.runEffect(game, 'Destroy all other permanents except for lands and tokens.', ctx(game, { self: elspeth }));
  assert.equal(giant.zone, 'graveyard');
  assert.equal(elspeth.zone, 'battlefield');
  assert.equal(plains.zone, 'battlefield');
  assert.equal(ids(game).filter(c => c.token).length, 3);
});

test('Holy Cow gains 2 life and scries 1', () => {
  const game = vsOpp();
  const left = Bot.runEffect(game, 'you gain 2 life and scry 1', ctx(game, { self: { name: 'Holy Cow' } }));
  assert.deepEqual(left, []);
  assert.equal(game.life, 42);
});

test('Elspeth, Storm Slayer 0: flying lasts through the next turn', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  Bot.runEffect(game, 'Put a +1/+1 counter on each creature you control. Those creatures gain flying until your next turn.', ctx(game, { self: { name: 'Elspeth' } }));
  Game.endOfTurn(game);
  assert.ok(st(bear).kw.has('flying'));
  Game.nextTurn(game);
  assert.ok(!st(bear).kw.has('flying'));
});

test('Enduring Innocence comes back as an enchantment, not a creature', () => {
  const game = vsOpp();
  const inn = put(game, 'Enduring Innocence');
  Game.move(game, inn.iid, 'graveyard');
  Game.move(game, inn.iid, 'battlefield', { put: true });
  Bot.runEffect(game, "It's an enchantment.", ctx(game, { self: inn }));
  assert.equal(Game.isCreature(inn), false);
  Game.move(game, inn.iid, 'hand');
  assert.equal(Game.isCreature(inn), true);
});

test('Serra the Benevolent +2 pumps only your flyers', () => {
  const game = vsOpp();
  const angel = put(game, 'Angelic Guardian');
  const bear = put(game, 'Bear');
  Bot.runEffect(game, 'Creatures you control with flying get +1/+1 until end of turn.', ctx(game, { self: { name: 'Serra' } }));
  assert.equal(st(angel).pow, 6);
  assert.equal(st(bear).pow, 2);
});

test('Akroma, Vision of Ixidor: +1/+1 for each listed keyword', () => {
  const game = vsOpp();
  const akroma = put(game, 'Akroma, Vision of Ixidor');
  const paladin = put(game, 'Fiendslayer Paladin'); // first strike, lifelink
  Bot.runEffect(game, cards['Akroma, Vision of Ixidor'].oracle.split('\n')[1].replace(/^at the beginning of each combat, /i, ''), ctx(game, { self: akroma }));
  assert.equal(st(paladin).pow, 4);
  assert.equal(st(akroma).pow, 6);
});

test('Ajani, Strength of the Pride 0 needs 15 life more than you started with', () => {
  const game = vsOpp();
  const ajani = put(game, 'Ajani, Strength of the Pride');
  const giant = put(game.bot.s, 'Giant');
  const text = 'If you have at least 15 life more than your starting life total, exile Ajani and each artifact and creature your opponents control.';
  game.life = 30; // this test game has no commander: it started at 20
  Bot.runEffect(game, text, ctx(game, { self: ajani }));
  assert.equal(giant.zone, 'battlefield');
  game.life = 35;
  Bot.runEffect(game, text, ctx(game, { self: ajani }));
  assert.equal(giant.zone, 'exile');
  assert.equal(ajani.zone, 'exile');
});

test('Angelic Cub grows the first time each turn it is targeted', () => {
  const game = vsOpp();
  const cub = put(game, 'Angelic Cub');
  Bot.applyTarget(game, game, cub, { action: 'pump', what: 'creature', pow: 0, tou: 0, kw: [] }, 'Test', defOf);
  Bot.applyTarget(game, game, cub, { action: 'pump', what: 'creature', pow: 0, tou: 0, kw: [] }, 'Test', defOf);
  assert.equal(cub.counters['+1/+1'], 1);
});

test("Ajani Goldmane −6: an Avatar as big as your life total", () => {
  const game = vsOpp();
  Bot.runEffect(game, 'Create a white Avatar creature token. It has "This token\'s power and toughness are each equal to your life total."', ctx(game, { self: { name: 'Ajani Goldmane' } }));
  const avatar = ids(game).find(c => /Avatar/.test(c.name));
  assert.ok(avatar);
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(avatar, avatar.bot || defOf(avatar.id) || {}).pow, 40);
});
