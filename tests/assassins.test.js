// The cards of the "Assassins" Commander deck, played out: each test does what the card says on a
// table against Opp and checks the result.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const c = (id, name, typeLine, cost, cmc, pt, oracle, extra = {}) => {
  const [power, toughness] = pt ? pt.split('/') : [];
  return { id, name, typeLine, manaCost: cost, cmc, power, toughness, oracle, ...extra };
};
const defs = {
  swamp: { id: 'swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '({T}: Add {B}.)' },
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '' },
  bear: c('bear', 'Grizzly Bears', 'Creature — Bear', '{1}{G}', 2, '2/2', ''),
  elf: c('elf', 'Llanowar Elves', 'Creature — Elf Druid', '{G}', 1, '1/1', '{T}: Add {G}.'),
  giant: c('giant', 'Hill Giant', 'Creature — Giant', '{3}{R}', 4, '3/3', ''),
  knight: c('knight', 'White Knight', 'Creature — Human Knight', '{W}{W}', 2, '2/2', 'First strike'),
  rock: c('rock', 'Mind Stone', 'Artifact', '{2}', 2, null, '{T}: Add {C}.'),
  bolt: c('bolt', 'Lightning Bolt', 'Instant', '{R}', 1, null, 'Lightning Bolt deals 3 damage to any target.'),
  nekrataal: c('nekrataal', 'Nekrataal', 'Creature — Human Assassin', '{2}{B}{B}', 4, '2/1', 'First strike\nWhen this creature enters, destroy target nonartifact, nonblack creature. That creature can\'t be regenerated.'),
  massacre: c('massacre', 'Massacre Girl', 'Legendary Creature — Human Assassin', '{3}{B}{B}', 5, '4/4', 'Menace\nWhen Massacre Girl enters, each other creature gets -1/-1 until end of turn. Whenever a creature dies this turn, each creature other than Massacre Girl gets -1/-1 until end of turn.'),
  killer: c('killer', 'Massacre Girl, Known Killer', 'Legendary Creature — Human Assassin', '{2}{B}{B}', 4, '4/4', 'Menace\nCreatures you control have wither. (They deal damage to creatures in the form of -1/-1 counters.)\nWhenever a creature an opponent controls dies, if its toughness was less than 1, draw a card.'),
  wanted: c('wanted', 'Massacre Girl, Most Wanted', 'Legendary Creature — Human Assassin', '{4}{B}', 5, '4/4', 'Whenever another creature or planeswalker you control dies, Massacre Girl deals 1 damage to target opponent and you gain 1 life.\nWhenever an opponent is dealt noncombat damage, put a +1/+1 counter on Massacre Girl.'),
  slasher: c('slasher', 'Unstoppable Slasher', 'Creature — Zombie Assassin', '{2}{B}', 3, '2/3', 'Deathtouch\nWhenever this creature deals combat damage to a player, they lose half their life, rounded up.\nWhen this creature dies, if it had no counters on it, return it to the battlefield tapped under its owner\'s control with two stun counters on it.'),
  bond: c('bond', 'Sanguine Bond', 'Enchantment', '{3}{B}{B}', 5, null, 'Whenever you gain life, target opponent loses that much life.'),
  conqueror: c('conqueror', 'Bloodthirsty Conqueror', 'Creature — Vampire Knight', '{3}{B}{B}', 5, '5/5', 'Flying, deathtouch\nWhenever an opponent loses life, you gain that much life. (Damage causes loss of life.)'),
  konrad: c('konrad', 'Syr Konrad, the Grim', 'Legendary Creature — Human Knight', '{3}{B}{B}', 5, '5/4', 'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.\n{1}{B}: Each player mills a card. (They each put the top card of their library into their graveyard.)'),
  crystal: c('crystal', 'The Darkness Crystal', 'Legendary Artifact', '{2}{B}{B}', 4, null, 'Black spells you cast cost {1} less to cast.\nIf a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.\n{4}{B}{B}, {T}: Put target creature card exiled with The Darkness Crystal onto the battlefield tapped under your control with two additional +1/+1 counters on it.'),
  blot: c('blot', 'Blot Out', 'Instant', '{2}{B}', 3, null, 'Target opponent exiles a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control.'),
  sign: c('sign', 'Sign in Blood', 'Sorcery', '{B}{B}', 2, null, 'Target player draws two cards and loses 2 life.'),
  bleed: c('bleed', 'Bleed Dry', 'Instant', '{2}{B}{B}', 4, null, 'Target creature gets -13/-13 until end of turn. If that creature would die this turn, exile it instead.'),
  thirst: c('thirst', "Astarion's Thirst", 'Instant', '{3}{B}', 4, null, 'Exile target creature. Put X +1/+1 counters on a commander creature you control, where X is the power of the creature exiled this way.'),
  interceptor: c('interceptor', "Interceptor, Shadow's Hound", 'Legendary Creature — Dog', '{2}{B}{B}', 4, '4/3', 'Menace\nAssassins you control have menace.\nWhenever you attack with one or more legendary creatures, you may pay {2}{B}. If you do, return this card from your graveyard to the battlefield tapped and attacking.'),
  agent: c('agent', 'Agent of the Shadow Thieves', 'Legendary Enchantment — Background', '{1}{B}', 2, null, 'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."'),
  mentor: c('mentor', 'Poison-Blade Mentor', 'Creature — Human Assassin', '{1}{B}', 2, '2/1', 'Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nWhenever this creature attacks, another target Assassin you control gains deathtouch until end of turn.'),
  patriarch: c('patriarch', 'Brotherhood Patriarch', 'Creature — Human Assassin', '{3}{B}', 4, '4/1', 'When this creature dies, each opponent loses 2 life and you gain 2 life.'),
  drana: c('drana', 'Drana, Liberator of Malakir', 'Legendary Creature — Vampire Ally', '{1}{B}{B}', 3, '2/3', 'Flying, first strike\nWhenever Drana deals combat damage to a player, put a +1/+1 counter on each attacking creature you control.'),
  desmond: c('desmond', 'Desmond Miles', 'Legendary Creature — Human Assassin', '{1}{B}', 2, '1/3', 'Menace\nDesmond Miles gets +1/+0 for each other Assassin you control and each Assassin card in your graveyard.\nWhenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.'),
  roshan: c('roshan', 'Roshan, Hidden Magister', 'Legendary Creature — Human Assassin', '{3}{B}', 4, '4/4', 'Other creatures you control are Assassins in addition to their other types. The same is true for creature spells you control and creature cards you own that aren\'t on the battlefield.\nFace-down creatures you control have menace.\nWhenever a permanent you control is turned face up, you draw a card and you lose 1 life.'),
  overseer: c('overseer', 'Guul Draz Overseer', 'Creature — Vampire', '{4}{B}{B}', 6, '3/4', 'Flying\nLandfall — Whenever a land you control enters, other creatures you control get +1/+0 until end of turn. If that land is a Swamp, those creatures get +2/+0 until end of turn instead.'),
  obnix: c('obnix', 'Ob Nixilis, the Fallen', 'Legendary Creature — Demon', '{3}{B}{B}', 5, '3/3', 'Landfall — Whenever a land you control enters, you may have target player lose 3 life. If you do, put three +1/+1 counters on Ob Nixilis.'),
  retreat: c('retreat', 'Retreat to Hagra', 'Enchantment', '{2}{B}', 3, null, 'Landfall — Whenever a land you control enters, choose one —\n• Target creature gets +1/+0 and gains deathtouch until end of turn.\n• Each opponent loses 1 life and you gain 1 life.'),
  junji: c('junji', 'Junji, the Midnight Sky', 'Legendary Creature — Dragon Spirit', '{3}{B}{B}', 5, '5/5', 'Flying, menace\nWhen Junji dies, choose one —\n• Each opponent discards two cards and loses 2 life.\n• Put target non-Dragon creature card from a graveyard onto the battlefield under your control. You lose 2 life.'),
  scarecrow: c('scarecrow', 'Geist-Fueled Scarecrow', 'Artifact Creature — Scarecrow', '{4}', 4, '4/4', 'Creature spells you cast cost {1} more to cast.'),
  sun: c('sun', 'The Immortal Sun', 'Legendary Artifact', '{6}', 6, null, "Players can't activate planeswalkers' loyalty abilities.\nAt the beginning of your draw step, draw an additional card.\nSpells you cast cost {1} less to cast.\nCreatures you control get +1/+1."),
  sower: c('sower', 'Nightmare Sower', 'Creature — Faerie Assassin', '{3}{B}', 4, '2/3', "Flying, lifelink\nWhenever you cast a spell during an opponent's turn, put a -1/-1 counter on up to one target creature."),
  fates: c('fates', 'Agent of the Fates', 'Creature — Human Assassin', '{1}{B}{B}', 3, '3/2', 'Deathtouch\nHeroic — Whenever you cast a spell that targets this creature, each opponent sacrifices a creature of their choice.'),
  danitha: c('danitha', 'Danitha, Spear of Agony', 'Legendary Creature — Human Knight', '{2}{B}', 3, '2/2', 'First strike\nWhenever you cast a spell that targets an opponent or a creature an opponent controls, put a +1/+1 counter on Danitha.'),
  overdrive: c('overdrive', 'Maximum Overdrive', 'Instant', '{1}{B}', 2, null, 'Put a +1/+1 counter on target creature. It gains deathtouch and indestructible until end of turn.'),
  garza: c('garza', "Garza's Assassin", 'Creature — Human Assassin', '{B}{B}{B}', 3, '2/2', 'Sacrifice this creature: Destroy target nonblack creature.\nRecover—Pay half your life, rounded up. (When another creature is put into your graveyard from the battlefield, you may pay half your life, rounded up. If you do, return this card from your graveyard to your hand. Otherwise, exile this card.)'),
  ebondeath: c('ebondeath', 'Ebondeath, Dracolich', 'Legendary Creature — Zombie Dragon', '{2}{B}{B}', 4, '5/2', 'Flash\nFlying\nEbondeath enters tapped.\nYou may cast this card from your graveyard if a creature not named Ebondeath, Dracolich died this turn.'),
  trawler: c('trawler', 'Boggart Trawler // Boggart Bog', 'Creature — Goblin // Land', '{2}{B}', 3, '3/1', "Boggart Trawler: When this creature enters, exile target player's graveyard.\n\nBoggart Bog: As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {B}.", { producedMana: ['B'] }),
  blade: c('blade', 'Hidden Blade', 'Artifact — Equipment', '{2}', 2, null, 'Flash\nWhen this Equipment enters, attach it to target creature you control. If that creature is an Assassin, it gains deathtouch until end of turn.\nEquipped creature gets +1/+0 and has first strike.\nEquip {2}'),
  rune: c('rune', 'Rune of Mortality', 'Enchantment — Aura Rune', '{1}{B}', 2, null, 'Enchant permanent\nWhen this Aura enters, draw a card.\nAs long as enchanted permanent is a creature, it has deathtouch.\nAs long as enchanted permanent is an Equipment, it has "Equipped creature has deathtouch."'),
  reno: c('reno', 'Reno and Rude', 'Legendary Creature — Human Assassin', '{1}{B}', 2, '2/1', 'Menace\nWhenever Reno and Rude deals combat damage to a player, exile the top card of that player\'s library. Then you may sacrifice another creature or artifact. If you do, you may play the exiled card this turn, and mana of any type can be spent to cast it.'),
  ugin: c('ugin', 'Ugin, the Spirit Dragon', 'Legendary Planeswalker — Ugin', '{8}', 8, null, '+2: Ugin deals 3 damage to any target.\n−X: Exile each permanent with mana value X or less that\'s one or more colors.\n−10: You gain 7 life, draw seven cards, then put up to seven permanent cards from your hand onto the battlefield.', { loyalty: '7' }),
  liliana: c('liliana', 'Liliana, the Necromancer', 'Legendary Planeswalker — Liliana', '{3}{B}{B}', 5, null, '+1: Target player loses 2 life.\n−1: Return target creature card from your graveyard to your hand.\n−7: Destroy up to two target creatures. Put up to two creature cards from graveyards onto the battlefield under your control.', { loyalty: '4' }),
  baleful: c('baleful', 'Baleful Mastery', 'Instant', '{3}{B}', 4, null, "You may pay {1}{B} rather than pay this spell's mana cost.\nIf the {1}{B} cost was paid, an opponent draws a card.\nExile target creature or planeswalker."),
  vinelasher: c('vinelasher', 'Iridescent Vinelasher', 'Creature — Lizard Assassin', '{B}', 1, '1/2', 'Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nLandfall — Whenever a land you control enters, this creature deals 1 damage to target opponent.'),
  ambushers: c('ambushers', 'Brotherhood Ambushers', 'Creature — Human Assassin', '{4}{B}', 5, '6/3', 'Freerunning {3}{B} (You may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.)'),
  nightshade: c('nightshade', 'Nightshade Assassin', 'Creature — Human Assassin', '{2}{B}{B}', 4, '2/1', 'First strike\nWhen this creature enters, you may reveal X black cards in your hand. If you do, target creature gets -X/-X until end of turn.\nMadness {1}{B} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)'),
  widow: c('widow', 'White Widow, Yelena Belova', 'Legendary Creature — Human Assassin Villain', '{1}{B}', 2, '1/2', 'Deathtouch\nWhenever a creature you control with deathtouch deals combat damage to a player, put a +1/+1 counter on it.'),
  charm: c('charm', "Archenemy's Charm", 'Instant', '{B}{B}{B}', 3, null, 'Choose one —\n• Exile target creature or planeswalker.\n• Return one or two target creature and/or planeswalker cards from your graveyard to your hand.\n• Put two +1/+1 counters on target creature you control. It gains lifelink until end of turn.'),
  vito: c('vito', 'Vito, Thorn of the Dusk Rose', 'Legendary Creature — Vampire Cleric', '{2}{B}', 3, '1/3', 'Whenever you gain life, target opponent loses that much life.\n{3}{B}{B}: Creatures you control gain lifelink until end of turn.'),
};
Object.values(defs).forEach(d => { if (!d.colors) d.colors = (d.manaCost || '').match(/[WUBRG]/g) ? [...new Set(d.manaCost.match(/[WUBRG]/g))] : []; });
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const ids = Object.keys(defs);
// A game against Opp with one of every card above in each library (and lands).
const vsOpp = () => {
  const game = Game.create(deck('You', ids.map(id => ({ id, qty: 2 })).concat({ id: 'swamp', qty: 20 })), defs);
  game.bot = Bot.create(deck('Opp', ids.map(id => ({ id, qty: 2 })).concat({ id: 'forest', qty: 20 })), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
// Puts a card of table s onto the battlefield (not summoning sick).
const put = (s, id) => {
  const iid = find(s, id);
  Game.move(s, iid, 'battlefield');
  s.cards[iid].enteredTurn = -1;
  return s.cards[iid];
};
const toGrave = (s, id) => { const iid = find(s, id, ['library', 'hand']); Game.move(s, iid, 'graveyard'); return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ hitOpps: n => { game.oppLife -= n; }, hitTarget: n => { game.oppLife -= n; }, other: game.bot.s, defOf, ...extra });
// The app's hooks, as app.js sets them (without the prompts).
const hook = (game, extra = {}) => {
  Game.hooks.died = (s, inst, info) => {
    Bot.died(s, inst, defOf, s === game ? ctx(game, extra) : null, game, info || {});
    Bot.afterDeath(game, s, inst, info || {}, defOf, ctx(game, extra));
  };
  Game.hooks.cast = (s, inst) => { if (s === game) { Bot.spellCast(game, game, inst, defOf, ctx(game, extra)); Bot.spellResolve(game, game, inst, defOf, ctx(game, extra)); } };
  Game.hooks.entered = (s, inst) => { Bot.enterTrigger(s, inst, defOf); Bot.enterEffects(game, s, inst, defOf, s === game ? ctx(game, extra) : null); if (s === game && Game.isLand(inst)) Bot.landEntered(game, inst, defOf, ctx(game, extra)); };
  Game.hooks.wouldDie = (s, inst) => Bot.wouldDie(game, s, inst, defOf);
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game, extra));
  Game.hooks.sendHome = (s, inst, to) => Bot.sendHome(game, s, inst, to, defOf);
};
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const d of Object.values(defs)) {
    if (['bear', 'elf', 'giant', 'knight', 'rock', 'bolt', 'forest'].includes(d.id)) continue;
    const r = Coverage.check(d);
    assert.equal(r.you, 'all', `${d.name}: ${JSON.stringify(r.lines.filter(l => l.gaps.length))}`);
  }
});

test('Nekrataal destroys a nonartifact, nonblack creature, and regeneration doesn\'t save it', () => {
  const eff = Bot.targetEffect("destroy target nonartifact, nonblack creature. That creature can't be regenerated");
  assert.equal(eff.action, 'destroy');
  assert.equal(eff.noRegen, true);
  const game = vsOpp();
  const bear = put(game.bot.s, 'bear');
  const sower = put(game.bot.s, 'sower');
  const st = inst => Bot.stats(inst, defOf(inst.id));
  assert.equal(Bot.canTarget(eff, bear, st(bear), false, false), true);
  assert.equal(Bot.canTarget(eff, sower, st(sower), false, false), false); // black
  bear.regen = 1;
  Bot.applyTarget(game, game.bot.s, bear, eff, 'Nekrataal', defOf);
  assert.equal(bear.zone, 'graveyard');
});

test('Massacre Girl: -1/-1 to everything else, again each time a creature dies this turn', () => {
  const game = vsOpp();
  hook(game);
  const elf = put(game.bot.s, 'elf'); // 1/1
  const bear = put(game.bot.s, 'bear'); // 2/2
  const giant = put(game.bot.s, 'giant'); // 3/3
  const mine = put(game, 'desmond'); // 1/3 (its own +1/+0)
  const girl = put(game, 'massacre');
  Bot.refreshGrants(game, defOf);
  // Elf dies (-1), then everything gets -1 more: bear dies, then -1 more: giant and Desmond die.
  assert.equal(elf.zone, 'graveyard');
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'graveyard');
  assert.equal(mine.zone, 'graveyard');
  assert.equal(girl.zone, 'battlefield');
  Game.endOfTurn(game);
  assert.equal(game.delayed, undefined);
});

test('Massacre Girl, Known Killer draws when an opposing creature dies with toughness below 1', () => {
  const game = vsOpp();
  hook(game);
  put(game, 'killer');
  const bear = put(game.bot.s, 'bear');
  const hand = game.zones.hand.length;
  Game.move(game.bot.s, bear.iid, 'graveyard'); // destroyed: toughness 2
  assert.equal(game.zones.hand.length, hand);
  const giant = put(game.bot.s, 'giant');
  Game.counter(game.bot.s, giant.iid, '-1/-1', 3);
  Bot.refreshGrants(game, defOf);
  assert.equal(giant.zone, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Unstoppable Slasher: comes back tapped and stunned once, and takes half a life total', () => {
  const game = vsOpp();
  hook(game);
  const sl = put(game, 'slasher');
  Game.move(game, sl.iid, 'graveyard');
  assert.equal(sl.zone, 'battlefield');
  assert.equal(sl.tapped, true);
  assert.equal(sl.counters.stun, 2);
  Game.nextTurn(game);
  assert.equal(sl.tapped, true); // a stun counter came off instead
  assert.equal(sl.counters.stun, 1);
  Game.move(game, sl.iid, 'graveyard'); // had counters: stays dead
  assert.equal(sl.zone, 'graveyard');
  const sl2 = put(game, 'slasher');
  game.oppLife = 31;
  Bot.combatDamage(game, [{ inst: sl2, st: Bot.stats(sl2, defOf('slasher')), card: defOf('slasher'), dmg: 2 }], defOf, { loseHalf: () => { game.oppLife -= Math.ceil(game.oppLife / 2); } });
  assert.equal(game.oppLife, 15);
});

test('Sanguine Bond with Bloodthirsty Conqueror goes on until Opp is out', () => {
  const game = vsOpp();
  put(game, 'bond');
  put(game, 'conqueror');
  const before = { you: game.life, opp: game.oppLife };
  game.life += 1;
  Bot.lifeChanged(game, before, defOf, ctx(game));
  assert.ok(game.oppLife <= 0, `Opp at ${game.oppLife}`);
});

test('Vito and Bloodthirsty Conqueror: Opp losing life gives you that much', () => {
  const game = vsOpp();
  put(game, 'conqueror');
  const before = { you: game.life, opp: game.oppLife };
  game.oppLife -= 3;
  Bot.lifeChanged(game, before, defOf, ctx(game));
  assert.equal(game.life, 43);
});

test('Syr Konrad: deaths, milled creature cards and creatures leaving your graveyard each deal 1', () => {
  const game = vsOpp();
  hook(game);
  put(game, 'konrad');
  const bear = put(game.bot.s, 'bear');
  Game.move(game.bot.s, bear.iid, 'graveyard');
  assert.equal(game.oppLife, 39);
  const fates = find(game, 'fates', ['library', 'hand']);
  Game.move(game, fates, 'library', { index: 0 });
  Game.mill(game, 1); // a creature card from the library
  assert.equal(game.oppLife, 38);
  Game.move(game, fates, 'exile'); // leaves your graveyard
  assert.equal(game.oppLife, 37);
  // "{1}{B}: Each player mills a card."
  const left = Bot.runEffect(game, 'Each player mills a card', ctx(game));
  assert.deepEqual(left, []);
});

test('The Darkness Crystal exiles Opp\'s dying creatures, gains 2, and can bring one back under your control', () => {
  const game = vsOpp();
  hook(game);
  const crystal = put(game, 'crystal');
  const giant = put(game.bot.s, 'giant');
  Game.move(game.bot.s, giant.iid, 'graveyard');
  assert.equal(giant.zone, 'exile');
  assert.equal(giant.exiledWith, 'The Darkness Crystal');
  assert.equal(game.life, 42);
  const spec = Bot.cardMoveSpec('Put target creature card exiled with The Darkness Crystal onto the battlefield tapped under your control with two additional +1/+1 counters on it');
  const picks = Bot.moveChoices(game, game.bot.s, spec);
  assert.equal(picks.length, 1);
  Bot.applyMoveCards(game, spec, picks, crystal, defOf);
  const mine = game.zones.battlefield.map(i => game.cards[i]).find(x => x.name === 'Hill Giant');
  assert.ok(mine);
  assert.equal(mine.tapped, true);
  assert.equal(mine.counters['+1/+1'], 2);
  assert.equal(mine.owner, 'opp');
  // When it dies it goes to Opp's graveyard (Opp owns it). The Crystal only exiles Opp's creatures.
  Game.move(game, mine.iid, 'graveyard');
  assert.ok(game.bot.s.zones.graveyard.some(i => game.bot.s.cards[i].name === 'Hill Giant'));
  assert.ok(!game.zones.graveyard.some(i => game.cards[i] && game.cards[i].name === 'Hill Giant'));
});

test('Blot Out makes Opp exile its creature with the greatest mana value', () => {
  const game = vsOpp();
  put(game.bot.s, 'bear');
  const big = put(game.bot.s, 'conqueror');
  const left = Bot.runEffect(game, defs.blot.oracle, ctx(game, { oppsExileGreatest: what => Bot.exileGreatest(game, game.bot.s, what, 'Blot Out', defOf) }));
  assert.deepEqual(left, []);
  assert.equal(big.zone, 'exile');
});

test('Sign in Blood: you pick a player; Opp casting it draws and pays the life itself', () => {
  const eff = Bot.targetEffect('Target player draws two cards and loses 2 life');
  assert.deepEqual([eff.action, eff.draw, eff.lose], ['player', 2, 2]);
  const game = vsOpp();
  const hand = game.bot.s.zones.hand.length;
  Bot.oppTarget(game, game.bot.s.cards[find(game.bot.s, 'sign')], eff, defOf);
  assert.equal(game.bot.s.zones.hand.length, hand + 2);
  assert.equal(game.oppLife, 38);
});

test('Bleed Dry exiles the creature instead of letting it die', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'giant');
  const eff = Bot.targetEffect('Target creature gets -13/-13 until end of turn. If that creature would die this turn, exile it instead');
  assert.equal(eff.exileInstead, true);
  Bot.applyTarget(game, game.bot.s, giant, eff, 'Bleed Dry', defOf, game);
  Bot.refreshGrants(game, defOf);
  assert.equal(giant.zone, 'exile');
});

test("Astarion's Thirst puts the exiled creature's power on your commander as counters", () => {
  const game = vsOpp();
  const cmd = put(game, 'interceptor');
  cmd.commander = true;
  const giant = put(game.bot.s, 'giant');
  const [part] = Bot.parts.effectParts(defs.thirst.oracle);
  const eff = Bot.targetEffect(part);
  Bot.applyTarget(game, game.bot.s, giant, eff, "Astarion's Thirst", defOf, game);
  assert.equal(giant.zone, 'exile');
  assert.equal(cmd.counters['+1/+1'], 3);
});

test('Agent of the Shadow Thieves: your commander attacking a player gets a counter, deathtouch and indestructible', () => {
  const game = vsOpp();
  put(game, 'agent');
  const cmd = put(game, 'interceptor');
  cmd.commander = true;
  Bot.refreshGrants(game, defOf);
  Bot.declareAttack(game, [cmd], defOf, { game, info: () => ({ player: true, mostLife: true }) });
  assert.equal(cmd.counters['+1/+1'], 1);
  const st = Bot.stats(cmd, defOf(cmd.id));
  assert.ok(st.kw.has('deathtouch') && st.kw.has('indestructible'));
  const other = put(game, 'desmond'); // not your commander: nothing
  Bot.declareAttack(game, [other], defOf, { game });
  assert.equal(other.counters['+1/+1'], undefined);
});

test('Poison-Blade Mentor gives another attacking Assassin deathtouch', () => {
  const game = vsOpp();
  const mentor = put(game, 'mentor');
  const pat = put(game, 'patriarch');
  Bot.declareAttack(game, [mentor, pat], defOf, { game });
  assert.ok(Bot.stats(pat, defOf('patriarch')).kw.has('deathtouch'));
});

test("Drana's first strike counters land before the others deal damage", () => {
  const game = vsOpp();
  const drana = put(game, 'drana');
  const pat = put(game, 'patriarch');
  game.bot.s.zones.battlefield.slice().forEach(i => Game.move(game.bot.s, i, 'graveyard'));
  Bot.resolveYourAttack(game, [{ iid: drana.iid }, { iid: pat.iid }], defOf);
  assert.equal(pat.counters['+1/+1'], 1);
  assert.equal(drana.counters['+1/+1'], 1);
  assert.equal(game.oppLife, 40 - 2 - 5); // Drana 2 (first strike), the Patriarch 4 + 1
});

test('Roshan makes your other creatures Assassins, which Desmond Miles counts (graveyard too)', () => {
  const game = vsOpp();
  const des = put(game, 'desmond');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(des, defOf('desmond')).pow, 1);
  put(game, 'bear');
  toGrave(game, 'elf');
  toGrave(game, 'fates'); // an Assassin card
  put(game, 'roshan');
  Bot.refreshGrants(game, defOf);
  // Roshan (Assassin), the Bear (made one), Agent of the Fates and the Elf in the graveyard (made ones).
  assert.equal(Bot.stats(des, defOf('desmond')).pow, 5);
});

test('Desmond Miles surveils as much as the damage it dealt', () => {
  const game = vsOpp();
  const des = put(game, 'desmond');
  let asked = null;
  Bot.combatDamage(game, [{ inst: des, st: Bot.stats(des, defOf('desmond')), card: defOf('desmond'), dmg: 3 }], defOf, { scry: (n, kind) => { asked = [n, kind]; } });
  assert.deepEqual(asked, [3, 'surveil']);
});

test('White Widow puts the counter on the deathtouch creature that hit', () => {
  const game = vsOpp();
  const widow = put(game, 'widow');
  const sl = put(game, 'slasher');
  const pat = put(game, 'patriarch'); // no deathtouch
  const hit = x => ({ inst: x, st: Bot.stats(x, defOf(x.id)), card: defOf(x.id), dmg: 1 });
  Bot.combatDamage(game, [hit(sl), hit(pat)], defOf, ctx(game, { loseHalf: () => {} }));
  assert.equal(sl.counters['+1/+1'], 1);
  assert.equal(pat.counters['+1/+1'], undefined);
  assert.equal(widow.counters['+1/+1'], undefined);
});

test('Guul Draz Overseer: +2/+0 for a Swamp; Ob Nixilis drains 3 and grows', () => {
  const game = vsOpp();
  hook(game);
  put(game, 'overseer');
  const pat = put(game, 'patriarch');
  const ob = put(game, 'obnix');
  Game.move(game, find(game, 'swamp'), 'battlefield');
  assert.equal(pat.pump.pow, 2);
  assert.equal(game.oppLife, 37);
  assert.equal(ob.counters['+1/+1'], 3);
});

test('Retreat to Hagra asks you for the mode; Opp picks the drain itself', () => {
  const game = vsOpp();
  let asked = null;
  hook(game, { chooseModes: (modes, pick) => { asked = { modes, pick }; } });
  put(game, 'retreat');
  Game.move(game, find(game, 'swamp'), 'battlefield');
  assert.equal(asked.modes.length, 2);
  assert.equal(asked.pick, 1);
  put(game.bot.s, 'retreat');
  Bot.landEntered(game, { name: 'Forest' }, defOf, null, game.bot.s);
  assert.equal(game.life, 39);
  assert.equal(game.oppLife, 41);
});

test('Junji (Opp\'s) dying makes you discard two and lose 2', () => {
  const game = vsOpp();
  hook(game);
  const j = put(game.bot.s, 'junji');
  Game.move(game.bot.s, j.iid, 'graveyard');
  assert.equal(game.mustDiscard.n, 2);
  assert.equal(game.life, 38);
});

test('Liliana and Junji take creature cards from graveyards', () => {
  const game = vsOpp();
  toGrave(game, 'giant');
  toGrave(game.bot.s, 'conqueror');
  const reanimate = Bot.cardMoveSpec('Put target non-Dragon creature card from a graveyard onto the battlefield under your control');
  assert.equal(Bot.moveChoices(game, game.bot.s, reanimate).length, 2);
  Bot.applyMoveCards(game, reanimate, Bot.moveChoices(game, game.bot.s, reanimate).filter(x => x.s === game.bot.s), { name: 'Junji' }, defOf);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].name === 'Bloodthirsty Conqueror'));
  const back = Bot.cardMoveSpec('Return target creature card from your graveyard to your hand');
  assert.deepEqual([back.from, back.to, back.max], ['mine', 'hand', 1]);
  const two = Bot.cardMoveSpec('Return one or two target creature and/or planeswalker cards from your graveyard to your hand');
  assert.deepEqual([two.min, two.max], [1, 2]);
});

test('Liliana and Ugin have loyalty abilities you can use; The Immortal Sun stops them', () => {
  const game = vsOpp();
  const lili = put(game, 'liliana');
  const abs = Bot.activatedAbilities(lili, defOf);
  assert.deepEqual(abs.map(a => a.loyalty), [1, -1, -7]);
  assert.equal(Bot.loyaltyLocked(game, defOf), false);
  put(game.bot.s, 'sun');
  assert.equal(Bot.loyaltyLocked(game, defOf), true);
  // Ugin's −X with X = 3: colored permanents with mana value 3 or less are exiled; the Mind Stone stays.
  const bear = put(game.bot.s, 'bear');
  const stone = put(game.bot.s, 'rock');
  const conq = put(game.bot.s, 'conqueror');
  Bot.runEffect(game, "Exile each permanent with mana value 3 or less that's one or more colors", ctx(game));
  assert.equal(bear.zone, 'exile');
  assert.equal(stone.zone, 'battlefield');
  assert.equal(conq.zone, 'battlefield');
});

test('The Immortal Sun draws an extra card in your draw step', () => {
  const game = vsOpp();
  put(game, 'sun');
  const hand = game.zones.hand.length;
  Bot.phaseTriggers(game, game, 'draw step', defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Geist-Fueled Scarecrow taxes only your own creature spells', () => {
  const game = vsOpp();
  put(game, 'scarecrow');
  const rules = Bot.tableRules(game, defOf);
  const bear = game.cards[find(game, 'bear')];
  const bolt = game.cards[find(game, 'bolt')];
  assert.equal(Bot.spellTax([{ rules, own: true }], bear, defOf), 1);
  assert.equal(Bot.spellTax([{ rules, own: true }], bolt, defOf), 0);
  assert.equal(Bot.spellTax([{ rules, own: false }], bear, defOf), 0);
});

test("Nightmare Sower triggers only on spells you cast during an opponent's turn", () => {
  const game = vsOpp();
  put(game, 'sower');
  let targets = 0;
  const c2 = ctx(game, { target: () => { targets++; } });
  const bolt = game.cards[find(game, 'bolt')];
  Bot.spellCast(game, game, bolt, defOf, c2);
  assert.equal(targets, 0);
  game.offTurn = true;
  Bot.spellCast(game, game, bolt, defOf, c2);
  assert.equal(targets, 1);
});

test('Heroic (Agent of the Fates) and Danitha see your spells target', () => {
  const game = vsOpp();
  const fates = put(game, 'fates');
  const dan = put(game, 'danitha');
  put(game.bot.s, 'bear');
  const giant = put(game.bot.s, 'giant');
  const spell = game.cards[find(game, 'overdrive')];
  Bot.spellTargeted(game, game, spell, { inst: fates, s: game }, defOf, ctx(game, { oppsSacrifice: (n, what) => Bot.oppSacrifices(game, n, 'Agent of the Fates', what) }));
  assert.equal(game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).filter(x => Game.isCreature(x)).length, 1);
  Bot.spellTargeted(game, game, spell, { inst: giant, s: game.bot.s }, defOf, ctx(game));
  assert.equal(dan.counters['+1/+1'], 1);
});

test('Maximum Overdrive: the counter and the keywords go on the target, not the spell', () => {
  const eff = Bot.targetEffect(Bot.parts.effectParts(defs.overdrive.oracle)[0]);
  assert.deepEqual([eff.action, eff.kw], ['counter', ['deathtouch', 'indestructible']]);
});

test('Massacre Girl, Most Wanted grows when an opponent is dealt noncombat damage', () => {
  const game = vsOpp();
  const g = put(game, 'wanted');
  Bot.damagePlayer(game, 'opp', 1, 'Iridescent Vinelasher', defOf);
  assert.equal(g.counters['+1/+1'], 1);
  assert.equal(game.oppLife, 39);
});

test("Garza's Assassin (recover): you're asked; Opp pays with life to spare", () => {
  const game = vsOpp();
  let asked = null;
  hook(game, { recover: (card, cost) => { asked = [card.name, cost]; } });
  toGrave(game, 'garza');
  const pat = put(game, 'patriarch');
  Game.move(game, pat.iid, 'graveyard');
  assert.deepEqual(asked, ["Garza's Assassin", 'Pay half your life, rounded up']);
  const g = toGrave(game.bot.s, 'garza');
  const bear = put(game.bot.s, 'bear');
  Game.move(game.bot.s, bear.iid, 'graveyard');
  assert.equal(g.zone, 'hand');
  assert.equal(game.oppLife, 19); // 38 after the Patriarch's drain, half of that paid
});

test('Ebondeath enters tapped and can be cast from the graveyard after another creature died', () => {
  assert.equal(Game.entersTapped('Ebondeath, Dracolich', defs.ebondeath.oracle), true);
  const game = vsOpp();
  hook(game);
  const e = toGrave(game, 'ebondeath');
  assert.equal(Bot.graveCast(game, e, defOf), false);
  const bear = put(game.bot.s, 'bear');
  Game.move(game.bot.s, bear.iid, 'graveyard');
  assert.equal(Bot.graveCast(game, e, defOf), true);
  Game.endOfTurn(game);
  assert.equal(Bot.graveCast(game, e, defOf), false);
});

test('Boggart Bog: a land when played as its back face, with the pay-3-life choice', () => {
  const et = Game.entersTapped(defs.trawler.name, defs.trawler.oracle);
  assert.deepEqual(et, { payLife: 3 });
  const game = vsOpp();
  const t = game.cards[find(game, 'trawler')];
  assert.equal(Game.isLand(t), false);
  t.flipped = true;
  assert.equal(Game.isLand(t), true);
  assert.equal(Game.isCreature(t), false);
});

test("Boggart Trawler and Bojuka Bog exile Opp's graveyard", () => {
  const game = vsOpp();
  toGrave(game.bot.s, 'bear');
  toGrave(game.bot.s, 'giant');
  Bot.runEffect(game, "exile target player's graveyard", ctx(game, { exileGrave: () => Bot.exileGraveyard(game.bot.s, 'Bojuka Bog') }));
  assert.equal(game.bot.s.zones.graveyard.length, 0);
});

test('Hidden Blade attaches itself and gives an Assassin deathtouch', () => {
  const game = vsOpp();
  const pat = put(game, 'patriarch');
  const blade = put(game, 'blade');
  const eff = Bot.targetEffect(Bot.parts.effectParts('attach it to target creature you control. If that creature is an Assassin, it gains deathtouch until end of turn')[0]);
  eff.srcIid = blade.iid;
  Bot.applyTarget(game, game, pat, eff, 'Hidden Blade', defOf, game);
  assert.equal(blade.attachedTo, pat.iid);
  const st = Bot.stats(pat, defOf('patriarch'));
  assert.ok(st.kw.has('deathtouch') && st.kw.has('first strike'));
  assert.equal(st.pow, 5);
});

test('Rune of Mortality on an Equipment gives the equipped creature deathtouch', () => {
  const game = vsOpp();
  const bear = put(game, 'bear');
  const blade = put(game, 'blade');
  const rune = put(game, 'rune');
  Game.attach(game, blade.iid, bear.iid, Bot.attachBonus(defs.blade.oracle));
  Game.attach(game, rune.iid, blade.iid, Bot.attachBonus(defs.rune.oracle));
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(bear, defOf('bear')).kw.has('deathtouch'));
});

test('Interceptor in the graveyard can come back when a legendary creature attacks', () => {
  const game = vsOpp();
  const i = toGrave(game, 'interceptor');
  const drana = put(game, 'drana');
  const pat = put(game, 'patriarch');
  assert.equal(Bot.graveAttackers(game, [pat], defOf).length, 0);
  const back = Bot.graveAttackers(game, [drana], defOf);
  assert.deepEqual(back.map(g => [g.inst.name, g.cost]), [["Interceptor, Shadow's Hound", '{2}{B}']]);
  Bot.returnAttacking(game, i);
  assert.deepEqual([i.zone, i.tapped, i.attacking], ['battlefield', true, true]);
});

test('Reno and Rude exiles the top of Opp\'s library and offers the sacrifice', () => {
  const game = vsOpp();
  const reno = put(game, 'reno');
  let offered = null;
  const top = game.bot.s.zones.library[0];
  Bot.combatDamage(game, [{ inst: reno, st: Bot.stats(reno, defOf('reno')), card: defOf('reno'), dmg: 2 }], defOf, ctx(game, {
    exileTop: src => { const c2 = Bot.exileTopCard(game, game, src.name); game.lastExiledTop = c2.iid; },
    sacToPlay: what => { offered = what; },
  }));
  assert.equal(game.bot.s.cards[top].zone, 'exile');
  assert.equal(offered, 'creature or artifact');
});

test('Casting choices: offspring, freerunning after an Assassin hit, and Baleful Mastery\'s other cost', () => {
  const game = vsOpp();
  const card = id => game.cards[find(game, id)];
  assert.deepEqual(Bot.costChoices(game, card('vinelasher'), defOf).map(x => x.cost), ['{B}', '{B}{2}']);
  assert.deepEqual(Bot.costChoices(game, card('ambushers'), defOf).map(x => x.key), ['normal']);
  const pat = put(game, 'patriarch');
  Bot.combatDamage(game, [{ inst: pat, st: Bot.stats(pat, defOf('patriarch')), card: defOf('patriarch'), dmg: 4 }], defOf, ctx(game));
  assert.deepEqual(Bot.costChoices(game, card('ambushers'), defOf).map(x => x.cost), ['{4}{B}', '{3}{B}']);
  assert.deepEqual(Bot.costChoices(game, card('baleful'), defOf).map(x => x.cost), ['{3}{B}', '{1}{B}']);
  // Paid that way, an opponent draws a card.
  const b = card('baleful');
  b.altPaid = true;
  const hand = game.bot.s.zones.hand.length;
  Bot.runEffect(game, 'If the {1}{B} cost was paid, an opponent draws a card', ctx(game, { self: b, oppsDraw: n => Game.drawCards(game.bot.s, n, true) }));
  assert.equal(game.bot.s.zones.hand.length, hand + 1);
  // Offspring's 1/1 copy.
  const v = put(game, 'vinelasher');
  Bot.offspringCopy(game, v);
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(x => x.token && x.name === v.name);
  assert.equal(Bot.stats(tok, defOf('vinelasher')).pow, 1);
});

test('Nightshade Assassin: -X/-X for each black card in hand', () => {
  const game = vsOpp();
  game.zones.hand.slice().forEach(i => Game.move(game, i, 'library'));
  ['fates', 'sign', 'bear'].forEach(id => Game.move(game, find(game, id, ['library']), 'hand'));
  assert.equal(Bot.parts.settleIfYouDo('you may reveal X black cards in your hand. If you do, target creature gets -X/-X until end of turn.', game), 'target creature gets -2/-2 until end of turn');
});

test("Archenemy's Charm's modes do their targets and graveyard picks", () => {
  const game = vsOpp();
  const charm = game.cards[find(game, 'charm')];
  const asked = [];
  const left = Bot.runModes(game, charm, defOf, [0, 1], ctx(game, { target: (eff, part) => asked.push(part), moveCards: spec => asked.push(spec.to) }));
  assert.deepEqual(left, []);
  assert.deepEqual(asked, ['Exile target creature or planeswalker', 'hand']);
});

test("Ugin, Eye of the Storms' −11 search exiles colorless nonland cards to cast for free", () => {
  const spec = Bot.searchSpec('Search your library for any number of colorless nonland cards, exile them');
  assert.deepEqual([spec.to, spec.what], ['exile', 'colorless nonland']);
  const game = vsOpp();
  [...game.zones.hand].forEach(i => Game.move(game, i, 'library', { bottom: true })); // both copies could be in the opening hand
  const ids2 = Bot.searchable(game, spec).map(i => game.cards[i].name);
  assert.ok(ids2.includes('Mind Stone') && ids2.includes('Geist-Fueled Scarecrow'));
  assert.ok(!ids2.includes('Swamp') && !ids2.includes('Grizzly Bears'));
});
