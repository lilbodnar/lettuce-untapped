const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');

const c = (id, name, typeLine, cost, cmc, pt, oracle) => {
  const [power, toughness] = pt ? pt.split('/') : [];
  return { id, name, typeLine, manaCost: cost, cmc, power, toughness, oracle };
};
const defs = {
  island: { id: 'island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'] },
  swamp: { id: 'swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'] },
  bear: c('bear', 'Grizzly Bears', 'Creature — Bear', '{1}{G}', 2, '2/2', ''),
  giant: c('giant', 'Hill Giant', 'Creature — Giant', '{3}{R}', 4, '3/3', ''),
  drake: c('drake', 'Wind Drake', 'Creature — Drake', '{2}{U}', 3, '2/2', 'Flying'),
  hexer: c('hexer', 'Gladecover Scout', 'Creature — Elf Scout', '{G}', 1, '1/1', 'Hexproof'),
  chupa: c('chupa', 'Ravenous Chupacabra', 'Creature — Horror', '{2}{B}{B}', 4, '2/2', 'When Ravenous Chupacabra enters, destroy target creature an opponent controls.'),
  unsummon: c('unsummon', 'Unsummon', 'Instant', '{U}', 1, null, "Return target creature to its owner's hand."),
  shock: c('shock', 'Shock', 'Instant', '{R}', 1, null, 'Shock deals 2 damage to any target.'),
  giantgrowth: c('giantgrowth', 'Giant Growth', 'Instant', '{G}', 1, null, 'Target creature gets +3/+3 until end of turn.'),
  cancel: c('cancel', 'Cancel', 'Instant', '{1}{U}{U}', 3, null, 'Counter target spell.'),
  doomblade: c('doomblade', 'Doom Blade', 'Instant', '{1}{B}', 2, null, 'Destroy target nonblack creature.'),
  plummet: c('plummet', 'Plummet', 'Instant', '{1}{G}', 2, null, 'Destroy target creature with flying.'),
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const put = (s, id) => {
  const iid = [...s.zones.library, ...s.zones.hand].find(i => s.cards[i].id === id);
  Game.move(s, iid, 'battlefield');
  s.cards[iid].enteredTurn = -1;
  return s.cards[iid];
};
const toHand = (s, id) => {
  const iid = s.zones.library.find(i => s.cards[i].id === id);
  Game.move(s, iid, 'hand');
  return s.cards[iid];
};
const vsOpp = (yours, opps) => {
  const game = Game.create(deck('You', yours.map(id => ({ id, qty: 3 })).concat({ id: 'island', qty: 30 })), defs);
  game.bot = Bot.create(deck('Opp', opps.map(id => ({ id, qty: 3 })).concat({ id: 'swamp', qty: 30 })), defs, { onDraw: true });
  game.life = 20;
  game.oppLife = 20;
  return game;
};

test('reads targeted effects and what they can target', () => {
  assert.deepEqual(Bot.targetEffect('Destroy target creature an opponent controls'), { action: 'destroy', what: 'creature an opponent controls' });
  assert.equal(Bot.targetEffect("Return target creature to its owner's hand").action, 'bounce');
  assert.deepEqual(Bot.targetEffect('Shock deals 2 damage to any target'), { action: 'damage', n: 2, what: 'any target' });
  assert.equal(Bot.targetEffect('Target creature gets +3/+3 until end of turn').pow, 3);
  assert.equal(Bot.targetEffect('Put a +1/+1 counter on target creature').kind, '+1/+1');
  assert.equal(Bot.targetEffect('Destroy target creature with flying').action, 'destroy');
  assert.equal(Bot.targetEffect('Destroy target attacking creature'), null); // left to you
  assert.equal(Bot.targetEffect('Draw two cards'), null);

  const game = vsOpp(['bear', 'drake', 'hexer'], []);
  const st = inst => Bot.stats(inst, defOf(inst.id));
  const bear = put(game, 'bear');
  const drake = put(game, 'drake');
  const hexer = put(game, 'hexer');
  const fly = Bot.targetEffect('Destroy target creature with flying');
  assert.equal(Bot.canTarget(fly, drake, st(drake), false, false), true);
  assert.equal(Bot.canTarget(fly, bear, st(bear), false, false), false);
  const any = Bot.targetEffect('Destroy target creature');
  assert.equal(Bot.canTarget(any, hexer, st(hexer), false, false), false); // hexproof, someone else's effect
  assert.equal(Bot.canTarget(any, hexer, st(hexer), true, false), true); // your own effect
  const theirs = Bot.targetEffect('Destroy target creature an opponent controls');
  assert.equal(Bot.canTarget(theirs, bear, st(bear), true, false), false);
});

test("Opp's Chupacabra destroys your best creature when it enters", () => {
  const game = vsOpp(['bear', 'giant'], ['chupa']);
  const s = game.bot.s;
  const bear = put(game, 'bear');
  const giant = put(game, 'giant');
  const chupa = put(s, 'chupa');
  Bot.enterEffects(game, s, chupa, defOf, null);
  assert.equal(giant.zone, 'graveyard');
  assert.equal(bear.zone, 'battlefield');
});

test('your targeted spell queues a target pick; applyTarget does it', () => {
  const game = vsOpp(['unsummon'], ['giant']);
  const giant = put(game.bot.s, 'giant');
  const asked = [];
  const ctx = { hitOpps: n => { game.oppLife -= n; }, target: (eff, part, src) => asked.push({ eff, part, src: src && src.name }) };
  const u = toHand(game, 'unsummon');
  Game.move(game, u.iid, 'battlefield');
  assert.equal(Bot.spellResolve(game, game, u, defOf, ctx), true);
  assert.equal(u.zone, 'graveyard');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].eff.action, 'bounce');
  Bot.applyTarget(game, game.bot.s, giant, asked[0].eff, 'Unsummon', defOf);
  assert.equal(giant.zone, 'hand');
});

test("Opp counters your big spell with Cancel, and holds Doom Blade for your attack", () => {
  const game = vsOpp(['giant', 'bear'], ['cancel', 'doomblade']);
  const s = game.bot.s;
  game.bot.respond = true;
  game.bot.started = true;
  for (let i = 0; i < 5; i++) put(s, 'swamp');
  s.cards[s.zones.battlefield[0]].produces = ['U'];
  s.cards[s.zones.battlefield[1]].produces = ['U'];
  toHand(s, 'cancel');
  toHand(s, 'doomblade');
  // Doom Blade isn't cast on Opp's own turn while it can answer you.
  const bear = put(game, 'bear');
  assert.ok(!Bot.castOptions(game, defOf).some(o => o.inst.id === 'doomblade'));
  // Your Hill Giant (mana value 4) is countered as you cast it.
  Game.hooks.casting = (t, inst) => t === game && Bot.oppCounters(game, inst, defOf);
  try {
    const g = toHand(game, 'giant');
    Game.move(game, g.iid, 'battlefield');
    assert.equal(g.zone, 'graveyard');
    assert.ok(s.zones.graveyard.some(iid => s.cards[iid].id === 'cancel'));
  } finally {
    Game.hooks.casting = null;
  }
  // You attack with the Bears: Doom Blade it before blocks (it's worth 3 or more).
  bear.enteredTurn = -1;
  Bot.resolveYourAttack(game, [bear.iid], defOf);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.oppLife, 20);
});

test("Opp's spell waits on the stack when you can answer; countering it or letting it resolve", () => {
  const game = vsOpp(['cancel'], ['giant']);
  const s = game.bot.s;
  game.bot.started = true;
  for (let i = 0; i < 4; i++) put(s, 'swamp');
  s.zones.battlefield.forEach(iid => { s.cards[iid].produces = ['R']; });
  toHand(s, 'giant');
  Bot.setResponder(() => true);
  try {
    let res = Bot.beginTurn(game, defOf);
    assert.equal(res.waiting, true);
    assert.ok(s.stack);
    const name = Bot.counterStack(game);
    assert.equal(name, 'Hill Giant');
    assert.ok(s.zones.graveyard.some(iid => s.cards[iid].id === 'giant'));
    res = Bot.resumeTurn(game, defOf);
    assert.ok(!s.stack);
    // Next time, let it resolve.
    toHand(s, 'giant');
    s.zones.battlefield.forEach(iid => { s.cards[iid].tapped = false; });
    s.landPlayed = true;
    assert.equal(Bot.castOne(game, defOf, []), 'wait');
    game.bot.wait = { phase: 'main2', notes: [] };
    Bot.resumeTurn(game, defOf);
    assert.ok(s.zones.battlefield.some(iid => s.cards[iid].id === 'giant'));
  } finally {
    Bot.setResponder(null);
  }
});
