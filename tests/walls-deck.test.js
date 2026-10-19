// The cards of the "These walls have hands" Commander deck, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const defs = {
  memorial: {"id":"memorial","name":"Akroma's Memorial","typeLine":"Legendary Artifact","manaCost":"{7}","cmc":7,"power":null,"toughness":null,"oracle":"Creatures you control have flying, first strike, vigilance, trample, haste, and protection from black and from red.","colors":[]},
  offer: {"id":"offer","name":"An Offer You Can't Refuse","typeLine":"Instant","manaCost":"{U}","cmc":1,"power":null,"toughness":null,"oracle":"Counter target noncreature spell. Its controller creates two Treasure tokens.","colors":["U"],"producedMana":["B","G","R","U","W"]},
  tetsuko: {"id":"tetsuko","name":"Tetsuko Umezawa, Fugitive","typeLine":"Legendary Creature — Human Rogue","manaCost":"{1}{U}","cmc":2,"power":"1","toughness":"3","oracle":"Creatures you control with power or toughness 1 or less can't be blocked.","colors":["U"]},
  tower: {"id":"tower","name":"Reliquary Tower","typeLine":"Land","manaCost":"","cmc":0,"power":null,"toughness":null,"oracle":"You have no maximum hand size.\n{T}: Add {C}.","colors":[],"producedMana":["C"]},
  axebane: {"id":"axebane","name":"Axebane Guardian","typeLine":"Creature — Human Druid","manaCost":"{2}{G}","cmc":3,"power":"0","toughness":"3","oracle":"Defender\n{T}: Add X mana in any combination of colors, where X is the number of creatures you control with defender.","colors":["G"],"producedMana":["B","G","R","U","W"]},
  frost: {"id":"frost","name":"Wall of Frost","typeLine":"Creature — Wall","manaCost":"{1}{U}{U}","cmc":3,"power":"0","toughness":"7","oracle":"Defender\nWhenever this creature blocks a creature, that creature doesn't untap during its controller's next untap step.","colors":["U"]},
  battlement: {"id":"battlement","name":"Overgrown Battlement","typeLine":"Creature — Wall","manaCost":"{1}{G}","cmc":2,"power":"0","toughness":"4","oracle":"Defender\n{T}: Add {G} for each creature you control with defender.","colors":["G"],"producedMana":["G"]},
  barricade: {"id":"barricade","name":"Crystal Barricade","typeLine":"Artifact Creature — Wall","manaCost":"{1}{W}","cmc":2,"power":"0","toughness":"4","oracle":"Defender\nYou have hexproof.\nPrevent all noncombat damage that would be dealt to other creatures you control.","colors":["W"]},
  path: {"id":"path","name":"Path to Exile","typeLine":"Instant","manaCost":"{W}","cmc":1,"power":null,"toughness":null,"oracle":"Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.","colors":["W"]},
  swords: {"id":"swords","name":"Swords to Plowshares","typeLine":"Instant","manaCost":"{W}","cmc":1,"power":null,"toughness":null,"oracle":"Exile target creature. Its controller gains life equal to its power.","colors":["W"]},
  sentinel: {"id":"sentinel","name":"Shield-Wall Sentinel","typeLine":"Artifact Creature — Golem","manaCost":"{4}","cmc":4,"power":"1","toughness":"3","oracle":"Defender\nWhen this creature enters, you may search your library for a creature card with defender, reveal it, put it into your hand, then shuffle.","colors":[]},
  teferi: {"id":"teferi","name":"Teferi's Protection","typeLine":"Instant","manaCost":"{2}{W}","cmc":3,"power":null,"toughness":null,"oracle":"Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out.\nExile Teferi's Protection.","colors":["W"]},
  jeskai: {"id":"jeskai","name":"Jeskai Barricade","typeLine":"Creature — Wall","manaCost":"{1}{W}","cmc":2,"power":"0","toughness":"4","oracle":"Flash\nDefender\nWhen this creature enters, you may return another target creature you control to its owner's hand.","colors":["W"]},
  veto: {"id":"veto","name":"Dovin's Veto","typeLine":"Instant","manaCost":"{W}{U}","cmc":2,"power":null,"toughness":null,"oracle":"This spell can't be countered.\nCounter target noncreature spell.","colors":["U","W"]},
  weathered: {"id":"weathered","name":"Weathered Sentinels","typeLine":"Artifact Creature — Wall","manaCost":"{3}","cmc":3,"power":"2","toughness":"5","oracle":"Defender, reach, vigilance, trample\nThis creature can attack players who attacked you during their last turn as though it didn't have defender.\nWhenever this creature attacks, it gets +3/+3 and gains indestructible until end of turn.","colors":[]},
  eerie: {"id":"eerie","name":"Eerie Interlude","typeLine":"Instant","manaCost":"{2}{W}","cmc":3,"power":null,"toughness":null,"oracle":"Exile any number of target creatures you control. Return those cards to the battlefield under their owner's control at the beginning of the next end step.","colors":["W"]},
  junk: {"id":"junk","name":"Wall of Junk","typeLine":"Artifact Creature — Wall","manaCost":"{2}","cmc":2,"power":"0","toughness":"7","oracle":"Defender\nWhen this creature blocks, return it to its owner's hand at end of combat.","colors":[]},
  tree: {"id":"tree","name":"Tree of Redemption","typeLine":"Creature — Plant","manaCost":"{3}{G}","cmc":4,"power":"0","toughness":"13","oracle":"Defender\n{T}: Exchange your life total with this creature's toughness.","colors":["G"]},
  spiral: {"id":"spiral","name":"Growth Spiral","typeLine":"Instant","manaCost":"{G}{U}","cmc":2,"power":null,"toughness":null,"oracle":"Draw a card. You may put a land card from your hand onto the battlefield.","colors":["G","U"]},
  pride: {"id":"pride","name":"The Pride of Hull Clade","typeLine":"Legendary Creature — Crocodile Elk Turtle","manaCost":"{10}{G}","cmc":11,"power":"2","toughness":"15","oracle":"This spell costs {X} less to cast, where X is the total toughness of creatures you control.\nDefender\n{2}{U}{U}: Until end of turn, target creature you control gets +1/+0, gains \"Whenever this creature deals combat damage to a player, draw cards equal to its toughness,\" and can attack as though it didn't have defender.","colors":["G"]},
  denial: {"id":"denial","name":"Arcane Denial","typeLine":"Instant","manaCost":"{1}{U}","cmc":2,"power":null,"toughness":null,"oracle":"Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.","colors":["U"]},
  rhystic: {"id":"rhystic","name":"Rhystic Study","typeLine":"Enchantment","manaCost":"{2}{U}","cmc":3,"power":null,"toughness":null,"oracle":"Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.","colors":["U"]},
  teyo: {"id":"teyo","name":"Teyo, the Shieldmage","typeLine":"Legendary Planeswalker — Teyo","manaCost":"{2}{W}","cmc":3,"power":null,"toughness":null,"oracle":"You have hexproof.\n−2: Create a 0/3 white Wall creature token with defender.","colors":["W"],"loyalty":"5"},
  flumph: {"id":"flumph","name":"Flumph","typeLine":"Creature — Jellyfish","manaCost":"{1}{W}","cmc":2,"power":"0","toughness":"4","oracle":"Defender, flying\nWhenever this creature is dealt damage, you and target opponent each draw a card.","colors":["W"]},
  drift: {"id":"drift","name":"Drift of Phantasms","typeLine":"Creature — Spirit","manaCost":"{2}{U}","cmc":3,"power":"0","toughness":"5","oracle":"Defender\nFlying\nTransmute {1}{U}{U}","colors":["U"]},
  glare: {"id":"glare","name":"Wall of Glare","typeLine":"Creature — Wall","manaCost":"{1}{W}","cmc":2,"power":"0","toughness":"5","oracle":"Defender\nThis creature can block any number of creatures.","colors":["W"]},
  huatli: {"id":"huatli","name":"Huatli, the Sun's Heart","typeLine":"Legendary Planeswalker — Huatli","manaCost":"{2}{G/W}","cmc":3,"power":null,"toughness":null,"oracle":"Each creature you control assigns combat damage equal to its toughness rather than its power.\n−3: You gain life equal to the greatest toughness among creatures you control.","colors":["G","W"],"loyalty":"7"},
  titan: {"id":"titan","name":"Towering Titan","typeLine":"Creature — Giant","manaCost":"{4}{G}{G}","cmc":6,"power":"0","toughness":"0","oracle":"This creature enters with X +1/+1 counters on it, where X is the total toughness of other creatures you control.\nSacrifice a creature with defender: All creatures gain trample until end of turn.","colors":["G"]},
  stolen: {"id":"stolen","name":"Wall of Stolen Identity","typeLine":"Creature — Shapeshifter Wall","manaCost":"{3}{U}","cmc":4,"power":"0","toughness":"0","oracle":"You may have this creature enter as a copy of any creature on the battlefield, except it's a Wall in addition to its other types and has defender. When you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control this creature.","colors":["U"]},
  tithe: {"id":"tithe","name":"Smothering Tithe","typeLine":"Enchantment","manaCost":"{3}{W}","cmc":4,"power":null,"toughness":null,"oracle":"Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.","colors":["W"],"producedMana":["B","G","R","U","W"]},
  dusk: {"id":"dusk","name":"Dusk // Dawn","typeLine":"Sorcery // Sorcery","manaCost":"{2}{W}{W} // {3}{W}{W}","cmc":9,"power":null,"toughness":null,"oracle":"Dusk: Destroy all creatures with power 3 or greater.\n\nDawn: Aftermath\nReturn all creature cards with power 2 or less from your graveyard to your hand.","colors":["W"]},
  slaughter: {"id":"slaughter","name":"Slaughter the Strong","typeLine":"Sorcery","manaCost":"{1}{W}{W}","cmc":3,"power":null,"toughness":null,"oracle":"Each player chooses any number of creatures they control with total power 4 or less, then sacrifices all other creatures they control.","colors":["W"]},
  wave: {"id":"wave","name":"Wave of Reckoning","typeLine":"Sorcery","manaCost":"{4}{W}","cmc":5,"power":null,"toughness":null,"oracle":"Each creature deals damage to itself equal to its power.","colors":["W"]},
  fell: {"id":"fell","name":"Fell the Mighty","typeLine":"Sorcery","manaCost":"{4}{W}","cmc":5,"power":null,"toughness":null,"oracle":"Destroy all creatures with power greater than target creature's power.","colors":["W"]},
  march: {"id":"march","name":"Last March of the Ents","typeLine":"Sorcery","manaCost":"{6}{G}{G}","cmc":8,"power":null,"toughness":null,"oracle":"This spell can't be countered.\nDraw cards equal to the greatest toughness among creatures you control, then put any number of creature cards from your hand onto the battlefield.","colors":["G"]},
  bywater: {"id":"bywater","name":"The Battle of Bywater","typeLine":"Sorcery","manaCost":"{1}{W}{W}","cmc":3,"power":null,"toughness":null,"oracle":"Destroy all creatures with power 3 or greater. Then create a Food token for each creature you control.","colors":["W"]},
  spara: {"id":"spara","name":"Spara's Headquarters","typeLine":"Land — Forest Plains Island","manaCost":"","cmc":0,"power":null,"toughness":null,"oracle":"\nThis land enters tapped.\nCycling {3}","colors":[],"producedMana":["G","U","W"]},
  omens: {"id":"omens","name":"Wall of Omens","typeLine":"Creature — Wall","manaCost":"{1}{W}","cmc":2,"power":"0","toughness":"4","oracle":"Defender\nWhen this creature enters, draw a card.","colors":["W"]},
  arcades: {"id":"arcades","name":"Arcades, the Strategist","typeLine":"Legendary Creature — Elder Dragon","manaCost":"{1}{G}{W}{U}","cmc":4,"power":"3","toughness":"5","oracle":"Flying, vigilance\nWhenever a creature you control with defender enters, draw a card.\nEach creature you control with defender assigns combat damage equal to its toughness rather than its power and can attack as though it didn't have defender.","colors":["G","U","W"]},
  island: { id: 'island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '' },
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '' },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  giant: { id: 'giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '3', toughness: '3', oracle: '', colors: ['R'] },
  ogre: { id: 'ogre', name: 'Gray Ogre', typeLine: 'Creature — Ogre', manaCost: '{2}{R}', cmc: 3, power: '2', toughness: '2', oracle: '', colors: ['R'] },
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const ids = Object.keys(defs);
const vsOpp = () => {
  const game = Game.create(deck('You', ids.map(id => ({ id, qty: 2 })).concat({ id: 'island', qty: 20 })), defs);
  game.bot = Bot.create(deck('Opp', ids.map(id => ({ id, qty: 2 })).concat({ id: 'forest', qty: 20 })), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ hitOpps: n => { game.oppLife -= n; }, hitTarget: n => { game.oppLife -= n; }, other: game.bot.s, defOf, oppsDraw: n => Game.drawCards(game.bot.s, n, true), ...extra });
const st = inst => Bot.stats(inst, defOf(inst.id));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const d of Object.values(defs)) {
    if (['bear', 'giant', 'ogre', 'island', 'forest'].includes(d.id)) continue;
    const r = Coverage.check(d);
    assert.equal(r.you, 'all', `${d.name}: ${JSON.stringify(r.lines.filter(l => l.gaps.length))}`);
  }
});

test("Akroma's Memorial gives protection from black and from red with the rest", () => {
  const game = vsOpp();
  put(game, 'memorial');
  const wall = put(game, 'glare');
  Bot.refreshGrants(game, defOf);
  const kw = st(wall).kw;
  ['flying', 'first strike', 'vigilance', 'trample', 'haste', 'protection from B R'].forEach(k => assert.ok(kw.has(k), k));
});

test('Overgrown Battlement and Axebane Guardian make a mana for each defender', () => {
  const game = vsOpp();
  put(game, 'battlement');
  const axe = put(game, 'axebane');
  put(game, 'glare');
  Bot.refreshGrants(game, defOf);
  assert.equal(game.kwCount.defender, 3);
  assert.equal(Game.available(game).total, 6);
  Game.setTapped(game, axe.iid, true, 'W');
  assert.equal(game.mana.W, 3);
});

test('Tetsuko makes your small creatures unblockable', () => {
  const game = vsOpp();
  put(game, 'tetsuko');
  const wall = put(game, 'glare');
  const giant = put(game, 'giant');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(wall).kw.has('unblockable'));
  assert.ok(!st(giant).kw.has('unblockable'));
});

test('Wall of Frost: the creature it blocks stays tapped next untap; Wall of Junk goes back to hand after combat', () => {
  const game = vsOpp();
  const frost = put(game, 'frost');
  const junk = put(game, 'junk');
  const giant = put(game.bot.s, 'giant');
  const ogre = put(game.bot.s, 'ogre');
  giant.tapped = true;
  ogre.tapped = true;
  game.bot.pending = { attackers: [giant.iid, ogre.iid], targets: {} };
  Bot.resolveOppAttack(game, { [giant.iid]: [frost.iid], [ogre.iid]: [junk.iid] }, defOf);
  assert.equal(junk.zone, 'hand');
  Game.nextTurn(game.bot.s);
  assert.equal(giant.tapped, true);
  assert.equal(ogre.tapped, false);
  Game.nextTurn(game.bot.s);
  assert.equal(giant.tapped, false);
});

test("Crystal Barricade: you have hexproof, and your other creatures take no noncombat damage", () => {
  const game = vsOpp();
  const bar = put(game, 'barricade');
  const wall = put(game, 'glare');
  assert.equal(Bot.playerShielded(game, 'you', defOf), true);
  Bot.applyTarget(game, game, wall, { action: 'damage', n: 9, what: 'any target' }, 'Shock', defOf);
  assert.equal(wall.zone, 'battlefield');
  // Opp's "any target" damage with nothing it can kill doesn't go at you.
  const shock = () => Bot.autoTarget(game, game.bot.s, { name: 'Shock', typeLine: 'Instant' }, { action: 'damage', n: 2, what: 'any target' }, defOf, true);
  assert.equal(shock(), null);
  Bot.applyTarget(game, game, bar, { action: 'damage', n: 9, what: 'any target' }, 'Shock', defOf);
  assert.equal(bar.zone, 'graveyard'); // only *other* creatures
  assert.deepEqual(shock(), { player: 'you' }); // no hexproof any more
});

test('Swords to Plowshares gives the life; Path to Exile gives a basic land', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'giant');
  const swords = Bot.targetEffect(Bot.parts.effectParts(defs.swords.oracle)[0]);
  Bot.applyTarget(game, game.bot.s, giant, swords, 'Swords', defOf, game);
  assert.equal(giant.zone, 'exile');
  assert.equal(game.oppLife, 43);
  const ogre = put(game.bot.s, 'ogre');
  const lands = () => game.bot.s.zones.battlefield.filter(i => Game.isLand(game.bot.s.cards[i])).length;
  const before = lands();
  const parts = Bot.parts.effectParts(defs.path.oracle);
  assert.equal(parts.length, 1);
  Bot.applyTarget(game, game.bot.s, ogre, Bot.targetEffect(parts[0]), 'Path', defOf, game);
  assert.equal(ogre.zone, 'exile');
  assert.equal(lands(), before + 1);
});

test("Teferi's Protection: life can't change and your permanents phase out until your next turn", () => {
  const game = vsOpp();
  const wall = put(game, 'glare');
  const spell = game.cards[find(game, 'teferi')];
  Game.move(game, spell.iid, 'battlefield', { put: true });
  const left = Bot.runEffect(game, defs.teferi.oracle.replace(/\n/g, ' '), ctx(game, { self: spell }));
  assert.deepEqual(left, []);
  assert.equal(spell.zone, 'exile');
  assert.equal(wall.phasedOut, true);
  assert.equal(Bot.yourCreatures(game, defOf).length, 0);
  const before = { you: game.life, opp: game.oppLife };
  game.life -= 10;
  Bot.lifeChanged(game, before, defOf, ctx(game));
  assert.equal(game.life, 40);
  assert.equal(Bot.playerShielded(game, 'you', defOf), true);
  Game.nextTurn(game);
  assert.equal(wall.phasedOut, undefined);
  assert.equal(game.untilNextTurn, undefined);
});

test('Shield-Wall Sentinel finds a creature with defender', () => {
  const spec = Bot.searchSpec('search your library for a creature card with defender, reveal it, put it into your hand');
  assert.equal(spec.kw, 'defender');
  const game = vsOpp();
  const names = Bot.searchable(game, spec, defOf).map(i => game.cards[i].name);
  assert.ok(names.includes('Wall of Glare') && !names.includes('Grizzly Bears'));
});

test('Weathered Sentinels can attack only after Opp attacked you last turn', () => {
  const game = vsOpp();
  const w = put(game, 'weathered');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.noAttack(st(w)));
  game.bot.s.attackedYou = true;
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.noAttack(st(w)));
});

test('Tree of Redemption swaps your life and its toughness', () => {
  const game = vsOpp();
  const tree = put(game, 'tree');
  game.life = 7;
  const [ab] = Bot.activatedAbilities(tree, defOf);
  Bot.runEffect(game, ab.effect, ctx(game, { self: tree }));
  assert.equal(game.life, 13);
  assert.equal(st(tree).tou, 7);
});

test('The Pride of Hull Clade lets a wall attack and draw cards equal to its toughness', () => {
  const game = vsOpp();
  const pride = put(game, 'pride');
  const wall = put(game, 'glare');
  const ab = Bot.activatedAbilities(pride, defOf)[0];
  const eff = Bot.targetEffect(ab.effect);
  assert.equal(eff.attack, true);
  Bot.applyTarget(game, game, wall, eff, 'Pride', defOf);
  assert.ok(!Bot.noAttack(st(wall)));
  const hand = game.zones.hand.length;
  Bot.combatDamage(game, [{ inst: wall, st: st(wall), card: defOf('glare'), dmg: 1 }], defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 5);
});

test('Counterspell extras: An Offer gives Treasures, Arcane Denial draws next upkeep, and Opp can cast them', () => {
  const game = vsOpp();
  Bot.counterExtras(game, game, game.bot.s, defs.offer.oracle, "An Offer You Can't Refuse");
  assert.equal(game.bot.s.zones.battlefield.map(i => game.bot.s.cards[i]).filter(c => c.name === 'Treasure').length, 2);
  Bot.counterExtras(game, game, game.bot.s, defs.denial.oracle, 'Arcane Denial');
  const mine = game.zones.hand.length;
  const theirs = game.bot.s.zones.hand.length;
  Bot.upkeepDraws(game);
  assert.equal(game.zones.hand.length, mine + 1);
  assert.equal(game.bot.s.zones.hand.length, theirs + 2);
  assert.ok(Bot.parts.counterSpell(defs.denial.oracle));
  assert.ok(Bot.parts.counterSpell(defs.veto.oracle));
  assert.ok(Bot.parts.counterSpell(defs.offer.oracle));
});

test('Rhystic Study and Smothering Tithe', () => {
  const game = vsOpp();
  put(game, 'rhystic');
  put(game, 'tithe');
  game.bot.s.zones.battlefield.slice().forEach(i => Game.move(game.bot.s, i, 'graveyard'));
  const hand = game.zones.hand.length;
  Bot.opponentActed(game, game.bot.s, 'cast', 1, defOf, null); // Opp has no mana for {1}
  assert.equal(game.zones.hand.length, hand + 1);
  Bot.opponentActed(game, game.bot.s, 'draw', 2, defOf, null); // Opp doesn't pay {2}
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.name === 'Treasure').length, 2);
  // Opp's Rhystic Study: you're asked.
  put(game.bot.s, 'rhystic');
  let asked = null;
  Bot.opponentActed(game, game, 'cast', 1, defOf, { payTax: r => { asked = r; } });
  assert.deepEqual([asked.payer, asked.cost], ['you', '{1}']);
});

test('Flumph: dealt damage, you and Opp each draw', () => {
  const game = vsOpp();
  const f = put(game, 'flumph');
  const a = game.zones.hand.length;
  const b = game.bot.s.zones.hand.length;
  Bot.creatureDamaged(game, game, f, 2, defOf, ctx(game));
  assert.equal(game.zones.hand.length, a + 1);
  assert.equal(game.bot.s.zones.hand.length, b + 1);
});

test('Huatli and Last March of the Ents use the greatest toughness', () => {
  const game = vsOpp();
  put(game, 'tree');
  Bot.runEffect(game, 'You gain life equal to the greatest toughness among creatures you control', ctx(game));
  assert.equal(game.life, 53);
  const hand = game.zones.hand.length;
  Bot.runEffect(game, 'Draw cards equal to the greatest toughness among creatures you control', ctx(game));
  assert.equal(game.zones.hand.length, hand + 13);
  assert.equal(Bot.cardMoveSpec('put any number of creature cards from your hand onto the battlefield').max, 99);
});

test('Towering Titan enters with the toughness of your other creatures; its cost sacrifices a defender', () => {
  const game = vsOpp();
  put(game, 'glare');
  put(game, 'tree');
  const titan = put(game, 'titan');
  Bot.enterTrigger(game, titan, defOf);
  assert.equal(titan.counters['+1/+1'], 18);
  const ab = Bot.activatedAbilities(titan, defOf)[0];
  assert.equal(ab.sacOther, 'creature with defender');
  assert.equal(Bot.sacChoices(game, titan, ab.sacOther, defOf).length, 2);
});

test('Wall of Stolen Identity copies a creature, which stays tapped while the copy stays', () => {
  const game = vsOpp();
  const w = put(game, 'stolen');
  const giant = put(game.bot.s, 'giant');
  Bot.becomeCopy(game, game, w, { s: game.bot.s, inst: giant }, defOf);
  assert.equal(w.name, 'Hill Giant');
  assert.ok(/Wall/.test(w.typeLine));
  assert.ok(st(w).kw.has('defender'));
  assert.equal(st(w).pow, 3);
  assert.equal(giant.tapped, true);
  Game.nextTurn(game.bot.s);
  assert.equal(giant.tapped, true);
  Game.move(game, w.iid, 'graveyard');
  assert.equal(w.name, 'Wall of Stolen Identity');
  Bot.refreshGrants(game, defOf);
  Game.nextTurn(game.bot.s);
  assert.equal(giant.tapped, false);
});

test('Dusk // Dawn: Dawn is cast from the graveyard and returns small creatures', () => {
  const game = vsOpp();
  const dd = game.cards[find(game, 'dusk')];
  assert.deepEqual(Bot.aftermathOf(dd, defOf), { name: 'Dawn', cost: '{3}{W}{W}' });
  Game.move(game, find(game, 'glare'), 'graveyard');
  Game.move(game, find(game, 'giant'), 'graveyard');
  Bot.runEffect(game, 'Return all creature cards with power 2 or less from your graveyard to your hand', ctx(game));
  assert.ok(game.zones.hand.some(i => game.cards[i].name === 'Wall of Glare'));
  assert.ok(game.zones.graveyard.some(i => game.cards[i].name === 'Hill Giant'));
});

test('Slaughter the Strong keeps the walls; Wave of Reckoning; Fell the Mighty', () => {
  const game = vsOpp();
  const wall = put(game, 'glare');
  const tree = put(game, 'tree');
  const giant = put(game, 'giant');
  const bear = put(game.bot.s, 'bear');
  const ogre = put(game.bot.s, 'ogre');
  const big = put(game.bot.s, 'giant');
  Bot.runEffect(game, defs.slaughter.oracle, ctx(game));
  assert.equal(wall.zone, 'battlefield');
  assert.equal(tree.zone, 'battlefield');
  assert.equal(giant.zone, 'battlefield'); // power 3 fits under 4
  assert.equal([bear, ogre, big].filter(c => c.zone === 'battlefield').length, 2); // Opp keeps two 2-power creatures
  const g2 = vsOpp();
  const w2 = put(g2, 'glare');
  const b2 = put(g2.bot.s, 'bear');
  Bot.runEffect(g2, defs.wave.oracle, ctx(g2));
  assert.equal(w2.zone, 'battlefield');
  assert.equal(b2.zone, 'graveyard');
  const g3 = vsOpp();
  const w3 = put(g3, 'glare');
  const ogre3 = put(g3.bot.s, 'ogre');
  Bot.applyTarget(g3, g3, w3, Bot.targetEffect(defs.fell.oracle), 'Fell the Mighty', defOf, g3);
  assert.equal(ogre3.zone, 'graveyard');
  assert.equal(w3.zone, 'battlefield');
});

test('The Battle of Bywater makes a Food for each creature you have left', () => {
  const game = vsOpp();
  put(game, 'glare');
  put(game, 'tree');
  put(game, 'giant');
  Bot.runEffect(game, defs.bywater.oracle, ctx(game));
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.name === 'Food').length, 2);
});

test('Eerie Interlude exiles your creatures and brings them back at the next end step', () => {
  const game = vsOpp();
  const wall = put(game, 'glare');
  let asked = null;
  Bot.runEffect(game, defs.eerie.oracle, ctx(game, { flicker: what => { asked = what; } }));
  assert.equal(asked, 'creatures');
  Bot.flickerOut(game, game, [wall.iid], 'Eerie Interlude');
  assert.equal(wall.zone, 'exile');
  Bot.flickerReturn(game);
  assert.equal(wall.zone, 'battlefield');
});

test('Cycling, transmute and Reliquary Tower', () => {
  const game = vsOpp();
  assert.deepEqual(Bot.handAbilities(game.cards[find(game, 'spara')], defOf).map(a => a.kind), ['cycling']);
  assert.deepEqual(Bot.handAbilities(game.cards[find(game, 'drift')], defOf).map(a => [a.kind, a.cost]), [['transmute', '{1}{U}{U}']]);
  const three = Bot.searchable(game, { what: '', mv: 3 }, defOf).map(i => game.cards[i].cmc);
  assert.ok(three.length && three.every(n => n === 3));
  put(game.bot.s, 'tower');
  assert.equal(Bot.noMaxHand(game.bot.s, defOf), true);
});

test('Jeskai Barricade returns another creature you control', () => {
  const eff = Bot.targetEffect("return another target creature you control to its owner's hand");
  assert.deepEqual([eff.action, eff.another], ['bounce', true]);
});
