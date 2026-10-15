const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');

const defs = {
  mountain: { id: 'mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'] },
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '' },
  goblin: { id: 'goblin', name: 'Raging Goblin', typeLine: 'Creature — Goblin', manaCost: '{R}', cmc: 1, power: '1', toughness: '1', oracle: 'Haste' },
  bolt: { id: 'bolt', name: 'Lightning Bolt', typeLine: 'Instant', manaCost: '{R}', cmc: 1, oracle: 'Lightning Bolt deals 3 damage to any target.' },
  wall: { id: 'wall', name: 'Wall of Wood', typeLine: 'Creature — Wall', manaCost: '{G}', cmc: 1, power: '0', toughness: '3', oracle: 'Defender' },
  arrest: { id: 'arrest', name: 'Arrest', typeLine: 'Enchantment — Aura', manaCost: '{2}{W}', cmc: 3, oracle: "Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated." },
  bird: { id: 'bird', name: 'Wind Drake', typeLine: 'Creature — Drake', manaCost: '{2}{G}', cmc: 3, power: '2', toughness: '2', oracle: 'Flying' },
};
const deck = (name, rows) => ({ key: name, name, rows });
const defOf = id => defs[id];

test('reads keywords and simple spells', () => {
  assert.deepEqual(Bot.keywords('Flying, vigilance\nWhen this enters, draw a card.'), ['flying', 'vigilance']);
  assert.deepEqual(Bot.keywords('Creatures you control have flying.'), []);
  assert.deepEqual(Bot.spellEffect('Lightning Bolt deals 3 damage to any target.'), { damage: 3, creature: true, player: true });
  assert.deepEqual(Bot.spellEffect('Destroy target creature.'), { kill: true, exile: false });
  assert.deepEqual(Bot.spellEffect('Draw two cards.'), { draw: 2 });
  assert.equal(Bot.spellEffect('Destroy target creature with flying.'), null);
});

test('combat: first strike and deathtouch', () => {
  const st = (pow, tou, kw = []) => ({ pow, tou, kw: new Set(kw), cmc: 0 });
  let r = Bot.fight(st(2, 2, ['first strike']), st(2, 2));
  assert.equal(r.a.dead, false);
  assert.equal(r.b.dead, true);
  r = Bot.fight(st(1, 1, ['deathtouch']), st(5, 5));
  assert.equal(r.a.dead, true);
  assert.equal(r.b.dead, true);
  assert.equal(Bot.canBlock(st(2, 2), st(2, 2, ['flying'])), false);
  assert.equal(Bot.canBlock(st(2, 2, ['reach']), st(2, 2, ['flying'])), true);
});

test('combat: menace, several blockers and trample', () => {
  const st = (pow, tou, kw = []) => ({ pow, tou, kw: new Set(kw), cmc: 0 });
  assert.equal(Bot.legalBlock(st(2, 2, ['menace']), 1), false);
  assert.equal(Bot.legalBlock(st(2, 2, ['menace']), 2), true);
  let r = Bot.combat(st(3, 3, ['menace']), [st(2, 2), st(2, 2)]);
  assert.equal(r.a.dead, true);
  assert.deepEqual(r.b.map(b => b.dead), [true, false]);
  r = Bot.combat(st(5, 5, ['trample']), [st(2, 2), st(1, 1)]);
  assert.equal(r.player, 2);
  r = Bot.combat(st(3, 3, ['double strike', 'lifelink']), [st(2, 2)]);
  assert.equal(r.a.dealt, 3); // the blocker is gone before the second strike
  assert.equal(Bot.combat(st(3, 3, ['double strike']), []).player, 6);
});

test('Opp plays lands and spells and attacks an empty board', () => {
  const game = Game.create(deck('You', [{ id: 'forest', qty: 40 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'mountain', qty: 20 }, { id: 'goblin', qty: 20 }]), defs, { onDraw: false });
  game.oppLife = 20;
  for (let turn = 0; turn < 5; turn++) {
    Bot.beginTurn(game, defOf);
    if (game.bot.pending) Bot.resolveOppAttack(game, {}, defOf);
    Bot.endTurn(game, defOf);
  }
  const s = game.bot.s;
  assert.ok(s.zones.battlefield.filter(iid => Game.isLand(s.cards[iid])).length >= 4);
  assert.ok(s.zones.battlefield.filter(iid => Game.isCreature(s.cards[iid])).length >= 3);
  assert.ok(game.life < 20, 'hasty goblins should have hit you');
  assert.ok(s.zones.hand.length <= 7);
});

test('Opp blocks well and bolts a creature', () => {
  const game = Game.create(deck('You', [{ id: 'bear', qty: 40 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'wall', qty: 40 }]), defs, { onDraw: true });
  game.oppLife = 20;
  const s = game.bot.s;
  const wall = s.zones.hand[0];
  Game.move(s, wall, 'battlefield');
  const bear = game.zones.hand[0];
  Game.move(game, bear, 'battlefield');
  Bot.resolveYourAttack(game, [bear], defOf);
  assert.equal(game.oppLife, 20, 'the wall blocks the bear');
  assert.equal(game.cards[bear].tapped, true);

  // Bolt: Opp has a Mountain and Lightning Bolt, you have a bear.
  const g2 = Game.create(deck('You', [{ id: 'bear', qty: 40 }]), defs);
  g2.bot = Bot.create(deck('Opp', [{ id: 'mountain', qty: 1 }, { id: 'bolt', qty: 1 }, { id: 'forest', qty: 38 }]), defs, { onDraw: true });
  g2.oppLife = 20;
  const b2 = g2.bot.s;
  for (const id of ['mountain', 'bolt']) {
    const iid = Object.keys(b2.cards).find(k => b2.cards[k].id === id);
    const at = b2.zones[b2.cards[iid].zone].indexOf(iid);
    b2.zones[b2.cards[iid].zone].splice(at, 1);
    b2.cards[iid].zone = id === 'mountain' ? 'battlefield' : 'hand';
    b2.zones[b2.cards[iid].zone].push(iid);
  }
  b2.landPlayed = true;
  b2.started = true;
  g2.bot.started = true;
  const yourBear = g2.zones.hand[0];
  Game.move(g2, yourBear, 'battlefield');
  b2.landPlayed = false;
  b2.turn = 0; // nextTurn makes it 1 and untaps
  Bot.beginTurn(g2, defOf);
  assert.equal(g2.cards[yourBear].zone, 'graveyard');
});

test('a full game between two decks finishes without errors', () => {
  const rows = [{ id: 'mountain', qty: 10 }, { id: 'forest', qty: 10 }, { id: 'bear', qty: 8 }, { id: 'goblin', qty: 6 }, { id: 'bolt', qty: 4 }, { id: 'bird', qty: 2 }];
  const game = Game.create(deck('You', rows), defs);
  game.bot = Bot.create(deck('Opp', rows), defs, { onDraw: false });
  game.oppLife = 20;
  for (let t = 0; t < 40 && game.life > 0 && game.oppLife > 0; t++) {
    Bot.beginTurn(game, defOf);
    if (game.bot.pending) Bot.resolveOppAttack(game, {}, defOf);
    Bot.endTurn(game, defOf);
  }
  assert.ok(game.life <= 0, 'Opp should beat a player who does nothing');
  JSON.parse(JSON.stringify(game)); // still saves
});

test('spellPump pumps your creatures until end of turn, keywords too', () => {
  const s = { zones: { battlefield: [] }, cards: {}, log: [], turn: 1 };
  const put = (iid, d) => { s.cards[iid] = { iid, id: d.id, name: d.name, typeLine: d.typeLine, zone: 'battlefield', counters: {} }; s.zones.battlefield.push(iid); };
  put('a', defs.bear);
  put('b', defs.goblin);
  const spells = {
    overrun: { id: 'overrun', name: 'Overrun', typeLine: 'Sorcery', oracle: 'Creatures you control get +3/+3 and gain trample until end of turn.' },
    goblins: { id: 'goblins', name: 'Goblin War Cry', typeLine: 'Instant', oracle: 'Goblins you control get +1/+0 until end of turn.' },
    giant: { id: 'giant', name: 'Giant Growth', typeLine: 'Instant', oracle: 'Target creature gets +3/+3 until end of turn.' },
  };
  const defOf = id => spells[id] || defs[id];
  const cast = d => Bot.spellPump(s, { name: d.name, id: d.id, typeLine: d.typeLine }, defOf);
  assert.equal(cast(spells.overrun), true);
  assert.equal(cast(spells.goblins), true);
  assert.equal(cast(spells.giant), false);
  assert.deepEqual(s.cards.a.pump, { pow: 3, tou: 3, kw: ['trample'] });
  assert.deepEqual(s.cards.b.pump, { pow: 4, tou: 3, kw: ['trample'] });
  assert.ok(Bot.stats(s.cards.a, defs.bear).kw.has('trample'));
  Game.endOfTurn(s);
  assert.equal(s.cards.a.pump, undefined);
});

test('counterLast sends the newest spell to the graveyard, or takes back its pump; lands stay tapped', () => {
  const s = Game.create(deck('t', [{ id: 'forest', qty: 5 }, { id: 'bear', qty: 5 }]), defs);
  const forest = Object.values(s.cards).find(c => c.id === 'forest');
  const bear = Object.values(s.cards).find(c => c.id === 'bear');
  for (const c of [forest, bear]) { s.zones[c.zone].splice(s.zones[c.zone].indexOf(c.iid), 1); c.zone = 'hand'; s.zones.hand.push(c.iid); }
  Game.move(s, forest.iid, 'battlefield');
  assert.equal(s.lastCast, undefined); // lands aren't cast
  Game.setTapped(s, forest.iid, true, 'G');
  Game.move(s, bear.iid, 'battlefield');
  assert.equal(s.lastCast.iid, bear.iid);
  assert.match(Game.counterLast(s), /Grizzly Bears was countered/);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(forest.tapped, true);
  assert.equal(Game.counterLast(s), null); // nothing left to counter

  const spell = { id: 'overrun', name: 'Overrun', typeLine: 'Sorcery', zone: 'graveyard', counters: {} };
  s.cards.x = Object.assign({ iid: 'x' }, spell);
  const bear2 = Object.values(s.cards).find(c => c.id === 'bear' && c !== bear);
  s.zones[bear2.zone].splice(s.zones[bear2.zone].indexOf(bear2.iid), 1);
  bear2.zone = 'battlefield';
  s.zones.battlefield.push(bear2.iid);
  Bot.spellPump(s, s.cards.x, id => (id === 'overrun' ? { oracle: 'Creatures you control get +3/+3 until end of turn.' } : defs[id]));
  assert.equal(bear2.pump.pow, 3);
  s.lastCast = { iid: 'x', at: 1 };
  assert.match(Game.counterLast(s), /Overrun was countered/);
  assert.equal(bear2.pump, undefined);
});

test('isCounterspell', () => {
  assert.ok(Game.isCounterspell('Counter target spell.'));
  assert.ok(Game.isCounterspell('Counter target noncreature spell unless its controller pays {3}.'));
  assert.ok(!Game.isCounterspell('Lightning Bolt deals 3 damage to any target.'));
  assert.ok(!Game.isCounterspell('Counter target activated or triggered ability.'));
});

test('Commander games draw on turn 1 even on the play', () => {
  const cmd = Game.create({ key: 'c', name: 'c', rows: [{ id: 'bear', qty: 1, commander: true }, { id: 'forest', qty: 20 }] }, defs);
  assert.equal(cmd.zones.hand.length, 8);
  const plain = Game.create(deck('p', [{ id: 'forest', qty: 20 }]), defs);
  assert.equal(plain.zones.hand.length, 7);
});

test('Leonin Warleader makes two lifelink Cats that are tapped and attacking, and they deal damage', () => {
  const warleader = { id: 'warleader', name: 'Leonin Warleader', typeLine: 'Creature — Cat Soldier', manaCost: '{2}{W}{W}', cmc: 4, power: '4', toughness: '4',
    oracle: 'Whenever Leonin Warleader attacks, create two 1/1 white Cat creature tokens with lifelink that are tapped and attacking.' };
  const all = Object.assign({ warleader }, defs);
  const game = Game.create(deck('You', [{ id: 'warleader', qty: 40 }]), all);
  game.bot = Bot.create(deck('Opp', [{ id: 'forest', qty: 40 }]), all, { onDraw: true });
  game.oppLife = 20;
  game.life = 20;
  const w = game.zones.hand[0];
  Game.move(game, w, 'battlefield');
  Bot.resolveYourAttack(game, [w], id => all[id]);
  const cats = game.zones.battlefield.map(iid => game.cards[iid]).filter(c => c.token);
  assert.equal(cats.length, 2);
  assert.ok(cats.every(c => c.tapped && c.attackedTurn === game.turn && /Cat/.test(c.typeLine)));
  assert.equal(game.oppLife, 14); // 4 + 1 + 1
  assert.equal(game.life, 22); // lifelink on both Cats
});

const brimaz = { id: 'brimaz', name: 'Brimaz, King of Oreskos', typeLine: 'Legendary Creature — Cat Soldier', manaCost: '{1}{W}{W}', cmc: 3, power: '3', toughness: '4',
  oracle: "Vigilance\nWhenever Brimaz, King of Oreskos attacks, create a 1/1 white Cat Soldier creature token with vigilance that's attacking.\nWhenever Brimaz, King of Oreskos blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature." };

test("Brimaz's Cat attacks untapped (vigilance) and deals damage", () => {
  const all = Object.assign({ brimaz }, defs);
  const game = Game.create(deck('You', [{ id: 'brimaz', qty: 40 }]), all);
  game.bot = Bot.create(deck('Opp', [{ id: 'forest', qty: 40 }]), all, { onDraw: true });
  game.oppLife = 20;
  const b = game.zones.hand[0];
  Game.move(game, b, 'battlefield');
  Bot.resolveYourAttack(game, [b], id => all[id]);
  const cats = game.zones.battlefield.map(iid => game.cards[iid]).filter(c => c.token);
  assert.equal(cats.length, 1);
  assert.equal(cats[0].tapped, false);
  assert.equal(game.cards[b].tapped, false);
  assert.equal(game.oppLife, 16); // 3 + 1
});

test("Brimaz's Cat blocks the same attacker", () => {
  const ogre = { id: 'ogre', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '3', toughness: '3', oracle: '' };
  const all = Object.assign({ brimaz, ogre }, defs);
  const game = Game.create(deck('You', [{ id: 'brimaz', qty: 40 }]), all);
  game.bot = Bot.create(deck('Opp', [{ id: 'ogre', qty: 40 }]), all, {});
  const s = game.bot.s;
  const giant = s.zones.hand[0];
  Game.move(s, giant, 'battlefield');
  const b = game.zones.hand[0];
  Game.move(game, b, 'battlefield');
  game.bot.pending = { attackers: [giant], targets: {} };
  game.life = 20;
  const msg = Bot.resolveOppAttack(game, { [giant]: b }, id => all[id]);
  assert.equal(s.cards[giant].zone, 'graveyard'); // 3 from Brimaz + 1 from the Cat
  assert.equal(game.life, 20);
  assert.match(msg, /Cat Soldier/);
});

const sentinel = { id: 'sentinel', name: 'Sentinel of the Eternal Watch', typeLine: 'Creature — Giant Soldier', manaCost: '{5}{W}', cmc: 6, power: '4', toughness: '6',
  oracle: "Vigilance (Attacking doesn't cause this creature to tap.)\nAt the beginning of combat on each opponent's turn, tap target creature that player controls." };

test("your Sentinel stops Opp at its beginning of combat for you to pick what it taps", () => {
  const giant = { id: 'giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '3', toughness: '3', oracle: '' };
  const all = Object.assign({ sentinel, giant }, defs);
  const game = Game.create(deck('You', [{ id: 'sentinel', qty: 40 }]), all);
  game.bot = Bot.create(deck('Opp', [{ id: 'giant', qty: 30 }, { id: 'goblin', qty: 10 }]), all, {});
  game.bot.started = true;
  const s = game.bot.s;
  const g = Object.values(s.cards).find(c => c.id === 'giant');
  s.zones[g.zone].splice(s.zones[g.zone].indexOf(g.iid), 1);
  g.zone = 'hand';
  s.zones.hand.push(g.iid);
  Game.move(s, g.iid, 'battlefield');
  g.enteredTurn = -5;
  Game.move(game, game.zones.hand[0], 'battlefield');
  const first = Bot.beginTurn(game, id => all[id]);
  assert.equal(first.tapChoice, true);
  assert.deepEqual(first.attackers, []);
  assert.equal(g.tapped, false); // nothing tapped until you pick
  const choices = Bot.tapChoices(game, id => all[id]);
  assert.equal(choices.tappers.length, 1);
  assert.ok(choices.targets.some(x => x.inst === g));
  const res = Bot.beginCombat(game, id => all[id], { [choices.tappers[0].iid]: g.iid }, game.bot.tapChoice.notes);
  assert.equal(game.bot.tapChoice, undefined);
  assert.ok(!res.attackers.includes(g.iid));
  assert.equal(g.tapped, true);
  assert.ok(res.notes.some(n => /Hill Giant tapped by your Sentinel/.test(n)));
});

const akroma = { id: 'akroma', name: "Akroma's Will", typeLine: 'Instant', manaCost: '{3}{W}', cmc: 4,
  oracle: 'Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Creatures you control gain flying, vigilance, and double strike until end of turn.\n• Creatures you control gain lifelink, indestructible, and protection from each color until end of turn.' };

test("Akroma's Will: one mode, or both with a commander", () => {
  const all = Object.assign({ akroma }, defs);
  const game = Game.create(deck('You', [{ id: 'bear', qty: 10 }, { id: 'akroma', qty: 30 }]), all);
  const of = id => all[id];
  const bear = Object.values(game.cards).find(c => c.id === 'bear');
  Game.move(game, bear.iid, 'battlefield');
  const will = Object.values(game.cards).find(c => c.id === 'akroma');
  const info = Bot.spellModes(will, of);
  assert.equal(info.modes.length, 2);
  assert.equal(info.pick, 1);
  assert.equal(info.commanderPick, 2);
  assert.equal(Bot.spellPump(game, will, of), false); // modal: left for you to pick
  assert.deepEqual(Bot.runModes(game, will, of, [0, 1]), []);
  const kw = Bot.stats(bear, defs.bear).kw;
  for (const k of ['flying', 'vigilance', 'double strike', 'lifelink', 'indestructible', 'protection from each color']) assert.ok(kw.has(k), k);
});

test('protection from each color: no colored blockers, no damage from colored creatures', () => {
  const st = (pow, tou, kw = [], colors = ['R']) => ({ pow, tou, kw: new Set(kw), cmc: 0, colors });
  const pro = st(2, 2, ['protection from each color'], ['W']);
  assert.equal(Bot.canBlock(st(5, 5), pro), false);
  assert.equal(Bot.canBlock(st(5, 5, [], []), pro), true); // a colorless artifact creature can
  const r = Bot.fight(st(5, 5), pro); // it blocks a red 5/5
  assert.equal(r.b.dead, false);
  assert.equal(r.a.dead, false);
  assert.equal(r.b.dealt, 2);
});

test("Opp's Sentinel taps your best attacker once per turn", () => {
  const all = Object.assign({ sentinel }, defs);
  const game = Game.create(deck('You', [{ id: 'bird', qty: 20 }, { id: 'goblin', qty: 20 }]), all);
  game.bot = Bot.create(deck('Opp', [{ id: 'sentinel', qty: 40 }]), all, {});
  const s = game.bot.s;
  Game.move(s, s.zones.hand[0], 'battlefield');
  for (const iid of [...game.zones.hand]) { Game.move(game, iid, 'battlefield'); game.cards[iid].enteredTurn = -5; }
  const msgs = Bot.oppCombatTaps(game, id => all[id]);
  assert.equal(msgs.length, 1);
  const hasDrake = game.zones.battlefield.some(iid => game.cards[iid].id === 'bird');
  assert.match(msgs[0], hasDrake ? /Wind Drake/ : /Raging Goblin/); // the flyer is worth more than the goblin
  assert.deepEqual(Bot.oppCombatTaps(game, id => all[id]), []); // not again this turn
});

test('keyword counters you name yourself, spelled loosely', () => {
  const inst = { counters: { flying: 1, doublestrike: 1, indestructable: 1, 'protection from white': 1, '+1/+1': 2 } };
  const st = Bot.stats(inst, defs.bear);
  for (const k of ['flying', 'double strike', 'indestructible', 'protection from W']) assert.ok(st.kw.has(k), k);
  assert.equal(st.pow, 4);
  const white = { pow: 3, tou: 3, kw: new Set(), cmc: 0, colors: ['W'] };
  const red = { pow: 3, tou: 3, kw: new Set(), cmc: 0, colors: ['R'] };
  const pro = Bot.stats({ counters: { 'protection from white': 1 } }, defs.bear);
  assert.equal(Bot.canBlock(white, pro), false);
  assert.equal(Bot.canBlock(red, pro), true);
  assert.deepEqual(Bot.keywords('Protection from white and from blue'), ['protection from W U']);
});

test("Arrest on Opp's creature: it can't attack or block, and the Arrest leaves when it does", () => {
  assert.deepEqual(Bot.attachBonus(defs.arrest.oracle), { pow: 0, tou: 0, kw: [], cantAttack: true, cantBlock: true, noAbilities: true });
  const game = Game.create(deck('You', [{ id: 'arrest', qty: 10 }, { id: 'bear', qty: 10 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'goblin', qty: 40 }]), defs, { onDraw: false });
  game.oppLife = 20;
  const o = game.bot.s;
  const gob = o.cards[o.zones.hand[0]];
  Game.move(o, gob.iid, 'battlefield');
  gob.enteredTurn = -5;
  const arrest = game.cards[game.zones.library.concat(game.zones.hand).find(i => game.cards[i].id === 'arrest')];
  Game.move(game, arrest.iid, 'battlefield');
  arrest.enchanting = { pid: 'bot', iid: gob.iid, name: gob.name, bonus: Bot.attachBonus(defs.arrest.oracle) };
  Bot.syncAuras(game);
  const st = Bot.botStats(gob);
  assert.ok(Bot.noAttack(st));
  assert.equal(Bot.canBlock(st, Bot.stats(game.cards[game.zones.hand[0]], defs.bear), game), false);
  Bot.syncAuras(game); // running it again doesn't stack
  assert.equal(Object.keys(gob.boosts).length, 1);

  Game.move(o, gob.iid, 'graveyard');
  Bot.syncAuras(game);
  assert.equal(arrest.zone, 'graveyard');
  assert.equal(arrest.enchanting, undefined);
});