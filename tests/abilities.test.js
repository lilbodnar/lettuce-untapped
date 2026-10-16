const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');

const defs = {
  swamp: { id: 'swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'] },
  rats: {
    id: 'rats', name: 'Earsplitting Rats', typeLine: 'Creature — Rat', manaCost: '{3}{B}', cmc: 4, power: '2', toughness: '1',
    oracle: 'When Earsplitting Rats enters, each player discards a card.\nDiscard a card: Regenerate Earsplitting Rats.',
  },
  ashcoat: {
    id: 'ashcoat', name: 'Ashcoat of the Shadow Swarm', typeLine: 'Legendary Creature — Rat Warlock', manaCost: '{3}{B}', cmc: 4, power: '3', toughness: '4',
    oracle: 'Whenever Ashcoat attacks or blocks, other Rats you control get +X/+X until end of turn, where X is the number of Rats you control.\n'
      + 'At the beginning of your end step, you may mill four cards. If you do, return up to two Rat creature cards from your graveyard to your hand.',
  },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '' },
  warchief: { id: 'warchief', name: 'Goblin Warchief', typeLine: 'Creature — Goblin Warrior', manaCost: '{1}{R}{R}', cmc: 3, power: '2', toughness: '2', oracle: 'Goblin spells you cast cost {1} less to cast.\nGoblins you control have haste.' },
  bobcat: { id: 'bobcat', name: 'Penumbra Bobcat', typeLine: 'Creature — Cat', manaCost: '{2}{G}', cmc: 3, power: '2', toughness: '1', oracle: 'When this creature dies, create a 2/1 black Cat creature token.' },
  sovereign: { id: 'sovereign', name: 'Pride Sovereign', typeLine: 'Creature — Cat', manaCost: '{2}{G}', cmc: 3, power: '2', toughness: '2', oracle: 'Pride Sovereign gets +1/+1 for each other Cat you control.\n{W}, {T}, Exert Pride Sovereign: Create two 1/1 white Cat creature tokens with lifelink.' },
  elflord: { id: 'elflord', name: 'Elvish Lord', typeLine: 'Creature — Elf', manaCost: '{1}{G}', cmc: 2, power: '1', toughness: '1', oracle: 'Other Elves you control get +1/+1 and have trample.\n{2}: Elves you control get +1/+1 until end of turn.' },
  welcome: { id: 'welcome', name: "Ajani's Welcome", typeLine: 'Enchantment', manaCost: '{W}', cmc: 1, oracle: 'Whenever a creature you control enters, you gain 1 life.' },
  miles: { id: 'miles', name: 'Spider-Man, Miles Morales', typeLine: 'Legendary Creature — Spider Human Hero', manaCost: '{4}{G}{G}', cmc: 6, power: '5', toughness: '5', oracle: "Vigilance, trample (Attacking doesn't cause this creature to tap. He can deal excess combat damage to the player he's attacking.)\nWhenever Spider-Man enters or attacks, put a +1/+1 counter on each other creature you control. Those creatures gain trample until end of turn." },
  elf: { id: 'elf', name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid', manaCost: '{G}', cmc: 1, power: '1', toughness: '1', oracle: '' },
  goblin: { id: 'goblin', name: 'Goblin Piker', typeLine: 'Creature — Goblin Warrior', manaCost: '{1}{R}', cmc: 2, power: '2', toughness: '1', oracle: '' },
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const st = (pow, tou, kw = [], extra = {}) => Object.assign({ pow, tou, kw: new Set(kw), cmc: 0, colors: [], artifact: false }, extra);

// Puts a card from the library (or hand) straight onto the battlefield, able to attack.
function put(s, id) {
  const iid = s.zones.library.find(i => s.cards[i].id === id) || s.zones.hand.find(i => s.cards[i].id === id);
  Game.move(s, iid, 'battlefield');
  s.cards[iid].enteredTurn = 0;
  return s.cards[iid];
}

test('fear, intimidate, skulk and shadow limit blockers', () => {
  const black = st(2, 2, [], { colors: ['B'] });
  const green = st(2, 2, [], { colors: ['G'] });
  const robot = st(2, 2, [], { artifact: true });
  assert.equal(Bot.canBlock(green, st(2, 2, ['fear'], { colors: ['B'] })), false);
  assert.equal(Bot.canBlock(black, st(2, 2, ['fear'])), true);
  assert.equal(Bot.canBlock(robot, st(2, 2, ['fear'])), true);
  assert.equal(Bot.canBlock(green, st(2, 2, ['intimidate'], { colors: ['R'] })), false);
  assert.equal(Bot.canBlock(green, st(2, 2, ['intimidate'], { colors: ['R', 'G'] })), true);
  assert.equal(Bot.canBlock(robot, st(2, 2, ['intimidate'], { colors: ['R'] })), true);
  assert.equal(Bot.canBlock(st(3, 3), st(2, 2, ['skulk'])), false);
  assert.equal(Bot.canBlock(st(2, 3), st(2, 2, ['skulk'])), true);
  assert.equal(Bot.canBlock(green, st(2, 2, ['shadow'])), false);
  assert.equal(Bot.canBlock(st(2, 2, ['shadow']), green), false);
  assert.equal(Bot.canBlock(st(2, 2, ['shadow']), st(2, 2, ['shadow'])), true);
  assert.deepEqual(Bot.colorsOf({ manaCost: '{1}{B/G}' }), ['B', 'G']);
  assert.deepEqual(Bot.keywords('Fear'), ['fear']);
});

test('discard costs and regeneration shields', () => {
  const s = Game.create(deck('You', [{ id: 'rats', qty: 10 }, { id: 'swamp', qty: 10 }]), defs);
  const rats = put(s, 'rats');
  const [ab] = Bot.activatedAbilities(rats, defOf);
  assert.equal(ab.discard, 1);
  assert.deepEqual(Bot.runEffect(s, ab.effect, { self: rats }), []);
  assert.equal(rats.regen, 1);
  assert.equal(Bot.regenerates(s, rats, defOf, false), true);
  assert.equal(rats.tapped, true);
  assert.equal(rats.regen, undefined);
  assert.equal(Bot.regenerates(s, rats, defOf, false), false); // no shield left
  rats.regen = 1;
  Game.nextTurn(s);
  assert.equal(rats.regen, undefined); // shields wear off at end of turn
});

test('Opp pays to regenerate its Rats when they would die in combat', () => {
  const game = Game.create(deck('You', [{ id: 'bear', qty: 30 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'rats', qty: 30 }]), defs, { onDraw: false });
  game.oppLife = 20;
  const s = game.bot.s;
  const rats = put(s, 'rats');
  const bear = put(game, 'bear');
  const hand = s.zones.hand.length;
  game.bot.pending = { attackers: [rats.iid], targets: {} };
  Bot.resolveOppAttack(game, { [rats.iid]: [bear.iid] }, defOf);
  assert.equal(rats.zone, 'battlefield'); // regenerated
  assert.equal(s.zones.hand.length, hand - 1); // by discarding a card
  assert.equal(bear.zone, 'graveyard');
});

test('reads "each player discards a card" when a creature enters', () => {
  assert.deepEqual(Game.enterDiscard('Earsplitting Rats', defs.rats.oracle), { you: 1, opp: 1, random: false });
  assert.equal(Game.enterDiscard('Grizzly Bears', ''), null);
});

test('Opp casting Earsplitting Rats makes both players discard', () => {
  const game = Game.create(deck('You', [{ id: 'bear', qty: 30 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'swamp', qty: 4 }, { id: 'rats', qty: 26 }]), defs, { onDraw: false });
  game.oppLife = 20;
  const s = game.bot.s;
  for (let i = 0; i < 4; i++) put(s, 'swamp');
  const before = s.zones.graveyard.length;
  Bot.beginTurn(game, defOf);
  assert.ok(s.zones.battlefield.some(i => s.cards[i].id === 'rats'));
  assert.equal(s.zones.graveyard.length, before + 1); // Opp discarded one
  assert.equal(game.mustDiscard.n, 1); // you get asked which card
});

test('Ashcoat pumps the other Rats when it attacks, until end of turn', () => {
  const s = Game.create(deck('You', [{ id: 'ashcoat', qty: 1 }, { id: 'rats', qty: 20 }]), defs);
  const ash = put(s, 'ashcoat');
  const r1 = put(s, 'rats');
  const r2 = put(s, 'rats');
  Bot.combatTrigger(s, ash, 'attacks', defOf);
  assert.deepEqual(r1.pump, { pow: 3, tou: 3 });
  assert.deepEqual(r2.pump, { pow: 3, tou: 3 });
  assert.equal(ash.pump, undefined); // "other Rats"
  assert.equal(Bot.stats(r1, defs.rats).pow, 5);
  Game.endOfTurn(s);
  assert.equal(Bot.stats(r1, defs.rats).pow, 2);
});

test("Ashcoat's end step trigger is found, and Opp uses it", () => {
  const game = Game.create(deck('You', [{ id: 'bear', qty: 30 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'ashcoat', qty: 1 }, { id: 'rats', qty: 39 }]), defs, { onDraw: false });
  game.oppLife = 20;
  const s = game.bot.s;
  put(s, 'ashcoat');
  const [t] = Bot.endStepTriggers(s, defOf);
  assert.deepEqual({ mill: t.mill, up: t.up, what: t.what }, { mill: 4, up: 2, what: 'Rat creature' });
  while (s.zones.hand.length) Game.move(s, s.zones.hand[0], 'exile'); // empty hand, so it casts nothing
  Bot.endTurn(game, defOf);
  assert.equal(s.zones.graveyard.length, 2); // milled 4, two Rats came back
  assert.equal(s.zones.hand.length, 2);
});

test('haste from a lord lets a creature attack the turn it arrives', () => {
  const game = Game.create(deck('You', [{ id: 'warchief', qty: 1 }, { id: 'goblin', qty: 20 }, { id: 'bear', qty: 5 }]), defs);
  put(game, 'warchief');
  const gob = put(game, 'goblin');
  const bear = put(game, 'bear');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(gob, defs.goblin).kw.has('haste'));
  assert.ok(!Bot.stats(bear, defs.bear).kw.has('haste'));
  assert.equal(Game.discount(game, { typeLine: 'Creature — Goblin' }, i => (defs[i.id] || {}).oracle), 1);
});

test('on the draw, the first-turn card is drawn on top of 7 and kept after a mulligan', () => {
  const s = Game.create(deck('You', [{ id: 'bear', qty: 40 }]), defs, { onDraw: true });
  assert.equal(s.zones.hand.length, 8);
  assert.equal(s.zones.hand.filter(i => s.cards[i].newAt).length, 1); // only that card lights up
  Game.mulligan(s);
  assert.equal(s.zones.hand.length, 8);
  const p = Game.create(deck('You', [{ id: 'bear', qty: 40 }]), defs, { onDraw: false });
  assert.equal(p.zones.hand.length, 7);
  Game.mulligan(p);
  assert.equal(p.zones.hand.length, 7);
});

test('Penumbra Bobcat leaves a 2/1 Cat token when it dies, on either table', () => {
  Game.hooks.died = (s, inst) => Bot.died(s, inst, defOf, null);
  try {
    const s = Game.create(deck('You', [{ id: 'bobcat', qty: 10 }]), defs);
    const cat = put(s, 'bobcat');
    Game.move(s, cat.iid, 'graveyard');
    const toks = s.zones.battlefield.map(i => s.cards[i]).filter(c => c.token);
    assert.equal(toks.length, 1);
    assert.equal(toks[0].custom.pt, '2/1');
    assert.match(toks[0].typeLine, /Cat/);
    Game.move(s, toks[0].iid, 'graveyard'); // the token has no trigger of its own
    assert.equal(s.zones.battlefield.length, 0);
    Game.move(s, s.zones.library[0], 'graveyard'); // milled, not died: nothing
    assert.equal(s.zones.battlefield.length, 0);

    const game = Game.create(deck('You', [{ id: 'bear', qty: 30 }]), defs);
    game.bot = Bot.create(deck('Opp', [{ id: 'bobcat', qty: 30 }]), defs, { onDraw: false });
    const o = game.bot.s;
    Game.move(o, put(o, 'bobcat').iid, 'graveyard');
    const [tok] = o.zones.battlefield.map(i => o.cards[i]).filter(c => c.token);
    assert.equal(tok.bot.power, '2'); // Opp's token has the facts its combat reads
  } finally { Game.hooks.died = null; }
});

test('Pride Sovereign gets +1/+1 for each other Cat, counted all the time', () => {
  const game = Game.create(deck('You', [{ id: 'sovereign', qty: 1 }, { id: 'bobcat', qty: 5 }, { id: 'bear', qty: 5 }]), defs);
  const sov = put(game, 'sovereign');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(sov, defs.sovereign).pow, 2); // no other Cats yet
  put(game, 'bobcat');
  put(game, 'bear');
  Game.createToken(game, { custom: true, name: 'Cat', typeLine: 'Token Creature — Cat', pt: '1/1', text: 'Lifelink' });
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(sov.anthem, { pow: 2, tou: 2 });
  assert.equal(Bot.stats(sov, defs.sovereign).tou, 4);
});

test('A lord gives +1/+1 and keywords to the others, not to itself', () => {
  const game = Game.create(deck('You', [{ id: 'elflord', qty: 1 }, { id: 'elf', qty: 5 }]), defs);
  const lord = put(game, 'elflord');
  const elf = put(game, 'elf');
  Bot.refreshGrants(game, defOf);
  const st = Bot.stats(elf, defs.elf);
  assert.equal(st.pow, 2);
  assert.ok(st.kw.has('trample'));
  assert.equal(lord.anthem, undefined); // "other", and the {2} pump is an activated ability
  Game.move(game, lord.iid, 'graveyard');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(elf, defs.elf).pow, 1);
});

test("Elesh Norn: +2/+2 to your others, -2/-2 to Opp's creatures, and the 2-toughness ones die", () => {
  const norn = { id: 'norn', name: 'Elesh Norn, Grand Cenobite', typeLine: 'Legendary Creature — Phyrexian Praetor', manaCost: '{5}{W}{W}', cmc: 7, power: '4', toughness: '7', oracle: 'Vigilance\nOther creatures you control get +2/+2.\nCreatures your opponents control get -2/-2.' };
  const all = Object.assign({ norn }, defs);
  const game = Game.create(deck('You', [{ id: 'norn', qty: 1 }, { id: 'bear', qty: 29 }]), all);
  game.bot = Bot.create(deck('Opp', [{ id: 'bear', qty: 10 }, { id: 'ashcoat', qty: 10 }]), all, { onDraw: false });
  const o = game.bot.s;
  const mine = put(game, 'bear');
  const theirBear = put(o, 'bear');
  const theirAsh = put(o, 'ashcoat');
  put(game, 'norn');
  Bot.refreshGrants(game, id => all[id]);
  assert.equal(Bot.stats(mine, defs.bear).tou, 4);
  assert.equal(theirBear.zone, 'graveyard'); // 2/2 − 2/2
  assert.equal(theirAsh.zone, 'battlefield');
  assert.deepEqual(theirAsh.anthem, { pow: -2, tou: -2 });
});

test('Kutzil draws a card when a pumped creature hits Opp, not an unpumped one', () => {
  defs.kutzil = { id: 'kutzil', name: 'Kutzil, Malamet Exemplar', typeLine: 'Legendary Creature — Cat Warrior', manaCost: '{1}{G}{W}', cmc: 3, power: '3', toughness: '3', oracle: "Your opponents can't cast spells during your turn.\nWhenever one or more creatures you control each with power greater than its base power deal combat damage to a player, draw a card." };
  const game = Game.create(deck('You', [{ id: 'kutzil', qty: 1 }, { id: 'bear', qty: 30 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'swamp', qty: 30 }]), defs, { onDraw: false });
  game.oppLife = 20;
  put(game, 'kutzil');
  const bear = put(game, 'bear');
  const hand = game.zones.hand.length;
  Bot.resolveYourAttack(game, [bear.iid], defOf);
  assert.equal(game.zones.hand.length, hand, 'a plain 2/2 is not bigger than its base power');
  Game.untapAll(game);
  Game.counter(game, bear.iid, '+1/+1', 1);
  Bot.resolveYourAttack(game, [bear.iid], defOf);
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Feline Sovereign pumps other Cats, and its hit lets you destroy an artifact or enchantment', () => {
  defs.feline = { id: 'feline', name: 'Feline Sovereign', typeLine: 'Creature — Cat', manaCost: '{2}{G}', cmc: 3, power: '2', toughness: '3', oracle: 'Other Cats you control get +1/+1 and have protection from Dogs.\nWhenever one or more Cats you control deal combat damage to a player, destroy up to one target artifact or enchantment that player controls.' };
  defs.rock = { id: 'rock', name: 'Mind Stone', typeLine: 'Artifact', manaCost: '{2}', cmc: 2, oracle: '{T}: Add {C}.' };
  const game = Game.create(deck('You', [{ id: 'feline', qty: 1 }, { id: 'bobcat', qty: 5 }, { id: 'rock', qty: 5 }]), defs);
  game.bot = Bot.create(deck('Opp', [{ id: 'feline', qty: 1 }, { id: 'bobcat', qty: 5 }, { id: 'rock', qty: 24 }]), defs, { onDraw: false });
  game.oppLife = 20;
  const s = game.bot.s;
  put(game, 'feline');
  const cat = put(game, 'bobcat');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(cat.anthem, { pow: 1, tou: 1 });
  Bot.resolveYourAttack(game, [cat.iid], defOf);
  assert.deepEqual(game.mustDestroy, [{ what: 'artifact or enchantment', why: 'Feline Sovereign' }]);

  // Opp's Feline Sovereign hitting you takes your Mind Stone.
  const rock = put(game, 'rock');
  put(s, 'feline');
  const oppCat = put(s, 'bobcat');
  oppCat.bot = Object.assign({}, oppCat.bot);
  game.bot.pending = { attackers: [oppCat.iid] };
  Bot.resolveOppAttack(game, {}, defOf);
  assert.equal(rock.zone, 'graveyard');
});

test("Ajani's Welcome: you gain 1 life for each creature (or token) that enters under your control", () => {
  Game.hooks.entered = (s, inst) => Bot.creatureEntered(s, inst, defOf, {});
  Game.hooks.tokenEntered = Game.hooks.entered;
  try {
    const s = Game.create(deck('You', [{ id: 'welcome', qty: 5 }, { id: 'bobcat', qty: 5 }, { id: 'swamp', qty: 5 }]), defs);
    s.life = 40;
    const card = id => s.zones.library.concat(s.zones.hand).find(i => s.cards[i].id === id);
    Game.move(s, card('bobcat'), 'battlefield');
    assert.equal(s.life, 40); // no Welcome out yet
    Game.move(s, card('welcome'), 'battlefield');
    assert.equal(s.life, 40); // an enchantment isn't a creature
    Game.move(s, card('bobcat'), 'battlefield');
    assert.equal(s.life, 41);
    Game.move(s, card('swamp'), 'battlefield');
    assert.equal(s.life, 41);
    Game.createToken(s, { custom: true, name: 'Cat', typeLine: 'Token Creature — Cat', pt: '2/1' });
    assert.equal(s.life, 42);
    Game.move(s, card('welcome'), 'battlefield'); // two Welcomes: two triggers
    Game.move(s, card('bobcat'), 'battlefield');
    assert.equal(s.life, 44);
  } finally { Game.hooks.entered = null; Game.hooks.tokenEntered = null; }
});

test('Spider-Man, Miles Morales: +1/+1 counters and trample for the others when he enters or attacks', () => {
  Game.hooks.entered = (s, inst) => Bot.enterTrigger(s, inst, defOf);
  try {
    const s = Game.create(deck('You', [{ id: 'miles', qty: 5 }, { id: 'elf', qty: 5 }]), defs);
    const elf = put(s, 'elf');
    const miles = put(s, 'miles');
    assert.equal(elf.counters['+1/+1'], 1);
    assert.equal(miles.counters['+1/+1'], undefined); // "each other creature"
    assert.deepEqual(elf.pump.kw, ['trample']);
    Bot.combatTrigger(s, miles, 'attacks', defOf);
    assert.equal(elf.counters['+1/+1'], 2);
    Bot.combatTrigger(s, miles, 'blocks', defOf); // "enters or attacks" only
    assert.equal(elf.counters['+1/+1'], 2);
    Game.endOfTurn(s);
    assert.equal(elf.pump, undefined); // trample wears off, the counters stay
    assert.equal(elf.counters['+1/+1'], 2);
  } finally { Game.hooks.entered = null; }
});