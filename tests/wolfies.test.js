// The "Wolfies" deck (Sarulf, Realm Eater; archidekt.com/decks/27811522): every card done for you, and the Wolf rules it brought
// (Head of the Hunt, Sarulf, soulbond, Cemetery Prowler, …) played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { decks, cards } = require('./wolfies-cards.json');
const basics = {
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
  Opt: { id: 'Opt', name: 'Opt', typeLine: 'Instant', manaCost: '{U}', cmc: 1, oracle: 'Scry 1. Draw a card.', colors: ['U'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const pool = ['Sarulf, Realm Eater', 'Head of the Hunt', 'Nightpack Ambusher', "Chief Warg's Company", 'Duskwatch Hunter', 'Wolfir Silverheart',
  'Cemetery Prowler', 'Somberwald Alpha', 'Moonlight Hunt', "Predator's Howl", ...Object.keys(basics)].filter(id => defs[id]);
const vsOpp = () => {
  const game = Game.create(deck('You', pool), defs);
  game.bot = Bot.create(deck('Opp', pool), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const toGrave = (s, id) => { const iid = find(s, id, ['library', 'hand']); Game.move(s, iid, 'graveyard'); return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const tokens = s => s.zones.battlefield.map(i => s.cards[i]).filter(c => c.token);
const pt = c => { const st = Bot.stats(c, defOf(c.id)); return `${st.pow}/${st.tou}`; };
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in Wolfies is done for you', () => {
  for (const id of decks.Wolfies) {
    const r = Coverage.check(cards[id]);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('"Other Wolves and Werewolves you control get +1/+1" counts Wolves (Nightpack Ambusher)', () => {
  const game = vsOpp();
  put(game, 'Nightpack Ambusher');
  const hunter = put(game, 'Duskwatch Hunter');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(pt(hunter), '4/2');
  assert.equal(pt(bear), '2/2');
});

test("Head of the Hunt exiles the opponent's dying creatures, tokens too, and makes a Wolf each time", () => {
  const game = vsOpp();
  put(game, 'Head of the Hunt');
  Game.hooks.wouldDie = (s, inst) => Bot.wouldDie(game, s, inst, defOf);
  const s = game.bot.s;
  const bear = put(s, 'Bear');
  Game.move(s, bear.iid, 'graveyard');
  assert.equal(bear.zone, 'exile');
  assert.equal(tokens(game).filter(c => /wolf/i.test(c.name)).length, 1);
  const mine = put(game, 'Giant');
  Game.move(game, mine.iid, 'graveyard');
  assert.equal(mine.zone, 'graveyard', 'only the opponent\'s');
});

test("Chief Warg's Company can't attack without two other Wolves; Duskwatch Hunter can't be blocked by tokens", () => {
  const game = vsOpp();
  const chief = put(game, "Chief Warg's Company");
  const hunter = put(game, 'Duskwatch Hunter');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(chief, defOf(chief.id)).kw.has("can't attack"));
  put(game, 'Nightpack Ambusher');
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.stats(chief, defOf(chief.id)).kw.has("can't attack"));
  const s = game.bot.s;
  const giant = put(s, 'Giant');
  const atk = Bot.stats(hunter, defOf(hunter.id));
  assert.equal(Bot.canBlock(Bot.stats(giant, defOf('Giant')), atk, game), true);
  giant.token = true;
  assert.equal(Bot.canBlock(Bot.stats(giant, defOf('Giant')), atk, game), false);
});

test("Sarulf removes its counters to exile each other nonland permanent with mana value up to that many", () => {
  const game = vsOpp();
  const sarulf = put(game, 'Sarulf, Realm Eater');
  sarulf.counters = { '+1/+1': 3 };
  const s = game.bot.s;
  const bear = put(s, 'Bear');
  const giant = put(s, 'Giant');
  Bot.runEffect(game, 'you may remove all +1/+1 counters from this creature to exile each other nonland permanent with mana value up to that many', ctx(game, { self: sarulf }));
  assert.equal(bear.zone, 'exile');
  assert.equal(giant.zone, 'battlefield');
  assert.equal(sarulf.zone, 'battlefield');
  assert.equal(sarulf.counters['+1/+1'], 0);
});

test("Predator's Howl makes three Wolves if a creature died this turn (morbid), else one", () => {
  const oracle = cards["Predator's Howl"].oracle;
  const game = vsOpp();
  Bot.runEffect(game, oracle, ctx(game));
  assert.equal(tokens(game).length, 1);
  const g2 = vsOpp();
  g2.deathsThisTurn = ['Grizzly Bears'];
  Bot.runEffect(g2, oracle, ctx(g2));
  assert.equal(tokens(g2).length, 3);
});

test('Wolfir Silverheart pairs with another creature (soulbond): both get +4/+4', () => {
  const game = vsOpp();
  const wolfir = put(game, 'Wolfir Silverheart');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(pt(wolfir), '8/8');
  assert.equal(pt(bear), '6/6');
  // Paired by hand (app.js's "Pair with…"): the one you picked keeps it, even if it's smaller.
  const hunter = put(game, 'Duskwatch Hunter');
  delete bear.pairedWith;
  wolfir.pairedWith = hunter.iid;
  hunter.pairedWith = wolfir.iid;
  Bot.refreshGrants(game, defOf);
  assert.equal(pt(hunter), '7/5');
  assert.equal(pt(bear), '2/2');
  // Unpaired by hand: no bonus until you pair it again.
  delete wolfir.pairedWith;
  delete hunter.pairedWith;
  wolfir.noPair = true;
  Bot.refreshGrants(game, defOf);
  assert.equal(pt(wolfir), '4/4');
});

test("Cemetery Prowler exiles a graveyard card, and spells sharing its card type cost {1} less", () => {
  const game = vsOpp();
  const prowler = put(game, 'Cemetery Prowler');
  const dead = toGrave(game.bot.s, 'Bear');
  Bot.runEffect(game, 'exile a card from a graveyard with this creature', ctx(game, { self: prowler }));
  assert.equal(dead.zone, 'exile');
  const giant = game.cards[find(game, 'Giant')];
  const opt = game.cards[find(game, 'Opt')];
  assert.equal(Bot.selfDiscount(game, giant, defOf, game.bot.s), 1);
  assert.equal(Bot.selfDiscount(game, opt, defOf, game.bot.s), 0);
});

test('Somberwald Alpha pumps a blocked creature; Moonlight Hunt has the Wolves deal their power', () => {
  const game = vsOpp();
  put(game, 'Somberwald Alpha');
  const bear = put(game, 'Bear');
  Bot.becameBlocked(game, bear, 1, defOf);
  assert.equal(pt(bear), '3/3');
  const giant = put(game.bot.s, 'Giant');
  Bot.runEffect(game, cards['Moonlight Hunt'].oracle, ctx(game));
  assert.notEqual(giant.zone, 'battlefield');
});
