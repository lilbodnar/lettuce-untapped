// The cards of the "Crazy? I was crazy once" Commander deck (Rats), played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const defs = {
  packrat: {"id":"packrat","name":"Pack Rat","typeLine":"Creature — Rat","manaCost":"{1}{B}","cmc":2,"power":"*","toughness":"*","oracle":"Pack Rat's power and toughness are each equal to the number of Rats you control.\n{2}{B}, Discard a card: Create a token that's a copy of this creature.","colors":["B"]},
  crackdown: {"id":"crackdown","name":"Crackdown Construct","typeLine":"Artifact Creature — Construct","manaCost":"{4}","cmc":4,"power":"2","toughness":"2","oracle":"Whenever you activate an ability of an artifact or creature that isn't a mana ability, this creature gets +1/+1 until end of turn.","colors":[]},
  coffers: {"id":"coffers","name":"Cabal Coffers","typeLine":"Land","manaCost":"","cmc":0,"power":null,"toughness":null,"oracle":"{2}, {T}: Add {B} for each Swamp you control.","colors":[],"producedMana":["B"]},
  stronghold: {"id":"stronghold","name":"Cabal Stronghold","typeLine":"Land","manaCost":"","cmc":0,"power":null,"toughness":null,"oracle":"{T}: Add {C}.\n{3}, {T}: Add {B} for each basic Swamp you control.","colors":[],"producedMana":["B","C"]},
  horn: {"id":"horn","name":"Herald's Horn","typeLine":"Artifact","manaCost":"{3}","cmc":3,"power":null,"toughness":null,"oracle":"As this artifact enters, choose a creature type.\nCreature spells you cast of the chosen type cost {1} less to cast.\nAt the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.","colors":[]},
  dominance: {"id":"dominance","name":"Kindred Dominance","typeLine":"Sorcery","manaCost":"{5}{B}{B}","cmc":7,"power":null,"toughness":null,"oracle":"Choose a creature type. Destroy all creatures that aren't of the chosen type.","colors":["B"]},
  butcher: {"id":"butcher","name":"Lord Skitter's Butcher","typeLine":"Creature — Rat Peasant","manaCost":"{2}{B}","cmc":3,"power":"2","toughness":"3","oracle":"When this creature enters, choose one —\n• Create a 1/1 black Rat creature token with \"This token can't block.\"\n• You may sacrifice another creature. If you do, scry 2, then draw a card.\n• Creatures you control gain menace until end of turn.","colors":["B"]},
  piper: {"id":"piper","name":"Piper of the Swarm","typeLine":"Creature — Human Warlock","manaCost":"{1}{B}","cmc":2,"power":"1","toughness":"3","oracle":"Rats you control have menace.\n{1}{B}, {T}: Create a 1/1 black Rat creature token.\n{2}{B}{B}, {T}, Sacrifice three Rats: Gain control of target creature.","colors":["B"]},
  gnawer: {"id":"gnawer","name":"Marrow-Gnawer","typeLine":"Legendary Creature — Rat Rogue","manaCost":"{3}{B}{B}","cmc":5,"power":"2","toughness":"3","oracle":"All Rats have fear.\n{T}, Sacrifice a Rat: Create X 1/1 black Rat creature tokens, where X is the number of Rats you control.","colors":["B"]},
  bidding: {"id":"bidding","name":"Patriarch's Bidding","typeLine":"Sorcery","manaCost":"{3}{B}{B}","cmc":5,"power":null,"toughness":null,"oracle":"Each player chooses a creature type. Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield.","colors":["B"]},
  staff: {"id":"staff","name":"Thornbite Staff","typeLine":"Kindred Artifact — Shaman Equipment","manaCost":"{2}","cmc":2,"power":null,"toughness":null,"oracle":"Equipped creature has \"{2}, {T}: This creature deals 1 damage to any target\" and \"Whenever a creature dies, untap this creature.\"\nWhenever a Shaman creature enters, you may attach this Equipment to it.\nEquip {4}","colors":[]},
  pestilence: {"id":"pestilence","name":"Pestilence Rats","typeLine":"Creature — Rat","manaCost":"{2}{B}","cmc":3,"power":"*","toughness":"3","oracle":"Pestilence Rats's power is equal to the number of other Rats on the battlefield.","colors":["B"]},
  crypt: {"id":"crypt","name":"Crypt Rats","typeLine":"Creature — Rat","manaCost":"{2}{B}","cmc":3,"power":"1","toughness":"1","oracle":"{X}: This creature deals X damage to each creature and each player. Spend only black mana on X.","colors":["B"]},
  wererat: {"id":"wererat","name":"Dirty Wererat","typeLine":"Creature — Human Rat Minion","manaCost":"{3}{B}","cmc":4,"power":"2","toughness":"3","oracle":"{B}, Discard a card: Regenerate this creature.\nThreshold — As long as there are seven or more cards in your graveyard, this creature gets +2/+2 and can't block.","colors":["B"]},
  karumonix: {"id":"karumonix","name":"Karumonix, the Rat King","typeLine":"Legendary Creature — Phyrexian Rat","manaCost":"{1}{B}{B}","cmc":3,"power":"3","toughness":"3","oracle":"Toxic 1\nOther Rats you control have toxic 1.\nWhen Karumonix enters, look at the top five cards of your library. You may reveal any number of Rat cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order.","colors":["B"]},
  palepiper: {"id":"palepiper","name":"Rat King, Pale Piper","typeLine":"Legendary Creature — Rat Avatar","manaCost":"{3}{B}","cmc":4,"power":"3","toughness":"3","oracle":"Menace\nWhenever Rat King or another nontoken creature you control leaves the battlefield, create a 1/1 black Rat creature token.\n{2}, Sacrifice a token: Draw a card.","colors":["B"]},
  verminister: {"id":"verminister","name":"Rat King, Verminister","typeLine":"Legendary Creature — Rat Avatar","manaCost":"{1}{B}","cmc":2,"power":"1","toughness":"1","oracle":"Disappear — At the beginning of your end step, if a permanent left the battlefield under your control this turn, create a 1/1 black Rat creature token and put a +1/+1 counter on Rat King.\n{T}, Sacrifice three Rats: Return target creature card and all other cards with the same name as that card from your graveyard to the battlefield tapped.","colors":["B"]},
  vbanner: {"id":"vbanner","name":"Vanquisher's Banner","typeLine":"Artifact","manaCost":"{5}","cmc":5,"power":null,"toughness":null,"oracle":"As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\nWhenever you cast a creature spell of the chosen type, draw a card.","colors":[]},
  coat: {"id":"coat","name":"Coat of Arms","typeLine":"Artifact","manaCost":"{5}","cmc":5,"power":null,"toughness":null,"oracle":"Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.","colors":[]},
  nezumi: {"id":"nezumi","name":"Nezumi Prowler","typeLine":"Artifact Creature — Rat Ninja","manaCost":"{1}{B}","cmc":2,"power":"3","toughness":"1","oracle":"Ninjutsu {1}{B}\nWhen this creature enters, target creature you control gains deathtouch and lifelink until end of turn.","colors":["B"]},
  hbanner: {"id":"hbanner","name":"Heraldic Banner","typeLine":"Artifact","manaCost":"{3}","cmc":3,"power":null,"toughness":null,"oracle":"As this artifact enters, choose a color.\nCreatures you control of the chosen color get +1/+0.\n{T}: Add one mana of the chosen color.","colors":[],"producedMana":["B","G","R","U","W"]},
  chronicle: {"id":"chronicle","name":"Chronicle of Victory","typeLine":"Legendary Artifact","manaCost":"{6}","cmc":6,"power":null,"toughness":null,"oracle":"As Chronicle of Victory enters, choose a creature type.\nCreatures you control of the chosen type get +2/+2 and have first strike and trample.\nWhenever you cast a spell of the chosen type, draw a card.","colors":[]},
  skitter: {"id":"skitter","name":"Lord Skitter, Sewer King","typeLine":"Legendary Creature — Rat Noble","manaCost":"{2}{B}","cmc":3,"power":"3","toughness":"3","oracle":"Whenever another Rat you control enters, exile up to one target card from an opponent's graveyard.\nAt the beginning of combat on your turn, create a 1/1 black Rat creature token with \"This token can't block.\"","colors":["B"]},
  ashcoat: {"id":"ashcoat","name":"Ashcoat of the Shadow Swarm","typeLine":"Legendary Creature — Rat Warlock","manaCost":"{3}{B}","cmc":4,"power":"3","toughness":"4","oracle":"Whenever Ashcoat attacks or blocks, other Rats you control get +X/+X until end of turn, where X is the number of Rats you control.\nAt the beginning of your end step, you may mill four cards. If you do, return up to two Rat creature cards from your graveyard to your hand.","colors":["B"]},
  swarmyard: {"id":"swarmyard","name":"Swarmyard","typeLine":"Land","manaCost":"","cmc":0,"power":null,"toughness":null,"oracle":"{T}: Add {C}.\n{T}: Regenerate target Insect, Rat, Spider, or Squirrel.","colors":[],"producedMana":["C"]},
  marsh: {"id":"marsh","name":"Persistent Marshstalker","typeLine":"Creature — Rat Berserker","manaCost":"{1}{B}","cmc":2,"power":"3","toughness":"1","oracle":"This creature gets +1/+0 for each other Rat you control.\nThreshold — Whenever you attack with one or more Rats, if there are seven or more cards in your graveyard, you may pay {2}{B}. If you do, return this card from your graveyard to the battlefield tapped and attacking.","colors":["B"]},
  rotcaller: {"id":"rotcaller","name":"Valley Rotcaller","typeLine":"Creature — Squirrel Warlock","manaCost":"{1}{B}","cmc":2,"power":"1","toughness":"3","oracle":"Menace\nWhenever this creature attacks, each opponent loses X life and you gain X life, where X is the number of other Squirrels, Bats, Lizards, and Rats you control.","colors":["B"]},
  revenge: {"id":"revenge","name":"Revenge of the Rats","typeLine":"Sorcery","manaCost":"{2}{B}{B}","cmc":4,"power":null,"toughness":null,"oracle":"Create a tapped 1/1 black Rat creature token for each creature card in your graveyard.\nFlashback {2}{B}{B}","colors":["B"]},
  threetree: {"id":"threetree","name":"Three Tree City","typeLine":"Legendary Land","manaCost":"","cmc":0,"power":null,"toughness":null,"oracle":"As Three Tree City enters, choose a creature type.\n{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.","colors":[],"producedMana":["B","C","G","R","U","W"]},
  gruesome: {"id":"gruesome","name":"Gruesome Fate","typeLine":"Sorcery","manaCost":"{2}{B}","cmc":3,"power":null,"toughness":null,"oracle":"Each opponent loses 1 life for each creature you control.","colors":["B"]},
  colony: {"id":"colony","name":"Rat Colony","typeLine":"Creature — Rat","manaCost":"{1}{B}","cmc":2,"power":"2","toughness":"1","oracle":"This creature gets +1/+0 for each other Rat you control.\nA deck can have any number of cards named Rat Colony.","colors":["B"]},
  inkeyes: {"id":"inkeyes","name":"Ink-Eyes, Servant of Oni","typeLine":"Legendary Creature — Rat Ninja","manaCost":"{4}{B}{B}","cmc":6,"power":"5","toughness":"4","oracle":"Ninjutsu {3}{B}{B}\nWhenever Ink-Eyes deals combat damage to a player, you may put target creature card from that player's graveyard onto the battlefield under your control.\n{1}{B}: Regenerate Ink-Eyes.","colors":["B"]},
  tangled: {"id":"tangled","name":"Tangled Colony","typeLine":"Creature — Rat","manaCost":"{1}{B}","cmc":2,"power":"3","toughness":"2","oracle":"This creature can't block.\nWhen this creature dies, create X 1/1 black Rat creature tokens with \"This token can't block,\" where X is the amount of damage dealt to it this turn.","colors":["B"]},
  typhoid: {"id":"typhoid","name":"Typhoid Rats","typeLine":"Creature — Rat","manaCost":"{B}","cmc":1,"power":"1","toughness":"1","oracle":"Deathtouch","colors":["B"]},
  ritual: {"id":"ritual","name":"Dark Ritual","typeLine":"Instant","manaCost":"{B}","cmc":1,"power":null,"toughness":null,"oracle":"Add {B}{B}{B}.","colors":["B"],"producedMana":["B"]},
  swamp: { id: 'swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '' },
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '' },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  giant: { id: 'giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '3', toughness: '3', oracle: '', colors: ['R'] },
  shaman: { id: 'shaman', name: 'Shaman Adept', typeLine: 'Creature — Human Shaman', manaCost: '{1}{R}', cmc: 2, power: '1', toughness: '1', oracle: '', colors: ['R'] },
};
const defOf = id => defs[id];
const deck = (name, rows) => ({ key: name, name, rows });
const ids = Object.keys(defs);
const vsOpp = () => {
  const game = Game.create(deck('You', ids.map(id => ({ id, qty: 3 })).concat({ id: 'swamp', qty: 20 })), defs);
  game.bot = Bot.create(deck('Opp', ids.map(id => ({ id, qty: 3 })).concat({ id: 'forest', qty: 20 })), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({ hitOpps: n => { game.oppLife -= n; }, hitTarget: n => { game.oppLife -= n; }, other: game.bot.s, defOf, oppsDraw: n => Game.drawCards(game.bot.s, n, true), ...extra });
const st = inst => Bot.stats(inst, inst.bot || defOf(inst.id));
const named = (s, name) => s.zones.battlefield.map(i => s.cards[i]).filter(c => c.name === name);
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const d of Object.values(defs)) {
    if (['bear', 'giant', 'shaman', 'swamp', 'forest'].includes(d.id)) continue;
    const r = Coverage.check(d);
    assert.equal(r.you, 'all', `${d.name}: ${JSON.stringify(r.lines.filter(l => l.gaps.length))}`);
  }
});

test('Pack Rat copies itself and counts Rats', () => {
  const game = vsOpp();
  const rat = put(game, 'packrat');
  const ab = Bot.activatedAbilities(rat, defOf)[0];
  Bot.runEffect(game, ab.effect, ctx(game, { self: rat }));
  Bot.refreshGrants(game, defOf);
  assert.equal(named(game, 'Pack Rat').length, 2);
  assert.equal(st(rat).pow, 2);
});

test('Cabal Coffers makes {B} for each Swamp; Stronghold counts basic Swamps', () => {
  const game = vsOpp();
  for (let i = 0; i < 4; i++) put(game, 'swamp');
  const coffers = put(game, 'coffers');
  const src = Game.sourceOf(game, coffers);
  assert.deepEqual([src.filter, src.makes.length], [2, 4]);
  // 4 Swamps + Coffers: pay {2} with two Swamps, get 4 → 2 + 4 = 6 total
  assert.equal(Game.available(game).total, 6);
});

test("Herald's Horn puts a creature of the chosen type from the top into your hand", () => {
  const game = vsOpp();
  const horn = put(game, 'horn');
  horn.chosenType = 'Rat';
  Game.move(game, find(game, 'typhoid', ['library', 'hand']), 'library', { index: 0 });
  const hand = game.zones.hand.length;
  const [line] = defs.horn.oracle.split('\n').filter(l => /upkeep/.test(l));
  Bot.runEffect(game, line.replace(/^At the beginning of your upkeep, /, ''), ctx(game, { self: horn }));
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Kindred Dominance keeps your type', () => {
  const game = vsOpp();
  const rat = put(game, 'typhoid');
  const rat2 = put(game, 'colony');
  const bear = put(game.bot.s, 'bear');
  const spell = game.cards[find(game, 'dominance')];
  Bot.runEffect(game, defs.dominance.oracle, ctx(game, { self: spell }));
  assert.equal(spell.chosenType, 'Rat');
  assert.equal(rat.zone, 'battlefield');
  assert.equal(rat2.zone, 'battlefield');
  assert.equal(bear.zone, 'graveyard');
});

test("Lord Skitter's Butcher: the token can't block; the sacrifice mode asks you", () => {
  const game = vsOpp();
  const b = put(game, 'butcher');
  Bot.runEffect(game, 'Create a 1/1 black Rat creature token with "This token can\'t block."', ctx(game, { self: b }));
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token);
  assert.ok(st(tok).kw.has("can't block"));
  let asked = null;
  Bot.runEffect(game, 'You may sacrifice another creature. If you do, scry 2, then draw a card.', ctx(game, { self: b, sacThen: (what, rest) => { asked = [what, rest]; } }));
  assert.deepEqual(asked, ['creature', 'scry 2, then draw a card']);
});

test('Piper of the Swarm: sacrifice three Rats to steal a creature', () => {
  const game = vsOpp();
  const piper = put(game, 'piper');
  const steal = Bot.activatedAbilities(piper, defOf).find(a => a.sacOther);
  assert.deepEqual([steal.sacOther, steal.sacCount], ['Rats', 3]);
  const giant = put(game.bot.s, 'giant');
  Bot.applyTarget(game, game.bot.s, giant, Bot.targetEffect(steal.effect), 'Piper', defOf, game);
  const mine = named(game, 'Hill Giant')[0];
  assert.ok(mine);
  assert.equal(mine.owner, 'opp');
  assert.equal(named(game.bot.s, 'Hill Giant').length, 0);
});

test('Marrow-Gnawer gives every Rat fear, on both sides', () => {
  const game = vsOpp();
  put(game, 'gnawer');
  const mine = put(game, 'typhoid');
  const theirs = put(game.bot.s, 'typhoid');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(mine).kw.has('fear'));
  assert.ok(st(theirs).kw.has('fear'));
});

test("Patriarch's Bidding brings back each player's chosen type", () => {
  const game = vsOpp();
  Game.move(game, find(game, 'typhoid', ['library', 'hand']), 'graveyard');
  Game.move(game, find(game, 'colony', ['library', 'hand']), 'graveyard');
  Game.move(game.bot.s, find(game.bot.s, 'giant', ['library']), 'graveyard');
  const spell = game.cards[find(game, 'bidding')];
  Bot.runEffect(game, defs.bidding.oracle, ctx(game, { self: spell }));
  assert.ok(named(game, 'Typhoid Rats').length && named(game, 'Rat Colony').length);
  assert.ok(named(game.bot.s, 'Hill Giant').length);
});

test('Thornbite Staff attaches to a Shaman and gives its abilities', () => {
  const game = vsOpp();
  const staff = put(game, 'staff');
  const shaman = game.cards[find(game, 'shaman')];
  Game.move(game, shaman.iid, 'battlefield', { put: true });
  Bot.creatureEntered(game, shaman, defOf, ctx(game));
  assert.equal(staff.attachedTo, shaman.iid);
  assert.ok(Bot.activatedAbilities(shaman, defOf).some(a => /1 damage to any target/.test(a.effect)));
  shaman.tapped = true;
  const bear = put(game.bot.s, 'bear');
  Game.hooks.died = (s, inst, info) => Bot.afterDeath(game, s, inst, info || {}, defOf, ctx(game));
  Game.move(game.bot.s, bear.iid, 'graveyard');
  assert.equal(shaman.tapped, false); // "Whenever a creature dies, untap this creature."
});

test('Pestilence Rats counts every other Rat; Dirty Wererat with threshold', () => {
  const game = vsOpp();
  const p = put(game, 'pestilence');
  put(game, 'typhoid');
  put(game.bot.s, 'typhoid');
  const w = put(game, 'wererat');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(p).pow, 3); // two Typhoid Rats and the Wererat
  for (let i = 0; i < 7; i++) Game.move(game, game.zones.library[0], 'graveyard');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(w).pow, 4);
  assert.ok(st(w).kw.has("can't block"));
});

test('Crypt Rats deals X to each creature and each player', () => {
  const game = vsOpp();
  const crypt = put(game, 'crypt');
  const bear = put(game.bot.s, 'bear');
  const giant = put(game.bot.s, 'giant');
  const parts = Bot.parts.effectParts('This creature deals 2 damage to each creature and each player. Spend only black mana on 2.');
  assert.equal(parts.length, 2);
  Bot.runEffect(game, parts.join('. '), ctx(game, { self: crypt }));
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'battlefield');
  assert.equal(crypt.zone, 'graveyard');
  assert.deepEqual([game.life, game.oppLife], [38, 38]);
});

test('Karumonix gives other Rats toxic and digs for Rats', () => {
  const game = vsOpp();
  put(game, 'karumonix');
  const rat = put(game, 'colony');
  Bot.refreshGrants(game, defOf);
  assert.ok(st(rat).kw.has('toxic'));
  let dug = null;
  const enter = defs.karumonix.oracle.split('\n').find(l => /^When Karumonix enters/.test(l)).replace(/^When Karumonix enters, /, '');
  Bot.runEffect(game, enter, ctx(game, { dig: spec => { dug = spec; } }));
  assert.equal(dug.top.length, 5);
  assert.equal(dug.max, 99);
});

test('Rat King, Pale Piper: a Rat whenever a nontoken creature of yours leaves', () => {
  const game = vsOpp();
  put(game, 'palepiper');
  const rat = put(game, 'typhoid');
  Game.hooks.moved = (s, inst, from, to) => Bot.cardMoved(game, s, inst, from, to, defOf, ctx(game));
  Game.move(game, rat.iid, 'hand');
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token).length, 1);
  assert.equal(game.leftThisTurn, true);
});

test('Rat King, Verminister: disappear makes a Rat; it returns cards with the same name', () => {
  const game = vsOpp();
  const king = put(game, 'verminister');
  game.leftThisTurn = true;
  Bot.phaseTriggers(game, game, 'end step', defOf, ctx(game));
  assert.equal(king.counters['+1/+1'], 1);
  assert.equal(game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token).length, 1);
  ['colony', 'colony', 'colony'].forEach(() => Game.move(game, find(game, 'colony', ['library', 'hand']), 'graveyard'));
  const ab = Bot.activatedAbilities(king, defOf).find(a => a.sacOther);
  Bot.runEffect(game, ab.effect, ctx(game, { self: king }));
  assert.equal(named(game, 'Rat Colony').length, 3);
  assert.ok(named(game, 'Rat Colony').every(c => c.tapped));
});

test('Banners and Chronicle: the chosen type gets the bonus and casting one draws', () => {
  const game = vsOpp();
  const vb = put(game, 'vbanner');
  vb.chosenType = 'Rat';
  const ch = put(game, 'chronicle');
  ch.chosenType = 'Rat';
  const rat = put(game, 'typhoid');
  const bear = put(game, 'bear');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual([st(rat).pow, st(rat).tou], [4, 4]);
  assert.ok(st(rat).kw.has('first strike') && st(rat).kw.has('trample'));
  assert.equal(st(bear).pow, 2);
  const hand = game.zones.hand.length;
  Bot.spellCast(game, game, game.cards[find(game, 'colony', ['library', 'hand'])], defOf, ctx(game));
  assert.equal(game.zones.hand.length, hand + 2);
});

test('Heraldic Banner: black creatures get +1/+0 and it taps for the chosen color', () => {
  const game = vsOpp();
  const hb = put(game, 'hbanner');
  hb.chosenColor = Bot.bestColor(game, defOf);
  assert.equal(hb.chosenColor, 'B');
  const rat = put(game, 'typhoid');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(rat).pow, 2);
  Game.setTapped(game, hb.iid, true);
  assert.equal(game.mana.B, 1);
});

test('Coat of Arms counts creatures that share a type', () => {
  const game = vsOpp();
  put(game, 'coat');
  const a = put(game, 'typhoid');
  put(game, 'colony');
  put(game.bot.s, 'typhoid');
  const bear = put(game.bot.s, 'bear');
  Bot.refreshGrants(game, defOf);
  assert.equal(st(a).pow, 1 + 2);
  assert.equal(st(bear).pow, 2);
});

test('Ninjutsu: an unblocked attacker goes back and the ninja hits instead', () => {
  const game = vsOpp();
  const rat = put(game, 'typhoid');
  const ninja = game.cards[find(game, 'inkeyes')];
  Game.move(game, ninja.iid, 'hand');
  game.bot.s.zones.battlefield.slice().forEach(i => Game.move(game.bot.s, i, 'graveyard'));
  const state = Bot.yourAttackBlocks(game, [{ iid: rat.iid }], defOf);
  assert.ok(Bot.ninjutsu(game, state, rat.iid, ninja.iid, defOf));
  assert.equal(rat.zone, 'hand');
  Bot.finishYourAttack(game, state.attackers, state.blocks, defOf, state.answered, { moveCards: () => {} });
  assert.equal(game.oppLife, 35);
  assert.equal(Bot.ninjutsuOf(ninja, defOf), '{3}{B}{B}');
});

test('Lord Skitter makes a Rat that can\'t block each combat and exiles from Opp\'s graveyard', () => {
  const game = vsOpp();
  put(game, 'skitter');
  Game.move(game.bot.s, find(game.bot.s, 'giant', ['library']), 'graveyard');
  Bot.phaseTriggers(game, game, 'combat', defOf, ctx(game));
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token);
  assert.ok(st(tok).kw.has("can't block"));
  Bot.runEffect(game, "exile up to one target card from an opponent's graveyard", ctx(game));
  assert.equal(game.bot.s.zones.graveyard.length, 0);
});

test('Swarmyard regenerates a Rat; Persistent Marshstalker returns with threshold', () => {
  const eff = Bot.targetEffect('Regenerate target Insect, Rat, Spider, or Squirrel');
  assert.equal(eff.action, 'regen');
  const game = vsOpp();
  const m = game.cards[find(game, 'marsh')];
  Game.move(game, m.iid, 'graveyard');
  const rat = put(game, 'typhoid');
  assert.equal(Bot.graveAttackers(game, [rat], defOf).length, 0);
  // Seven more cards in the graveyard (not another Marshstalker, which would come back too).
  game.zones.library.filter(i => game.cards[i].id !== 'marsh').slice(0, 7).forEach(i => Game.move(game, i, 'graveyard'));
  assert.equal(Bot.graveAttackers(game, [rat], defOf).length, 1);
});

test('Valley Rotcaller drains for each other Rat; Gruesome Fate and Revenge of the Rats count', () => {
  const game = vsOpp();
  const v = put(game, 'rotcaller');
  put(game, 'typhoid');
  put(game, 'colony');
  Bot.declareAttack(game, [v], defOf, { game, ctx: ctx(game) });
  assert.deepEqual([game.life, game.oppLife], [42, 38]);
  Bot.runEffect(game, defs.gruesome.oracle, ctx(game));
  assert.equal(game.oppLife, 35);
  Game.move(game, find(game, 'bear', ['library', 'hand']), 'graveyard');
  Game.move(game, find(game, 'giant', ['library', 'hand']), 'graveyard');
  Bot.runEffect(game, defs.revenge.oracle.split('\n')[0], ctx(game));
  const toks = game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token);
  assert.equal(toks.length, 2);
  assert.ok(toks.every(c => c.tapped));
  assert.equal(Bot.flashbackOf(game.cards[find(game, 'revenge')], defOf), '{2}{B}{B}');
});

test('Three Tree City adds mana for each creature of the chosen type', () => {
  const game = vsOpp();
  const city = put(game, 'threetree');
  city.chosenType = 'Rat';
  put(game, 'typhoid');
  put(game, 'colony');
  const ab = Bot.activatedAbilities(city, defOf).find(a => /amount/.test(a.effect));
  Bot.runEffect(game, ab.effect, ctx(game, { self: city }));
  assert.equal(Object.values(game.mana).reduce((a, b) => a + b, 0), 2);
});

test('Tangled Colony makes a Rat for each damage it took', () => {
  const game = vsOpp();
  const t = put(game, 'tangled');
  Bot.creatureDamaged(game, game, t, 3, defOf);
  Game.hooks.died = (s, inst, info) => Bot.died(s, inst, defOf, ctx(game), game, info || {});
  Game.move(game, t.iid, 'graveyard');
  const toks = game.zones.battlefield.map(i => game.cards[i]).filter(c => c.token);
  assert.equal(toks.length, 3);
  assert.ok(st(toks[0]).kw.has("can't block"));
});

test('Crackdown Construct grows when you activate an ability', () => {
  const game = vsOpp();
  const c = put(game, 'crackdown');
  const rat = put(game, 'packrat');
  Bot.abilityActivated(game, game, rat, defOf, ctx(game));
  assert.equal(st(c).pow, 3);
});
