const test = require('node:test');
const assert = require('node:assert/strict');
const Backup = require('../js/backup.js');

const backup = profiles => JSON.stringify({ app: 'mtg-tracker', version: 1, profiles, cards: {}, history: {} });
const card = { scryfallId: 'e856be87-6f2b-4846-87f1-53e2c1c71a16', name: 'Mirri', finish: 'nonfoil', qty: 2, proxyQty: 1, addedAt: 1 };

test('keeps a normal backup as it is', () => {
  const p = { id: 'abc123', name: 'Me', collection: [card], decks: [], wishlist: [] };
  const out = Backup.parse(backup([p]));
  assert.deepEqual(out.profiles[0].collection, [card]);
  assert.equal(out.profiles[0].id, 'abc123');
});

test('rejects files that are not backups', () => {
  assert.throws(() => Backup.parse('not json'), /isn't an MTG Tracker backup/);
  assert.throws(() => Backup.parse('{"app":"other","profiles":[]}'), /isn't an MTG Tracker backup/);
  assert.throws(() => Backup.parse(backup([])), /isn't an MTG Tracker backup/);
});

test('strips anything that could inject HTML or script', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const out = Backup.parse(JSON.stringify({
    app: 'mtg-tracker',
    profiles: [{
      id: evil, name: 'x',
      collection: [{ scryfallId: evil, qty: 1 }, { ...card, qty: evil, finish: evil }],
      decks: [{ id: evil, name: 'd', cards: [{ ...card, inDeck: 'yes' }] }],
    }],
    cards: { [evil]: {}, [card.scryfallId]: { image: 'javascript:alert(1)', uri: 'https://scryfall.com/x', prices: { usd: evil } } },
    history: { [card.scryfallId]: [{ d: evil, usd: 1 }, { d: '2026-10-09', usd: '2.5' }] },
  }));
  const p = out.profiles[0];
  assert.match(p.id, /^[\w-]+$/);
  assert.match(p.decks[0].id, /^[\w-]+$/);
  assert.equal(p.collection.length, 1);
  assert.equal(p.collection[0].qty, 0);
  assert.equal(p.collection[0].finish, 'nonfoil');
  assert.equal(p.decks[0].cards[0].inDeck, true);
  assert.deepEqual(p.wishlist, []);
  assert.deepEqual(Object.keys(out.cards), [card.scryfallId]);
  assert.equal(out.cards[card.scryfallId].image, null);
  assert.equal(out.cards[card.scryfallId].uri, 'https://scryfall.com/x');
  assert.equal(out.cards[card.scryfallId].prices.usd, null);
  assert.deepEqual(out.history[card.scryfallId], [{ d: '2026-10-09', usd: 2.5, usd_foil: null, usd_etched: null }]);
});

test("keeps a deck's share link and privacy, drops a bad one", () => {
  const deck = (share) => ({ id: 'd1', name: 'Elves', cards: [], share });
  const out = Backup.parse(backup([{ id: 'p', name: 'Me', collection: [], decks: [
    deck({ id: 'ab'.repeat(12), public: true }),
    deck({ id: 'ab'.repeat(12), public: 'yes' }),
    deck({ id: '../evil', public: true }),
  ] }]));
  const [a, b, c] = out.profiles[0].decks;
  assert.deepEqual(a.share, { id: 'ab'.repeat(12), public: true });
  assert.deepEqual(b.share, { id: 'ab'.repeat(12), public: false });
  assert.equal(c.share, undefined);
});
