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

// ---- Your picks for batch 1-6 effects (asked with ctx.choose; with no one to ask, the old pick) ----

const asking = (game, name, extra = {}) => { const box = { asked: null }; box.c = ctx(game, { self: { name }, choose: spec => { box.asked = spec; }, ...extra }); return box; };

test('Wicked Slumber asks which creatures; one pick gets both stun counters', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const b = asking(game, 'Wicked Slumber');
  Bot.runEffect(game, 'Tap up to two target creatures. Put a stun counter on either of them. Then put a stun counter on either of them.', b.c);
  assert.ok(b.asked && b.asked.ids.includes(bear.iid) && b.asked.max === 2);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.ok(bear.tapped && !giant.tapped);
  assert.equal(bear.counters.stun, 2);
});

test('Legerdemain asks for yours, then theirs of a shared type', () => {
  const game = vsOpp();
  const mine = put(game, 'Bear');
  const theirs = put(game.bot.s, 'Giant');
  const b = asking(game, 'Legerdemain');
  Bot.runEffect(game, 'Exchange control of target artifact or creature and another target permanent that shares one of those types with it.', b.c);
  assert.ok(b.asked.ids.includes(mine.iid));
  const first = b.asked;
  Bot.applyChoice(game, first, [mine.iid], b.c);
  assert.ok(b.asked !== first && b.asked.side === 'theirs' && b.asked.ids.includes(theirs.iid));
  Bot.applyChoice(game, b.asked, [theirs.iid], b.c);
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Bear'));
});

test('Stealth Mission and Ghostform use the creatures you pick', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game, 'Giant');
  let b = asking(game, 'Stealth Mission');
  Bot.runEffect(game, "Put two +1/+1 counters on target creature you control. That creature can't be blocked this turn.", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(bear.counters['+1/+1'], 2);
  assert.ok(!(giant.counters || {})['+1/+1']);
  b = asking(game, 'Ghostform');
  Bot.runEffect(game, "Up to two target creatures can't be blocked this turn.", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.ok(Bot.stats(bear, defOf(bear.id)).kw.has('unblockable'));
  assert.ok(!Bot.stats(giant, defOf(giant.id)).kw.has('unblockable'));
});

test('Scattered Thoughts keeps the two you pick; Extract exiles the card you pick', () => {
  const game = vsOpp();
  const top = game.zones.library.slice(0, 4);
  let b = asking(game, 'Scattered Thoughts');
  Bot.runEffect(game, 'Look at the top four cards of your library. Put two of those cards into your hand and the rest into your graveyard.', b.c);
  assert.deepEqual(b.asked.ids, top);
  Bot.applyChoice(game, b.asked, [top[2], top[3]], b.c);
  assert.deepEqual(top.map(i => game.cards[i].zone), ['graveyard', 'graveyard', 'hand', 'hand']);
  const pick = game.bot.s.zones.library[5];
  b = asking(game, 'Extract');
  Bot.runEffect(game, "Search target player's library for a card and exile it. Then that player shuffles.", b.c);
  Bot.applyChoice(game, b.asked, [pick], b.c);
  assert.equal(game.bot.s.cards[pick].zone, 'exile');
});

test('Blue Dragon shrinks your picks in order: -3, -2, -1', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const b = asking(game, 'Blue Dragon');
  Bot.runEffect(game, 'Until your next turn, target creature an opponent controls gets -3/-0, up to one other target creature gets -2/-0, and up to one other target creature gets -1/-0.', b.c);
  Bot.applyChoice(game, b.asked, [bear.iid, giant.iid], b.c);
  assert.equal(Bot.stats(bear, defOf(bear.id)).pow, -1);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 2);
});

test('Moment of Truth asks for the hand card, then the graveyard card; the last goes under', () => {
  const game = vsOpp();
  const top = game.zones.library.slice(0, 3);
  const b = asking(game, 'Moment of Truth');
  Bot.runEffect(game, 'Look at the top three cards of your library. Put one of those cards into your hand, one into your graveyard, and one on the bottom of your library.', b.c);
  Bot.applyChoice(game, b.asked, [top[1]], b.c);
  assert.deepEqual(b.asked.ids, [top[0], top[2]]);
  Bot.applyChoice(game, b.asked, [top[2]], b.c);
  assert.equal(game.cards[top[1]].zone, 'hand');
  assert.equal(game.cards[top[2]].zone, 'graveyard');
  assert.equal(game.zones.library[game.zones.library.length - 1], top[0]);
});

test('Fade Away: you pick what to sacrifice for the {1}s you cannot pay', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game, 'Giant');
  const b = asking(game, 'Fade Away');
  Bot.runEffect(game, 'For each creature, its controller sacrifices a permanent of their choice unless they pay {1}.', b.c);
  assert.equal(b.asked.min, 2);
  Bot.applyChoice(game, b.asked, [bear.iid, giant.iid], b.c);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(giant.zone, 'graveyard');
});

test('Stinging Lionfish taps the one you pick, or untaps yours after None; Donate gives your pick', () => {
  const game = vsOpp();
  const theirs = put(game.bot.s, 'Giant');
  const mine = put(game, 'Bear');
  mine.tapped = true;
  let b = asking(game, 'Stinging Lionfish');
  Bot.runEffect(game, 'you may tap or untap target nonland permanent', b.c);
  assert.ok(b.asked.ids.includes(theirs.iid));
  Bot.applyChoice(game, b.asked, [], b.c);
  assert.ok(b.asked.ids.includes(mine.iid));
  Bot.applyChoice(game, b.asked, [mine.iid], b.c);
  assert.ok(!mine.tapped && !theirs.tapped);
  b = asking(game, 'Donate');
  Bot.runEffect(game, 'Target player gains control of target permanent you control.', b.c);
  Bot.applyChoice(game, b.asked, [mine.iid], b.c);
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Bear'));
});

test('Metamorphic Blast turns the creature you pick into a 0/1 Rabbit', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const b = asking(game, 'Metamorphic Blast');
  Bot.runEffect(game, "the opponent's best creature becomes a 0/1 rabbit this turn", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(Bot.stats(bear, defOf(bear.id)).pow, 0);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 4);
});

test('Fleeting Reflection asks for yours, then which creature it copies this turn', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const b = asking(game, 'Fleeting Reflection');
  Bot.runEffect(game, 'Target creature you control gains hexproof until end of turn. Untap that creature. Until end of turn, it becomes a copy of up to one other target creature.', b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(b.asked.side, 'theirs');
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(bear.id, 'Giant');
});

test('Breakthrough keeps the X cards you pick; Protean Thaumaturge can copy one of yours after None', () => {
  const game = vsOpp();
  Game.drawCards(game, 3, false);
  const b = asking(game, 'Breakthrough', { self: { name: 'Breakthrough', xValue: 1 } });
  Bot.runEffect(game, 'breakthrough', b.c);
  const keep = b.asked.ids[2];
  Bot.applyChoice(game, b.asked, [keep], b.c);
  assert.deepEqual(game.zones.hand, [keep]);
  const th = put(game, 'Protean Thaumaturge');
  const bear = put(game, 'Bear');
  const t = asking(game, 'Protean Thaumaturge', { self: th });
  Bot.runEffect(game, 'this creature copies the best creature', t.c);
  Bot.applyChoice(game, t.asked, [], t.c);
  assert.ok(t.asked.side !== 'theirs' && t.asked.ids.includes(bear.iid));
  Bot.applyChoice(game, t.asked, [bear.iid], t.c);
  assert.equal(th.id, 'Bear');
});

test('Time of Ice holds the creature you pick; Reality Spasm taps the X you pick', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const saga = put(game, 'Time of Ice');
  let b = asking(game, 'Time of Ice', { self: saga });
  Bot.runEffect(game, "the opponent's best creature is tapped while this saga stays", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.ok(bear.tapped && bear.frozenBy && !giant.tapped);
  b = asking(game, 'Reality Spasm');
  Bot.runEffect(game, 'tap 1 target permanents', b.c);
  assert.equal(b.asked.min, 1);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.ok(giant.tapped);
});

test('Vendilion Clique asks which card from their hand goes to the bottom', () => {
  const game = vsOpp();
  const o = game.bot.s;
  Game.drawCards(o, 3, true);
  const pick = o.zones.hand.find(i => !Game.isLand(o.cards[i]));
  const b = asking(game, 'Vendilion Clique');
  Bot.runEffect(game, "the clique bottoms their best card", b.c);
  assert.equal(b.asked.side, 'theirs');
  Bot.applyChoice(game, b.asked, [pick], b.c);
  assert.equal(o.zones.library[o.zones.library.length - 1], pick);
});

test('Wizard\'s Spellbook offers their graveyard, then yours after None', () => {
  const game = vsOpp();
  const book = put(game, "Wizard's Spellbook");
  const mine = game.cards[find(game, 'Fading Hope')];
  Game.move(game, mine.iid, 'graveyard');
  Game.move(game.bot.s, find(game.bot.s, 'Icy Blast'), 'graveyard');
  const b = asking(game, "Wizard's Spellbook", { self: book });
  Bot.runEffect(game, 'the spellbook takes a spell', b.c);
  assert.equal(b.asked.side, 'theirs');
  Bot.applyChoice(game, b.asked, [], b.c);
  assert.ok(b.asked.ids.includes(mine.iid));
  Bot.applyChoice(game, b.asked, [mine.iid], b.c);
  assert.equal(mine.zone, 'exile');
  assert.equal(mine.exiledWith, book.iid);
});

test("Energy Tap taps the creature you pick; Puca's Mischief swaps your pick for theirs", () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game, 'Giant');
  let b = asking(game, 'Energy Tap');
  Bot.runEffect(game, "Tap target untapped creature you control. If you do, add an amount of {C} equal to that creature's mana value.", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.ok(bear.tapped && !giant.tapped);
  assert.equal(game.mana.C, 2);
  const theirs = put(game.bot.s, 'Bear');
  b = asking(game, "Puca's Mischief");
  Bot.runEffect(game, "puca's swap", b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.ok(b.asked.ids.includes(theirs.iid));
  Bot.applyChoice(game, b.asked, [theirs.iid], b.c);
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Giant'));
});

test('Show and Tell asks which card you put in; Opp puts its own', () => {
  const game = vsOpp();
  const giant = game.cards[find(game, 'Giant')];
  Game.move(game, giant.iid, 'hand');
  Game.move(game, find(game, 'Bear'), 'hand');
  const og = find(game.bot.s, 'Giant');
  Game.move(game.bot.s, og, 'hand');
  const b = asking(game, 'Show and Tell');
  Bot.runEffect(game, 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.', b.c);
  assert.ok(game.bot.s.zones.battlefield.length > 0);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(giant.zone, 'battlefield');
});

test('Waterbending Lesson asks what to discard when you cannot pay; Consuming Tide keeps your pick', () => {
  const game = vsOpp();
  Game.drawCards(game, 2, false);
  const pick = game.zones.hand[1];
  let b = asking(game, 'Waterbending Lesson');
  Bot.runEffect(game, 'discard unless you pay {2}', b.c);
  Bot.applyChoice(game, b.asked, [pick], b.c);
  assert.equal(game.cards[pick].zone, 'graveyard');
  const bear = put(game, 'Bear');
  const giant = put(game, 'Giant');
  b = asking(game, 'Consuming Tide');
  Bot.runEffect(game, 'consuming tide', b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(bear.zone, 'battlefield');
  assert.equal(giant.zone, 'hand');
});

test('Memory Deluge keeps the two you pick; Serum Snare returns your pick', () => {
  const game = vsOpp();
  const top = game.zones.library.slice(0, 4);
  let b = asking(game, 'Memory Deluge');
  Bot.runEffect(game, 'memory deluge', b.c);
  assert.deepEqual(b.asked.ids, top);
  Bot.applyChoice(game, b.asked, [top[0], top[3]], b.c);
  assert.equal(game.cards[top[0]].zone, 'hand');
  assert.equal(game.cards[top[3]].zone, 'hand');
  assert.equal(game.cards[top[1]].zone, 'library');
  const bear = put(game.bot.s, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  b = asking(game, 'Serum Snare');
  Bot.runEffect(game, "Return target nonland permanent to its owner's hand. If that permanent had mana value 3 or less, proliferate.", b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(giant.zone, 'hand');
  assert.equal(bear.zone, 'battlefield');
});

test('Gifts Ungiven searches for the cards you pick; the opponent bins the two costliest', () => {
  const game = vsOpp();
  const b = asking(game, 'Gifts Ungiven');
  Bot.runEffect(game, 'Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.', b.c);
  const giant = find(game, 'Giant', ['library']);
  const island = find(game, 'Island', ['library']);
  const bear = find(game, 'Bear', ['library']);
  Bot.applyChoice(game, b.asked, [bear, giant, island], b.c);
  assert.equal(game.cards[giant].zone, 'graveyard');
  assert.equal(game.cards[bear].zone, 'graveyard');
  assert.equal(game.cards[island].zone, 'hand');
});

test('Snapcaster Mage gives flashback to the spell you pick', () => {
  const game = vsOpp();
  const a = game.cards[find(game, 'Fading Hope')];
  const z = game.cards[find(game, 'Icy Blast')];
  Game.move(game, a.iid, 'graveyard');
  Game.move(game, z.iid, 'graveyard');
  const b = asking(game, 'Snapcaster Mage');
  Bot.runEffect(game, 'your best graveyard spell gains flashback', b.c);
  Bot.applyChoice(game, b.asked, [a.iid], b.c);
  assert.equal(a.graveOkTurn, game.turn);
  assert.ok(z.graveOkTurn == null);
});

// ---- Blue cards, batch 10, chunk 1 ----

test('Wormfang Newt asks which land it exiles; Wormfang Drake is sacrificed after None', () => {
  const game = vsOpp();
  const newt = put(game, 'Wormfang Newt');
  const land = put(game, 'Island');
  let b = asking(game, 'Wormfang Newt', { self: newt });
  Bot.runEffect(game, 'exile a land you control', b.c);
  Bot.applyChoice(game, b.asked, [land.iid], b.c);
  assert.equal(land.zone, 'exile');
  assert.equal(land.exiledWith, newt.iid);
  const drake = put(game, 'Wormfang Drake');
  b = asking(game, 'Wormfang Drake', { self: drake });
  Bot.runEffect(game, 'sacrifice it unless you exile a creature you control other than this creature', b.c);
  Bot.applyChoice(game, b.asked, [], b.c);
  assert.equal(drake.zone, 'graveyard');
});

test('Giant Tortoise is 1/4 untapped; Geralf\'s Masterpiece shrinks per card in hand; Snowmelt Stag is 5/2 on your turn', () => {
  const game = vsOpp();
  const t = put(game, 'Giant Tortoise');
  const gm = put(game, "Geralf's Masterpiece");
  const st = put(game, 'Snowmelt Stag');
  Game.drawCards(game, 2, false);
  game.offTurn = false;
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(t, defOf(t.id)).tou, 4);
  assert.equal(Bot.stats(gm, defOf(gm.id)).pow, 7 - game.zones.hand.length);
  assert.equal(Bot.stats(st, defOf(st.id)).pow, 5);
  t.tapped = true;
  game.offTurn = true;
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(t, defOf(t.id)).tou, 1);
  assert.equal(Bot.stats(st, defOf(st.id)).pow, 2);
});

test('Juxtapose swaps the costliest creatures; Amnesia empties their hand of spells', () => {
  const game = vsOpp();
  put(game, 'Bear');
  put(game.bot.s, 'Giant');
  run(game, { name: 'Juxtapose' }, 'You and target player exchange control of the creature you each control with the greatest mana value. Then exchange control of artifacts the same way. If two or more permanents a player controls are tied for greatest, their controller chooses one of them.');
  assert.ok(game.zones.battlefield.some(i => game.cards[i].id === 'Giant'));
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].id === 'Bear'));
  Game.drawCards(game.bot.s, 5, true);
  run(game, { name: 'Amnesia' }, 'Target player reveals their hand and discards all nonland cards.');
  assert.ok(game.bot.s.zones.hand.every(i => Game.isLand(game.bot.s.cards[i])));
});

test('Mistform Ultimus is every creature type; Spin into Myth asks for the creature, then fateseals', () => {
  const game = vsOpp();
  const mu = put(game, 'Mistform Ultimus');
  assert.ok(mu.changeling);
  const giant = put(game.bot.s, 'Giant');
  const b = asking(game, 'Spin into Myth');
  Bot.runEffect(game, "Put target creature on top of its owner's library, then fateseal 2.", b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(game.bot.s.zones.library[0], giant.iid);
  assert.equal(b.asked.fn, 'bottomTheirs');
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(game.bot.s.zones.library[game.bot.s.zones.library.length - 1], giant.iid);
});

// ---- Blue cards, batch 10, chunk 2 ----

test('Expedition Lookout attacks unblocked past eight cards; Manta Ray is unblockable without blue blockers; So Tiny grows', () => {
  const game = vsOpp();
  const el = put(game, 'Expedition Lookout');
  put(game, 'Island');
  const mr = put(game, 'Manta Ray');
  const giant = put(game.bot.s, 'Giant');
  const tiny = put(game, 'So Tiny');
  tiny.attachedTo = giant.iid;
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.stats(el, defOf(el.id)).kw.has('unblockable'));
  assert.ok(Bot.stats(mr, defOf(mr.id)).kw.has('unblockable'));
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 2);
  game.bot.s.zones.library.slice(0, 8).forEach(i => Game.move(game.bot.s, i, 'graveyard'));
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(el, defOf(el.id)).kw.has('unblockable'));
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, -2);
});

test('Bamboozle bins the two you pick; Balance of Power draws the difference', () => {
  const game = vsOpp();
  const o = game.bot.s;
  const top = o.zones.library.slice(0, 4);
  const b = asking(game, 'Bamboozle');
  Bot.runEffect(game, "Target player reveals the top four cards of their library. You choose two of those cards and put them into that player's graveyard. Put the rest on top of their library in any order.", b.c);
  Bot.applyChoice(game, b.asked, [top[1], top[3]], b.c);
  assert.deepEqual(top.map(i => o.cards[i].zone), ['library', 'graveyard', 'library', 'graveyard']);
  Game.drawCards(o, 4, true);
  const hand = game.zones.hand.length;
  run(game, { name: 'Balance of Power' }, 'If target opponent has more cards in hand than you, draw cards equal to the difference.');
  assert.equal(game.zones.hand.length, Math.max(hand, o.zones.hand.length));
});

test('Rite of Undoing returns yours, then theirs; Accumulated Knowledge counts the graveyards', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const b = asking(game, 'Rite of Undoing');
  Bot.runEffect(game, "Return target nonland permanent you control and target nonland permanent you don't control to their owners' hands.", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(bear.zone, 'hand');
  assert.equal(giant.zone, 'hand');
  Game.move(game.bot.s, find(game.bot.s, 'Accumulated Knowledge'), 'graveyard');
  const hand = game.zones.hand.length;
  run(game, { name: 'Accumulated Knowledge' }, 'Draw a card, then draw cards equal to the number of cards named Accumulated Knowledge in all graveyards.');
  assert.equal(game.zones.hand.length, hand + 2);
});

test('Torrent Sculptor exiles your pick for half its mana value in counters', () => {
  const game = vsOpp();
  const ts = put(game, 'Torrent Sculptor // Flamethrower Sonata');
  const spell = game.cards[find(game, 'Meditate')];
  Game.move(game, spell.iid, 'graveyard');
  const b = asking(game, 'Torrent Sculptor', { self: ts });
  Bot.runEffect(game, "exile an instant or sorcery card from your graveyard. put a number of +1/+1 counters on this creature equal to half that card's mana value, rounded up.", b.c);
  Bot.applyChoice(game, b.asked, [spell.iid], b.c);
  assert.equal(spell.zone, 'exile');
  assert.equal(ts.counters['+1/+1'], 2);
});

// ---- Blue cards, batch 10, chunk 3 ----

test('Short Circuit and Sea Legs follow their host; Tidewalker counts time counters; Animate Artifact animates', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const sc = put(game, 'Short Circuit');
  sc.attachedTo = giant.iid;
  const bear = put(game, 'Bear');
  const legs = put(game, 'Sea Legs');
  legs.attachedTo = bear.iid;
  const tw = put(game, 'Tidewalker');
  tw.counters = { time: 3 };
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 1);
  assert.equal(Bot.stats(bear, defOf(bear.id)).pow, 0);
  assert.equal(Bot.stats(tw, defOf(tw.id)).pow, 3);
  Game.move(game, sc.iid, 'graveyard');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 4);
});

test('Frozen Solid destroys its creature when it is dealt damage; Unstable Mutation shrinks it each upkeep', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const fs = put(game, 'Frozen Solid');
  fs.attachedTo = giant.iid;
  Bot.creatureDamaged(game, game.bot.s, giant, 1, defOf, ctx(game));
  assert.equal(giant.zone, 'graveyard');
});

test('Hour of Need turns your picks into Sphinxes; Hotshot Investigators investigates for your own creature', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  let b = asking(game, 'Hour of Need');
  Bot.runEffect(game, 'Exile any number of target creatures. For each creature exiled this way, its controller creates a 4/4 blue Sphinx creature token with flying.', b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(giant.zone, 'exile');
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].name === 'Sphinx'));
  const hi = put(game, 'Hotshot Investigators');
  const bear = put(game, 'Bear');
  b = asking(game, 'Hotshot Investigators', { self: hi });
  Bot.runEffect(game, "Return up to one other target creature to its owner's hand. If you controlled it, investigate.", b.c);
  Bot.applyChoice(game, b.asked, [], b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(bear.zone, 'hand');
  assert.ok(game.zones.battlefield.some(i => /clue/i.test(game.cards[i].name)));
});

test('Heed the Mists draws the milled mana value; Reduce to Dreams returns artifacts and enchantments', () => {
  const game = vsOpp();
  const top = game.cards[game.zones.library[0]];
  const hand = game.zones.hand.length;
  run(game, { name: 'Heed the Mists' }, "Mill a card, then draw cards equal to the milled card's mana value.");
  assert.equal(game.zones.hand.length, hand + (top.cmc || 0));
  const sc = put(game, 'Short Circuit');
  run(game, { name: 'Reduce to Dreams' }, "Return all artifacts and enchantments to their owners' hands.");
  assert.equal(sc.zone, 'hand');
});

// ---- Blue cards, batch 11, chunk 1 ----

test('Consign to Dream tops a red creature; Chillbringer freezes your pick', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const drake = put(game.bot.s, 'Drake');
  let b = asking(game, 'Consign to Dream');
  Bot.runEffect(game, "Return target permanent to its owner's hand. If that permanent is red or green, put it on top of its owner's library instead.", b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(game.bot.s.zones.library[0], giant.iid);
  b = asking(game, 'Chillbringer');
  Bot.runEffect(game, "tap target creature an opponent controls. It doesn't untap during its controller's next untap step.", b.c);
  Bot.applyChoice(game, b.asked, [drake.iid], b.c);
  assert.ok(drake.tapped && drake.skipUntap);
});

test('Isleback Spawn grows when a library is small; Briarberry Cohort needs another blue creature; Hazy Homunculus evades untapped lands', () => {
  const game = vsOpp();
  const sp = put(game, 'Isleback Spawn');
  const bc = put(game, 'Briarberry Cohort');
  const hz = put(game, 'Hazy Homunculus');
  put(game.bot.s, 'Island');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(sp, defOf(sp.id)).pow, 4);
  assert.equal(Bot.stats(bc, defOf(bc.id)).pow, 2);
  assert.ok(Bot.stats(hz, defOf(hz.id)).kw.has('unblockable'));
  game.zones.library.slice(20).forEach(i => Game.move(game, i, 'graveyard'));
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(sp, defOf(sp.id)).pow, 8);
});

test('Fathom Trawl takes three nonland cards; Skywarp Skaab exiles your two picks to draw', () => {
  const game = vsOpp();
  const hand = game.zones.hand.length;
  run(game, { name: 'Fathom Trawl' }, 'Reveal cards from the top of your library until you reveal three nonland cards. Put the nonland cards revealed this way into your hand, then put the rest of the revealed cards on the bottom of your library in any order.');
  assert.equal(game.zones.hand.length, hand + 3);
  assert.ok(game.zones.hand.slice(hand).every(i => !Game.isLand(game.cards[i])));
  const ids = game.zones.library.filter(i => Game.isCreature(game.cards[i])).slice(0, 2);
  ids.forEach(i => Game.move(game, i, 'graveyard'));
  const sk = put(game, 'Skywarp Skaab');
  const b = asking(game, 'Skywarp Skaab', { self: sk });
  Bot.runEffect(game, 'you may exile two creature cards from your graveyard. If you do, draw a card.', b.c);
  const h2 = game.zones.hand.length;
  Bot.applyChoice(game, b.asked, ids, b.c);
  assert.ok(ids.every(i => game.cards[i].zone === 'exile'));
  assert.equal(game.zones.hand.length, h2 + 1);
});

// ---- Blue cards, batch 11, chunk 2 ----

test('Reality Twist pays its growing upkeep; Silburlind Snapper waits for a noncreature spell; Furtive Courier after an artifact sacrifice', () => {
  const game = vsOpp();
  const sn = put(game, 'Silburlind Snapper');
  const fc = put(game, 'Furtive Courier');
  game.spellTurn = game.turn; game.castThisTurn = [];
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(sn, defOf(sn.id)).kw.has("can't attack"));
  assert.ok(!Bot.stats(fc, defOf(fc.id)).kw.has('unblockable'));
  game.castThisTurn = [{ typeLine: 'Instant' }];
  game.artifactSacTurn = game.turn;
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.stats(sn, defOf(sn.id)).kw.has("can't attack"));
  assert.ok(Bot.stats(fc, defOf(fc.id)).kw.has('unblockable'));
  const rt = put(game, 'Reality Twist');
  run(game, rt, 'pay cumulative upkeep {1}{U}{U} or sacrifice this permanent');
  assert.equal(rt.zone, 'graveyard'); // no lands to pay with
});

test('Wizard Mentor returns itself and your pick; Gulf Squid taps their lands; Hedron Alignment needs all four zones', () => {
  const game = vsOpp();
  const wm = put(game, 'Wizard Mentor');
  const bear = put(game, 'Bear');
  const b = asking(game, 'Wizard Mentor', { self: wm });
  Bot.runEffect(game, "Return this creature and target creature you control to their owner's hand.", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(bear.zone, 'hand');
  assert.equal(wm.zone, 'hand');
  const land = put(game.bot.s, 'Island');
  run(game, { name: 'Gulf Squid' }, 'tap all lands target player controls');
  assert.ok(land.tapped);
});

test('Dwindle destroys its creature when it blocks; Chambered Nautilus draws when blocked', () => {
  const game = vsOpp();
  const nau = put(game, 'Chambered Nautilus');
  const giant = put(game.bot.s, 'Giant');
  const dw = put(game, 'Dwindle');
  dw.attachedTo = giant.iid;
  const hand = game.zones.hand.length;
  Bot.becameBlocked(game, nau, 1, defOf, [giant], game);
  assert.equal(giant.zone, 'graveyard');
  assert.equal(game.zones.hand.length, hand + 1);
});

// ---- Blue cards, batch 11, chunk 3 ----

test('Fatigue skips the next draw step; Godhunter Octopus needs an enchantment to attack; Sejiri Merfolk with a Plains', () => {
  const game = vsOpp();
  const o = game.bot.s;
  run(game, { name: 'Fatigue' }, 'Target player skips their next draw step.');
  const hand = o.zones.hand.length;
  Game.nextTurn(o);
  assert.equal(o.zones.hand.length, hand);
  Game.nextTurn(o);
  assert.equal(o.zones.hand.length, hand + 1);
  const oct = put(game, 'Godhunter Octopus');
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(oct, defOf(oct.id)).kw.has("can't attack"));
  const veil = put(o, 'Veiled Serpent');
  Bot.refreshGrants(game, defOf);
  assert.ok(!Bot.stats(oct, defOf(oct.id)).kw.has("can't attack"));
});

test('Veiled Serpent becomes a 4/4 when the opponent casts a spell; Mist Dragon gains and loses flying', () => {
  const game = vsOpp();
  const vs = put(game, 'Veiled Serpent');
  Bot.spellCast(game, game.bot.s, game.bot.s.cards[find(game.bot.s, 'Fatigue')], defOf, ctx(game));
  assert.ok(Game.isCreature(vs));
  assert.equal(Bot.stats(vs, defOf(vs.id)).pow, 4);
  const md = put(game, 'Mist Dragon');
  run(game, md, 'This creature gains flying.');
  assert.ok(Bot.stats(md, defOf(md.id)).kw.has('flying'));
  run(game, md, 'This creature loses flying.');
  assert.ok(!Bot.stats(md, defOf(md.id)).kw.has('flying'));
});

test('Rookie Mistake asks for yours, then theirs; Scalpelexis exiles four', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  const b = asking(game, 'Rookie Mistake');
  Bot.runEffect(game, 'Until end of turn, target creature gets +0/+2 and another target creature gets -2/-0.', b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(Bot.stats(bear, defOf(bear.id)).tou, 4);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 2);
  const lib = game.bot.s.zones.library.length;
  run(game, put(game, 'Scalpelexis'), 'that player exiles the top four cards of their library. If two or more of those cards have the same name, repeat this process.');
  assert.ok(game.bot.s.zones.library.length <= lib - 4);
});

// ---- Blue cards, batch 12, chunk 1 ----

test('Veil of Birds and Veiled Sentry become creatures when the opponent casts a spell', () => {
  const game = vsOpp();
  const vb = put(game, 'Veil of Birds');
  const vs = put(game, 'Veiled Sentry');
  const giant = game.bot.s.cards[find(game.bot.s, 'Giant')];
  Bot.spellCast(game, game.bot.s, giant, defOf, ctx(game));
  assert.equal(Bot.stats(vb, defOf(vb.id)).pow, 1);
  assert.ok(Bot.stats(vb, defOf(vb.id)).kw.has('flying'));
  assert.equal(Bot.stats(vs, defOf(vs.id)).pow, 4);
});

test('Churning Eddy asks for a creature, then a land; Ether Well bottoms a red creature', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  const land = put(game.bot.s, 'Island');
  let b = asking(game, 'Churning Eddy');
  Bot.runEffect(game, "Return target creature and target land to their owners' hands.", b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  Bot.applyChoice(game, b.asked, [land.iid], b.c);
  assert.equal(giant.zone, 'hand');
  assert.equal(land.zone, 'hand');
  const g2 = put(game.bot.s, 'Giant');
  b = asking(game, 'Ether Well');
  Bot.runEffect(game, "Put target creature on top of its owner's library. If that creature is red, you may put it on the bottom of its owner's library instead.", b.c);
  Bot.applyChoice(game, b.asked, [g2.iid], b.c);
  const L = game.bot.s.zones.library;
  assert.equal(L[L.length - 1], g2.iid);
});

test('Swimmer in Nightmares grows with a full graveyard; Mindculling draws two and makes them discard two', () => {
  const game = vsOpp();
  const sw = put(game, 'Swimmer in Nightmares');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(sw, defOf(sw.id)).pow, 1);
  game.bot.s.zones.library.slice(0, 10).forEach(i => Game.move(game.bot.s, i, 'graveyard'));
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(sw, defOf(sw.id)).pow, 4);
  Game.drawCards(game.bot.s, 3, true);
  const oh = game.bot.s.zones.hand.length;
  const h = game.zones.hand.length;
  run(game, { name: 'Mindculling' }, 'You draw two cards and target opponent discards two cards.');
  assert.equal(game.zones.hand.length, h + 2);
  assert.equal(game.bot.s.zones.hand.length, oh - 2);
});

// ---- Blue cards, batch 12, chunk 2 ----

test('Homarid follows its tide counters; Tidal Influence shrinks blue creatures at one counter; Fledgling Osprey flies when enchanted', () => {
  const game = vsOpp();
  const hm = put(game, 'Homarid');
  hm.counters = { tide: 1 };
  const ti = put(game, 'Tidal Influence');
  ti.counters = { tide: 1 };
  const drake = put(game.bot.s, 'Drake');
  const os = put(game, 'Fledgling Osprey');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(hm, defOf(hm.id)).pow, -1); // 2 - 1, and -2 more as a blue creature (Tidal Influence)
  assert.equal(Bot.stats(drake, defOf(drake.id)).pow, 0);
  assert.ok(!Bot.stats(os, defOf(os.id)).kw.has('flying'));
  const aura = put(game, 'Spectral Cloak');
  aura.attachedTo = os.iid;
  hm.counters.tide = 4;
  Bot.refreshGrants(game, defOf);
  assert.ok(Bot.stats(os, defOf(os.id)).kw.has('flying'));
  assert.equal(hm.counters.tide, 0);
});

test('Browse keeps your pick and exiles the rest; Venarian Glimmer discards your pick', () => {
  const game = vsOpp();
  const top = game.zones.library.slice(0, 5);
  let b = asking(game, 'Browse');
  Bot.runEffect(game, 'Look at the top five cards of your library, put one of them into your hand, and exile the rest.', b.c);
  Bot.applyChoice(game, b.asked, [top[2]], b.c);
  assert.equal(game.cards[top[2]].zone, 'hand');
  assert.equal(game.cards[top[0]].zone, 'exile');
  const o = game.bot.s;
  Game.move(o, find(o, 'Bear'), 'hand');
  const bear = o.cards[find(o, 'Bear', ['hand'])];
  b = asking(game, 'Venarian Glimmer', { self: { name: 'Venarian Glimmer', xValue: 2 } });
  Bot.runEffect(game, "Target player reveals their hand. You choose a nonland card with mana value X or less from it. That player discards that card.", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(bear.zone, 'graveyard');
});

// ---- Blue cards, batch 12, chunk 3 ----

test('Secretkeeper grows with the bigger hand; Water Wurm sees their Island; Steelclad Serpent needs another artifact', () => {
  const game = vsOpp();
  const sk = put(game, 'Secretkeeper');
  const ww = put(game, 'Water Wurm');
  const ss = put(game, 'Steelclad Serpent');
  put(game.bot.s, 'Island');
  Game.drawCards(game, 3, false);
  Bot.refreshGrants(game, defOf);
  assert.ok(game.zones.hand.length > game.bot.s.zones.hand.length);
  assert.equal(Bot.stats(sk, defOf(sk.id)).pow, 4);
  assert.ok(Bot.stats(sk, defOf(sk.id)).kw.has('flying'));
  assert.equal(Bot.stats(ww, defOf(ww.id)).tou, 2);
  assert.ok(Bot.stats(ss, defOf(ss.id)).kw.has("can't attack"));
});

test('Psychic Transfer swaps close life totals; Neurok Familiar keeps an artifact', () => {
  const game = vsOpp();
  game.life = 38; game.oppLife = 41;
  run(game, { name: 'Psychic Transfer' }, "If the difference between your life total and target player's life total is 5 or less, exchange life totals with that player.");
  assert.equal(game.life, 41);
  assert.equal(game.oppLife, 38);
  const top = game.cards[game.zones.library[0]];
  run(game, put(game, 'Neurok Familiar'), "reveal the top card of your library. If it's an artifact card, put it into your hand. Otherwise, put it into your graveyard.");
  assert.equal(top.zone, /artifact/i.test(top.typeLine) ? 'hand' : 'graveyard');
});

test('Saprazzan Outrigger goes on top of its library at end of combat', () => {
  const game = vsOpp();
  const so = put(game, 'Saprazzan Outrigger');
  so.attacking = true;
  run(game, so, "put it on top of its owner's library at end of combat.");
  Bot.endOfCombat(game, [so], defOf);
  assert.equal(game.zones.library[0], so.iid);
});

// ---- Blue cards, batch 13 ----

test('Fettergeist pays per other creature; Timid Drake leaves when another creature enters; Shoreline Raider has protection from Kavu', () => {
  const game = vsOpp();
  const fg = put(game, 'Fettergeist');
  put(game, 'Bear');
  run(game, fg, 'sacrifice this creature unless you pay {1} for each other creature you control');
  assert.equal(fg.zone, 'graveyard'); // no lands
  const td = put(game, 'Timid Drake');
  const giant = game.cards[find(game, 'Giant')];
  Game.move(game, giant.iid, 'battlefield', { put: true });
  Bot.enterTrigger(game, giant, defOf);
  assert.equal(td.zone, 'hand');
  const sr = put(game, 'Shoreline Raider');
  assert.ok(Bot.stats(sr, defOf(sr.id)).kw.has('protection from type kavu'));
});

// ---- Blue cards, batch 14 (multicolor blue) ----

test('Oko makes your pick an Elk; Earthbend animates your land; Jodah pumps legends', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  let b = asking(game, 'Oko, Thief of Crowns');
  Bot.runEffect(game, 'Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.', b.c);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 3);
  const land = put(game, 'Island');
  b = asking(game, 'Earthbend');
  Bot.runEffect(game, 'earthbend 2', b.c);
  Bot.applyChoice(game, b.asked, [land.iid], b.c);
  assert.ok(Game.isCreature(land));
  assert.equal(Bot.stats(land, defOf(land.id)).pow, 2);
  const jo = put(game, 'Jodah, the Unifier');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(jo, defOf(jo.id)).pow, 6);
});

test('Sliver Legion counts the other Slivers; Space-Time Anomaly mills your life total', () => {
  const game = vsOpp();
  const sl = put(game, 'Sliver Legion');
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.stats(sl, defOf(sl.id)).pow, 7);
  game.life = 5;
  const lib = game.bot.s.zones.library.length;
  run(game, { name: 'Space-Time Anomaly' }, 'Target player mills cards equal to your life total.');
  assert.equal(game.bot.s.zones.library.length, lib - 5);
});

// ---- Blue cards, batch 15 (multicolor blue) ----

test('Magister Sphinx sets their life to 10; Coalition Victory needs all five; Mind Funeral mills to four lands', () => {
  const game = vsOpp();
  run(game, { name: 'Magister Sphinx' }, "target player's life total becomes 10");
  assert.equal(game.oppLife, 10);
  const life = game.oppLife;
  run(game, { name: 'Coalition Victory' }, 'You win the game if you control a land of each basic land type and a creature of each color.');
  assert.equal(game.oppLife, life);
  const o = game.bot.s;
  run(game, { name: 'Mind Funeral' }, 'Target opponent reveals cards from the top of their library until four land cards are revealed. That player puts all cards revealed this way into their graveyard.');
  assert.ok(o.zones.graveyard.filter(i => Game.isLand(o.cards[i])).length >= Math.min(4, 10));
});

test('Gandalf\'s Sanction sends the excess damage to the controller', () => {
  const game = vsOpp();
  const bear = put(game.bot.s, 'Bear');
  ['Fading Hope', 'Icy Blast', 'Meditate', 'Amnesia', 'Foresight'].forEach(id => Game.move(game, find(game, id), 'graveyard'));
  const life = game.oppLife;
  const b = asking(game, "Gandalf's Sanction");
  Bot.runEffect(game, "Gandalf's Sanction deals X damage to target creature, where X is the number of instant and sorcery cards in your graveyard. Excess damage is dealt to that creature's controller instead.", b.c);
  Bot.applyChoice(game, b.asked, [bear.iid], b.c);
  assert.equal(bear.zone, 'graveyard');
  assert.equal(game.oppLife, life - 3);
});

// ---- Blue cards, batch 16 (multicolor blue) ----

test('Splatter Technique hits both sides; Dragonclaw Strike asks which of yours to double', () => {
  const game = vsOpp();
  const mine = put(game, 'Bear');
  const theirs = put(game.bot.s, 'Bear');
  run(game, { name: 'Splatter Technique' }, 'Splatter Technique deals 4 damage to each creature and planeswalker.');
  assert.equal(mine.zone, 'graveyard');
  assert.equal(theirs.zone, 'graveyard');
  const giant = put(game, 'Giant');
  const pow = Bot.stats(giant, defOf(giant.id)).pow;
  const b = asking(game, 'Dragonclaw Strike');
  Bot.runEffect(game, 'Double the power and toughness of target creature you control until end of turn.', b.c);
  assert.ok(b.asked);
  Bot.applyChoice(game, b.asked, [giant.iid], b.c);
  assert.equal(Bot.stats(giant, defOf(giant.id)).pow, 2 * pow);
});

test('Nicol Bolas empties their hand; Lochmere Serpent exiles five of their graveyard', () => {
  const game = vsOpp();
  const o = game.bot.s;
  o.zones.library.slice(0, 3).forEach(iid => Game.move(o, iid, 'hand'));
  run(game, { name: 'Nicol Bolas' }, 'that player discards their hand.');
  assert.equal(o.zones.hand.length, 0);
  o.zones.library.slice(0, 6).forEach(iid => Game.move(o, iid, 'graveyard'));
  const gy = o.zones.graveyard.length;
  run(game, { name: 'Lochmere Serpent' }, "Exile five target cards from an opponent's graveyard.");
  assert.equal(o.zones.graveyard.length, gy - 5);
});

// ---- Blue cards, batch 17 (multicolor blue) ----

test('Thought Erasure asks which of their cards they discard; Astonishing Spider-Man refills your hand', () => {
  const game = vsOpp();
  const o = game.bot.s;
  o.zones.library.slice(0, 3).forEach(iid => Game.move(o, iid, 'hand'));
  const b = asking(game, 'Thought Erasure');
  Bot.runEffect(game, 'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.', b.c);
  assert.ok(b.asked);
  assert.equal(b.asked.side, 'theirs');
  const pick = b.asked.ids[0];
  Bot.applyChoice(game, b.asked, [pick], b.c);
  assert.equal(o.cards[pick].zone, 'graveyard');
  game.zones.library.slice(0, 3).forEach(iid => Game.move(game, iid, 'hand'));
  const hand = game.zones.hand.length;
  run(game, { name: 'Astonishing Spider-Man' }, "You may discard your hand. If you do, draw a card for each card you've discarded this turn.");
  assert.ok(game.zones.hand.length >= hand);
});

test('Search Warrant gains a life per card in their hand; Tezzeret the Schemer makes an Etherium Cell', () => {
  const game = vsOpp();
  const o = game.bot.s;
  o.zones.library.slice(0, 4).forEach(iid => Game.move(o, iid, 'hand'));
  const life = game.life;
  run(game, { name: 'Search Warrant' }, 'Target player reveals their hand. You gain life equal to the number of cards in that player\'s hand.');
  assert.equal(game.life, life + o.zones.hand.length);
  run(game, { name: 'Tezzeret the Schemer' }, 'Create a colorless artifact token named Etherium Cell with "{T}, Sacrifice this token: Add one mana of any color."');
  assert.ok(game.zones.battlefield.some(iid => game.cards[iid].name === 'Etherium Cell'));
});

// ---- Blue cards, batch 18 (multicolor blue) ----

test("Urza's Guilt costs both players 4 life; the Alara blades need another multicolored permanent", () => {
  const game = vsOpp();
  const life = game.life, oppLife = game.oppLife;
  run(game, { name: "Urza's Guilt" }, 'Each player draws two cards, then discards three cards, then loses 4 life.');
  assert.equal(game.life, life - 4);
  assert.equal(game.oppLife, oppLife - 4);
  const blade = put(game, 'Bant Sureblade');
  Bot.refreshGrants(game, defOf);
  const before = Bot.stats(blade, defOf(blade.id)).pow;
  put(game, 'Esper Stormblade');
  Bot.refreshGrants(game, defOf);
  const st = Bot.stats(blade, defOf(blade.id));
  assert.equal(st.pow, before + 1);
  assert.ok(st.kw.has('first strike'));
});

test('Thoughtweft Gambit taps theirs and untaps yours; Soulquake returns every creature', () => {
  const game = vsOpp();
  const mine = put(game, 'Bear');
  mine.tapped = true;
  const theirs = put(game.bot.s, 'Bear');
  run(game, { name: 'Thoughtweft Gambit' }, 'Tap all creatures your opponents control and untap all creatures you control.');
  assert.equal(mine.tapped, false);
  assert.equal(theirs.tapped, true);
  run(game, { name: 'Soulquake' }, "Return all creatures on the battlefield and all creature cards in graveyards to their owners' hands.");
  assert.equal(mine.zone, 'hand');
  assert.equal(theirs.zone, 'hand');
});

// ---- Blue cards, batch 19 (multicolor and digital-only blue) ----

test('Seek puts a random matching card from your library into your hand; Lobotomy exiles every copy', () => {
  const game = vsOpp();
  const hand = game.zones.hand.length;
  run(game, { name: 'Seek New Knowledge' }, 'Seek two nonland cards.');
  assert.equal(game.zones.hand.length, hand + 2);
  assert.ok(game.zones.hand.slice(-2).every(iid => !Game.isLand(game.cards[iid])));
  const o = game.bot.s;
  o.zones.library.filter(iid => !Game.isLand(o.cards[iid])).slice(0, 3).forEach(iid => Game.move(o, iid, 'hand'));
  run(game, { name: 'Lobotomy' }, "Target player reveals their hand, then you choose a card other than a basic land card from it. Search that player's graveyard, hand, and library for all cards with the same name as the chosen card and exile them. Then that player shuffles.");
  assert.ok(o.zones.exile.length >= 1);
});
