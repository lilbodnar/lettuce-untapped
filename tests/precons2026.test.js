// The 2026 Commander and Secret Lair precons (Strixhaven's five, Goblin Storm, Blight Curse, Dance of the Elements, Hatsune Miku, Turtle
// Power, Odds and Ends): every card done for you, and the newer rules they use played out against Opp.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const { decks, cards } = require('./precons2026-cards.json');
const basics = {
  Plains: { id: 'Plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  Island: { id: 'Island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  Swamp: { id: 'Swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  Forest: { id: 'Forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
  Bear: { id: 'Bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', manaCost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle: '', colors: ['G'] },
  Giant: { id: 'Giant', name: 'Hill Giant', typeLine: 'Creature — Giant', manaCost: '{3}{R}', cmc: 4, power: '4', toughness: '3', oracle: '', colors: ['R'] },
};
const defs = { ...cards, ...basics };
const defOf = id => defs[id];
const deck = (name, ids) => ({ key: name, name, rows: ids.map(id => ({ id, qty: basics[id] ? 10 : 1 })) });
const pool = ['Voracious Hydra', 'Mana Bloom', 'Troyan, Gutsy Explorer', 'Donatello, the Brains', 'Ray Fillet, Wave Warrior', 'Endless Foot Assault',
  'Animate Dead', 'City of Brass', 'Approach of the Second Sun', 'Wave Goodbye', 'Kor Spiritdancer', ...Object.keys(basics)];
const vsOpp = () => {
  const game = Game.create(deck('You', pool), defs);
  game.bot = Bot.create(deck('Opp', pool), defs, { onDraw: true });
  game.life = 40;
  game.oppLife = 40;
  return game;
};
const find = (s, id, zones = ['library', 'hand', 'graveyard']) => zones.flatMap(z => s.zones[z]).find(i => s.cards[i].id === id);
const put = (s, id) => { const iid = find(s, id); Game.move(s, iid, 'battlefield', { put: true }); s.cards[iid].enteredTurn = -1; return s.cards[iid]; };
const ctx = (game, extra = {}) => ({
  hitOpps: n => { game.oppLife -= n; }, other: game.bot.s, defOf, target: (eff, part, src) => Bot.autoTarget(game, game, src, eff, defOf), ...extra,
});
const ids = s => s.zones.battlefield.map(i => s.cards[i]);
test.afterEach(() => { Object.keys(Game.hooks).forEach(k => { Game.hooks[k] = null; }); });

// Not modeled: Replicate (cast once), sectors (Space Beleren), target changes (Psychic Battle), swapped text boxes (Exchange of Words) and
// draws from another library (Shared Fate).
const NOT_DONE = ['Changing Loyalty', 'Space Beleren', 'Psychic Battle', 'Exchange of Words', 'Shared Fate'];

test('every card in the 2026 precons is done for you', () => {
  for (const [name, list] of Object.entries(decks)) {
    for (const id of list.filter(n => !NOT_DONE.includes(n))) {
      const r = Coverage.check(cards[id]);
      assert.equal(r.you, 'all', `${name}, ${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
    }
  }
});

test('Opp casts a spell with {X} for the biggest X it can pay (Voracious Hydra)', () => {
  const game = vsOpp();
  const s = game.bot.s;
  for (let i = 0; i < 6; i++) put(s, 'Forest');
  const hydra = s.cards[find(s, 'Voracious Hydra')];
  Game.move(s, hydra.iid, 'hand');
  const pick = Bot.castOptions(game, defOf).find(o => o.inst === hydra);
  assert.equal(pick && pick.x, 4);
});

test('Mana Bloom pays with a charge counter, once a turn', () => {
  const game = vsOpp();
  const bloom = put(game, 'Mana Bloom');
  Game.counter(game, bloom.iid, 'charge', 2);
  assert.ok(Game.autoPay(game, '{G}'));
  assert.equal(bloom.counters.charge, 1);
  assert.equal(bloom.tapped, true);
  assert.equal(Game.autoPay(game, '{G}'), null); // tapped until your next turn
});

test("Troyan's mana is only for spells with mana value 5 or more, or with {X}", () => {
  const game = vsOpp();
  put(game, 'Troyan, Gutsy Explorer');
  assert.equal(Game.autoPay(JSON.parse(JSON.stringify(game)), '{G}{U}', 0, { typeLine: 'Creature', cost: '{G}{U}', cmc: 2 }), null);
  assert.ok(Game.autoPay(JSON.parse(JSON.stringify(game)), '{G}{U}', 0, { typeLine: 'Sorcery', cost: '{X}{G}{U}', cmc: 2 }));
});

test('City of Brass deals 1 damage to you as it taps', () => {
  const game = vsOpp();
  put(game, 'City of Brass');
  const life = game.life;
  assert.ok(Game.autoPay(game, '{R}'));
  assert.equal(game.life, life - 1);
});

test('Donatello: tokens come with a Mutagen token too', () => {
  const game = vsOpp();
  put(game, 'Donatello, the Brains');
  Bot.refreshGrants(game, defOf);
  Bot.runEffect(game, 'create a Food token', ctx(game, { self: { name: 'Test' } }));
  assert.equal(ids(game).filter(c => c.name === 'Mutagen').length, 1);
  assert.equal(ids(game).filter(c => c.name === 'Food').length, 1);
});

test('Evolve: Ray Fillet gets a counter when a bigger creature enters', () => {
  const game = vsOpp();
  const ray = put(game, 'Ray Fillet, Wave Warrior');
  const bear = put(game, 'Bear');
  Bot.creatureEntered(game, bear, defOf, ctx(game));
  assert.equal(ray.counters['+1/+1'], 1);
});

test('Squad: that many token copies as it enters', () => {
  const game = vsOpp();
  const efa = put(game, 'Endless Foot Assault');
  Bot.squadCopies(game, efa, 2);
  assert.equal(ids(game).filter(c => c.name === 'Endless Foot Assault').length, 3);
  assert.ok(Bot.costChoices(game, { ...efa, zone: 'hand' }, defOf).some(c => c.key === 'squad' && c.kicks === 2));
});

test("Animate Dead returns the best creature card from any graveyard, and it's sacrificed once the aura is gone", () => {
  const game = vsOpp();
  const giant = game.bot.s.cards[find(game.bot.s, 'Giant')];
  Game.move(game.bot.s, giant.iid, 'graveyard');
  const aura = put(game, 'Animate Dead');
  Bot.runEffect(game, 'animate the best creature card in a graveyard', ctx(game, { self: aura }));
  const mine = ids(game).find(c => c.name === 'Hill Giant');
  assert.ok(mine && aura.attachedTo === mine.iid);
  assert.equal(Bot.stats(mine, defOf(mine.id)).pow, 3); // -1/-0
  Game.move(game, aura.iid, 'graveyard');
  Bot.refreshGrants(game, defOf);
  assert.ok(!ids(game).some(c => c.name === 'Hill Giant'));
});

test('Wave Goodbye returns each creature without a +1/+1 counter', () => {
  const game = vsOpp();
  const bear = put(game, 'Bear');
  const giant = put(game, 'Giant');
  Game.counter(game, giant.iid, '+1/+1', 1);
  const theirs = put(game.bot.s, 'Bear');
  Bot.runEffect(game, "return each creature without a +1/+1 counter on it to its owner's hand", ctx(game, { self: { name: 'Wave Goodbye' } }));
  assert.equal(bear.zone, 'hand');
  assert.equal(giant.zone, 'battlefield');
  assert.equal(theirs.zone, 'hand');
});

test('Kor Spiritdancer gets +2/+2 for each Aura on it', () => {
  const game = vsOpp();
  const kor = put(game, 'Kor Spiritdancer');
  const aura = put(game, 'Animate Dead');
  Game.attach(game, aura.iid, kor.iid, Bot.attachBonus(defOf(aura.id).oracle));
  Bot.refreshGrants(game, defOf);
  const st = Bot.stats(kor, defOf(kor.id));
  assert.equal(st.pow, 0 + 2 - 1); // +2/+2, and Animate Dead's -1/-0
  assert.equal(st.tou, 4);
});

test('Approach of the Second Sun: seventh from the top and 7 life, then the second one wins', () => {
  const game = vsOpp();
  const app = game.cards[find(game, 'Approach of the Second Sun')];
  Game.move(game, app.iid, 'hand');
  app.castFrom = 'hand';
  const text = 'win with the second approach, else seventh from the top with 7 life';
  Bot.runEffect(game, text, ctx(game, { self: app }));
  assert.equal(game.zones.library.indexOf(app.iid), 6);
  assert.equal(game.life, 47);
  Bot.runEffect(game, text, ctx(game, { self: app }));
  assert.ok(game.oppLife <= 0);
});
