/*
 * Saves data in the browser's IndexedDB (a small database built into the browser).
 * Data stays on this computer, in this browser. Use "Download backup" to keep a copy.
 * MTG Tracker and the Simulator each open their own database, so the Simulator
 * can never change your Tracker collection.
 */
const KVStore = dbName => {
  'use strict';
  const STORE = 'kv';
  let dbPromise;

  // Phones sometimes leave the open request hanging forever, mostly right after switching
  // between MTG Tracker and the Simulator. Asking for the list of databases first wakes the
  // browser's storage up, and a request that still hangs is given up and tried again.
  function wake() {
    if (!indexedDB.databases) return Promise.resolve();
    return Promise.race([indexedDB.databases().catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
  }

  function openOnce(ms) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { done = true; reject(new Error('browser storage did not respond')); }, ms);
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        if (done) return db.close(); // gave up on it already
        done = true;
        clearTimeout(timer);
        // The phone can close the connection while the app is in the background: open a new one next time.
        db.onclose = () => { if (dbPromise && dbPromise.db === db) dbPromise = null; };
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(req.error); } };
    });
  }

  function open() {
    if (!dbPromise) {
      const p = dbPromise = (async () => {
        await wake();
        let db;
        try {
          db = await openOnce(4000);
        } catch (e) {
          await wake();
          db = await openOnce(6000);
        }
        p.db = db;
        return db;
      })();
      p.catch(() => { if (dbPromise === p) dbPromise = null; }); // let the next call try again
    }
    return dbPromise;
  }

  async function run(mode, fn, retried) {
    const db = await open();
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch (e) {
      // The connection was closed under us (app was in the background): reopen once.
      if (retried) throw e;
      dbPromise = null;
      return run(mode, fn, true);
    }
    return new Promise((resolve, reject) => {
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('browser storage request was cancelled'));
    });
  }

  // Asks the browser not to clear this site's data when the disk gets full or the site
  // isn't visited for a while. Browsers decide on their own; returns true if it said yes.
  async function persist() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try {
      return (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch (e) {
      return false;
    }
  }

  return {
    get: key => run('readonly', s => s.get(key)),
    set: (key, value) => run('readwrite', s => s.put(value, key)),
    persist,
  };
};
