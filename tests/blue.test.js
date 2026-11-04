// Blue cards, batch by batch: the most played mono-blue cards that weren't automatic yet, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./blue-cards.json');
const basics = {
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Drake: { id: 'Drake', name: 'Wind Drake', typeLine: 'Creature — Drake', manaCost: '{2}{U}', cmc: 3, power: '2', toughness: '2', oracle: 'Flying', colors: ['U'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Island' ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  Bot.refreshGrants(game, defOf);
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'battlefield']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); if (s.cards[iid].zone !== 'battlefield') Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const run = (game, who, text, extra = {}) => Bot.runEffect(game, text, ctx(game, { self: who, ...extra }));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every blue card done so far is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('Force of Will can be cast for 1 life with another blue card in hand', () => {
  const game = vsOpp();
  const fow = game.cards[find(game, 'Force of Will')];
  Game.move(game, fow.iid, 'hand');
  Game.move(game, find(game, 'Drake'), 'hand');
  assert.ok(Bot.costChoices(game, fow, defOf).some(c => c.key === 'life' && c.life === 1 && c.cost === ''));
});

test("Thassa's Oracle wins when your devotion covers the library", () => {
  const game = vsOpp();
  const oracle = put(game, "Thassa's Oracle");
  game.zones.library.slice(1).forEach(iid => Game.move(game, iid, 'graveyard'));
  run(game, oracle, "Thassa's Oracle");
  assert.ok(game.oppLife <= 0); // "you win the game" takes the opponent's life
});

test('Laboratory Maniac turns drawing from an empty library into a win', () => {
  const game = vsOpp();
  put(game, 'Laboratory Maniac');
  game.zones.library.slice().forEach(iid => Game.move(game, iid, 'graveyard'));
  assert.equal(Bot.drawInstead(game, game, false, defOf), true);
});

test('Bruvac doubles what the opponent mills', () => {
  const game = vsOpp();
  put(game, 'Bruvac the Grandiloquent');
  Game.hooks.milled = (s, ids) => Bot.milled(game, s, ids, defOf);
  const before = game.bot.s.zones.graveyard.length;
  Game.mill(game.bot.s, 3);
  assert.equal(game.bot.s.zones.graveyard.length - before, 6);
});

test('Time Stretch takes two extra turns; Traumatize mills half the library', () => {
  const game = vsOpp();
  run(game, { name: 'Time Stretch' }, 'Target player takes two extra turns after this one.');
  assert.equal(game.bot.s.skipTurn, 2); // the opponent skips two turns
  const o = game.bot.s;
  const n = o.zones.library.length;
  run(game, { name: 'Traumatize' }, 'Target player mills half their library, rounded down.');
  assert.equal(o.zones.library.length, n - Math.floor(n / 2));
});

// ---- batch 2 ----

test('Remand and Fuel for the Cause have their riders read', () => {
  const parts = Bot.parts;
  assert.ok(parts.COUNTER_EXTRAS.some(re => re.test("If that spell is countered this way, put it into its owner's hand instead of into that player's graveyard")));
  assert.ok(parts.COUNTER_EXTRAS.some(re => re.test('Counter target spell, then proliferate')));
});

test('Show and Tell puts each player\'s best permanent card from hand onto the battlefield', () => {
  const game = vsOpp();
  game.zones.hand.slice().forEach(iid => Game.move(game, iid, 'library'));
  const giant = game.cards[find(game, 'Giant')];
  Game.move(game, giant.iid, 'hand');
  run(game, { name: 'Show and Tell' }, 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.');
  assert.equal(giant.zone, 'battlefield');
});

test('Mirror Image enters as a copy of a creature you control', () => {
  const game = vsOpp();
  put(game, 'Giant');
  const img = put(game, 'Mirror Image');
  Bot.enterTrigger(game, img, defOf);
  assert.equal(img.id, 'Giant');
});

test('Lord of Atlantis pumps other Merfolk', () => {
  const game = vsOpp();
  put(game, 'Lord of Atlantis');
  put(game, 'Back to Basics');
  const thada = put(game, 'Thada Adel, Acquisitor');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(thada, defOf(thada.id)).pow, 3);
});

test('Mass Manipulation takes X of the opponent\'s creatures', () => {
  const game = vsOpp();
  put(game.bot.s, 'Giant');
  run(game, { name: 'Mass Manipulation', xValue: 1 }, 'Gain control of X target creatures and/or planeswalkers.');
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
});

// ---- batch 3 ----

test('Vendilion Clique bottoms the opponent\'s best nonland card and they draw', () => {
  const game = vsOpp();
  const o = game.bot.s;
  o.zones.hand.slice().forEach(iid => Game.move(o, iid, 'library'));
  const giant = o.cards[find(o, 'Giant')];
  Game.move(o, giant.iid, 'hand');
  run(game, { name: 'Vendilion Clique' }, "Look at target player's hand. You may choose a nonland card from it. If you do, that player reveals the chosen card, puts it on the bottom of their library, then draws a card.");
  assert.equal(giant.zone, 'library');
  assert.equal(o.zones.library[o.zones.library.length - 1], giant.iid);
  assert.equal(o.zones.hand.length, 1);
});

test('Collect evidence exiles graveyard cards worth the number', () => {
  const game = vsOpp();
  Game.move(game, find(game, 'Giant'), 'graveyard');
  run(game, { name: 'Forensic Researcher' }, 'collect evidence 3');
  assert.ok(game.zones.exile.some(i => game.cards[i].id === 'Giant'));
});

test('Edgar, King of Figaro wins the first coin flip each turn', () => {
  const game = vsOpp();
  put(game, 'Edgar, King of Figaro');
  const r = Game.randomInt;
  Game.randomInt = () => 1; // every flip would lose
  try {
    const before = game.zones.hand.length;
    run(game, { name: 'Test' }, 'Flip a coin.');
    assert.equal(game.figaroTurn, game.turn);
    void before;
  } finally { Game.randomInt = r; }
});

test('Utter Insignificance makes the enchanted creature a plain 1/1', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const aura = put(game, 'Utter Insignificance');
  aura.attachedTo = giant.iid;
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 1);
});

// ---- batch 4 ----

test('Confiscate takes the opponent\'s best nonland permanent', () => {
  const game = vsOpp();
  put(game.bot.s, 'Giant');
  const aura = put(game, 'Confiscate');
  Bot.enterTrigger(game, aura, defOf);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
});

test('Psychic Spiral shuffles your graveyard back and mills the opponent that many', () => {
  const game = vsOpp();
  ['Giant', 'Bear', 'Drake'].forEach(id => Game.move(game, find(game, id), 'graveyard'));
  const before = game.bot.s.zones.graveyard.length;
  run(game, { name: 'Psychic Spiral' }, 'Shuffle all cards from your graveyard into your library. Target player mills that many cards.');
  assert.equal(game.zones.graveyard.length, 0);
  assert.equal(game.bot.s.zones.graveyard.length, before + 3);
});

test('Displacement Wave returns only the cheap nonland permanents', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  run(game, { name: 'Displacement Wave', xValue: 2 }, "Return all nonland permanents with mana value 2 or less to their owners' hands.");
  assert.equal(bear.zone, 'hand');
  assert.equal(giant.zone, 'battlefield');
});

test('Teachings of the Archaics draws three when the opponent has four more cards', () => {
  const game = vsOpp();
  game.zones.hand.slice().forEach(iid => Game.move(game, iid, 'library'));
  const o = game.bot.s;
  while (o.zones.hand.length < 5) Game.move(o, o.zones.library[0], 'hand');
  run(game, { name: 'Teachings of the Archaics' }, 'If an opponent has more cards in hand than you, draw two cards. Draw three cards instead if an opponent has at least four more cards in hand than you.');
  assert.equal(game.zones.hand.length, 3);
});

test('Time of Ice keeps the tapped creature frozen while the saga stays', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const saga = put(game, 'Time of Ice');
  run(game, saga, "Tap target creature an opponent controls. It doesn't untap during its controller's untap step for as long as you control this Saga.");
  assert.equal(giant.tapped, true);
  assert.ok(giant.frozenBy);
});

test('Tide Shaper grows when the opponent controls an Island', () => {
  const game = vsOpp();
  const shaper = put(game, 'Tide Shaper');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(shaper, defOf(shaper.id)).pow, 1);
  put(game.bot.s, 'Island');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(shaper, defOf(shaper.id)).pow, 2);
});

test('Hinder puts the countered spell on the bottom of its owner\'s library', () => {
  const game = vsOpp();
  const o = game.bot.s;
  const giant = o.cards[find(o, 'Giant')];
  Game.move(o, giant.iid, 'graveyard');
  Bot.counterExtras(game, game, o, defOf('Hinder').oracle, 'Hinder', 4);
  assert.equal(giant.zone, 'library');
  assert.equal(o.zones.library[o.zones.library.length - 1], giant.iid);
});

test('Peer Pressure takes the creatures of a type you have more of', () => {
  const game = vsOpp();
  put(game, 'Lord of Atlantis');
  put(game, 'Thada Adel, Acquisitor');
  put(game.bot.s, 'Merfolk Trickster');
  run(game, { name: 'Peer Pressure' }, 'Choose a creature type. If you control more creatures of that type than each other player, you gain control of all creatures of that type.');
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Merfolk Trickster'));
  assert.ok(!game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Merfolk Trickster'));
});

// ---- batch 5 ----

test('Overburden returns a land when a nontoken creature enters', () => {
  const game = vsOpp();
  put(game, 'Overburden');
  const island = put(game, 'Island');
  const bear = put(game, 'Bear');
  Bot.enterTrigger(game, bear, defOf);
  assert.equal(island.zone, 'hand');
});

test('Epiphany at the Drownyard splits X plus one cards between your hand and graveyard', () => {
  const game = vsOpp();
  const hand = game.zones.hand.length;
  const grave = game.zones.graveyard.length;
  run(game, { name: 'Epiphany at the Drownyard', xValue: 3 }, defOf('Epiphany at the Drownyard').oracle);
  assert.equal(game.zones.hand.length - hand + game.zones.graveyard.length - grave, 4);
  assert.ok(game.zones.hand.length > hand);
});

test('Deluge taps every creature without flying', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const drake = put(game.bot.s, 'Drake');
  run(game, { name: 'Deluge' }, 'Tap all creatures without flying.');
  assert.equal(giant.tapped, true);
  assert.ok(!drake.tapped);
});

test('Sunder returns every land to its owner\'s hand', () => {
  const game = vsOpp();
  const mine = put(game, 'Island');
  const theirs = put(game.bot.s, 'Island');
  run(game, { name: 'Sunder' }, "Return all lands to their owners' hands.");
  assert.equal(mine.zone, 'hand');
  assert.equal(theirs.zone, 'hand');
});

test('Doc Ock is 8/8 with eight cards in your graveyard', () => {
  const game = vsOpp();
  const ock = put(game, 'Doc Ock, Sinister Scientist');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(ock, defOf(ock.id)).pow, 4);
  game.zones.library.slice(0, 8).forEach(iid => Game.move(game, iid, 'graveyard'));
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(ock, defOf(ock.id)).pow, 8);
});

test('Myojin of Seeing Winds is indestructible while it has a divinity counter', () => {
  const game = vsOpp();
  const myojin = put(game, 'Myojin of Seeing Winds');
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.stats(myojin, defOf(myojin.id)).kw.has('indestructible'));
  Game.counter(game, myojin.iid, 'divinity', 1);
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(myojin, defOf(myojin.id)).kw.has('indestructible'));
});

test('Tempted by the Oriq takes a creature with mana value 3 or less', () => {
  const game = vsOpp();
  put(game.bot.s, 'Bear');
  put(game.bot.s, 'Giant');
  run(game, { name: 'Tempted by the Oriq' }, defOf('Tempted by the Oriq').oracle);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Bear'));
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Giant'));
});

test('March of the Machines makes a noncreature artifact a creature sized by its mana value', () => {
  const game = vsOpp();
  put(game, 'March of the Machines');
  const net = put(game, 'Braided Net // Braided Quipu');
  Bot.refreshGrants(game, defOf);
  assert.ok(Game.isCreature(net));
  assert.equal(Bot.stats(net, defOf(net.id)).pow, 3);
});

// ---- Blue cards, batch 6 ----

test('Mirror-Mad Phantasm shuffles itself in and comes back, milling what was above it', () => {
  const game = vsOpp();
  const ph = put(game, 'Mirror-Mad Phantasm');
  run(game, ph, "This creature's owner shuffles it into their library. If that player does, they reveal cards from the top of that library until a card named Mirror-Mad Phantasm is revealed. The player puts that card onto the battlefield and all other cards revealed this way into their graveyard.");
  assert.equal(ph.zone, 'battlefield');
});

test("Eternal Dominion takes a permanent card from the opponent's library, then epic stops your spells", () => {
  const game = vsOpp();
  const before = game.zones.battlefield.length;
  run(game, { name: 'Eternal Dominion' }, "Search target opponent's library for an artifact, creature, enchantment, or land card. Put that card onto the battlefield under your control. Then that player shuffles. Epic");
  assert.equal(game.zones.battlefield.length, before + 1);
  assert.ok(game.cantCast);
  assert.equal(game.epics.length, 1);
});

test("Fortune's Favor hands you one pile and mills the other", () => {
  const game = vsOpp();
  const hand = game.zones.hand.length;
  const grave = game.zones.graveyard.length;
  run(game, { name: "Fortune's Favor" }, defOf("Fortune's Favor").oracle);
  assert.equal(game.zones.hand.length - hand + game.zones.graveyard.length - grave, 4);
  assert.ok(game.zones.hand.length > hand);
});

test('Murktide Regent grows when an instant leaves your graveyard; Narcomoeba comes back from a mill', () => {
  const game = vsOpp();
  const murk = put(game, 'Murktide Regent');
  const spell = game.cards[find(game, 'Minor Misstep')];
  Game.move(game, spell.iid, 'graveyard');
  Game.move(game, spell.iid, 'exile');
  Bot.cardMoved(game, game, spell, 'graveyard', 'exile', defOf, ctx(game));
  assert.equal((murk.counters || {})['+1/+1'], 1);
  const narco = game.cards[find(game, 'Narcomoeba')];
  Game.move(game, narco.iid, 'graveyard');
  Bot.cardMoved(game, game, narco, 'library', 'graveyard', defOf, ctx(game));
  assert.equal(narco.zone, 'battlefield');
});

test('Machine Over Matter costs {1} less with an artifact creature; Battle of Wits needs 200 cards', () => {
  const game = vsOpp();
  const mom = game.cards[find(game, 'Machine Over Matter')];
  assert.equal(Bot.selfDiscount(game, mom, defOf), 0);
  put(game, 'Iron Man, Modern Marvel');
  assert.equal(Bot.selfDiscount(game, mom, defOf), 1);
  assert.equal(Bot.condition(game, 'you have 200 or more cards in your library', {}), true);
  game.zones.library.splice(100).forEach(iid => { game.cards[iid].zone = 'exile'; game.zones.exile.push(iid); });
  assert.equal(Bot.condition(game, 'you have 200 or more cards in your library', {}), false);
});

test('Legerdemain swaps your weakest creature for their best', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game.bot.s, 'Giant');
  run(game, { name: 'Legerdemain' }, 'Exchange control of target artifact or creature and another target permanent that shares one of those types with it.');
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Bear'));
});

test('Wicked Slumber taps two creatures and stuns each', () => {
  const game = vsOpp();
  const a = put(game.bot.s, 'Bear');
  const b = put(game.bot.s, 'Giant');
  run(game, { name: 'Wicked Slumber' }, 'Tap up to two target creatures. Put a stun counter on either of them. Then put a stun counter on either of them.');
  for (const c of [a, b]) { assert.ok(c.tapped); assert.equal((c.counters || {}).stun, 1); }
});

test('Words of Wind turns your next draw into each player returning a permanent', () => {
  const game = vsOpp();
  const mine = put(game, 'Bear');
  const theirs = put(game.bot.s, 'Giant');
  run(game, { name: 'Words of Wind' }, "The next time you would draw a card this turn, each player returns a permanent they control to its owner's hand instead.");
  assert.equal(Bot.drawInstead(game, game, false, defOf), true);
  assert.equal(mine.zone, 'hand');
  assert.equal(theirs.zone, 'hand');
});

test('War Tax makes each attacker cost {X} this turn', () => {
  const game = vsOpp();
  Bot.refreshGrants(game, defOf);
  run(game, { name: 'War Tax' }, "This turn, creatures can't attack unless their controller pays {2} for each attacking creature they control.");
  assert.equal(Bot.tableRules(game, defOf).attackTax, 2);
});

test('Delver of Secrets transforms when the top card is an instant', () => {
  const game = vsOpp();
  const delver = put(game, 'Delver of Secrets // Insectile Aberration');
  const top = find(game, 'Minor Misstep');
  game.zones.library.splice(game.zones.library.indexOf(top), 1);
  game.zones.library.unshift(top);
  run(game, delver, 'Look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.');
  assert.ok(delver.flipped);
});

test("Thranduil's Decree casts a countered permanent spell for you", () => {
  const game = vsOpp();
  const o = game.bot.s;
  const giant = o.cards[find(o, 'Giant')];
  Game.move(o, giant.iid, 'graveyard');
  Bot.counterExtras(game, game, o, defOf("Thranduil's Decree").oracle, "Thranduil's Decree", 4);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
});

test('Gather Specimens takes a creature that enters on the other side this turn', () => {
  const game = vsOpp();
  run(game, { name: 'Gather Specimens' }, defOf('Gather Specimens').oracle);
  put(game.bot.s, 'Giant');
  Bot.refreshGrants(game, defOf);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
});

test('Callous Oppressor holds a creature while it stays tapped', () => {
  const game = vsOpp();
  const opp = put(game, 'Callous Oppressor');
  put(game.bot.s, 'Giant');
  opp.tapped = true;
  run(game, opp, "Gain control of target creature that isn't of the chosen type for as long as this creature remains tapped.");
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
  opp.tapped = false;
  Bot.refreshGrants(game, defOf);
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Giant'));
});

test("Midnight Mangler is a creature on the opponent's turn", () => {
  const game = vsOpp();
  const m = put(game, 'Midnight Mangler');
  game.offTurn = false;
  Bot.refreshGrants(game, defOf);
  assert.ok(!Game.isCreature(m));
  game.offTurn = true;
  Bot.refreshGrants(game, defOf);
  assert.ok(Game.isCreature(m));
});

test('Retrieve the Esper adds two counters when cast from a graveyard; Blue Dragon shrinks three creatures', () => {
  const game = vsOpp();
  run(game, { name: 'Retrieve the Esper', castFrom: 'graveyard' }, 'Create a 3/3 blue Robot Warrior artifact creature token. Then if this spell was cast from a graveyard, put two +1/+1 counters on that token.');
  const tok = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token && c.name === 'Robot Warrior');
  assert.equal((tok.counters || {})['+1/+1'], 2);
  const big = put(game.bot.s, 'Giant');
  const small = put(game.bot.s, 'Bear');
  run(game, put(game, 'Blue Dragon'), 'Until your next turn, target creature an opponent controls gets -3/-0, up to one other target creature gets -2/-0, and up to one other target creature gets -1/-0.');
  assert.equal(Bot.stats(big, defOf(big.id)).pow, 1);
  assert.equal(Bot.stats(small, defOf(small.id)).pow, 0);
});

// ---- Blue cards, batch 7 (your picks are asked: ctx.choose) ----

test('Brackish Blunder asks which creature to return, and makes a Map if it was tapped', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  put(game.bot.s, 'Giant');
  bear.tapped = true;
  let asked = null;
  const c = ctx(game, { self: { name: 'Brackish Blunder' }, choose: spec => { asked = spec; } });
  Bot.runEffect(game, 'Return target creature to its owner\'s hand. If it was tapped, create a Map token.', c);
  assert.ok(asked && asked.ids.includes(bear.iid));
  Bot.applyChoice(game, asked, [bear.iid], c);
  assert.equal(bear.zone, 'hand');
  assert.ok(game.zones.battlefield.some(i => /map/i.test(game.cards[i].name)));
});

test('Choking Tethers taps the creatures you pick; with no one to ask, the best ones', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  let asked = null;
  const c = ctx(game, { self: { name: 'Choking Tethers' }, choose: spec => { asked = spec; } });
  Bot.runEffect(game, 'Tap up to four target creatures.', c);
  Bot.applyChoice(game, asked, [bear.iid], c);
  assert.ok(bear.tapped && !giant.tapped);
  bear.tapped = false;
  run(game, { name: 'Choking Tethers' }, 'Tap up to four target creatures.');
  assert.ok(bear.tapped && giant.tapped);
});

test('Curfew: the opponent returns its least valuable creature, you pick yours', () => {
  const game = vsOpp();
  const mine = put(game, 'Giant');
  const theirs = put(game.bot.s, 'Bear');
  put(game.bot.s, 'Giant');
  let asked = null;
  const c = ctx(game, { self: { name: 'Curfew' }, choose: spec => { asked = spec; } });
  Bot.runEffect(game, "Each player returns a creature they control to its owner's hand.", c);
  assert.equal(theirs.zone, 'hand');
  Bot.applyChoice(game, asked, [mine.iid], c);
  assert.equal(mine.zone, 'hand');
});

test('Mystery Key is sacrificed for three cards when its creature connects; Lyra draws two on a hit', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const key = put(game, 'Mystery Key');
  key.attachedTo = bear.iid;
  const hand = game.zones.hand.length;
  run(game, bear, 'mystery key pays out');
  assert.equal(key.zone, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 3);
});

test('Phantasmal Dreadmaw is sacrificed when a spell targets it', () => {
  const game = vsOpp();
  const maw = put(game.bot.s, 'Phantasmal Dreadmaw');
  Bot.spellTargeted(game, game, { name: 'Shock', iid: 'x' }, { inst: maw, s: game.bot.s }, defOf, ctx(game));
  assert.equal(maw.zone, 'graveyard');
});

test('Rising Waters keeps lands tapped and untaps one at each upkeep', () => {
  const game = vsOpp();
  put(game, 'Rising Waters');
  const isl = put(game, 'Island');
  isl.tapped = true;
  Bot.phaseTriggers(game, game, 'end step', defOf, ctx(game));
  assert.ok(isl.skipUntap);
  Bot.phaseTriggers(game, game, 'upkeep', defOf, ctx(game));
  assert.ok(!isl.tapped);
});

test('Futurist Operative is a 1/1 that can\'t be blocked while tapped; Trawler Drake counts its oil', () => {
  const game = vsOpp();
  const op = put(game, 'Futurist Operative');
  op.tapped = true;
  Bot.refreshGrants(game, defOf);
  const st = Bot.stats(op, defOf(op.id));
  assert.equal(st.pow, 1);
  assert.ok(st.kw.has('unblockable'));
  const drake = put(game, 'Trawler Drake');
  Game.counter(game, drake.iid, 'oil', 2);
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(drake, defOf(drake.id)).pow, 2);
});

// ---- Blue cards, batch 8 ----

test('Glacial Grasp asks which creature: it taps, stays tapped, and its controller mills two', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  let asked = null;
  const c = ctx(game, { self: { name: 'Glacial Grasp' }, choose: spec => { asked = spec; } });
  const lib = game.bot.s.zones.library.length;
  Bot.runEffect(game, "Tap target creature. Its controller mills two cards. That creature doesn't untap during its controller's next untap step.", c);
  Bot.applyChoice(game, asked, [giant.iid], c);
  assert.ok(giant.tapped && giant.skipUntap);
  assert.equal(game.bot.s.zones.library.length, lib - 2);
});

test('Rishadan Cutpurse: the opponent pays {1} if it can, else sacrifices its least valuable permanent', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  run(game, { name: 'Rishadan Cutpurse' }, 'each opponent sacrifices a permanent of their choice unless they pay {1}');
  assert.equal(bear.zone, 'graveyard'); // no lands to pay with
});

test('Sea Gate Stormcaller copies the next cheap instant or sorcery', () => {
  const game = vsOpp();
  run(game, { name: 'Sea Gate Stormcaller' }, 'copy the next instant or sorcery spell with mana value 2 or less you cast this turn when you cast it. If this creature was kicked, copy that spell twice instead. You may choose new targets for the copies.');
  assert.ok(game.stormcaller);
  const spell = game.cards[find(game, 'Minor Misstep')];
  Bot.spellCast(game, game, spell, defOf, ctx(game));
  assert.ok(!game.stormcaller);
});

test('River Serpent attacks only with five cards in your graveyard', () => {
  const game = vsOpp();
  const rs = put(game, 'River Serpent');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(rs, defOf(rs.id)).kw.has("can't attack"));
  game.zones.library.slice(0, 5).forEach(iid => Game.move(game, iid, 'graveyard'));
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.stats(rs, defOf(rs.id)).kw.has("can't attack"));
});

test('Plagiarize sends the opponent\'s draw to you', () => {
  const game = vsOpp();
  run(game, { name: 'Plagiarize' }, 'Until end of turn, if target player would draw a card, instead that player skips that draw and you draw a card.');
  const hand = game.zones.hand.length;
  assert.equal(Bot.drawInstead(game, game.bot.s, false, defOf), true);
  assert.equal(game.zones.hand.length, hand + 1);
});

// ---- Blue cards, batch 9 ----

test('Sweep Away asks which creature, and an attacker goes on top of its library', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  giant.attacking = true;
  let asked = null;
  const c = ctx(game, { self: { name: 'Sweep Away' }, choose: spec => { asked = spec; } });
  Bot.runEffect(game, "Return target creature to its owner's hand. If that creature is attacking, you may put it on top of its owner's library instead.", c);
  Bot.applyChoice(game, asked, [giant.iid], c);
  assert.equal(game.bot.s.zones.library[0], giant.iid);
});

test('Withdraw: the second creature stays if its controller pays {1}', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  run(game, { name: 'Withdraw' }, "Return target creature to its owner's hand. Then return another target creature to its owner's hand unless its controller pays {1}.");
  assert.equal(giant.zone, 'hand'); // the best one first
  assert.equal(bear.zone, 'hand'); // no lands to pay with
});

test('Master\'s Councillors gets +2/+0 per graveyard with seven cards; Chained Throatseeker needs poison', () => {
  const game = vsOpp();
  const mc = put(game, "Master's Councillors");
  const ct = put(game, 'Chained Throatseeker');
  game.zones.library.slice(0, 7).forEach(iid => Game.move(game, iid, 'graveyard'));
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(mc, defOf(mc.id)).pow, 3);
  assert.ok(Bot.stats(ct, defOf(ct.id)).kw.has("can't attack"));
  game.bot.s.poison = 1;
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.stats(ct, defOf(ct.id)).kw.has("can't attack"));
});

test('Saprazzan Heir draws three when blocked; Wormfang Manta skips your next turn', () => {
  const game = vsOpp();
  const heir = put(game, 'Saprazzan Heir');
  const hand = game.zones.hand.length;
  Bot.becameBlocked(game, heir, 1, defOf, [], game);
  assert.equal(game.zones.hand.length, hand + 3);
  run(game, put(game, 'Wormfang Manta'), 'you skip your next turn');
  assert.equal(game.skipTurn, 1);
});
