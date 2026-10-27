// The Commander's Arsenal decks (Token Triumph, Draconic Destruction, Grave Danger) and March of the Machine's Cavalry Charge and Growing
// Threat: their last cards, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./scd-moc-cards.json');
const basics = {
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Human Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Roc: { id: 'Roc', name: 'Roc', typeLine: 'Creature — Bird', manaCost: '{2}{W}', cmc: 3, power: '2', toughness: '2', oracle: 'Flying', colors: ['W'] },
  Knight: { id: 'Knight', name: 'Knight', typeLine: 'Creature — Human Knight', manaCost: '{1}{W}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['W'] },
  Relic: { id: 'Relic', name: 'Relic', typeLine: 'Artifact', manaCost: '{1}', cmc: 1, oracle: '', colors: [] },
  Idol: { id: 'Idol', name: 'Idol', typeLine: 'Artifact', manaCost: '{5}', cmc: 5, oracle: '', colors: [] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: /^(Mountain|Forest)$/.test(id) ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const toGrave = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'graveyard'); return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const ids = s => s.zones.battlefield.map(i => s.cards[i]);
const st = c => Bot.stats(c, defOf(c.id));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every one of these cards is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Citywide Bust destroys only creatures with toughness 4 or greater', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const bear = put(game, 'Bear');
  Bot.runEffect(game, cards['Citywide Bust'].oracle, ctx(game, { self: { name: 'Citywide Bust' } }));
  assert.equal(giant.zone, 'graveyard');
  assert.equal(bear.zone, 'battlefield');
});

test("Champion of Lambholt: creatures with less power than it can't block yours", () => {
  const game = vsOpp();
  const champ = put(game, 'Champion of Lambholt');
  Game.counter(game, champ.iid, '+1/+1', 2); // a 3/3
  const bear = put(game, 'Bear');
  const roc = put(game.bot.s, 'Roc');
  const giant = put(game.bot.s, 'Giant');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.canBlock(st(roc), st(bear), game), false); // power 2
  assert.equal(Bot.canBlock(st(giant), st(bear), game), true); // power 4
});

test('Akoum Hellkite deals 2 for a Mountain, 1 for any other land', () => {
  const effect = 'this creature deals 1 damage to any target. If that land is a Mountain, this creature deals 2 damage instead.';
  assert.match(Bot.parts.landfallText(effect, { typeLine: 'Basic Land — Mountain' }), /deals 2 damage to any target/);
  assert.match(Bot.parts.landfallText(effect, { typeLine: 'Basic Land — Forest' }), /deals 1 damage to any target/);
});

test('Flameblast Dragon pays the most X it can', () => {
  const game = vsOpp();
  const dragon = put(game, 'Flameblast Dragon');
  for (let i = 0; i < 4; i++) put(game, 'Mountain');
  Bot.runEffect(game, 'you may pay {X}{R}. If you do, it deals X damage to any target.', ctx(game, { self: dragon }));
  assert.equal(ids(game).filter(c => c.id === 'Mountain' && c.tapped).length, 4);
  assert.equal(game.oppLife, 37);
});

test("Unleash Fury doubles a creature's power", () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  Bot.runEffect(game, cards['Unleash Fury'].oracle, ctx(game, { self: { name: 'Unleash Fury' } }));
  assert.equal(st(giant).pow, 8);
});

test("Thundermaw Hellkite deals 1 to the opponent's flyers and taps them", () => {
  const game = vsOpp();
  const roc = put(game.bot.s, 'Roc');
  const giant = put(game.bot.s, 'Giant');
  const hk = put(game, 'Thundermaw Hellkite');
  Bot.runEffect(game, 'it deals 1 damage to each creature with flying your opponents control. Tap those creatures.', ctx(game, { self: hk }));
  assert.equal(roc.damageTaken, 1);
  assert.equal(roc.tapped, true);
  assert.equal(giant.tapped, false);
});

test('Foe-Razer Regent: a creature of yours that fights gets two +1/+1 counters at the next end step', () => {
  const game = vsOpp();
  put(game, 'Foe-Razer Regent');
  const giant = put(game, 'Giant');
  const bear = put(game.bot.s, 'Bear');
  Bot.fightOn(game, game, giant, game.bot.s, bear, defOf);
  assert.equal(bear.zone, 'graveyard');
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(giant.counters['+1/+1'], 2);
});

test('Undermine makes the countered spell\'s controller lose 3 life', () => {
  const game = vsOpp();
  Bot.counterExtras(game, game, game.bot.s, cards.Undermine.oracle, 'Undermine');
  assert.equal(game.oppLife, 37);
});

test('Gisa and Geralf and Liliana let Zombie spells be cast from the graveyard', () => {
  const game = vsOpp();
  const horde = toGrave(game, 'Unbreathing Horde');
  const bear = toGrave(game, 'Bear');
  assert.equal(Bot.graveCast(game, horde, defOf), false);
  const gisa = put(game, 'Gisa and Geralf');
  assert.equal(Bot.graveCast(game, horde, defOf), true);
  assert.equal(Bot.graveCast(game, bear, defOf), false);
  game.graveOnceTurn = game.turn; // used this turn
  assert.equal(Bot.graveCast(game, horde, defOf), false);
  Game.move(game, gisa.iid, 'graveyard');
  Bot.runEffect(game, 'You may cast Zombie spells from your graveyard this turn.', ctx(game, { self: { name: 'Liliana' } }));
  assert.equal(Bot.graveCast(game, horde, defOf), true);
});

test('Laboratory Drudge sees a spell cast from a graveyard this turn', () => {
  const game = vsOpp();
  const cond = "you've cast a spell from a graveyard or activated an ability of a card in a graveyard this turn";
  assert.equal(Bot.condition(game, cond, ctx(game)), false);
  game.spellTurn = game.turn;
  game.castThisTurn = [{ typeLine: 'Creature', from: 'graveyard' }];
  assert.equal(Bot.condition(game, cond, ctx(game)), true);
});

test('Unbreathing Horde loses a +1/+1 counter instead of taking damage', () => {
  const game = vsOpp();
  const horde = put(game, 'Unbreathing Horde');
  Game.counter(game, horde.iid, '+1/+1', 3);
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'it deals 2 damage to each creature', ctx(game, { self: { name: 'Test' } }));
  assert.equal(horde.zone, 'battlefield');
  assert.equal(horde.counters['+1/+1'], 2);
});

test('Crippling Fear spares the chosen type (your best one)', () => {
  const game = vsOpp();
  const k1 = put(game, 'Knight');
  const k2 = put(game, 'Giant'); // a Human too
  const roc = put(game.bot.s, 'Roc');
  Bot.runEffect(game, cards['Crippling Fear'].oracle, ctx(game, { self: { name: 'Crippling Fear' } }));
  assert.equal(st(k1).pow, 2);
  assert.equal(st(k2).pow, 4);
  assert.equal(st(roc).tou, -1);
});

test('Grimoire of the Dead brings back every creature card as a black Zombie', () => {
  const game = vsOpp();
  const bear = toGrave(game, 'Bear');
  toGrave(game.bot.s, 'Giant');
  Bot.runEffect(game, 'Put all creature cards from all graveyards onto the battlefield under your control. They\'re black Zombies in addition to their other colors and types.', ctx(game, { self: { name: 'Grimoire of the Dead' } }));
  assert.equal(bear.zone, 'battlefield');
  const giant = ids(game).find(c => c.name === 'Hill Giant');
  assert.ok(giant, "Opp's Giant is yours now");
  assert.ok(Bot.cardFits(giant, 'zombie'));
});

test('Horsemanship: only a creature with horsemanship can block it', () => {
  const game = vsOpp();
  put(game, 'Herald of Hoofbeats');
  const knight = put(game, 'Knight');
  const bear = put(game.bot.s, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.canBlock(st(bear), st(knight), game), false);
});

test('Knights of the Black Rose: the opponent who takes the crown loses 2 and you gain 2', () => {
  const game = vsOpp();
  put(game, 'Knights of the Black Rose');
  game.monarch = Date.now();
  Bot.takeMonarch(game, 'opp');
  assert.equal(Bot.monarchOf(game), 'opp');
  assert.equal(game.oppLife, 38);
  assert.equal(game.life, 42);
});

test('Cataclysmic Gearhulk: each player keeps one of each type and sacrifices the rest', () => {
  const game = vsOpp();
  const gear = put(game, 'Cataclysmic Gearhulk');
  const giant = put(game, 'Giant');
  const bear = put(game, 'Bear');
  const relic = put(game, 'Relic');
  Bot.runEffect(game, 'each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest.', ctx(game, { self: gear }));
  assert.equal(gear.zone, 'battlefield');
  assert.equal(giant.zone, 'battlefield');
  assert.equal([bear, relic].filter(c => c.zone === 'graveyard').length, 2);
});

test('Scrap Trawler returns an artifact card with lesser mana value', () => {
  const game = vsOpp();
  const relic = toGrave(game, 'Relic');
  const idol = toGrave(game, 'Idol');
  const dead = toGrave(game, 'Scrap Trawler'); // mana value 3
  Bot.runEffect(game, 'return to your hand target artifact card in your graveyard with lesser mana value', ctx(game, { self: dead, dead }));
  assert.equal(relic.zone, 'hand');
  assert.equal(idol.zone, 'graveyard');
});

test("Sculpting Steel (Opp's) copies the best artifact", () => {
  const game = vsOpp();
  put(game, 'Idol');
  const steel = put(game.bot.s, 'Sculpting Steel');
  Bot.autoCopy(game, game.bot.s, steel, defOf);
  assert.equal(steel.name, 'Idol');
});

test("Excise the Imperfect: its controller incubates its mana value", () => {
  const game = vsOpp();
  const idol = put(game.bot.s, 'Idol');
  Bot.runEffect(game, cards['Excise the Imperfect'].oracle, ctx(game, { self: { name: 'Excise the Imperfect' } }));
  assert.equal(idol.zone, 'exile');
  const inc = ids(game.bot.s).find(c => c.name === 'Incubator');
  assert.ok(inc);
  assert.equal(inc.counters['+1/+1'], 5);
});

test('Keskit puts two of the top three into your hand and the other into your graveyard', () => {
  const game = vsOpp();
  const hand = game.zones.hand.length;
  const grave = game.zones.graveyard.length;
  Bot.runEffect(game, 'Look at the top three cards of your library. Put two of them into your hand and the other into your graveyard.', ctx(game, { self: { name: 'Keskit' } }));
  assert.equal(game.zones.hand.length, hand + 2);
  assert.equal(game.zones.graveyard.length, grave + 1);
});

test('Ancient Stone Idol costs {1} less for each attacking creature; Dragonkin Berserker\'s boast {1} less for each Dragon', () => {
  const game = vsOpp();
  const idol = game.cards[find(game, 'Ancient Stone Idol')];
  put(game.bot.s, 'Giant').attacking = true;
  put(game.bot.s, 'Bear').attacking = true;
  assert.equal(Bot.selfDiscount(game, idol, defOf, game.bot.s), 2);
  const zerk = put(game, 'Dragonkin Berserker');
  const boast = Bot.activatedAbilities(zerk, defOf).find(a => a.onlyIf);
  assert.deepEqual(boast.lessFor, { n: 1, what: 'dragon' });
});

test("Elenda and Azor: a Vampire Knight for each card you've drawn this turn", () => {
  const game = vsOpp();
  Game.drawCards(game, 2);
  Bot.runEffect(game, "create a number of 1/1 black Vampire Knight creature tokens with lifelink equal to the number of cards you've drawn this turn", ctx(game, { self: { name: 'Elenda and Azor' } }));
  assert.equal(ids(game).filter(c => /Vampire Knight/.test(c.name)).length, 2);
});

test('Slate of Ancestry discards your hand; Aryel taps X Knights', () => {
  const game = vsOpp();
  const slate = put(game, 'Slate of Ancestry');
  assert.equal(Bot.activatedAbilities(slate, defOf)[0].discardHand, true);
  const aryel = put(game, 'Aryel, Knight of Windgrace');
  assert.ok(Bot.activatedAbilities(aryel, defOf).some(a => a.tapX === 'knight'));
});
