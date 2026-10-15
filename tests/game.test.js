const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../simulator/js/game.js');

const defs = {
  forest: { id: 'forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'] },
  island: { id: 'island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'] },
  bear: { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear' },
  prairie: { id: 'prairie', name: 'Sungrass Prairie', typeLine: 'Land', producedMana: ['G', 'W'], oracle: '{1}, {T}: Add {G}{W}.' },
};
const deck = rows => ({ key: 'test', name: 'Test', rows });

test('a new game deals 7 on the play and 8 on the draw', () => {
  const rows = [{ id: 'forest', name: 'Forest', qty: 30 }, { id: 'bear', name: 'Grizzly Bears', qty: 30 }];
  const play = Game.create(deck(rows), defs);
  assert.equal(play.zones.hand.length, 7);
  assert.equal(play.zones.library.length, 53);
  assert.equal(play.life, 20);
  assert.equal(Game.create(deck(rows), defs, { onDraw: true }).zones.hand.length, 8);
});

test('commanders start in the command zone with 40 life', () => {
  const s = Game.create(deck([{ id: 'bear', name: 'Grizzly Bears', qty: 1, commander: true }, { id: 'forest', name: 'Forest', qty: 99 }]), defs);
  assert.equal(s.life, 40);
  assert.equal(s.zones.command.length, 1);
});

test('mulligan draws a fresh 7 and keeps the deck size', () => {
  const s = Game.create(deck([{ id: 'forest', name: 'Forest', qty: 60 }]), defs);
  Game.mulligan(s);
  assert.equal(s.zones.hand.length, 7);
  assert.equal(s.zones.hand.length + s.zones.library.length, 60);
  assert.equal(s.mulligans, 1);
});

test('parseCost splits generic, colored and hybrid symbols', () => {
  assert.deepEqual(Game.parseCost('{2}{G}{G}'), { generic: 2, pips: [{ colors: ['G'] }, { colors: ['G'] }] });
  assert.deepEqual(Game.parseCost('{G/U}').pips[0].colors, ['G', 'U']);
  assert.equal(Game.parseCost('{G/P}').pips[0].phyrexian, true);
});

test("autoPay taps the right lands, or nothing if it can't pay", () => {
  const s = Game.create(deck([{ id: 'forest', name: 'Forest', qty: 1 }, { id: 'island', name: 'Island', qty: 1 }]), defs);
  s.zones.hand.slice().forEach(iid => Game.move(s, iid, 'battlefield'));
  assert.equal(Game.autoPay(s, '{G}{G}'), null);
  assert.ok(s.zones.battlefield.every(iid => !s.cards[iid].tapped));
  const paid = Game.autoPay(s, '{1}{U}');
  assert.equal(paid.sources.length, 2);
  assert.ok(s.zones.battlefield.every(iid => s.cards[iid].tapped));
});

test('reads "spells you cast cost {N} less" and skips opponents and conditions', () => {
  assert.deepEqual(Game.costReductions("As Urza's Incubator enters, choose a creature type.\nCreature spells of the chosen type cost {2} less to cast."),
    [{ n: 2, types: ['creature'], chosen: true }]);
  assert.deepEqual(Game.costReductions('Instant and sorcery spells you cast cost {1} less to cast.'), [{ n: 1, types: ['instant', 'sorcery'], chosen: false }]);
  assert.deepEqual(Game.costReductions('Spells your opponents cast cost {1} less to cast.'), []);
  assert.deepEqual(Game.costReductions('Creature spells you cast with power 4 or greater cost {2} less to cast.'), []);
  assert.ok(Game.choosesType("As Herald's Horn enters, choose a creature type."));
});

test('discounts only spells of the chosen type, and never below the colored part', () => {
  const s = Game.create(deck([{ id: 'forest', name: 'Forest', qty: 40 }]), defs);
  s.zones.battlefield = [];
  for (const iid of Object.keys(s.cards)) s.cards[iid].zone = 'library';
  const horn = Game.createToken(s, { name: "Herald's Horn", typeLine: 'Artifact' }).iid;
  s.cards[horn].chosenType = 'Elf';
  const oracle = inst => (inst.iid === horn ? 'Creature spells you cast of the chosen type cost {1} less to cast.' : '');
  assert.equal(Game.discount(s, { typeLine: 'Creature — Elf Druid' }, oracle), 1);
  assert.equal(Game.discount(s, { typeLine: 'Creature — Bear' }, oracle), 0);
  const forest = s.zones.library[0];
  Game.move(s, forest, 'battlefield');
  assert.equal(Game.autoPay(s, '{1}{G}', -1).sources.length, 1);
  assert.equal(Game.autoPay(s, '{G}', -3), null); // the only Forest is tapped; the {G} is still owed
});

test('planeswalkers enter with their printed loyalty, and start over if they come back', () => {
  const jace = { id: 'jace', name: 'Jace Beleren', typeLine: 'Legendary Planeswalker — Jace', manaCost: '{1}{U}{U}', cmc: 3, loyalty: '3' };
  const xwalker = { id: 'xw', name: 'Nissa, Steward of Elements', typeLine: 'Legendary Planeswalker — Nissa', manaCost: '{X}{G}{U}', cmc: 2, loyalty: 'X' };
  const s = Game.create({ key: 'k', name: 'k', rows: [{ id: 'jace', qty: 1 }, { id: 'xw', qty: 1 }] }, { jace, xw: xwalker });
  const j = Object.values(s.cards).find(c => c.id === 'jace');
  const x = Object.values(s.cards).find(c => c.id === 'xw');
  Game.move(s, j.iid, 'battlefield');
  Game.move(s, x.iid, 'battlefield');
  assert.equal(j.counters.loyalty, 3);
  assert.equal(x.counters.loyalty, undefined); // X: set it yourself
  j.counters.loyalty = 1;
  Game.move(s, j.iid, 'hand');
  Game.move(s, j.iid, 'battlefield');
  assert.equal(j.counters.loyalty, 3);
});

test('reads counters a permanent enters with', () => {
  const mouser = 'Lifelink\nModular 1 (This creature enters with a +1/+1 counter on it. When it dies, you may put its +1/+1 counters on target artifact creature.)';
  assert.deepEqual(Game.entersWithCounters(mouser), { '+1/+1': 1 });
  assert.deepEqual(Game.entersWithCounters('This creature enters with two +1/+1 counters on it.'), { '+1/+1': 2 });
  assert.deepEqual(Game.entersWithCounters('Golem enters with three charge counters on it.\n{T}: Add {C}.'), { charge: 3 });
  assert.deepEqual(Game.entersWithCounters('This creature enters with X +1/+1 counters on it.'), {});
  assert.deepEqual(Game.entersWithCounters('It enters with a +1/+1 counter on it if you control a Goblin.'), {});
});

test('doublesOf reads Doubling Season and friends', () => {
  assert.deepEqual(Game.doublesOf('If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.'), { tokens: true, counters: 'all' });
  assert.deepEqual(Game.doublesOf('If an effect would create one or more creature tokens under your control, it creates twice that many of those tokens instead.'), { tokens: true });
  assert.deepEqual(Game.doublesOf('If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.'), { counters: '+1/+1' });
  assert.equal(Game.doublesOf('Flying'), null);
});

test('Doubling Season doubles tokens, effect counters and starting loyalty, not hand fixes', () => {
  const season = { id: 'ds', name: 'Doubling Season', typeLine: 'Enchantment', oracle: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.' };
  const bear = { id: 'bear', name: 'Grizzly Bears', typeLine: 'Creature — Bear', power: '2', toughness: '2' };
  const jace = { id: 'jace', name: 'Jace Beleren', typeLine: 'Legendary Planeswalker — Jace', loyalty: '3' };
  const s = Game.create({ key: 'k', name: 'k', rows: [{ id: 'ds', qty: 1 }, { id: 'bear', qty: 1 }, { id: 'jace', qty: 1 }] }, { ds: season, bear, jace });
  const find = id => Object.values(s.cards).find(c => c.id === id);
  Game.move(s, find('ds').iid, 'battlefield');
  Game.move(s, find('bear').iid, 'battlefield');
  Game.move(s, find('jace').iid, 'battlefield');
  assert.equal(find('jace').counters.loyalty, 6);
  assert.equal(Game.counter(s, find('bear').iid, '+1/+1', 1, { effect: true }), 2);
  Game.counter(s, find('bear').iid, '+1/+1', 1); // the badge's +: exactly one
  assert.equal(find('bear').counters['+1/+1'], 3);
  assert.deepEqual(Game.tokenCount(s, 2), { n: 4, by: ['Doubling Season'] });
  Game.copyAsToken(s, find('bear').iid);
  assert.equal(Object.values(s.cards).filter(c => c.token).length, 2);
});

test('Sungrass Prairie costs {1} to tap and adds {G}{W}', () => {
  assert.deepEqual(Game.manaAbility('Sungrass Prairie', '{1}, {T}: Add {G}{W}.'), { colors: ['W', 'G'], amount: 2, sacrifice: false, filter: 1, makes: ['G', 'W'] });
  const setup = rows => {
    const s = Game.create(deck(rows), defs);
    s.zones.hand.slice().forEach(iid => Game.move(s, iid, 'battlefield'));
    return s;
  };
  const card = (s, id) => s.zones.battlefield.map(i => s.cards[i]).find(c => c.id === id);

  let s = setup([{ id: 'prairie', name: 'Sungrass Prairie', qty: 1 }]);
  assert.equal(Game.available(s).total, 0); // nothing to pay its {1}
  assert.equal(Game.autoPay(s, '{W}'), null);

  s = setup([{ id: 'prairie', name: 'Sungrass Prairie', qty: 1 }, { id: 'island', name: 'Island', qty: 1 }]);
  assert.equal(Game.available(s).total, 2);
  assert.equal(Game.autoPay(s, '{G}{W}').sources.length, 2); // Island pays the {1}
  assert.ok(s.zones.battlefield.every(iid => s.cards[iid].tapped));

  s = setup([{ id: 'prairie', name: 'Sungrass Prairie', qty: 1 }, { id: 'island', name: 'Island', qty: 1 }]);
  assert.deepEqual(Game.autoPay(s, '{U}').sources, ['Island']); // not needed, so left alone
  assert.equal(card(s, 'prairie').tapped, false);

  s = setup([{ id: 'prairie', name: 'Sungrass Prairie', qty: 1 }, { id: 'forest', name: 'Forest', qty: 1 }]);
  assert.equal(Game.autoPay(s, '{W}').sources.length, 2);
  assert.equal(s.mana.G, 1); // the {G} it made floats

  // By hand: the Forest pays, both mana go in the pool; untapping takes it all back.
  s = setup([{ id: 'prairie', name: 'Sungrass Prairie', qty: 1 }, { id: 'forest', name: 'Forest', qty: 1 }]);
  const prairie = card(s, 'prairie');
  Game.setTapped(s, prairie.iid);
  assert.equal(prairie.tapped, true);
  assert.equal(card(s, 'forest').tapped, true);
  assert.deepEqual([s.mana.G, s.mana.W], [1, 1]);
  Game.setTapped(s, prairie.iid, false);
  assert.equal(card(s, 'forest').tapped, false);
  assert.deepEqual([s.mana.G, s.mana.W], [0, 0]);
  Game.setTapped(s, card(s, 'forest').iid, true); // {G} in the pool pays for it instead
  Game.setTapped(s, prairie.iid);
  assert.deepEqual([s.mana.G, s.mana.W], [1, 1]);
});