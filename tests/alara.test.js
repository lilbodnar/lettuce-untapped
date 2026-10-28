// "One drop legendaries?" (archidekt.com/decks/27879643, Child of Alara): one-mana legends in five colors, played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./alara-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle: '', colors: ['R'] },
  Knight: { id: 'Knight', name: 'Black Knight', typeLine: 'Creature — Knight', manaCost: '{B}{B}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['B'] },
  Sword: { id: 'Sword', name: 'Short Sword', typeLine: 'Artifact — Equipment', manaCost: '{1}', cmc: 1, oracle: 'Equipped creature gets +1/+1.\nEquip {1}', colors: [] },
  Lesson: { id: 'Lesson', name: 'Lesson', typeLine: 'Sorcery — Lesson', manaCost: '{1}', cmc: 1, oracle: 'Draw a card.', colors: [] },
  Bolt: { id: 'Bolt', name: 'Bolt', typeLine: 'Instant', manaCost: '{1}{R}', cmc: 2, oracle: 'Bolt deals 3 damage to any target.', colors: ['R'] },
  Bird: { id: 'Bird', name: 'Bird', typeLine: 'Creature — Bird', manaCost: '{2}{W}', cmc: 3, power: '1', toughness: '1', oracle: 'Flying', colors: ['W'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: id === 'Plains' ? 10 : 1 })) });
const vsOpp = () => {
  const game = Game.create(deck('You', Object.keys(defs)), defs);
  game.bot = Bot.create(deck('Opp', Object.keys(defs)), defs, { onDraw: true });
  [game, game.bot.s].forEach(Game.takeBackLeylines); // a fixed start: nothing begins on the battlefield
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard', 'battlefield']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); if (s.cards[iid].zone !== 'battlefield') Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; }; // (a Leyline may have begun there)
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const st = c => Bot.stats(c, defOf(c.id));
const run = (game, who, text, extra = {}) => Bot.runEffect(game, text, ctx(game, { self: who, ...extra }));
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

test('every card in the deck is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test("Leyline of the Guildpact and Quicksilver begin the game on the battlefield (and go back with a mulligan)", () => {
  const only = { ...basics, 'Leyline of the Guildpact': cards['Leyline of the Guildpact'], 'Quicksilver, Brash Blur': cards['Quicksilver, Brash Blur'] };
  const s = Game.create({ key: 'L', name: 'L', rows: [{ id: 'Leyline of the Guildpact', qty: 1 }, { id: 'Quicksilver, Brash Blur', qty: 1 }, { id: 'Plains', qty: 5 }] }, only);
  const names = s.zones.battlefield.map(i => s.cards[i].name).sort();
  assert.deepEqual(names, ['Leyline of the Guildpact', 'Quicksilver, Brash Blur']);
  Game.mulligan(s);
  assert.equal(s.zones.battlefield.length, 2); // seven cards: they're all drawn again
  assert.equal(s.zones.hand.length + s.zones.battlefield.length, 7);
});

test('Prismatic Omen: your lands tap for any color; Leyline of the Guildpact makes your permanents all colors', () => {
  const game = vsOpp();
  const plains = put(game, 'Plains');
  assert.deepEqual(Game.sourceOf(game, plains).colors, ['W']);
  put(game, 'Prismatic Omen');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(Game.sourceOf(game, plains).colors, ['W', 'U', 'B', 'R', 'G']);
  put(game, 'Leyline of the Guildpact');
  Bot.refreshGrants(game, defOf);
  assert.deepEqual(st(bear).colors, ['W', 'U', 'B', 'R', 'G']);
});

test("Zurgo can't block power 2 or more; Stature can't be blocked at power 1 or less; Freya flies on your turn", () => {
  const game = vsOpp();
  const zurgo = put(game, 'Zurgo Bellstriker');
  const stature = put(game, 'Stature, Size Shifter');
  const freya = put(game, 'Freya Crescent');
  const bear = put(game.bot.s, 'Bear');
  game.offTurn = false;
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.canBlock(st(zurgo), st(bear)), false);
  assert.equal(Bot.canBlock(st(zurgo), Bot.stats(put(game.bot.s, 'Gran-Gran'), defOf('Gran-Gran'))), true);
  assert.equal(Bot.canBlock(st(bear), st(stature)), false);
  Game.counter(game, stature.iid, '+1/+1', 1);
  Bot.refreshGrants(game, defOf);
  assert.equal(Bot.canBlock(st(bear), st(stature)), true);
  assert.ok(st(freya).kw.has('flying'));
  game.offTurn = true;
  Bot.refreshGrants(game, defOf);
  assert.ok(!st(freya).kw.has('flying'));
});

test('Minas Tirith enters tapped unless you control a legendary creature; The Duke enters with a counter', () => {
  const game = vsOpp();
  const tirith = game.cards[find(game, 'Minas Tirith')];
  assert.equal(Game.tapsOnEntry(game, tirith), true);
  put(game, 'Isamaru, Hound of Konda');
  assert.equal(Game.tapsOnEntry(game, tirith), false);
  assert.deepEqual(Game.entersWithCounters(cards['The Duke, Rebel Sentry'].oracle), { '+1/+1': 1 });
});

test('Quicksilver power-up: a +1/+1 counter and double strike', () => {
  const game = vsOpp();
  const q = put(game, 'Quicksilver, Brash Blur');
  assert.deepEqual(run(game, q, 'Put a +1/+1 counter and a double strike counter on Quicksilver.'), []);
  assert.equal(st(q).pow, 2);
  assert.ok(st(q).kw.has('double strike'));
});

test('Kid Loki: hexproof for a creature you put a +1/+1 counter on this turn', () => {
  const game = vsOpp();
  put(game, 'Kid Loki');
  const bear = put(game, 'Bear');
  Bot.refreshGrants(game, defOf);
  assert.ok(!st(bear).kw.has('hexproof'));
  Game.counter(game, bear.iid, '+1/+1', 1);
  Bot.refreshGrants(game, defOf);
  assert.ok(st(bear).kw.has('hexproof'));
  Game.nextTurn(game);
  Bot.refreshGrants(game, defOf);
  assert.ok(!st(bear).kw.has('hexproof'));
});

test('Frodo levels up: a 2/3 lifelink Scout, then a Rogue that tempts the Ring', () => {
  const game = vsOpp();
  const frodo = put(game, "Frodo, Sauron's Bane");
  run(game, frodo, 'If Frodo is a Scout, it becomes a Halfling Rogue with "Whenever this creature deals combat damage to a player, that player loses the game if the Ring has tempted you four or more times this game. Otherwise, the Ring tempts you."');
  assert.ok(!frodo.retype); // still a Citizen
  run(game, frodo, 'If Frodo is a Citizen, it becomes a Halfling Scout with base power and toughness 2/3 and lifelink.');
  assert.equal(st(frodo).pow, 2);
  assert.equal(st(frodo).tou, 3);
  assert.ok(st(frodo).kw.has('lifelink'));
  assert.ok(Bot.cardFits(frodo, 'scout'));
  run(game, frodo, 'If Frodo is a Scout, it becomes a Halfling Rogue with "Whenever this creature deals combat damage to a player, that player loses the game if the Ring has tempted you four or more times this game. Otherwise, the Ring tempts you."');
  assert.ok(Bot.cardFits(frodo, 'rogue'));
  assert.ok(!Bot.cardFits(frodo, 'scout'));
  assert.ok(st(frodo).kw.has('lifelink'));
  game.ringTempts = 4;
  run(game, frodo, 'that player loses the game if the Ring has tempted you four or more times this game. Otherwise, the Ring tempts you.');
  assert.ok(game.oppLife <= 0);
  Game.move(game, frodo.iid, 'hand');
  assert.ok(!frodo.retype);
});

test('Kellan becomes a Detective (with its combat damage trigger), then a 3/2 double strike Rogue', () => {
  const game = vsOpp();
  const kellan = put(game, 'Kellan, Planar Trailblazer');
  run(game, kellan, 'If Kellan is a Scout, it becomes a Human Faerie Detective and gains "Whenever Kellan deals combat damage to a player, exile the top card of your library. You may play that card this turn."');
  assert.ok(Bot.cardFits(kellan, 'detective'));
  run(game, kellan, 'If Kellan is a Detective, it becomes a 3/2 Human Faerie Rogue and gains double strike.');
  assert.equal(st(kellan).pow, 3);
  assert.ok(st(kellan).kw.has('double strike'));
});

test('Reptil becomes a 3/5 Dinosaur with reach and vigilance until end of turn', () => {
  const game = vsOpp();
  const reptil = put(game, 'Reptil, Dinomorpher');
  run(game, reptil, 'Until end of turn, Reptil becomes a Dinosaur Hero with base power and toughness 3/5 and gains reach and vigilance.');
  assert.equal(st(reptil).tou, 5);
  assert.ok(st(reptil).kw.has('reach'));
  assert.ok(Bot.cardFits(reptil, 'dinosaur'));
});

test("Mabel takes up to three counters off the opponent's creature", () => {
  const game = vsOpp();
  const mabel = put(game, 'Mabel, Bitter Recluse');
  const giant = put(game.bot.s, 'Giant');
  Game.counter(game.bot.s, giant.iid, '+1/+1', 4);
  run(game, mabel, 'remove up to three counters from another target creature or planeswalker.');
  assert.equal(giant.counters['+1/+1'], 1);
});

test('Stiltzkin gives the opponent your least useful permanent and draws', () => {
  const game = vsOpp();
  const stiltzkin = put(game, 'Stiltzkin, Moogle Merchant');
  put(game, 'Giant');
  const plains = put(game, 'Plains');
  const hand = game.zones.hand.length;
  assert.deepEqual(run(game, stiltzkin, 'Target opponent gains control of another target permanent you control. If they do, you draw a card.'), []);
  assert.ok(game.bot.s.zones.battlefield.some(i => game.bot.s.cards[i].name === plains.name));
  assert.equal(game.zones.hand.length, hand + 1);
});

test('Yuriko: -X/-0 for the cards in your graveyard; Whiplash drains for each Equipment on him', () => {
  const game = vsOpp();
  const giant = put(game.bot.s, 'Giant');
  ['Bear', 'Knight', 'Bolt'].forEach(id => Game.move(game, find(game, id), 'graveyard'));
  run(game, { name: 'Yuriko' }, 'Target creature gets -X/-0 until end of turn, where X is the number of cards in your graveyard.', { target: () => Bot.applyTarget(game, game.bot.s, giant, { action: 'pump', what: 'creature', pow: -3, tou: 0, kw: [] }, 'Yuriko', defOf) });
  assert.equal(Bot.stats(giant, defOf('Giant')).pow, 1);
  const whip = put(game, 'Whiplash, Vengeful Engineer');
  const text = "if he's equipped, each opponent loses X life and you gain X life, where X is the number of Equipment attached to him.";
  run(game, whip, Bot.parts.fillWhereX(text, game, whip, ctx(game, { self: whip })));
  assert.equal(game.oppLife, 40);
  const sword = put(game, 'Sword');
  Game.attach(game, sword.iid, whip.iid);
  run(game, whip, Bot.parts.fillWhereX(text, game, whip, ctx(game, { self: whip })));
  assert.equal(game.oppLife, 39);
  assert.equal(game.life, 41);
});

test('Rick Jones mills four and keeps a Hero or enchantment', () => {
  const game = vsOpp();
  const rick = put(game, 'Rick Jones, Destined Sidekick');
  const omen = find(game, 'Prismatic Omen');
  game.zones.library.splice(game.zones.library.indexOf(omen), 1);
  game.zones.library.unshift(omen);
  const four = game.zones.library.slice(0, 4);
  run(game, rick, 'Mill four cards. You may put a Hero or enchantment card from among those cards into your hand.');
  assert.equal(four.filter(i => game.cards[i].zone === 'hand').length, 1); // the Omen, or a costlier Hero
  assert.equal(four.filter(i => game.cards[i].zone === 'graveyard').length, 3);
});

test("Gran-Gran's discount needs three Lessons; Momo's is the first flier on your turn", () => {
  const game = vsOpp();
  put(game, 'Gran-Gran');
  const oracleOf = c => (defOf(c.id) || {}).oracle;
  const bolt = game.cards[find(game, 'Bolt')];
  assert.equal(Game.discount(game, bolt, oracleOf), 0);
  ['Lesson', 'Giant', 'Knight'].forEach(id => { const iid = find(game, id); Game.move(game, iid, 'graveyard'); game.cards[iid].typeLine = 'Sorcery — Lesson'; });
  assert.equal(Game.discount(game, bolt, oracleOf), 1);
  put(game, 'Momo, Friendly Flier');
  game.offTurn = false;
  const bird = game.cards[find(game, 'Bird')];
  assert.equal(Game.discount(game, bird, oracleOf), 1);
  assert.equal(Game.discount(game, game.cards[find(game, 'Bear')], oracleOf), 0); // no flying
  Bot.spellCast(game, game, put(game, 'Isamaru, Hound of Konda'), defOf, ctx(game));
  assert.equal(Game.discount(game, bird, oracleOf), 1); // Isamaru doesn't fly
  const other = Object.assign({}, bird, { iid: 'x' });
  Game.move(game, bird.iid, 'battlefield', { put: true });
  Bot.spellCast(game, game, bird, defOf, ctx(game));
  assert.equal(Game.discount(game, other, oracleOf), 0); // only the first flier
  game.offTurn = true;
  game.turn++;
  assert.equal(Game.discount(game, other, oracleOf), 0); // not on the opponent's turn
});

test("Master's Guidance and Spinneret count the attackers of their kind", () => {
  const game = vsOpp();
  put(game, "Master's Guidance");
  const isamaru = put(game, 'Isamaru, Hound of Konda');
  const zurgo = put(game, 'Zurgo Bellstriker');
  isamaru.attacking = zurgo.attacking = true;
  Bot.attackWatch(game, game, defOf, ctx(game), [isamaru, zurgo]);
  assert.equal(isamaru.counters['+1/+1'], 1); // one on each: two different targets
  assert.equal(zurgo.counters['+1/+1'], 1);
});

test('Spinneret and Spiderling: 4 or more damage exiles the top card to play; Cecil loses life and turns at half', () => {
  const game = vsOpp();
  const spin = put(game, 'Spinneret and Spiderling');
  const top = game.zones.library[0];
  Bot.combatDealt(game, game, spin, 3, defOf, ctx(game));
  assert.equal(game.cards[top].zone, 'library');
  Bot.combatDealt(game, game, spin, 4, defOf, ctx(game));
  assert.equal(game.cards[top].zone, 'exile');
  assert.ok(game.cards[top].playable);
  const cecil = put(game, 'Cecil, Dark Knight // Cecil, Redeemed Paladin');
  cecil.tapped = true;
  Bot.combatDealt(game, game, cecil, 3, defOf, ctx(game));
  assert.equal(game.life, 37);
  assert.ok(!cecil.flipped);
  game.life = 12; // this test game has no commander: it started at 20
  Bot.combatDealt(game, game, cecil, 3, defOf, ctx(game));
  assert.equal(game.life, 9);
  assert.ok(cecil.flipped);
  assert.equal(cecil.tapped, false);
  assert.equal(st(cecil).pow, 4);
});

test('The Incredible Hulk: dealt damage while attacking, he untaps for another combat', () => {
  const game = vsOpp();
  const hulk = put(game, 'Bruce Banner // The Incredible Hulk');
  run(game, hulk, 'Transform Bruce Banner.');
  assert.equal(st(hulk).pow, 8);
  hulk.attacking = true;
  hulk.tapped = true;
  hulk.attackedTurn = game.turn;
  run(game, hulk, "put a +1/+1 counter on him. If he's attacking, untap him and there is an additional combat phase after this phase.");
  assert.equal(hulk.tapped, false);
  assert.equal(hulk.attackedTurn, undefined);
  assert.equal(hulk.counters['+1/+1'], 1);
});

test('Norin the Wary hides when a spell is cast and comes back at the end step', () => {
  const game = vsOpp();
  const norin = put(game, 'Norin the Wary');
  Bot.spellCast(game, game.bot.s, put(game.bot.s, 'Bear'), defOf, null);
  assert.equal(norin.zone, 'exile');
  Bot.flickerReturn(game);
  assert.equal(norin.zone, 'battlefield');
});

test("Norin, Swift Survivalist saves a blocked creature that would die", () => {
  const game = vsOpp();
  put(game, 'Norin, Swift Survivalist');
  const bear = put(game, 'Bear');
  const giant = put(game.bot.s, 'Giant');
  Bot.becameBlocked(game, bear, 1, defOf, [giant], game);
  assert.equal(bear.zone, 'exile');
  assert.ok(bear.playable);
});

test("Hope of Ghirapur stops the player it hit from casting noncreature spells until your next turn", () => {
  const game = vsOpp();
  const hope = put(game, 'Hope of Ghirapur');
  const text = "Until your next turn, target player who was dealt combat damage by Hope of Ghirapur this turn can't cast noncreature spells.";
  run(game, hope, text);
  assert.ok(!game.lockNoncreature);
  Bot.combatDamage(game, [{ inst: hope, st: st(hope), card: defOf(hope.id), dmg: 1 }], defOf, ctx(game));
  run(game, hope, text);
  assert.ok(game.lockNoncreature);
  Game.nextTurn(game);
  assert.ok(!game.lockNoncreature);
});

test('Tamiyo transforms on your third card in a turn, with 2 loyalty; her abilities work', () => {
  const game = vsOpp();
  const tamiyo = put(game, 'Tamiyo, Inquisitive Student // Tamiyo, Seasoned Scholar');
  game.drawTurn = game.turn;
  game.drawCount = 0;
  for (let i = 0; i < 2; i++) { Game.drawCards(game, 1); Bot.opponentActed(game, game, 'draw', 1, defOf, ctx(game)); }
  assert.ok(!tamiyo.flipped);
  Game.drawCards(game, 1);
  Bot.opponentActed(game, game, 'draw', 1, defOf, ctx(game));
  assert.ok(tamiyo.flipped);
  assert.equal(tamiyo.counters.loyalty, 2);
  assert.equal(Game.isCreature(tamiyo), false);
  const lib = game.zones.library.length;
  const hand = game.zones.hand.length;
  run(game, tamiyo, 'Draw cards equal to half the number of cards in your library, rounded up.');
  assert.equal(game.zones.hand.length, hand + Math.ceil(lib / 2));
  run(game, tamiyo, 'Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -1/-0 until end of turn.');
  const giant = put(game.bot.s, 'Giant');
  Bot.declareAttack(game.bot.s, [giant], defOf, { game });
  assert.equal(Bot.stats(giant, defOf('Giant')).pow, 3);
});

test('Grist transforms when a creature comes back from your graveyard; the Plague Swarm makes Insects', () => {
  const game = vsOpp();
  const grist = put(game, 'Grist, Voracious Larva // Grist, the Plague Swarm');
  put(game, 'Plains');
  const forest = Game.createToken(game, { custom: true, name: 'Forest', typeLine: 'Basic Land — Forest', pt: '', text: '' });
  forest.produces = ['G'];
  const bear = game.cards[find(game, 'Bear')];
  Game.move(game, bear.iid, 'graveyard');
  Game.move(game, bear.iid, 'battlefield', { put: true });
  Bot.creatureEntered(game, bear, defOf, ctx(game));
  assert.ok(grist.flipped);
  assert.equal(grist.counters.loyalty, 3);
  Game.move(game, find(game, 'Knight'), 'graveyard');
  run(game, grist, "For each creature card in your graveyard, create a token that's a copy of it, except it's a 1/1 black and green Insect.");
  const insect = game.zones.battlefield.map(i => game.cards[i]).find(c => c.token && c.name === 'Black Knight');
  assert.ok(insect);
  assert.equal(Bot.stats(insect, defOf(insect.id)).pow, 1);
  assert.ok(Bot.cardFits(insect, 'insect'));
});

test('Lady Octopus gets ingenuity counters for your first two cards each turn', () => {
  const game = vsOpp();
  const doc = put(game, 'Lady Octopus, Inspired Inventor');
  game.drawTurn = game.turn;
  game.drawCount = 0;
  Game.drawCards(game, 3);
  Bot.opponentActed(game, game, 'draw', 3, defOf, ctx(game));
  assert.equal(doc.counters.ingenuity, 2);
});

test('Zabaz adds one to modular; Zack Fair passes on his counters; Skrelv shields your best creature', () => {
  const game = vsOpp();
  put(game, 'Zabaz, the Glimmerwasp');
  const robot = put(game, 'Bear');
  robot.typeLine = 'Artifact Creature — Bear';
  const mouser = Game.createToken(game, { custom: true, name: 'Mouser', typeLine: 'Artifact Creature — Cat', pt: '0/0', text: 'Modular 2' });
  Game.counter(game, mouser.iid, '+1/+1', 2);
  Game.move(game, mouser.iid, 'graveyard');
  Bot.afterDeath(game, game, mouser, { counters: { '+1/+1': 2 } }, defOf, ctx(game));
  assert.equal(robot.counters['+1/+1'], 3);
  const zack = put(game, 'Zack Fair');
  Game.counter(game, zack.iid, '+1/+1', 1);
  const giant = put(game, 'Giant');
  game.lastTarget = { s: game, iid: giant.iid };
  run(game, zack, "Put Zack Fair's counters on that creature and attach an Equipment that was attached to Zack Fair to that creature.");
  assert.equal(giant.counters['+1/+1'], 1);
  const skrelv = put(game, 'Skrelv, Defector Mite');
  put(game.bot.s, 'Knight');
  run(game, skrelv, 'Choose a color. Another target creature you control gains toxic 1 and hexproof from that color until end of turn. It can\'t be blocked by creatures of that color this turn.');
  assert.ok(st(giant).kw.has('toxic'));
  assert.equal(Bot.canBlock(Bot.stats(game.bot.s.cards[find(game.bot.s, 'Knight', ['battlefield'])], defOf('Knight')), st(giant)), false);
});

test("Tinybones takes the best nonland permanent from the opponent's graveyard to cast", () => {
  const game = vsOpp();
  const tiny = put(game, 'Tinybones, the Pickpocket');
  Game.move(game.bot.s, find(game.bot.s, 'Giant'), 'graveyard');
  Game.move(game.bot.s, find(game.bot.s, 'Bolt'), 'graveyard');
  run(game, tiny, "you may cast target nonland permanent card from that player's graveyard, and mana of any type can be spent to cast that spell.");
  const giant = game.zones.exile.map(i => game.cards[i]).find(c => c.id === 'Giant');
  assert.ok(giant && giant.playable && giant.playable.anyMana);
});
