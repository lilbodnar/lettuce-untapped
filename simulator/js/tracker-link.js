/*
 * Reads decks from MTG Tracker. Read-only: nothing here ever writes to the Tracker.
 *
 * Chrome and Edge let pages opened from files on your PC share browser storage, so if
 * MTG Tracker has been used in the same browser, its saved data can be read directly.
 * Otherwise a Tracker backup file ("Account & backup → Download backup") works too.
 */
const TrackerLink = (() => {
  'use strict';
  const DB_NAME = 'mtg-tracker';
  const STORE = 'kv';

  // Opens the Tracker's database without creating it. If it doesn't exist yet, the
  // upgrade is cancelled so the Tracker can still set it up properly later.
  function openExisting() {
    return new Promise(resolve => {
      // Never wait forever (a phone can leave the request hanging while MTG Tracker is closing).
      let late = false;
      setTimeout(() => { late = true; resolve(null); }, 4000);
      let req;
      try {
        req = indexedDB.open(DB_NAME);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => req.transaction.abort();
      req.onsuccess = () => {
        const db = req.result;
        if (late || !db.objectStoreNames.contains(STORE)) {
          db.close();
          resolve(null);
        } else resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  function read(db, key) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Returns { profiles, cards, activeProfileId, source } or null if no Tracker data is found.
  async function fromBrowser() {
    const db = await openExisting();
    if (!db) return null;
    try {
      const state = await read(db, 'state');
      const cards = (await read(db, 'cards')) || {};
      if (!state || !Array.isArray(state.profiles)) return null;
      return { profiles: state.profiles, cards, activeProfileId: state.activeProfileId, source: 'browser' };
    } finally {
      db.close();
    }
  }

  function fromBackup(text) {
    const data = Backup.parse(text);
    return { profiles: data.profiles, cards: data.cards || {}, activeProfileId: data.profiles[0] && data.profiles[0].id, source: 'file' };
  }

  // Turns a Tracker deck into the Simulator's deck shape. Maybeboard/sideboard cards are left out.
  function toDeck(deck, profile) {
    const rows = deck.cards
      .filter(r => r.inDeck !== false)
      .map(r => ({
        id: r.scryfallId,
        name: r.name,
        qty: r.qty || 1,
        categories: (r.categories || []).filter(c => !/maybe|side/i.test(c)),
        commander: (r.categories || []).some(c => c.toLowerCase() === 'commander'),
      }));
    return {
      key: `tracker:${profile.id}:${deck.id}`,
      source: 'tracker',
      name: deck.name,
      profileName: profile.name,
      rows,
    };
  }

  return { fromBrowser, fromBackup, toDeck };
})();
