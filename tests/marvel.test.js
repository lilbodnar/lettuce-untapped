// The Marvel Commander decks (Avengers Assemble so far), played out against Opp: Thor's extra damage,
// Heroic Sacrifice, evasion, Hero triggers, and the deck's discounts and counters.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./marvel-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Mountain: { id: 'Mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
  Hero: { id: 'Hero', name: 'Plucky Hero', typeLine: 'Creature — Human Hero', manaCost: '{1}{W}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['W'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const rows = () => Object.keys(defs).map(id => ({ id, qty: basics[id] ? 8 : 1 }));
const vsOpp = () => {
  const game = Game.create(deck('You', rows()), defs);
  game.bot = Bot.create(deck('Opp', rows()), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, hitTarget: n => { game.oppLife -= n; }, other: game.bot.s, defOf,
  oppsDraw: n => Game.drawCards(game.bot.s, n, true), oppsDiscard: n => Bot.oppDiscards(game, n, false, 'test'),
  oppsSacrifice: (n, what) => Bot.oppSacrifices(game, n, 'test', what),
  target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const st = inst => Bot.stats(inst, inst.bot || defOf(inst.id));
const named = (s, name) => s.zones.battlefield.map(i => s.cards[i]).filter(c => c.name === name);
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in Avengers Assemble is done for you', () => {
  for (const d of Object.values(cards)) {
    const r = Coverage.check(d);
    assert.equal(r.you, 'all', `${d.name}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test("Thor: your other sources deal 1 more damage to Opp and Opp's creatures", () => {
  const game = vsOpp();
  put(game, "Thor, Asgard's Avenger");
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.hitOf(st(bear)), 3, 'combat damage 2 + 1');
  Bot.damagePlayer(game, 'opp', 2, 'Shock', defOf);
  assert.equal(game.oppLife, 37);
  const giant = put(game.bot.s, 'Giant');
  Bot.applyTarget(game, game.bot.s, giant, { action: 'damage', n: 2, what: 'creature' }, 'Shock', defOf, game);
  assert.equal(giant.zone, 'graveyard', '2 + 1 kills a 4/3');
});

test("Ant-Man can't be blocked by bigger creatures; Speed's target only by creatures with haste", () => {
  const game = vsOpp();
  const ant = put(game, 'Ant-Man, Elusive Avenger');
  Bot.refreshGrants(game, defOf);
  const big = { pow: 4, tou: 3, kw: new Set() };
  const small = { pow: 1, tou: 1, kw: new Set() };
  assert.equal(Bot.canBlock(big, st(ant)), false);
  assert.equal(Bot.canBlock(small, st(ant)), true);
  const bear = put(game, 'Bear');
  Bot.applyTarget(game, game, bear, { action: 'pump', what: 'creature', pow: 0, tou: 0, kw: ['evade lacking haste'] }, 'Speed', defOf, game);
  assert.equal(Bot.canBlock(small, st(bear)), false);
  assert.equal(Bot.canBlock({ ...small, kw: new Set(['haste']) }, st(bear)), true);
});

test('Raise the Palisade returns every creature not of the chosen type', () => {
  const game = vsOpp();
  put(game, 'Hero');
  const bear = put(game, 'Bear');
  put(game, 'Hero');
  const giant = put(game.bot.s, 'Giant');
  const spell = game.cards[find(game, 'Raise the Palisade')];
  Bot.runEffect(game, 'Choose a creature type. Return all creatures that aren\'t of the chosen type to their owners\' hands.', ctx(game, { self: spell }));
  assert.ok(['human', 'hero'].includes(String(spell.chosenType).toLowerCase()));
  assert.equal(bear.zone, 'hand');
  assert.equal(giant.zone, 'hand');
  assert.ok(named(game, 'Plucky Hero').length >= 1);
});

test('Heroic Sacrifice: damage to you and your creatures goes to the chosen one; its counters move when it dies', () => {
  const game = vsOpp();
  const giant = put(game, 'Giant');
  const bear = put(game, 'Bear');
  Game.counter(game, giant.iid, '+1/+1', 2);
  const spell = game.cards[find(game, 'Heroic Sacrifice')];
  Bot.runEffect(game, cards['Heroic Sacrifice'].oracle, ctx(game, { self: spell }));
  assert.equal(game.redirect.iid, giant.iid, 'Opp-style pick: the toughest');
  Bot.damagePlayer(game, 'you', 3, "Opp's Lightning Bolt", defOf);
  assert.equal(game.life, 40, 'you took none');
  assert.equal(giant.zone, 'battlefield', '3 damage on a 6/5');
  Game.hooks.died = (s, inst, info) => Bot.died(s, inst, defOf, ctx(game), game, info);
  Bot.applyTarget(game, game, bear, { action: 'damage', n: 3, what: 'creature' }, "Opp's Lightning Bolt", defOf, game.bot.s);
  assert.equal(bear.zone, 'battlefield', 'the bear took none');
  assert.equal(giant.zone, 'graveyard', '6 damage kills it');
  assert.equal(bear.counters['+1/+1'], 2, 'its counters went on the bear');
});

test('Shang-Chi draws five and gains 5 life with its tenth +1/+1 counter', () => {
  const game = vsOpp();
  const shang = put(game, 'Shang-Chi and the Ten Rings');
  Game.hooks.counters = (s, inst, kind, n) => Bot.countersPut(game, s, inst, kind, n, defOf, ctx(game));
  Game.counter(game, shang.iid, '+1/+1', 9);
  const hand = game.zones.hand.length;
  const life = game.life;
  Game.counter(game, shang.iid, '+1/+1', 1);
  assert.equal(game.zones.hand.length, hand + 5);
  assert.equal(game.life, life + 5);
  Game.counter(game, shang.iid, '+1/+1', 1);
  assert.equal(game.zones.hand.length, hand + 5, 'only the tenth');
});

test('Hercules grows only the first time it is dealt damage each turn', () => {
  const game = vsOpp();
  const herc = put(game, 'Hercules, Olympian Hero');
  Bot.creatureDamaged(game, game, herc, 2, defOf, ctx(game));
  assert.equal(herc.counters['+1/+1'], 2);
  Bot.creatureDamaged(game, game, herc, 1, defOf, ctx(game));
  assert.equal(herc.counters['+1/+1'], 2);
});

test('Door of Destinies: charge counters for spells of the chosen type, +1/+1 each', () => {
  const game = vsOpp();
  const door = put(game, 'Door of Destinies');
  door.chosenType = 'hero';
  const hero = put(game, 'Hero');
  const bear = put(game, 'Bear');
  const spell = game.cards[find(game, 'Hero')];
  Bot.spellCast(game, game, spell, defOf, ctx(game));
  assert.equal(door.counters.charge, 1);
  Bot.refreshGrants(game, defOf);
  assert.equal(st(hero).pow, 3);
  assert.equal(st(bear).pow, 2);
});

test('Hulkbuster Armor makes the equipped creature a 9/9 flier', () => {
  const game = vsOpp();
  const armor = put(game, 'Hulkbuster Armor');
  const bear = put(game, 'Bear');
  Game.attach(game, armor.iid, bear.iid, Bot.attachBonus(cards['Hulkbuster Armor'].oracle));
  const s = st(bear);
  assert.equal(s.pow, 9);
  assert.equal(s.tou, 9);
  assert.ok(s.kw.has('flying'));
});

test("Winter Soldier returns a creature card with mana value up to its power; a Hero gets a counter", () => {
  const game = vsOpp();
  const ws = put(game, 'Winter Soldier, Reborn Avenger');
  const giant = find(game, 'Giant');
  const hero = find(game, 'Hero');
  Game.move(game, giant, 'graveyard');
  Game.move(game, hero, 'graveyard');
  Bot.runEffect(game, 'return target creature card with mana value less than or equal to Winter Soldier\'s power from your graveyard to the battlefield. If a Hero enters this way, it enters with an additional +1/+1 counter on it.', ctx(game, { self: ws }));
  assert.equal(game.cards[giant].zone, 'graveyard', 'mana value 4 is more than its power 3');
  assert.equal(game.cards[hero].zone, 'battlefield');
  assert.equal(game.cards[hero].counters['+1/+1'], 1);
});

test('Captain America, Team Leader: an entering Hero gets haste and a counter, and so does he', () => {
  const game = vsOpp();
  const cap = put(game, 'Captain America, Team Leader');
  const hero = put(game, 'Hero');
  Bot.creatureEntered(game, hero, defOf, ctx(game));
  assert.ok(st(hero).kw.has('haste'));
  assert.equal(hero.counters['+1/+1'], 1);
  assert.equal(cap.counters['+1/+1'], 1);
  assert.ok(!st(cap).kw.has('haste') || /haste/i.test(cards['Captain America, Team Leader'].oracle.split('\n')[0]), 'the haste went on the Hero');
});

test('Gift of Immortality brings the creature back, then itself at the next end step', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const gift = put(game, 'Gift of Immortality');
  Game.attach(game, gift.iid, bear.iid, Bot.attachBonus(cards['Gift of Immortality'].oracle));
  Game.hooks.died = (s, inst, info) => Bot.died(s, inst, defOf, ctx(game), game, info);
  Game.move(game, bear.iid, 'graveyard');
  assert.equal(bear.zone, 'battlefield');
  assert.equal(gift.zone, 'graveyard');
  Bot.runAtEnd(game, defOf, ctx(game));
  assert.equal(gift.zone, 'battlefield');
  assert.equal(gift.attachedTo, bear.iid);
});

test('Vision triggers only on spells cast outside their caster\'s turn', () => {
  const game = vsOpp();
  const vision = put(game, 'Vision, Synthezoid Avenger');
  const s = game.bot.s;
  const bear = s.cards[find(s, 'Bear')];
  delete s.offTurn;
  Bot.spellCast(game, s, bear, defOf, null);
  assert.ok(!vision.counters['+1/+1'] && !vision.phasedOut, 'Opp cast it on its own turn');
  s.offTurn = true;
  Bot.spellCast(game, s, bear, defOf, null);
  assert.ok(vision.counters['+1/+1'] === 1 || vision.phasedOut, 'a mode was picked');
});

test('Relic of Legends: an untapped legendary creature taps for mana', () => {
  const game = vsOpp();
  game.zones.battlefield.filter(i => Game.isLand(game.cards[i])).forEach(i => Game.move(game, i, 'hand'));
  put(game, 'Relic of Legends');
  const thor = put(game, "Thor, Asgard's Avenger");
  const copy = JSON.parse(JSON.stringify(game));
  assert.ok(Game.autoPay(copy, '{R}{U}'), 'the Relic and Thor');
  Game.autoPay(game, '{R}{U}');
  assert.equal(thor.tapped, true);
});

test('Jocasta returns attacking with your commander, and grows when it hits', () => {
  const game = vsOpp();
  const cmd = put(game, 'Hero');
  cmd.commander = true;
  const jocasta = find(game, 'Jocasta, Automaton Avenger');
  Game.move(game, jocasta, 'graveyard');
  const joined = Bot.declareAttack(game, [cmd], defOf, { game, ctx: ctx(game) });
  assert.equal(game.cards[jocasta].zone, 'battlefield');
  assert.ok(joined.some(([, iid]) => iid === jocasta));
  Bot.combatDamage(game, [{ inst: cmd, st: st(cmd), card: defOf(cmd.id), dmg: 2 }], defOf, ctx(game));
  assert.equal(game.cards[jocasta].counters['+1/+1'], 1);
});

test('She-Hulk: a blocked Hero gets a counter for each blocker', () => {
  const game = vsOpp();
  put(game, 'She-Hulk, Wallbreaker');
  const hero = put(game, 'Hero');
  Bot.becameBlocked(game, hero, 2, defOf);
  assert.equal(hero.counters['+1/+1'], 2);
});

test('Love on the Battlefield: exactly two attackers gain first strike and you draw', () => {
  const game = vsOpp();
  put(game, 'Love on the Battlefield');
  const a = put(game, 'Bear');
  const b = put(game, 'Hero');
  const hand = game.zones.hand.length;
  Bot.attackWatch(game, game, defOf, ctx(game), [a, b]);
  assert.ok(st(a).kw.has('first strike') && st(b).kw.has('first strike'));
  assert.equal(game.zones.hand.length, hand + 1);
  Bot.combatDamage(game, [{ inst: a, st: st(a), card: defOf(a.id), dmg: 2 }], defOf, ctx(game));
  assert.equal(a.counters['+1/+1'], 1);
});

test('Avenge costs {2} less after Opp attacked you; Heroic Return when a creature is attacking you', () => {
  const game = vsOpp();
  const avenge = game.cards[find(game, 'Avenge')];
  assert.equal(Bot.selfDiscount(game, avenge, defOf), 0);
  game.bot.s.attackedYou = true;
  assert.equal(Bot.selfDiscount(game, avenge, defOf), 2);
  const ret = game.cards[find(game, 'Heroic Return')];
  assert.equal(Bot.selfDiscount(game, ret, defOf), 0);
  game.attackersNow = 1;
  assert.equal(Bot.selfDiscount(game, ret, defOf), 2);
});

test('Folk Hero: your commander draws when you cast a spell sharing a creature type, once a turn', () => {
  const game = vsOpp();
  put(game, 'Folk Hero');
  const cmd = put(game, 'Hero');
  cmd.commander = true;
  Bot.refreshGrants(game, defOf);
  const hand = game.zones.hand.length;
  const spell = game.cards[find(game, 'Captain America, Team Leader')];
  Bot.spellCast(game, game, spell, defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 1);
  Bot.spellCast(game, game, spell, defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 1, 'once each turn');
});
