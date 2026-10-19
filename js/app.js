/*
 * MTG Tracker — main app.
 * Plain scripts (no build step, no server) so index.html works by double-clicking it.
 */
(() => {
  'use strict';
  const Store = KVStore('mtg-tracker');

  const BASIC_LANDS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
    'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain',
    'snow-covered forest', 'snow-covered wastes']);
  const PRICE_REFRESH_MS = 20 * 60 * 60 * 1000;
  const PAGE_SIZE = 200;

  // The active profile holds your own cards; any others are friends' collections added from a
  // shared file, used only in a deck's "Check against" menu.
  let state;        // { version, activeProfileId, settings, profiles: [{id, name, collection, decks}] }
  let cards = {};   // scryfallId -> card info from Scryfall
  let history = {}; // scryfallId -> [{d, usd, usd_foil, usd_etched}], one entry per day

  // Opened from the home-screen icon: tap a collection card to select it, double tap to open it.
  const appMode = window.matchMedia('(display-mode: standalone)').matches;

  const ui = {
    tab: 'collection', search: '', sort: 'name', view: 'grid', limit: PAGE_SIZE,
    deckId: null, compareId: null, onlyMissing: false, busy: false,
    selected: new Set(), lastPick: null, undo: null,
    deckView: 'grid', deckSel: new Set(), lastDeckPick: null, deckOrder: [], ownFilter: 'all',
    wishView: 'grid',
    filters: { colors: [], type: '', cmc: '', rarity: '' },
  };

  // ---------- helpers ----------

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const money = n => (n == null ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  const finishLabel = f => (f === 'foil' ? 'Foil' : f === 'etched' ? 'Etched' : '');

  function priceFrom(p, finish) {
    if (!p) return null;
    if (finish === 'etched') return p.usd_etched ?? p.usd_foil ?? p.usd ?? null;
    if (finish === 'foil') return p.usd_foil ?? p.usd ?? null;
    return p.usd ?? p.usd_foil ?? p.usd_etched ?? null;
  }
  const priceOf = (scryfallId, finish) => priceFrom(cards[scryfallId] && cards[scryfallId].prices, finish);
  const cardName = row => (cards[row.scryfallId] ? cards[row.scryfallId].name : row.name);
  const nameKey = row => cardName(row).toLowerCase();
  const isBasic = name => BASIC_LANDS.has(name.toLowerCase());

  function profile(id) {
    const want = id || state.activeProfileId;
    return state.profiles.find(p => p.id === want) || state.profiles[0];
  }

  function setStatus(msg, kind) {
    const el = $('#status');
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'status ' + (kind || '');
    el.textContent = msg;
    if (kind === 'undo') el.insertAdjacentHTML('beforeend', ' <button class="btn sm ghost" data-action="undoRemove">Undo</button>');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function download(filename, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // CSV that opens cleanly in Excel and Google Sheets. Cells starting with = + - @ get a ' in front
  // so a spreadsheet never runs them as formulas.
  function toCsv(header, rows) {
    const cell = v => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '\ufeff' + [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  }
  const fileSafe = s => s.replace(/[^\w-]+/g, '_');

  // The printing columns every CSV export shares. Column names match what Moxfield's importer expects.
  const printingCells = r => {
    const c = cards[r.scryfallId] || {};
    const p = priceOf(r.scryfallId, r.finish);
    return { name: cardName(r), set: c.set || '', cn: c.cn || '', foil: r.finish === 'nonfoil' ? '' : r.finish, rarity: c.rarity || '', price: p == null ? '' : p.toFixed(2) };
  };

  function exportCsv(what) {
    const prof = profile();
    let header, rows, name;
    if (what === 'collection') {
      header = ['Count', 'Proxy Count', 'Name', 'Edition', 'Collector Number', 'Foil', 'Rarity', 'Price (USD)', 'Scryfall ID'];
      rows = sortRows(prof.collection.slice()).map(r => {
        const x = printingCells(r);
        return [r.qty, r.proxyQty || 0, x.name, x.set, x.cn, x.foil, x.rarity, x.price, r.scryfallId];
      });
      name = `${prof.name}-collection`;
    } else if (what === 'wishlist') {
      header = ['Count', 'Name', 'Edition', 'Collector Number', 'Foil', 'Price (USD)', 'Scryfall ID'];
      rows = prof.wishlist.map(r => {
        const x = printingCells(r);
        return [r.qty, x.name, x.set, x.cn, x.foil, x.price, r.scryfallId];
      });
      name = `${prof.name}-wishlist`;
    } else {
      const deck = currentDeck();
      if (!deck) return;
      header = ['Count', 'Name', 'Edition', 'Collector Number', 'Foil', 'Category', 'Board', 'Price (USD)', 'Scryfall ID'];
      rows = deck.cards.slice().sort((a, b) => b.inDeck - a.inDeck || cardName(a).localeCompare(cardName(b))).map(r => {
        const x = printingCells(r);
        const cats = r.categories || [];
        const board = r.inDeck ? 'Deck' : cats.find(c => /maybe|side/i.test(c)) || 'Not in deck';
        return [r.qty, x.name, x.set, x.cn, x.foil, cats.join('; '), board, x.price, r.scryfallId];
      });
      name = deck.name;
    }
    download(`${fileSafe(name)}-${today()}.csv`, toCsv(header, rows), 'text/csv;charset=utf-8');
  }

  // ---------- saving ----------

  function newProfile(name) {
    return { id: uid(), name, collection: [], decks: [], wishlist: [] };
  }

  async function load() {
    state = await Store.get('state');
    cards = (await Store.get('cards')) || {};
    history = (await Store.get('history')) || {};
    if (!state) {
      // First time on this device: start with the demo profiles (demo.json), or an empty one
      // if they can't be loaded (offline, or index.html opened as a file).
      const demo = await loadDemo();
      const profiles = demo ? demo.profiles : [newProfile('Me')];
      if (demo) { cards = demo.cards; history = demo.history; }
      state = { version: 1, activeProfileId: profiles[0].id, settings: { ignoreBasics: true, lastPriceRefresh: 0, lastBackup: Date.now() }, profiles };
      await saveNow();
    }
    migrateProxies(state.profiles);
    state.profiles.forEach(p => { if (!p.wishlist) p.wishlist = []; });
  }

  async function loadDemo() {
    try {
      const res = await fetch('demo.json');
      return res.ok ? Backup.parse(await res.text()) : null;
    } catch (e) {
      return null;
    }
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 250);
  }
  async function saveNow() {
    await Store.set('state', state);
    await Store.set('cards', cards);
    await Store.set('history', history);
    if (account) schedulePush();
  }

  // ---------- account (the same data on every device) ----------
  // Logged out, everything is saved only in this browser. Logged in, it's still saved here too
  // (so the app works offline), and every change is also uploaded to the account a few seconds later.
  // The sign-in is kept in browser storage, never in backups, and lasts until you log out.

  let account = null;  // { server, email, token, rev, hash } — hash: this device's data as of the last upload/download
  let pushTimer = null;
  let syncing = false;
  const sync = { msg: '', kind: '' }; // shown on the Account & backup tab
  const PUSH_DELAY = 3000;

  const cloudText = () => JSON.stringify(backupObject(state.profiles));
  // A short fingerprint of the data, to tell whether anything changed since the last sync.
  function textHash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36) + ':' + text.length;
  }
  const hasLocalChanges = () => !!account && textHash(cloudText()) !== account.hash;
  const saveAccount = () => Store.set('account', account);

  function setSync(msg, kind = '') {
    sync.msg = msg;
    sync.kind = kind;
    const el = $('#syncStatus');
    if (el) { el.textContent = msg; el.className = 'small ' + (kind || 'muted'); }
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  }

  async function push() {
    clearTimeout(pushTimer);
    pushTimer = null;
    if (!account || ui.syncChoice) return;
    if (syncing) { schedulePush(); return; }
    const text = cloudText();
    const hash = textHash(text);
    if (hash === account.hash) return;
    syncing = true;
    setSync('Saving to your account…');
    let error = null;
    try {
      const res = await Account.push(account, account.rev, text);
      account.rev = res.rev;
      account.hash = hash;
      await saveAccount();
      setSync('All changes are saved to your account.', 'ok');
      syncShares().catch(() => {}); // tried again after the next change
    } catch (e) {
      error = e;
    }
    syncing = false;
    if (!error) return;
    if (error.status === 409) pull(); // another device saved first
    else syncFailed(error);
  }

  // Downloads the account's data if another device saved something newer.
  async function pull() {
    if (!account || syncing || ui.syncChoice) return;
    syncing = true;
    let res;
    try {
      res = await Account.pull(account);
    } catch (e) {
      syncing = false;
      syncFailed(e);
      return;
    }
    syncing = false;
    if (res.rev === account.rev || !res.data) {
      if (hasLocalChanges()) push();
      else setSync('All changes are saved to your account.', 'ok');
    } else if (!hasLocalChanges()) {
      await applyCloud(res);
    } else {
      // Changed here and on another device: let the person pick which one to keep.
      ui.syncChoice = { kind: 'conflict', res };
      renderSyncNote();
    }
  }

  function syncFailed(e) {
    if (e.status === 401) {
      account = null;
      Store.set('account', null);
      setStatus(`${e.message} Your data is still saved on this device.`, 'warn');
      render();
    } else {
      setSync(`${e.message} Your changes are saved on this device and will upload once it works again.`, 'bad');
    }
  }

  // Replaces this device's data with the account's. Card info and price history are merged.
  async function applyCloud(res) {
    let data;
    try {
      data = Backup.parse(res.data);
    } catch (e) {
      setSync("Your account's data couldn't be read, so this device's data was kept.", 'bad');
      return;
    }
    state.profiles = data.profiles;
    if (!state.profiles.some(p => p.id === state.activeProfileId)) state.activeProfileId = state.profiles[0].id;
    for (const [id, c] of Object.entries(data.cards)) {
      if (!cards[id] || (c.updatedAt || 0) > (cards[id].updatedAt || 0)) cards[id] = c;
    }
    for (const [id, h] of Object.entries(data.history)) mergeHistory(id, h);
    migrateProxies(state.profiles);
    state.profiles.forEach(p => { if (!p.wishlist) p.wishlist = []; });
    account.rev = res.rev;
    account.hash = textHash(cloudText());
    await saveAccount();
    await saveNow();
    setSync('Up to date with your account.', 'ok');
    ui.deckId = ui.deckId && profile().decks.some(d => d.id === ui.deckId) ? ui.deckId : null;
    render();
  }

  async function logIn(form, register) {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const server = archidektRelay();
    if (!server) { setStatus('Set up the relay on the Import tab first. Accounts are saved there.', 'warn'); return; }
    if (register && password !== form.elements.password2.value) { setStatus("The two passwords don't match.", 'warn'); return; }
    setStatus(register ? 'Creating your account…' : 'Logging in…');
    try {
      const res = await (register ? Account.register : Account.login)(server, email, password);
      account = { server, email: email.toLowerCase(), token: res.token, rev: 0, hash: null };
      await saveAccount();
      ui.accountForm = null;
      const cloud = await Account.pull(account);
      if (cloud.rev && cloud.data) ui.syncChoice = { kind: 'login', res: cloud };
      setStatus(register ? 'Account created. This device\'s data is being saved to it.' : 'Logged in.', 'ok');
      setTimeout(() => setStatus(''), 4000);
      render();
      if (!ui.syncChoice) push(); // a new or empty account starts with this device's data
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  async function logOut() {
    if (!confirm('Log out? Your collection and decks stay on this device, but changes here won\'t reach your account until you log in again.')) return;
    if (!ui.syncChoice && hasLocalChanges()) await push();
    const acc = account;
    account = null;
    ui.syncChoice = null;
    await Store.set('account', null);
    Account.logout(acc).catch(() => {});
    setStatus('Logged out. Your data is now saved only on this device.', 'ok');
    setTimeout(() => setStatus(''), 4000);
    render();
  }

  async function changePassword(form) {
    const f = form.elements;
    if (f.newPassword.value !== f.newPassword2.value) { setStatus("The two new passwords don't match.", 'warn'); return; }
    try {
      await Account.changePassword(account, f.password.value, f.newPassword.value);
      form.reset();
      setStatus('Password changed. Your other devices will need to log in again.', 'ok');
      setTimeout(() => setStatus(''), 5000);
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  // The bar shown when logging in to an account that already has data, or when this device
  // and another one both changed things: pick which data to keep.
  function renderSyncNote() {
    const el = $('#syncNote');
    const c = ui.syncChoice;
    el.hidden = !c;
    if (!c) return;
    const when = c.res.updatedAt ? new Date(c.res.updatedAt).toLocaleString() : '';
    el.innerHTML = `<span>${c.kind === 'login'
      ? `Your account already has saved data${when ? ` (last saved ${esc(when)})` : ''}. Which do you want to keep?`
      : `Your account was changed on another device${when ? ` (${esc(when)})` : ''} while this one had changes that weren't uploaded yet. Which do you want to keep?`}</span>
      <button class="btn sm" data-action="syncUseAccount" title="Replace the data on this device with your account's">Use my account's data</button>
      <button class="btn sm ghost" data-action="syncKeepDevice" title="Replace the data in your account with this device's">Keep this device's data</button>
      <button class="btn sm ghost" data-action="backupAll" title="Download this device's data first, just in case">Download backup</button>`;
  }

  function renderAccountPanel() {
    if (account) {
      return `
      <div class="panel">
        <h3>Account</h3>
        <p>Logged in as <b>${esc(account.email)}</b>. Your collection, decks and wishlist are saved to your account, so they're the same on every device you log in on. You stay logged in until you click Log out.</p>
        <p id="syncStatus" class="small ${sync.kind || 'muted'}">${esc(sync.msg || 'Checking your account…')}</p>
        <div class="toolbar">
          <button class="btn ghost" data-action="syncNow">Sync now</button>
          <button class="btn danger" data-action="logOut">Log out</button>
        </div>
        <div class="toolbar">
          <span>New decks start as:</span>
          <div class="seg" role="group" aria-label="Who can view new decks">
            <button data-action="newDeckPrivacy" data-public="" class="${state.settings.newDeckPublic ? '' : 'active'}">Private</button>
            <button data-action="newDeckPrivacy" data-public="1" class="${state.settings.newDeckPublic ? 'active' : ''}">Public</button>
          </div>
          <span class="muted small">For decks you import, load from Archidekt or Moxfield, or save from someone's link. You can still change each deck later.</span>
        </div>
        <details>
          <summary>Change password</summary>
          <form class="account-form" data-form="changePassword">
            <input name="password" type="password" autocomplete="current-password" placeholder="Current password" required>
            <input name="newPassword" type="password" autocomplete="new-password" minlength="8" placeholder="New password (8+ characters)" required>
            <input name="newPassword2" type="password" autocomplete="new-password" minlength="8" placeholder="New password again" required>
            <button class="btn">Change password</button>
          </form>
        </details>
      </div>`;
    }
    const register = ui.accountForm === 'register';
    return `
      <div class="panel">
        <h3>Where your data is saved</h3>
        <p class="muted small">Right now: <b>only on this device</b>. Log in to an account to have the same collection and decks on your phone and computer.</p>
        <div class="toolbar tight">
          <button class="btn ${ui.accountForm === 'login' ? '' : 'ghost'}" data-action="accountForm" data-form-kind="login">Log in</button>
          <button class="btn ${register ? '' : 'ghost'}" data-action="accountForm" data-form-kind="register">Create account</button>
        </div>
        ${ui.accountForm ? `
        <form class="account-form" data-form="${register ? 'register' : 'login'}">
          <input name="email" type="email" autocomplete="email" placeholder="Email" required>
          <input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" ${register ? 'minlength="8"' : ''} placeholder="Password${register ? ' (8+ characters)' : ''}" required>
          ${register ? '<input name="password2" type="password" autocomplete="new-password" minlength="8" placeholder="Password again" required>' : ''}
          <button class="btn">${register ? 'Create account' : 'Log in'}</button>
          <p class="muted small">${register
            ? "Whatever is on this device now becomes your account's data. There's no password reset, so keep your password somewhere safe."
            : "If your account already has data, you'll choose whether to use it or replace it with this device's data."}</p>
        </form>` : ''}
      </div>`;
  }

  // ---------- share links ----------
  // A deck's link is deck.share = { id, public }. Public: anyone with the link can view the deck
  // (not your collection). Private: the link only opens for you, logged in to your account.
  // The relay keeps a copy of each public deck, so it's uploaded again whenever the deck changes.
  // account.shares remembers what was last uploaded for each link: { linkId: fingerprint }.

  const newShareId = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

  // The deck as a one-deck backup, so the viewer can check it with Backup.parse.
  function shareText(deck) {
    const { share, ...rest } = deck;
    return JSON.stringify({ ...backupObject([{ id: 'shared', name: '', collection: [], decks: [rest], wishlist: [] }]), history: {} });
  }

  function shareUrl(deck) {
    const url = new URL(location.href);
    url.hash = `shared/${deck.share.id}` + (account.server !== Archidekt.DEFAULT_RELAY ? '/' + encodeURIComponent(account.server) : '');
    return url.href;
  }

  let shareQueue = Promise.resolve();
  const syncShares = () => (shareQueue = shareQueue.then(uploadShares, uploadShares));

  async function uploadShares() {
    const acc = account;
    if (!acc) return;
    const done = acc.shares || (acc.shares = {});
    const live = new Set();
    for (const deck of profile().decks) {
      if (!deck.share) continue;
      const text = deck.share.public ? shareText(deck) : '';
      const hash = textHash(`${deck.share.public}:${deck.id}:${text}`);
      live.add(deck.share.id);
      if (done[deck.share.id] === hash) continue;
      try {
        await Account.share(acc, deck.share.id, deck.id, deck.share.public, text);
      } catch (e) {
        if (e.status !== 403) throw e;
        // A link from someone else's data (e.g. a restored backup): this deck gets a new one later.
        delete deck.share;
        save();
        continue;
      }
      done[deck.share.id] = hash;
    }
    // Links of decks that were deleted stop working.
    for (const id of Object.keys(done)) {
      if (live.has(id)) continue;
      await Account.unshare(acc, id).catch(e => { if (e.status !== 403) throw e; });
      delete done[id];
    }
    await saveAccount();
  }

  // A new deck's link, Private or Public as picked under "New decks start as" (only when logged in).
  function giveDefaultShare(deck) {
    if (account) deck.share = { id: newShareId(), public: !!state.settings.newDeckPublic };
  }

  // Uploads link changes now, then says how it went.
  function shareNow(okMsg) {
    syncShares().then(() => {
      setStatus(okMsg, 'ok');
      setTimeout(() => setStatus(''), 5000);
    }, e => setStatus(`Couldn't update the deck's link: ${e.message}`, 'error'));
  }

  function deckSharePanel(deck) {
    if (!account) {
      return `<p class="muted small">To share this deck with a link, log in on <a href="#" data-action="tab" data-tab="settings">Account &amp; backup</a>.</p>`;
    }
    const pub = !!(deck.share && deck.share.public);
    return `<div class="toolbar">
        <span>Who can view it:</span>
        <div class="seg" role="group" aria-label="Who can view this deck">
          <button data-action="deckPrivacy" data-public="" class="${pub ? '' : 'active'}" title="Only you can open the link, while logged in to your account">Private</button>
          <button data-action="deckPrivacy" data-public="1" class="${pub ? 'active' : ''}" title="Anyone with the link can view this deck">Public</button>
        </div>
        <button class="btn ghost sm" data-action="copyDeckLink">Copy link</button>
        <span class="muted small">${pub
          ? 'Anyone with the link can view this deck. They can’t see your collection.'
          : 'Only you can open the link, while logged in to your account.'}</span>
      </div>`;
  }

  // Opening someone's link (#shared/<id>, plus /<relay> when it isn't the built-in one).
  async function loadShared(link, key) {
    const server = link.server || Archidekt.DEFAULT_RELAY || archidektRelay();
    const same = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
    const token = account && server && same(account.server, server) ? account.token : null;
    const showError = (msg, login) => { ui.shared = { key, status: 'error', msg, login }; if (ui.tab === 'shared') render(); };
    let res;
    try {
      if (!server) throw new Error('This link needs the relay, which isn\'t set up in this app yet.');
      res = await Account.viewShare(server, link.id, token);
    } catch (e) {
      if (ui.shared.key === key) showError(e.message, e.status === 403 && !token);
      return;
    }
    if (ui.shared.key !== key) return;
    if (!res.public) {
      // One of your own private decks: open it like any other.
      if (!profile().decks.some(d => d.id === res.deckId)) {
        showError("This is one of your private decks, but it isn't on this device yet. Try Sync now on Account & backup.");
        return;
      }
      ui.tab = 'decks';
      ui.deckId = res.deckId;
      ui.compareId = state.activeProfileId;
      window.history.replaceState(window.history.state, '', navHash());
      render();
      return;
    }
    let data;
    try {
      data = Backup.parse(res.deck);
    } catch (e) {
      showError("This deck couldn't be read.");
      return;
    }
    const deck = data.profiles[0].decks[0];
    if (!deck) { showError("This deck couldn't be read."); return; }
    // Card info for cards this device hasn't seen yet (only adds, never replaces).
    for (const [id, c] of Object.entries(data.cards)) if (!cards[id]) cards[id] = c;
    ui.shared = { key, status: 'ok', deck, updatedAt: res.updatedAt };
    if (ui.tab === 'shared') render();
  }

  function renderShared() {
    const link = ui.sharedLink;
    const key = link.id + '|' + link.server;
    if (!ui.shared || ui.shared.key !== key) {
      ui.shared = { key, status: 'loading' };
      loadShared(link, key);
    }
    const s = ui.shared;
    if (s.status === 'loading') return '<div class="empty">Opening the shared deck…</div>';
    if (s.status === 'error') {
      return `<div class="page-head"><h1>Shared deck</h1></div>
        <div class="panel"><p>${esc(s.msg)}</p>
        ${s.login ? `<p class="muted small">If it's your deck, log in to your account first, then open the link again.</p>
          <button class="btn" data-action="tab" data-tab="settings">Log in</button>` : ''}</div>`;
    }
    const deck = s.deck;
    const st = deckStatus(deck, profile());
    const pct = st.total ? Math.round((st.have + st.proxies) / st.total * 100) : 0;
    const groups = new Map();
    for (const r of deck.cards.filter(x => x.inDeck)) {
      const cat = (r.categories && r.categories[0]) || 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(r);
    }
    const order = [...groups.keys()].sort((a, b) => (b === 'Commander') - (a === 'Commander') || a.localeCompare(b));
    const sections = order.map(cat => {
      const rows = groups.get(cat).sort((a, b) => cardName(a).localeCompare(cardName(b)));
      return `<section class="deck-section"><h3>${esc(cat)} <span class="muted">(${rows.reduce((n, r) => n + r.qty, 0)})</span></h3>
        <table class="list compact"><tbody>${rows.map(r => {
          const c = cards[r.scryfallId] || {};
          const rs = st.rowStatus(r);
          return `<tr data-action="card" data-id="${esc(r.scryfallId)}" data-preview="${esc(c.image || '')}">
            <td class="qtycol">${r.qty}</td><td>${esc(cardName(r))} ${finishLabel(r.finish) ? `<span class="pill">${finishLabel(r.finish)}</span>` : ''}</td>
            <td class="manacol">${manaHtml(c.manaCost)}</td>
            <td class="num">${money(priceOf(r.scryfallId, r.finish))}</td>
            <td class="owncol">${rs.missing ? `<span class="bad">✗ you need ${rs.missing}</span>` : '<span class="ok">✓ you have it</span>'}</td></tr>`;
        }).join('')}</tbody></table></section>`;
    }).join('');
    return `
      <div class="page-head">
        <div><span class="muted small">Shared deck</span><h1>${esc(deck.name)}</h1></div>
        <div class="stats">
          <div><b>${st.total}</b><span>cards</span></div>
          <div><b>${money(rowsValue(deck.cards.filter(r => r.inDeck)))}</b><span>value</span></div>
          <div><b>${pct}%</b><span>you have</span></div>
          <div><b>${money(st.missingCost)}</b><span>for you to finish</span></div>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn" data-action="saveSharedDeck">Save a copy to my decks</button>
        <span class="muted small">${s.updatedAt ? `Last changed ${esc(new Date(s.updatedAt).toLocaleString())}. ` : ''}"You have" is checked against your own collection.</span>
      </div>
      <div class="deck-columns">${sections || '<div class="empty">This deck has no cards.</div>'}</div>`;
  }

  // ---------- Scryfall lookups + price history ----------

  function rememberCards(list) {
    const d = today();
    for (const c of list) {
      cards[c.id] = c;
      const h = history[c.id] || (history[c.id] = []);
      const snap = { d, usd: c.prices.usd, usd_foil: c.prices.usd_foil, usd_etched: c.prices.usd_etched };
      if (h.length && h[h.length - 1].d === d) h[h.length - 1] = snap;
      else h.push(snap);
    }
  }

  // Turns parsed export lines into rows linked to Scryfall cards.
  async function resolveEntries(entries) {
    const lineKey = e => (e.set && e.cn ? `sc:${e.set}|${e.cn.toLowerCase()}` : `n:${e.name.toLowerCase()}`);
    const nameKeyOf = e => `n:${e.name.toLowerCase()}`;
    const found = new Map();
    const index = list => {
      for (const c of list) {
        found.set(`sc:${c.set}|${String(c.cn).toLowerCase()}`, c);
        for (const n of c.names) if (!found.has('n:' + n)) found.set('n:' + n, c);
      }
    };

    // 1. Exact printing (set + collector number) or name
    const idents = new Map();
    for (const e of entries) {
      const k = lineKey(e);
      if (!idents.has(k)) idents.set(k, e.set && e.cn ? { set: e.set, collector_number: e.cn } : { name: e.name });
    }
    setStatus(`Looking up ${plural(idents.size, 'card')} on Scryfall…`);
    let result = await Scryfall.collection([...idents.values()], (done, total) =>
      setStatus(`Looking up cards on Scryfall… ${done}/${total}`));
    index(result.found);

    // 2. Printing not found: try by name
    const byName = new Map();
    for (const e of entries) {
      if (!found.has(lineKey(e)) && !found.has(nameKeyOf(e))) byName.set(nameKeyOf(e), { name: e.name });
    }
    if (byName.size) {
      result = await Scryfall.collection([...byName.values()]);
      index(result.found);
    }

    // 3. Still not found: fuzzy name search (handles front-face-only names, typos)
    const leftovers = [...new Set(entries.filter(e => !found.has(lineKey(e)) && !found.has(nameKeyOf(e))).map(e => e.name))];
    for (const name of leftovers.slice(0, 30)) {
      setStatus(`Searching for "${name}"…`);
      const c = await Scryfall.named(name, true);
      if (c) {
        index([c]);
        found.set('n:' + name.toLowerCase(), c);
      }
    }

    const all = [...new Map([...found.values()].map(c => [c.id, c])).values()];
    rememberCards(all);
    if (!state.settings.lastPriceRefresh) state.settings.lastPriceRefresh = Date.now();

    const rows = [];
    const missing = [];
    for (const e of entries) {
      const c = found.get(lineKey(e)) || found.get(nameKeyOf(e));
      if (c) rows.push({ ...e, scryfallId: c.id, name: c.name });
      else missing.push(e);
    }
    return { rows, missing };
  }

  function allScryfallIds() {
    const ids = new Set();
    for (const p of state.profiles) {
      p.collection.forEach(r => ids.add(r.scryfallId));
      p.decks.forEach(d => d.cards.forEach(r => ids.add(r.scryfallId)));
      (p.wishlist || []).forEach(r => ids.add(r.scryfallId));
    }
    return [...ids];
  }

  async function refreshPrices(auto) {
    if (ui.busy) return;
    const ids = allScryfallIds();
    if (!ids.length) { if (!auto) setStatus('No cards yet — import some first.', 'warn'); return; }
    ui.busy = true;
    try {
      setStatus(`Updating prices for ${plural(ids.length, 'card')}…`);
      const { found } = await Scryfall.collection(ids.map(id => ({ id })), (done, total) =>
        setStatus(`Updating prices… ${done}/${total}`));
      rememberCards(found);
      state.settings.lastPriceRefresh = Date.now();
      await saveNow();
      setStatus(`Prices updated (${plural(found.length, 'card')}).`, 'ok');
      setTimeout(() => setStatus(''), 4000);
    } catch (err) {
      setStatus(`Couldn't update prices: ${err.message}. Check your internet connection.`, 'error');
    } finally {
      ui.busy = false;
      render();
    }
  }

  // ---------- collection + deck logic ----------

  // Each collection entry is one printing + finish with two counts:
  //   qty = official (real) copies, proxyQty = proxies of that card.
  // rows: [{scryfallId, name, finish, qty, proxy?}] — with proxy: true, qty is added as proxies.
  function addToCollection(prof, rows) {
    for (const r of rows) {
      const key = (cards[r.scryfallId] ? cards[r.scryfallId].name : r.name).toLowerCase();
      const sameName = prof.collection.filter(c => nameKey(c) === key);
      if (r.proxy) {
        // Proxies join the card you already have (this printing first), so it stays one card.
        const target = sameName.find(c => c.scryfallId === r.scryfallId) || sameName[0];
        if (target) { target.proxyQty = (target.proxyQty || 0) + r.qty; continue; }
        prof.collection.push({ scryfallId: r.scryfallId, name: r.name, finish: r.finish, qty: 0, proxyQty: r.qty, addedAt: Date.now() });
        continue;
      }
      const exact = sameName.find(c => c.scryfallId === r.scryfallId && c.finish === r.finish);
      if (exact) { exact.qty += r.qty; continue; }
      // A proxy-only entry becomes this real printing instead of a second card.
      const proxyOnly = sameName.find(c => !c.qty);
      if (proxyOnly) {
        Object.assign(proxyOnly, { scryfallId: r.scryfallId, name: r.name, finish: r.finish, qty: r.qty });
        continue;
      }
      prof.collection.push({ scryfallId: r.scryfallId, name: r.name, finish: r.finish, qty: r.qty, proxyQty: 0, addedAt: Date.now() });
    }
  }

  // Takes up to `count` official copies (or proxies) of a card name out of the collection, this printing first.
  function removeFromCollection(prof, key, proxy, count, preferId) {
    const field = proxy ? 'proxyQty' : 'qty';
    const matches = prof.collection
      .filter(c => nameKey(c) === key && (c[field] || 0) > 0)
      .sort((a, b) => (b.scryfallId === preferId) - (a.scryfallId === preferId));
    let left = count;
    for (const c of matches) {
      const take = Math.min(left, c[field]);
      c[field] -= take;
      left -= take;
      if (!left) break;
    }
    dropEmpty(prof);
    return count - left;
  }

  const dropEmpty = prof => { prof.collection = prof.collection.filter(c => c.qty > 0 || c.proxyQty > 0); };

  // Copies per card name: official cards, or proxies when proxy is true.
  function ownedCounts(prof, proxy) {
    const m = new Map();
    for (const r of prof.collection) {
      const n = proxy ? (r.proxyQty || 0) : r.qty;
      if (n) m.set(nameKey(r), (m.get(nameKey(r)) || 0) + n);
    }
    return m;
  }

  // Older saves kept proxies as separate entries ({proxy: true}); fold them into one entry per card.
  function migrateProxies(profiles) {
    for (const p of profiles) {
      const proxies = p.collection.filter(c => c.proxy);
      if (!proxies.length && p.collection.every(c => c.proxyQty != null)) continue;
      p.collection = p.collection.filter(c => !c.proxy).map(c => ({ ...c, proxyQty: c.proxyQty || 0 }));
      addToCollection(p, proxies.map(c => ({ scryfallId: c.scryfallId, name: c.name, finish: c.finish, qty: c.qty, proxy: true })));
    }
  }

  // For each card name in the deck: how many it needs, and how many real copies and proxies
  // the profile's collection has. Real copies are used first, then proxies; the rest is missing.
  function deckStatus(deck, prof) {
    const real = ownedCounts(prof, false);
    const prox = ownedCounts(prof, true);
    const names = new Map();
    for (const r of deck.cards) {
      if (!r.inDeck) continue;
      const k = nameKey(r);
      const n = names.get(k) || { name: cardName(r), need: 0, row: r };
      n.need += r.qty;
      names.set(k, n);
    }
    let total = 0, have = 0, proxies = 0, missingCost = 0;
    const byName = new Map();
    const missing = [];
    const proxyList = [];
    for (const [k, n] of names) {
      const basic = state.settings.ignoreBasics && isBasic(n.name);
      const own = real.get(k) || 0;
      const proxy = prox.get(k) || 0;
      const ownUsed = basic ? n.need : Math.min(n.need, own);
      const proxyUsed = Math.min(n.need - ownUsed, proxy);
      const miss = n.need - ownUsed - proxyUsed;
      byName.set(k, { need: n.need, own, proxy, ownUsed, proxyUsed, missing: miss, basic });
      total += n.need;
      have += ownUsed;
      proxies += proxyUsed;
      if (proxyUsed) proxyList.push({ name: n.name, qty: proxyUsed });
      if (miss) {
        const price = priceOf(n.row.scryfallId, 'nonfoil');
        missing.push({ name: n.name, qty: miss, price });
        missingCost += (price || 0) * miss;
      }
    }
    const byNameSort = (a, b) => a.name.localeCompare(b.name);
    return {
      total, have, proxies, missingCost, byName,
      editable: prof.id === state.activeProfileId,
      rowStatus: r => (r.inDeck ? byName.get(nameKey(r)) : null),
      missing: missing.sort(byNameSort),
      proxyList: proxyList.sort(byNameSort),
    };
  }

  // Mana cost like "{2}{R}" as Scryfall's symbol icons.
  function manaHtml(cost) {
    if (!cost) return '';
    return esc(cost).replace(/\{([^}]+)\}/g, (_, sym) =>
      `<img class="mana" src="https://svgs.scryfall.io/card-symbols/${encodeURIComponent(sym.replace(/\//g, ''))}.svg" alt="{${sym}}" title="{${sym}}">`);
  }

  // Only official copies count toward value (proxies are stored in proxyQty).
  const rowsValue = rows => rows.reduce((s, r) => s + (priceOf(r.scryfallId, r.finish) || 0) * r.qty, 0);

  // Value of these rows on each day we have prices for (uses the closest earlier price for each card).
  function valueSeries(rows) {
    const dates = new Set();
    for (const r of rows) (history[r.scryfallId] || []).forEach(s => dates.add(s.d));
    return [...dates].sort().map(d => {
      let v = 0;
      for (const r of rows) {
        const h = history[r.scryfallId];
        if (!h || !h.length) continue;
        let snap = h[0];
        for (const s of h) { if (s.d <= d) snap = s; else break; }
        v += (priceFrom(snap, r.finish) || 0) * r.qty;
      }
      return { d, v };
    });
  }

  function decksUsing(prof) {
    const m = new Map();
    for (const d of prof.decks) {
      for (const r of d.cards) {
        if (!r.inDeck) continue;
        const k = nameKey(r);
        if (!m.has(k)) m.set(k, new Set());
        m.get(k).add(d.name);
      }
    }
    return m;
  }

  // ---------- rendering ----------

  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
    const view = $('#view');
    showSimulator(ui.tab === 'simulator');
    if (ui.tab === 'simulator') { renderBackupNote(); renderSyncNote(); syncNav(); return; }
    if (ui.tab === 'collection') view.innerHTML = renderCollection();
    else if (ui.tab === 'decks') view.innerHTML = ui.deckId ? renderDeck() : renderDeckList();
    else if (ui.tab === 'wishlist') view.innerHTML = renderWishlist();
    else if (ui.tab === 'prices') view.innerHTML = renderPrices();
    else if (ui.tab === 'import') view.innerHTML = renderImport();
    else if (ui.tab === 'settings') view.innerHTML = renderSettings();
    else if (ui.tab === 'shared') view.innerHTML = renderShared();
    renderBackupNote();
    renderSyncNote();
    syncNav();
  }

  // ---------- the Simulator, as a tab ----------

  // It runs in a frame that's made the first time you open the tab and then kept, so a game stays
  // where you left it while you use the rest of the app. It reads your decks from this browser's
  // storage (simulator/js/tracker-link.js), so they're saved first and it's told to read them again.
  let simFrame = null;
  let simReady = false;
  const simQueue = []; // messages for it before it has started
  function simSend(msg) {
    if (simFrame && simReady) simFrame.contentWindow.postMessage(msg, location.origin === 'null' ? '*' : location.origin);
    else simQueue.push(msg);
  }
  window.addEventListener('message', e => {
    if (!simFrame || e.source !== simFrame.contentWindow) return;
    if (e.data && e.data.type === 'sim:ready') {
      simReady = true;
      simQueue.splice(0).forEach(simSend);
    }
  });
  function placeSimulator() {
    const host = $('#simHost');
    const bar = document.querySelector('.topbar');
    if (host && bar) host.style.top = `${bar.getBoundingClientRect().bottom}px`;
  }
  function showSimulator(on) {
    const host = $('#simHost');
    const was = !host.hidden;
    document.body.classList.toggle('sim-open', on);
    host.hidden = !on;
    if (!on) { if (was) loadSimResults(); return; } // games you finished there show on the deck pages
    if (!simFrame) {
      simFrame = document.createElement('iframe');
      simFrame.className = 'sim-frame';
      simFrame.title = 'MTG Simulator';
      simFrame.src = 'simulator/index.html?embed=1';
      host.appendChild(simFrame);
    }
    placeSimulator();
    // Your latest changes, saved and read again.
    (saveTimer ? (clearTimeout(saveTimer), saveTimer = null, saveNow()) : Promise.resolve()).then(() => simSend({ type: 'sim:refresh' }));
  }
  window.addEventListener('resize', placeSimulator);
  // From a deck page: open this deck in the Simulator (mode 'play', 'bot' or 'odds').
  function openInSimulator(deckId, mode) {
    ui.tab = 'simulator';
    render();
    simSend({ type: 'sim:open', key: `tracker:${state.activeProfileId}:${deckId}`, mode });
  }

  // A reminder bar when it's been a month since the last backup (or since "Remind me later").
  const BACKUP_REMIND_MS = 30 * 24 * 60 * 60 * 1000;
  function renderBackupNote() {
    const el = $('#backupNote');
    const s = state.settings;
    const hasData = state.profiles.some(p => p.collection.length || p.decks.length || p.wishlist.length);
    const last = Math.max(s.lastBackup || 0, s.backupSnoozed || 0);
    // Logged in, the account already keeps a copy.
    el.hidden = !!account || !hasData || Date.now() - last < BACKUP_REMIND_MS;
    if (el.hidden) return;
    el.innerHTML = `<span>${s.lastBackup
      ? `Your last backup was ${Math.floor((Date.now() - s.lastBackup) / 86400000)} days ago.`
      : "You haven't downloaded a backup yet."} Your cards are only saved in this browser, so a backup keeps them safe.</span>
      <button class="btn sm" data-action="backupAll">Download backup</button>
      <button class="btn sm ghost" data-action="snoozeBackup">Remind me later</button>`;
  }

  // ---------- navigation (in-app Back button and the browser's Back/Forward) ----------

  const TABS = ['collection', 'decks', 'wishlist', 'prices', 'import', 'settings', 'simulator'];
  let navDepth = 0; // how many in-app pages are behind the current one

  const navHash = () => (ui.tab === 'shared'
    ? `#shared/${encodeURIComponent(ui.sharedLink.id)}${ui.sharedLink.server ? '/' + encodeURIComponent(ui.sharedLink.server) : ''}`
    : '#' + ui.tab + (ui.tab === 'decks' && ui.deckId ? '/' + ui.deckId : ''));

  // Record each new page in the browser history so Back can return to it.
  function syncNav() {
    if (location.hash !== navHash()) window.history.pushState({ depth: ++navDepth }, '', navHash());
    $('#backBtn').disabled = navDepth === 0;
  }

  // Show the page named in the address bar, e.g. #decks/<deckId> or a deck link, #shared/<linkId>.
  function readNav() {
    let parts;
    try { parts = location.hash.slice(1).split('/').map(decodeURIComponent); } catch (e) { parts = []; }
    const [tab, deckId, server] = parts;
    if (tab === 'shared' && deckId) {
      ui.tab = 'shared';
      ui.deckId = null;
      ui.sharedLink = { id: deckId, server: server || '' };
      return;
    }
    ui.tab = TABS.includes(tab) ? tab : 'collection';
    ui.deckId = ui.tab === 'decks' && deckId ? deckId : null;
    ui.deckSel.clear();
    ui.lastDeckPick = null;
    if (ui.deckId) ui.compareId = state.activeProfileId;
  }

  const rowKey = r => `${r.scryfallId}|${r.finish}`;

  function pickBox(row, index) {
    const key = rowKey(row);
    return `<label class="pick" title="Select (Shift-click to select a range)"><input type="checkbox" data-select="${esc(key)}" data-index="${index}" ${ui.selected.has(key) ? 'checked' : ''}></label>`;
  }

  // − n + counter for official copies or proxies of one collection entry.
  function countStepper(row, proxy) {
    const n = proxy ? (row.proxyQty || 0) : row.qty;
    const data = `data-action="qty" data-id="${esc(row.scryfallId)}" data-finish="${esc(row.finish)}" data-proxy="${proxy ? 1 : ''}"`;
    return `<span class="stepper ${proxy ? 'proxy' : 'owned'}">${proxy ? 'Proxy' : 'Official'}
      <button ${data} data-delta="-1" aria-label="One less">−</button><b>${n}</b><button ${data} data-delta="1" aria-label="One more">+</button></span>`;
  }

  function cardTile(row, index) {
    const c = cards[row.scryfallId] || {};
    const foil = finishLabel(row.finish);
    return `
      <div class="tile-wrap ${ui.selected.has(rowKey(row)) ? 'selected' : ''} ${row.qty ? '' : 'is-proxy'}">
        <button class="tile ${row.finish !== 'nonfoil' ? 'is-foil' : ''}" data-action="card" data-id="${esc(row.scryfallId)}">
          ${c.image ? `<img src="${esc(c.image)}" alt="${esc(cardName(row))}" loading="lazy">` : `<div class="noimg">${esc(cardName(row))}</div>`}
          ${foil ? `<span class="foil">${foil}</span>` : ''}
          ${row.qty ? `<span class="tile-price">${money(priceOf(row.scryfallId, row.finish))}</span>` : '<span class="proxy-tag">PROXY</span>'}
        </button>
        ${appMode ? '' : pickBox(row, index)}
        <div class="counts ${appMode ? 'has-pick' : ''}">${countStepper(row, false)}${countStepper(row, true)}${appMode ? pickBox(row, index) : ''}</div>
      </div>`;
  }

  // Collection rows after the search box and sort order are applied.
  // Collection filters. Colors use color identity: picking G and W shows cards that are at least
  // green and white; C shows colorless cards.
  const FILTER_TYPES = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Battle'];
  const FILTER_RARITIES = [['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['mythic', 'Mythic'], ['special', 'Special']];
  const filtersOn = () => ui.filters.colors.length || ui.filters.type || ui.filters.cmc || ui.filters.rarity;

  function matchesFilters(c) {
    const f = ui.filters;
    const ci = c.colorIdentity || [];
    if (f.colors.length) {
      const wanted = f.colors.filter(k => k !== 'C');
      if (f.colors.includes('C') && ci.length) return false;
      if (!wanted.every(k => ci.includes(k))) return false;
    }
    if (f.type && !(c.typeLine || '').split('//')[0].includes(f.type)) return false;
    if (f.cmc !== '') {
      const cmc = Math.floor(c.cmc || 0);
      if (f.cmc === '7' ? cmc < 7 : cmc !== Number(f.cmc)) return false;
    }
    if (f.rarity && (f.rarity === 'special' ? ['common', 'uncommon', 'rare', 'mythic'].includes(c.rarity) : c.rarity !== f.rarity)) return false;
    return true;
  }

  function shownCollection() {
    const q = ui.search.trim().toLowerCase();
    let rows = profile().collection;
    if (ui.ownFilter === 'real') rows = rows.filter(r => r.qty > 0);
    else if (ui.ownFilter === 'proxy') rows = rows.filter(r => r.proxyQty > 0);
    if (filtersOn()) rows = rows.filter(r => matchesFilters(cards[r.scryfallId] || {}));
    return sortRows(q ? rows.filter(r => {
      const c = cards[r.scryfallId] || {};
      return cardName(r).toLowerCase().includes(q) || (c.typeLine || '').toLowerCase().includes(q) || (c.setName || '').toLowerCase().includes(q);
    }) : rows);
  }

  function filterBar(shownCount, totalCount) {
    const f = ui.filters;
    const opt = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
    return `
      <div class="toolbar filters">
        <div class="seg colors" title="Color identity. Pick more than one to find cards with all of them.">
          ${['W', 'U', 'B', 'R', 'G', 'C'].map(k => `<button data-action="filterColor" data-color="${k}" class="${f.colors.includes(k) ? 'active' : ''}" aria-pressed="${f.colors.includes(k)}" aria-label="${k === 'C' ? 'Colorless' : k}">${manaHtml(`{${k}}`)}</button>`).join('')}
        </div>
        <label>Type <select data-input="filterType">${opt('', 'Any', f.type)}${FILTER_TYPES.map(t => opt(t, t, f.type)).join('')}</select></label>
        <label>Mana value <select data-input="filterCmc">${opt('', 'Any', f.cmc)}${['0', '1', '2', '3', '4', '5', '6'].map(n => opt(n, n, f.cmc)).join('')}${opt('7', '7+', f.cmc)}</select></label>
        <label>Rarity <select data-input="filterRarity">${opt('', 'Any', f.rarity)}${FILTER_RARITIES.map(([v, l]) => opt(v, l, f.rarity)).join('')}</select></label>
        ${filtersOn() || ui.search.trim() ? `<span class="muted small">Showing ${shownCount.toLocaleString()} of ${totalCount.toLocaleString()}</span>` : ''}
        ${filtersOn() ? '<button class="btn sm ghost" data-action="clearFilters">Clear filters</button>' : ''}
      </div>`;
  }

  function selectionBar(shown) {
    const size = ui.selected.size;
    const all = shown.length > 0 && shown.every(r => ui.selected.has(rowKey(r)));
    const copies = profile().collection.filter(r => ui.selected.has(rowKey(r))).reduce((s, r) => s + r.qty, 0);
    return `
      <div class="selbar ${size ? 'active' : ''}" id="selBar">
        <label class="check"><input type="checkbox" data-input="selectAll" ${all ? 'checked' : ''}> Select all${ui.search.trim() ? ' matching' : ''} (${shown.length.toLocaleString()})</label>
        ${size ? `<span><b>${size.toLocaleString()}</b> selected (${copies.toLocaleString()} ${copies === 1 ? 'copy' : 'copies'})</span>
          <button class="btn danger" data-action="removeSelected">Remove selected</button>
          <button class="btn ghost" data-action="clearSelection">Clear selection</button>`
        : '<span class="muted small">Tick cards to remove several at once. Shift-click to select a range.</span>'}
      </div>`;
  }

  // Update checkboxes and the selection bar without redrawing the whole page.
  function syncSelection() {
    document.querySelectorAll('[data-select]').forEach(cb => {
      cb.checked = ui.selected.has(cb.dataset.select);
      const holder = cb.closest('.tile-wrap, tr');
      if (holder) holder.classList.toggle('selected', cb.checked);
    });
    const grid = document.querySelector('.grid');
    if (grid) grid.classList.toggle('selecting', ui.selected.size > 0);
    const bar = $('#selBar');
    if (bar) bar.outerHTML = selectionBar(shownCollection());
  }

  // App: one tap on a collection card ticks its box, a double tap opens it.
  let lastTap = null; // { cb, timer }
  function tapToSelect(cb, el) {
    const twice = lastTap && lastTap.cb === cb;
    if (lastTap) clearTimeout(lastTap.timer);
    lastTap = null;
    if (twice) return actions.card(el);
    lastTap = { cb, timer: setTimeout(() => {
      lastTap = null;
      if (!cb.isConnected) return;
      cb.checked = !cb.checked;
      togglePick(cb, false);
    }, 280) };
  }

  function togglePick(cb, shift) {
    const shown = shownCollection();
    const idx = Number(cb.dataset.index);
    const from = shift && ui.lastPick != null ? Math.min(ui.lastPick, idx) : idx;
    const to = shift && ui.lastPick != null ? Math.max(ui.lastPick, idx) : idx;
    for (let i = from; i <= to; i++) {
      if (!shown[i]) continue;
      if (cb.checked) ui.selected.add(rowKey(shown[i]));
      else ui.selected.delete(rowKey(shown[i]));
    }
    ui.lastPick = idx;
    syncSelection();
  }

  function sortRows(rows) {
    const by = {
      name: (a, b) => cardName(a).localeCompare(cardName(b)),
      price: (a, b) => (priceOf(b.scryfallId, b.finish) || 0) - (priceOf(a.scryfallId, a.finish) || 0),
      qty: (a, b) => b.qty - a.qty || cardName(a).localeCompare(cardName(b)),
      added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      set: (a, b) => ((cards[a.scryfallId] || {}).setName || '').localeCompare((cards[b.scryfallId] || {}).setName || '') || cardName(a).localeCompare(cardName(b)),
    };
    return rows.slice().sort(by[ui.sort] || by.name);
  }

  function renderCollection() {
    const prof = profile();
    const rows = prof.collection;
    const shown = shownCollection();
    const existing = new Set(rows.map(rowKey));
    ui.selected.forEach(k => { if (!existing.has(k)) ui.selected.delete(k); });
    const total = rows.reduce((s, r) => s + r.qty, 0);
    const proxyCount = rows.reduce((s, r) => s + (r.proxyQty || 0), 0);
    const using = decksUsing(prof);

    const header = `
      <div class="page-head">
        <h1>${esc(prof.name)}'s collection</h1>
        <div class="stats">
          <div><b>${total.toLocaleString()}</b><span>official</span></div>
          ${proxyCount ? `<div><b>${proxyCount.toLocaleString()}</b><span>proxies</span></div>` : ''}
          <div><b>${new Set(rows.map(nameKey)).size.toLocaleString()}</b><span>unique</span></div>
          <div><b>${money(rowsValue(rows))}</b><span>value</span></div>
        </div>
      </div>
      <div class="toolbar">
        <input type="search" placeholder="Search name, type or set…" value="${esc(ui.search)}" data-input="search">
        <label>Sort <select data-input="sort">
          ${[['name', 'Name'], ['price', 'Price'], ['qty', 'Quantity'], ['added', 'Recently added'], ['set', 'Set']]
            .map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
        <div class="seg">
          <button data-action="view" data-view="grid" class="${ui.view === 'grid' ? 'active' : ''}">Images</button>
          <button data-action="view" data-view="list" class="${ui.view === 'list' ? 'active' : ''}">List</button>
        </div>
        <div class="seg">
          ${[['all', 'All'], ['real', 'Official'], ['proxy', 'Proxies']].map(([v, l]) => `<button data-action="ownFilter" data-filter="${v}" class="${ui.ownFilter === v ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <button class="btn ghost" data-action="exportCsv" data-what="collection" ${rows.length ? '' : 'disabled'} title="Download a spreadsheet of your collection">Export CSV</button>
      </div>
      ${rows.length ? filterBar(shown.length, rows.length) : ''}
      <form class="add-card" data-form="addCard">
        <input name="name" list="acList" placeholder="Add a card by name…" autocomplete="off" data-input="autocomplete" required>
        <datalist id="acList"></datalist>
        <input name="qty" type="number" min="1" value="1" title="Quantity">
        <select name="finish"><option value="nonfoil">Normal</option><option value="foil">Foil</option><option value="etched">Etched</option></select>
        <label class="check"><input type="checkbox" name="proxy"> Proxy</label>
        <button class="btn">Add</button>
      </form>`;

    if (!rows.length) {
      return header + `<div class="empty">No cards yet. Go to <a href="#" data-action="tab" data-tab="import">Import</a> to add your Archidekt export, or add a card above.</div>`;
    }

    if (!shown.length) {
      return header + `<div class="empty">No cards match. ${filtersOn() ? '<a href="#" data-action="clearFilters">Clear filters</a>' : ''}</div>`;
    }

    const page = shown.slice(0, ui.limit);
    const more = shown.length > ui.limit
      ? `<button class="btn more" data-action="more">Show more (${(shown.length - ui.limit).toLocaleString()} left)</button>` : '';

    if (ui.view === 'grid') {
      return header + selectionBar(shown) + `<div class="grid ${ui.selected.size ? 'selecting' : ''}">${page.map(cardTile).join('')}</div>${more}`;
    }
    return header + selectionBar(shown) + `
      <table class="list">
        <thead><tr><th class="pickcol"></th><th>Official</th><th>Proxy</th><th>Name</th><th>Set</th><th></th><th class="num">Price</th><th class="num">Total</th><th>In decks</th></tr></thead>
        <tbody>${page.map((r, i) => {
          const c = cards[r.scryfallId] || {};
          const p = priceOf(r.scryfallId, r.finish);
          const decks = using.get(nameKey(r));
          return `<tr data-action="card" data-id="${esc(r.scryfallId)}" data-preview="${esc(c.image || '')}" class="${ui.selected.has(rowKey(r)) ? 'selected' : ''}">
            <td class="pickcol">${pickBox(r, i)}</td><td class="cnt">${countStepper(r, false)}</td><td class="cnt">${countStepper(r, true)}</td><td>${esc(cardName(r))}</td><td class="muted">${esc(c.setName || '')}</td>
            <td>${finishLabel(r.finish) ? `<span class="pill">${finishLabel(r.finish)}</span>` : ''}</td>
            <td class="num">${money(p)}</td><td class="num">${p == null || !r.qty ? '—' : money(p * r.qty)}</td>
            <td class="muted small">${decks ? esc([...decks].join(', ')) : ''}</td></tr>`;
        }).join('')}</tbody>
      </table>${more}`;
  }

  // ---------- wishlist ----------

  // rows: [{scryfallId, name, finish, qty}] — same printing + finish adds to the existing entry.
  function addToWishlist(prof, rows) {
    for (const r of rows) {
      const existing = prof.wishlist.find(w => w.scryfallId === r.scryfallId && w.finish === r.finish);
      if (existing) existing.qty += r.qty;
      else prof.wishlist.push({ scryfallId: r.scryfallId, name: r.name, finish: r.finish, qty: r.qty, addedAt: Date.now() });
    }
  }

  function renderWishlist() {
    const prof = profile();
    const list = prof.wishlist;
    const owned = ownedCounts(prof, false);
    const proxied = ownedCounts(prof, true);
    const total = list.reduce((s, w) => s + w.qty, 0);
    const cost = rowsValue(list);
    const sorted = list.map((w, i) => ({ w, i })).sort((a, b) =>
      (priceOf(b.w.scryfallId, b.w.finish) || 0) - (priceOf(a.w.scryfallId, a.w.finish) || 0));

    const wantStepper = i => `<span class="stepper want">Want
      <button data-action="wishQty" data-i="${i}" data-delta="-1" aria-label="One less">−</button><b>${list[i].qty}</b><button data-action="wishQty" data-i="${i}" data-delta="1" aria-label="One more">+</button></span>`;
    const haveNote = w => {
      const k = nameKey(w);
      const parts = [];
      if (owned.get(k)) parts.push(`${owned.get(k)} official`);
      if (proxied.get(k)) parts.push(`${proxied.get(k)} proxy`);
      return parts.length ? `<span class="muted small">You have ${parts.join(', ')}</span>` : '';
    };
    const actionsFor = i => `
      <button class="btn sm" data-action="wishGot" data-i="${i}" title="Move to your collection as official copies">✓ Got it</button>
      <button class="btn sm ghost" data-action="wishRemove" data-i="${i}" title="Remove from wishlist">Remove</button>`;

    const header = `
      <div class="page-head">
        <h1>${esc(prof.name)}'s wishlist</h1>
        <div class="stats">
          <div><b>${total.toLocaleString()}</b><span>cards</span></div>
          <div><b>${money(cost)}</b><span>total cost</span></div>
        </div>
      </div>
      <form class="add-card" data-form="addWish">
        <input name="name" list="acList" placeholder="Add a card you want by name… (or drag one in from Scryfall)" autocomplete="off" data-input="autocomplete" required>
        <datalist id="acList"></datalist>
        <input name="qty" type="number" min="1" value="1" title="Quantity">
        <select name="finish"><option value="nonfoil">Normal</option><option value="foil">Foil</option><option value="etched">Etched</option></select>
        <button class="btn">Add</button>
      </form>
      <div class="toolbar">
        <button class="btn ghost" data-action="copyWishlist" ${list.length ? '' : 'disabled'}>Copy list</button>
        <button class="btn ghost" data-action="exportCsv" data-what="wishlist" ${list.length ? '' : 'disabled'}>Export CSV</button>
        <div class="seg">
          <button data-action="wishView" data-view="grid" class="${ui.wishView === 'grid' ? 'active' : ''}">Images</button>
          <button data-action="wishView" data-view="list" class="${ui.wishView === 'list' ? 'active' : ''}">List</button>
        </div>
        <span class="muted small">Tip: on a deck's page, "Add missing to wishlist" adds everything you still need.</span>
      </div>`;

    if (!list.length) return header + '<div class="empty">Your wishlist is empty. Add cards above, drag them in from Scryfall, or use "Add missing to wishlist" on a deck.</div>';

    if (ui.wishView === 'grid') {
      return header + `<div class="grid">${sorted.map(({ w, i }) => {
        const c = cards[w.scryfallId] || {};
        return `<div class="tile-wrap" data-wi="${i}">
          <button class="tile ${w.finish !== 'nonfoil' ? 'is-foil' : ''}" data-action="card" data-id="${esc(w.scryfallId)}">
            ${c.image ? `<img src="${esc(c.image)}" alt="${esc(cardName(w))}" loading="lazy">` : `<div class="noimg">${esc(cardName(w))}</div>`}
            ${finishLabel(w.finish) ? `<span class="foil">${finishLabel(w.finish)}</span>` : ''}
            <span class="tile-price">${money(priceOf(w.scryfallId, w.finish))}</span>
          </button>
          <div class="counts">${wantStepper(i)}${haveNote(w)}</div>
          <div class="wish-actions">${actionsFor(i)}</div>
        </div>`;
      }).join('')}</div>`;
    }
    return header + `
      <table class="list">
        <thead><tr><th>Want</th><th>Name</th><th>Set</th><th></th><th class="num">Price</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${sorted.map(({ w, i }) => {
          const c = cards[w.scryfallId] || {};
          const p = priceOf(w.scryfallId, w.finish);
          return `<tr data-action="card" data-wi="${i}" data-id="${esc(w.scryfallId)}" data-preview="${esc(c.image || '')}">
            <td class="cnt">${wantStepper(i)}</td>
            <td>${esc(cardName(w))} ${finishLabel(w.finish) ? `<span class="pill">${finishLabel(w.finish)}</span>` : ''}<br>${haveNote(w)}</td>
            <td class="muted">${esc(c.setName || '')}</td><td class="manacol">${manaHtml(c.manaCost)}</td>
            <td class="num">${money(p)}</td><td class="num">${money(p == null ? null : p * w.qty)}</td>
            <td class="num">${actionsFor(i)}</td></tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  async function addWishByName(form) {
    const f = form.elements;
    const name = f.name.value.trim();
    if (!name) return;
    try {
      setStatus(`Looking up "${name}"…`);
      const c = (await Scryfall.named(name, false)) || (await Scryfall.named(name, true));
      if (!c) { setStatus(`Couldn't find a card called "${name}".`, 'warn'); return; }
      rememberCards([c]);
      const qty = Math.max(1, parseInt(f.qty.value, 10) || 1);
      addToWishlist(profile(), [{ scryfallId: c.id, name: c.name, finish: f.finish.value, qty }]);
      await saveNow();
      render();
      setStatus(`Added ${qty}× ${c.name} to your wishlist.`, 'ok');
      setTimeout(() => setStatus(''), 3000);
      const box = document.querySelector('[data-form="addWish"] input[name=name]');
      if (box) box.focus();
    } catch (err) {
      setStatus(`Couldn't reach Scryfall: ${err.message}`, 'error');
    }
  }

  function renderDeckList() {
    const prof = profile();
    const decks = prof.decks.slice().sort((a, b) => a.name.localeCompare(b.name));
    const head = `<div class="page-head"><h1>My decks</h1>
      <button class="btn" data-action="tab" data-tab="import">+ Import a deck</button></div>`;
    if (!decks.length) return head + `<div class="empty">No decks yet. Export a deck from Archidekt, then use <a href="#" data-action="tab" data-tab="import">Import</a> and choose "A new deck".</div>`;
    return head + `<div class="deck-grid">${decks.map(d => {
      const st = deckStatus(d, prof);
      const cover = d.cards.find(r => (r.categories || []).some(c => c.toLowerCase() === 'commander')) || d.cards[0];
      const c = cover && cards[cover.scryfallId];
      const pct = st.total ? Math.round(st.have / st.total * 100) : 0;
      return `<div class="deck-wrap">
        <button class="deck-del" data-action="deleteDeck" data-id="${esc(d.id)}" title="Delete this deck" aria-label="Delete ${esc(d.name)}">🗑</button>
        <button class="deck-card" data-action="openDeck" data-id="${esc(d.id)}">
        <div class="deck-art" style="${c && (c.art || c.image) ? `background-image:url('${esc(c.art || c.image)}')` : ''}"></div>
        <div class="deck-info">
          <h3>${esc(d.name)}${d.share && d.share.public ? ' <span class="pill" title="Anyone with the link can view it">Public</span>' : ''}</h3>
          <div class="muted small">${plural(st.total, 'card')} · ${money(rowsValue(d.cards.filter(r => r.inDeck)))}</div>
          <div class="bar"><span style="width:${pct}%"></span></div>
          <div class="small">${pct === 100 ? '<span class="ok">You own every card</span>'
            : `You own ${pct}%${st.proxies ? ` · ${st.proxies} ${st.proxies === 1 ? 'proxy' : 'proxies'}` : ''}${st.missing.length ? ` · missing ${st.total - st.have - st.proxies} (${money(st.missingCost)})` : ''}`}</div>
        </div>
      </button>
      </div>`;
    }).join('')}</div>`;
  }

  function renderDeck() {
    const prof = profile();
    const deck = prof.decks.find(d => d.id === ui.deckId);
    if (!deck) { ui.deckId = null; return renderDeckList(); }
    const compare = profile(ui.compareId);
    const st = deckStatus(deck, compare);
    const pct = st.total ? Math.round(st.have / st.total * 100) : 0;

    const groups = new Map();
    for (const r of deck.cards) {
      const cat = (r.categories && r.categories[0]) || 'Other';
      const board = (r.categories || []).find(c => /maybe|side/i.test(c)) || cat;
      const label = r.inDeck ? cat : `${board} (not in deck)`;
      if (!groups.has(label)) groups.set(label, { rows: [], inDeck: r.inDeck, cat: r.inDeck ? cat : board });
      groups.get(label).rows.push(r);
    }
    const order = [...groups.entries()].sort((a, b) => {
      if (a[1].inDeck !== b[1].inDeck) return a[1].inDeck ? -1 : 1;
      if (a[0] === 'Commander') return -1;
      if (b[0] === 'Commander') return 1;
      return a[0].localeCompare(b[0]);
    });

    // Order of selectable cards on screen, for Shift-click ranges and "Select all".
    ui.deckOrder = [];
    const marks = st.editable;

    const statusBadge = s => (s.missing ? `<span class="badge bad" title="Missing">✗ ${s.missing}</span>` : '')
      + (s.proxyUsed ? `<span class="badge proxy" title="Proxy">P ${s.proxyUsed}</span>` : '')
      + (s.ownUsed ? `<span class="badge ok" title="Official">✓ ${s.ownUsed}</span>` : '');

    const stepper = (i, field, label, n, title) => `
      <span class="stepper ${field}" title="${title}">${label}
        <button data-action="mark" data-i="${i}" data-field="${field}" data-delta="-1" aria-label="Less">−</button><b>${n}</b><button data-action="mark" data-i="${i}" data-field="${field}" data-delta="1" aria-label="More">+</button>
      </span>`;

    const deckPick = i => marks
      ? `<label class="pick" title="Select (Shift-click to select a range)"><input type="checkbox" data-dsel="${i}" ${ui.deckSel.has(i) ? 'checked' : ''}></label>` : '';

    const sections = order.map(([label, g]) => {
      let rows = g.rows.slice().sort((a, b) => cardName(a).localeCompare(cardName(b)));
      if (ui.onlyMissing) rows = rows.filter(r => r.inDeck && st.rowStatus(r).missing > 0);
      if (!rows.length) return '';
      const count = rows.reduce((s, r) => s + r.qty, 0);
      const head = `<h3>${esc(label)} <span class="muted">(${count})</span></h3>`;
      // Sections are drop targets: dragging a card here moves it into this category or board.
      const target = `data-cat="${esc(g.cat)}" data-indeck="${g.inDeck ? 1 : ''}"`;
      const moveBtn = i => `<button class="btn sm ghost move-btn" data-action="moveToDeck" data-i="${i}">Move to deck</button>`;

      if (ui.deckView === 'grid') {
        return `<section class="deck-section wide" ${target}>${head}<div class="grid ${ui.deckSel.size ? 'selecting' : ''}">${rows.map(r => {
          const i = deck.cards.indexOf(r);
          const c = cards[r.scryfallId] || {};
          const s = st.rowStatus(r);
          if (s) ui.deckOrder.push(i);
          return `<div class="tile-wrap ${ui.deckSel.has(i) ? 'selected' : ''} ${s && s.missing ? 'is-missing' : ''}" draggable="true" data-di="${i}">
            <button class="tile" data-action="card" data-id="${esc(r.scryfallId)}">
              ${c.image ? `<img src="${esc(c.image)}" alt="${esc(cardName(r))}" loading="lazy">` : `<div class="noimg">${esc(cardName(r))}</div>`}
              <span class="qty">${r.qty}×</span>
              ${finishLabel(r.finish) ? `<span class="foil">${finishLabel(r.finish)}</span>` : ''}
              ${s ? `<span class="badges">${statusBadge(s)}</span>` : ''}
            </button>
            ${s ? deckPick(i) : moveBtn(i)}
          </div>`;
        }).join('')}</div></section>`;
      }

      return `<section class="deck-section" ${target}>${head}
        <table class="list compact"><tbody>${rows.map(r => {
          const i = deck.cards.indexOf(r);
          const c = cards[r.scryfallId] || {};
          const s = st.rowStatus(r);
          if (s) ui.deckOrder.push(i);
          let status = '';
          if (s && marks) {
            status = stepper(i, 'owned', 'Official', s.own, 'Official copies in your collection')
              + stepper(i, 'proxy', 'Proxy', s.proxy, 'Proxies')
              + (s.missing ? `<span class="bad need">✗ ${s.missing}</span>` : '<span class="ok need">✓</span>');
          } else if (s) {
            status = s.missing ? `<span class="bad">✗ need ${s.missing}</span>` : `<span class="ok">✓ has ${s.own}</span>`;
          } else {
            status = moveBtn(i);
          }
          return `<tr data-action="card" data-id="${esc(r.scryfallId)}" data-preview="${esc(c.image || '')}" class="${ui.deckSel.has(i) ? 'selected' : ''}" draggable="true" data-di="${i}">
            <td class="pickcol">${s ? deckPick(i) : ''}</td>
            <td class="qtycol">${r.qty}</td><td>${esc(cardName(r))} ${finishLabel(r.finish) ? `<span class="pill">${finishLabel(r.finish)}</span>` : ''}</td>
            <td class="manacol">${manaHtml(c.manaCost)}</td>
            <td class="num">${money(priceOf(r.scryfallId, r.finish))}</td><td class="owncol">${status}</td></tr>`;
        }).join('')}</tbody></table></section>`;
    }).join('');

    const deckRows = deck.cards.filter(r => r.inDeck);
    return `
      <div class="page-head">
        <div><a href="#" data-action="closeDeck" class="back">← All decks</a><h1>${esc(deck.name)}</h1></div>
        <div class="stats">
          <div><b>${st.total}</b><span>cards</span></div>
          <div><b>${money(rowsValue(deckRows))}</b><span>value</span></div>
          <div><b>${pct}%</b><span>owned</span></div>
          ${st.proxies ? `<div><b>${st.proxies}</b><span>proxies</span></div>` : ''}
          <div><b>${money(st.missingCost)}</b><span>to finish</span></div>
        </div>
      </div>
      <div class="toolbar sim-bar">
        <span class="muted small">Simulator:</span>
        <button class="btn" data-action="simDeck" data-mode="play" title="Goldfish it: draw, play and attack on a virtual table">▶ Play</button>
        <button class="btn ghost" data-action="simDeck" data-mode="bot" title="Pick an opponent deck and play against the computer">Play vs computer</button>
        <button class="btn ghost" data-action="simDeck" data-mode="odds" title="Opening hands, land drops and draw odds">Odds</button>
      </div>
      <div class="toolbar">
        <label>Check against <select data-input="compare">
          ${state.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === compare.id ? 'selected' : ''}>${p.id === state.activeProfileId ? 'My collection' : `${esc(p.name)}'s collection`}</option>`).join('')}
        </select></label>
        <label class="check"><input type="checkbox" data-input="onlyMissing" ${ui.onlyMissing ? 'checked' : ''}> Only show cards I'm missing</label>
        <label class="check"><input type="checkbox" data-input="ignoreBasics" ${state.settings.ignoreBasics ? 'checked' : ''}> Count basic lands as owned</label>
        <div class="seg">
          <button data-action="deckView" data-view="grid" class="${ui.deckView === 'grid' ? 'active' : ''}">Images</button>
          <button data-action="deckView" data-view="list" class="${ui.deckView === 'list' ? 'active' : ''}">List</button>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn" data-action="copyMissing" ${st.missing.length ? '' : 'disabled'}>Copy missing list (${st.missing.length})</button>
        ${st.proxyList.length ? `<button class="btn ghost" data-action="copyProxies">Copy proxy list (${st.proxyList.length})</button>` : ''}
        <button class="btn ghost" data-action="missingToWishlist" ${st.missing.length ? '' : 'disabled'}>♥ Add missing to wishlist</button>
        <button class="btn ghost" data-action="deckToCollection">Add whole deck to collection</button>
        <button class="btn ghost" data-action="exportCsv" data-what="deck">Export CSV</button>
        <button class="btn ghost" data-action="renameDeck">Rename</button>
        <button class="btn danger" data-action="deleteDeck">Delete deck</button>
      </div>
      ${deckSharePanel(deck)}
      ${deckCheckPanel(deck)}
      ${simRecordPanel(deck)}
      ${marks ? deckSelectionBar() : `<p class="muted small">Showing ${esc(compare.name)}'s cards. Switch back to your own collection to mark cards as Official or Proxy.</p>`}
      <form class="add-card" data-form="addDeckCard">
        <input name="name" list="acList" placeholder="Add a card to this deck by name… (or drag one in from Scryfall)" autocomplete="off" data-input="autocomplete" required>
        <datalist id="acList"></datalist>
        <input name="qty" type="number" min="1" value="1" title="Quantity">
        <button class="btn">Add to deck</button>
      </form>
      <details class="panel"><summary>Deck value over time</summary>${Charts.line(valueSeries(deckRows), { height: 180 })}</details>
      <div class="deck-columns ${ui.deckView === 'grid' ? 'single' : ''}">${sections || '<div class="empty">Nothing missing. You have every card in this deck.</div>'}</div>`;
  }

  // The deck's format: the one picked on its page, or Commander when it has a Commander category.
  function deckFormat(deck) {
    if (deck.format != null && deck.format !== '') return deck.format;
    return deck.cards.some(r => r.inDeck && (r.categories || []).some(c => c.toLowerCase() === 'commander')) ? 'commander' : 'none';
  }

  function deckCheckPanel(deck) {
    const format = deckFormat(deck);
    const picker = `<label>Format <select data-input="deckFormat">
      ${Object.entries(DeckCheck.FORMATS).map(([k, f]) => `<option value="${k}" ${k === format ? 'selected' : ''}>${f.label}</option>`).join('')}
      <option value="none" ${format === 'none' ? 'selected' : ''}>No format (don't check)</option></select></label>`;
    if (format === 'none') return `<div class="toolbar">${picker}</div>`;
    const result = DeckCheck.run(format, deck.cards, r => cards[r.scryfallId] || null);
    if (result.pending) fetchCardInfo(deck.cards.map(r => r.scryfallId));
    const label = DeckCheck.FORMATS[format].label;
    const waiting = result.pending ? `<p class="muted small">Still getting legality info for ${plural(result.pending, 'card')} from Scryfall${navigator.onLine ? '…' : ' (needs internet)'}.</p>` : '';
    if (!result.issues.length) {
      return result.pending
        ? `<div class="panel deck-check"><div class="toolbar tight">${picker}<b class="muted">Checking ${esc(label)} rules…</b></div>${waiting}</div>`
        : `<div class="panel deck-check ok"><div class="toolbar tight">${picker}<b class="ok">✓ Legal for ${esc(label)}</b></div></div>`;
    }
    return `<div class="panel deck-check bad">
      <div class="toolbar tight">${picker}<b class="bad">✗ ${plural(result.issues.length, 'problem')} for ${esc(label)}</b></div>
      <ul>${result.issues.map(i => `<li>${esc(i.text)}${i.cards.length ? ` <span class="muted">${esc(i.cards.join(', '))}</span>` : ''}</li>`).join('')}</ul>
      ${waiting}
    </div>`;
  }

  // Cards saved before legality info was added get it from Scryfall once, in the background.
  const infoTried = new Set();
  async function fetchCardInfo(ids) {
    const need = [...new Set(ids)].filter(id => !infoTried.has(id) && !(cards[id] && cards[id].legalities && Object.keys(cards[id].legalities).length));
    if (!need.length || !navigator.onLine) return;
    need.forEach(id => infoTried.add(id));
    try {
      const { found } = await Scryfall.collection(need.map(id => ({ id })));
      rememberCards(found);
      save();
      render();
    } catch (err) {
      // Nothing to do: the panel keeps saying it's waiting, and the next price update fills it in.
    }
  }

  function deckSelectionBar() {
    const size = ui.deckSel.size;
    const order = ui.deckOrder || [];
    const all = order.length > 0 && order.every(i => ui.deckSel.has(i));
    return `
      <div class="selbar ${size ? 'active' : ''}" id="deckSelBar">
        <label class="check"><input type="checkbox" data-input="deckSelectAll" ${all ? 'checked' : ''}> Select all (${order.length})</label>
        ${size ? `<span><b>${size}</b> selected. Mark as:</span>
          <button class="btn sm" data-action="markSelected" data-mark="own">Official</button>
          <button class="btn sm proxy-btn" data-action="markSelected" data-mark="proxy">Proxy</button>
          <button class="btn sm danger" data-action="markSelected" data-mark="none">Neither</button>
          <span class="muted small">or</span>
          <button class="btn sm danger" data-action="removeFromDeck" title="Take these cards out of this deck. Your collection isn't changed.">Remove from deck</button>
          <button class="btn sm ghost" data-action="clearDeckSelection">Clear selection</button>`
        : '<span class="muted small">Tick cards to mark several as Official, Proxy or Neither at once. Shift-click to select a range.</span>'}
      </div>`;
  }

  function syncDeckSelection() {
    document.querySelectorAll('[data-dsel]').forEach(cb => {
      cb.checked = ui.deckSel.has(Number(cb.dataset.dsel));
      const holder = cb.closest('.tile-wrap, tr');
      if (holder) holder.classList.toggle('selected', cb.checked);
    });
    document.querySelectorAll('.deck-section .grid').forEach(g => g.classList.toggle('selecting', ui.deckSel.size > 0));
    const bar = $('#deckSelBar');
    if (bar) bar.outerHTML = deckSelectionBar();
  }

  function toggleDeckPick(cb, shift) {
    const order = ui.deckOrder || [];
    const i = Number(cb.dataset.dsel);
    const pos = order.indexOf(i);
    const lastPos = ui.lastDeckPick != null ? order.indexOf(ui.lastDeckPick) : -1;
    const range = shift && lastPos >= 0 ? order.slice(Math.min(pos, lastPos), Math.max(pos, lastPos) + 1) : [i];
    range.forEach(x => (cb.checked ? ui.deckSel.add(x) : ui.deckSel.delete(x)));
    ui.lastDeckPick = i;
    syncDeckSelection();
  }

  const currentDeck = () => profile().decks.find(d => d.id === ui.deckId);

  // Deck names are unique within your decks (ignoring capitals).
  const deckNameTaken = (prof, name, exceptId) =>
    prof.decks.some(d => d.id !== exceptId && d.name.trim().toLowerCase() === name.trim().toLowerCase());

  function renderPrices() {
    const prof = profile();
    const rows = prof.collection.filter(r => r.qty > 0);
    const last = state.settings.lastPriceRefresh;
    const series = valueSeries(rows);

    // Biggest changes: today vs about a week ago (or the oldest price we have).
    const target = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const movers = [];
    const seen = new Set();
    for (const r of rows) {
      const k = r.scryfallId + r.finish;
      if (seen.has(k)) continue;
      seen.add(k);
      const h = history[r.scryfallId];
      if (!h || h.length < 2) continue;
      let then = h[0];
      for (const s of h) { if (s.d <= target) then = s; else break; }
      const a = priceFrom(then, r.finish), b = priceOf(r.scryfallId, r.finish);
      if (a == null || b == null || a === b) continue;
      movers.push({ r, from: a, to: b, diff: b - a, since: then.d });
    }
    movers.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
    const top = rows.slice().sort((a, b) => (priceOf(b.scryfallId, b.finish) || 0) - (priceOf(a.scryfallId, a.finish) || 0)).slice(0, 15);

    const line = r => `data-action="card" data-id="${esc(r.scryfallId)}" data-preview="${esc((cards[r.scryfallId] || {}).image || '')}"`;
    return `
      <div class="page-head">
        <h1>Prices</h1>
        <div class="toolbar tight">
          <span class="muted small">Last updated: ${last ? new Date(last).toLocaleString() : 'never'}</span>
          <button class="btn" data-action="refreshPrices" ${ui.busy ? 'disabled' : ''}>Update prices now</button>
        </div>
      </div>
      <div class="panel">
        <h3>${esc(prof.name)}'s collection value: ${money(rowsValue(rows))}</h3>
        ${Charts.line(series)}
        <p class="muted small">Prices come from Scryfall (TCGplayer market prices, USD) and change once a day. The app saves them each day you open it, so the history grows over time.</p>
      </div>
      <div class="two-col">
        <div class="panel"><h3>Most valuable cards</h3>
          ${top.length ? `<table class="list compact"><tbody>${top.map(r => `<tr ${line(r)}>
            <td>${esc(cardName(r))} ${finishLabel(r.finish) ? `<span class="pill">${finishLabel(r.finish)}</span>` : ''}</td>
            <td class="num">${money(priceOf(r.scryfallId, r.finish))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No cards yet.</p>'}
        </div>
        <div class="panel"><h3>Biggest price changes</h3>
          ${movers.length ? `<table class="list compact"><tbody>${movers.slice(0, 15).map(m => `<tr ${line(m.r)}>
            <td>${esc(cardName(m.r))}</td><td class="num muted small">${money(m.from)} → ${money(m.to)}</td>
            <td class="num ${m.diff > 0 ? 'ok' : 'bad'}">${m.diff > 0 ? '+' : ''}${money(m.diff).replace('$-', '-$')}</td></tr>`).join('')}</tbody></table>`
            : '<p class="muted">No changes yet — check back after the app has saved prices on a few different days.</p>'}
        </div>
      </div>`;
  }

  function renderImport() {
    const prof = profile();
    return `
      <div class="page-head"><h1>Import cards</h1></div>
      ${renderArchidektPanel()}
      <details class="panel how" ${prof.collection.length || prof.decks.length ? '' : 'open'}>
        <summary>How to export from Archidekt</summary>
        <ol>
          <li>Go to <b>archidekt.com</b> and open your deck (or make a new one) and add your cards.</li>
          <li>Click <b>More</b>, then <b>Export deck</b>.</li>
          <li>Use these settings:
            <table class="settings-table">
              <tr><td>Select cards by</td><td>All cards</td></tr>
              <tr><td>Include out of deck cards (eg: maybeboard)</td><td>✅ Checked</td></tr>
              <tr><td>Export type</td><td>Text</td></tr>
              <tr><td>Export options</td><td><code>1x Example Card (set) 123 *F* [Example category] ^Buy,#0066ff^</code></td></tr>
              <tr><td>Sort by</td><td>Alphabet</td></tr>
              <tr><td>Section header</td><td>No section header</td></tr>
              <tr><td>Use front name only for MDFC cards</td><td>☐ Unchecked</td></tr>
            </table>
          </li>
          <li>Click <b>Download</b> and drop the file below — or click <b>Copy</b> and paste it in the box.</li>
        </ol>
      </details>
      <form class="panel" data-form="import">
        <div class="dropzone" id="dropzone">
          <b>Drop your Archidekt .txt file here</b> or <label class="linklike">choose a file<input type="file" accept=".txt,text/plain" id="fileInput" hidden></label>
          <div class="muted small" id="fileName"></div>
        </div>
        <textarea name="text" id="importText" rows="10" placeholder="…or paste the exported list here&#10;1x Sol Ring (cmm) 410 [Ramp]"></textarea>

        <fieldset>
          <legend>Where should these cards go?</legend>
          <label class="opt"><input type="radio" name="target" value="collection" ${ui.importTarget === 'newDeck' ? '' : 'checked'}> <b>My collection</b></label>
          <div class="sub">
            <label><input type="radio" name="mode" value="add" checked> Add to the cards I already have</label>
            <label><input type="radio" name="mode" value="replace"> Replace my whole collection with this list</label>
            <label><input type="checkbox" name="maybe" checked> Include maybeboard / out-of-deck cards</label>
          </div>
          <label class="opt"><input type="radio" name="target" value="newDeck" ${ui.importTarget === 'newDeck' ? 'checked' : ''}> <b>A new deck</b> named <input name="deckName" id="deckName" placeholder="Deck name"></label>
          <label class="opt"><input type="radio" name="target" value="updateDeck" ${prof.decks.length ? '' : 'disabled'}> <b>Update an existing deck</b> (replaces its card list)
            <select name="deckId">${prof.decks.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label>
          <div class="sub"><label><input type="checkbox" name="alsoCollection"> Also add the deck's cards to my collection</label></div>
        </fieldset>
        <button class="btn big" ${ui.busy ? 'disabled' : ''}>Import</button>
      </form>
      <div id="importResult"></div>`;
  }

  const archidektRelay = () => state.settings.archidektRelay || Archidekt.DEFAULT_RELAY;

  function renderArchidektPanel() {
    const relay = archidektRelay();
    return `
      <div class="panel">
        <h3>Load from Archidekt or Moxfield</h3>
        <p class="muted small">Paste an Archidekt or Moxfield deck link, or your Archidekt username to pick from your public decks. Click Load and it's saved as a deck right away (a deck with the same name gets updated).</p>
        <form class="toolbar tight" data-form="archidekt">
          <input name="q" class="grow" placeholder="https://archidekt.com/decks/123456/…  or  https://moxfield.com/decks/…  or  Archidekt username" value="${esc(state.settings.archidektUser || '')}" required>
          <button class="btn" id="archidektLoad" ${relay ? '' : 'disabled'}>Load</button>
        </form>
        <div id="archidektResult"></div>
        <details class="relay" ${relay ? '' : 'open'}>
          <summary>${Archidekt.DEFAULT_RELAY ? 'Advanced: use a different relay' : `Relay setup${relay ? '' : ' (needed once)'}`}</summary>
          <p class="muted small">Archidekt and Moxfield only let their own websites read their decks, so requests go through a small free relay you host on Cloudflare. The steps are in the README under "Loading decks straight from Archidekt or Moxfield". Then paste the relay's address here:</p>
          <input data-input="archidektRelay" class="grow" placeholder="https://archidekt-relay.yourname.workers.dev" value="${esc(state.settings.archidektRelay || '')}">
          ${Archidekt.DEFAULT_RELAY ? `<p class="muted small">Leave it empty to use the built-in relay.</p>` : ''}
        </details>
      </div>`;
  }

  const THEMES = [
    { id: 'orange', label: 'Burnt orange', color: '#e07a3c' },
    { id: 'yellow', label: 'Sunflower yellow', color: '#f2c94c' },
    { id: 'red', label: 'Fire engine red', color: '#e5675f' },
    { id: 'lavender', label: 'Lavender purple', color: '#b49be8' },
    { id: 'mint', label: 'Mint green', color: '#6fd9b0' },
    { id: 'blue', label: 'Royal blue', color: '#6b8cff' },
    { id: 'gray', label: 'Smoke gray', color: '#a8adb5' },
  ];
  function currentTheme() {
    try { return localStorage.getItem('mtg-accent') || 'orange'; } catch (e) { return 'orange'; }
  }

  function renderSettings() {
    const friends = state.profiles.filter(p => p.id !== state.activeProfileId);
    return `
      <div class="page-head"><h1>Account &amp; backup</h1></div>
      ${renderAccountPanel()}
      <div class="panel">
        <h3>Color theme</h3>
        <p class="muted small">Saved on this device, for both MTG Tracker and the Simulator.</p>
        <div class="toolbar tight">${THEMES.map(t => `<button class="btn ghost theme-btn ${t.id === currentTheme() ? 'active' : ''}" data-action="setTheme" data-id="${t.id}"><span class="swatch" style="background:${t.color}"></span>${t.label}</button>`).join('')}</div>
      </div>
      <div class="panel">
        <h3>Backup &amp; sharing</h3>
        <p class="muted small">${account
          ? 'Your data is saved to your account and in this browser. A downloaded backup is still a good extra copy.'
          : 'Your data is saved inside this browser on this computer. Clearing browser data deletes it, so download a backup now and then.'}</p>
        <div class="toolbar">
          <button class="btn" data-action="backupAll">Download backup (everything)</button>
          <button class="btn ghost" data-action="backupProfile">Share my collection</button>
        </div>
        <p class="muted small">To compare decks with a friend's cards: they click "Share my collection" and send you the file. You choose "Add a friend's collection" below. Their collection then shows up in a deck's "Check against" menu.</p>
        ${friends.length ? `<table class="list compact"><tbody>${friends.map(p => `<tr>
          <td>${esc(p.name)}'s collection</td>
          <td class="muted small">${plural(p.collection.reduce((s, r) => s + r.qty, 0), 'card')}</td>
          <td class="num"><button class="btn danger sm" data-action="removeFriend" data-id="${esc(p.id)}">Remove</button></td></tr>`).join('')}</tbody></table>` : ''}
        <div class="toolbar">
          <label class="btn ghost">Add a friend's collection<input type="file" accept=".json" data-input="restoreAdd" hidden></label>
          <label class="btn danger">Restore backup (replaces everything)<input type="file" accept=".json" data-input="restoreReplace" hidden></label>
        </div>
      </div>
      ${renderOfflinePanel()}`;
  }

  // ---------- card details popup ----------

  // The deck row the popup was opened from (on a deck page), whose printing "Choose printing" changes.
  function cardDeckRow() {
    if (!ui.cardCtx) return null;
    const deck = profile().decks.find(d => d.id === ui.cardCtx.deckId);
    return deck ? deck.cards[ui.cardCtx.index] || null : null;
  }

  // The wishlist entry the popup was opened from (on the wishlist), whose printing it can change.
  function cardWishRow() {
    const w = ui.cardCtx && ui.cardCtx.wish;
    return w && profile().wishlist.includes(w) ? w : null;
  }

  // Grid of every printing in the card popup. From a deck it picks the deck's printing;
  // From the wishlist it replaces the entry's printing or adds another one to the wishlist;
  // otherwise it adds collection copies in that printing, or moves an entry's copies there.
  function printingsHtml(c, deckRow, wishRow) {
    const pr = ui.prints;
    if (!pr || pr.name !== c.name) return '';
    let body;
    if (pr.error) body = `<p class="bad">Couldn't load printings: ${esc(pr.error)}</p>`;
    else if (!pr.list) body = '<p class="muted">Loading printings…</p>';
    else {
      const coll = profile().collection;
      const move = ui.printMove;
      body = `<div class="printings">${pr.list.map(p => {
        const mine = coll.filter(r => r.scryfallId === p.id).reduce((s, r) => s + r.qty + (r.proxyQty || 0), 0);
        const current = deckRow ? deckRow.scryfallId === p.id : wishRow ? wishRow.scryfallId === p.id : move ? move.id === p.id : p.id === c.id;
        const btn = (action, label, extra = '') => `<button class="btn sm ${extra}" data-action="${action}" data-pid="${esc(p.id)}" ${extra.includes('proxy') ? 'data-proxy="1"' : ''}>${label}</button>`;
        const buttons = deckRow ? (current ? '<span class="pill">in deck</span>' : btn('usePrinting', 'Use in deck'))
          : wishRow ? (current ? '<span class="pill">on wishlist</span>' : btn('wishReplacePrinting', 'Replace') + btn('wishAddPrinting', '+ Add to wishlist', 'ghost'))
          : move ? (current ? '<span class="pill">current</span>' : btn('movePrinting', 'Move here'))
          : btn('addPrinting', '+ Official') + btn('addPrinting', '+ Proxy', 'proxy-btn');
        // With one thing to do (use it in the deck, or move copies to it), the whole tile does it.
        const tileAction = current || wishRow ? '' : deckRow ? 'usePrinting' : move ? 'movePrinting' : '';
        return `<div class="print ${current ? 'current' : ''} ${tileAction ? 'pickable' : ''}" ${tileAction ? `data-action="${tileAction}" data-pid="${esc(p.id)}" title="Click to ${deckRow ? 'use this printing in the deck' : 'move your copies here'}"` : ''}>
          ${p.imageSmall ? `<img src="${esc(p.imageSmall)}" alt="${esc(p.setName)}" loading="lazy">` : `<div class="noimg">${esc(p.name)}</div>`}
          <div class="small"><b>${esc(String(p.set).toUpperCase())}</b> #${esc(p.cn)} · ${money(p.prices.usd ?? p.prices.usd_foil)}</div>
          <div class="muted small print-set">${esc(p.setName)}${mine ? ` · <b>own ${mine}</b>` : ''}</div>
          <div class="print-btns">${buttons}</div>
        </div>`;
      }).join('')}</div>`;
    }
    const head = deckRow ? 'Choose the printing for this deck'
      : wishRow ? 'Replace the printing on your wishlist, or add another printing to it'
      : ui.printMove ? `Move your ${finishLabel(ui.printMove.finish) || 'normal'} copies to another printing`
      : 'Add copies in other printings';
    return `<div class="printings-wrap" id="printings"><h4>${head}</h4>${body}</div>`;
  }

  function openCard(id) {
    const c = cards[id];
    if (!c) return;
    ui.modalId = id;
    const prof = profile();
    const deckRow = cardDeckRow();
    const wishRow = cardWishRow();
    const owned = prof.collection.filter(r => r.scryfallId === id);
    const decks = prof.decks.filter(d => d.cards.some(r => r.inDeck && nameKey(r) === c.name.toLowerCase())).map(d => d.name);
    const finish = (owned.find(r => r.qty) || { finish: 'nonfoil' }).finish;
    const series = (history[id] || []).map(s => ({ d: s.d, v: priceFrom(s, finish) })).filter(p => p.v != null);

    $('#modalBox').innerHTML = `
      <button class="close" data-action="closeModal" aria-label="Close">×</button>
      <div class="card-detail">
        <div class="card-imgs">
          ${c.imageLarge ? `<img src="${esc(c.imageLarge)}" alt="${esc(c.name)}">` : ''}
          ${c.backImage ? `<img src="${esc(c.backImage)}" alt="Back face">` : ''}
        </div>
        <div class="card-meta">
          <h2>${esc(c.name)}</h2>
          <div class="muted">${esc(c.typeLine)} ${c.manaCost ? '· ' + manaHtml(c.manaCost) : ''}</div>
          <div class="muted small">${esc(c.setName)} (${esc(String(c.set).toUpperCase())}) #${esc(c.cn)} · ${esc(c.rarity)}</div>
          <table class="list compact prices">
            <tr><td>Normal</td><td class="num">${money(c.prices.usd)}</td></tr>
            <tr><td>Foil</td><td class="num">${money(c.prices.usd_foil)}</td></tr>
            ${c.prices.usd_etched != null ? `<tr><td>Etched</td><td class="num">${money(c.prices.usd_etched)}</td></tr>` : ''}
          </table>
          <h4>Price history${finishLabel(finish) ? ' (' + finishLabel(finish) + ')' : ''}</h4>
          ${Charts.line(series, { height: 160 })}
          <h4>In ${esc(prof.name)}'s collection</h4>
          ${owned.length ? owned.map(r => `<div class="own-row">
              <span>${finishLabel(r.finish) || 'Normal'}</span>${countStepper(r, false)}${countStepper(r, true)}
              <button class="btn sm ghost" data-action="printings" data-id="${esc(id)}" data-move="${esc(r.finish)}">Change printing</button>
            </div>`).join('') : `<p class="muted">Not in collection.
              <button class="btn sm" data-action="qty" data-id="${esc(id)}" data-finish="nonfoil" data-delta="1">Add 1 official</button>
              <button class="btn sm proxy-btn" data-action="qty" data-id="${esc(id)}" data-finish="nonfoil" data-proxy="1" data-delta="1">Add 1 proxy</button></p>`}
          ${decks.length ? `<h4>Used in</h4><p>${esc(decks.join(', '))}</p>` : ''}
          <p>
            <button class="btn sm" data-action="printings" data-id="${esc(id)}">${deckRow ? 'Choose printing for this deck' : wishRow ? 'Change wishlist printing' : 'Other printings'}</button>
            <button class="btn sm ghost" data-action="wishAddCard" data-id="${esc(id)}">♥ Add to wishlist</button>
          </p>
          <p><a href="${esc(c.uri)}" target="_blank" rel="noopener">View on Scryfall ↗</a></p>
        </div>
      </div>
      ${printingsHtml(c, deckRow, wishRow)}`;
    $('#modal').hidden = false;
  }

  // ---------- actions ----------

  async function doImport(form) {
    const f = form.elements;
    const prof = profile();
    const text = f.text.value;
    const { entries, errors } = ArchidektParser.parse(text);
    const out = $('#importResult');
    if (!entries.length) {
      out.innerHTML = `<div class="panel bad">No cards found. Paste or drop an Archidekt text export (lines like <code>1x Sol Ring (cmm) 410</code>).</div>`;
      return;
    }
    const target = f.target.value;
    if (target === 'newDeck' && !f.deckName.value.trim()) {
      out.innerHTML = `<div class="panel bad">Give the new deck a name.</div>`;
      f.deckName.focus();
      return;
    }
    if (target === 'newDeck' && deckNameTaken(prof, f.deckName.value.trim())) {
      out.innerHTML = `<div class="panel bad">You already have a deck named "${esc(f.deckName.value.trim())}". Pick a different name, or choose "Update an existing deck" to replace its card list.</div>`;
      f.deckName.focus();
      return;
    }
    if (target === 'collection' && f.mode.value === 'replace' &&
      !confirm(`Replace ${prof.name}'s whole collection (${plural(prof.collection.length, 'entry')}) with this list?`)) return;

    ui.busy = true;
    form.querySelector('button.big').disabled = true;
    try {
      const { rows, missing } = await resolveEntries(entries);
      let summary;
      if (target === 'collection') {
        const use = f.maybe.checked ? rows : rows.filter(r => r.inDeck);
        if (f.mode.value === 'replace') prof.collection = [];
        addToCollection(prof, use);
        summary = `Added ${plural(use.reduce((s, r) => s + r.qty, 0), 'card')} to ${prof.name}'s collection.`;
      } else {
        const deckCards = rows.map(r => ({ scryfallId: r.scryfallId, name: r.name, qty: r.qty, finish: r.finish, categories: r.categories, inDeck: r.inDeck, tags: r.tags }));
        let deck;
        if (target === 'newDeck') {
          deck = { id: uid(), name: f.deckName.value.trim(), createdAt: Date.now(), cards: deckCards };
          giveDefaultShare(deck);
          prof.decks.push(deck);
        } else {
          deck = prof.decks.find(d => d.id === f.deckId.value);
          deck.cards = deckCards;
        }
        deck.updatedAt = Date.now();
        if (f.alsoCollection.checked) addToCollection(prof, rows.filter(r => r.inDeck));
        summary = `Saved deck "${deck.name}" (${plural(deckCards.reduce((s, r) => s + r.qty, 0), 'card')})${f.alsoCollection.checked ? ' and added it to your collection' : ''}.`;
        ui.deckId = deck.id;
      }
      await saveNow();
      setStatus(summary, 'ok');
      setTimeout(() => setStatus(''), 5000);
      const problems = [...missing.map(e => `${e.qty}x ${e.name}${e.set ? ` (${e.set}) ${e.cn || ''}` : ''}`), ...errors];
      ui.tab = target === 'collection' ? 'collection' : 'decks';
      render();
      if (problems.length) {
        alert(`${summary}\n\nThese lines couldn't be matched to a card and were skipped:\n\n${problems.slice(0, 40).join('\n')}${problems.length > 40 ? `\n…and ${problems.length - 40} more` : ''}`);
      }
    } catch (err) {
      setStatus('');
      out.innerHTML = `<div class="panel bad">Import failed: ${esc(err.message)}. Check your internet connection and try again.</div>`;
    } finally {
      ui.busy = false;
      const btn = form.querySelector('button.big');
      if (btn) btn.disabled = false;
    }
  }

  async function loadArchidekt(form) {
    const q = form.elements.q.value.trim();
    const out = $('#archidektResult');
    const mox = Moxfield.parseInput(q);
    const what = mox ? null : Archidekt.parseInput(q);
    if (!mox && !what) { out.innerHTML = `<p class="bad small">Paste a deck link like <code>https://archidekt.com/decks/123456/…</code> or <code>https://moxfield.com/decks/…</code>, or an Archidekt username.</p>`; return; }
    const btn = $('#archidektLoad');
    btn.disabled = true;
    try {
      if (mox) { out.innerHTML = ''; await loadLinkedDeck('Moxfield', () => Moxfield.fetchDeck(archidektRelay(), mox.deckId)); return; }
      if (what.deckId) { await loadArchidektDeck(what.deckId); return; }
      out.innerHTML = `<p class="muted small">Looking up ${esc(what.username)}'s decks…</p>`;
      const decks = await Archidekt.userDecks(archidektRelay(), what.username);
      state.settings.archidektUser = what.username;
      save();
      out.innerHTML = decks.length
        ? `<p class="muted small">${plural(decks.length, 'public deck')} by ${esc(what.username)}. Pick one:</p>
          <div class="archidekt-decks">${decks.map(d => `
            <button class="btn ghost sm" data-action="archidektDeck" data-id="${esc(d.id)}">${esc(d.name)} <span class="muted">· ${esc(d.size)} cards</span></button>`).join('')}</div>`
        : `<p class="bad small">No public decks found for "${esc(what.username)}". Check the spelling, and that the decks aren't set to private on Archidekt.</p>`;
    } catch (err) {
      out.innerHTML = `<p class="bad small">${esc(err.message)}.</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  async function loadArchidektDeck(id) {
    $('#archidektResult').querySelectorAll('[data-action=archidektDeck]').forEach(b => b.classList.toggle('active', b.dataset.id === String(id)));
    await loadLinkedDeck('Archidekt', () => Archidekt.fetchDeck(archidektRelay(), id));
  }

  // source: 'Archidekt' | 'Moxfield'; fetchDeck() resolves to { name, text } in export format.
  async function loadLinkedDeck(source, fetchDeck) {
    const out = $('#archidektResult');
    setStatus(`Loading deck from ${source}…`);
    try {
      const deck = await fetchDeck();
      setStatus('');
      ui.importTarget = 'newDeck';
      document.querySelector('input[name=target][value=newDeck]').checked = true;
      $('#deckName').value = '';
      fillImport(deck.text, deck.name, `Loaded "${deck.name}" from ${source}`);
      // Save it straight away: as a new deck, or over the deck with the same name.
      $('input[name=alsoCollection]').checked = false;
      await doImport($('form[data-form=import]'));
    } catch (err) {
      setStatus('');
      out.insertAdjacentHTML('beforeend', `<p class="bad small">${esc(err.message)}.</p>`);
    }
  }

  async function addCardByName(form) {
    const f = form.elements;
    const name = f.name.value.trim();
    if (!name) return;
    try {
      setStatus(`Looking up "${name}"…`);
      const c = (await Scryfall.named(name, false)) || (await Scryfall.named(name, true));
      if (!c) { setStatus(`Couldn't find a card called "${name}".`, 'warn'); return; }
      rememberCards([c]);
      const qty = Math.max(1, parseInt(f.qty.value, 10) || 1);
      addToCollection(profile(), [{ scryfallId: c.id, name: c.name, finish: f.finish.value, qty, proxy: f.proxy.checked }]);
      await saveNow();
      setStatus(`Added ${qty}× ${c.name}${f.proxy.checked ? ' (proxy)' : ''}.`, 'ok');
      setTimeout(() => setStatus(''), 3000);
      render();
    } catch (err) {
      setStatus(`Couldn't reach Scryfall: ${err.message}`, 'error');
    }
  }

  // The profiles plus the card info and price history they use. Also what's saved to an account.
  function backupObject(profiles) {
    const ids = new Set();
    profiles.forEach(p => {
      p.collection.forEach(r => ids.add(r.scryfallId));
      p.decks.forEach(d => d.cards.forEach(r => ids.add(r.scryfallId)));
      (p.wishlist || []).forEach(r => ids.add(r.scryfallId));
    });
    const pick = obj => Object.fromEntries([...ids].filter(id => obj[id]).map(id => [id, obj[id]]));
    return { app: 'mtg-tracker', version: 1, profiles, cards: pick(cards), history: pick(history) };
  }

  function backupData(profiles) {
    return JSON.stringify({ ...backupObject(profiles), exportedAt: new Date().toISOString() });
  }

  function mergeHistory(id, incoming) {
    const byDate = new Map((history[id] || []).map(s => [s.d, s]));
    incoming.forEach(s => { if (!byDate.has(s.d)) byDate.set(s.d, s); });
    history[id] = [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
  }

  async function restore(file, replace) {
    let data;
    try {
      data = Backup.parse(await file.text());
    } catch (e) {
      alert("That file isn't an MTG Tracker backup.");
      return;
    }
    if (replace) {
      if (!confirm('This replaces your collection, decks and wishlist on this computer with the backup. Continue?')) return;
      state.profiles = data.profiles;
      state.activeProfileId = data.profiles[0].id;
      cards = data.cards || {};
      history = data.history || {};
    } else {
      for (const p of data.profiles) {
        let name = p.name;
        let n = 2;
        while (state.profiles.some(x => x.name === name)) name = `${p.name} (${n++})`;
        state.profiles.push({ ...p, id: uid(), name });
      }
      for (const [id, c] of Object.entries(data.cards || {})) {
        if (!cards[id] || (c.updatedAt || 0) > (cards[id].updatedAt || 0)) cards[id] = c;
      }
      for (const [id, h] of Object.entries(data.history || {})) mergeHistory(id, h);
    }
    migrateProxies(state.profiles);
    state.profiles.forEach(p => { if (!p.wishlist) p.wishlist = []; });
    await saveNow();
    setStatus(replace ? 'Backup restored.' : `Added ${data.profiles.map(p => `${p.name}'s collection`).join(', ')}.`, 'ok');
    setTimeout(() => setStatus(''), 4000);
    render();
  }

  const actions = {
    back: () => window.history.back(),
    simDeck: el => openInSimulator(ui.deckId, el.dataset.mode),
    archidektDeck: el => loadArchidektDeck(el.dataset.id),
    tab: el => {
      // Coming from the Decks tab, importing most likely means adding a deck.
      if (el.dataset.tab === 'import') ui.importTarget = ui.tab === 'decks' ? 'newDeck' : 'collection';
      ui.tab = el.dataset.tab;
      if (ui.tab === 'decks') ui.deckId = null;
      render();
    },
    view: el => { ui.view = el.dataset.view; render(); },
    ownFilter: el => { ui.ownFilter = el.dataset.filter; ui.limit = PAGE_SIZE; ui.lastPick = null; render(); },
    more: () => { ui.limit += PAGE_SIZE; render(); },
    card: el => {
      // Opened from a deck: "Choose printing" changes that deck row, not the collection.
      const di = el.closest('[data-di]');
      const wi = el.closest('[data-wi]');
      ui.cardCtx = ui.tab === 'decks' && ui.deckId && di ? { deckId: ui.deckId, index: Number(di.dataset.di) }
        : ui.tab === 'wishlist' && wi ? { wish: profile().wishlist[Number(wi.dataset.wi)] } : null;
      ui.prints = null;
      ui.printMove = null;
      openCard(el.dataset.id);
    },
    printings: async el => {
      const c = cards[el.dataset.id];
      if (!c) return;
      ui.printMove = el.dataset.move ? { id: c.id, finish: el.dataset.move } : null;
      const load = !ui.prints || ui.prints.name !== c.name || ui.prints.error;
      if (load) ui.prints = { name: c.name, list: null };
      openCard(c.id);
      $('#printings').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!load) return;
      const pr = ui.prints;
      try { pr.list = await Scryfall.prints(c); } catch (e) { pr.error = e.message; }
      if (ui.prints === pr && !$('#modal').hidden && cards[ui.modalId]) openCard(ui.modalId);
    },
    usePrinting: el => {
      const p = ui.prints && ui.prints.list.find(x => x.id === el.dataset.pid);
      const row = cardDeckRow();
      if (!p || !row) return;
      rememberCards([p]);
      row.scryfallId = p.id;
      row.name = p.name;
      save();
      render();
      openCard(p.id);
    },
    // Wishlist: this entry becomes the other printing (joining an entry already in that printing).
    wishReplacePrinting: el => {
      const p = ui.prints && ui.prints.list.find(x => x.id === el.dataset.pid);
      const w = cardWishRow();
      if (!p || !w) return;
      rememberCards([p]);
      const prof = profile();
      const same = prof.wishlist.find(x => x !== w && x.scryfallId === p.id && x.finish === w.finish);
      if (same) {
        same.qty += w.qty;
        prof.wishlist = prof.wishlist.filter(x => x !== w);
        ui.cardCtx = { wish: same };
      } else {
        Object.assign(w, { scryfallId: p.id, name: p.name });
      }
      save();
      render();
      openCard(p.id);
      setStatus(`Your wishlist now has ${p.name} from ${String(p.set).toUpperCase()} #${p.cn}.`, 'ok');
      setTimeout(() => setStatus(''), 3000);
    },
    // Wishlist: 1 copy of the other printing is added as well; the entry stays as it was.
    wishAddPrinting: el => {
      const p = ui.prints && ui.prints.list.find(x => x.id === el.dataset.pid);
      const w = cardWishRow();
      if (!p || !w) return;
      rememberCards([p]);
      addToWishlist(profile(), [{ scryfallId: p.id, name: p.name, finish: w.finish, qty: 1 }]);
      save();
      render();
      openCard(ui.modalId);
      setStatus(`Added 1 ${p.name} (${String(p.set).toUpperCase()} #${p.cn}) to your wishlist.`, 'ok');
      setTimeout(() => setStatus(''), 3000);
    },
    addPrinting: el => {
      const p = ui.prints && ui.prints.list.find(x => x.id === el.dataset.pid);
      if (!p) return;
      rememberCards([p]);
      const prof = profile();
      const proxy = !!el.dataset.proxy;
      const finish = p.prices.usd == null && p.prices.usd_foil != null ? 'foil' : 'nonfoil';
      const row = prof.collection.find(r => r.scryfallId === p.id && r.finish === finish);
      if (row) row[proxy ? 'proxyQty' : 'qty'] += 1;
      else prof.collection.push({ scryfallId: p.id, name: p.name, finish, qty: proxy ? 0 : 1, proxyQty: proxy ? 1 : 0, addedAt: Date.now() });
      save();
      render();
      openCard(ui.modalId);
      setStatus(`Added 1 ${proxy ? 'proxy' : 'official'} ${p.name} (${String(p.set).toUpperCase()} #${p.cn}).`, 'ok');
      setTimeout(() => setStatus(''), 3000);
    },
    movePrinting: el => {
      const p = ui.prints && ui.prints.list.find(x => x.id === el.dataset.pid);
      const move = ui.printMove;
      if (!p || !move) return;
      const prof = profile();
      const row = prof.collection.find(r => r.scryfallId === move.id && r.finish === move.finish);
      if (!row) return;
      rememberCards([p]);
      const target = prof.collection.find(r => r.scryfallId === p.id && r.finish === move.finish);
      if (target) {
        target.qty += row.qty;
        target.proxyQty = (target.proxyQty || 0) + (row.proxyQty || 0);
        prof.collection = prof.collection.filter(r => r !== row);
      } else {
        Object.assign(row, { scryfallId: p.id, name: p.name });
      }
      ui.printMove = null;
      ui.selected.clear();
      save();
      render();
      openCard(p.id);
    },
    closeModal: () => { $('#modal').hidden = true; },
    deckView: el => { ui.deckView = el.dataset.view; render(); },
    wishView: el => { ui.wishView = el.dataset.view; render(); },
    wishQty: el => {
      const prof = profile();
      const w = prof.wishlist[Number(el.dataset.i)];
      if (!w) return;
      w.qty += Number(el.dataset.delta);
      if (w.qty <= 0) prof.wishlist = prof.wishlist.filter(x => x !== w);
      save();
      render();
    },
    wishRemove: el => {
      const prof = profile();
      const w = prof.wishlist[Number(el.dataset.i)];
      if (!w) return;
      prof.wishlist = prof.wishlist.filter(x => x !== w);
      save();
      render();
      setStatus(`Removed ${cardName(w)} from your wishlist.`, 'ok');
      setTimeout(() => setStatus(''), 3000);
    },
    // Bought it: the copies move into the collection as official cards.
    wishGot: el => {
      const prof = profile();
      const w = prof.wishlist[Number(el.dataset.i)];
      if (!w) return;
      addToCollection(prof, [{ scryfallId: w.scryfallId, name: cardName(w), finish: w.finish, qty: w.qty }]);
      prof.wishlist = prof.wishlist.filter(x => x !== w);
      save();
      render();
      setStatus(`Moved ${w.qty}× ${cardName(w)} into your collection.`, 'ok');
      setTimeout(() => setStatus(''), 3000);
    },
    wishAddCard: el => {
      const c = cards[el.dataset.id];
      addToWishlist(profile(), [{ scryfallId: c.id, name: c.name, finish: 'nonfoil', qty: 1 }]);
      save();
      setStatus(`Added ${c.name} to your wishlist.`, 'ok');
      setTimeout(() => setStatus(''), 3000);
    },
    exportCsv: el => exportCsv(el.dataset.what),
    saveImages: () => saveImagesOffline(),
    filterColor: el => {
      const k = el.dataset.color;
      const f = ui.filters;
      f.colors = f.colors.includes(k) ? f.colors.filter(x => x !== k)
        : k === 'C' ? ['C'] : [...f.colors.filter(x => x !== 'C'), k]; // colorless can't mix with colors
      ui.limit = PAGE_SIZE;
      ui.lastPick = null;
      render();
    },
    clearFilters: () => {
      ui.filters = { colors: [], type: '', cmc: '', rarity: '' };
      ui.limit = PAGE_SIZE;
      ui.lastPick = null;
      render();
    },
    copyWishlist: async () => {
      const list = profile().wishlist;
      await copyText(list.map(w => `${w.qty}x ${cardName(w)}`).join('\n'));
      setStatus(`Copied ${plural(list.length, 'card')}. You can paste this into TCGplayer's Mass Entry or a message.`, 'ok');
      setTimeout(() => setStatus(''), 4000);
    },
    // Puts the deck's missing cards on the wishlist, only topping up what isn't already there.
    missingToWishlist: () => {
      const prof = profile();
      const deck = currentDeck();
      const st = deckStatus(deck, prof);
      let added = 0;
      for (const m of st.missing) {
        const k = m.name.toLowerCase();
        const already = prof.wishlist.filter(w => nameKey(w) === k).reduce((s, w) => s + w.qty, 0);
        const need = m.qty - already;
        if (need <= 0) continue;
        const row = deck.cards.find(r => r.inDeck && nameKey(r) === k);
        addToWishlist(prof, [{ scryfallId: row.scryfallId, name: m.name, finish: 'nonfoil', qty: need }]);
        added += need;
      }
      save();
      setStatus(added ? `Added ${plural(added, 'card')} to your wishlist.` : 'Everything missing is already on your wishlist.', added ? 'ok' : 'warn');
      setTimeout(() => setStatus(''), 4000);
    },
    moveToDeck: el => moveDeckCard(currentDeck(), Number(el.dataset.i), true),
    clearDeckSelection: () => { ui.deckSel.clear(); ui.lastDeckPick = null; syncDeckSelection(); },
    // Own/Proxy +/− on a deck card: adds or removes a real or proxy copy in the collection.
    mark: el => {
      const prof = profile();
      const r = currentDeck().cards[Number(el.dataset.i)];
      const proxy = el.dataset.field === 'proxy';
      if (Number(el.dataset.delta) > 0) {
        addToCollection(prof, [{ scryfallId: r.scryfallId, name: cardName(r), finish: proxy ? 'nonfoil' : r.finish, qty: 1, proxy }]);
      } else {
        removeFromCollection(prof, nameKey(r), proxy, 1, r.scryfallId);
      }
      save();
      render();
    },
    markSelected: el => {
      const prof = profile();
      const deck = currentDeck();
      const st = deckStatus(deck, prof);
      const picked = new Map();
      ui.deckSel.forEach(i => { const r = deck.cards[i]; if (r && r.inDeck && !picked.has(nameKey(r))) picked.set(nameKey(r), r); });
      const mark = el.dataset.mark;
      let changed = 0;
      if (mark === 'none') {
        const copies = [...picked.keys()].reduce((s, k) => s + st.byName.get(k).own + st.byName.get(k).proxy, 0);
        if (copies && !confirm(`Remove ${plural(copies, 'copy').replace('copys', 'copies')} (official and proxy) of ${plural(picked.size, 'card')} from ${prof.name}'s collection?`)) return;
        for (const [k, r] of picked) {
          changed += removeFromCollection(prof, k, false, Infinity, r.scryfallId);
          changed += removeFromCollection(prof, k, true, Infinity, r.scryfallId);
        }
      } else {
        const proxy = mark === 'proxy';
        for (const [k, r] of picked) {
          const s = st.byName.get(k);
          const gap = proxy ? s.need - s.ownUsed - s.proxy : s.need - s.own;
          if (gap > 0) {
            addToCollection(prof, [{ scryfallId: r.scryfallId, name: cardName(r), finish: proxy ? 'nonfoil' : r.finish, qty: gap, proxy }]);
            changed += gap;
          }
        }
      }
      ui.deckSel.clear();
      ui.lastDeckPick = null;
      save();
      render();
      const what = mark === 'none' ? `Removed ${changed} ${changed === 1 ? 'copy' : 'copies'} from` : `Added ${changed} ${mark === 'proxy' ? (changed === 1 ? 'proxy' : 'proxies') : (changed === 1 ? 'official copy' : 'official copies')} to`;
      setStatus(changed ? `${what} ${prof.name}'s collection.` : 'Nothing to change. Those cards were already marked that way.', changed ? 'ok' : 'warn');
      setTimeout(() => setStatus(''), 4000);
    },
    copyProxies: async () => {
      const st = deckStatus(currentDeck(), profile(ui.compareId));
      await copyText(st.proxyList.map(m => `${m.qty}x ${m.name}`).join('\n'));
      setStatus(`Copied ${plural(st.proxyList.length, 'card')} you're using proxies for.`, 'ok');
      setTimeout(() => setStatus(''), 4000);
    },
    clearSelection: () => { ui.selected.clear(); ui.lastPick = null; syncSelection(); },
    removeSelected: () => {
      const prof = profile();
      const removed = prof.collection.filter(r => ui.selected.has(rowKey(r)));
      if (!removed.length) return;
      const copies = removed.reduce((s, r) => s + r.qty, 0);
      prof.collection = prof.collection.filter(r => !ui.selected.has(rowKey(r)));
      ui.undo = { profileId: prof.id, rows: removed };
      ui.selected.clear();
      ui.lastPick = null;
      save();
      render();
      setStatus(`Removed ${plural(removed.length, 'card')} (${copies} ${copies === 1 ? 'copy' : 'copies'}) from ${prof.name}'s collection.`, 'undo');
    },
    removeFromDeck: () => {
      const deck = currentDeck();
      if (!deck || !ui.deckSel.size) return;
      const removed = deck.cards.filter((r, i) => ui.deckSel.has(i));
      const copies = removed.reduce((s, r) => s + r.qty, 0);
      ui.undo = { profileId: profile().id, deckId: deck.id, deckCards: deck.cards.slice() };
      deck.cards = deck.cards.filter((r, i) => !ui.deckSel.has(i));
      deck.updatedAt = Date.now();
      ui.deckSel.clear();
      ui.lastDeckPick = null;
      save();
      render();
      setStatus(`Removed ${plural(removed.length, 'card')} (${copies} ${copies === 1 ? 'copy' : 'copies'}) from ${deck.name}. Your collection wasn't changed.`, 'undo');
    },
    undoRemove: () => {
      if (!ui.undo) return;
      const prof = profile(ui.undo.profileId);
      const deck = ui.undo.deckId && prof.decks.find(d => d.id === ui.undo.deckId);
      if (deck) {
        deck.cards = ui.undo.deckCards;
        deck.updatedAt = Date.now();
      } else if (ui.undo.rows) {
        addToCollection(prof, ui.undo.rows);
      }
      ui.undo = null;
      save();
      render();
      setStatus('Cards put back.', 'ok');
      setTimeout(() => setStatus(''), 3000);
    },
    openDeck: el => { ui.deckId = el.dataset.id; ui.compareId = state.activeProfileId; ui.deckSel.clear(); ui.lastDeckPick = null; render(); window.scrollTo(0, 0); },
    closeDeck: () => { ui.deckId = null; ui.deckSel.clear(); render(); },
    refreshPrices: () => refreshPrices(false),
    copyMissing: async () => {
      const deck = profile().decks.find(d => d.id === ui.deckId);
      const st = deckStatus(deck, profile(ui.compareId));
      await copyText(st.missing.map(m => `${m.qty}x ${m.name}`).join('\n'));
      setStatus(`Copied ${plural(st.missing.length, 'card')} — you can paste this into Archidekt, TCGplayer or a message.`, 'ok');
      setTimeout(() => setStatus(''), 4000);
    },
    deckToCollection: () => {
      const deck = profile().decks.find(d => d.id === ui.deckId);
      if (!confirm(`Add all ${plural(deck.cards.filter(r => r.inDeck).reduce((s, r) => s + r.qty, 0), 'card')} from "${deck.name}" to your collection?`)) return;
      addToCollection(profile(), deck.cards.filter(r => r.inDeck));
      save();
      render();
    },
    renameDeck: () => {
      const deck = currentDeck();
      const name = (prompt('Deck name', deck.name) || '').trim();
      if (!name || name === deck.name) return;
      if (deckNameTaken(profile(), name, deck.id)) { alert(`You already have a deck named "${name}". Pick a different name.`); return; }
      deck.name = name;
      save();
      render();
    },
    // Works from inside a deck, or from the trash button on the deck list (data-id).
    deleteDeck: el => {
      const prof = profile();
      const deck = prof.decks.find(d => d.id === (el.dataset.id || ui.deckId));
      if (!deck) return;
      if (!confirm(`Delete the deck "${deck.name}"? Your collection isn't affected.`)) return;
      prof.decks = prof.decks.filter(d => d !== deck);
      ui.deckId = null;
      save();
      render();
    },
    // Official/Proxy − and + on a collection card (tile, list row or card popup).
    qty: el => {
      const prof = profile();
      const { id, finish } = el.dataset;
      const proxy = !!el.dataset.proxy;
      const delta = Number(el.dataset.delta);
      const row = prof.collection.find(r => r.scryfallId === id && r.finish === finish);
      if (!row) {
        if (delta > 0) addToCollection(prof, [{ scryfallId: id, name: cards[id].name, finish, qty: delta, proxy }]);
      } else {
        const field = proxy ? 'proxyQty' : 'qty';
        row[field] = Math.max(0, (row[field] || 0) + delta);
        dropEmpty(prof);
      }
      save();
      render();
      if (!$('#modal').hidden) openCard(id);
    },
    removeFriend: el => {
      const p = profile(el.dataset.id);
      if (p.id === state.activeProfileId || !confirm(`Remove ${p.name}'s collection from this device?`)) return;
      state.profiles = state.profiles.filter(x => x !== p);
      if (ui.compareId === p.id) ui.compareId = state.activeProfileId;
      save();
      render();
    },
    setTheme: el => {
      try { localStorage.setItem('mtg-accent', el.dataset.id); } catch (e) {}
      document.documentElement.dataset.accent = el.dataset.id;
      render();
    },
    backupAll: () => {
      download(`mtg-tracker-backup-${today()}.json`, backupData(state.profiles));
      state.settings.lastBackup = Date.now();
      save();
      renderBackupNote();
    },
    snoozeBackup: () => {
      state.settings.backupSnoozed = Date.now();
      save();
      renderBackupNote();
    },
    accountForm: el => {
      ui.accountForm = ui.accountForm === el.dataset.formKind ? null : el.dataset.formKind;
      render();
      const email = document.querySelector('.account-form input[name=email]');
      if (email) email.focus();
    },
    logOut: () => logOut(),
    syncNow: () => { if (hasLocalChanges()) push(); else pull(); },
    syncUseAccount: async () => {
      const c = ui.syncChoice;
      ui.syncChoice = null;
      renderSyncNote();
      await applyCloud(c.res);
    },
    syncKeepDevice: () => {
      const c = ui.syncChoice;
      ui.syncChoice = null;
      renderSyncNote();
      account.rev = c.res.rev;
      account.hash = null;
      push();
    },
    deckPrivacy: el => {
      const deck = currentDeck();
      if (!deck || !account) return;
      const pub = !!el.dataset.public;
      if (deck.share && deck.share.public === pub) return;
      deck.share = { id: deck.share ? deck.share.id : newShareId(), public: pub };
      save();
      render();
      shareNow(pub ? 'Public: anyone with the link can view this deck.' : 'Private: the link only opens for you, logged in.');
    },
    newDeckPrivacy: el => {
      state.settings.newDeckPublic = !!el.dataset.public;
      save();
      render();
    },
    copyDeckLink: async () => {
      const deck = currentDeck();
      if (!deck || !account) return;
      if (!deck.share) { deck.share = { id: newShareId(), public: false }; save(); }
      await copyText(shareUrl(deck));
      shareNow(deck.share.public
        ? 'Link copied. Anyone with it can view this deck.'
        : 'Link copied. It only opens for you while logged in. Switch the deck to Public to share it.');
    },
    saveSharedDeck: () => {
      const s = ui.shared;
      if (!s || !s.deck) return;
      const prof = profile();
      let name = s.deck.name;
      for (let n = 2; deckNameTaken(prof, name); n++) name = `${s.deck.name} (${n})`;
      const copy = { ...s.deck, id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), cards: s.deck.cards.map(r => ({ ...r })) };
      delete copy.share;
      giveDefaultShare(copy);
      prof.decks.push(copy);
      save();
      ui.tab = 'decks';
      ui.deckId = copy.id;
      ui.compareId = state.activeProfileId;
      render();
      setStatus(`Saved "${name}" to your decks.`, 'ok');
      setTimeout(() => setStatus(''), 4000);
    },
    backupProfile: () => download(`mtg-tracker-${fileSafe(profile().name)}-${today()}.json`, backupData([profile()])),
  };

  // ---------- events ----------

  function bindEvents() {
    // Save right away when the app is closed or you switch to the Simulator, so nothing is lost
    // and the Simulator sees your latest decks.
    const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } };
    window.addEventListener('pagehide', flush);
    // (The Simulator tab saves first too: showSimulator.)
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        flush();
        if (pushTimer) push(); // upload now: a phone may not run the app again for a while
      } else if (account) {
        // Back to the app: pick up anything saved on another device in the meantime.
        if (saveTimer) await saveNow();
        if (hasLocalChanges()) push(); else pull();
      }
    });
    window.addEventListener('online', () => { if (account) { if (hasLocalChanges()) push(); else pull(); } });

    window.addEventListener('popstate', e => {
      navDepth = (e.state && e.state.depth) || 0;
      readNav();
      render();
      window.scrollTo(0, 0);
    });

    document.addEventListener('click', e => {
      if (e.target.id === 'modal') { $('#modal').hidden = true; return; }
      // Checkboxes on cards: select instead of opening the card.
      if (e.target.closest('.pick')) {
        if (e.target.matches('[data-select]')) togglePick(e.target, e.shiftKey);
        else if (e.target.matches('[data-dsel]')) toggleDeckPick(e.target, e.shiftKey);
        return;
      }
      const el = e.target.closest('[data-action], #tabs button');
      if (!el) return;
      if (el.matches('#tabs button')) { actions.tab(el); return; }
      if (appMode && ui.tab === 'collection' && el.dataset.action === 'card') {
        const holder = el.closest('.tile-wrap, tr');
        const cb = holder && holder.querySelector('[data-select]');
        if (cb) { e.preventDefault(); tapToSelect(cb, el); return; }
      }
      const fn = actions[el.dataset.action];
      if (fn) { e.preventDefault(); fn(el); }
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').hidden = true; });

    let acTimer;
    document.addEventListener('input', e => {
      const kind = e.target.dataset.input;
      if (kind === 'search') {
        ui.search = e.target.value;
        ui.lastPick = null;
        ui.limit = PAGE_SIZE;
        const pos = e.target.selectionStart;
        render();
        const box = document.querySelector('[data-input="search"]');
        box.focus();
        box.setSelectionRange(pos, pos);
      } else if (kind === 'autocomplete') {
        clearTimeout(acTimer);
        const q = e.target.value.trim();
        if (q.length < 2) return;
        acTimer = setTimeout(async () => {
          const names = await Scryfall.autocomplete(q).catch(() => []);
          const list = $('#acList');
          if (list) list.innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
        }, 250);
      }
    });

    document.addEventListener('change', e => {
      const kind = e.target.dataset.input;
      if (kind === 'sort') { ui.sort = e.target.value; ui.lastPick = null; render(); }
      else if (kind === 'filterType' || kind === 'filterCmc' || kind === 'filterRarity') {
        ui.filters[{ filterType: 'type', filterCmc: 'cmc', filterRarity: 'rarity' }[kind]] = e.target.value;
        ui.limit = PAGE_SIZE;
        ui.lastPick = null;
        render();
      }
      else if (kind === 'deckFormat') {
        const deck = currentDeck();
        if (deck) { deck.format = e.target.value; save(); render(); }
      }
      else if (kind === 'deckSelectAll') {
        (ui.deckOrder || []).forEach(i => (e.target.checked ? ui.deckSel.add(i) : ui.deckSel.delete(i)));
        ui.lastDeckPick = null;
        syncDeckSelection();
      }
      else if (kind === 'selectAll') {
        const shown = shownCollection();
        if (e.target.checked) shown.forEach(r => ui.selected.add(rowKey(r)));
        else shown.forEach(r => ui.selected.delete(rowKey(r)));
        ui.lastPick = null;
        syncSelection();
      }
      else if (kind === 'compare') { ui.compareId = e.target.value; render(); }
      else if (kind === 'onlyMissing') { ui.onlyMissing = e.target.checked; render(); }
      else if (kind === 'archidektRelay') {
        state.settings.archidektRelay = e.target.value.trim();
        save();
        $('#archidektLoad').disabled = !archidektRelay();
      }
      else if (kind === 'ignoreBasics') { state.settings.ignoreBasics = e.target.checked; save(); render(); }
      else if (kind === 'restoreAdd' || kind === 'restoreReplace') {
        const file = e.target.files[0];
        if (file) restore(file, kind === 'restoreReplace');
        e.target.value = '';
      } else if (e.target.id === 'fileInput' && e.target.files[0]) {
        loadImportFile(e.target.files[0]);
      }
    });

    document.addEventListener('submit', e => {
      const kind = e.target.dataset.form;
      if (!kind) return;
      e.preventDefault();
      if (kind === 'import') doImport(e.target);
      else if (kind === 'archidekt') loadArchidekt(e.target);
      else if (kind === 'addCard') addCardByName(e.target);
      else if (kind === 'addDeckCard') addDeckCardByName(e.target);
      else if (kind === 'addWish') addWishByName(e.target);
      else if (kind === 'login' || kind === 'register') logIn(e.target, kind === 'register');
      else if (kind === 'changePassword') changePassword(e.target);
    });

    // Dropping a file anywhere: load it into the import box.
    const hint = $('#dropHint');
    window.addEventListener('dragover', e => {
      e.preventDefault();
      if (ui.internalDrag) return;
      const dz = $('#dropzone');
      if (dz) dz.classList.add('over');
      const isFile = [...e.dataTransfer.types].includes('Files') && !e.dataTransfer.types.includes('text/uri-list');
      const deck = ui.tab === 'decks' && ui.deckId ? currentDeck() : null;
      hint.textContent = isFile ? 'Drop your Archidekt .txt file to import it'
        : `Drop a Scryfall card to add it to ${deck ? `"${deck.name}"` : `your ${ui.tab === 'wishlist' ? 'wishlist' : 'collection'}`}`;
      hint.hidden = false;
    });
    window.addEventListener('dragleave', e => {
      if (e.relatedTarget) return;
      const dz = $('#dropzone');
      if (dz) dz.classList.remove('over');
      hint.hidden = true;
    });
    window.addEventListener('drop', () => { hint.hidden = true; }, true);
    // Drags that start inside the app: moving a deck card between sections, otherwise ignored.
    const clearDropTargets = () => document.querySelectorAll('.drop-target').forEach(s => s.classList.remove('drop-target'));
    document.addEventListener('dragstart', e => {
      ui.internalDrag = true;
      const item = e.target.closest && e.target.closest('[data-di]');
      ui.dragDeckIndex = item ? Number(item.dataset.di) : null;
      if (item) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'mtg-tracker-deck-card');
      }
    });
    document.addEventListener('dragend', () => { ui.internalDrag = false; ui.dragDeckIndex = null; clearDropTargets(); });
    document.addEventListener('dragover', e => {
      if (ui.dragDeckIndex == null) return;
      const section = e.target.closest && e.target.closest('.deck-section[data-cat]');
      clearDropTargets();
      if (section) section.classList.add('drop-target');
    });

    window.addEventListener('drop', e => {
      e.preventDefault();
      if (ui.dragDeckIndex != null) {
        const section = e.target.closest && e.target.closest('.deck-section[data-cat]');
        const i = ui.dragDeckIndex;
        ui.dragDeckIndex = null;
        clearDropTargets();
        if (section) moveDeckCard(currentDeck(), i, !!section.dataset.indeck, section.dataset.cat);
        return;
      }
      if (ui.internalDrag) return;
      const dt = e.dataTransfer;
      // A card dragged from scryfall.com: check its link before treating it as a file.
      const dropped = ['text/uri-list', 'text/html', 'text/plain'].map(t => dt.getData(t)).join('\n');
      if (/scryfall\.(io|com)/i.test(dropped)) { addDroppedCard(dropped); return; }
      const file = dt.files[0];
      if (!file) return;
      if (ui.tab !== 'import') {
        ui.importTarget = ui.tab === 'decks' ? 'newDeck' : 'collection';
        ui.tab = 'import';
        render();
      }
      loadImportFile(file);
    });

    // Card image preview when hovering list rows.
    const preview = $('#hoverPreview');
    document.addEventListener('mouseover', e => {
      const row = e.target.closest('[data-preview]');
      if (row && row.dataset.preview) { preview.src = row.dataset.preview; preview.hidden = false; }
      else preview.hidden = true;
    });
    document.addEventListener('mousemove', e => {
      if (preview.hidden) return;
      const w = 250, h = 349;
      const x = e.clientX + 24 + w > window.innerWidth ? e.clientX - w - 24 : e.clientX + 24;
      const y = Math.min(e.clientY - 40, window.innerHeight - h - 8);
      preview.style.left = x + 'px';
      preview.style.top = Math.max(8, y) + 'px';
    });
  }

  // Main card type, used as the deck category for cards dropped into a deck.
  function typeCategory(c) {
    const front = (c.typeLine || '').split('//')[0];
    return ['Creature', 'Planeswalker', 'Battle', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment']
      .find(t => front.includes(t)) || 'Other';
  }

  // Moves a deck card into the main deck (under a category) or out to a board like Maybeboard.
  function moveDeckCard(deck, i, toDeck, category) {
    const r = deck.cards[i];
    if (!r) return;
    if (r.inDeck === toDeck && (!category || (r.categories || [])[0] === category)) return;
    if (toDeck) {
      const cat = category || (r.categories || []).find(c => !/maybe|side/i.test(c)) || typeCategory(cards[r.scryfallId] || {});
      const same = deck.cards.find(x => x !== r && x.inDeck && x.scryfallId === r.scryfallId && x.finish === r.finish && (x.categories || [])[0] === cat);
      if (same) {
        same.qty += r.qty;
        deck.cards.splice(i, 1);
      } else {
        r.inDeck = true;
        r.categories = [cat];
      }
    } else {
      r.inDeck = false;
      r.categories = [category || 'Maybeboard'];
    }
    deck.updatedAt = Date.now();
    ui.deckSel.clear();
    ui.lastDeckPick = null;
    save();
    render();
    setStatus(`Moved ${cardName(r)} to ${toDeck ? `the deck${category ? ` (${category})` : ''}` : category || 'Maybeboard'}.`, 'ok');
    setTimeout(() => setStatus(''), 3000);
  }

  // Adds copies of a Scryfall card to a deck, filed under its main card type.
  function addCardToDeck(deck, c, qty) {
    const row = deck.cards.find(r => r.inDeck && r.scryfallId === c.id && r.finish === 'nonfoil');
    if (row) row.qty += qty;
    else deck.cards.push({ scryfallId: c.id, name: c.name, qty, finish: 'nonfoil', categories: [typeCategory(c)], inDeck: true, tags: [] });
    deck.updatedAt = Date.now();
  }

  async function addDeckCardByName(form) {
    const f = form.elements;
    const name = f.name.value.trim();
    const deck = currentDeck();
    if (!name || !deck) return;
    try {
      setStatus(`Looking up "${name}"…`);
      const c = (await Scryfall.named(name, false)) || (await Scryfall.named(name, true));
      if (!c) { setStatus(`Couldn't find a card called "${name}".`, 'warn'); return; }
      rememberCards([c]);
      const qty = Math.max(1, parseInt(f.qty.value, 10) || 1);
      addCardToDeck(deck, c, qty);
      await saveNow();
      render();
      setStatus(`Added ${qty}× ${c.name} to "${deck.name}".`, 'ok');
      setTimeout(() => setStatus(''), 3000);
      const box = document.querySelector('[data-form="addDeckCard"] input[name=name]');
      if (box) box.focus();
    } catch (err) {
      setStatus(`Couldn't reach Scryfall: ${err.message}`, 'error');
    }
  }

  // A card dragged in from Scryfall: adds 1 copy to the open deck, the wishlist, or the collection.
  async function addDroppedCard(text) {
    const prof = profile();
    const deck = ui.tab === 'decks' && ui.deckId ? currentDeck() : null;
    try {
      setStatus('Looking up the card you dropped…');
      const c = await Scryfall.fromDrop(text);
      if (!c) { setStatus("Couldn't tell which card that was. Try dragging the card's picture from its Scryfall page.", 'warn'); return; }
      rememberCards([c]);
      if (deck) {
        addCardToDeck(deck, c, 1);
      } else if (ui.tab === 'wishlist') {
        addToWishlist(prof, [{ scryfallId: c.id, name: c.name, finish: 'nonfoil', qty: 1 }]);
      } else {
        addToCollection(prof, [{ scryfallId: c.id, name: c.name, finish: 'nonfoil', qty: 1 }]);
      }
      await saveNow();
      render();
      const where = deck ? `"${deck.name}"` : ui.tab === 'wishlist' ? `${prof.name}'s wishlist` : `${prof.name}'s collection`;
      setStatus(`Added ${c.name} (${c.set.toUpperCase()}) to ${where}.`, 'ok');
      setTimeout(() => setStatus(''), 4000);
    } catch (err) {
      setStatus(`Couldn't reach Scryfall: ${err.message}`, 'error');
    }
  }

  async function loadImportFile(file) {
    const dz = $('#dropzone');
    if (dz) dz.classList.remove('over');
    if (file.type.startsWith('image/')) {
      alert("Importing from card photos isn't supported yet. Export the deck from Archidekt as text and drop that file instead.");
      return;
    }
    const text = await file.text();
    fillImport(text, file.name.replace(/\.[^.]+$/, '').replace(/[-_]\d{8,}.*$/, '').replace(/_/g, ' ').trim(), `Loaded ${file.name}`);
  }

  // Put a card list in the import box, suggest a deck name, and spot decks you already have.
  function fillImport(text, suggestedName, label) {
    $('#importText').value = text;
    $('#fileName').textContent = `${label} (${plural(ArchidektParser.parse(text).entries.length, 'line')})`;
    const deckName = $('#deckName');
    if (deckName && !deckName.value) deckName.value = suggestedName;
    // Same name as a deck you already have: update that deck instead of making a copy.
    const existing = deckName && profile().decks.find(d => d.name.trim().toLowerCase() === deckName.value.trim().toLowerCase());
    if (existing && ui.importTarget === 'newDeck') {
      document.querySelector('input[name=target][value=updateDeck]').checked = true;
      document.querySelector('select[name=deckId]').value = existing.id;
      $('#fileName').textContent += ` · You already have "${existing.name}", so this will update it.`;
    }
  }

  // ---------- start ----------

  // ---------- offline + install (see sw.js) ----------

  // Service workers need a web address, so a double-clicked index.html works as before, online only.
  const canWorkOffline = () => 'serviceWorker' in navigator && 'caches' in window && location.protocol.startsWith('http');
  const OFFLINE_NOTE = "You're offline. Your cards and decks still work; prices and card lookups need internet.";

  function setUpOffline() {
    if (canWorkOffline()) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!navigator.onLine) setStatus(OFFLINE_NOTE, 'warn');
    window.addEventListener('offline', () => setStatus(OFFLINE_NOTE, 'warn'));
    window.addEventListener('online', () => setStatus(''));
  }

  function offlineImageUrls() {
    const ids = new Set(allScryfallIds());
    const urls = new Set();
    ids.forEach(id => {
      const c = cards[id];
      if (c && c.image) urls.add(c.image);
      if (c && c.art) urls.add(c.art);
    });
    return [...urls];
  }

  // Downloads every card picture into the same store the service worker reads from.
  // The progress text is kept in offlineMsg so it survives the page redrawing meanwhile.
  let offlineMsg = '';
  let savingImages = false;
  function showOfflineMsg(msg) {
    offlineMsg = msg;
    const el = $('#offlineProgress');
    if (el) el.textContent = msg;
  }

  async function saveImagesOffline() {
    if (savingImages) return;
    savingImages = true;
    document.querySelectorAll('[data-action="saveImages"]').forEach(b => { b.disabled = true; });
    try {
      const cache = await caches.open('mtg-images');
      const have = new Set((await cache.keys()).map(r => r.url));
      const todo = offlineImageUrls().filter(u => !have.has(u));
      const total = todo.length;
      let done = 0;
      let failed = 0;
      const next = async () => {
        while (todo.length) {
          const url = todo.pop();
          try {
            const res = await fetch(url, { mode: 'cors' });
            if (res.ok) await cache.put(url, res);
            else failed++;
          } catch (err) {
            failed++;
          }
          done++;
          showOfflineMsg(`Saving pictures… ${done.toLocaleString()} of ${total.toLocaleString()}`);
        }
      };
      await Promise.all([next(), next(), next(), next()]);
      showOfflineMsg(failed ? `Saved, but ${plural(failed, 'picture')} couldn't be downloaded. Try again later.` : 'All card pictures are saved for offline use.');
    } catch (err) {
      showOfflineMsg(`Couldn't save pictures: ${err.message}`);
    } finally {
      savingImages = false;
      document.querySelectorAll('[data-action="saveImages"]').forEach(b => { b.disabled = false; });
    }
  }

  function renderOfflinePanel() {
    if (!canWorkOffline()) {
      return `<div class="panel"><h3>Use offline</h3><p class="muted small">Open the app from its web address (not the downloaded file) to install it and use it without internet.</p></div>`;
    }
    return `
      <div class="panel">
        <h3>Use offline &amp; install</h3>
        <p class="muted small">This app works without internet: your collection, decks, wishlist and the Simulator all open offline. Prices, adding new cards and loading decks need internet.
          To add it to your home screen: on iPhone, tap Share → Add to Home Screen; on Android or a computer, use the browser menu → Install app.</p>
        <p class="muted small">Card pictures are saved the first time you see them. To have every picture ready before you go offline (about ${Math.max(1, Math.round(offlineImageUrls().length * 0.08))} MB):</p>
        <div class="toolbar tight">
          <button class="btn ghost" data-action="saveImages" ${savingImages ? 'disabled' : ''}>Save card images for offline</button>
          <span id="offlineProgress" class="muted small">${esc(offlineMsg)}</span>
        </div>
      </div>`;
  }

  // ---------- Simulator results ----------

  // Games finished in the Simulator, from its own database (read only; the Simulator saves them).
  // [{ at, deckKey: 'tracker:<profile id>:<deck id>', result: 'win' | 'loss' | 'draw', opponents, mode, turns, why }]
  let simResults = [];
  function loadSimResults() {
    let req;
    try { req = indexedDB.open('mtg-simulator'); } catch (e) { return; }
    req.onupgradeneeded = () => req.transaction.abort(); // no Simulator data yet: don't create its database
    req.onerror = () => {};
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); return; }
      const get = db.transaction('kv', 'readonly').objectStore('kv').get('results');
      get.onsuccess = () => {
        const list = Array.isArray(get.result) ? get.result : [];
        const changed = list.length !== simResults.length;
        simResults = list;
        db.close();
        if (changed && ui.tab === 'decks' && ui.deckId) render();
      };
      get.onerror = () => db.close();
    };
  }

  // The deck's record from Simulator games, with its latest games.
  function simRecordPanel(deck) {
    const key = `tracker:${profile().id}:${deck.id}`;
    const games = simResults.filter(r => r.deckKey === key);
    if (!games.length) return '';
    const n = k => games.filter(g => g.result === k).length;
    const [w, l, d] = [n('win'), n('loss'), n('draw')];
    const when = at => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const label = { win: 'Won', loss: 'Lost', draw: 'Draw' };
    return `<details class="panel"><summary>Simulator record: <b>${w}–${l}${d ? `–${d}` : ''}</b> (${Math.round(w / games.length * 100)}% won)</summary>
      <table class="list compact"><tbody>${games.slice(-10).reverse().map(g => `<tr>
        <td>${esc(when(g.at))}</td><td class="${g.result === 'win' ? 'ok' : g.result === 'loss' ? 'bad' : ''}">${label[g.result] || esc(g.result)}</td>
        <td>${esc((g.opponents || []).join(', ') || (g.mode === 'solo' ? 'alone' : ''))}</td>
        <td class="muted">${g.turns ? `turn ${g.turns}` : ''}${g.why ? ` · ${esc(g.why)}` : ''}</td></tr>`).join('')}</tbody></table>
      ${games.length > 10 ? `<p class="muted small">The latest 10 of ${games.length} games.</p>` : ''}
    </details>`;
  }

  async function start() {
    try {
      await load();
    } catch (err) {
      $('#view').innerHTML = `<div class="panel bad">This browser blocked local storage, so the app can't save. Try opening index.html in Chrome or Edge. (${esc(err.message)})</div>`;
      return;
    }
    bindEvents();
    navDepth = (window.history.state && window.history.state.depth) || 0;
    readNav();
    window.history.replaceState({ depth: navDepth }, '', navHash());
    try { account = (await Store.get('account')) || null; } catch (e) {}
    render();
    Store.persist();
    setUpOffline();
    loadSimResults();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSimResults(); }); // back from the Simulator
    if (account) pull();
    if (navigator.onLine && Date.now() - (state.settings.lastPriceRefresh || 0) > PRICE_REFRESH_MS) refreshPrices(true);
  }

  start();
})();
