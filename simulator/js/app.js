/*
 * MTG Simulator screens: pick a deck (from MTG Tracker or a pasted list), play it on a
 * table, and see draw odds. Game rules live in game.js; this file draws the screen and
 * turns clicks, drags and keys into game actions.
 */
(() => {
  'use strict';
  const Store = KVStore('mtg-simulator');

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = p => (p >= 0.995 && p < 1 ? '>99' : p > 0 && p < 0.005 ? '<1' : Math.round(p * 100)) + '%';

  const view = $('#view');
  const modal = $('#modal');
  const modalBox = $('#modalBox');
  const menu = $('#menu');
  const ghost = $('#ghost');

  // Opened from the home-screen icon. On a touchscreen there, cards use hold / tap / double tap
  // (see touchTap) instead of hover, click and right-click.
  const appMode = window.matchMedia('(display-mode: standalone)').matches;
  document.documentElement.classList.toggle('app', appMode);
  // Inside MTG Tracker's Simulator tab (a frame): its own name and "◂ MTG Tracker" link are hidden.
  const embedded = window.parent !== window;
  document.documentElement.classList.toggle('embedded', embedded);
  const zoom = document.createElement('div');
  zoom.className = 'zoom';
  zoom.hidden = true;
  document.body.appendChild(zoom);
  // Shows a card big. It closes when you let go, or with the × (or a tap) if the phone missed that.
  function showZoom(html) {
    zoom.innerHTML = `<button class="zoom-close" aria-label="Close">×</button><div class="zoom-box">${html}</div>`;
    zoom.hidden = false;
  }
  zoom.addEventListener('click', () => { zoom.hidden = true; });

  let tracker = null; // { profiles, cards, activeProfileId, source }
  let local = { decks: [], cards: {} };
  let ui = { tab: 'decks', oddsDeck: null, oddsOnDraw: false, oddsCategory: '', oddsPicked: [], cardW: 92, autoTap: false, recentCounters: [] };
  let game = null;
  // Saved games, newest first: [{ id, deckName, deckKey, turn, life, createdAt, updatedAt,
  //   online: { role, code, myId, activePid, players: [names] } | null }]. Each game's table is stored as 'game:<id>'.
  let games = [];
  // Finished games, newest last: [{ at, deckKey, deckName, mode, opponents, result: 'win' | 'loss' | 'draw', turns, why }].
  // Saved under 'results'; MTG Tracker reads them to show each deck's record (it never writes them).
  let results = [];
  let gameId = null; // which saved game `game` is
  let undoStack = [];
  let viewer = null; // { zone, top: n|null, ids (the cards looked at, for top n), filter, shuffleOnClose }
  let hoverIid = null;
  let sample = null; // { deckKey, order, shown }

  // Online play (see online.js)
  let peers = {}; // pid -> { board, offset, cards: { iid: card } }  what the other players have out
  let peerDefs = {}; // card info other players sent, by Scryfall id
  let sentDefs = new Set(); // card ids already sent to the other players
  let chat = []; // { at, from, msg }, newest first
  let activePid = null; // whose turn it is
  let inLobby = false; // online, before the host starts the game
  let remoteLife = 0; // total life change other players have made to you (kept through Undo)
  let hoverOpp = null;

  // ---------- data ----------

  const def = id => (id && (local.cards[id] || (tracker && tracker.cards[id]) || peerDefs[id])) || null;

  function trackerProfile() {
    if (!tracker) return null;
    return tracker.profiles.find(p => p.id === tracker.activeProfileId) || tracker.profiles[0];
  }

  function allDecks() {
    const out = [];
    const prof = trackerProfile();
    if (prof) for (const d of prof.decks || []) out.push(TrackerLink.toDeck(d, prof));
    out.push(...local.decks);
    return out;
  }

  function findDeck(key) {
    if (!key) return null;
    const found = allDecks().find(d => d.key === key);
    if (found) return found;
    if (tracker && key.startsWith('tracker:')) {
      const [, pid, did] = key.split(':');
      const prof = tracker.profiles.find(p => p.id === pid);
      const deck = prof && (prof.decks || []).find(d => d.id === did);
      if (deck) return TrackerLink.toDeck(deck, prof);
    }
    return null;
  }

  async function connectTracker(quiet) {
    try {
      const t = await TrackerLink.fromBrowser();
      if (t) tracker = t;
      else if (!quiet) status('No MTG Tracker data found in this browser. Load a Tracker backup file instead.', 'warn');
    } catch (e) {
      if (!quiet) status('Could not read MTG Tracker data: ' + e.message, 'error');
    }
    renderLinkState();
  }

  async function saveLocal() {
    await Store.set('decks', local.decks);
    await Store.set('cards', local.cards);
  }

  let saveTimer;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  // Also runs when the app is closed or hidden, so the last move is never lost.
  function saveNow() {
    clearTimeout(saveTimer);
    saveGame();
    Store.set('ui', { oddsDeck: ui.oddsDeck, oddsOnDraw: ui.oddsOnDraw, cardW: ui.cardW, autoTap: ui.autoTap, upkeepOff: ui.upkeepOff, recentCounters: ui.recentCounters, playerName: ui.playerName, botYou: ui.botYou, botOpp: ui.botOpp, botFirst: ui.botFirst, onlineDeck: ui.onlineDeck, hostCode: ui.hostCode, joinCode: ui.joinCode, gameId });
  }

  const gameMeta = () => games.find(g => g.id === gameId) || null;
  const newGameId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // The online game this saved game belongs to is the one you're connected to now.
  const linkedOnline = m => !!(m && m.online && Online.active() && Online.code() === m.online.code);

  // Saves the current game and its line in the games list.
  function saveGame() {
    if (!game || !gameId) return;
    let m = gameMeta();
    if (!m) {
      m = { id: gameId, createdAt: Date.now(), online: null };
      games.unshift(m);
    }
    Object.assign(m, { deckName: game.deckName, deckKey: game.deckKey, turn: game.turn, life: game.life, vsBot: game.bot ? game.bot.s.deckName : null, updatedAt: Date.now() });
    if (linkedOnline(m)) {
      const names = Online.players().filter(p => p.pid !== Online.id()).map(p => p.name);
      Object.assign(m.online, { role: Online.role(), myId: Online.id(), activePid, players: names.length ? names : m.online.players || [] });
    }
    Store.set('game:' + gameId, game);
    Store.set('games', games);
  }

  // Puts a new game on the table: a new saved game, or (replace) in place of the current one.
  function useNewGame(g, replace) {
    if (!replace || !gameId) {
      saveGame();
      gameId = newGameId();
      games.unshift({ id: gameId, createdAt: Date.now(), online: null });
    }
    game = g;
    const m = gameMeta();
    if (Online.active() && Online.code()) m.online = Object.assign(m.online || {}, { role: Online.role(), code: Online.code() });
  }

  // Switches to another saved game. Your connection to a different online game is closed first.
  async function resumeGame(id) {
    if (id === gameId && game) return setTab('play');
    const m = games.find(g => g.id === id);
    if (!m) return;
    if (Online.active() && !linkedOnline(m)) {
      if (!confirm(`Switching games disconnects you from online game ${Online.code()}. That game stays saved, and you can reconnect to it later.`)) return;
      Online.leave();
      chat = [];
    }
    saveGame();
    let g = null;
    try { g = await Store.get('game:' + id); } catch (e) { /* handled below */ }
    if (!g) {
      games = games.filter(x => x !== m);
      Store.set('games', games);
      status('That saved game couldn\'t be found.', 'error');
      return renderDecks();
    }
    game = g;
    gameId = id;
    undoStack = [];
    viewer = null;
    sample = null;
    remoteLife = 0;
    inLobby = false;
    activePid = linkedOnline(m) ? activePid : (m.online && m.online.activePid) || null;
    saveNow();
    setTab('play');
    upgradeSavedGame();
    if (m.online && !Online.active()) status(`This is online game ${m.online.code}. Click Reconnect (top right) to play with the others again.`, 'info', true);
  }

  async function deleteGame(id) {
    const m = games.find(g => g.id === id);
    if (!m || !confirm(`Delete the saved game with ${m.deckName} (turn ${m.turn})? It can't be undone.`)) return;
    games = games.filter(g => g !== m);
    Store.set('game:' + id, null);
    if (id === gameId) {
      game = null;
      gameId = null;
      undoStack = [];
      syncSoon();
    }
    saveNow();
    renderDecks();
  }

  // Reconnects the current saved game to its online game: the host opens the same game code again,
  // everyone else joins it.
  async function reconnectGame() {
    const m = gameMeta();
    if (!m || !m.online) return;
    const was = m.online.code;
    ui.playerName = ui.playerName || 'Player';
    try {
      if (m.online.role === 'host') await Online.host(ui.playerName, was);
      else await Online.join(was, ui.playerName, m.online.myId);
    } catch (e) {
      return status(e.message, 'error');
    }
    if (!Online.active()) return refreshOnline();
    if (Online.code() !== was) {
      m.online.code = Online.code();
      status(`Game code ${was} was still in use, so this game now has the code ${Online.code()}. Send it to the others so they can reconnect.`, 'warn', true);
    } else if (m.online.role === 'host') {
      status(`Game ${was} is open again. The others can click Reconnect on their saved game.`, 'ok');
    }
    inLobby = false;
    saveNow();
    sendPick();
    syncSoon();
    setTab('play');
  }

  // Makes sure every card in the deck has card info (images, types). Fetches any that are missing.
  async function ensureDefs(ids, full) {
    const missing = [...new Set(ids)].filter(id => id && (!def(id) || (full && !Array.isArray(def(id).producedMana))));
    if (!missing.length) return;
    status(`Getting card info from Scryfall (${missing.length} cards)…`);
    const { found } = await Scryfall.collection(missing.map(id => ({ id })));
    found.forEach(c => { local.cards[c.id] = c; });
    await saveLocal();
    hideStatus();
  }

  // ---------- status / modal / menu ----------

  let statusTimer;
  // sticky: true keeps it up until replaced or closed; a number is how long to show it (ms).
  function status(msg, kind = 'info', sticky) {
    const el = $('#status');
    el.className = 'status ' + kind;
    el.innerHTML = `<span>${esc(msg)}</span><button class="status-x" type="button" title="Close" aria-label="Close">×</button>`;
    el.querySelector('.status-x').onclick = hideStatus;
    el.hidden = false;
    clearTimeout(statusTimer);
    if (typeof sticky === 'number') statusTimer = setTimeout(hideStatus, sticky);
    else if (!sticky && kind !== 'info-sticky') statusTimer = setTimeout(hideStatus, kind === 'error' ? 9000 : 4500);
  }
  function hideStatus() { clearTimeout(statusTimer); $('#status').hidden = true; }

  function openModal(html) {
    modalBox.innerHTML = html;
    modal.hidden = false;
  }
  function closeModal() {
    document.body.classList.remove('peek');
    afterDiscard = null;
    const wasSearching = viewer && viewer.shuffleOnClose;
    viewer = null;
    modal.hidden = true;
    modalBox.innerHTML = '';
    if (wasSearching && game) act(() => Game.shuffle(game));
  }

  function ask(title, value, type = 'number') {
    return new Promise(resolve => {
      openModal(`<form class="ask" id="askForm"><h3>${esc(title)}</h3>
        <input name="v" type="${type}" value="${esc(value)}" ${type === 'number' ? 'min="0"' : ''} autofocus>
        <div class="toolbar end"><button type="button" class="btn ghost" data-ask="cancel">Cancel</button><button class="btn">OK</button></div></form>`);
      const form = $('#askForm');
      const input = form.v;
      input.focus();
      input.select();
      const done = v => { modal.hidden = true; modalBox.innerHTML = ''; resolve(v); };
      form.onsubmit = e => { e.preventDefault(); done(type === 'number' ? Number(input.value) : input.value); };
      form.querySelector('[data-ask=cancel]').onclick = () => done(null);
    });
  }

  function showMenu(x, y, items) {
    menu.innerHTML = items.map((it, i) => it.sep
      ? '<div class="sep"></div>'
      : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</button>`).join('');
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    menu.onclick = e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      hideMenu();
      items[Number(b.dataset.i)].action();
    };
  }
  function hideMenu() { menu.hidden = true; }

  // ---------- game actions (with undo) ----------

  function act(fn) {
    if (!game) return;
    delete game.oppHits;
    game.opponents = isOnline() ? others().length || null : hasBot() ? 1 : null; // for "enters tapped unless you have two or more opponents"
    if (hasBot()) game.bot.respond = ui.respond !== false; // Opp answers on your turn, and waits for your answers
    const entry = { json: JSON.stringify(game), remote: remoteLife, hits: null };
    undoStack.push(entry);
    if (undoStack.length > 200) undoStack.shift();
    const lifeBefore = { you: game.life, opp: hasBot() ? game.oppLife : null };
    fn();
    if (!game) return;
    // "Whenever you gain life" (Ajani's Pridemate) and "can't gain life" (Sulfuric Vortex), on either table.
    Bot.lifeChanged(game, lifeBefore, def, effectCtx(), isOnline() ? Object.values(combatRules().byPid) : []);
    // Only one monarch: the newest.
    if (hasBot() && game.monarch && game.bot.s.monarch) delete (Bot.monarchOf(game) === 'you' ? game.bot.s : game).monarch;
    entry.hits = sendHits(game.oppHits);
    delete game.oppHits;
    if (game.notice) {
      status(game.notice + ' (Undo if that was wrong.)', 'ok');
      delete game.notice;
    }
    afterChange();
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return status('Nothing to undo.');
    game = JSON.parse(prev.json);
    game.life += remoteLife - prev.remote; // life changes other players made since then stay
    (prev.hits || []).forEach(h => Online.send({ t: 'life', d: -h.d }, h.pid));
    afterChange();
  }

  function afterChange() {
    if (game && game.mustDiscard) setTimeout(mustDiscardPrompt, 0); // after any modal this action opens
    if (game && game.mustDestroy) setTimeout(mustDestroyPrompt, 0);
    if (game && game.mustSacrifice) setTimeout(mustSacrificePrompt, 0);
    if (game && game.mustTarget && game.mustTarget.length) setTimeout(mustTargetPrompt, 0);
    if (game && game.mustLibrary && game.mustLibrary.length) setTimeout(mustLibraryPrompt, 0);
    const asks = { mustDig: mustDigPrompt, mustSacThen: mustSacThenPrompt, mustCopy: mustCopyPrompt, mustTax: mustTaxPrompt, mustFlicker: mustFlickerPrompt, mustShock: mustShockPrompt, mustMadness: mustMadnessPrompt, mustModes: mustModesPrompt, mustCards: mustCardsPrompt, mustRecover: mustRecoverPrompt, mustHand: mustHandPrompt, mustSacToPlay: mustSacToPlayPrompt };
    for (const [k, fn] of Object.entries(asks)) if (game && game[k] && game[k].length) setTimeout(fn, 0);
    syncAuras(); // your Arrest on Opp's creature
    if (game) Bot.refreshGrants(game, def); // "Goblins you control have haste" and the like
    if (ui.tab === 'play') renderBoard();
    if (viewer) renderViewer();
    checkDeaths();
    saveSoon();
    syncSoon();
  }

  // ---------- someone loses ----------

  // Everyone in the game and why they've lost, if they have: 0 life, 10 poison, or 21 commander damage.
  function playersStatus() {
    const why = (life, poison, cmd) => (life <= 0 ? `${life} life` : poison >= 10 ? `${poison} poison counters` : cmd >= 21 ? `${cmd} commander damage` : '');
    const list = [{ key: 'me', name: 'You', why: why(game.life, game.poison || 0, Math.max(0, ...Object.values(game.cmdDamage || {}))) }];
    if (isOnline()) {
      for (const p of others()) {
        const b = peers[p.pid] && peers[p.pid].board;
        if (b) list.push({ key: p.pid, name: p.name, why: why(b.life, b.poison || 0, 0) });
      }
    } else {
      list.push({ key: 'opp', name: 'Opp', why: why(game.oppLife, 0, 0) });
    }
    return list;
  }

  // Announces anyone who just dropped out. With one player left, they win; otherwise play goes on.
  // game.dead remembers who's been announced (and forgets them if Undo brings them back).
  function checkDeaths() {
    if (!game) return;
    const list = playersStatus();
    const told = new Set(game.dead || []);
    list.forEach(p => { if (!p.why) told.delete(p.key); });
    const fresh = list.filter(p => p.why && !told.has(p.key));
    game.dead = [...told, ...fresh.map(p => p.key)];
    if (!fresh.length) return;
    const alive = list.filter(p => !p.why);
    const lines = fresh.map(p => `${p.name === 'You' ? 'You lose' : `${p.name} loses`} (${p.why}).`);
    let title;
    if (alive.length === 1) title = alive[0].key === 'me' ? 'You win!' : `${alive[0].name} wins!`;
    else if (!alive.length) title = 'Everyone is out: it\'s a draw.';
    else title = `${fresh.map(p => p.name).join(' and ')} ${fresh.length === 1 && fresh[0].key !== 'me' ? 'is' : 'are'} out. Play continues.`;
    Game.log(game, `${lines.join(' ')} ${title}`);
    // Your result, saved when you close the message (not if you Undo instead).
    const me = fresh.find(p => p.key === 'me');
    let outcome = null;
    if (!alive.length) outcome = { result: 'draw', why: lines.join(' ') };
    else if (me) outcome = { result: 'loss', why: me.why };
    else if (alive.length === 1 && alive[0].key === 'me') outcome = { result: 'win', why: fresh.map(p => p.why).join(', ') };
    showGameOver(title, lines, alive.length > 1, outcome);
  }

  // Saves how this game went for you (once per game), for the deck's record here and in MTG Tracker.
  async function recordResult(result, why) {
    if (!game || game.recordedResult) return;
    game.recordedResult = result;
    const opponents = hasBot() ? [`Opp (${game.bot.s.deckName || 'computer'})`]
      : others().map(p => { const b = peers[p.pid] && peers[p.pid].board; return b && b.deckName ? `${p.name} (${b.deckName})` : p.name; });
    results.push({ at: Date.now(), deckKey: game.deckKey, deckName: game.deckName, mode: hasBot() ? 'bot' : isOnline() ? 'online' : 'solo',
      opponents, result, turns: game.turn, why: String(why || '').slice(0, 200) });
    if (results.length > 2000) results.splice(0, results.length - 2000);
    saveSoon();
    try { await Store.set('results', results); } catch (e) { status(`Couldn't save the result (${e.message}).`, 'warn'); }
    status(`Saved a ${result} for ${game ? game.deckName : 'this deck'}. MTG Tracker shows it on the deck's page.`, 'ok');
  }

  // This deck's record from saved results: { win, loss, draw }.
  const recordOf = key => results.filter(r => r.deckKey === key).reduce((o, r) => { o[r.result] = (o[r.result] || 0) + 1; return o; }, { win: 0, loss: 0, draw: 0 });

  const gameOver = document.createElement('div');
  gameOver.className = 'game-over';
  gameOver.hidden = true;
  document.body.appendChild(gameOver);

  // When the game is decided, OK ends it (so it leaves "Your games"); Undo takes back the last action instead.
  let pendingOutcome = null; // saved with recordResult when the game-over message is closed
  function showGameOver(title, lines, goesOn, outcome) {
    pendingOutcome = outcome || null;
    gameOver.innerHTML = `<div class="game-over-box">
        <h2>${esc(title)}</h2>
        ${lines.map(l => `<p>${esc(l)}</p>`).join('')}
        <div class="toolbar"><button class="btn" data-go="${goesOn ? 'ok' : 'end'}">${goesOn ? 'Keep playing' : 'OK, end the game'}</button>
          <button class="btn ghost" data-go="undo" title="Take back the last action">↶ Undo</button></div>
      </div>`;
    gameOver.hidden = false;
  }
  gameOver.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    gameOver.hidden = true;
    const outcome = pendingOutcome;
    pendingOutcome = null;
    if (b.dataset.go === 'undo') return undo();
    if (outcome) recordResult(outcome.result, outcome.why);
    if (b.dataset.go === 'end') endGame(true);
  });

  const MAX_HAND = 7;
  let afterDiscard = null; // what to do once you've discarded down to 7

  // True when something you control says "You have no maximum hand size" (Reliquary Tower, Thought Vessel…).
  const noMaxHand = () => game.zones.battlefield.some(iid => {
    const inst = game.cards[iid];
    return !inst.faceDown && /\byou have no maximum hand size\b/i.test((def(inst.id) || {}).oracle || '');
  });

  // Ending your turn with more than 7 cards: pick cards to discard first, then carry on.
  function checkHandSize(then) {
    if (game.zones.hand.length <= MAX_HAND || noMaxHand()) return then();
    afterDiscard = then;
    renderDiscard();
  }

  function renderDiscard() {
    const extra = game.zones.hand.length - MAX_HAND;
    openModal(`
      <div class="page-head"><h3>Discard ${extra === 1 ? 'a card' : extra + ' cards'}</h3><button class="btn ghost sm" data-act="close-modal">Cancel</button></div>
      <p class="muted small">Your maximum hand size is ${MAX_HAND} and you have ${game.zones.hand.length}. Click ${extra === 1 ? 'the card' : 'the cards'} to discard, then your turn ends.</p>
      <div class="viewer-grid">${game.zones.hand.map(iid => `<div class="viewer-card"><div class="card" data-discard="${iid}" title="Discard">${faceHtml(game.cards[iid])}</div></div>`).join('')}</div>`);
  }

  function discardDown(iid) {
    act(() => Game.move(game, iid, 'graveyard'));
    if (game.zones.hand.length > MAX_HAND) return renderDiscard();
    const then = afterDiscard;
    afterDiscard = null;
    closeModal();
    if (then) then();
  }

  // Pick cards from a list (your hand, your graveyard). o: { title, note, ids, min, max, ok, cancel }.
  // done(iids) runs with the picks; Cancel (if offered) just closes it. Cards on Opp's table: o.cards
  // (its cards), or o.cardOf(id) for a mix of tables (the ids are then keys like "o:c12").
  function pickCards(o, done) {
    const chosen = new Set();
    const min = o.min == null ? o.max : o.min;
    const cardOf = o.cardOf || (iid => (o.cards || game.cards)[iid]);
    const label = o.whoOf ? id => `<span class="small">${esc(o.whoOf(id))}</span>` : () => '';
    const draw = () => {
      openModal(`<div class="page-head"><h3>${esc(o.title)}</h3>${o.cancel ? `<button class="btn ghost sm" data-pick-cancel>${esc(o.cancel)}</button>` : ''}</div>
        ${o.note ? `<p class="muted small">${esc(o.note)}</p>` : ''}
        <div class="viewer-grid">${o.ids.map(iid => `<div class="viewer-card"><div class="card${chosen.has(iid) ? ' picked' : ''}" data-pick="${esc(iid)}" title="Click to pick">${faceHtml(cardOf(iid))}</div>${label(iid)}</div>`).join('')}</div>
        <div class="toolbar end"><button class="btn" data-pick-ok ${chosen.size < min ? 'disabled' : ''}>${esc(o.ok)}${o.max > 1 ? ` (${chosen.size}/${o.max})` : ''}</button></div>`);
      modalBox.querySelectorAll('[data-pick]').forEach(el => {
        el.onclick = () => {
          const iid = el.dataset.pick;
          if (chosen.has(iid)) chosen.delete(iid);
          else if (o.max === 1) { chosen.clear(); chosen.add(iid); }
          else if (chosen.size < o.max) chosen.add(iid);
          draw();
        };
      });
      const cancel = modalBox.querySelector('[data-pick-cancel]');
      if (cancel) cancel.onclick = () => { modal.hidden = true; modalBox.innerHTML = ''; if (o.onCancel) o.onCancel(); };
      modalBox.querySelector('[data-pick-ok]').onclick = () => { modal.hidden = true; modalBox.innerHTML = ''; done([...chosen]); };
    };
    draw();
  }

  // Your "Search your library for …" (fetch lands, Cultivate, tutors), "Scry 2" and "Surveil 1":
  // pick the cards, one request at a time. Cancel finds nothing (or keeps every card on top).
  function mustLibraryPrompt() {
    const list = game && game.mustLibrary;
    if (!list || !list.length || !modal.hidden) return;
    const [req] = list;
    const next = fn => act(() => {
      game.mustLibrary = game.mustLibrary.slice(1);
      if (!game.mustLibrary.length) delete game.mustLibrary;
      fn();
      if (!req.then) return;
      const self = (req.self && game.cards[req.self]) || { name: req.src };
      const left = Bot.runEffect(game, req.then, Object.assign({ self, other: hasBot() ? game.bot.s : null }, effectCtx()));
      Game.log(game, `${req.src}: ${req.then}.${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
    });
    const place = d => (d.to === 'hand' ? 'into your hand' : d.to === 'exile' ? 'into exile' : `onto the battlefield${d.tapped ? ' tapped' : ''}`);
    if (req.kind === 'number') return numberPrompt(req, next);
    if (req.kind === 'search') {
      const { spec } = req;
      const ids = Bot.searchable(game, spec, def);
      const what = spec.what ? `${spec.what} card` : 'card';
      const done = picks => next(() => Bot.applySearch(game, spec, picks, req.src));
      const cancel = { cancel: 'Find nothing', onCancel: () => done([]) };
      if (!ids.length) return done([]);
      // Cultivate: one onto the battlefield, then the other into your hand.
      if (spec.rest) {
        return pickCards({ title: `${req.src}: search your library`, note: `Pick a ${what} to put ${place(spec)}.`, ids, min: 0, max: 1, ok: 'Next', ...cancel }, first => {
          const rest = ids.filter(iid => !first.includes(iid));
          if (!first.length || !rest.length) return done(first);
          pickCards({ title: `${req.src}: search your library`, note: `Pick a ${what} to put ${place(spec.rest)}.`, ids: rest, min: 0, max: 1, ok: 'Done', cancel: 'None', onCancel: () => done(first) }, second => done([...first, ...second]));
        });
      }
      return pickCards({ title: `${req.src}: search your library`, note: `Pick ${spec.n >= 99 ? 'any number of' : `up to ${spec.n}`} ${what}${spec.n === 1 ? '' : 's'} to put ${place(spec)}.`, ids, min: 0, max: spec.n, ok: 'Put', ...cancel }, done);
    }
    const top = game.zones.library.slice(0, req.n);
    const away = req.kind === 'surveil' ? 'into your graveyard' : 'on the bottom of your library';
    if (!top.length) return next(() => {});
    pickCards({ title: `${req.src}: ${req.kind} ${top.length}`, note: `Pick the cards to put ${away}. The rest stay on top in this order.`, ids: top, min: 0, max: top.length, ok: 'Done' },
      picks => next(() => Bot.applyScry(game, req.kind, top, picks, req.src)));
  }

  // "Choose a number between 0 and 10": one button per number, each showing what the wipe after it
  // (req.then) would destroy on your side and Opp's. next: mustLibraryPrompt's, which runs req.then.
  function numberPrompt(req, next) {
    const other = hasBot() ? game.bot.s : null;
    const fill = n => req.then.replace(/the chosen number/gi, String(n));
    const names = list => list.map(x => x.c.name).join(', ');
    const rows = [];
    for (let n = req.min; n <= req.max; n++) {
      const v = Bot.wipeVictims(game, other, fill(n), def);
      const yours = v.mine.length ? `yours: ${names(v.mine)}` : 'none of yours';
      const theirs = other ? (v.theirs.length ? ` · Opp's: ${names(v.theirs)}` : " · none of Opp's") : '';
      rows.push(`<button class="btn ghost" data-number="${n}" style="display:block;width:100%;text-align:left;margin:4px 0"><b>${n}</b> <span class="small">— destroys ${esc(yours + theirs)}</span></button>`);
    }
    openModal(`<div class="page-head"><h3>${esc(req.src)}: choose a number</h3></div>
      <p class="muted small">${esc(req.then)}.</p>
      ${isOnline() ? '<p class="muted small">Other players destroy theirs on their side.</p>' : ''}
      <div>${rows.join('')}</div>`);
    modalBox.querySelectorAll('[data-number]').forEach(el => {
      el.onclick = () => {
        const n = Number(el.dataset.number);
        modal.hidden = true;
        modalBox.innerHTML = '';
        req.then = fill(n);
        next(() => Game.log(game, `${req.src}: you chose ${n}.`));
      };
    });
  }

  // Something made you discard (Earsplitting Rats entering, yours or Opp's): pick the cards.
  function mustDiscardPrompt() {
    const m = game && game.mustDiscard;
    if (!m || !modal.hidden) return;
    const n = Math.min(m.n, game.zones.hand.length);
    if (!n) return act(() => { delete game.mustDiscard; });
    pickCards({
      title: `${m.why}: discard ${n === 1 ? 'a card' : n + ' cards'}`,
      note: `Click ${n === 1 ? 'the card' : `${n} cards`} to discard, then Discard.`,
      ids: [...game.zones.hand], max: n, ok: 'Discard', cancel: 'Skip',
    }, picks => act(() => {
      delete game.mustDiscard;
      picks.forEach(iid => Game.move(game, iid, 'graveyard'));
    }));
    // Skip: the picker closes and nothing is discarded.
    const cancel = modalBox.querySelector('[data-pick-cancel]');
    if (cancel) cancel.onclick = () => { modal.hidden = true; modalBox.innerHTML = ''; act(() => { delete game.mustDiscard; }); };
  }

  // "Whenever one or more Cats you control deal combat damage to a player, destroy up to one target
  // artifact or enchantment that player controls" (Feline Sovereign): pick one of Opp's, or skip.
  function mustDestroyPrompt() {
    const list = game && game.mustDestroy;
    if (!list || !list.length || !modal.hidden) return;
    const [m] = list;
    const s = hasBot() ? game.bot.s : null;
    const done = picks => act(() => {
      game.mustDestroy = game.mustDestroy.slice(1);
      if (!game.mustDestroy.length) delete game.mustDestroy;
      picks.forEach(iid => {
        Game.log(game, `${m.why}: destroyed Opp's ${s.cards[iid].name}.`);
        Game.move(s, iid, s.cards[iid].commander ? 'command' : 'graveyard');
      });
    });
    const ids = s ? Bot.destroyable(s, m.what).map(c => c.iid) : [];
    if (!ids.length) {
      return act(() => {
        Game.log(game, s ? `${m.why}: Opp has no ${m.what} to destroy.` : `${m.why}: destroy up to one ${m.what} that player controls (they do that on their side).`);
        game.mustDestroy = game.mustDestroy.slice(1);
        if (!game.mustDestroy.length) delete game.mustDestroy;
      });
    }
    pickCards({
      title: `${m.why}: destroy up to one ${m.what}`,
      note: `Click one of Opp's permanents to destroy it, or Skip.`,
      ids, cards: s.cards, max: 1, min: 0, ok: 'Destroy', cancel: 'Skip', onCancel: () => done([]),
    }, done);
  }

  // Annihilator: pick the permanents you sacrifice.
  function mustSacrificePrompt() {
    const m = game && game.mustSacrifice;
    if (!m || !modal.hidden) return;
    // "Each opponent sacrifices a creature" (m.what): only those.
    const ids = game.zones.battlefield.filter(iid => !m.what || Bot.cardFits(game.cards[iid], m.what));
    const n = Math.min(m.n, ids.length);
    if (!n) return act(() => { delete game.mustSacrifice; });
    pickCards({
      title: `${m.why}: sacrifice ${n === 1 ? 'a permanent' : n + ' permanents'}`,
      note: `Click ${n === 1 ? 'the permanent' : `${n} permanents`} to sacrifice, then Sacrifice.`,
      ids, min: n, max: n, ok: 'Sacrifice', cancel: 'Skip',
      onCancel: () => act(() => { delete game.mustSacrifice; }),
    }, picks => act(() => {
      delete game.mustSacrifice;
      picks.forEach(iid => { const c = game.cards[iid]; if (c) Game.move(game, iid, c.commander ? 'command' : 'graveyard'); });
    }));
  }

  // "Destroy target creature", "deals 3 damage to any target"… from your cards: pick the target
  // (a permanent on any table, or a player), or Skip.
  const ACTIONS = { destroy: 'Destroy', exile: 'Exile', bounce: 'Return to hand', damage: 'Damage', tap: 'Tap', untap: 'Untap', pump: 'Pump', counter: 'Put counters on' };
  function mustTargetPrompt() {
    const list = game && game.mustTarget;
    if (!list || !list.length || !modal.hidden) return;
    const [req] = list;
    const eff = req.eff;
    const f = Bot.targetFilter(eff.what);
    const next = () => { game.mustTarget = game.mustTarget.slice(1); if (!game.mustTarget.length) delete game.mustTarget; };
    const opts = []; // { label, who, card, apply }
    // A spell of yours targeting something: heroic and Danitha see it.
    const srcCard = req.srcIid && game.cards[req.srcIid];
    const targeted = pick => { if (srcCard && /\b(instant|sorcery)\b/i.test(String(srcCard.typeLine || '').split('//')[0])) Bot.spellTargeted(game, game, srcCard, pick, def, effectCtx()); };
    const perm = (inst, st, mine, who, apply) => { if (Bot.canTarget(eff, inst, st, mine, false)) opts.push({ label: inst.name, who, card: inst, apply }); };
    game.zones.battlefield.map(iid => game.cards[iid]).forEach(inst => perm(inst, Bot.stats(inst, def(inst.id)), true, 'You', () => { Bot.applyTarget(game, game, inst, eff, req.src, def, game); targeted({ inst, s: game }); }));
    if (hasBot()) {
      const s = game.bot.s;
      s.zones.battlefield.map(iid => s.cards[iid]).forEach(inst => perm(inst, Bot.botStats(inst), false, 'Opp', () => { Bot.applyTarget(game, s, inst, eff, req.src, def, game); targeted({ inst, s }); }));
    }
    if (isOnline()) {
      for (const p of others()) {
        const b = peers[p.pid] && peers[p.pid].board;
        ((b && b.battlefield) || []).forEach(card => perm({ ...card, zone: 'battlefield' }, Bot.stats(card, def(card.id)), false, p.name, () => {
          Online.send({ t: 'target', iid: card.iid, eff, by: req.src }, p.pid);
          Game.log(game, `${req.src}: ${ACTIONS[eff.action] || eff.action} ${p.name}'s ${card.name} (done on their side).`);
        }));
      }
    }
    const players = [];
    if (f && f.players && eff.action === 'damage') {
      if (f.players === 'any') players.push({ label: 'You', apply: () => Bot.damagePlayer(game, 'you', eff.n, req.src) });
      for (const p of others()) {
        players.push({ label: p.name, apply: () => {
          if (p.pid === BOT) { Bot.damagePlayer(game, 'opp', eff.n, req.src); Bot.opponentDamaged(game, game, eff.n, def, effectCtx()); targeted({ player: 'opp' }); }
          else { (game.oppHits = game.oppHits || []).push({ to: p.pid, d: -eff.n }); Game.log(game, `${req.src}: ${eff.n} damage to ${p.name}.`); Bot.opponentDamaged(game, game, eff.n, def, effectCtx()); }
        } });
      }
    }
    // Sign in Blood: "Target player draws two cards and loses 2 life."
    if (eff.action === 'player') {
      players.push({ label: 'You', apply: () => Bot.playerEffect(game, 'you', eff, req.src) });
      for (const p of others()) {
        players.push({ label: p.name, apply: () => {
          if (p.pid === BOT) { Bot.playerEffect(game, 'opp', eff, req.src); targeted({ player: 'opp' }); }
          else { (game.oppHits = game.oppHits || []).push({ to: p.pid, d: -eff.lose }); Game.log(game, `${req.src}: ${p.name} draws ${eff.draw} (on their side) and loses ${eff.lose} life.`); }
        } });
      }
    }
    if (!opts.length && !players.length) {
      return act(() => { next(); Game.log(game, `${req.src}: no target for "${req.part}".`); });
    }
    openModal(`<div class="page-head"><h3>${esc(req.src)}: pick a target</h3></div>
      <p class="small">${esc(req.part)}.</p>
      ${players.length ? `<div class="toolbar tight">${players.map((p, i) => `<button class="btn sm" data-tg="p${i}">${esc(p.label)}</button>`).join('')}</div>` : ''}
      <div class="target-list">${opts.map((o, i) => `<button class="target-pick" data-tg="c${i}" title="${esc(o.who)}: ${esc(o.label)}"><div class="card readonly">${faceHtml(o.card)}</div><span class="small">${esc(o.who === 'You' ? 'Yours' : o.who)}</span></button>`).join('')}</div>
      <div class="toolbar end"><button class="btn ghost" data-tg="skip">Skip</button></div>`);
    modalBox.querySelectorAll('[data-tg]').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.tg;
        modal.hidden = true;
        modalBox.innerHTML = '';
        const pick = k === 'skip' ? null : k[0] === 'p' ? players[Number(k.slice(1))] : opts[Number(k.slice(1))];
        act(() => { next(); if (pick) pick.apply(); else Game.log(game, `${req.src}: skipped "${req.part}".`); });
      };
    });
  }

  // ---------- more choices your cards ask for (one list each in game, opened in turn by afterChange) ----------

  // Takes the first request off game[key] (inside act).
  const nextOf = key => { game[key] = (game[key] || []).slice(1); if (!game[key].length) delete game[key]; };
  const closeAsk = () => { modal.hidden = true; modalBox.innerHTML = ''; };
  // A question with buttons: [{ label, ghost, run }]; each runs inside act after the request is taken off.
  function askButtons(key, title, text, buttons) {
    openModal(`<div class="ask"><h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="toolbar end">${buttons.map((b, i) => `<button type="button" class="btn${b.ghost ? ' ghost' : ''}" data-ab="${i}">${esc(b.label)}</button>`).join('')}</div></div>`);
    modalBox.querySelectorAll('[data-ab]').forEach(el => {
      el.onclick = () => { closeAsk(); const b = buttons[Number(el.dataset.ab)]; act(() => { nextOf(key); b.run(); }); };
    });
  }

  // "Choose one —" on your trigger (Retreat to Hagra's landfall, Junji dying).
  function mustModesPrompt() {
    const req = game && game.mustModes && game.mustModes[0];
    if (!req || !modal.hidden) return;
    const self = (req.self && game.cards[req.self]) || { name: req.src };
    const run = picks => act(() => {
      nextOf('mustModes');
      for (const i of picks) {
        const left = Bot.runEffect(game, req.modes[i], Object.assign({ self, other: hasBot() ? game.bot.s : null }, effectCtx()));
        Game.log(game, `${req.src}: ${req.modes[i]}${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
      }
    });
    if (req.pick >= req.modes.length) return run(req.modes.map((m, i) => i));
    openModal(`<form class="ask" id="trigModeForm"><h3>${esc(req.src)}</h3>
      <p class="muted small">Choose ${req.pick === 1 ? 'one' : `up to ${req.pick}`}.</p>
      <div class="block-picks">${req.modes.map((m, i) => `<label class="check"><input type="${req.pick === 1 ? 'radio' : 'checkbox'}" name="mode" value="${i}" ${i === 0 ? 'checked' : ''}> ${esc(m)}</label>`).join('')}</div>
      <div class="toolbar end"><button type="button" class="btn ghost" data-ask="skip">Skip</button><button class="btn">Do it</button></div></form>`);
    const form = $('#trigModeForm');
    form.querySelector('[data-ask=skip]').onclick = () => { closeAsk(); act(() => { nextOf('mustModes'); Game.log(game, `${req.src}: skipped.`); }); };
    form.onsubmit = e => {
      e.preventDefault();
      const picks = [...form.querySelectorAll('input:checked')].map(x => Number(x.value)).slice(0, req.pick);
      closeAsk();
      run(picks);
    };
  }

  // Cards from graveyards (or your hand) to your hand or the battlefield: Liliana, Junji, Archenemy's
  // Charm, Ugin's −10, The Darkness Crystal. Cards on Opp's side come over to yours.
  function mustCardsPrompt() {
    const req = game && game.mustCards && game.mustCards[0];
    if (!req || !modal.hidden) return;
    const spec = req.spec;
    const other = hasBot() ? game.bot.s : null;
    const choices = Bot.moveChoices(game, other, spec);
    const key = c => `${c.s === game ? 'y' : 'o'}:${c.iid}`;
    const byKey = new Map(choices.map(c => [key(c), c]));
    const finish = picks => act(() => { nextOf('mustCards'); Bot.applyMoveCards(game, spec, picks.map(k => byKey.get(k)).filter(Boolean), { name: req.src }, def); });
    if (!choices.length) return finish([]);
    const where = spec.to === 'hand' ? 'into your hand' : `onto the battlefield${spec.tapped ? ' tapped' : ''}`;
    pickCards({
      title: `${req.src}: pick ${spec.max === 1 ? 'a card' : `up to ${spec.max} cards`}`,
      note: `${spec.what} card${spec.max === 1 ? '' : 's'} to put ${where}${spec.from === 'any' ? ' (from any graveyard)' : ''}.`,
      ids: [...byKey.keys()], min: Math.min(spec.min, choices.length), max: spec.max, ok: 'Put',
      cardOf: k => byKey.get(k).s.cards[byKey.get(k).iid], whoOf: k => (k[0] === 'y' ? 'Yours' : "Opp's"),
      cancel: spec.min ? null : 'None', onCancel: () => finish([]),
    }, finish);
  }

  // Garza's Assassin (recover): another creature of yours died.
  function mustRecoverPrompt() {
    const req = game && game.mustRecover && game.mustRecover[0];
    if (!req || !modal.hidden) return;
    const card = game.cards[req.iid];
    if (!card || card.zone !== 'graveyard') return act(() => nextOf('mustRecover'));
    const half = /^pay half your life/i.test(req.cost) ? Math.ceil(Math.max(0, game.life) / 2) : 0;
    const price = half ? `${half} life (half your life, rounded up)` : req.cost;
    askButtons('mustRecover', `${card.name}: recover`, `Another creature of yours died. Pay ${price} to return ${card.name} to your hand? If you don't, it's exiled.`, [
      { label: 'Exile it', ghost: true, run: () => Bot.applyRecover(game, game, req.iid, false, def) },
      { label: `Pay ${half ? `${half} life` : req.cost}`, run: () => Bot.applyRecover(game, game, req.iid, true, def) },
    ]);
  }

  // Madness: you discarded it into exile. Cast it for its madness cost, or put it into your graveyard.
  function mustMadnessPrompt() {
    const req = game && game.mustMadness && game.mustMadness[0];
    if (!req || !modal.hidden) return;
    const card = game.cards[req.iid];
    if (!card || card.zone !== 'exile') return act(() => nextOf('mustMadness'));
    const cost = Bot.madnessCost(card, def);
    const canPay = !!Game.autoPay(JSON.parse(JSON.stringify(game)), cost);
    askButtons('mustMadness', `${card.name}: madness`, `You discarded ${card.name}. Cast it for its madness cost ${cost}${canPay ? '' : " (your untapped mana can't pay it, so tap it yourself)"}, or put it into your graveyard?`, [
      { label: 'Graveyard', ghost: true, run: () => Game.move(game, req.iid, 'graveyard') },
      { label: `Cast for ${cost}`, run: () => {
        if (ui.autoTap && canPay) Game.autoPay(game, cost);
        Game.log(game, `${card.name}: cast for its madness cost ${cost}.`);
        Game.move(game, req.iid, 'battlefield', { cast: true });
      } },
    ]);
  }

  // Boggart Bog: "As this land enters, you may pay 3 life. If you don't, it enters tapped."
  function mustShockPrompt() {
    const req = game && game.mustShock && game.mustShock[0];
    if (!req || !modal.hidden) return;
    const land = game.cards[req.iid];
    if (!land || land.zone !== 'battlefield') return act(() => nextOf('mustShock'));
    askButtons('mustShock', land.name, `Pay ${req.n} life so ${land.name} enters untapped?`, [
      { label: 'Enter tapped', ghost: true, run: () => { land.tapped = true; land.tappedFor = null; Game.log(game, `${land.name} entered tapped.`); } },
      { label: `Pay ${req.n} life`, run: () => { game.life -= req.n; Game.log(game, `Paid ${req.n} life: ${land.name} entered untapped.`); } },
    ]);
  }

  // Appetite for Brains: Opp reveals its hand; you pick the card (mana value 4 or greater) to exile.
  function mustHandPrompt() {
    const req = game && game.mustHand && game.mustHand[0];
    if (!req || !modal.hidden || !hasBot()) return;
    const s = game.bot.s;
    const fits = c => ((c.bot && c.bot.cmc) || 0) >= (req.mv || 0);
    const ids = s.zones.hand.filter(iid => fits(s.cards[iid]));
    const names = s.zones.hand.map(iid => s.cards[iid].name);
    const done = picks => act(() => {
      nextOf('mustHand');
      Game.log(game, `Opp's hand: ${names.join(', ') || 'empty'}.`);
      picks.forEach(iid => { Game.log(game, `You ${req.to === 'exile' ? 'exiled' : 'made Opp discard'} Opp's ${s.cards[iid].name}.`); Game.move(s, iid, req.to); });
    });
    if (!ids.length) return done([]);
    pickCards({ title: "Opp's hand", note: `Opp's hand: ${names.join(', ')}. Pick a card${req.mv ? ` with mana value ${req.mv} or greater` : ''} to ${req.to === 'exile' ? 'exile' : 'discard'}.`,
      ids, max: 1, ok: req.to === 'exile' ? 'Exile' : 'Discard', cards: s.cards }, done);
  }

  // Reno and Rude: sacrifice another creature or artifact to play the exiled card this turn (any mana works).
  function mustSacToPlayPrompt() {
    const req = game && game.mustSacToPlay && game.mustSacToPlay[0];
    if (!req || !modal.hidden || !hasBot()) return;
    const s = game.bot.s;
    const card = s.cards[req.card];
    const ids = game.zones.battlefield.filter(iid => iid !== req.srcIid && Bot.cardFits(game.cards[iid], req.what));
    if (!card || card.zone !== 'exile' || !ids.length) return act(() => nextOf('mustSacToPlay'));
    pickCards({ title: `${req.src}: play ${card.name}?`, note: `Sacrifice another ${req.what} to be able to play ${card.name} this turn (mana of any type can pay for it). It stays in exile until you play it from there.`,
      ids, min: 1, max: 1, ok: 'Sacrifice', cancel: "Don't", onCancel: () => act(() => nextOf('mustSacToPlay')) }, picks => act(() => {
      nextOf('mustSacToPlay');
      picks.forEach(iid => { const c = game.cards[iid]; if (c) Game.move(game, iid, c.commander ? 'command' : 'graveyard'); });
      const mine = Bot.takeCard(s, card.iid, game, 'exile', { quiet: true, defOf: def });
      mine.playable = { anyMana: true };
      Game.log(game, `${req.src}: you may play ${mine.name} from your exile this turn (open Exile).`);
    }));
  }

  // Opp's Rhystic Study ("… unless that player pays {1}") or Smothering Tithe ("that player may pay {2}"): pay or not.
  function mustTaxPrompt() {
    const req = game && game.mustTax && game.mustTax[0];
    if (!req || !modal.hidden || !hasBot()) return;
    const canPay = !!Game.autoPay(JSON.parse(JSON.stringify(game)), req.cost);
    const theyGet = req.draw ? `Opp draws ${req.draw === 1 ? 'a card' : req.draw + ' cards'}` : `Opp gets a ${req.token} token`;
    askButtons('mustTax', `Opp's ${req.why}`, `Pay ${req.cost}? If you don't, ${theyGet}.${canPay ? '' : " (Your untapped mana can't pay it.)"}`, [
      { label: "Don't pay", ghost: true, run: () => Bot.applyTax(game, req, false) },
      ...(canPay ? [{ label: `Pay ${req.cost}`, run: () => Bot.applyTax(game, req, true) }] : []),
    ]);
  }

  // Eerie Interlude: pick your creatures to exile; they come back at the beginning of the next end step.
  function mustFlickerPrompt() {
    const req = game && game.mustFlicker && game.mustFlicker[0];
    if (!req || !modal.hidden) return;
    const ids = game.zones.battlefield.filter(iid => !game.cards[iid].phasedOut && Bot.cardFits(game.cards[iid], req.what) && Game.isCreature(game.cards[iid]));
    const done = picks => act(() => { nextOf('mustFlicker'); Bot.flickerOut(game, game, picks, req.src); });
    if (!ids.length) return done([]);
    pickCards({ title: `${req.src}: exile your creatures`, note: 'Pick any number. They return at the beginning of the next end step (as new objects: counters and auras are gone).',
      ids, min: 0, max: ids.length, ok: 'Exile', cancel: 'None', onCancel: () => done([]) }, done);
  }

  // Wall of Stolen Identity: pick the creature it enters as a copy of (or none, and it's a 0/0).
  function mustCopyPrompt() {
    const req = game && game.mustCopy && game.mustCopy[0];
    if (!req || !modal.hidden) return;
    const inst = game.cards[req.iid];
    const finish = pick => act(() => {
      nextOf('mustCopy');
      if (!inst || inst.zone !== 'battlefield') return;
      delete inst.copyPending;
      if (!pick) return Game.log(game, `${inst.name} didn't copy anything.`);
      Bot.becomeCopy(game, game, inst, pick, def);
      Bot.enterTrigger(game, inst, def); // the copy's own "enters with …" and "When this enters, …"
      Bot.enterEffects(game, game, inst, def, effectCtx());
    });
    const choices = inst && inst.zone === 'battlefield' ? Bot.cloneChoices(game, inst) : [];
    if (!choices.length) return finish(null);
    const key = c => `${c.s === game ? 'y' : 'o'}:${c.inst.iid}`;
    const byKey = new Map(choices.map(c => [key(c), c]));
    pickCards({ title: `${inst.name}: copy a creature`, note: 'It enters as a copy (a Wall with defender too). The copied creature is tapped and stays tapped while you control the copy.',
      ids: [...byKey.keys()], min: 1, max: 1, ok: 'Copy', cardOf: k => byKey.get(k).inst, whoOf: k => (k[0] === 'y' ? 'Yours' : "Opp's"),
      cancel: "Don't copy", onCancel: () => finish(null) }, picks => finish(byKey.get(picks[0])));
  }

  // Karumonix: pick the cards to keep from the top ones; the rest go to the bottom in a random order.
  function mustDigPrompt() {
    const req = game && game.mustDig && game.mustDig[0];
    if (!req || !modal.hidden) return;
    const done = picks => act(() => { nextOf('mustDig'); Bot.applyDig(game, req.top, picks, req.src); });
    if (!req.fits.length) return done([]);
    pickCards({ title: `${req.src}: top ${req.top.length} cards`, note: `You may put ${req.max >= 99 ? 'any number' : `up to ${req.max}`} ${req.what} card${req.max === 1 ? '' : 's'} into your hand. The rest go on the bottom in a random order.`,
      ids: req.fits, min: 0, max: Math.min(req.max, req.fits.length), ok: 'Take', cancel: 'None', onCancel: () => done([]) }, done);
  }

  // Lord Skitter's Butcher: sacrifice another creature (or don't); if you do, the rest happens.
  function mustSacThenPrompt() {
    const req = game && game.mustSacThen && game.mustSacThen[0];
    if (!req || !modal.hidden) return;
    const ids = game.zones.battlefield.filter(iid => iid !== req.srcIid && Bot.cardFits(game.cards[iid], req.what));
    const skip = () => act(() => { nextOf('mustSacThen'); Game.log(game, `${req.src}: didn't sacrifice.`); });
    if (!ids.length) return skip();
    pickCards({ title: `${req.src}: sacrifice another ${req.what}?`, note: `If you do: ${req.rest}.`, ids, min: 1, max: 1, ok: 'Sacrifice', cancel: "Don't", onCancel: skip }, picks => act(() => {
      nextOf('mustSacThen');
      const c = game.cards[picks[0]];
      Game.move(game, c.iid, c.commander ? 'command' : 'graveyard');
      const self = (req.srcIid && game.cards[req.srcIid]) || { name: req.src };
      const left = Bot.runEffect(game, req.rest, Object.assign({ self, other: hasBot() ? game.bot.s : null }, effectCtx()));
      Game.log(game, `${req.src}: sacrificed ${c.name}; ${req.rest}.${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
    }));
  }

  // Cycling and transmute from your hand: pay, discard it, then draw (cycling) or search for a card
  // with the same mana value (transmute).
  function handAbility(iid, ab) {
    const inst = game.cards[iid];
    if (!inst || inst.zone !== 'hand') return;
    if (!Game.autoPay(JSON.parse(JSON.stringify(game)), ab.cost)) return status(`Not enough untapped mana for ${ab.label}.`, 'warn', 8000);
    act(() => {
      const paid = Game.autoPay(game, ab.cost);
      Game.log(game, `${ab.label}: discarded ${inst.name}${paid && paid.sources.length ? ` (tapped ${paid.sources.join(', ')})` : ''}.`);
      const mv = inst.cmc || 0;
      Game.move(game, iid, 'graveyard');
      if (ab.kind === 'cycling') Game.drawCards(game, 1);
      else later('mustLibrary', { kind: 'search', spec: { n: 1, what: '', to: 'hand', tapped: false, rest: null, mv }, src: `${inst.name} (transmute, mana value ${mv})` });
    });
  }

  // A friend's card targeted one of yours ("Destroy target creature"): it's done here, on your table.
  function receiveTarget(from, m) {
    const inst = game && game.cards[String(m.iid || '')];
    const e = m.eff && typeof m.eff === 'object' ? m.eff : {};
    if (!inst || inst.zone !== 'battlefield' || !ACTIONS[e.action]) return;
    const num = v => Math.max(-99, Math.min(99, Math.trunc(Number(v)) || 0));
    const eff = { action: e.action, what: 'permanent', n: num(e.n), pow: num(e.pow), tou: num(e.tou),
      kw: (Array.isArray(e.kw) ? e.kw : []).map(String).filter(k => Bot.KEYWORDS.includes(k)), kind: String(e.kind || '+1/+1').slice(0, 30) };
    act(() => { game.notice = Bot.applyTarget(game, game, inst, eff, `${nameOf(from)}'s ${String(m.by || 'card').slice(0, 80)}`, def); });
  }

  // Opp's spell waits on the stack because you could answer it: answer now, or let it resolve.
  function openRespond() {
    const st = game.bot.s.stack;
    if (!st) return;
    const inst = game.bot.s.cards[st.iid];
    const tgt = st.target === 'face' ? 'at you' : st.target && game.cards[st.target] ? `on your ${game.cards[st.target].name}` : '';
    openModal(`<div class="page-head"><h3>Opp is casting ${esc(inst.name)}</h3></div>
      <div class="respond-card"><div class="card readonly">${faceHtml(inst)}</div></div>
      <p>${tgt ? `Opp casts it ${esc(tgt)}. ` : ''}You have an instant you can cast: answer it now (a counterspell counters it), or let it resolve.</p>
      <div class="toolbar end"><button class="btn ghost" data-rs="answer">Answer it</button><button class="btn" data-rs="go">Let it resolve</button></div>`);
    modalBox.querySelector('[data-rs=answer]').onclick = () => {
      modal.hidden = true;
      modalBox.innerHTML = '';
      status(`Opp's ${inst.name} is waiting. Cast your instant, then press End turn (or N) to let Opp carry on.`, 'warn', true);
      renderOpps();
    };
    modalBox.querySelector('[data-rs=go]').onclick = () => { modal.hidden = true; modalBox.innerHTML = ''; respondDone(); };
  }

  // Opp's waiting spell resolves (unless you countered it) and its turn carries on.
  function respondDone() {
    const w = game.bot.wait || {};
    let res;
    act(() => {
      res = Bot.resumeTurn(game, def);
      if (game.bot.wait) Object.assign(game.bot.wait, { yoursNext: w.yoursNext, before: w.before });
      if (game.bot.tapChoice) game.bot.tapChoice.yoursNext = w.yoursNext;
      if (game.bot.pending) game.bot.pending.yoursNext = w.yoursNext;
    });
    if (game.bot.s.stack) return openRespond();
    if (w.phase === 'main2') {
      if (w.yoursNext) startNextTurn();
      const msg = [w.before, res.notes.length ? `Opp ${res.notes.join(', ')}.` : ''].filter(Boolean).join(' ') || 'Opp ended its turn.';
      return status(msg + outcome(), 'ok', 10000);
    }
    if (res.tapChoice) return openTapChoice();
    afterOppMain(res, w.yoursNext);
  }

  // The monarch draws at their end step. Online, the newest claim wins (clocks lined up with each peer's offset).
  function amMonarch() {
    if (!game || !game.monarch) return false;
    if (hasBot()) return Bot.monarchOf(game) === 'you';
    return Object.values(peers).every(p => !p.board || !p.board.monarch || p.board.monarch + (p.offset || 0) < game.monarch);
  }

  // Your end step: "you may mill four cards. If you do, return up to two Rat creature cards from your
  // graveyard to your hand" (Ashcoat of the Shadow Swarm). Asks for each, then runs then().
  function endStep(then) {
    if (game.endStepDone === game.turn) return then(); // already asked (End turn pressed again)
    if (Bot.phaseTriggers(game, game, 'end step', def, null, true)) act(() => Bot.phaseTriggers(game, game, 'end step', def, effectCtx())); // "At the beginning of your end step, …"
    if (game.flickerBack) act(() => Bot.flickerReturn(game)); // Eerie Interlude
    const todo = Bot.endStepTriggers(game, def);
    const finish = () => {
      if (amMonarch()) act(() => { Game.drawCards(game, 1); Game.log(game, 'You are the monarch, so you drew a card at your end step.'); });
      game.endStepDone = game.turn;
      then();
    };
    const next = i => {
      const t = todo[i];
      if (!t) return finish();
      if (t.inst.zone !== 'battlefield') return next(i + 1);
      openModal(`<div class="page-head"><h3>${esc(t.inst.name)}</h3></div>
        <p>End step: mill ${t.mill}, then return up to ${t.up} ${esc(t.what)} card${t.up === 1 ? '' : 's'} from your graveyard to your hand?</p>
        <div class="toolbar end"><button class="btn ghost" data-es="skip">Skip</button><button class="btn" data-es="go">Mill ${t.mill}</button></div>`);
      modalBox.querySelector('[data-es=skip]').onclick = () => { modal.hidden = true; modalBox.innerHTML = ''; next(i + 1); };
      modalBox.querySelector('[data-es=go]').onclick = () => {
        modal.hidden = true;
        modalBox.innerHTML = '';
        act(() => Game.mill(game, t.mill));
        const ids = Bot.returnable(game, t);
        if (!ids.length) {
          act(() => Game.log(game, `${t.inst.name}: no ${t.what} cards in your graveyard to return.`));
          return next(i + 1);
        }
        pickCards({ title: `Return up to ${t.up} ${t.what} card${t.up === 1 ? '' : 's'}`, note: 'Pick the cards to put back in your hand.', ids, min: 0, max: t.up, ok: 'Return' }, picks => {
          if (picks.length) act(() => {
            picks.forEach(iid => Game.move(game, iid, 'hand'));
            Game.log(game, `${t.inst.name}: returned ${picks.map(iid => game.cards[iid].name).join(' and ')} to your hand.`);
          });
          next(i + 1);
        });
      };
    };
    next(0);
  }

  // Playing alone: end this turn, then untap and draw. Online the same keys and menu items pass the turn.
  function nextTurn() {
    if (isOnline()) return passTurn();
    if (hasBot()) {
      if (game.bot.pending || game.bot.tapChoice || game.bot.s.stack) return oppWaiting();
      return endStep(() => checkHandSize(() => oppTurn(true)));
    }
    endStep(() => checkHandSize(startNextTurn));
  }

  // Online: discard down to 7 if needed, then hand the turn to the next player. Their turn
  // starts on its own when the message arrives.
  function passTurn() {
    const next = others()[0];
    if (!next || !Online.connected()) return status('No one else is in the game yet.');
    if (activePid && activePid !== Online.id()) return status(`It's ${nameOf(activePid)}'s turn, not yours.`);
    endStep(() => checkHandSize(() => {
      activePid = next.pid;
      Online.send({ t: 'pass', next: next.pid });
      act(() => { Game.endCrew(game); Game.endOfTurn(game); game.offTurn = true; Game.log(game, `Passed the turn to ${next.name}.`); });
    }));
  }

  // Cards with "At the beginning of your upkeep" (or each upkeep, or cumulative upkeep) get
  // highlighted at the start of your turn until you click Done (unless Upkeep reminders is off).
  const UPKEEP = /\bat the beginning of (?:your|each|each player's) upkeep\b|\bcumulative upkeep\b/i;

  function markUpkeep() {
    if (ui.upkeepOff) { game.upkeep = null; return; }
    const iids = game.zones.battlefield.filter(iid => {
      const inst = game.cards[iid];
      return !inst.faceDown && UPKEEP.test((def(inst.id) || {}).oracle || '');
    });
    game.upkeep = iids.length ? { turn: game.turn, iids } : null;
    if (iids.length) {
      const names = iids.map(iid => game.cards[iid].name).join(', ');
      Game.log(game, `Upkeep: ${names}.`);
    }
  }

  const upkeepIids = () => (game && game.upkeep && game.upkeep.turn === game.turn ? game.upkeep.iids.filter(iid => game.cards[iid] && game.cards[iid].zone === 'battlefield') : []);

  function startNextTurn() {
    act(() => {
      delete game.offTurn;
      Game.nextTurn(game);
      Bot.upkeepDraws(game); // Arcane Denial: "at the beginning of the next turn's upkeep"
      Bot.phaseTriggers(game, game, 'upkeep', def, effectCtx()); // "At the beginning of your upkeep, …" that it can do
      Bot.phaseTriggers(game, game, 'draw step', def, effectCtx()); // The Immortal Sun: "draw an additional card"
      markUpkeep();
    });
    const upkeep = upkeepIids();
    if (upkeep.length) status(`Upkeep triggers: ${upkeep.map(iid => game.cards[iid].name).join(', ')}. They're highlighted until you click Done.`);
    if (Online.connected()) {
      activePid = Online.id();
      Online.send({ t: 'turn', turn: game.turn });
      renderOpps();
    }
  }

  // ---------- online play ----------

  const isOnline = () => Online.active();
  const nameOf = pid => (pid === BOT ? 'Opp' : pid === Online.id() ? 'You' : (Online.players().find(p => p.pid === pid) || {}).name || 'Player');

  // The other players, in seat order starting with the one after you. Playing alone against the
  // computer, that's Opp.
  function others() {
    if (!isOnline()) return hasBot() ? [{ pid: BOT, name: 'Opp' }] : [];
    const ps = Online.players();
    const i = ps.findIndex(p => p.pid === Online.id());
    return i < 0 ? [] : [...ps.slice(i + 1), ...ps.slice(0, i)];
  }

  // Sends life loss from cards ("each opponent loses 2 life") or the life buttons to the other
  // players. Returns what was sent, so Undo can send it back.
  function sendHits(hits) {
    if (!hits || !hits.length || !Online.connected()) return null;
    const opps = others().map(p => p.pid);
    const out = [];
    for (const h of hits) {
      if (h.to === 'target' && opps.length > 1) {
        game.notice = (game.notice ? game.notice + ' ' : '') + `Pick which opponent loses ${-h.d} life: use − on their life.`;
        continue;
      }
      const to = h.to === 'each' || h.to === 'target' ? opps : [h.to];
      to.forEach(pid => out.push({ pid, d: h.d }));
    }
    out.forEach(h => Online.send({ t: 'life', d: h.d }, h.pid));
    return out.length ? out : null;
  }

  let syncTimer;
  function syncSoon() {
    if (!Online.connected()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sendState, 80);
  }

  // Sends your table to the other players, with card info for any cards they haven't seen yet.
  function sendState() {
    if (!Online.connected()) return;
    if (!game) return Online.send({ t: 'state', none: true, now: Date.now() });
    const snap = Online.snapshot(game);
    snap.rules = Bot.tableRules(game, def); // Arboria, Mirri…: what limits attacks on you
    const ids =new Set([...snap.battlefield, ...snap.graveyard, ...snap.exile, ...snap.command].map(c => c.id).filter(Boolean));
    const fresh = [...ids].filter(id => !sentDefs.has(id) && def(id));
    for (let i = 0; i < fresh.length; i += 40) {
      const chunk = fresh.slice(i, i + 40);
      Online.send({ t: 'defs', cards: Object.fromEntries(chunk.map(id => [id, Online.slimDef(def(id))])) });
      chunk.forEach(id => sentDefs.add(id));
    }
    Online.send(snap);
  }

  const httpsOrNull = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

  function onMessage(m) {
    const from = m.from;
    if (!from || from === Online.id()) return;
    switch (m.t) {
      case 'state': {
        const cards = {};
        if (!m.none) [...m.battlefield, ...m.graveyard, ...m.exile, ...m.command].forEach(c => { cards[c.iid] = c; });
        if (!m.none) m.rules = cleanRules(m.rules);
        if (!m.none) m.monarch = Number.isFinite(Number(m.monarch)) ? Number(m.monarch) : 0;
        peers[from] = { board: m.none ? null : m, offset: Date.now() - (m.now || Date.now()), cards, pick: peers[from] && peers[from].pick };
        // Someone became the monarch after you did: you aren't any more.
        if (game && game.monarch && m.monarch && m.monarch + peers[from].offset > game.monarch) { delete game.monarch; saveSoon(); }
        receiveAuras(from, peers[from].board);
        renderOppsSoon();
        if (ui.tab === 'decks') refreshOnlinePanel();
        return;
      }
      case 'defs':
        for (const [id, c] of Object.entries(m.cards || {})) {
          if (!c || typeof c !== 'object') continue;
          peerDefs[id] = { id, name: String(c.name || ''), typeLine: String(c.typeLine || ''), image: httpsOrNull(c.image), imageLarge: httpsOrNull(c.imageLarge), backImage: httpsOrNull(c.backImage), power: c.power, toughness: c.toughness, loyalty: c.loyalty == null ? null : String(c.loyalty).slice(0, 4) };
        }
        return;
      case 'life': return receiveLife(from, Number(m.d));
      case 'target': return receiveTarget(from, m);
      case 'counter': {
        // Another player's counterspell: only your newest spell can be countered.
        if (!game || !game.lastCast || game.lastCast.iid !== m.iid) return;
        const by = `${nameOf(from)}'s ${String(m.by || 'counterspell').slice(0, 80)}`;
        return act(() => {
          const done = Game.counterLast(game);
          game.notice = `${by}: ${done || 'your last spell already resolved, so undo what it did by hand.'}`;
        });
      }
      case 'attack': return receiveAttack(from, m);
      case 'combat': return receiveCombat(from, m);
      case 'pick':
        peers[from] = peers[from] || { board: null, cards: {} };
        peers[from].pick = String(m.deck || '').slice(0, 80);
        return refreshOnline();
      case 'start':
        if (!Online.players().length || from !== Online.players()[0].pid) return; // only the host starts games
        return beginMatch(m.rounds, m.first);
      case 'turn':
        activePid = from;
        status(`${nameOf(from)} started turn ${m.turn}.`);
        saveSoon(); // remembers whose turn it is
        return renderOpps();
      case 'pass':
        activePid = m.next;
        if (m.next === Online.id() && game) {
          startNextTurn(); // untaps, draws and tells everyone
          status(`${nameOf(from)} passed the turn to you. You untapped and drew.`, 'ok');
        }
        return renderOpps();
      case 'chat': {
        const msg = String(m.msg || '').slice(0, 500);
        chat.unshift({ at: Date.now(), from, msg });
        if (chat.length > 200) chat.length = 200;
        status(`${nameOf(from)}: ${msg}`);
        return renderLog();
      }
    }
  }

  // Another player changed your life. Quick clicks from the same player share one log line.
  function receiveLife(from, d) {
    if (!game || !Number.isFinite(d)) return;
    d = Math.max(-1000, Math.min(1000, Math.trunc(d)));
    game.life += d;
    remoteLife += d;
    let line = game.log[0];
    if (!(line && line.lifeFrom === from && Date.now() - line.at < 5000)) {
      Game.log(game, '');
      line = game.log[0];
      line.lifeFrom = from;
      line.lifeD = 0;
    }
    line.lifeD += d;
    line.at = Date.now();
    line.msg = `${nameOf(from)}: you ${line.lifeD < 0 ? 'lose' : 'gain'} ${Math.abs(line.lifeD)} life (now ${game.life}).`;
    afterChange();
  }

  Online.on({
    status: (st, msg) => {
      if (msg) status(msg, st === 'off' || st === 'lost' ? 'warn' : 'info');
      if (st === 'off') { peers = {}; activePid = null; inLobby = false; }
      refreshOnline();
    },
    notice: msg => status(msg, 'warn'),
    roster: players => {
      const ids = new Set(players.map(p => p.pid));
      for (const pid of Object.keys(peers)) if (!ids.has(pid)) delete peers[pid];
      if (activePid && !ids.has(activePid)) activePid = null;
      sentDefs = new Set(); // someone new may have joined: send them everything
      sendState();
      sendPick();
      refreshOnline();
    },
    message: onMessage,
  });

  // Redraws whatever shows the online state on the current tab.
  function refreshOnline() {
    if (ui.tab === 'play') renderPlay();
    else if (ui.tab === 'decks') refreshOnlinePanel();
  }

  async function startOnline(kind) {
    const name = ($('#onlineName') || {}).value;
    ui.playerName = (name || ui.playerName || '').trim() || 'Player';
    try {
      if (kind === 'host') {
        // A new game gets a new code if a saved game still uses the old one.
        const taken = games.some(g => g.online && g.online.code === ui.hostCode);
        await Online.host(ui.playerName, taken ? null : ui.hostCode);
        if (Online.code()) ui.hostCode = Online.code();
      } else {
        const code = kind === 'rejoin' ? Online.code() : ($('#joinCode') || {}).value;
        ui.joinCode = code;
        await Online.join(code, ui.playerName);
      }
    } catch (e) {
      status(e.message, 'error');
    }
    if (!Online.active()) { saveSoon(); return refreshOnline(); }
    // Joining from a saved online game whose host came back with a new code: keep playing it.
    const m = gameMeta();
    if (kind !== 'host' && game && m && m.online && m.online.role === 'guest'
      && (m.online.code === Online.code() || confirm(`Continue your saved game with ${game.deckName} (turn ${game.turn}) in game ${Online.code()}? Click Cancel to go to the lobby for a new game instead.`))) {
      m.online.code = Online.code();
      inLobby = false;
    } else inLobby = true;
    saveSoon();
    sendPick();
    setTab('play');
  }

  // ---------- playing against the computer (see bot.js) ----------

  const BOT = 'bot'; // Opp's id where other players have theirs
  const hasBot = () => !isOnline() && !!(game && game.bot);

  // Opp's table in the same shape another player's would arrive in, so it's drawn the same way.
  function peerOf(pid) {
    if (pid !== BOT) return peers[pid];
    if (!hasBot()) return null;
    const s = game.bot.s;
    const board = Object.assign(Online.snapshot(s), { life: game.oppLife, cmdDamage: {} });
    const cards = {};
    [...board.battlefield, ...board.graveyard, ...board.exile, ...board.command].forEach(c => { cards[c.iid] = c; });
    return { board, cards };
  }

  const kwText = st => (st.kw.size ? ' · ' + [...st.kw].join(', ') : '');
  const outcome = () => (game.oppLife <= 0 ? ' Opp is at 0 life: you win!' : game.life <= 0 ? ' You are at 0 life: Opp wins.' : '');

  function botPanelHtml() {
    const decks = allDecks();
    const has = k => decks.some(d => d.key === k);
    const you = has(ui.botYou) ? ui.botYou : decks.length ? decks[0].key : '';
    const opp = has(ui.botOpp) ? ui.botOpp : (decks[1] || decks[0] || {}).key;
    const first = ui.botFirst || 'roll';
    const opts = sel => decks.map(d => `<option value="${esc(d.key)}" ${d.key === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    return `<h3>Play against the computer</h3>
      <p class="muted small">Opp plays any of your decks with simple rules: a land each turn, the biggest spells it can afford, attacks that look safe and blocks that keep it alive.
        It casts creatures, artifacts and enchantments, and uses simple removal, burn and card draw. Other card text is ignored.</p>
      ${decks.length ? `<div class="toolbar tight">
        <label class="muted small">Your deck <select id="botYou">${opts(you)}</select></label>
        <label class="muted small">Opp's deck <select id="botOpp">${opts(opp)}</select></label>
        <label class="muted small">Who goes first <select id="botFirst">${[['roll', 'Roll a d20'], ['me', 'You'], ['opp', 'Opp']].map(([v, l]) => `<option value="${v}" ${v === first ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="btn" data-act="bot-play">Play</button>
      </div>` : '<p class="muted">Add a deck below first.</p>'}`;
  }

  async function playBot() {
    const you = $('#botYou').value;
    const opp = $('#botOpp').value;
    const first = $('#botFirst').value;
    Object.assign(ui, { botYou: you, botOpp: opp, botFirst: first });
    saveSoon();
    if (isOnline()) return status('Leave the online game first to play against the computer.');
    let oppFirst = first === 'opp';
    let note = '';
    if (first === 'roll') {
      let a;
      let c;
      do { a = Game.randomInt(20) + 1; c = Game.randomInt(20) + 1; } while (a === c);
      oppFirst = c > a;
      note = `d20 for first: you ${a}, Opp ${c}.`;
    }
    await startGame(you, oppFirst, false, opp, note);
  }

  // Opp's whole turn. If it attacks you pick blockers first; yoursNext then starts your turn.
  function oppTurn(yoursNext) {
    let res;
    act(() => {
      res = Bot.beginTurn(game, def);
      if (game.bot.tapChoice) game.bot.tapChoice.yoursNext = yoursNext;
      if (game.bot.pending) game.bot.pending.yoursNext = yoursNext;
      if (game.bot.wait) game.bot.wait.yoursNext = yoursNext;
    });
    if (res.waiting) return openRespond();
    if (res.tapChoice) return openTapChoice();
    afterOppMain(res, yoursNext);
  }

  function afterOppMain(res, yoursNext) {
    const did = res.notes.length ? `Opp ${res.notes.join(', ')}.` : '';
    if (game.bot.pending) return openBlocks(did);
    finishOppTurn(yoursNext, did);
  }

  // Opp waiting on you: your Sentinel's target at its beginning of combat, or your blocks.
  function oppWaiting() {
    if (game.bot.s.stack) return openRespond();
    if (game.bot.tapChoice) return openTapChoice();
    if (game.bot.pending) return openBlocks();
  }

  // "At the beginning of combat on each opponent's turn, tap target creature that player controls":
  // pick the creature for each of yours that has it. Opp's best would-be attacker is picked to start.
  function openTapChoice() {
    const choice = game.bot.tapChoice;
    if (!choice) return;
    const { tappers, targets, best } = Bot.tapChoices(game, def);
    blockPreviews = {};
    targets.forEach(x => { blockPreviews['a' + x.inst.iid] = x.inst; });
    tappers.forEach(t => { blockPreviews['b' + t.iid] = t; });
    const did = choice.notes.length ? `Opp ${choice.notes.join(', ')}.` : '';
    const rows = tappers.map(t => `<div class="block-row">
        <div class="viewer-card" data-peek="b${esc(t.iid)}"><div class="card readonly">${faceHtml(t)}</div></div>
        <div><b>${esc(t.name)}</b> <span class="muted">taps</span>
          <div class="block-picks">${targets.map(x => `<label class="check" data-peek="a${esc(x.inst.iid)}"><input type="radio" name="tap-${esc(t.iid)}" data-tapper="${esc(t.iid)}" value="${esc(x.inst.iid)}" ${x.inst === best ? 'checked' : ''}> ${esc(x.inst.name)} <span class="muted">(${x.st.pow}/${x.st.tou}${x.inst.tapped ? ', tapped' : ''})</span></label>`).join('')}</div>
        </div></div>`);
    openModal(`
      <div class="page-head"><h3>Opp's beginning of combat</h3><button class="btn ghost sm" data-act="close-modal" title="Look at the table first. The End turn button brings this back.">Later</button></div>
      ${did ? `<p class="small">${esc(did)}</p>` : ''}
      <p class="muted small">Pick the creature of Opp's to tap. Hover one to see it.</p>
      <div class="block-list">${rows.join('')}</div>
      <div class="toolbar"><button class="btn" data-act="taps-done">Tap</button></div>`);
  }

  function tapsDone() {
    const taps = {};
    for (const r of modalBox.querySelectorAll('[data-tapper]:checked')) taps[r.dataset.tapper] = r.value;
    const yoursNext = game.bot.tapChoice.yoursNext;
    closeModal();
    let res;
    act(() => {
      res = Bot.beginCombat(game, def, taps, game.bot.tapChoice.notes);
      if (game.bot.pending) game.bot.pending.yoursNext = yoursNext;
    });
    afterOppMain(res, yoursNext);
  }

  function finishOppTurn(yoursNext, before) {
    let notes;
    act(() => {
      notes = Bot.endTurn(game, def);
      if (game.bot.wait) Object.assign(game.bot.wait, { yoursNext, before });
    });
    if (game.bot.s.stack) return openRespond();
    if (yoursNext) startNextTurn();
    const msg = [before, notes.length ? `Opp ${notes.join(', ')}.` : ''].filter(Boolean).join(' ') || 'Opp didn\'t do anything this turn.';
    status(msg + outcome(), 'ok', 10000);
  }

  // ---------- combat ----------
  // Attacking Opp is resolved here and now. Online, the players you attack pick their own
  // blockers and do the damage on their side, then send back which of your creatures died.

  const loyaltyText = inst => { const n = Bot.loyaltyOf(inst, def(inst.id)); return n ? ` (loyalty ${n})` : ''; };
  const myName = () => (Online.players().find(p => p.pid === Online.id()) || {}).name || 'Player';
  const dies = inst => Game.move(game, inst.iid, inst.commander ? 'command' : 'graveyard');
  let incoming = []; // online attacks on you waiting for blockers: [{ from, attacks }]

  // Who you can attack: each opponent, and each of their planeswalkers.
  function attackTargets() {
    const out = [];
    for (const p of others()) {
      out.push({ value: p.pid + '|', label: p.name, pid: p.pid });
      const peer = peerOf(p.pid);
      for (const c of (peer && peer.board ? peer.board.battlefield : [])) {
        if (Bot.isPlaneswalker(c)) out.push({ value: p.pid + '|' + c.iid, label: `${p.name}'s ${c.name}${loyaltyText(c)}`, pid: p.pid, pw: c.iid, pwName: c.name });
      }
    }
    return out;
  }

  // A friend's table rules (see Bot.tableRules), checked. Older versions don't send them: no limits.
  function cleanRules(r) {
    const n = v => (Number.isInteger(v) && v >= 0 && v < 100 ? v : null);
    r = r && typeof r === 'object' ? r : {};
    const taxes = (Array.isArray(r.spellTaxes) ? r.spellTaxes : []).slice(0, 10).filter(x => x && typeof x === 'object')
      .map(x => ({ what: String(x.what || '').slice(0, 60), n: n(x.n) || 0, opps: !!x.opps }));
    const g = r.noGain && typeof r.noGain === 'object' ? r.noGain : {};
    return { arboria: !!r.arboria, acted: r.acted !== false, attackCap: n(r.attackCap), allAttackCap: n(r.allAttackCap), blockCap: n(r.blockCap),
      attackTax: n(r.attackTax) || 0, spellTaxes: taxes, noGain: { all: !!g.all, opps: !!g.opps, self: !!g.self } };
  }

  // Arboria, Mirri, Silent Arbiter: every table's combat rules. { mine, byPid, all }.
  function combatRules() {
    const mine = Bot.tableRules(game, def);
    const byPid = {};
    if (!isOnline() && hasBot()) byPid[BOT] = Bot.tableRules(game.bot.s, def);
    else others().forEach(p => { const peer = peers[p.pid]; byPid[p.pid] = (peer && peer.board && peer.board.rules) || cleanRules(null); });
    return { mine, byPid, all: [mine, ...Object.values(byPid)] };
  }

  const capText = why => why[0].toUpperCase() + why.slice(1);

  // Pick blockers for each attacker (more than one can block the same attacker; menace needs two).
  // list: [{ key, card, st, aim }], aim being what it's going after. limit: { cap, why }, the most
  // creatures you can block with this combat (Mirri).
  let blockPreviews = {}; // data-peek key → card, for hovering cards in the block popup
  let blockLimit = { cap: Infinity, why: '' };
  function openBlockModal(title, before, list, doneAct, laterTip, limit) {
    blockLimit = limit && limit.cap < Infinity ? limit : { cap: Infinity, why: '' };
    const mine = Bot.yourCreatures(game, def).filter(c => !c.inst.tapped);
    blockPreviews = {};
    for (const x of list) blockPreviews['a' + x.key] = x.card;
    for (const c of mine) blockPreviews['b' + c.inst.iid] = c.inst;
    // Brave the Sands: some can block more than one attacker.
    const allowed = Object.fromEntries(mine.map(c => [c.inst.iid, Bot.blocksAllowed(game, c.inst, def)]));
    const multi = mine.filter(c => allowed[c.inst.iid] > 1);
    const rows = list.map(x => {
      const can = mine.filter(c => Bot.canBlock(c.st, x.st, game));
      const menace = x.st.kw.has('menace');
      return `<div class="block-row">
        <div class="viewer-card" data-peek="a${esc(x.key)}"><div class="card readonly">${faceHtml(x.card)}</div></div>
        <div><b>${esc(x.card.name)}</b> <span class="muted">${x.st.pow}/${x.st.tou}${esc(kwText(x.st))}</span>
          <div class="block-aim">→ ${esc(x.aim)}</div>
          ${menace ? '<div class="muted small">Menace: block it with two or more creatures, or none.</div>' : ''}
          ${can.length ? `<div class="block-picks">${can.map(c => `<label class="check" data-peek="b${esc(c.inst.iid)}"><input type="checkbox" data-block="${esc(x.key)}" data-name="${esc(x.card.name)}" ${menace ? 'data-menace="1"' : ''} data-max="${allowed[c.inst.iid] === Infinity ? 999 : allowed[c.inst.iid]}" value="${esc(c.inst.iid)}"> ${esc(c.inst.name)} <span class="muted">(${c.st.pow}/${c.st.tou})</span></label>`).join('')}</div>`
            : '<div class="muted small">None of your untapped creatures can block it.</div>'}
        </div></div>`;
    });
    openModal(`
      <div class="page-head"><h3>${esc(title)}</h3><button class="btn ghost sm" data-act="close-modal" title="${esc(laterTip)}">Later</button></div>
      ${before ? `<p class="small">${esc(before)}</p>` : ''}
      <p class="muted small">Tick the creatures that block each attacker. Each of your creatures can block one attacker, and several can block the same one (the attacker's damage goes to them in the order listed). Unblocked attackers hit whatever they're aimed at: you, or one of your planeswalkers.</p>
      ${blockLimit.why ? `<p class="small"><b>${esc(capText(blockLimit.why))}.</b></p>` : ''}
      ${multi.length ? `<p class="small">${multi.map(c => `<b>${esc(c.inst.name)}</b> can block ${allowed[c.inst.iid] === Infinity ? 'any number of' : allowed[c.inst.iid]} attackers`).join(', ')}. Its damage goes to each one in turn, enough to kill it, the rest to the last.</p>` : ''}
      <div class="block-list">${rows.join('')}</div>
      <div class="toolbar"><button class="btn" data-act="${doneAct}">Done blocking</button></div>`);
  }

  // { attackerKey: [yourBlockerIid, …] }, or null (with a warning) if a creature blocks more
  // attackers than it can or a menace attacker has just one blocker.
  function readBlocks() {
    const blocks = {};
    const used = new Map(); // blocker → how many attackers it blocks
    const menace = {};
    for (const box of modalBox.querySelectorAll('[data-block]:checked')) {
      const n = (used.get(box.value) || 0) + 1;
      const max = Number(box.dataset.max) || 1;
      if (n > max) {
        const name = (game.cards[box.value] || {}).name || 'That creature';
        status(max === 1 ? 'Each of your creatures can only block one attacker.' : `${name} can block only ${max} attackers.`, 'warn');
        return null;
      }
      used.set(box.value, n);
      (blocks[box.dataset.block] = blocks[box.dataset.block] || []).push(box.value);
      if (box.dataset.menace) menace[box.dataset.block] = box.dataset.name;
    }
    if (used.size > blockLimit.cap) { status(`${capText(blockLimit.why)}.`, 'warn'); return null; }
    for (const [key, name] of Object.entries(menace)) {
      if (blocks[key].length < 2) { status(`${name} has menace: block it with two or more creatures, or none.`, 'warn'); return null; }
    }
    return blocks;
  }

  // Opp is attacking: pick a blocker for each attacker.
  function openBlocks(before) {
    const pending = game.bot.pending;
    if (!pending) return;
    const s = game.bot.s;
    const targets = pending.targets || {};
    const list = pending.attackers.map(iid => s.cards[iid]).filter(Boolean).map(a => {
      const pw = targets[a.iid] && game.cards[targets[a.iid]];
      return { key: a.iid, card: a, st: Bot.botStats(a), aim: pw && pw.zone === 'battlefield' ? `your ${pw.name}${loyaltyText(pw)}` : 'you' };
    });
    const limit = Bot.blockRules(combatRules().all, list.map(x => x.card), def);
    openBlockModal('Opp attacks you', before, list, 'blocks-done', 'Look at the table first. The End turn button brings this back.', limit);
  }

  function blocksDone() {
    const blocks = readBlocks();
    if (!blocks) return;
    const yoursNext = game.bot.pending.yoursNext;
    closeModal();
    let msg;
    act(() => { msg = Bot.resolveOppAttack(game, blocks, def); });
    finishOppTurn(yoursNext, msg);
  }

  // Your attack: pick creatures and what each one goes after (a player or a planeswalker).
  // Against Opp, it blocks and the damage is done; online, each player you attack blocks.
  function openAttack() {
    if (!game || !(hasBot() || isOnline())) return;
    if (hasBot() && (game.bot.pending || game.bot.tapChoice || game.bot.s.stack)) return oppWaiting();
    if (incoming.length) return openIncoming();
    if (isOnline() && activePid && activePid !== Online.id()) return status(`It's ${nameOf(activePid)}'s turn, not yours.`);
    const all = attackTargets();
    if (!all.length) return status('No one else is in the game yet.');
    // Arboria keeps players who did nothing last turn safe (their planeswalkers can still be attacked).
    const limits = attackLimits();
    const targets = all.filter(t => t.pw || limits.byPid[t.pid].cap > 0);
    const notes = Object.entries(limits.byPid).filter(([, l]) => l.why).map(([pid, l]) => `${nameOf(pid)}: ${l.why}.`);
    // "At the beginning of combat on your turn, …", once a turn.
    if (game.combatTriggerTurn !== game.turn && Bot.phaseTriggers(game, game, 'combat', def, null, true)) {
      act(() => { game.combatTriggerTurn = game.turn; Bot.phaseTriggers(game, game, 'combat', def, effectCtx()); });
    }
    // Opp's Sentinel of the Eternal Watch taps one of your creatures at the beginning of your combat.
    if (hasBot() && game.combatTapTurn !== game.turn && Bot.combatTappers(game.bot.s, def).length) {
      let taps;
      act(() => { taps = Bot.oppCombatTaps(game, def); });
      if (taps.length) status(taps.join(' '), 'warn', 8000);
    }
    const options = targets.map(t => `<option value="${esc(t.value)}">${esc(t.label)}</option>`).join('');
    let canAttack = false;
    const rows = Bot.yourCreatures(game, def).map(c => {
      const why = c.inst.attackedTurn === game.turn ? 'already attacked this turn' : c.inst.tapped ? 'tapped' : c.inst.enteredTurn === game.turn && !c.st.kw.has('haste') ? 'arrived this turn'
        : c.st.kw.has("can't attack") ? "can't attack" : Bot.noAttack(c.st) ? 'defender' : '';
      if (!why) canAttack = true;
      return `<div class="attack-row ${why ? 'muted' : ''}"><label><input type="checkbox" data-attacker="${esc(c.inst.iid)}" ${why ? 'disabled' : ''}>
        <b>${esc(c.inst.name)}</b> ${c.st.pow}/${c.st.tou}${esc(kwText(c.st))}${why ? ` <span class="small">(${why})</span>` : ''}</label>
        ${why ? '' : `<select data-target="${esc(c.inst.iid)}" title="What it attacks">${options}</select>`}</div>`;
    });
    // Vehicles that aren't crewed yet: crew them first, then they show up above as attackers.
    const vehicles = game.zones.battlefield.map(id => game.cards[id])
      .filter(v => Game.isVehicle(v) && !v.crewed && !v.faceDown && Bot.crewOf(v, def) != null)
      .map(v => {
        const st = Bot.stats(v, def(v.id));
        return `<div class="attack-row"><span><b>${esc(v.name)}</b> ${st.pow}/${st.tou}${esc(kwText(st))} <span class="muted small">(Vehicle · Crew ${Bot.crewOf(v, def)})</span></span>
          <button class="btn sm" data-act="crew" data-iid="${esc(v.iid)}" data-back="attack">Crew…</button></div>`;
      });
    const who = isOnline() ? 'the players you attack pick their blocks' : 'Opp picks its blocks';
    openModal(`
      <div class="page-head"><h3>Attack</h3><button class="btn ghost sm" data-act="close-modal">Cancel</button></div>
      <p class="muted small">Tick the creatures that attack and pick what each one goes after: a player or one of their planeswalkers.
        Then ${who}, the damage is done and creatures that die go to the graveyard (commanders to the command zone).
        "Whenever this attacks" pumps (like Ashcoat's) and tokens that enter attacking (like Leonin Warleader's and Brimaz's) are counted; pump spells and other abilities aren't, so use counters first, or Undo if it should have gone differently.</p>
      ${notes.map(n => `<p class="small"><b>${esc(n)}</b></p>`).join('')}
      ${targets.length && canAttack ? `<div class="toolbar tight"><button class="btn sm ghost" data-act="attack-all" data-on="1">Select all that can attack</button><button class="btn sm ghost" data-act="attack-all" data-on="">Clear</button></div>` : ''}
      ${!targets.length ? '<p class="muted">There\'s no one you can attack this combat.</p>' : rows.length ? `<div class="attack-list">${rows.join('')}</div>` : '<p class="muted">You have no creatures on the battlefield.</p>'}
      ${vehicles.length ? `<h4>Vehicles</h4><p class="muted small">Crew a Vehicle by tapping creatures with enough total power. It's a creature until the turn ends, and then it can attack.</p><div class="attack-list">${vehicles.join('')}</div>` : ''}
      <div class="toolbar"><button class="btn" data-act="attack-go" ${canAttack && targets.length ? '' : 'disabled'}>Attack</button></div>`);
  }

  // The limits on attacking each other player this combat (Arboria, Mirri, Silent Arbiter):
  // { byPid: { pid: { cap, why } }, total: the most creatures that can attack at all }.
  function attackLimits() {
    const rules = combatRules();
    const byPid = {};
    for (const [pid, r] of Object.entries(rules.byPid)) byPid[pid] = Bot.attackRules(rules.all, r);
    const total = rules.all.reduce((n, r) => (r.allAttackCap == null ? n : Math.min(n, r.allAttackCap)), Infinity);
    return { byPid, total };
  }

  // Crew: tick untapped creatures whose total power is at least the Vehicle's crew number.
  // back: 'attack' to return to the attack screen afterwards.
  function openCrew(iid, back) {
    const v = game.cards[iid];
    const n = v && Bot.crewOf(v, def);
    if (!v || n == null) return;
    if (v.crewed) return status(`${v.name} is already crewed this turn.`);
    const crew = Bot.yourCreatures(game, def).filter(c => !c.inst.tapped && c.inst.iid !== iid);
    openModal(`
      <div class="page-head"><h3>Crew ${esc(v.name)}</h3><button class="btn ghost sm" data-act="${back === 'attack' ? 'attack' : 'close-modal'}">Back</button></div>
      <p class="muted small">Crew ${n}: tap any of your untapped creatures with total power ${n} or more. Creatures that just arrived can crew. Crewing creatures can't attack this turn, since they're tapped.</p>
      ${crew.length ? `<div class="attack-list">${crew.map(c => `<label class="check"><input type="checkbox" data-crew="${esc(c.inst.iid)}" data-pow="${c.st.pow}"> <b>${esc(c.inst.name)}</b> <span class="muted">power ${c.st.pow}</span></label>`).join('')}</div>`
        : '<p class="muted">You have no untapped creatures to crew it with.</p>'}
      <div class="toolbar"><button class="btn" data-act="crew-go" data-iid="${esc(iid)}" data-back="${esc(back || '')}" ${crew.length ? '' : 'disabled'}>Crew</button></div>`);
  }

  function crewGo(iid, back) {
    const v = game.cards[iid];
    if (!v) return;
    const n = Bot.crewOf(v, def);
    const picks = [...modalBox.querySelectorAll('[data-crew]:checked')];
    const power = picks.reduce((sum, x) => sum + Number(x.dataset.pow), 0);
    if (power < n) return status(`Not enough power: ${power} of the ${n} needed to crew ${v.name}.`, 'warn');
    closeModal();
    act(() => {
      picks.forEach(x => { const c = game.cards[x.dataset.crew]; if (c) { c.tapped = true; c.tappedFor = null; } });
      v.crewed = true;
      v.crewedBy = picks.map(x => x.dataset.crew); // untapped again if you uncrew it
      Game.log(game, `Crewed ${v.name} with ${picks.map(x => game.cards[x.dataset.crew].name).join(', ')}. It's a creature until the turn ends.`);
    });
    if (back === 'attack') openAttack();
  }

  function attackGo() {
    const aim = {};
    modalBox.querySelectorAll('[data-target]').forEach(sel => { aim[sel.dataset.target] = sel.value; });
    const targets = new Map(attackTargets().map(t => [t.value, t]));
    const picks = [...modalBox.querySelectorAll('[data-attacker]:checked')].map(x => ({ iid: x.dataset.attacker, to: targets.get(aim[x.dataset.attacker]) })).filter(p => p.to);
    if (!picks.length) return status('Tick at least one creature to attack with.');
    // Silent Arbiter caps every attacker; Mirri only the ones attacking her controller, not their planeswalkers.
    const limits = attackLimits();
    if (picks.length > limits.total) return status(`No more than ${limits.total} creature${limits.total === 1 ? '' : 's'} can attack each combat.`, 'warn');
    for (const [pid, l] of Object.entries(limits.byPid)) {
      const n = picks.filter(p => p.to.pid === pid && !p.to.pw).length;
      if (n > l.cap) return status(`${nameOf(pid)}: ${l.why}. You picked ${n}.`, 'warn');
    }
    // Ghostly Prison, Propaganda: pay for each creature attacking that player.
    const tax = Object.entries(limits.byPid).reduce((sum, [pid, l]) => sum + l.tax * picks.filter(p => p.to.pid === pid && !p.to.pw).length, 0);
    if (tax && !Game.autoPay(JSON.parse(JSON.stringify(game)), `{${tax}}`)) return status(`Attacking with these costs {${tax}} (Ghostly Prison and the like), and your untapped mana can't pay it.`, 'warn');
    const payTax = () => {
      if (!tax) return;
      const paid = Game.autoPay(game, `{${tax}}`);
      Game.log(game, `Paid {${tax}} to attack${paid && paid.sources.length ? ` (tapped ${paid.sources.join(', ')})` : ''}.`);
    };
    closeModal();
    if (!isOnline()) {
      // Interceptor in your graveyard: "you may pay {2}{B}. If you do, return this card … tapped and attacking."
      const back = Bot.graveAttackers(game, picks.map(p => game.cards[p.iid]), def).filter(g => Game.autoPay(JSON.parse(JSON.stringify(game)), g.cost));
      const go = extra => {
        let state;
        act(() => {
          payTax();
          extra.forEach(g => {
            const paid = Game.autoPay(game, g.cost);
            Game.log(game, `Paid ${g.cost} for ${g.inst.name}${paid && paid.sources.length ? ` (tapped ${paid.sources.join(', ')})` : ''}.`);
            picks.push({ iid: Bot.returnAttacking(game, g.inst), to: picks.find(p => !p.to.pw) ? picks.find(p => !p.to.pw).to : picks[0].to });
          });
          if (picks.length) Bot.attackWatch(game, game, def, effectCtx(), picks.map(p => game.cards[p.iid])); // "Whenever you attack, …"
          state = Bot.yourAttackBlocks(game, picks.map(p => ({ iid: p.iid, pw: p.to.pw || null })), def);
        });
        const finish = () => {
          let msg;
          act(() => { msg = Bot.finishYourAttack(game, state.attackers, state.blocks, def, state.answered, effectCtx()); });
          status(msg + outcome(), 'ok', 10000);
        };
        // Ninjutsu: after Opp blocks, swap an unblocked attacker for a ninja in your hand.
        const unblocked = state.attackers.filter(a => !(state.blocks.get(a) || []).length && a.inst.zone === 'battlefield');
        const ninjas = game.zones.hand.map(iid => game.cards[iid]).filter(c => Bot.ninjutsuOf(c, def) && Game.autoPay(JSON.parse(JSON.stringify(game)), Bot.ninjutsuOf(c, def)));
        if (!unblocked.length || !ninjas.length) return finish();
        openModal(`<div class="ask"><h3>Ninjutsu?</h3><p class="muted small">Unblocked: ${esc(unblocked.map(a => a.inst.name).join(', '))}. Pay a ninja's ninjutsu cost to return one of them to your hand and put the ninja in tapped and attacking.</p>
          <div class="block-picks">${ninjas.flatMap(n => unblocked.map(a => `<button type="button" class="btn ghost" data-nj="${n.iid}|${a.inst.iid}" style="display:block;width:100%;text-align:left;margin:4px 0">${esc(n.name)} (${esc(Bot.ninjutsuOf(n, def))}) for ${esc(a.inst.name)}</button>`)).join('')}</div>
          <div class="toolbar end"><button type="button" class="btn" data-nj="no">No ninjutsu</button></div></div>`);
        modalBox.querySelectorAll('[data-nj]').forEach(b => {
          b.onclick = () => {
            closeAsk();
            if (b.dataset.nj !== 'no') {
              const [ninja, attacker] = b.dataset.nj.split('|');
              act(() => {
                const paid = Game.autoPay(game, Bot.ninjutsuOf(game.cards[ninja], def));
                Game.log(game, `Paid ${Bot.ninjutsuOf(game.cards[ninja], def)} for ninjutsu${paid && paid.sources.length ? ` (tapped ${paid.sources.join(', ')})` : ''}.`);
                Bot.ninjutsu(game, state, attacker, ninja, def);
              });
            }
            finish();
          };
        });
      };
      if (!back.length) return go([]);
      const g = back[0];
      openModal(`<div class="ask"><h3>${esc(g.inst.name)}</h3><p>You're attacking with a legendary creature. Pay ${esc(g.cost)} to return ${esc(g.inst.name)} from your graveyard tapped and attacking?</p>
        <div class="toolbar end"><button type="button" class="btn ghost" data-ic="no">No</button><button type="button" class="btn" data-ic="yes">Pay ${esc(g.cost)}</button></div></div>`);
      modalBox.querySelector('[data-ic=no]').onclick = () => { closeAsk(); go([]); };
      modalBox.querySelector('[data-ic=yes]').onclick = () => { closeAsk(); go([g]); };
      return;
    }
    const byPlayer = new Map();
    const attackers = picks.map(p => game.cards[p.iid]);
    act(() => {
      payTax();
      const lines = [];
      // "Whenever this attacks" pumps, exalted and battle cry first, so the stats sent include them.
      // Tokens that enter tapped and attacking (Leonin Warleader's Cats) go after the same player.
      const sacrifice = (n, why) => Game.log(game, `${why}: the player it attacks sacrifices ${n} permanent${n === 1 ? '' : 's'} (they do that on their side).`);
      Bot.declareAttack(game, attackers, def, { sacrifice, game, ctx: effectCtx() }).forEach(([from, iid]) => picks.push({ iid, to: picks.find(p => p.iid === from).to }));
      if (attackers.length) Bot.attackWatch(game, game, def, effectCtx(), attackers);
      for (const p of picks) {
        const inst = game.cards[p.iid];
        if (!inst || inst.zone !== 'battlefield') continue;
        const st = Bot.stats(inst, def(inst.id));
        if (!st.kw.has('vigilance')) inst.tapped = true;
        inst.attackedTurn = game.turn;
        if (!byPlayer.has(p.to.pid)) byPlayer.set(p.to.pid, []);
        byPlayer.get(p.to.pid).push({ iid: inst.iid, id: inst.faceDown ? null : inst.id, name: inst.name, pow: st.pow, tou: st.tou, kw: [...st.kw], n: st.n, colors: st.colors, artifact: st.artifact, commander: !!inst.commander, pw: p.to.pw || null });
        lines.push(`${inst.name} → ${p.to.pw ? `${nameOf(p.to.pid)}'s ${p.to.pwName}` : nameOf(p.to.pid)}`);
      }
      Game.log(game, `Attacked: ${lines.join(', ')}.`);
    });
    // Mirri attacking: they can block with only one creature.
    const limit = Bot.blockRules([], attackers, def);
    const cap = limit.cap < Infinity ? { blockCap: limit.cap, blockWhy: limit.why } : {};
    for (const [pid, attacks] of byPlayer) Online.send({ t: 'attack', attacks, ...cap }, pid);
    act(() => Bot.endOfCombat(game, attackers, def)); // decayed: sacrificed (their stats were already sent)
    status(`Attacking. Waiting for ${[...byPlayer.keys()].map(nameOf).join(' and ')} to block.`, 'ok', 10000);
  }

  // Online: another player attacks you. Their attackers come with the stats they had when they attacked.
  function receiveAttack(from, m) {
    if (!game) return;
    const num = v => Math.max(-99, Math.min(99, Math.trunc(Number(v)) || 0));
    const attacks = (Array.isArray(m.attacks) ? m.attacks : []).slice(0, 60).filter(a => a && typeof a === 'object').map(a => ({
      iid: String(a.iid || ''), id: a.id ? String(a.id) : null, name: String(a.name || 'Creature').slice(0, 80),
      pow: num(a.pow), tou: num(a.tou), kw: (Array.isArray(a.kw) ? a.kw : []).map(String).filter(k => k.length < 20).slice(0, 20),
      colors: (Array.isArray(a.colors) ? a.colors : []).map(String).filter(k => Game.MANA.includes(k)), artifact: !!a.artifact,
      commander: !!a.commander, pw: a.pw ? String(a.pw) : null,
      // Numbered keywords (toxic 2, bushido 1…)
      n: Object.fromEntries(Object.entries(a.n && typeof a.n === 'object' ? a.n : {}).slice(0, 10).map(([k, v]) => [String(k).slice(0, 20), Math.max(0, num(v))])),
    }));
    if (!attacks.length) return;
    const cap = Number.isInteger(m.blockCap) && m.blockCap >= 0 ? m.blockCap : null;
    incoming.push({ from, attacks, blockCap: cap, blockWhy: cap == null ? '' : String(m.blockWhy || `no blocking with more than ${cap} creatures`).slice(0, 160) });
    updateTurnButtons();
    if (modal.hidden) openIncoming();
    else status(`${nameOf(from)} is attacking you. Click the Block button to pick your blockers.`, 'warn', true);
  }

  function openIncoming() {
    const fight = incoming[0];
    if (!fight) return;
    const peer = peers[fight.from];
    const list = fight.attacks.map(a => {
      const pw = a.pw && game.cards[a.pw];
      return {
        key: a.iid,
        card: (peer && peer.cards[a.iid]) || { iid: a.iid, id: a.id, name: a.name },
        st: { pow: a.pow, tou: a.tou, kw: new Set(a.kw), n: a.n || {}, cmc: 0, colors: a.colors || [], artifact: !!a.artifact },
        aim: pw && pw.zone === 'battlefield' ? `your ${pw.name}${loyaltyText(pw)}` : a.pw ? 'your planeswalker (already gone)' : 'you',
      };
    });
    // Silent Arbiter on any table, and Mirri attacking (the attacker sends that one).
    const limit = Bot.blockRules(combatRules().all, [], def);
    if (fight.blockCap != null && fight.blockCap < limit.cap) Object.assign(limit, { cap: fight.blockCap, why: fight.blockWhy });
    openBlockModal(`${nameOf(fight.from)} attacks you`, '', list, 'blocks-online', 'Look at the table first. The Block button brings this back.', limit);
  }

  // Your blocks against another player: the damage is done here, and they're told which of
  // their creatures died and how much life lifelink gave them.
  function blocksOnlineDone() {
    const blocks = readBlocks();
    if (!blocks) return;
    const fight = incoming.shift();
    closeModal();
    updateTurnButtons();
    if (!fight) return;
    const who = nameOf(fight.from);
    const me = myName();
    const dead = [];
    const hitIids = []; // their attackers that dealt combat damage to you, for their "deals combat damage to a player" triggers
    let gain = 0;
    let dmg = 0;
    let poison = 0;
    const wither = {}; // their attacker iid → -1/-1 counters from your infect or wither blockers
    const mine = [];
    const theirs = [];
    act(() => {
      // Your "whenever this blocks" triggers happen before any damage.
      Bot.blockTriggers(game, blocks, def, effectCtx());
      // Everyone's stats first: a creature of yours can block more than one (Brave the Sands).
      const plan = fight.attacks.map(a => {
        const bl = (blocks[a.iid] || []).map(id => game.cards[id]).filter(b => b && b.zone === 'battlefield');
        return { st: { pow: a.pow, tou: a.tou, kw: new Set(a.kw), n: a.n || {}, cmc: 0, colors: a.colors || [], artifact: !!a.artifact }, bl, blockers: bl.map(b => ({ key: b.iid, st: Bot.stats(b, def(b.id)) })) };
      });
      const results = Bot.combatAll(plan);
      for (const [i, a] of fight.attacks.entries()) {
        const { st: ast, bl, blockers } = plan[i];
        const bsts = blockers.map(b => b.st);
        const r = results[i];
        const hit = r.player;
        const ll = Bot.lifelinkGain(ast, bsts, r);
        gain += ll.attacker;
        game.life += ll.blockers;
        const pw = a.pw && game.cards[a.pw];
        const pwLive = pw && pw.zone === 'battlefield';
        if (a.pw) {
          if (hit && pwLive) Bot.damagePlaneswalker(pw, def(pw.id), hit);
        } else if (hit) {
          const ph = Bot.playerHit(ast, hit); // infect: poison instead of life; toxic: poison too
          dmg += ph.life;
          poison += ph.poison;
          hitIids.push(a.iid);
          if (a.commander) {
            const key = `${who}|${a.name}`;
            game.cmdDamage = game.cmdDamage || {};
            game.cmdDamage[key] = (game.cmdDamage[key] || 0) + hit;
          }
        }
        // The same line twice: for your log ("your Bear") and for theirs ("Ann's Bear").
        const line = yours => {
          const own = n => (yours ? `your ${n}` : `${me}'s ${n}`);
          let t = bl.length ? `${a.name} is blocked by ${Bot.blockText(a.name, bl.map(b => b.name), r, own, n => n)}` : '';
          if (a.pw) {
            const name = pwLive ? pw.name : 'planeswalker';
            if (!bl.length) t = `${a.name} attacks ${own(name)}`;
            if (hit && pwLive) t += `${bl.length ? ',' : ':'} ${hit} damage to ${own(name)}${pw.counters.loyalty <= 0 ? ', which dies' : ` (loyalty ${pw.counters.loyalty})`}`;
          } else if (!bl.length) t = `${a.name} hits ${yours ? 'you' : me} for ${hit}`;
          else if (hit) t += `, ${hit} tramples over`;
          return t;
        };
        mine.push(line(true));
        theirs.push(line(false));
        if (r.a.dead) dead.push(a.iid);
        bl.forEach((b, i) => { if (r.b[i].dead && !Bot.regenerates(game, b, def, false)) dies(b); });
        // Infect and wither: -1/-1 counters on your blockers that live; theirs are put on by them.
        const w = Bot.witherCounters(ast, bsts, r);
        bl.forEach((b, i) => { if (w.b[i] && b.zone === 'battlefield') Game.counter(game, b.iid, '-1/-1', w.b[i], { effect: true }); });
        if (w.a && !r.a.dead) wither[a.iid] = w.a;
        if (pwLive && (pw.counters || {}).loyalty <= 0) dies(pw);
      }
      game.life -= dmg;
      game.poison = (game.poison || 0) + poison;
      Game.log(game, `${who} attacked: ${mine.join('; ')}.${dmg ? ` You took ${dmg} (now ${game.life}).` : ''}${poison ? ` You got ${poison} poison (now ${game.poison}).` : ''}`);
      Bot.dealtDamage(game, dmg, def);
      Bot.combatOver(game); // Wall of Junk
    });
    // Combat damage to the monarch: the attacker becomes the monarch.
    const crown = hitIids.length > 0 && amMonarch();
    if (crown) act(() => { delete game.monarch; Game.log(game, `${who} dealt you combat damage and became the monarch.`); });
    const msg = `${me} blocked: ${theirs.join('; ')}.${dmg ? ` ${me} took ${dmg} (now ${game.life}).` : ''}${poison ? ` ${me} got ${poison} poison.` : ''}${gain ? ` You gain ${gain} life.` : ''}${crown ? ' You are the monarch now.' : ''}`;
    Online.send({ t: 'combat', dead, gain, msg, hit: hitIids, wither, monarch: crown }, fight.from);
    status(`${who} attacked: ${mine.join('; ')}.${dmg ? ` You took ${dmg} (now ${game.life}).` : ''}${poison ? ` You got ${poison} poison.` : ''}`, 'ok', 10000);
    if (incoming.length) openIncoming();
  }

  // The player you attacked has blocked: your creatures that died go, and lifelink gains you life.
  function receiveCombat(from, m) {
    if (!game) return;
    for (const iid of (Array.isArray(m.dead) ? m.dead : []).map(String)) {
      const inst = game.cards[iid];
      if (inst && inst.zone === 'battlefield' && !Bot.regenerates(game, inst, def, false)) dies(inst);
    }
    const gain = Math.max(0, Math.min(1000, Math.trunc(Number(m.gain)) || 0));
    game.life += gain;
    remoteLife += gain; // kept through Undo, like other players' life changes
    // Their infect or wither blockers: -1/-1 counters on your attackers that lived.
    for (const [iid, n] of Object.entries(m.wither && typeof m.wither === 'object' ? m.wither : {})) {
      const inst = game.cards[iid];
      const k = Math.max(0, Math.min(99, Math.trunc(Number(n)) || 0));
      if (inst && inst.zone === 'battlefield' && k) Game.counter(game, iid, '-1/-1', k, { effect: true });
    }
    if (m.monarch === true) game.monarch = Date.now(); // you dealt combat damage to the monarch
    const msg = String(m.msg || `${nameOf(from)} blocked.`).slice(0, 1500);
    Game.log(game, msg);
    // "Whenever one or more creatures you control … deal combat damage to a player" (Kutzil, Feline Sovereign).
    const hits = (Array.isArray(m.hit) ? m.hit : []).map(String).map(iid => game.cards[iid])
      .filter(inst => inst && (inst.zone === 'battlefield' || inst.zone === 'graveyard'))
      .map(inst => ({ inst, st: Bot.stats(inst, def(inst.id)), card: def(inst.id) }));
    Bot.combatDamage(game, hits, def, effectCtx());
    status(msg, 'ok', 10000);
    afterChange();
  }

  // ---------- lobby ----------

  const pickedDeckName = () => {
    const d = findDeck(onlineDeckKey());
    return d ? d.name : '';
  };
  // Tells the others which deck you picked, for the lobby.
  function sendPick() {
    if (Online.connected()) Online.send({ t: 'pick', deck: pickedDeckName() });
  }

  function renderLobby() {
    const st = Online.state();
    const code = Online.code();
    const isHost = Online.role() === 'host';
    const players = Online.players();
    const me = Online.id();
    const deckOf = p => (p.pid === me ? pickedDeckName() : (peers[p.pid] && (peers[p.pid].pick || (peers[p.pid].board && peers[p.pid].board.deckName))) || '');
    const ready = players.length >= 2 && players.every(p => deckOf(p));
    const inProgress = players.some(p => p.pid !== me && peers[p.pid] && peers[p.pid].board);
    view.innerHTML = `
      <div class="lobby panel">
        <div class="page-head">
          <h2>Game lobby</h2>
          <button class="btn sm danger" data-act="leave">Leave</button>
        </div>
        ${st === 'connecting' || st === 'starting' ? '<p class="muted">Connecting…</p>' : `
        <div class="lobby-code">
          <span class="muted">Game code</span> <b class="game-code">${esc(code)}</b>
          ${isHost ? '<button class="btn sm ghost" data-act="copy-code">Copy</button>' : ''}
          <span class="muted small">${isHost ? `Send this code to your friends (up to ${Online.MAX_PLAYERS} players).` : ''}</span>
        </div>
        ${st === 'lost' ? '<p class="bad">Lost the connection to the host. <button class="btn sm" data-act="rejoin">Rejoin</button></p>' : ''}
        <h3>Players (${players.length}/${Online.MAX_PLAYERS})</h3>
        <ul class="lobby-players">${players.map((p, i) => {
          const deck = deckOf(p);
          return `<li>
            <span class="dot ${deck ? 'ok' : ''}"></span>
            <b>${esc(p.name)}</b>${p.pid === me ? ' <span class="muted">(you)</span>' : ''}${i === 0 ? ' <span class="pill">host</span>' : ''}
            <span class="lobby-deck">${deck ? esc(deck) : '<span class="muted">picking a deck…</span>'}</span>
          </li>`;
        }).join('')}</ul>
        ${players.length < 2 ? '<p class="muted">Waiting for friends to join…</p>' : ''}
        <div class="toolbar">${deckSelectHtml()}</div>
        ${inProgress && !isHost ? `<p>A game is already going. <button class="btn sm" data-act="online-play">Join in with this deck</button></p>` : ''}
        <div class="lobby-start">
          ${isHost
            ? `<button class="btn big" data-act="start-match" ${ready ? '' : 'disabled'}>🎲 Roll for first &amp; start</button>
               <span class="muted small">${ready ? 'Everyone rolls a d20. Highest goes first (ties roll again).' : players.length < 2 ? 'You need at least one friend to start.' : 'Waiting for everyone to pick a deck.'}</span>`
            : '<span class="muted">Waiting for the host to start the game. Everyone rolls a d20 and the highest goes first.</span>'}
        </div>
        ${game ? `<p class="muted small">You have a game in progress with ${esc(game.deckName)}. <button class="link-btn" data-act="back-to-game">Back to it</button></p>` : ''}`}
      </div>`;
  }

  // Host: everyone rolls a d20, ties among the highest roll again, then everyone starts.
  function startMatch() {
    const players = Online.players();
    if (players.length < 2) return;
    if (others().some(p => peers[p.pid] && peers[p.pid].board) && !confirm('Start a new game for everyone? Current games will be lost.')) return;
    const rounds = [];
    let rolling = players.map(p => p.pid);
    while (rolling.length > 1) {
      const round = rolling.map(pid => ({ pid, r: Game.randomInt(20) + 1 }));
      rounds.push(round);
      const top = Math.max(...round.map(x => x.r));
      rolling = round.filter(x => x.r === top).map(x => x.pid);
    }
    const first = rolling[0];
    Online.send({ t: 'start', rounds, first });
    beginMatch(rounds, first);
  }

  async function beginMatch(rounds, first) {
    const key = onlineDeckKey();
    if (!key || !Array.isArray(rounds)) return;
    // Whoever goes first starts with turn 1's card already drawn. Everyone else draws when their turn comes.
    await startGame(key, first === Online.id());
    activePid = first;
    if (first !== Online.id()) { game.turn = 0; game.offTurn = true; }
    const name = pid => (pid === Online.id() ? 'You' : nameOf(pid));
    rounds.forEach((round, i) => {
      const line = round.map(x => `${name(x.pid)} ${x.r}`).join(', ');
      Game.log(game, `${i ? 'Tie, roll again' : 'd20 for first'}: ${line}.`);
    });
    const msg = first === Online.id() ? 'You rolled highest and go first!' : `${nameOf(first)} rolled highest and goes first.`;
    Game.log(game, msg);
    status(msg, 'ok');
    afterChange();
    renderOpps();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(Online.code());
      status('Game code copied. Send it to your friends.', 'ok');
    } catch (e) {
      status(`Your game code is ${Online.code()}`, 'info-sticky');
    }
  }

  // replace: start over in place of the current game (Reset). Online, a new deck or a new
  // match replaces the game you're connected to. Otherwise it's a new saved game.
  // botKey: play against the computer with that deck (onDraw then means Opp goes first).
  async function startGame(deckKey, onDraw, replace, botKey, note) {
    replace = replace || linkedOnline(gameMeta());
    const deck = findDeck(deckKey);
    const botDeck = botKey && findDeck(botKey);
    if (!deck || (botKey && !botDeck)) return status('That deck is no longer available.', 'error');
    try {
      await ensureDefs([...deck.rows, ...(botDeck ? botDeck.rows : [])].map(r => r.id), true);
    } catch (e) {
      status('Could not reach Scryfall for card images. Playing with text cards. (' + e.message + ')', 'warn');
    }
    const defsOf = d => {
      const defs = {};
      d.rows.forEach(r => { if (def(r.id)) defs[r.id] = def(r.id); });
      return defs;
    };
    const g = Game.create(deck, defsOf(deck), { onDraw });
    if (botDeck) {
      g.bot = Bot.create(botDeck, defsOf(botDeck), { onDraw: !onDraw });
      g.oppLife = botDeck.rows.some(r => r.commander) ? 40 : 20;
      Game.log(g, `${note ? note + ' ' : ''}Playing against Opp with ${botDeck.name}. ${onDraw ? 'Opp goes first.' : 'You go first.'}`);
    }
    useNewGame(g, replace);
    inLobby = false;
    ui.onlineDeck = deckKey;
    undoStack = [];
    sample = null;
    setTab('play');
    saveSoon();
    syncSoon();
    if (botDeck && onDraw) oppTurn(false);
    else if (botDeck) status(`${note ? note + ' ' : ''}You go first.`, 'ok');
  }

  // Fills in mana and life info for a game saved before those features existed.
  async function upgradeSavedGame() {
    const ids = Object.values(game.cards).map(c => c.id).filter(Boolean);
    try {
      await ensureDefs(ids, true);
    } catch (e) {
      return;
    }
    if (!game) return;
    for (const inst of Object.values(game.cards)) {
      const c = def(inst.id);
      if (!c) continue;
      if (inst.produces == null && Array.isArray(c.producedMana)) inst.produces = c.producedMana;
      if (inst.cmc === undefined) { inst.cmc = c.cmc || 0; inst.cost = c.manaCost || ''; } // for sorting the hand
      if (inst.enterLife === undefined) inst.enterLife = Game.enterLife(c.name, c.oracle);
      if (inst.enterDraw === undefined) inst.enterDraw = Game.enterDraw(c.name, c.oracle);
      if (inst.mana == null) { // lands keep only "{1}, {T}: Add {G}{W}" (older games have null for those)
        const m = Game.manaAbility(c.name, c.oracle);
        inst.mana = Game.isLand(inst) && !(m && m.filter) ? null : m;
      }
      if (!inst.entersTapped) inst.entersTapped = Game.entersTapped(c.name, c.oracle); // also picks up "enters tapped unless…" on older games
      if (inst.loyalty === undefined) inst.loyalty = c.loyalty == null ? null : c.loyalty; // planeswalkers' starting loyalty
      if (inst.doubles === undefined) inst.doubles = Game.doublesOf(c.oracle); // Doubling Season and the like
    }
    Game.sortHand(game);
    // Opp's cards too, for "enters tapped unless…" lands in games saved before that was read.
    for (const inst of Object.values(game.bot ? game.bot.s.cards : {})) {
      const c = def(inst.id);
      if (c && !inst.entersTapped) inst.entersTapped = Game.entersTapped(c.name, c.oracle);
      if (c && inst.loyalty === undefined) inst.loyalty = c.loyalty == null ? null : c.loyalty;
      if (c && inst.doubles === undefined) inst.doubles = Game.doublesOf(c.oracle);
    }
    afterChange();
  }

  // The face that's up on a two-faced card (Bot.faceOracle).
  const oracleOf = inst => { const c = def(inst.id) || {}; return Bot.faceOracle(c.oracle, c.name || inst.name, inst.flipped); };

  // What a spell from your hand or the command zone costs right now, or null if Auto-tap won't pay for it.
  // Also from your graveyard (Ebondeath) or exile (Reno and Rude: any mana works; Ugin: free).
  // opts.cost: another cost picked for it (offspring, freerunning, Baleful Mastery's).
  function castCost(inst, opts = {}) {
    const fromHand = inst.zone === 'hand' || inst.zone === 'command' || (inst.zone === 'graveyard' && opts.cast) || (inst.zone === 'exile' && inst.playable);
    if (!ui.autoTap || !fromHand || Game.isLand(inst) || opts.flip || opts.faceDown) return null;
    let cost = opts.cost != null ? opts.cost : (def(inst.id) || {}).manaCost || '';
    if (inst.zone === 'exile' && inst.playable && inst.playable.free) cost = '';
    if (inst.zone === 'exile' && inst.playable && inst.playable.anyMana) cost = cost.replace(/\{[WUBRG](?:\/[WUBRGP2])?\}/gi, '{1}');
    const cmdTax = inst.zone === 'command' && inst.commander ? (inst.castCount || 0) * 2 : 0;
    // Thalia and the like, on any table.
    const rules = combatRules();
    const more = Bot.spellTax([{ rules: rules.mine, own: true }, ...Object.values(rules.byPid).map(r => ({ rules: r, own: false }))], inst, def);
    const tax = cmdTax + more;
    const less = Game.discount(game, inst, oracleOf) + Bot.selfDiscount(game, inst, def);
    return { cost, tax, less, label: `${cost}${cmdTax ? ` + ${cmdTax} tax` : ''}${more ? ` + ${more} more` : ''}${less ? ` − ${less}` : ''}` };
  }

  // Plays a card, but if Auto-tap can't cover its cost, asks first: cancel, or play it anyway
  // and tap your mana yourself.
  function tryPlay(iid, opts = {}) {
    const inst = game && game.cards[iid];
    if (!inst) return;
    // Offspring, freerunning, "You may pay {1}{B} rather than pay this spell's mana cost": pick how.
    if ((inst.zone === 'hand' || inst.zone === 'command') && !Game.isLand(inst) && !opts.flip && !opts.faceDown && !opts.choice) {
      const choices = Bot.costChoices(game, inst, def);
      if (choices.length > 1) {
        openModal(`<div class="ask"><h3>Cast ${esc(inst.name)}</h3><p class="muted small">How do you cast it?</p>
          <div class="block-picks">${choices.map((c, i) => `<button type="button" class="btn${i ? ' ghost' : ''}" data-cc="${i}" style="display:block;width:100%;text-align:left;margin:4px 0">${esc(c.label)}</button>`).join('')}</div>
          <div class="toolbar end"><button type="button" class="btn ghost" data-cc="cancel">Cancel</button></div></div>`);
        modalBox.querySelectorAll('[data-cc]').forEach(b => {
          b.onclick = () => {
            closeAsk();
            if (b.dataset.cc === 'cancel') return;
            const c = choices[Number(b.dataset.cc)];
            tryPlay(iid, { ...opts, choice: c.key, cost: c.key === 'normal' ? undefined : c.cost });
          };
        });
        return;
      }
    }
    // One land a turn. Play anyway is there for "you may play an additional land" effects.
    if (inst.zone === 'hand' && (Game.isLand(inst) || opts.flip) && !opts.faceDown && game.landPlayed && !opts.extraLand) {
      openModal(`<div class="ask"><h3>Land already played</h3>
        <p>You've already played a land this turn. Play ${esc(inst.name)} anyway (for an effect that lets you play an extra land)?</p>
        <div class="toolbar end"><button type="button" class="btn ghost" data-xl="cancel">Cancel</button><button type="button" class="btn" data-xl="go">Play anyway</button></div></div>`);
      const close = () => { modal.hidden = true; modalBox.innerHTML = ''; };
      modalBox.querySelector('[data-xl=cancel]').onclick = close;
      modalBox.querySelector('[data-xl=go]').onclick = () => { close(); tryPlay(iid, { ...opts, extraLand: true }); };
      return;
    }
    const c = castCost(inst, opts);
    if (!c || Game.autoPay(JSON.parse(JSON.stringify(game)), c.cost, c.tax - c.less)) return act(() => playCard(iid, opts));
    openModal(`<div class="ask"><h3>Not enough mana</h3>
      <p>You don't have enough untapped mana to cast ${esc(inst.name)} (${esc(c.label)}).</p>
      <div class="toolbar end"><button type="button" class="btn ghost" data-nm="cancel">Cancel</button><button type="button" class="btn" data-nm="go">Play anyway (tap mana manually)</button></div></div>`);
    const done = () => { modal.hidden = true; modalBox.innerHTML = ''; };
    modalBox.querySelector('[data-nm=cancel]').onclick = done;
    modalBox.querySelector('[data-nm=go]').onclick = () => { done(); act(() => playCard(iid, { ...opts, manual: true })); };
  }

  // Plays a card from your hand or the command zone. With Auto-tap on, pays for spells first
  // (commander tax included); with opts.manual (or if your untapped lands can't cover it), nothing is tapped.
  function playCard(iid, opts = {}) {
    const inst = game.cards[iid];
    if (!inst) return;
    if (opts.flip) inst.flipped = true; // Boggart Trawler played as Boggart Bog
    if (opts.choice === 'alt') inst.altPaid = true; // Baleful Mastery: "If the {1}{B} cost was paid, …"
    if (opts.choice === 'offspring') inst.offspringPaid = true;
    if (opts.aftermath) { inst.flipped = true; inst.castAftermath = true; } // Dawn, from your graveyard
    if (opts.flashback) inst.castAftermath = true; // flashback: exiled after it resolves too
    // From your graveyard or exile, it's cast (prowess, "whenever you cast …").
    if (inst.zone === 'graveyard' || inst.zone === 'exile') opts = { ...opts, cast: true };
    const fromHand = inst.zone === 'hand' || inst.zone === 'command';
    const aura = fromHand && Game.isAura(inst) && !opts.faceDown; // then you pick what it enchants
    const c = castCost(inst, opts);
    if (c) {
      const { cost, less } = c;
      const paid = !opts.manual && Game.autoPay(game, cost, c.tax - less);
      if (!paid) {
        Game.move(game, iid, 'battlefield', opts);
        game.notice = `Played ${inst.name} without paying (${c.label}), so tap your mana for it yourself.${game.notice ? ' ' + game.notice : ''}`;
        if (aura) setTimeout(() => startAttach(iid), 0);
        return;
      }
      const spent = [...paid.sources];
      if (paid.pool) spent.unshift(`${paid.pool} floating mana`);
      if (paid.life) spent.push(`${paid.life} life`);
      if (spent.length) Game.log(game, `Auto-tapped for ${inst.name}${less ? ` (${less} less)` : ''}: ${spent.join(', ')}.`);
      else if (less) Game.log(game, `${inst.name} cost ${less} less, so it was free.`);
    }
    Game.move(game, iid, 'battlefield', opts);
    if (aura) setTimeout(() => startAttach(iid), 0);
  }

  // Taps or untaps a card. A land or mana rock that makes more than one color asks which one to add.
  // Creatures just tap (they're usually attacking); right-click one to tap it for mana.
  function tapCard(iid, x, y) {
    const inst = game.cards[iid];
    if (!inst) return;
    const colors = Game.isLand(inst) ? Game.producesOf(inst) : inst.mana && !Game.isCreature(inst) ? inst.mana.colors : [];
    // "{1}, {T}: Add {G}{W}" (Sungrass Prairie): pays the {1} and adds both, no question to ask.
    if (inst.tapped || inst.faceDown || colors.length < 2 || (inst.mana && inst.mana.filter)) return act(() => Game.setTapped(game, iid));
    if (x == null) {
      const r = (cardEls.get(iid) || document.body).getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    // Opened after this click finishes, or the same click would close it again.
    setTimeout(() => showMenu(x, y, [
      ...colors.map(c => ({ label: `Tap for ${MANA_NAMES[c]}`, hint: c, action: () => act(() => Game.setTapped(game, iid, true, c)) })),
      { sep: true },
      { label: 'Tap without adding mana', action: () => act(() => Game.setTapped(game, iid, true, null)) },
    ]), 0);
  }
  const MANA_NAMES = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' };

  // ---------- tabs ----------

  function setTab(tab) {
    // Inside MTG Tracker, its tab bar shows which page this is.
    if (embedded) window.parent.postMessage({ type: 'sim:tab', tab }, location.origin === 'null' ? '*' : location.origin);
    ui.tab = tab;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    view.classList.toggle('wide', tab === 'play');
    document.body.classList.toggle('playing', tab === 'play');
    // The page can't scroll while playing, so start at the top or the button bar (Draw…) is out of reach.
    if (tab === 'play') { window.scrollTo(0, 0); fitTable(); }
    if (tab === 'decks') { renderDecks(); refreshTracker(); }
    else if (tab === 'play') renderPlay();
    else if (tab === 'odds') renderOdds();
    else if (tab === 'test') renderTest();
    else renderHelp();
  }

  // The table fills the screen under the header, whose height changes with the screen width.
  function fitTable() {
    const head = document.querySelector('.topbar');
    document.documentElement.style.setProperty('--head-h', (head ? head.offsetHeight : 53) + 'px');
  }

  // Re-reads the Tracker's decks (they may have changed there) and redraws the Decks tab.
  let refreshing = false;
  async function refreshTracker() {
    if (refreshing) return;
    refreshing = true;
    try {
      await connectTracker(true);
    } finally {
      refreshing = false;
    }
    // Don't redraw under someone typing a deck list.
    if (ui.tab === 'decks' && !view.contains(document.activeElement)) renderDecks();
  }

  function renderLinkState() {
    const el = $('#linkState');
    if (tracker) {
      el.innerHTML = `<span class="dot ok"></span>${tracker.source === 'file' ? 'Tracker backup loaded' : 'Linked to MTG Tracker'}`;
    } else {
      el.innerHTML = '<span class="dot"></span>MTG Tracker not linked';
    }
  }

  // ---------- Decks tab ----------

  function coverOf(deck) {
    const row = deck.rows.find(r => r.commander) || deck.rows.find(r => def(r.id) && !Game.isLand(def(r.id))) || deck.rows[0];
    const c = row && def(row.id);
    return c ? c.art || c.image : null;
  }

  const deckCount = deck => deck.rows.reduce((n, r) => n + (r.qty || 1), 0);

  function deckTile(deck, removable) {
    const art = coverOf(deck);
    const cmdr = deck.rows.filter(r => r.commander).map(r => r.name).join(' & ');
    const rec = recordOf(deck.key);
    const played = rec.win + rec.loss + rec.draw;
    return `<div class="deck-tile">
      <div class="deck-art" ${art ? `style="background-image:url('${esc(art)}')"` : ''}></div>
      <div class="deck-body">
        <b>${esc(deck.name)}</b>
        <span class="muted small">${deckCount(deck)} cards${cmdr ? ' · ' + esc(cmdr) : ''}</span>
        ${played ? `<span class="small" title="Games you finished with this deck in the Simulator">Record: <b>${rec.win}–${rec.loss}${rec.draw ? `–${rec.draw}` : ''}</b> (${Math.round(rec.win / played * 100)}% won)</span>` : ''}
        <div class="toolbar tight">
          <button class="btn sm" data-act="play" data-key="${esc(deck.key)}">Play</button>
          <button class="btn sm ghost" data-act="odds" data-key="${esc(deck.key)}">Odds</button>
          ${removable ? `<button class="btn sm danger" data-act="delete-deck" data-key="${esc(deck.key)}" title="Delete this deck from the Simulator">Delete</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderDecks() {
    const prof = trackerProfile();
    const trackerDecks = prof ? (prof.decks || []).map(d => TrackerLink.toDeck(d, prof)) : [];
    view.innerHTML = `
      ${gamesPanelHtml()}
      <section class="panel bot-panel">${botPanelHtml()}</section>
      <section class="panel online-panel" id="onlinePanel">${onlinePanelHtml()}</section>
      <section class="panel">
        <div class="page-head">
          <div>
            <h3>Decks from MTG Tracker</h3>
            <div class="muted small">${tracker
              ? tracker.source === 'file' ? 'From a Tracker backup file.' : 'Read straight from MTG Tracker in this browser. Changes you make in the Tracker show up when you click Refresh.'
              : 'MTG Tracker data wasn\'t found in this browser.'}</div>
          </div>
          <div class="toolbar tight">
            <button class="btn sm ghost" data-act="refresh">Refresh</button>
            <label class="btn sm ghost">Load backup file…<input type="file" accept=".json,application/json" data-act="backup" hidden></label>
          </div>
        </div>
        ${tracker
          ? trackerDecks.length ? `<div class="deck-grid">${trackerDecks.map(d => deckTile(d)).join('')}</div>` : '<p class="muted">You have no decks yet. Import one in MTG Tracker, then click Refresh.</p>'
          : `<p class="muted small">To link: open MTG Tracker in this same browser (Chrome or Edge) at least once, then click <b>Refresh</b>.
             Or, in the Tracker, go to <b>Account &amp; backup → Download backup</b> and load that file here.</p>`}
      </section>

      <section class="panel">
        <h3>Your Simulator decks</h3>
        <p class="muted small">Decks you pasted here. You don't need to own any of the cards.</p>
        ${local.decks.length ? `<div class="deck-grid">${local.decks.map(d => deckTile(d, true)).join('')}</div>` : '<p class="muted">None yet. Add a precon or paste a list below.</p>'}
      </section>

      <section class="panel" id="preconPanel">${preconPanelHtml()}</section>

      <section class="panel">
        <h3>Paste a deck list</h3>
        <p class="muted small">Works with Archidekt, Moxfield, MTG Arena and plain lists like <code>1 Sol Ring</code>.
          Mark the commander with an <code>[Commander]</code> category, a <code>*CMDR*</code> tag, or put it under a <code>Commander</code> heading.</p>
        <form id="pasteForm" class="paste">
          <input name="name" placeholder="Deck name" required>
          <textarea name="list" rows="10" placeholder="1 Atraxa, Praetors' Voice [Commander]&#10;1 Sol Ring&#10;35 Forest" required></textarea>
          <div class="toolbar"><button class="btn">Import deck</button><span class="muted small" id="pasteMsg"></span></div>
        </form>
      </section>`;
  }

  // Every saved game. Each one keeps going until you end it, even after the app is closed.
  function gamesPanelHtml() {
    if (game) saveGame();
    if (!games.length) return '';
    const when = t => {
      const d = new Date(t);
      return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString();
    };
    return `<section class="panel games-panel">
      <h3>Your games <span class="muted small">(${games.length})</span></h3>
      <p class="muted small">Games stay saved until you end them, even if you close the app. Start as many as you like and switch between them here.</p>
      <ul class="games">${games.map(m => {
        const current = m.id === gameId && game;
        const online = m.online ? `<span class="pill">online · ${esc(m.online.code)}${m.online.players && m.online.players.length ? ` · vs ${esc(m.online.players.join(', '))}` : ''}</span>` : '';
        const vs = m.vsBot ? `<span class="pill">vs computer · ${esc(m.vsBot)}</span>` : '';
        return `<li class="${current ? 'current' : ''}">
          <div><b>${esc(m.deckName)}</b> ${online}${vs}
            <div class="muted small">Turn ${m.turn} · ${m.life} life · last played ${when(m.updatedAt || m.createdAt)}</div></div>
          <div class="toolbar tight">
            <button class="btn sm" data-act="resume-game" data-id="${esc(m.id)}">${current ? 'Back to the game' : 'Continue'}</button>
            <button class="btn sm ghost danger" data-act="delete-game" data-id="${esc(m.id)}" title="Delete this saved game">Delete</button>
          </div></li>`;
      }).join('')}</ul></section>`;
  }

  // The deck you'll play online: the one in your current game, else the one you last picked.
  function onlineDeckKey() {
    const decks = allDecks();
    const key = ui.onlineDeck || (game && game.deckKey);
    return decks.some(d => d.key === key) ? key : decks.length ? decks[0].key : '';
  }

  function deckSelectHtml() {
    const decks = allDecks();
    if (!decks.length) return '<span class="muted small">No decks yet. Add one below.</span>';
    const key = onlineDeckKey();
    return `<label class="muted small">Your deck <select id="onlineDeck" data-act="online-deck">${decks.map(d => `<option value="${esc(d.key)}" ${d.key === key ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>`;
  }

  function onlinePanelHtml() {
    const st = Online.state();
    const code = Online.code();
    if (st === 'off') {
      return `<h3>Play online</h3>
        <p class="muted small">Play against up to ${Online.MAX_PLAYERS - 1} friends who also have MTG Tracker. One person hosts and gets a game code; everyone else types it in.
          Each player plays their own deck on their own computer. Everyone needs internet.</p>
        <div class="toolbar tight">
          <label class="muted small">Your name <input id="onlineName" data-act="online-name" value="${esc(ui.playerName || '')}" maxlength="30" placeholder="Your name" style="width:150px"></label>
          ${deckSelectHtml()}
        </div>
        <div class="toolbar tight" style="margin-top:.5rem">
          <button class="btn" data-act="host">Host a game</button>
          <span class="muted small">or</span>
          <input id="joinCode" class="code-input" value="${esc(ui.joinCode || '')}" maxlength="13" placeholder="Game code">
          <button class="btn ghost" data-act="join">Join</button>
        </div>`;
    }
    if (st === 'starting') return '<h3>Play online</h3><p class="muted">Starting a game…</p>';
    if (st === 'connecting') {
      return `<h3>Play online</h3><div class="toolbar tight"><span>Joining game <b class="game-code">${esc(code)}</b>…</span>
        <button class="btn sm ghost" data-act="leave">Cancel</button></div>`;
    }
    const isHost = Online.role() === 'host';
    const players = Online.players();
    const deckOf = p => {
      if (p.pid === Online.id()) return game ? esc(game.deckName) : '<span class="muted">no deck yet</span>';
      const peer = peers[p.pid];
      return peer && peer.board ? esc(peer.board.deckName) : '<span class="muted">picking a deck…</span>';
    };
    return `<div class="page-head">
        <div>
          <h3>${st === 'lost' ? 'Connection lost' : 'Playing online'}</h3>
          <div class="toolbar tight">
            <span>Game code <b class="game-code">${esc(code)}</b></span>
            ${isHost ? '<button class="btn sm ghost" data-act="copy-code">Copy</button>' : ''}
            <span class="muted small">${isHost ? (st === 'waiting' ? 'Send this code to your friends. Waiting for them to join…' : `Friends can still join (up to ${Online.MAX_PLAYERS} players).`) : st === 'lost' ? 'The host may have closed the game.' : ''}</span>
          </div>
        </div>
        <div class="toolbar tight">
          ${st === 'lost' ? '<button class="btn sm" data-act="rejoin">Rejoin</button>' : ''}
          <button class="btn sm danger" data-act="leave">Leave</button>
        </div>
      </div>
      ${players.length ? `<ul class="players">${players.map((p, i) => `<li><span class="dot ok"></span><b>${esc(p.name)}</b>${p.pid === Online.id() ? ' (you)' : ''}${i === 0 ? ' <span class="pill">host</span>' : ''} <span class="small">· ${deckOf(p)}</span></li>`).join('')}</ul>` : ''}
      <div class="toolbar tight">
        ${deckSelectHtml()}
        ${allDecks().length ? `<button class="btn sm" data-act="online-play">${game && game.deckKey === onlineDeckKey() ? 'Restart with this deck' : 'Play this deck'}</button>` : ''}
        ${game ? '<button class="btn sm ghost" data-act="resume">Back to the game</button>' : ''}
      </div>
      <p class="muted small">${inLobby ? '<button class="btn sm" data-act="open-lobby">Go to the lobby</button> ' : ''}The host starts the game from the lobby on the Play tab. To start over later, use <b>More ▾ → Back to the lobby</b>.</p>`;
  }

  function refreshOnlinePanel() {
    const el = $('#onlinePanel');
    if (el && !el.contains(document.activeElement)) el.innerHTML = onlinePanelHtml();
  }

  // Splits a pasted list into sections (Commander / Deck / Sideboard headings) and parses each line.
  function parseList(text) {
    const entries = [];
    const errors = [];
    let section = 'deck';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const head = line.replace(/[:\s]+$/, '').replace(/\s*\(\d+\)$/, '').toLowerCase();
      if (/^(commanders?|deck|main ?deck|mainboard|sideboard|maybeboard|companion|about|name .*)$/.test(head)) {
        section = /^commander/.test(head) ? 'commander' : /side|maybe|companion|about|name/.test(head) ? 'skip' : 'deck';
        continue;
      }
      if (section === 'skip') continue;
      const cmdrTag = /\*CMDR\*/i.test(line);
      const e = ArchidektParser.parseLine(line);
      if (!e) continue;
      if (e.error) { errors.push(line); continue; }
      if (!e.inDeck) continue;
      e.commander = section === 'commander' || cmdrTag || e.categories.some(c => c.toLowerCase() === 'commander');
      entries.push(e);
    }
    return { entries, errors };
  }

  // ---------- precon decks (from MTGJSON, no account needed) ----------

  // Every Commander precon, newest first: [{ name, code, releaseDate, fileName }], loaded when you ask.
  let precons = null;
  let preconQuery = '';
  const MTGJSON = 'https://mtgjson.com/api/v5';
  const preconDeckName = p => `${p.name} (${p.code})`;

  // The list loads by itself the first time the panel is shown (preconTried); offline, Try again does it.
  let preconTried = false;
  function preconPanelHtml() {
    if (!precons) {
      if (!preconTried) { preconTried = true; setTimeout(loadPrecons, 0); }
      return `<h3>Precon decks</h3>
        <p class="muted small">Every Commander precon Wizards has printed, ready to play or to play against. The lists come from MTGJSON.</p>
        <div class="toolbar"><button class="btn sm ghost" data-act="precons-load">Try again</button><span class="muted small" id="preconMsg">Loading the precon list…</span></div>`;
    }
    return `<h3>Precon decks</h3>
      <p class="muted small">Click <b>Add</b> and the deck joins Your Simulator decks: play it, or pick it as Opp's deck.</p>
      <div class="toolbar"><input type="search" id="preconFilter" placeholder="Search by commander, deck name, set or year" value="${esc(preconQuery)}"><span class="muted small" id="preconMsg"></span></div>
      <div class="precon-list" id="preconList">${preconRowsHtml()}</div>`;
  }

  // A precon's commander(s), front faces only: "The Tenth Doctor & Rose Tyler", or '' if not known yet.
  const preconCommanders = p => (p.commanders || []).map(n => n.split(' // ')[0]).join(' & ');

  function preconRowsHtml() {
    // Every word has to match the deck's name, commander, set code or year ("atraxa", "tenth doctor 2023").
    const words = preconQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = (precons || []).filter(p => {
      const text = `${p.name} ${(p.commanders || []).join(' ')} ${p.code} ${p.releaseDate}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
    const have = new Set(local.decks.map(d => d.name.toLowerCase()));
    const rows = list.slice(0, 60).map(p => `<div class="precon-row">
        <span><b>${esc(p.name)}</b>${preconCommanders(p) ? ` (${esc(preconCommanders(p))})` : ''} <span class="muted small">${esc(p.code)} · ${esc(p.releaseDate.slice(0, 4))}</span></span>
        ${have.has(preconDeckName(p).toLowerCase()) ? '<span class="muted small">Added</span>' : `<button class="btn sm ghost" data-act="precon-add" data-file="${esc(p.fileName)}">Add</button>`}
      </div>`);
    return rows.join('') + (list.length > 60 ? `<p class="muted small">${list.length - 60} more: search to narrow it down.</p>` : '') + (list.length ? '' : '<p class="muted small">No precon matches that.</p>');
  }

  let preconLoading = false;
  async function loadPrecons() {
    if (preconLoading || precons) return;
    preconLoading = true;
    const say = t => { const m = $('#preconMsg'); if (m) m.textContent = t; };
    say('Loading the precon list…');
    try {
      const res = await fetch(`${MTGJSON}/DeckList.json`);
      if (!res.ok) throw new Error(`MTGJSON answered ${res.status}`);
      const json = await res.json();
      // Commanders: from js/precons.js (made by tools/precon-commanders.js), or ones looked up before.
      let learned = {};
      try { learned = JSON.parse(localStorage.getItem('mtg-precon-commanders') || '{}'); } catch (e) { learned = {}; }
      const known = Object.assign({}, typeof PRECON_COMMANDERS !== 'undefined' ? PRECON_COMMANDERS : {}, learned);
      precons = (json.data || []).filter(d => d.type === 'Commander Deck' && d.fileName)
        .map(d => ({ name: String(d.name), code: String(d.code || ''), releaseDate: String(d.releaseDate || ''), fileName: String(d.fileName), commanders: known[d.fileName] || null }))
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name));
      const panel = $('#preconPanel');
      if (panel) panel.innerHTML = preconPanelHtml();
      learnPreconCommanders(learned);
    } catch (e) {
      say(`Couldn't load the precons (${e.message}). Check your internet connection.`);
    } finally {
      preconLoading = false;
    }
  }

  // Precons newer than js/precons.js: their commanders are looked up (a few at most) and remembered
  // in this browser, then the list shows them.
  async function learnPreconCommanders(learned) {
    const missing = (precons || []).filter(p => !p.commanders).slice(0, 12);
    for (const p of missing) {
      try {
        const deck = (await (await fetch(`${MTGJSON}/decks/${encodeURIComponent(p.fileName)}.json`)).json()).data;
        p.commanders = [...new Set((deck.commander || []).map(c => String(c.name)))];
        learned[p.fileName] = p.commanders;
      } catch (e) { break; } // offline: try again next time
    }
    if (!missing.length) return;
    try { localStorage.setItem('mtg-precon-commanders', JSON.stringify(learned)); } catch (e) { /* not saved, looked up again next time */ }
    const list = $('#preconList');
    if (list) list.innerHTML = preconRowsHtml();
  }

  // Imports one precon: its commanders under a Commander heading, the rest as the deck.
  async function addPrecon(fileName) {
    const p = (precons || []).find(x => x.fileName === fileName);
    if (!p) return;
    const say = t => { const m = $('#preconMsg'); if (m) m.textContent = t; };
    say(`Getting ${p.name}…`);
    let deck;
    try {
      const res = await fetch(`${MTGJSON}/decks/${encodeURIComponent(fileName)}.json`);
      if (!res.ok) throw new Error(`MTGJSON answered ${res.status}`);
      deck = (await res.json()).data;
    } catch (e) {
      return say(`Couldn't get ${p.name} (${e.message}).`);
    }
    const line = c => `${c.count || 1} ${c.name}`;
    const text = ['Commander', ...(deck.commander || []).map(line), 'Deck', ...(deck.mainBoard || []).map(line)].join('\n');
    await importDeckText(preconDeckName(p), text, say);
    const list = $('#preconList');
    if (list) list.innerHTML = preconRowsHtml();
  }

  async function importPasted(name, text) {
    const msg = $('#pasteMsg');
    return importDeckText(name, text, t => { msg.textContent = t; });
  }

  // Imports a deck list (pasted, or a precon's) as one of your Simulator decks. say(text): progress messages.
  async function importDeckText(name, text, say) {
    const msg = { set textContent(t) { say(t); } };
    const { entries, errors } = parseList(text);
    if (!entries.length) {
      msg.textContent = 'No cards found in that list.';
      return;
    }
    if (local.decks.some(d => d.name.toLowerCase() === name.toLowerCase())) {
      msg.textContent = 'You already have a Simulator deck with that name.';
      return;
    }
    msg.textContent = 'Looking up cards on Scryfall…';
    const idents = entries.map(e => (e.set && e.cn ? { set: e.set, collector_number: e.cn } : { name: e.name.split(' // ')[0] }));
    let res;
    try {
      res = await Scryfall.collection(idents, (d, t) => { msg.textContent = `Looking up cards on Scryfall… ${d}/${t}`; });
    } catch (e) {
      msg.textContent = 'Scryfall lookup failed: ' + e.message;
      return;
    }
    const pick = e => res.found.find(c => (e.set && e.cn && c.set === e.set && c.cn === e.cn))
      || res.found.find(c => c.names.includes(e.name.toLowerCase()) || c.names.includes(e.name.split(' // ')[0].toLowerCase()));
    // Printings that weren't found by set + number get a second try by name.
    const retry = entries.filter(e => !pick(e) && e.set);
    if (retry.length) {
      const again = await Scryfall.collection(retry.map(e => ({ name: e.name.split(' // ')[0] })));
      res.found.push(...again.found);
    }
    const rows = new Map();
    const missing = [...errors];
    for (const e of entries) {
      const c = pick(e);
      if (!c) { missing.push(`${e.qty} ${e.name}`); continue; }
      local.cards[c.id] = c;
      const row = rows.get(c.id) || { id: c.id, name: c.name, qty: 0, categories: e.categories.filter(x => x.toLowerCase() !== 'commander'), commander: e.commander };
      row.qty += e.qty;
      rows.set(c.id, row);
    }
    const deck = { key: 'local:' + Date.now().toString(36), source: 'local', name, rows: [...rows.values()], createdAt: Date.now() };
    local.decks.push(deck);
    await saveLocal();
    renderDecks();
    status(`Imported ${name}: ${deckCount(deck)} cards.${missing.length ? ` Couldn't find: ${missing.slice(0, 8).join('; ')}${missing.length > 8 ? '…' : ''}` : ''}`, missing.length ? 'warn' : 'ok', missing.length > 0);
  }

  // ---------- Play tab ----------

  const cardEls = new Map(); // iid -> element, reused so images don't reload on every change

  function renderPlay() {
    cardEls.clear();
    oppEls.clear();
    if (isOnline() && (inLobby || !game)) return renderLobby();
    if (!game) {
      view.innerHTML = `<div class="empty-play"><h3>No game going</h3><p class="muted">Pick a deck on the Decks tab and click Play.</p><button class="btn" data-tab-go="decks">Choose a deck</button></div>`;
      return;
    }
    const online = isOnline();
    const bot = hasBot();
    const savedOnline = !online && gameMeta() && gameMeta().online;
    view.innerHTML = `
      <div class="table ${online || bot ? 'online' : ''}" id="table">
        <div class="bar">
          <div class="bar-group">
            <b class="deck-name" title="${esc(game.deckName)}">${esc(game.deckName)}</b>
            <span class="turn">Turn <b id="turnNo"></b></span>
            ${online ? '<span class="turn-badge" id="turnBadge"></span>' : ''}
            ${online
              ? '<button class="btn sm" data-act="attack" id="attackBtn" title="Pick creatures and what each one attacks: a player or a planeswalker. They pick their blocks (A)">Attack…</button> <button class="btn sm" data-act="pass" title="End your turn. The next player untaps and draws automatically (N)">Pass turn ▸</button>'
              : bot ? `<button class="btn sm" data-act="attack" title="Pick creatures to attack Opp with. Opp blocks and the damage is done for you (A)">Attack…</button>
                 <button class="btn sm" data-act="next-turn" id="endTurnBtn" title="Opp takes its turn, then you untap and draw (N)">End turn ▸</button>`
              : '<button class="btn sm" data-act="next-turn" title="Untap, then draw (N)">Next turn</button>'}
            <button class="btn sm ghost" data-act="draw" title="Draw a card (D)">Draw</button>
            <button class="btn sm ghost" data-act="untap" title="Untap everything (U)">Untap all</button>
            ${appMode ? '' : '<button class="btn sm ghost" data-act="mulligan">Mulligan</button>'}
            <button class="btn sm ghost" data-act="token">Token…</button>
            <button class="btn sm ghost" data-act="scry" title="Look at the top cards of your library: scry, or put them in any order">Scry…</button>
            ${appMode ? '' : `<button class="btn sm ghost" data-act="shuffle" title="Shuffle your library (S)">Shuffle</button>
            <button class="btn sm ghost" data-act="d20" title="Roll a 20-sided die">Roll d20</button>`}
            <button class="btn sm ghost" data-act="tools">More ▾</button>
            <button class="btn sm ghost" data-act="undo" title="Undo (Ctrl+Z)">↶ Undo</button>
            <button class="btn sm danger" data-act="reset" title="Start this deck over: new shuffle, new hand, life back to the start">↺ Reset</button>
            <button class="btn sm danger" data-act="end-game" title="End this game and go back to the deck list">✕ End game</button>
          </div>
          <div class="bar-group">
            <div class="life" title="Your life"><span>You</span><button data-act="life" data-d="-1">−</button><b id="lifeNo"></b><button data-act="life" data-d="1">+</button></div>
            ${online || bot ? '' : '<div class="life goldfish" title="Opponent\'s life (for goldfishing)"><span>Opp</span><button data-act="opp" data-d="-1">−</button><b id="oppNo"></b><button data-act="opp" data-d="1">+</button></div>'}
            <div class="life poison" title="Poison counters"><span>☠</span><button data-act="poison" data-d="-1">−</button><b id="poisonNo"></b><button data-act="poison" data-d="1">+</button></div>
            <span class="opp-stat" id="monarchNo" title="You're the monarch: you draw a card at the end of your turn. A player whose creature deals you combat damage takes it." hidden>👑 Monarch</span>
            <label class="toggle" title="When you play a spell, tap the lands it needs (uses floating mana first)"><input type="checkbox" data-act="autotap" ${ui.autoTap ? 'checked' : ''}> Auto-tap lands</label>
            <label class="toggle" title="At the start of your turn, highlight cards with upkeep triggers until you click Done"><input type="checkbox" data-act="upkeephelp" ${ui.upkeepOff ? '' : 'checked'}> Upkeep reminders</label>
            ${bot ? `<label class="toggle" title="Opp's spells wait while you could answer them with an instant, and Opp counters and removes things on your turn"><input type="checkbox" data-act="respondhelp" ${ui.respond === false ? '' : 'checked'}> Responses</label>` : ''}
            <label class="size" title="Card size"><span class="muted small">Size</span><input type="range" min="60" max="150" step="2" value="${ui.cardW}" data-act="size"></label>
            ${appMode ? '' : '<span class="counter-dock" id="counterDock" hidden></span>'}
            ${online ? `<span class="online-chip" title="Game code ${esc(Online.code())}"><span class="dot ${Online.connected() ? 'ok' : ''}"></span>Online · <b>${esc(Online.code())}</b><button class="link-btn" data-act="leave">Leave</button></span>`
              : savedOnline ? `<span class="online-chip" title="This game was played online. Reconnect to keep playing with the others."><span class="dot"></span>Offline · <b>${esc(savedOnline.code)}</b><button class="link-btn" data-act="reconnect">Reconnect</button></span>` : ''}
          </div>
        </div>
        <div class="board">
          ${online || bot ? '<section class="opps" id="opps"></section>' : ''}
          <aside class="piles">
            <div class="pile-wrap"><div class="pile" data-pile="library" data-zone="library"></div><span class="pile-label">Library <b data-count="library"></b></span></div>
            <div class="pile-wrap"><div class="pile" data-pile="graveyard" data-zone="graveyard"></div><span class="pile-label">Graveyard <b data-count="graveyard"></b></span></div>
            <div class="pile-wrap"><div class="pile" data-pile="exile" data-zone="exile"></div><span class="pile-label">Exile <b data-count="exile"></b></span></div>
            <div class="pile-wrap cmd"><div class="command" id="command" data-zone="command"></div><span class="pile-label">Command zone</span></div>
          </aside>
          <section class="battlefield" data-zone="battlefield" id="battlefield"></section>
          <aside class="side">
            <div class="preview" id="preview"><div class="muted small">Hover a card to see it here.</div></div>
            <div class="info" id="info"></div>
            <div class="upkeep-note" id="upkeep" hidden></div>
            <div class="cmd-dmg" id="cmdDmg"></div>
            <div class="mana" id="mana"></div>
            <div class="log" id="log"></div>
            ${online ? '<form id="chatForm" class="chat"><input name="msg" placeholder="Message everyone…" autocomplete="off" maxlength="500"></form>' : ''}
          </aside>
        </div>
        <div class="hand" data-zone="hand" id="hand"></div>
      </div>`;
    renderBoard();
    renderCounterDock();
    if (bot && (game.bot.pending || game.bot.tapChoice || game.bot.s.stack) && modal.hidden) oppWaiting();
  }

  function cardImage(inst) {
    const c = def(inst.id);
    if (!c) return null;
    if (inst.flipped && c.backImage) return c.backImage;
    return c.image;
  }

  function faceHtml(inst, showBack) {
    if (showBack || inst.faceDown) return '<div class="back"><span>MTG</span></div>';
    const img = cardImage(inst);
    if (img) return `<img src="${esc(img)}" alt="${esc(inst.name)}" draggable="false" loading="lazy">`;
    const c = def(inst.id) || {};
    const pt = inst.custom ? inst.custom.pt : c.power != null ? `${c.power}/${c.toughness}` : '';
    return `<div class="text-face"><b>${esc(inst.name)}</b><span>${esc(inst.typeLine || c.typeLine || (inst.token ? 'Token' : ''))}</span>
      ${inst.custom && inst.custom.text ? `<small>${esc(inst.custom.text)}</small>` : ''}${pt ? `<em>${esc(pt)}</em>` : ''}</div>`;
  }

  const FRESH_MS = 5000; // how long a card that just came into your hand stays outlined
  const freshTimers = new Map();
  const sign = n => (n >= 0 ? '+' + n : String(n));

  // pid is set for another player's card: it can be looked at but not moved.
  // Auras another player put on this creature (on yours), or that you put on it (on theirs).
  const auraTags = inst => inst.yourAuras || Object.values(inst.boosts || {}).map(b => b && b.label).filter(Boolean);

  function cardEl(inst, pid) {
    const els = pid ? oppEls : cardEls;
    const key = pid ? pid + '|' + inst.iid : inst.iid;
    let el = els.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'card';
      if (pid) {
        el.dataset.oiid = inst.iid;
        el.dataset.opid = pid;
      } else el.dataset.iid = inst.iid;
      els.set(key, el);
    }
    const counters = Object.entries(inst.counters || {});
    const tax = inst.commander && inst.castCount ? inst.castCount * 2 : 0;
    const inCommand = pid ? inst.inCommand : inst.zone === 'command';
    const sig = [inst.faceDown, inst.flipped, cardImage(inst), JSON.stringify(inst.counters), inst.token, inCommand ? tax : '', inst.chosenType || '', inst.regen || '', inst.pump ? inst.pump.pow + '/' + inst.pump.tou + (inst.pump.kw || []).join() : '', inst.anthem ? inst.anthem.pow + '/' + inst.anthem.tou : '', inst.cda ? inst.cda.pow + '/' + inst.cda.tou : '', auraTags(inst).join()].join('|');
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = faceHtml(inst)
        + (inst.token ? '<span class="tag token">TOKEN</span>' : '')
        + (counters.length ? `<div class="counters">${counters.map(([k, n]) => pid
          ? `<span class="counter">${esc(k)} <b>${n}</b></span>`
          : `<button class="counter" data-counter="${esc(k)}" title="Click +1, right-click −1">${esc(k)} <b>${n}</b></button>`).join('')}</div>` : '')
        + (inCommand && tax ? `<span class="tag tax" title="Commander tax">+${tax}</span>` : '')
        + (inst.chosenType && !inst.faceDown ? `<span class="tag chosen" title="Chosen creature type">${esc(inst.chosenType)}</span>` : '')
        + (inst.regen ? `<span class="tag regen" title="Regeneration shield until end of turn: the next time it would be destroyed, it's tapped instead">REGEN${inst.regen > 1 ? ' ×' + inst.regen : ''}</span>` : '')
        + (inst.pump ? `<span class="tag pump" title="Until end of turn${inst.pump.kw && inst.pump.kw.length ? ': ' + esc(inst.pump.kw.join(', ')) : ''}">${inst.pump.pow || inst.pump.tou ? `${sign(inst.pump.pow)}/${sign(inst.pump.tou)}` : ''}${inst.pump.kw && inst.pump.kw.length ? `${inst.pump.pow || inst.pump.tou ? ' ' : ''}+${inst.pump.kw.length} kw` : ''}</span>` : '')
        + (auraTags(inst).length ? `<span class="tag aura" title="${esc(auraTags(inst).join(', '))}">${esc(auraTags(inst).join(', '))}</span>` : '')
        + (inst.anthem ? `<span class="tag anthem" title="From its own text or a lord, while it lasts">${sign(inst.anthem.pow)}/${sign(inst.anthem.tou)}</span>` : '')
        + (inst.cda ? `<span class="tag cda" title="Its */* from its own text (like the number of creatures you control), before counters and pumps">=${inst.cda.pow}/${inst.cda.tou}</span>` : '');
    }
    el.classList.toggle('tapped', !!inst.tapped);
    el.classList.toggle('phased', !!inst.phasedOut); // Teferi's Protection
    el.classList.toggle('upkeep', !pid && upkeepIids().includes(inst.iid));
    // A card that just came into your hand gets a yellow outline for 5 seconds.
    const left = !pid && inst.zone === 'hand' && inst.newAt ? FRESH_MS - (Date.now() - inst.newAt) : 0;
    el.classList.toggle('fresh', left > 0);
    if (left > 0) {
      clearTimeout(freshTimers.get(key));
      freshTimers.set(key, setTimeout(() => { freshTimers.delete(key); el.classList.remove('fresh'); }, left));
    }
    return el;
  }

  // Commander damage. Online: damage you've taken from each other player's commander (key
  // "player|commander"), shared so they can see it. Offline: damage your commander has dealt to the
  // goldfish opponent. 21 from one commander loses the game.
  function renderCmdDamage() {
    const box = $('#cmdDmg');
    if (!box || !game) return;
    const rows = [];
    if (isOnline()) {
      const taken = game.cmdDamage || {};
      const keys = new Set(Object.keys(taken).filter(k => taken[k]));
      for (const p of others()) {
        const b = peers[p.pid] && peers[p.pid].board;
        if (!b) continue;
        ['command', 'battlefield', 'graveyard', 'exile'].forEach(z => b[z].forEach(c => { if (c.commander) keys.add(`${p.name}|${c.name}`); }));
      }
      for (const k of keys) {
        const [who, name] = k.split('|');
        rows.push({ act: 'cmd-dmg', key: k, label: `${who}'s ${name}`, n: taken[k] || 0 });
      }
    } else {
      const dealt = game.cmdDealt || {};
      const names = new Set(Object.values(game.cards).filter(c => c.commander).map(c => c.name));
      for (const name of names) rows.push({ act: 'cmd-dealt', key: name, label: `${name} → Opp`, n: dealt[name] || 0 });
      if (hasBot()) {
        const taken = game.cmdDamage || {};
        const theirs = new Set(Object.values(game.bot.s.cards).filter(c => c.commander).map(c => c.name));
        for (const name of theirs) rows.push({ act: 'cmd-dmg', key: `Opp|${name}`, label: `Opp's ${name} → you`, n: taken[`Opp|${name}`] || 0 });
      }
    }
    box.hidden = !rows.length;
    box.innerHTML = rows.length ? `<div class="muted small">Commander damage${isOnline() ? ' to you' : ''}</div>${rows.map(r => `
      <div class="cmd-row ${r.n >= 21 ? 'dead' : ''}" title="21 from one commander loses the game">
        <span>${esc(r.label)}</span>
        <span class="life"><button data-act="${r.act}" data-key="${esc(r.key)}" data-d="-1">−</button><b>${r.n}</b><button data-act="${r.act}" data-key="${esc(r.key)}" data-d="1">+</button></span>
      </div>`).join('')}` : '';
  }

  // Changes commander damage by d. It's also life loss, so life moves with it.
  function commanderDamage(field, key, d) {
    act(() => {
      const map = game[field] = game[field] || {};
      const before = map[key] || 0;
      const after = Math.max(0, before + d);
      map[key] = after;
      if (field === 'cmdDamage') game.life -= after - before;
      else game.oppLife -= after - before;
      if (before < 21 && after >= 21) {
        const name = field === 'cmdDamage' ? key.replace('|', "'s ") : key;
        game.notice = field === 'cmdDamage' ? `21 commander damage from ${name}: you lose this game.` : `${name} has dealt 21 commander damage: Opp loses.`;
        Game.log(game, game.notice);
      }
    });
  }

  const oppEls = new Map(); // "pid|iid" -> element for other players' cards

  let oppsFrame = 0;
  function renderOppsSoon() {
    if (oppsFrame) return;
    oppsFrame = requestAnimationFrame(() => {
      oppsFrame = 0;
      renderOpps();
      renderLog();
      checkDeaths();
    });
  }

  // The other players' tables across the top. Each is scaled to fit its space and turned
  // around, so their lands are at the far edge like across a real table.
  function renderOpps() {
    const box = $('#opps');
    const badge = $('#turnBadge');
    if (badge) {
      badge.textContent = !activePid ? '' : activePid === Online.id() ? 'Your turn' : `${nameOf(activePid)}'s turn`;
      badge.className = 'turn-badge' + (activePid === Online.id() ? ' me' : '');
      badge.hidden = !activePid;
    }
    updateTurnButtons();
    if (!box) return;
    const list = others();
    if (!list.length && isOnline()) {
      oppEls.clear();
      const st = Online.state();
      box.innerHTML = `<div class="opp-empty">${st === 'lost' ? 'Lost the connection to the host. <button class="btn sm" data-act="rejoin">Rejoin</button>'
        : st === 'connecting' ? 'Connecting…'
        : `Waiting for players to join. Game code: <b class="game-code">${esc(Online.code())}</b> <button class="btn sm ghost" data-act="copy-code">Copy</button>`}</div>`;
      return;
    }
    // Reuse each player's panel so their card images don't reload.
    const panels = list.map(p => {
      let panel = box.querySelector(`.opp[data-pid="${CSS.escape(p.pid)}"]`);
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'opp';
        panel.dataset.pid = p.pid;
        panel.innerHTML = '<div class="opp-head"></div><div class="opp-field"></div>';
      }
      return panel;
    });
    if (box.querySelector('.opp-empty')) box.innerHTML = '';
    box.replaceChildren(...panels);
    list.forEach((p, i) => renderOpp(p, panels[i]));
    renderCmdDamage();
  }

  // Online, the Pass turn button says whose turn it is: "Pass to Bob ▸" on yours, "Bob's turn" otherwise.
  function updateTurnButtons() {
    const endBtn = view.querySelector('#endTurnBtn');
    if (endBtn) endBtn.textContent = hasBot() && game.bot.tapChoice ? "Opp's combat: tap ▸" : hasBot() && game.bot.pending ? 'Opp is attacking: block ▸' : 'End turn ▸';
    const attackBtn = view.querySelector('#attackBtn');
    if (attackBtn) attackBtn.textContent = incoming.length ? `${nameOf(incoming[0].from)} is attacking: block ▸` : 'Attack…';
    const passBtn = view.querySelector('[data-act="pass"]');
    if (!passBtn) return;
    const next = others()[0];
    const theirs = activePid && activePid !== Online.id();
    passBtn.textContent = theirs ? `${nameOf(activePid)}'s turn` : next ? `Pass to ${next.name} ▸` : 'Pass turn ▸';
    passBtn.disabled = !!theirs;
    passBtn.classList.toggle('waiting', !!theirs);
    passBtn.title = theirs ? `It's ${nameOf(activePid)}'s turn. Yours starts automatically when they pass to you.`
      : next ? `End your turn. ${next.name} untaps and draws automatically (N)` : 'No one else is here yet';
  }

  function renderOpp(p, panel) {
    const peer = peerOf(p.pid);
    const b = peer && peer.board;
    panel.classList.toggle('active', activePid === p.pid);
    const head = panel.querySelector('.opp-head');
    const field = panel.querySelector('.opp-field');
    if (!b) {
      head.innerHTML = `<b class="opp-name">${esc(p.name)}</b>`;
      field.innerHTML = `<div class="opp-empty">${esc(p.name)} is picking a deck…</div>`;
      return;
    }
    const zoneBtn = (z, label) => `<button class="link-btn" data-act="opp-zone" data-pid="${esc(p.pid)}" data-z="${z}" ${b[z].length ? '' : 'disabled'}>${label} <b>${b[z].length}</b></button>`;
    head.innerHTML = `
      <b class="opp-name" title="${esc(b.deckName)}">${esc(p.name)}</b>${p.pid === BOT ? ` <span class="opp-stat" title="Opp's deck">${esc(b.deckName)}</span>` : ''}
      ${activePid === p.pid ? '<span class="turn-badge">Their turn</span>' : ''}
      <div class="life" title="${esc(p.name)}'s life. − and + change it for them."><span>♥</span><button data-act="hit" data-pid="${esc(p.pid)}" data-d="-1">−</button><b>${b.life}</b><button data-act="hit" data-pid="${esc(p.pid)}" data-d="1">+</button></div>
      ${b.poison ? `<span class="opp-stat poison">☠ <b>${b.poison}</b></span>` : ''}
      ${p.pid === BOT && game.bot.s.stack && game.bot.s.cards[game.bot.s.stack.iid] ? `<button class="opp-stat poison" data-act="respond-open" title="Waiting for your answer. Click to let it resolve or answer it.">Casting ${esc(game.bot.s.cards[game.bot.s.stack.iid].name)}…</button>` : ''}
      ${(p.pid === BOT ? Bot.monarchOf(game) === 'opp' : b.monarch) ? '<span class="opp-stat" title="The monarch draws a card at the end of their turn. Deal them combat damage to take it.">👑 Monarch</span>' : ''}
      ${Object.entries(b.cmdDamage || {}).filter(([, n]) => n).map(([k, n]) => `<span class="opp-stat ${n >= 21 ? 'poison' : ''}" title="Commander damage ${esc(p.name)} has taken from ${esc(k.replace('|', "'s "))}">⚔ ${esc(k.split('|')[1])} <b>${n}</b></span>`).join('')}
      <span class="opp-stat">T<b>${b.turn}</b></span>
      <span class="opp-stat">Hand <b>${b.hand}</b></span>
      <span class="opp-stat">Library <b>${b.library}</b></span>
      ${zoneBtn('graveyard', 'Graveyard')} ${zoneBtn('exile', 'Exile')}
      ${b.command.length ? `<span class="opp-cmd">${b.command.map(c => `<span class="pill" data-oiid="${esc(c.iid)}" data-opid="${esc(p.pid)}">${esc(c.name)}${c.castCount ? ` +${c.castCount * 2}` : ''}</span>`).join(' ')}</span>` : ''}`;

    const CH = 1.396;
    const cards = b.battlefield;
    const maxX = Math.max(1, ...cards.map(c => c.x + (c.tapped ? CH : 1)));
    const maxY = Math.max(CH, ...cards.map(c => c.y + CH));
    const fw = field.clientWidth - 8;
    const fh = field.clientHeight - 8;
    const cw = Math.max(30, Math.min(ui.cardW, fw / maxX, fh / maxY));
    const H = Math.max(fh / cw, maxY);
    field.style.setProperty('--cw', cw + 'px');
    if (field.querySelector('.opp-empty')) field.innerHTML = '';
    field.replaceChildren(...cards.map((c, i) => {
      const mine = game ? game.zones.battlefield.map(id => game.cards[id]).filter(a => a.enchanting && a.enchanting.pid === p.pid && a.enchanting.iid === c.iid) : [];
      if (mine.length) c.yourAuras = mine.map(a => `Your ${a.name}`);
      const el = cardEl(c, p.pid);
      el.style.left = c.x * cw + 4 + 'px';
      el.style.top = (H - c.y - CH) * cw + 4 + 'px';
      el.style.zIndex = i + 1;
      return el;
    }));
    // Forget elements for this player's cards that are gone.
    for (const key of oppEls.keys()) if (key.startsWith(p.pid + '|') && !peer.cards[key.slice(p.pid.length + 1)]) oppEls.delete(key);
  }

  function openOppZone(pid, zone) {
    const peer = peerOf(pid);
    if (!peer || !peer.board) return;
    const ids = [...peer.board[zone]].reverse();
    openModal(`
      <div class="page-head"><h3>${esc(nameOf(pid))}'s ${esc(Game.ZONE_NAMES[zone])} (${ids.length})</h3><button class="btn ghost sm" data-act="close-modal">Done</button></div>
      <div class="viewer-grid">${ids.map(c => `<div class="viewer-card"><div class="card readonly" title="${esc(c.name)}">${faceHtml(c)}</div></div>`).join('') || '<p class="muted">Nothing here.</p>'}</div>`);
  }

  function renderPile(zone) {
    const el = view.querySelector(`[data-pile="${zone}"]`);
    const ids = game.zones[zone];
    const top = zone === 'library' ? ids[0] : ids[ids.length - 1];
    const key = top ? top + (zone === 'library' ? 'b' : '') : 'empty';
    if (el.dataset.top !== key) {
      el.dataset.top = key;
      el.innerHTML = top ? faceHtml(game.cards[top], zone === 'library') : `<div class="pile-empty">${zone === 'library' ? 'Empty' : ''}</div>`;
    }
    view.querySelector(`[data-count="${zone}"]`).textContent = ids.length;
  }

  function measureLayout() {
    const bf = $('#battlefield');
    if (!bf) return;
    Game.layout.cols = Math.max(3, Math.floor((bf.clientWidth - 8) / (ui.cardW * Game.CELL_W)));
    Game.layout.rows = Math.max(2, Math.floor((bf.clientHeight - 8) / (ui.cardW * Game.CELL_H)));
  }

  function renderBoard() {
    const table = $('#table');
    if (!table || !game) return;
    table.style.setProperty('--cw', ui.cardW + 'px');
    measureLayout();
    $('#turnNo').textContent = game.turn || '–'; // online, before your first turn
    $('#lifeNo').textContent = game.life;
    if ($('#oppNo')) $('#oppNo').textContent = game.oppLife;
    $('#poisonNo').textContent = game.poison;
    if ($('#monarchNo')) $('#monarchNo').hidden = !amMonarch();

    const bf = $('#battlefield');
    // Equipment and auras are drawn just under the creature they're on.
    const order = [];
    for (const iid of game.zones.battlefield) {
      if (game.cards[iid].attachedTo && game.cards[game.cards[iid].attachedTo]) continue;
      order.push(...Game.attachmentsOf(game, iid), iid);
    }
    for (const iid of game.zones.battlefield) if (!order.includes(iid)) order.push(iid);
    const bfEls = order.map((iid, i) => {
      const inst = game.cards[iid];
      const el = cardEl(inst);
      el.style.left = inst.x * ui.cardW + 'px';
      el.style.top = inst.y * ui.cardW + 'px';
      el.style.zIndex = i + 1;
      return el;
    });
    bf.replaceChildren(...bfEls);

    const hand = $('#hand');
    const handEls = game.zones.hand.map(iid => {
      const el = cardEl(game.cards[iid]);
      el.style.left = el.style.top = el.style.zIndex = '';
      return el;
    });
    hand.replaceChildren(...handEls);
    const room = hand.clientWidth - 24;
    const need = handEls.length * (ui.cardW + 8);
    hand.style.setProperty('--overlap', need > room && handEls.length > 1 ? `${-Math.min(ui.cardW * 0.75, (need - room) / (handEls.length - 1))}px` : '0px');

    const cmd = $('#command');
    cmd.replaceChildren(...game.zones.command.map(iid => {
      const el = cardEl(game.cards[iid]);
      el.style.left = el.style.top = el.style.zIndex = '';
      return el;
    }));
    view.querySelector('.pile-wrap.cmd').hidden = !game.commander && !game.zones.command.length;

    ['library', 'graveyard', 'exile'].forEach(renderPile);
    // Forget elements for cards that no longer exist (tokens that left).
    for (const iid of cardEls.keys()) if (!game.cards[iid]) cardEls.delete(iid);

    const lands = game.zones.battlefield.filter(iid => Game.isLand(game.cards[iid]));
    const untapped = lands.filter(iid => !game.cards[iid].tapped).length;
    $('#info').innerHTML = `
      <div><span>Hand</span><b>${game.zones.hand.length}</b></div>
      <div><span>Lands</span><b>${lands.length}</b></div>
      <div><span>Untapped lands</span><b>${untapped}</b></div>
      <div><span>Land this turn</span><b class="${game.landPlayed ? 'ok' : 'muted'}">${game.landPlayed ? 'Played' : 'Not yet'}</b></div>
      ${game.mulligans ? `<div><span>Mulligans</span><b>${game.mulligans}</b></div>` : ''}`;
    const upkeep = upkeepIids();
    $('#upkeep').hidden = !upkeep.length;
    $('#upkeep').innerHTML = upkeep.length ? `<b>Upkeep</b> <span>${esc(upkeep.map(iid => game.cards[iid].name).join(', '))}</span> <button class="link-btn" data-act="upkeep-done">Done</button>` : '';
    renderCmdDamage();
    const pool = Game.MANA.reduce((n, k) => n + game.mana[k], 0);
    const free = Game.available(game);
    $('#mana').innerHTML = `
      <div class="mana-head"><span class="muted small">Mana pool${pool ? ` · <b>${pool}</b>` : ''}</span>${pool ? '<button class="link-btn" data-act="clear-mana">Clear</button>' : ''}</div>
      <div class="pips">${Game.MANA.map(k => `<button class="pip pip-${k} ${game.mana[k] ? 'has' : ''}" data-mana="${k}" title="${MANA_NAMES[k]}: click +1, right-click −1"><i>${k}</i><b>${game.mana[k]}</b></button>`).join('')}</div>
      <div class="free small"><div class="muted">Free mana (untapped lands, rocks, dorks):</div><b>${free.total}</b>${free.total ? ` <span class="muted">· ${Game.MANA.filter(k => free.byColor[k]).map(k => `${k} ${free.byColor[k]}`).join(' · ')}</span>` : ''}</div>`;
    renderLog();
    renderOpps();
    if (hoverIid && !game.cards[hoverIid]) showPreview(null);
  }

  // Your log; online, everyone's log and chat merged, newest first.
  function renderLog() {
    const el = $('#log');
    if (!el || !game) return;
    let lines = game.log.slice(0, 80).map(l => ({ at: l.at || 0, turn: l.turn, msg: l.msg }));
    if (isOnline()) {
      for (const [pid, peer] of Object.entries(peers)) {
        if (peer.board) lines.push(...peer.board.log.map(l => ({ at: (l.at || 0) + peer.offset, turn: l.turn, msg: l.msg, who: pid })));
      }
      lines.push(...chat.map(c => ({ at: c.at, msg: c.msg, who: c.from, chat: true })));
      lines = lines.sort((a, b) => b.at - a.at).slice(0, 150);
    } else if (hasBot()) {
      lines.push(...game.bot.s.log.slice(0, 80).map(l => ({ at: l.at || 0, turn: l.turn, msg: l.msg, who: BOT })));
      lines = lines.sort((a, b) => b.at - a.at).slice(0, 150);
    }
    el.innerHTML = lines.map(l => (l.chat
      ? `<div class="chat-line"><b>${esc(nameOf(l.who))}:</b> ${esc(l.msg)}</div>`
      : `<div class="${l.who ? 'opp-line' : ''}"><span class="muted">T${l.turn}</span> ${l.who ? `<b>${esc(nameOf(l.who))}:</b> ` : ''}${esc(l.msg)}</div>`)).join('');
  }

  function showPreview(iid) {
    hoverIid = iid;
    hoverOpp = null;
    const inst = iid && game && game.cards[iid];
    if (!inst || inst.zone === 'library') return;
    previewCard(inst);
  }

  function showOppPreview(pid, iid) {
    hoverIid = null;
    hoverOpp = pid + '|' + iid;
    const peer = peerOf(pid);
    const inst = peer && peer.cards[iid];
    if (inst) previewCard(inst);
  }

  function previewCard(inst) {
    const box = $('#preview');
    if (box) box.innerHTML = previewHtml(inst);
  }

  // "On Grizzly Bears" / "Equipped: Bonesplitter" for the card preview (your cards only).
  function attachedText(inst) {
    if (!game || game.cards[inst.iid] !== inst) return '';
    const host = inst.attachedTo && game.cards[inst.attachedTo];
    const on = inst.zone === 'battlefield' ? Game.attachmentsOf(game, inst.iid).map(id => game.cards[id].name) : [];
    const theirs = inst.enchanting ? `<div class="muted">On ${esc(nameOf(inst.enchanting.pid))}'s ${esc(inst.enchanting.name)}</div>` : '';
    return theirs + (host ? `<div class="muted">On ${esc(host.name)}</div>` : '') + (on.length ? `<div class="muted">With ${esc(on.join(', '))}</div>` : '');
  }

  function previewHtml(inst) {
    const c = def(inst.id);
    const img = c && (inst.flipped && c.backImage ? c.backImage : c.imageLarge || c.image);
    const other = c && c.backImage ? (inst.flipped ? c.image : c.backImage) : null;
    const counters = Object.entries(inst.counters || {});
    return (img ? `<img src="${esc(img)}" alt="${esc(inst.name)}">` : `<div class="text-face big">${faceHtml(inst)}</div>`)
      + (other ? `<img class="other-face" src="${esc(other)}" alt="Other face">` : '')
      + `<div class="small"><b>${esc(inst.name)}</b>${inst.faceDown ? ' <span class="muted">(face down)</span>' : ''}${inst.token ? ' <span class="pill">token</span>' : ''}
        ${inst.commander ? ` <span class="pill">commander · tax +${(inst.castCount || 0) * 2}</span>` : ''}
        ${inst.chosenType && !inst.faceDown ? ` <span class="pill">chosen type: ${esc(inst.chosenType)}</span>` : ''}
        ${attachedText(inst)}
        ${counters.length ? `<div class="muted">${counters.map(([k, n]) => `${esc(k)}: ${n}`).join(', ')}</div>` : ''}</div>`;
  }

  // ---------- menus for cards and piles ----------

  const COMMON_COUNTERS = ['+1/+1', '-1/-1', 'loyalty', 'shield', 'stun', 'charge', 'lore', 'oil', 'time', 'finality', 'flying', 'deathtouch', 'lifelink', 'trample'];
  // Other counters that cards use, for the suggestions while you type one.
  const MORE_COUNTERS = ['acorn', 'age', 'aim', 'arrow', 'arrowhead', 'awakening', 'blaze', 'blood', 'bloodline', 'book', 'bounty', 'bribery',
    'brick', 'burden', 'cage', 'carrion', 'coin', 'collection', 'component', 'contested', 'corpse', 'corruption', 'credit', 'croak', 'crystal',
    'cube', 'currency', 'death', 'defense', 'delay', 'depletion', 'descent', 'despair', 'devotion', 'divinity', 'doom', 'dream', 'duty', 'echo',
    'egg', 'elixir', 'ember', 'energy', 'enlightened', 'eon', 'experience', 'eyeball', 'eyestalk', 'fade', 'fate', 'feather', 'fellowship',
    'fetch', 'filibuster', 'flame', 'flood', 'foreshadow', 'fungus', 'funk', 'fury', 'fuse', 'gem', 'ghostform', 'glyph', 'gold', 'growth',
    'harmony', 'hatching', 'hatchling', 'healing', 'hit', 'hone', 'hope', 'hoofprint', 'hour', 'hourglass', 'hunger', 'husk', 'ice', 'impostor',
    'incarnation', 'incubation', 'infection', 'influence', 'ingenuity', 'intel', 'intervention', 'invitation', 'isolation', 'javelin', 'judgment',
    'ki', 'kick', 'knickknack', 'knowledge', 'landmark', 'level', 'loot', 'luck', 'magnet', 'manabond', 'manifestation', 'mannequin', 'matrix',
    'memory', 'midway', 'mine', 'mining', 'mire', 'music', 'muster', 'necrodermis', 'net', 'night', 'omen', 'ore', 'page', 'pain', 'palliation',
    'paralyzation', 'pause', 'petal', 'petrification', 'phylactery', 'phyresis', 'pin', 'plague', 'plot', 'poison', 'polyp', 'pressure', 'prey',
    'pupa', 'quest', 'rad', 'rejection', 'reprieve', 'rev', 'ribbon', 'ritual', 'rope', 'rust', 'scream', 'scroll', 'shell', 'silver', 'slime',
    'slumber', 'soot', 'soul', 'spark', 'spite', 'spore', 'stash', 'storage', 'story', 'strife', 'study', 'suspect', 'takeover', 'task', 'theft',
    'tide', 'tower', 'training', 'trap', 'treasure', 'unity', 'unlock', 'valor', 'velocity', 'verse', 'vitality', 'void', 'volatile', 'vortex',
    'vow', 'voyage', 'wage', 'winch', 'wind', 'wish', 'wreck',
    '+1/+0', '+0/+1', '+1/+2', '+2/+2', '-0/-1', '-0/-2', '-1/-0', '-2/-1', '-2/-2'];
  const COLOR_NAMES = ['white', 'blue', 'black', 'red', 'green'];
  const KNOWN_COUNTERS = [...new Set([...COMMON_COUNTERS, ...Bot.KEYWORDS, ...MORE_COUNTERS, ...COLOR_NAMES.map(c => 'protection from ' + c)])];
  // A counter name to keep: a keyword in its proper spelling, a +X/+Y one, or one cards use. Else null.
  function realCounter(raw) {
    const name = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const kw = Bot.keywordCounter(name);
    if (kw) return kw;
    if (/^[+-]\d+\s*\/\s*[+-]\d+$/.test(name)) return name.replace(/\s/g, '');
    return KNOWN_COUNTERS.includes(name) ? name : null;
  }
  // Suggestions for what you've typed: names that start with it, then ones with a word that does.
  function counterSuggestions(typed) {
    const t = typed.trim().toLowerCase();
    if (!t) return [];
    const starts = KNOWN_COUNTERS.filter(k => k.startsWith(t));
    const words = KNOWN_COUNTERS.filter(k => !k.startsWith(t) && k.split(/[\s/]+/).some(w => w.startsWith(t)));
    return [...starts, ...words].filter(k => k !== t).slice(0, 8);
  }

  // Counters you've used, newest first. The ones you've typed yourself (like +1/+0) are listed in the
  // counter picker so you don't have to type them again; the newest 3 of any kind are in the top bar.
  // Only real counter names are kept, so a typo doesn't become a shortcut.
  const recentCounters = () => (ui.recentCounters || []).filter(k => !COMMON_COUNTERS.includes(k) && realCounter(k));
  function rememberCounter(name) {
    name = realCounter(name);
    if (!name) return;
    ui.recentCounters = [name, ...(ui.recentCounters || []).filter(k => k !== name && realCounter(k))].slice(0, 16);
    saveSoon();
    renderCounterDock();
  }

  // Desktop: your 3 newest counters in the top bar. Drag one onto a card to add one of it.
  function renderCounterDock() {
    const dock = $('#counterDock');
    if (!dock) return;
    const last = (ui.recentCounters || []).filter(k => realCounter(k)).slice(0, 3);
    dock.hidden = !last.length;
    dock.innerHTML = `<span class="muted small">Counters</span>${last.map(k => `<span class="pill chip mine" draggable="true" data-dock-counter="${esc(k)}" title="Drag onto one of your cards to add a ${esc(k)} counter">${esc(k)}</span>`).join('')}`;
  }

  // Adds one counter dropped from the dock. Keyword counters (flying, lifelink…) only once.
  function dropCounter(iid, name) {
    const inst = game && game.cards[iid];
    if (!inst || inst.zone !== 'battlefield') return;
    if (Bot.keywordCounter(name) && inst.counters[name]) return status(`${inst.name} already has a ${name} counter.`);
    rememberCounter(name);
    act(() => Game.counter(game, iid, name, 1, { effect: true }));
  }
  const COUNTER_DRAG = 'application/x-mtg-counter';
  document.addEventListener('dragstart', e => {
    const chip = e.target.closest && e.target.closest('[data-dock-counter]');
    if (!chip) return;
    e.dataTransfer.setData(COUNTER_DRAG, chip.dataset.dockCounter);
    e.dataTransfer.effectAllowed = 'copy';
  });
  const counterTarget = e => (e.dataTransfer && [...e.dataTransfer.types].includes(COUNTER_DRAG) && e.target.closest ? e.target.closest('.card[data-iid]') : null);
  const clearCounterDrop = () => document.querySelectorAll('.card.drop-over').forEach(n => n.classList.remove('drop-over'));
  document.addEventListener('dragover', e => {
    const card = counterTarget(e);
    clearCounterDrop();
    if (!card || !game || !game.cards[card.dataset.iid] || game.cards[card.dataset.iid].zone !== 'battlefield') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    card.classList.add('drop-over');
  });
  document.addEventListener('dragend', clearCounterDrop);
  document.addEventListener('drop', e => {
    const card = counterTarget(e);
    clearCounterDrop();
    if (!card) return;
    e.preventDefault();
    dropCounter(card.dataset.iid, e.dataTransfer.getData(COUNTER_DRAG));
  });

  // Any counter you can name: click a saved or common one, or type your own, then pick how many.
  function counterPrompt(iid) {
    const inst = game.cards[iid];
    if (!inst) return;
    const mine = recentCounters();
    openModal(`<form class="ask" id="counterForm"><h3>Add counters to ${esc(inst.faceDown ? 'face-down card' : inst.name)}</h3>
      ${mine.length ? `<label class="small muted">Your counters <button type="button" class="link-btn" data-counter-clear>clear</button></label>
      <div class="chips">${mine.map(k => `<button type="button" class="pill chip mine" data-counter-pick="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <label class="small muted">Common</label>` : ''}
      <div class="chips">${COMMON_COUNTERS.map(k => `<button type="button" class="pill chip" data-counter-pick="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <label class="small muted">Counter name</label>
      <div class="suggest-wrap"><input name="name" type="text" placeholder="Type any counter, e.g. +2/+2, quest, xx" maxlength="30" autocomplete="off">
      <div class="suggest" data-suggest hidden></div></div>
      <label class="small muted" data-counter-n>How many</label>
      <input name="n" type="number" min="1" value="1" data-counter-n>
      <div class="toolbar end"><button type="button" class="btn ghost" data-ask="cancel">Cancel</button><button class="btn">Add</button></div></form>`);
    const form = $('#counterForm');
    form.name.focus();
    // Keyword counters (flying, lifelink…) are on or off, so there's no "how many": one click adds it.
    const isKw = name => !!Bot.keywordCounter(name);
    const addKw = name => {
      const k = Bot.keywordCounter(name);
      done();
      if (inst.counters[k]) return status(`${inst.name} already has a ${k} counter.`);
      rememberCounter(k);
      act(() => Game.counter(game, iid, k, 1));
    };
    // What it thinks you mean, as you type: click one, or arrow down to it and press Enter or Tab.
    const box = form.querySelector('[data-suggest]');
    let sel = -1;
    const showSuggest = () => {
      const list = counterSuggestions(form.name.value);
      sel = Math.min(sel, list.length - 1);
      box.hidden = !list.length;
      box.innerHTML = list.map((k, i) => `<button type="button" class="suggest-item${i === sel ? ' on' : ''}" data-suggest-pick="${esc(k)}">${esc(k)}</button>`).join('');
      box.querySelectorAll('[data-suggest-pick]').forEach(b => {
        b.onmousedown = e => e.preventDefault(); // keep the focus in the box
        b.onclick = () => pickSuggest(b.dataset.suggestPick);
      });
    };
    const pickSuggest = k => {
      form.name.value = k;
      sel = -1;
      form.name.oninput();
      box.hidden = true;
      if (!isKw(k)) { form.n.focus(); form.n.select(); }
    };
    form.name.oninput = () => {
      form.querySelectorAll('[data-counter-n]').forEach(el => { el.hidden = isKw(form.name.value); });
      showSuggest();
    };
    form.name.onkeydown = e => {
      const items = [...box.querySelectorAll('[data-suggest-pick]')];
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items.length + 1; // -1 is the box itself
        sel = (((sel + 1 + (e.key === 'ArrowDown' ? 1 : -1)) % n) + n) % n - 1;
        showSuggest();
      } else if ((e.key === 'Enter' || e.key === 'Tab') && sel >= 0) {
        e.preventDefault();
        pickSuggest(items[sel].dataset.suggestPick);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        box.hidden = true;
      }
    };
    form.name.onblur = () => { box.hidden = true; };
    form.querySelectorAll('[data-counter-pick]').forEach(b => {
      b.onclick = () => {
        if (isKw(b.dataset.counterPick)) return addKw(b.dataset.counterPick);
        form.name.value = b.dataset.counterPick;
        form.name.oninput();
        form.n.focus();
        form.n.select();
      };
    });
    const done = () => { modal.hidden = true; modalBox.innerHTML = ''; };
    form.querySelector('[data-ask=cancel]').onclick = done;
    const clear = form.querySelector('[data-counter-clear]');
    if (clear) clear.onclick = () => { ui.recentCounters = []; saveSoon(); counterPrompt(iid); };
    form.onsubmit = e => {
      e.preventDefault();
      const name = form.name.value.trim();
      const n = Math.floor(Number(form.n.value));
      if (!name) return form.name.focus();
      if (isKw(name)) return addKw(name);
      done();
      if (n > 0) {
        const real = realCounter(name);
        rememberCounter(name);
        act(() => Game.counter(game, iid, real || name, n, { effect: true }));
      }
    };
  }

  // The creature types in your deck, most common first (for "choose a creature type").
  function deckCreatureTypes() {
    const counts = {};
    for (const inst of Object.values(game.cards)) {
      if (inst.token || !Game.isCreature(inst)) continue;
      const sub = String(inst.typeLine || '').split('//')[0].split('—')[1] || '';
      sub.split(/\s+/).filter(Boolean).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  }

  // "As this enters, choose a creature type": click one from your deck or type any.
  // A modal spell you cast: tick the modes. You may tick as many as it allows (Akroma's Will: one,
  // or both while your commander is on the battlefield). Done, the spell goes to the graveyard.
  function chooseModes(iid) {
    const inst = game.cards[iid];
    const info = inst && Bot.spellModes(inst, def);
    if (!info) return;
    const hasCommander = game.zones.battlefield.some(id => game.cards[id].commander);
    const max = hasCommander ? info.commanderPick : info.pick;
    const why = info.commanderPick > info.pick ? (hasCommander ? ' (your commander is out)' : ' (more with your commander out)') : '';
    openModal(`<form class="ask" id="modeForm"><h3>${esc(inst.name)}</h3>
      <p class="muted small">Choose ${max === info.modes.length && max > 1 ? (max === 2 ? 'one or both' : 'any number') : max === 1 ? 'one' : `up to ${max}`}${esc(why)}.</p>
      <div class="block-picks">${info.modes.map((m, i) => `<label class="check"><input type="checkbox" value="${i}"> ${esc(m)}</label>`).join('')}</div>
      <div class="toolbar end"><button type="button" class="btn ghost" data-ask="cancel" title="Leave it on the table and do it by hand">Cancel</button><button class="btn">Cast</button></div></form>`);
    const form = $('#modeForm');
    const boxes = [...form.querySelectorAll('input[type=checkbox]')];
    // One allowed: ticking a mode unticks the other. More: the rest lock once you hit the limit.
    boxes.forEach(b => {
      b.onchange = () => {
        if (max === 1 && b.checked) boxes.forEach(o => { if (o !== b) o.checked = false; });
        const n = boxes.filter(o => o.checked).length;
        if (max > 1) boxes.forEach(o => { o.disabled = !o.checked && n >= max; });
      };
    });
    const done = () => { modal.hidden = true; modalBox.innerHTML = ''; };
    form.querySelector('[data-ask=cancel]').onclick = done;
    form.onsubmit = e => {
      e.preventDefault();
      const chosen = boxes.filter(o => o.checked).map(o => Number(o.value));
      if (!chosen.length) return status('Tick a mode first.', 'warn');
      done();
      act(() => {
        Bot.runModes(game, inst, def, chosen, Object.assign({ other: hasBot() ? game.bot.s : null }, effectCtx(), { target: (eff, part, src) => effectCtx().target(eff, part, src || inst) }));
        if (inst.zone === 'battlefield') Game.move(game, inst.iid, 'graveyard');
      });
    };
  }

  function chooseTypePrompt(iid) {
    const inst = game.cards[iid];
    if (!inst || inst.zone !== 'battlefield') return;
    const types = deckCreatureTypes().slice(0, 16);
    openModal(`<form class="ask" id="typeForm"><h3>Choose a creature type for ${esc(inst.name)}</h3>
      ${types.length ? `<label class="small muted">In your deck</label>
      <div class="chips">${types.map(t => `<button type="button" class="pill chip" data-type-pick="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <label class="small muted">Creature type</label>
      <input name="t" type="text" value="${esc(inst.chosenType || '')}" placeholder="e.g. Elf, Goblin, Dragon" maxlength="30" autocomplete="off">
      <div class="toolbar end"><button type="button" class="btn ghost" data-ask="cancel">Cancel</button><button class="btn">Choose</button></div></form>`);
    const form = $('#typeForm');
    form.t.focus();
    const done = () => { modal.hidden = true; modalBox.innerHTML = ''; };
    const pick = raw => {
      const t = raw.trim().replace(/^\w/, ch => ch.toUpperCase());
      if (!t) return form.t.focus();
      done();
      act(() => {
        inst.chosenType = t;
        Game.log(game, `Chose ${t} for ${inst.name}.`);
      });
    };
    form.querySelectorAll('[data-type-pick]').forEach(b => { b.onclick = () => pick(b.dataset.typePick); });
    form.querySelector('[data-ask=cancel]').onclick = done;
    form.onsubmit = e => { e.preventDefault(); pick(form.t.value); };
  }

  // How many copies to make, and whether they get the original's counters.
  function copyPrompt(iid) {
    const inst = game.cards[iid];
    if (!inst) return;
    const hasCounters = Object.keys(inst.counters || {}).length > 0;
    openModal(`<form class="ask" id="copyForm"><h3>Copy ${esc(inst.faceDown ? 'face-down card' : inst.name)}</h3>
      <p class="muted small">Copies are tokens on the battlefield.${inst.zone === 'battlefield' ? '' : ' The card itself stays where it is.'}</p>
      <label class="small muted">How many</label>
      <input name="n" type="number" min="1" max="50" value="1">
      ${hasCounters ? '<label class="check small"><input type="checkbox" name="counters"> Copy its counters too</label>' : ''}
      <div class="toolbar end"><button type="button" class="btn ghost" data-ask="cancel">Cancel</button><button class="btn">Make copies</button></div></form>`);
    const form = $('#copyForm');
    form.n.focus();
    form.n.select();
    const done = () => { modal.hidden = true; modalBox.innerHTML = ''; };
    form.querySelector('[data-ask=cancel]').onclick = done;
    form.onsubmit = e => {
      e.preventDefault();
      const n = Math.max(1, Math.min(50, Math.floor(Number(form.n.value)) || 1));
      const withCounters = !!(form.counters && form.counters.checked);
      done();
      act(() => Game.copyAsToken(game, iid, { n, counters: withCounters }));
    };
  }

  function moveItems(iid, here) {
    const to = (label, zone, opts) => ({ label, action: () => act(() => Game.move(game, iid, zone, opts)) });
    const inst = game.cards[iid];
    const items = [];
    if (here !== 'hand') items.push(to('To hand', 'hand'));
    if (here !== 'battlefield') items.push(to('To battlefield', 'battlefield'));
    if (here !== 'graveyard') items.push(to('To graveyard', 'graveyard'));
    if (here !== 'battlefield' && here !== 'library') items.push({ label: 'Make a token copy…', action: () => copyPrompt(iid) });
    if (here !== 'exile') items.push(to('To exile', 'exile'));
    items.push(to('Top of library', 'library', { index: 0 }));
    items.push(to('Bottom of library', 'library', { bottom: true }));
    if (inst.commander && here !== 'command') items.push(to('To command zone', 'command'));
    return items;
  }

  // ---------- abilities done for you ----------

  // "Each opponent loses N life": Opp (or the goldfish Opp), or everyone else online.
  // "Target player loses N life" (Blood Artist): Opp, or online the player you pick with −.
  const later = (list, req) => { (game[list] = game[list] || []).push(req); };
  const effectCtx = () => ({
    // dmg: it's damage ("deals 1 damage to each opponent"), which Massacre Girl, Most Wanted sees.
    hitOpps: (n, dmg) => {
      if (isOnline()) others().forEach(p => { (game.oppHits = game.oppHits || []).push({ to: p.pid, d: -n }); });
      else game.oppLife -= n;
      if (dmg) Bot.opponentDamaged(game, game, n, def, effectCtx());
    },
    hitTarget: n => {
      if (isOnline()) (game.oppHits = game.oppHits || []).push({ to: 'target', d: -n });
      else game.oppLife -= n;
    },
    // "Destroy target creature", "deals 3 damage to any target": you're asked which (mustTargetPrompt).
    target: (eff, part, src) => { (game.mustTarget = game.mustTarget || []).push({ eff, part, src: src ? src.name : 'Effect', srcIid: src && src.iid ? src.iid : null }); },
    // Agent of the Fates: "each opponent sacrifices a creature of their choice".
    oppsSacrifice: (n, what) => {
      if (hasBot()) Bot.oppSacrifices(game, n, 'Your effect', what);
      else Game.log(game, `Each opponent sacrifices ${n === 1 ? 'a' : n} ${what} (they do that on their side).`);
    },
    // Unstoppable Slasher: the player it hit loses half their life, rounded up.
    loseHalf: () => {
      if (!hasBot()) return false;
      game.oppLife -= Math.ceil(Math.max(0, game.oppLife) / 2);
    },
    // Blot Out, Bojuka Bog, Appetite for Brains, Baleful Mastery, Junji: done on Opp's table; online they do it on theirs.
    oppsExileGreatest: what => {
      if (hasBot()) return Bot.exileGreatest(game, game.bot.s, what, 'Your effect', def);
      Game.log(game, `Each targeted opponent exiles their ${what} with the greatest mana value (they do that on their side).`);
    },
    exileGrave: () => {
      if (hasBot()) return Bot.exileGraveyard(game.bot.s, 'Your effect');
      Game.log(game, 'Exile target player\'s graveyard (they do that on their side).');
    },
    oppsHandPick: spec => {
      if (!hasBot()) return Game.log(game, 'Target opponent reveals their hand and you take a card from it (do that with them).');
      later('mustHand', spec);
    },
    oppsDraw: n => {
      if (hasBot()) Game.drawCards(game.bot.s, n, true);
      Game.log(game, `An opponent draws ${n === 1 ? 'a card' : n + ' cards'}${hasBot() ? '' : ' (they do that on their side)'}.`);
    },
    oppsDiscard: n => {
      if (hasBot()) Bot.oppDiscards(game, n, false, 'Your effect');
      else Game.log(game, `Each opponent discards ${n === 1 ? 'a card' : n + ' cards'} (they do that on their side).`);
    },
    othersMill: n => Game.log(game, `Each other player mills ${n === 1 ? 'a card' : n + ' cards'} (they do that on their side).`),
    // "Choose one —" on a trigger (Retreat to Hagra, Junji): you tick it (mustModesPrompt).
    chooseModes: (modes, pick, src) => later('mustModes', { modes, pick, src: src.name, self: src.iid }),
    // Cards from graveyards (Liliana, Junji, Archenemy's Charm, The Darkness Crystal) or your hand (Ugin): you pick them.
    moveCards: (spec, src) => later('mustCards', { spec, src: src ? src.name : 'Effect' }),
    // Garza's Assassin (recover): pay or exile it.
    recover: (card, cost) => later('mustRecover', { iid: card.iid, cost }),
    // Reno and Rude: "exile the top card of that player's library" and the choice to sacrifice for it.
    exileTop: src => {
      if (!hasBot()) return false;
      const c = Bot.exileTopCard(game, game, src ? src.name : 'Effect');
      game.lastExiledTop = c ? c.iid : null;
    },
    sacToPlay: (what, src) => {
      if (!hasBot() || !game.lastExiledTop) return false;
      later('mustSacToPlay', { what, src: src ? src.name : 'Effect', srcIid: src ? src.iid : null, card: game.lastExiledTop });
    },
    // Opp's Rhystic Study or Smothering Tithe: you're asked whether you pay.
    payTax: req => later('mustTax', req),
    // Karumonix: you pick the Rat cards from the top five.
    dig: (spec, src) => later('mustDig', { ...spec, src: src ? src.name : 'Effect' }),
    // Lord Skitter's Butcher: "You may sacrifice another creature. If you do, scry 2, then draw a card."
    sacThen: (what, rest, src) => later('mustSacThen', { what, rest, src: src ? src.name : 'Effect', srcIid: src ? src.iid : null }),
    // Eerie Interlude: you pick which of your creatures to exile until the next end step.
    flicker: (what, src) => later('mustFlicker', { what, src: src ? src.name : 'Effect' }),
    // "Search your library for …", "Scry 2", "Surveil 1": you pick the cards (mustLibraryPrompt).
    search: (spec, src) => { (game.mustLibrary = game.mustLibrary || []).push({ kind: 'search', spec, src }); },
    scry: (n, kind, src) => { (game.mustLibrary = game.mustLibrary || []).push({ kind, n, src }); },
    // "Choose a number between 0 and 10. Destroy all creatures with power …" (Expel the
    // Interlopers): you pick the number, then the wipe (then) runs with it (mustLibraryPrompt).
    chooseNumber: (min, max, src, then) => { (game.mustLibrary = game.mustLibrary || []).push({ kind: 'number', min, max, src, then }); },
    // What comes after the search or scry ("Scry 1. Draw a card.") waits for your pick.
    later: (text, self) => {
      const list = game.mustLibrary;
      const last = list && list[list.length - 1];
      if (last) Object.assign(last, { then: [last.then, text].filter(Boolean).join('. '), self: self ? self.iid : null });
    },
    defOf: def,
  });

  // Opp counters your spell as you cast it (its counterspells; see Bot.oppCounters).
  Game.hooks.casting = (s, inst) => s === game && hasBot() && Bot.oppCounters(game, inst, def);

  // Opp's spells wait for your answer when you have an instant (or flash card) you can pay for.
  Bot.setResponder((g, spell) => g === game && hasBot() && ui.respond !== false && game.zones.hand.some(iid => {
    const c = game.cards[iid];
    if (Game.isLand(c) || !Bot.isInstantSpeed(c, def)) return false;
    const cost = castCost(c);
    return !cost || !!Game.autoPay(JSON.parse(JSON.stringify(game)), cost.cost, cost.tax - cost.less);
  }));

  // "When this creature dies, create a 2/1 black Cat creature token": on your table and Opp's.
  // Also undying, persist, afterlife and "whenever a creature dies" (Blood Artist) on either table.
  Game.hooks.died = (s, inst, info) => {
    if (s === game) Bot.died(game, inst, def, effectCtx(), game, info || {});
    else if (hasBot() && s === game.bot.s) Bot.died(s, inst, def, null, game, info || {});
    else return;
    Bot.afterDeath(game, s, inst, info || {}, def, effectCtx());
  };
  // The Darkness Crystal: "If a nontoken creature an opponent controls would die, instead exile it …"
  Game.hooks.wouldDie = (s, inst) => (game && (s === game || (hasBot() && s === game.bot.s)) ? Bot.wouldDie(game, s, inst, def) : null);
  // Madness: a card of yours you discard goes to exile, and you're asked whether to cast it (mustMadnessPrompt).
  Game.hooks.discard = (s, inst) => {
    if (!game || s !== game || inst.faceDown || !Bot.madnessCost(inst, def)) return null;
    later('mustMadness', { iid: inst.iid });
    return 'exile';
  };
  // Syr Konrad: cards going to and leaving graveyards, on any table.
  Game.hooks.moved = (s, inst, from, to) => {
    if (game && (s === game || (hasBot() && s === game.bot.s))) Bot.cardMoved(game, s, inst, from, to, def, effectCtx());
  };
  // A card you took from Opp (or Opp from you) goes back to its owner when it leaves the battlefield.
  Game.hooks.sendHome = (s, inst, to) => { if (game && hasBot()) Bot.sendHome(game, s, inst, to, def); };
  // Smothering Tithe: a player drew, and the other side's "whenever an opponent draws a card" sees it.
  Game.hooks.drew = (s, n) => { if (game && hasBot() && (s === game || s === game.bot.s)) Bot.opponentActed(game, s, 'draw', n, def, s === game ? effectCtx() : null); };
  // "When this enters, it deals 2 damage to each opponent": Massacre Girl, Most Wanted sees it.
  Game.hooks.oppDamaged = (s, n) => { if (game && (s === game || (hasBot() && s === game.bot.s))) Bot.opponentDamaged(game, s, n, def, s === game ? effectCtx() : null); };

  // A spell you cast: prowess, "whenever you cast …", cascade, storm, then instants and sorceries
  // that are simple enough resolve on their own. Opp's spells are handled in bot.js.
  Game.hooks.cast = (s, inst) => {
    if (s !== game) return;
    Bot.spellCast(game, game, inst, def, effectCtx());
    if (!Bot.spellModes(inst, def)) Bot.spellResolve(game, game, inst, def, effectCtx());
  };

  // "Whenever a creature you control enters, …" (Ajani's Welcome) counts tokens too.
  Game.hooks.tokenEntered = (s, inst) => {
    Bot.enterTrigger(s, inst, def); // a token copy of Spider-Man
    if (s === game) Bot.creatureEntered(game, inst, def, effectCtx());
    else if (hasBot() && s === game.bot.s) Bot.creatureEntered(game, inst, def, null, s);
  };

  // Landfall on your cards ("Whenever a land enters under your control, …").
  Game.hooks.entered = (s, inst) => {
    // Offspring paid: "when this creature enters, create a 1/1 token copy of it".
    if (s === game && inst.offspringPaid) { delete inst.offspringPaid; Bot.offspringCopy(game, inst); }
    // "As this land enters, you may pay 3 life. If you don't, it enters tapped." (Boggart Bog): you're asked.
    if (s === game && !inst.faceDown && Game.isLand(inst) && inst.entersTapped && inst.entersTapped.payLife) later('mustShock', { iid: inst.iid, n: inst.entersTapped.payLife });
    // Wall of Stolen Identity: you pick what it copies; Opp's copies your best creature.
    if (!inst.faceDown && !inst.original && Bot.cloneLine(inst, def)) {
      if (s === game) { inst.copyPending = true; later('mustCopy', { iid: inst.iid }); } // a 0/0 waiting for your pick doesn't die yet
      else if (hasBot() && s === game.bot.s) Bot.autoCopy(game, s, inst, def);
    }
    // "Modular 1", "enters with two +1/+1 counters on it": on your table and Opp's.
    if (!inst.faceDown) {
      for (const [kind, n] of Object.entries(Game.entersWithCounters(oracleOf(inst)))) {
        const got = Game.counter(s, inst.iid, kind, n, { effect: true });
        Game.log(s, `${inst.name} enters with ${got} ${kind} counter${got === 1 ? '' : 's'}.`);
      }
    }
    // "When this enters, put a +1/+1 counter on each other creature you control" (Spider-Man): either table.
    Bot.enterTrigger(s, inst, def);
    // "When this enters, destroy target creature an opponent controls", "… create two 1/1 tokens": you pick targets; Opp picks its own.
    // Heraldic Banner: "As this artifact enters, choose a color." (the color most of the deck's creatures are)
    if (!inst.faceDown && !inst.chosenColor && Game.choosesColor(oracleOf(inst))) {
      inst.chosenColor = Bot.bestColor(s, def);
      Game.log(s, `${inst.name}: chose ${{ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[inst.chosenColor]}.`);
    }
    // A ninja coming in mid-combat picks its own targets (combat doesn't wait for a prompt).
    const enterCtx = inst.combatEntry ? Object.assign(effectCtx(), { target: (eff, part, src) => { Bot.autoTarget(game, s, src || inst, eff, def); } }) : effectCtx();
    if (s === game || (hasBot() && s === game.bot.s)) Bot.enterEffects(game, s, inst, def, enterCtx);
    if (s === game && Game.isLand(inst) && !inst.faceDown) Bot.landEntered(game, inst, def, effectCtx());
    if (s === game) Bot.creatureEntered(game, inst, def, effectCtx());
    // Opp's landfall and "whenever a creature you control enters".
    if (hasBot() && s === game.bot.s) {
      if (Game.isLand(inst) && !inst.faceDown) Bot.landEntered(game, inst, def, null, s);
      Bot.creatureEntered(game, inst, def, null, s);
    }
    // "Choose one —": you tick the modes (after the move finishes, like the type prompt below).
    if (s === game && Bot.spellModes(inst, def)) return setTimeout(() => chooseModes(inst.iid), 0);
    // "Creatures you control get +2/+2 until end of turn": done, so the spell goes to the graveyard.
    if (s === game && Bot.spellPump(game, inst, def)) return Game.move(game, inst.iid, 'graveyard');
    if (s === game && !inst.faceDown && /\binstant\b/i.test(inst.typeLine || '') && Game.isCounterspell(oracleOf(inst))) {
      counterNewest(inst);
      return Game.move(game, inst.iid, 'graveyard');
    }
    // Opened after the move finishes, so an aura's attach prompt or a menu click doesn't close it.
    if (s === game && !inst.faceDown && Game.choosesType(oracleOf(inst))) setTimeout(() => chooseTypePrompt(inst.iid), 0);
    // "When this enters, each player discards a card": Opp drops its worst card, and you're asked
    // which of yours (afterChange opens the picker for game.mustDiscard).
    const d = s === game && !inst.faceDown && Game.enterDiscard(inst.name, oracleOf(inst));
    if (!d) return;
    if (d.opp && hasBot()) Bot.oppDiscards(game, d.opp, d.random, inst.name);
    else if (d.opp && isOnline()) Game.log(game, `${inst.name}: each opponent discards ${d.opp === 1 ? 'a card' : d.opp + ' cards'} (they do that on their side).`);
    if (d.you && d.random) {
      for (let i = 0; i < d.you && game.zones.hand.length; i++) Game.move(game, game.zones.hand[Game.randomInt(game.zones.hand.length)], 'graveyard');
    } else if (d.you) game.mustDiscard = { n: ((game.mustDiscard || {}).n || 0) + d.you, why: inst.name };
  };

  // A counterspell you cast counters the newest spell on any table: yours, Opp's, or an online
  // player's (sent to them, since their table is theirs to change). Mana spent on it stays spent.
  function counterNewest(by) {
    // Opp's spell waiting on the stack for your answer is the newest.
    if (hasBot() && game.bot.s.stack) {
      const name = Bot.counterStack(game);
      Game.log(game, `${by.name}: countered Opp's ${name}.`);
      Bot.counterExtras(game, game, game.bot.s, oracleOf(by), by.name); // An Offer You Can't Refuse, Arcane Denial
      game.notice = `${by.name} countered Opp's ${name}. Click Let it resolve (or End turn) to let Opp carry on.${game.notice ? ' ' + game.notice : ''}`;
      return;
    }
    const picks = [];
    if (game.lastCast) picks.push({ at: game.lastCast.at, s: game });
    if (hasBot() && game.bot.s.lastCast) picks.push({ at: game.bot.s.lastCast.at, s: game.bot.s, opp: true });
    if (isOnline()) {
      others().forEach(p => {
        const peer = peers[p.pid];
        const last = peer && peer.board && peer.board.lastCast;
        if (last) picks.push({ at: last.at + (peer.offset || 0), pid: p.pid, iid: last.iid });
      });
    }
    const pick = picks.sort((a, b) => b.at - a.at)[0];
    let msg;
    if (!pick) msg = 'there was no spell to counter.';
    else if (pick.pid) {
      Online.send({ t: 'counter', iid: pick.iid, by: by.name }, pick.pid);
      const card = peers[pick.pid].cards[pick.iid];
      msg = `countered ${nameOf(pick.pid)}'s ${card ? card.name : 'last spell'}.`;
    } else {
      const done = Game.counterLast(pick.s);
      msg = done ? (pick.opp ? `Opp's ${done}` : done) : 'the last spell already resolved, so undo what it did by hand.';
    }
    if (pick) Bot.counterExtras(game, game, pick.pid ? null : pick.s, oracleOf(by), by.name); // An Offer You Can't Refuse, Arcane Denial
    Game.log(game, `${by.name}: ${msg}`);
    game.notice = `${by.name}: ${msg}${game.notice ? ' ' + game.notice : ''}`;
  }

  // Pays an activated ability's costs (mana, tapping, counters, life, sacrifice, discards), then does what it
  // can of the effect. If a cost can't be paid, nothing happens. discards: the cards picked for a discard cost.
  // A planeswalker's loyalty ability ("+1: …", "−X: …"): once a turn, paid with loyalty counters, and
  // not while The Immortal Sun is out. At 0 loyalty it goes to the graveyard.
  async function activateLoyalty(iid, ab) {
    const inst = game.cards[iid];
    if (!inst || inst.zone !== 'battlefield') return;
    if (Bot.loyaltyLocked(game, def)) return status("Players can't activate planeswalkers' loyalty abilities (The Immortal Sun).", 'warn', 8000);
    if (inst.loyaltyTurn === game.turn) return status(`${inst.name} has already used a loyalty ability this turn.`, 'warn');
    const have = Bot.loyaltyOf(inst, def(inst.id));
    let delta = ab.loyalty;
    let effect = ab.effect;
    if (delta === 'x') {
      const x = await ask(`X for ${inst.name} (it has ${have} loyalty)`, Math.min(have, 1));
      if (x == null || x === '' || Number.isNaN(Number(x))) return;
      delta = -Number(x);
      effect = effect.replace(/\bx\b/gi, String(Number(x)));
    }
    if (delta < 0 && have < -delta) return status(`${inst.name} has only ${have} loyalty.`, 'warn');
    act(() => {
      inst.counters = { ...inst.counters, loyalty: have + delta };
      inst.loyaltyTurn = game.turn;
      const left = Bot.runEffect(game, effect, Object.assign({ self: inst, other: hasBot() ? game.bot.s : null }, effectCtx()));
      Game.log(game, `${inst.name} ${delta >= 0 ? '+' : ''}${delta}: ${effect}${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
      if (inst.zone === 'battlefield' && inst.counters.loyalty <= 0) Game.move(game, iid, 'graveyard');
    });
  }

  function activate(iid, ab, discards, sacs) {
    const inst = game.cards[iid];
    if (!inst || inst.zone !== 'battlefield') return;
    if (ab.loyalty != null) return activateLoyalty(iid, ab);
    if (ab.tap && inst.tapped) return status(`${inst.name} is already tapped.`, 'warn');
    // "{X}: …" (Crypt Rats): ask for X, then it's a cost like any other ("Spend only black mana on X": {B} each).
    if (/\{X\}/i.test(ab.mana) && !ab.x) {
      return ask(`X for ${inst.name}`, 1).then(x => {
        if (x == null || Number.isNaN(Number(x)) || x < 0) return;
        const black = /spend only black mana on x/i.test(ab.effect);
        const mana = ab.mana.replace(/\{X\}/gi, x ? (black ? '{B}'.repeat(x) : `{${x}}`) : '');
        activate(iid, { ...ab, x: String(x), mana, effect: ab.effect.replace(/\bx\b/gi, String(x)) }, discards, sacs);
      });
    }
    if (ab.remove && (inst.counters[ab.remove.kind] || 0) < ab.remove.n) {
      return status(`${inst.name} needs ${ab.remove.n} ${ab.remove.kind} counters (it has ${inst.counters[ab.remove.kind] || 0}).`, 'warn', 8000);
    }
    const light = () => JSON.parse(JSON.stringify({ zones: game.zones, cards: game.cards, mana: game.mana, turn: game.turn, life: game.life, log: [] }));
    if (ab.mana) {
      const copy = light();
      if (ab.tap) copy.cards[iid].tapped = true; // it can't tap for its own cost
      if (!Game.autoPay(copy, ab.mana)) return status(`Not enough untapped mana for ${inst.name} (${ab.mana}), so nothing happened.`, 'warn', 8000);
    }
    // "Discard a card: …": pick what to discard first. Cancel and nothing happens.
    if (ab.discard && !discards) {
      if (game.zones.hand.length < ab.discard) return status(`${inst.name} needs you to discard ${ab.discard === 1 ? 'a card' : ab.discard + ' cards'}, and your hand is too small.`, 'warn', 8000);
      return pickCards({
        title: `Discard ${ab.discard === 1 ? 'a card' : ab.discard + ' cards'} for ${inst.name}`,
        note: ab.text, ids: [...game.zones.hand], max: ab.discard, ok: 'Discard and activate', cancel: 'Cancel',
      }, picks => activate(iid, ab, picks, sacs));
    }
    // "Sacrifice a creature with defender: …" (Towering Titan): pick which.
    if (ab.sacOther && !sacs) {
      const ids = Bot.sacChoices(game, inst, ab.sacOther, def).map(c => c.iid);
      const n = ab.sacCount || 1; // Piper of the Swarm: "Sacrifice three Rats"
      const what = n === 1 ? `a ${ab.sacOther}` : `${n} ${ab.sacOther}`;
      if (ids.length < n) return status(`${inst.name} needs you to sacrifice ${what}, and you don't have enough.`, 'warn', 8000);
      return pickCards({ title: `Sacrifice ${what} for ${inst.name}`, note: ab.text, ids, min: n, max: n, ok: 'Sacrifice and activate', cancel: 'Cancel' }, picks => activate(iid, ab, discards, picks));
    }
    act(() => {
      (sacs || []).forEach(id => { const c = game.cards[id]; if (c) { Game.log(game, `Sacrificed ${c.name} for ${inst.name}.`); Game.move(game, id, c.commander ? 'command' : 'graveyard'); } });
      if (discards) {
        discards.forEach(id => Game.move(game, id, 'graveyard'));
        Game.log(game, `Discarded ${discards.map(id => game.cards[id].name).join(' and ')} for ${inst.name}.`);
      }
      if (ab.tap) inst.tapped = true;
      const spent = [];
      if (ab.mana) {
        const paid = Game.autoPay(game, ab.mana);
        spent.push(...(paid.pool ? [`${paid.pool} floating mana`] : []), ...paid.sources, ...(paid.life ? [`${paid.life} life`] : []));
      }
      if (ab.remove) Game.counter(game, iid, ab.remove.kind, -ab.remove.n);
      if (ab.life) game.life -= ab.life;
      const left = Bot.runEffect(game, ab.effect, Object.assign({ self: inst }, effectCtx()));
      Game.log(game, `Activated ${inst.name}: ${ab.effect}${spent.length ? ` (paid with ${spent.join(', ')})` : ''}${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
      if (ab.sacrifice) Game.move(game, iid, inst.commander ? 'command' : 'graveyard');
      Bot.abilityActivated(game, game, inst, def, effectCtx()); // Crackdown Construct
    });
  }

  // ---------- equipment and auras ----------

  let attaching = null; // iid of the equipment or aura waiting for you to pick a creature

  const equipCostOf = inst => (Game.isAura(inst) ? null : Bot.equipCost((def(inst.id) || {}).oracle));

  // Other players' creatures an aura can go on: [{ pid, card }].
  const theirCreatures = () => others().flatMap(p => {
    const peer = peerOf(p.pid);
    return ((peer && peer.board && peer.board.battlefield) || []).filter(c => c.faceDown || /\bcreature\b/i.test(String(c.typeLine || '').split('//')[0])).map(card => ({ pid: p.pid, card }));
  });

  // Auras can go on anyone's creature (Arrest on an opponent's); equipment only on yours.
  function startAttach(iid) {
    const inst = game.cards[iid];
    if (!inst) return;
    const aura = Game.isAura(inst);
    if (!Bot.yourCreatures(game, def).some(c => c.inst.iid !== iid) && !(aura && theirCreatures().length)) return status('There is no creature to attach it to.', 'warn');
    attaching = iid;
    document.body.classList.add('is-attaching');
    status(`Tap the creature to attach ${inst.name} to${aura && others().length ? ' (yours or an opponent\'s)' : ''}. Tap anything else (or press Esc) to cancel.`, 'ok', 15000);
  }

  // An aura onto another player's creature. It stays on your side (you control it); their creature
  // gets what it does (see syncAuras and receiveAuras), and it goes to your graveyard when that creature leaves.
  function finishAttachTheirs(pid, oiid) {
    const iid = attaching;
    cancelAttach(true);
    const inst = game.cards[iid];
    if (!inst || inst.zone !== 'battlefield') return;
    const target = theirCreatures().find(x => x.pid === pid && x.card.iid === oiid);
    if (!Game.isAura(inst)) return status(`Attach cancelled: you can only equip your own creatures.`);
    if (!target) return status('Attach cancelled: that isn\'t a creature.');
    if (inst.enchanting && inst.enchanting.pid === pid && inst.enchanting.iid === oiid) return status(`${inst.name} is already on ${target.card.name}.`);
    act(() => {
      if (inst.attachedTo) Game.detach(game, iid, true);
      inst.enchanting = { pid, iid: oiid, name: target.card.name, bonus: Bot.attachBonus(oracleOf(inst)) };
      Game.log(game, `Attached ${inst.name} to ${nameOf(pid)}'s ${target.card.name}.`);
    });
  }

  // Your auras on Opp's creatures (Bot.syncAuras); online, the other players read them from your table.
  function syncAuras() {
    if (game) Bot.syncAuras(game);
  }

  // Another player's table arrived: their auras on your creatures (Arrest) take effect, ones that
  // are gone stop, and your auras on their creatures that left go to your graveyard.
  function receiveAuras(from, board) {
    if (!game) return;
    const prefix = `p:${from}:`;
    const field = (board && board.battlefield) || [];
    const want = {};
    for (const c of field) {
      const e = c.enchanting;
      const host = e && e.pid === Online.id() && game.cards[e.iid];
      if (!host || host.zone !== 'battlefield') continue;
      const b = e.bonus || {};
      want[e.iid] = Object.assign(want[e.iid] || {}, {
        [prefix + c.iid]: {
          pow: Number(b.pow) || 0, tou: Number(b.tou) || 0,
          kw: (Array.isArray(b.kw) ? b.kw : []).filter(k => typeof k === 'string' && k.length < 40).slice(0, 10),
          cantAttack: !!b.cantAttack, cantBlock: !!b.cantBlock, noAbilities: !!b.noAbilities,
          label: `${nameOf(from)}'s ${String(c.name || 'aura').slice(0, 80)}`,
        },
      });
    }
    let changed = false;
    for (const inst of Object.values(game.cards)) {
      const next = want[inst.iid] || {};
      for (const k of Object.keys(inst.boosts || {})) {
        if (k.startsWith(prefix) && !next[k]) { delete inst.boosts[k]; changed = true; }
      }
      for (const [k, v] of Object.entries(next)) {
        const had = inst.boosts && inst.boosts[k];
        if (had && JSON.stringify(had) === JSON.stringify(v)) continue;
        if (!had) Game.log(game, `${v.label} is on your ${inst.name}.`);
        inst.boosts = { ...inst.boosts, [k]: v };
        changed = true;
      }
      if (inst.boosts && !Object.keys(inst.boosts).length) delete inst.boosts;
    }
    if (board) {
      for (const iid of [...game.zones.battlefield]) {
        const a = game.cards[iid];
        if (!a.enchanting || a.enchanting.pid !== from || field.some(c => c.iid === a.enchanting.iid)) continue;
        const was = a.enchanting.name;
        Game.move(game, iid, 'graveyard');
        Game.log(game, `${a.name} went to your graveyard: ${nameOf(from)}'s ${was} left the battlefield.`);
        changed = true;
      }
    }
    if (changed) afterChange();
  }

  function cancelAttach(quiet) {
    if (!attaching) return;
    attaching = null;
    document.body.classList.remove('is-attaching');
    if (!quiet) status('Attach cancelled.');
  }

  // Equipment pays its equip cost first (lands are tapped for it); if you can't pay, nothing happens.
  // Auras just move: they were paid for when cast.
  function finishAttach(hostIid) {
    const iid = attaching;
    cancelAttach(true);
    const inst = game.cards[iid];
    const host = hostIid && game.cards[hostIid];
    if (!inst || inst.zone !== 'battlefield') return;
    // "Enchant permanent" (Rune of Mortality) goes on any of your permanents, an Equipment included.
    const anyPermanent = Game.isAura(inst) && /^enchant permanent$/im.test(oracleOf(inst));
    if (!host || host.zone !== 'battlefield' || (!Game.isCreature(host) && !anyPermanent) || host.faceDown || hostIid === iid) return status(`Attach cancelled: that isn't one of your ${anyPermanent ? 'permanents' : 'creatures'}.`);
    // An aura being cast targets what it goes on (heroic).
    const casting = Game.isAura(inst) && !inst.attachedTo && !inst.enchanting && inst.enteredTurn === game.turn && !inst.auraPlaced;
    if (inst.attachedTo === hostIid) return status(`${inst.name} is already on ${host.name}.`);
    const cost = equipCostOf(inst);
    if (cost && !Game.autoPay(JSON.parse(JSON.stringify({ zones: game.zones, cards: game.cards, mana: game.mana, turn: game.turn, log: [] })), cost)) {
      return status(`Not enough untapped mana to equip ${inst.name} (${cost}), so it wasn't attached.`, 'warn', 8000);
    }
    act(() => {
      if (cost) {
        const paid = Game.autoPay(game, cost);
        const spent = [...paid.sources];
        if (paid.pool) spent.unshift(`${paid.pool} floating mana`);
        if (paid.life) spent.push(`${paid.life} life`);
        Game.log(game, `Paid ${cost} to equip ${inst.name}${spent.length ? `: ${spent.join(', ')}` : ''}.`);
      } else if (!Game.isAura(inst)) {
        Game.log(game, `${inst.name}'s equip cost isn't mana, so pay it yourself.`);
      }
      delete inst.enchanting; // moved off another player's creature
      Game.attach(game, iid, hostIid, Bot.attachBonus((def(inst.id) || {}).oracle));
      if (casting) { inst.auraPlaced = true; Bot.spellTargeted(game, game, inst, { inst: host, s: game }, def, effectCtx()); }
    });
  }

  function cardMenu(iid, x, y) {
    const inst = game.cards[iid];
    if (!inst) return;
    const c = def(inst.id) || {};
    let items = [];
    if (inst.zone === 'battlefield') {
      const manaDork = !inst.tapped && !inst.faceDown && inst.mana && Game.isCreature(inst) && !Game.isLand(inst) && !Bot.silenced(inst);
      items = [
        { label: inst.tapped ? 'Untap' : 'Tap', hint: 'click', action: () => tapCard(iid, x, y) },
        ...(manaDork ? inst.mana.colors.map(k => ({ label: `Tap for ${MANA_NAMES[k]} mana`, hint: k, action: () => act(() => Game.setTapped(game, iid, true, k)) })) : []),
        ...(c.backImage ? [{ label: inst.flipped ? 'Flip to front' : 'Flip / transform', hint: 'F', action: () => act(() => Game.toggle(game, iid, 'flipped')) }] : []),
        { label: inst.faceDown ? 'Turn face up' : 'Turn face down', action: () => act(() => {
          const wasDown = inst.faceDown;
          Game.toggle(game, iid, 'faceDown');
          if (wasDown) Bot.turnedFaceUp(game, inst, def, effectCtx()); // Roshan
        }) },
        ...(Game.isAttachment(inst) && !inst.faceDown ? [{ sep: true }, {
          label: inst.attachedTo ? 'Move to another creature…' : Game.isAura(inst) ? 'Attach to…' : `Equip…${equipCostOf(inst) ? ` (${equipCostOf(inst)})` : ''}`,
          hint: 'E', action: () => startAttach(iid),
        }] : []),
        ...(inst.attachedTo ? [{ label: 'Unattach', action: () => act(() => Game.detach(game, iid)) }] : []),
        ...(!inst.faceDown && Game.choosesType(c.oracle) ? [{ label: inst.chosenType ? `Change creature type (${inst.chosenType})…` : 'Choose creature type…', action: () => chooseTypePrompt(iid) }] : []),
        ...(Game.isVehicle(inst) && !inst.faceDown && Bot.crewOf(inst, def) != null && !inst.crewed ? [{ label: `Crew ${Bot.crewOf(inst, def)}…`, action: () => openCrew(iid) }] : []),
        ...(inst.crewed ? [{ label: 'Uncrew', action: () => act(() => Game.uncrew(game, iid)) }] : []),
        ...(inst.faceDown ? [] : Bot.activatedAbilities(inst, def).map(ab => ({
          label: `Activate: ${ab.text.length > 60 ? ab.text.slice(0, 57) + '…' : ab.text}`, action: () => activate(iid, ab),
        }))),
        { sep: true },
        { label: 'Add +1/+1 counter', action: () => act(() => Game.counter(game, iid, '+1/+1', 1, { effect: true })) },
        { label: 'Add -1/-1 counter', action: () => act(() => Game.counter(game, iid, '-1/-1', 1, { effect: true })) },
        ...recentCounters().slice(0, 3).map(k => ({ label: `Add ${k} counter`, action: () => act(() => Game.counter(game, iid, k, 1, { effect: true })) })),
        { label: 'Add any counter…', hint: 'C', action: () => counterPrompt(iid) },
        ...(Object.keys(inst.counters).length ? [{ label: 'Remove all counters', action: () => act(() => { inst.counters = {}; }) }] : []),
        { sep: true },
        { label: 'Make a copy', action: () => act(() => Game.copyAsToken(game, iid)) },
        { label: 'Make copies…', action: () => copyPrompt(iid) },
        ...(inst.id ? [{ label: 'Tokens this card makes…', action: () => openTokens([inst.id]) }] : []),
        { sep: true },
        ...moveItems(iid, 'battlefield'),
      ];
    } else if (inst.zone === 'hand') {
      // A two-faced card whose back is a land (Boggart Trawler // Boggart Bog): play that side as your land.
      const faces = String(c.name || '').split(' // ');
      const backLand = faces.length > 1 && /\bland\b/i.test(String(inst.typeLine || '').split('//')[1] || '');
      items = [
        { label: 'Play', hint: 'click', action: () => tryPlay(iid) },
        ...(backLand ? [{ label: `Play ${faces[1]} (land)`, action: () => tryPlay(iid, { flip: true }) }] : []),
        ...Bot.handAbilities(inst, def).map(ab => ({ label: ab.label, action: () => handAbility(iid, ab) })), // cycling, transmute
        { label: 'Play face down', action: () => act(() => Game.move(game, iid, 'battlefield', { faceDown: true })) },
        { sep: true },
        { label: 'Discard', action: () => act(() => Game.move(game, iid, 'graveyard')) },
        ...moveItems(iid, 'hand').filter(i => !/hand|battlefield|graveyard/.test(i.label)),
      ];
    } else if (inst.zone === 'command') {
      items = [{ label: 'Cast', hint: 'click', action: () => tryPlay(iid) }, { sep: true }, ...moveItems(iid, 'command')];
    } else {
      items = moveItems(iid, inst.zone);
    }
    showMenu(x, y, items);
  }

  async function libraryAction(kind) {
    if (kind === 'draw') {
      const n = await ask('Draw how many?', 2);
      if (n) act(() => Game.drawCards(game, n));
    } else if (kind === 'top') {
      const n = await ask('Look at how many from the top?', 1);
      if (n) {
        viewer = { zone: 'library', top: n, ids: game.zones.library.slice(0, n), filter: '', shuffleOnClose: false };
        act(() => Game.log(game, `Looked at the top ${n}.`));
      }
    } else if (kind === 'mill') {
      const n = await ask('Mill how many?', 3);
      if (n) act(() => Game.mill(game, n));
    } else if (kind === 'search') {
      viewer = { zone: 'library', top: null, filter: '', shuffleOnClose: true };
      act(() => Game.log(game, 'Searched the library.'));
    } else if (kind === 'reveal') {
      const iid = game.zones.library[0];
      if (iid) act(() => Game.move(game, iid, 'exile'));
    }
  }

  function pileMenu(zone, x, y) {
    if (zone === 'library') {
      showMenu(x, y, [
        { label: 'Draw', hint: 'D', action: () => act(() => Game.drawCards(game, 1)) },
        { label: 'Draw several…', action: () => libraryAction('draw') },
        { label: 'Look at top / scry…', action: () => libraryAction('top') },
        { label: 'Search library…', action: () => libraryAction('search') },
        { label: 'Mill…', action: () => libraryAction('mill') },
        { label: 'Exile top card', action: () => libraryAction('reveal') },
        { label: 'Play top card', action: () => { const t = game.zones.library[0]; if (t) act(() => Game.move(game, t, 'battlefield')); } },
        { sep: true },
        { label: 'Shuffle', hint: 'S', action: () => act(() => Game.shuffle(game)) },
      ]);
    } else {
      showMenu(x, y, [
        { label: `View ${Game.ZONE_NAMES[zone]}`, action: () => openViewer(zone) },
        { label: `Shuffle ${Game.ZONE_NAMES[zone]} into library`, action: () => act(() => {
          [...game.zones[zone]].forEach(iid => Game.move(game, iid, 'library', { bottom: true }));
          Game.shuffle(game);
        }) },
      ]);
    }
  }

  // Flips a coin (sides = 2) or rolls a die, and logs the result.
  function roll(sides) {
    act(() => {
      const r = Game.randomInt(sides) + 1;
      const msg = sides === 2 ? `Coin flip: ${r === 1 ? 'Heads' : 'Tails'}.` : `Rolled a d${sides}: ${r}.`;
      Game.log(game, msg);
      status(msg, 'ok');
    });
  }

  // Playing alone: you and Opp each roll a d20 (ties roll again).
  function rollForFirst() {
    act(() => {
      let you;
      let opp;
      do {
        you = Game.randomInt(20) + 1;
        opp = Game.randomInt(20) + 1;
        Game.log(game, `d20 for first: you ${you}, Opp ${opp}${you === opp ? ' (tie, roll again)' : ''}.`);
      } while (you === opp);
      const msg = you > opp ? `You rolled ${you}, Opp rolled ${opp}: you go first.` : `You rolled ${you}, Opp rolled ${opp}: Opp goes first, so you're on the draw.`;
      Game.log(game, msg);
      status(msg, 'ok');
    });
  }

  // Look at top / scry has its own button in the top bar. In the app, Mulligan, Shuffle and
  // Roll a d20 live here too to keep the bar short.
  function toolsMenu(x, y) {
    showMenu(x, y, [
      ...(appMode ? [{ label: 'Mulligan', action: () => act(() => Game.mulligan(game)) }] : []),
      { label: 'Search library…', action: () => libraryAction('search') },
      { label: 'Mill…', action: () => libraryAction('mill') },
      ...(appMode ? [{ label: 'Shuffle library', action: () => act(() => Game.shuffle(game)) }] : []),
      { sep: true },
      ...(appMode ? [{ label: 'Roll a d20', action: () => roll(20) }] : []),
      { label: 'Flip a coin', action: () => roll(2) },
      { label: 'Roll a d6', action: () => roll(6) },
      { sep: true },
      { label: 'Extra combat (attack again)', action: () => act(() => Bot.extraCombat(game)) },
      { label: 'Proliferate', action: () => act(() => Bot.proliferate(game, hasBot() ? game.bot.s : null)) },
      { label: game.monarch ? 'Stop being the monarch' : 'Become the monarch', action: () => act(() => { if (game.monarch) { delete game.monarch; Game.log(game, 'No longer the monarch.'); } else { game.monarch = Date.now(); Game.log(game, 'Became the monarch.'); } }) },
      { sep: true },
      { label: 'Restart on the play', action: () => confirmRestart(false) },
      { label: 'Restart on the draw', action: () => confirmRestart(true) },
      { label: 'See this deck\'s odds', action: () => { ui.oddsDeck = game.deckKey; setTab('odds'); } },
      ...(isOnline() ? [
        { label: 'Change deck…', action: () => setTab('decks') },
        { label: 'Back to the lobby', action: () => { inLobby = true; renderPlay(); } },
      ] : hasBot() ? [] : [{ label: 'Roll for first (you vs Opp)', action: rollForFirst }]),
      { sep: true },
      // For games the Simulator can't call itself (a concession, a kitchen-table game).
      ...(game.recordedResult ? [] : [
        { label: 'Record a win for this deck', action: () => recordResult('win', 'recorded by hand') },
        { label: 'Record a loss for this deck', action: () => recordResult('loss', 'recorded by hand') },
      ]),
      { label: 'Save and switch games', action: () => setTab('decks') },
      { label: 'End game', action: endGame },
    ]);
  }

  // Clears the table, deletes the saved game and goes back to the deck list. Online, you stay in the game with no deck.
  function endGame(decided) {
    if (!game) return;
    if (decided !== true && !confirm(`End this game with ${game.deckName}? The table will be cleared and the saved game deleted.`)) return;
    games = games.filter(g => g.id !== gameId);
    if (gameId) Store.set('game:' + gameId, null);
    game = null;
    gameId = null;
    undoStack = [];
    viewer = null;
    modal.hidden = true;
    modalBox.innerHTML = '';
    Store.set('games', games);
    saveSoon();
    syncSoon();
    setTab('decks');
    status('Game ended.', 'ok');
  }

  function confirmRestart(onDraw) {
    if (confirm(`Reset and start ${game.deckName} over ${onDraw ? 'on the draw' : 'on the play'}? The current game will be lost.`)) startGame(game.deckKey, onDraw, true, hasBot() ? game.bot.s.deckKey : null);
  }

  // ---------- zone viewer (graveyard, exile, library search, top N) ----------

  function openViewer(zone) {
    viewer = { zone, top: null, filter: '', shuffleOnClose: false };
    renderViewer();
  }

  function renderViewer() {
    if (!viewer || !game) return;
    const all = game.zones[viewer.zone];
    // Top n shows only the cards you looked at, in library order; ones sent to the bottom drop out.
    let ids = viewer.top ? all.filter(iid => viewer.ids.includes(iid)) : [...all];
    const searching = viewer.zone === 'library' && !viewer.top;
    if (searching) ids.sort((a, b) => game.cards[a].name.localeCompare(game.cards[b].name));
    if (!searching && viewer.zone !== 'library') ids.reverse(); // newest first
    const q = viewer.filter.toLowerCase();
    if (q) ids = ids.filter(iid => game.cards[iid].name.toLowerCase().includes(q) || (game.cards[iid].typeLine || '').toLowerCase().includes(q));
    const title = viewer.top ? `Top ${ids.length} of your library${viewer.bottomed ? ` · ${viewer.bottomed} sent to the bottom` : ''}` : searching ? 'Search your library' : `${Game.ZONE_NAMES[viewer.zone][0].toUpperCase() + Game.ZONE_NAMES[viewer.zone].slice(1)} (${all.length})`;
    const keepFocus = document.activeElement && document.activeElement.id === 'viewerFilter';
    modalBox.innerHTML = `
      <div class="page-head"><h3>${esc(title)}</h3><button class="btn ghost sm" data-act="close-modal">Done</button></div>
      <div class="toolbar">
        <input type="search" id="viewerFilter" placeholder="Filter by name or type" value="${esc(viewer.filter)}">
        ${searching ? `<label class="check small"><input type="checkbox" data-act="shuffle-close" ${viewer.shuffleOnClose ? 'checked' : ''}> Shuffle when done</label>` : ''}
      </div>
      ${viewer.top ? '<p class="muted small">Left is the top card. Use ◀ ▶ to reorder. Click a card for more options.</p>' : '<p class="muted small">Click a card to move it.</p>'}
      <div class="viewer-grid">${ids.map((iid, i) => {
        const inst = game.cards[iid];
        return `<div class="viewer-card"><div class="card" data-viewer="${iid}">${faceHtml(inst)}</div>
          ${viewer.top ? `<div class="toolbar tight center">
              <button class="btn sm ghost" data-act="vmove" data-iid="${iid}" data-d="-1" ${i === 0 ? 'disabled' : ''}>◀</button>
              <button class="btn sm ghost" data-act="vbottom" data-iid="${iid}">Bottom</button>
              <button class="btn sm ghost" data-act="vmove" data-iid="${iid}" data-d="1" ${i === ids.length - 1 ? 'disabled' : ''}>▶</button></div>` : ''}
        </div>`;
      }).join('') || '<p class="muted">Nothing here.</p>'}</div>`;
    modal.hidden = false;
    if (keepFocus) {
      const f = $('#viewerFilter');
      f.focus();
      f.setSelectionRange(f.value.length, f.value.length);
    }
  }

  // ---------- tokens ----------

  const QUICK_TOKENS = ['Treasure', 'Clue', 'Food', 'Soldier', 'Zombie', 'Spirit', 'Goblin', 'Saproling', 'Cat', 'Beast', 'Elf Warrior', 'Human'];

  async function openTokens(fromIds) {
    openModal(`
      <div class="page-head"><h3>Create a token</h3><button class="btn ghost sm" data-act="close-modal">Close</button></div>
      <div class="toolbar">
        <input type="search" id="tokenQuery" placeholder="Search Scryfall tokens (e.g. Treasure, 2/2 Zombie, Angel)">
        <label class="muted small">How many <input type="number" id="tokenQty" value="1" min="1" max="50" style="width:70px"></label>
        <button class="btn sm ghost" data-act="deck-tokens">Tokens this deck makes</button>
      </div>
      <div class="chips">${QUICK_TOKENS.map(t => `<button class="pill chip" data-token-q="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div id="tokenResults" class="viewer-grid"><p class="muted small">Search above or pick a common token.</p></div>
      <details class="custom-token"><summary>Make your own token</summary>
        <form id="customToken" class="toolbar">
          <input name="name" placeholder="Name (e.g. Construct)" required>
          <input name="pt" placeholder="P/T (e.g. 3/3)" style="width:110px">
          <input name="text" placeholder="Abilities (optional)" style="flex:1">
          <button class="btn sm">Create</button>
        </form>
      </details>`);
    if (fromIds) await showRelatedTokens(fromIds);
    else $('#tokenQuery').focus();
  }

  let tokenResults = [];
  function drawTokenResults(list, empty) {
    tokenResults = list;
    $('#tokenResults').innerHTML = list.length
      ? list.map((c, i) => `<div class="viewer-card"><div class="card" data-token-i="${i}" title="${esc(c.name)}">${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" draggable="false">` : `<div class="text-face"><b>${esc(c.name)}</b></div>`}</div></div>`).join('')
      : `<p class="muted small">${esc(empty || 'No tokens found.')}</p>`;
  }

  async function searchTokens(q) {
    $('#tokenResults').innerHTML = '<p class="muted small">Searching…</p>';
    try {
      const list = await Scryfall.searchTokens(q);
      drawTokenResults(list, `No tokens match "${q}".`);
    } catch (e) {
      drawTokenResults([], 'Search failed: ' + e.message);
    }
  }

  async function showRelatedTokens(ids) {
    $('#tokenResults').innerHTML = '<p class="muted small">Finding tokens…</p>';
    try {
      await ensureDefs(ids, true);
      const tokenIds = [...new Set(ids.flatMap(id => (def(id) && def(id).tokens || []).map(t => t.id)))];
      await ensureDefs(tokenIds);
      // Several printings of the same token (e.g. Treasure) show once; tokens with different stats stay separate.
      const seen = new Set();
      const list = tokenIds.map(def).filter(Boolean).filter(c => {
        const k = `${c.name}|${c.typeLine}|${c.power}/${c.toughness}|${c.oracle}`;
        return !seen.has(k) && seen.add(k);
      });
      drawTokenResults(list.sort((a, b) => a.name.localeCompare(b.name)), 'No tokens listed for these cards.');
    } catch (e) {
      drawTokenResults([], 'Lookup failed: ' + e.message);
    }
  }

  function makeTokens(tokenDef) {
    const qty = Math.max(1, Math.min(50, Number(($('#tokenQty') || {}).value) || 1));
    if (tokenDef.id) {
      local.cards[tokenDef.id] = tokenDef;
      saveLocal();
    }
    let made;
    act(() => {
      made = Game.tokenCount(game, qty); // Doubling Season, Parallel Lives…
      for (let i = 0; i < made.n; i++) Game.createToken(game, tokenDef, { quiet: i > 0 });
      if (made.n > 1) Game.log(game, `(${made.n} ${tokenDef.name} tokens in total${made.by.length ? `, doubled by ${made.by.join(', ')}` : ''}.)`);
    });
    status(`Created ${made.n} ${tokenDef.name} token${made.n > 1 ? 's' : ''}${made.by.length ? ` (doubled by ${made.by.join(', ')})` : ''}.`, 'ok');
  }

  // ---------- drag and drop on the table ----------

  let press = null; // { iid, pile, el, x, y, dx, dy, dragging }

  function onPointerDown(e) {
    if (e.button !== 0 || !game || ui.tab !== 'play' || !modal.hidden) return;
    if (e.target.closest('.counter, button, input, select')) return;
    const onTheirs = attaching && e.target.closest('[data-oiid]');
    if (onTheirs) { e.preventDefault(); return finishAttachTheirs(onTheirs.dataset.opid, onTheirs.dataset.oiid); }
    const theirs = appMode && e.pointerType !== 'mouse' && e.target.closest('[data-oiid]');
    if (theirs) {
      // Another player's card: hold to read it, nothing else.
      const p = press = { el: theirs, dragging: false };
      p.holdTimer = setTimeout(() => {
        const peer = peerOf(theirs.dataset.opid);
        const inst = peer && peer.cards[theirs.dataset.oiid];
        if (press !== p || !inst) return;
        p.held = true;
        showZoom(previewHtml(inst));
      }, 450);
      e.preventDefault();
      return;
    }
    const cardNode = e.target.closest('.table .card[data-iid]');
    const pileNode = !cardNode && e.target.closest('[data-pile]');
    if (!cardNode && !pileNode) return;
    const zone = pileNode && pileNode.dataset.pile;
    const iid = cardNode ? cardNode.dataset.iid : zone === 'library' ? game.zones.library[0] : game.zones[zone][game.zones[zone].length - 1];
    const el = cardNode || pileNode;
    const r = el.getBoundingClientRect();
    press = { iid, pile: zone, el, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, dragging: false };
    if (appMode && cardNode && e.pointerType !== 'mouse') {
      press.touch = true;
      const p = press;
      p.holdTimer = setTimeout(() => {
        if (press !== p || p.dragging) return;
        p.held = true;
        showZoom(previewHtml(game.cards[iid]));
      }, 450);
    }
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!press || press.held) return;
    if (!press.dragging) {
      if (!press.iid || Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      press.dragging = true;
      clearTimeout(press.holdTimer);
      const inst = game.cards[press.iid];
      if (inst.tapped) { press.dx = ui.cardW / 2; press.dy = ui.cardW * 0.7; }
      ghost.innerHTML = faceHtml(inst, press.pile === 'library');
      ghost.style.width = ui.cardW + 'px';
      ghost.hidden = false;
      if (!press.pile) press.el.classList.add('dragging');
      document.body.classList.add('is-dragging');
      hideMenu();
    }
    ghost.style.left = e.clientX - press.dx + 'px';
    ghost.style.top = e.clientY - press.dy + 'px';
    document.querySelectorAll('.drop-over').forEach(n => n.classList.remove('drop-over'));
    const target = dropZoneAt(e.clientX, e.clientY);
    if (target) target.classList.add('drop-over');
  }

  function dropZoneAt(x, y) {
    ghost.hidden = true;
    const el = document.elementFromPoint(x, y);
    ghost.hidden = !(press && press.dragging);
    return el && el.closest('[data-zone]');
  }

  function onPointerUp(e) {
    if (!press) return;
    const p = press;
    press = null;
    clearTimeout(p.holdTimer);
    if (p.held) { zoom.hidden = true; return; }
    if (!p.dragging) {
      if (attaching) return finishAttach(p.pile ? null : p.iid);
      if (!p.iid && !p.pile) return;
      if (p.touch) touchTap(p.iid, e.clientX, e.clientY);
      else clickAction(p, e);
      return;
    }
    ghost.hidden = true;
    p.el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    document.querySelectorAll('.drop-over').forEach(n => n.classList.remove('drop-over'));
    const target = dropZoneAt(e.clientX, e.clientY);
    if (!target) return;
    const zone = target.dataset.zone;
    const inst = game.cards[p.iid];
    if (!inst) return;
    if (zone === 'battlefield') {
      const r = target.getBoundingClientRect();
      const x = (e.clientX - p.dx - r.left + target.scrollLeft) / ui.cardW;
      const y = (e.clientY - p.dy - r.top + target.scrollTop) / ui.cardW;
      tryPlay(p.iid, { x, y });
    } else if (zone === 'hand') {
      const others = game.zones.hand.filter(id => id !== p.iid).map(id => cardEls.get(id));
      let index = others.findIndex(el => el && e.clientX < el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2);
      if (index < 0) index = others.length;
      act(() => Game.move(game, p.iid, 'hand', { index }));
    } else if (zone === 'library') {
      if (inst.zone === 'library') return;
      act(() => Game.move(game, p.iid, 'library', e.shiftKey ? { bottom: true } : { index: 0 }));
    } else if (zone !== inst.zone) {
      act(() => Game.move(game, p.iid, zone));
    }
  }

  function clickAction(p, e) {
    if (p.pile) {
      if (p.pile === 'library') act(() => Game.drawCards(game, 1));
      else openViewer(p.pile);
      return;
    }
    const inst = game.cards[p.iid];
    if (!inst) return;
    if (inst.zone === 'battlefield') tapCard(p.iid, e.clientX, e.clientY);
    else if (inst.zone === 'hand' || inst.zone === 'command') tryPlay(p.iid);
  }

  // Touchscreen in the app: tap a battlefield card for its menu, double tap to tap it,
  // double tap a card in hand (or the command zone) to play it.
  let lastTap = null; // { iid, at, timer }
  function touchTap(iid, x, y) {
    const inst = game.cards[iid];
    if (!inst) return;
    const now = Date.now();
    const twice = lastTap && lastTap.iid === iid && now - lastTap.at < 300;
    if (lastTap) clearTimeout(lastTap.timer);
    lastTap = null;
    if (twice) {
      if (inst.zone === 'battlefield') tapCard(iid, x, y);
      else if (inst.zone === 'hand' || inst.zone === 'command') tryPlay(iid);
      return;
    }
    lastTap = { iid, at: now, timer: setTimeout(() => {
      lastTap = null;
      const card = game && game.cards[iid];
      if (card && card.zone === 'battlefield') cardMenu(iid, x, y);
    }, 300) };
  }

  // ---------- Auto-test tab: automatic games (autoplay.js) ----------
  // Kinds of run: gf (a deck alone), mu (matchup), gt (gauntlet), tc (try a change), lc (land count).

  let autoRun = null; // the run going on now: { kind, done, total, errors, stop }
  const autoLast = {}; // the latest finished results of each kind

  const isLandId = id => Game.isLand(def(id) || {});
  const isBasicId = id => /\bbasic\b/i.test(((def(id) || {}).typeLine || '').split('//')[0]) && isLandId(id);

  function renderTest() {
    const decks = allDecks();
    if (!decks.length) {
      view.innerHTML = '<div class="empty-play"><h3>No decks yet</h3><p class="muted">Link MTG Tracker or paste a deck on the Decks tab.</p></div>';
      return;
    }
    const pick = (k, i = 0) => (findDeck(ui[k]) ? ui[k] : (decks[i] || decks[0]).key);
    const deckSel = (id, key, extra = '') => `<select id="${id}">${extra}${decks.map(d => `<option value="${esc(d.key)}" ${d.key === key ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
    const numSel = (id, val, list) => `<select id="${id}">${list.map(n => `<option ${n === val ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const run = (kind, label = 'Run') => `<button class="btn" data-act="auto-run" data-kind="${kind}" ${autoRun ? 'disabled' : ''}>${label}</button>`;
    const out = kind => `<div id="out-${kind}">${autoOut(kind)}</div>`;
    view.innerHTML = `
      <p class="muted small">The computer plays your decks with Opp's rules: a land each turn, the biggest spells it can afford, attacks that look safe, and Opp's removal and blocks.
        It's a rough guide for comparing decks and versions of a deck, not what a good player would do. Nothing here changes your decks or counts toward their record.</p>
      <section class="panel">
        <h3>Play a deck by itself</h3>
        <p class="muted small">The deck plays alone against an empty table that never blocks: how fast it gets going, when it would have dealt ${'40 (Commander) or 20'} damage, which opening hands work, and which cards help.</p>
        <div class="toolbar tight">
          <label class="muted small">Deck ${deckSel('gfDeck', pick('gfDeck'))}</label>
          <label class="muted small">Games ${numSel('gfN', ui.gfN || 100, [25, 50, 100, 250, 500])}</label>
          <label class="muted small">Turns ${numSel('gfT', ui.gfT || 10, [6, 8, 10, 12, 15])}</label>
          <label class="check small"><input type="checkbox" id="gfDraw" ${ui.gfDraw ? 'checked' : ''}> On the draw</label>
          ${run('gf')}
        </div>
        ${out('gf')}
      </section>
      <section class="panel">
        <h3>Matchup: deck against deck</h3>
        <p class="muted small">Two decks play each other, taking turns going first.</p>
        <div class="toolbar tight">
          <label class="muted small">Deck ${deckSel('muA', pick('muA'))}</label>
          <label class="muted small">against ${deckSel('muB', pick('muB', 1))}</label>
          <label class="muted small">Games ${numSel('muN', ui.muN || 50, [10, 25, 50, 100, 250])}</label>
          ${run('mu')}
        </div>
        ${out('mu')}
      </section>
      <section class="panel">
        <h3>Gauntlet</h3>
        <p class="muted small">One deck against each of your other decks, or every deck against every other: a table of win rates and a ranking.</p>
        <div class="toolbar tight">
          <label class="muted small">Deck ${deckSel('gtDeck', ui.gtDeck === '*' ? '' : pick('gtDeck'), `<option value="*" ${ui.gtDeck === '*' ? 'selected' : ''}>Every deck against every deck</option>`)}</label>
          <label class="muted small">Games per pairing ${numSel('gtN', ui.gtN || 20, [10, 20, 50, 100])}</label>
          ${run('gt')}
        </div>
        <p class="muted small">${decks.length - 1} other deck${decks.length === 2 ? '' : 's'}. Every deck against every deck is ${decks.length * (decks.length - 1) / 2} pairings.</p>
        ${out('gt')}
      </section>
      <section class="panel">
        <h3>Bracket estimate</h3>
        <p class="muted small">Where each Commander deck likely sits in the Commander Brackets (1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH), going by what's in the list:
          Game Changers, mass land denial, extra turns, tutors and well-known two-card combos. No games are played. A list can't show intent, so talk it over with your table.</p>
        <div class="toolbar tight">${run('br', 'Estimate')}</div>
        ${out('br')}
      </section>
      <section class="panel">
        <h3>Try a change</h3>
        <p class="muted small">Take cards out and put others in, then play the old and new versions side by side. Your deck isn't changed.
          Write one card per line, like <code>2 Shock</code> or <code>Grizzly Bears</code>.</p>
        <div class="toolbar tight">
          <label class="muted small">Deck ${deckSel('tcDeck', pick('tcDeck'))}</label>
          <label class="muted small">Also against ${deckSel('tcOpp', findDeck(ui.tcOpp) ? ui.tcOpp : '', `<option value="" ${findDeck(ui.tcOpp) ? '' : 'selected'}>nobody (alone only)</option>`)}</label>
          <label class="muted small">Games ${numSel('tcN', ui.tcN || 100, [25, 50, 100, 250])}</label>
        </div>
        <div class="change-boxes">
          <label class="muted small">Take out<textarea id="tcOut" rows="4" placeholder="2 Shock">${esc(ui.tcOut || '')}</textarea></label>
          <label class="muted small">Put in<textarea id="tcIn" rows="4" placeholder="2 Grizzly Bears">${esc(ui.tcIn || '')}</textarea></label>
        </div>
        <div class="toolbar tight">${run('tc')}</div>
        ${out('tc')}
      </section>
      <section class="panel">
        <h3>How many lands?</h3>
        <p class="muted small">The deck plays alone with 4 and 2 fewer lands, as it is, and with 2 and 4 more (basic lands are added or taken out, so the deck gets a little smaller or bigger).
          You see missed land drops, flooding and the kill turn for each, and which count did best.</p>
        <div class="toolbar tight">
          <label class="muted small">Deck ${deckSel('lcDeck', pick('lcDeck'))}</label>
          <label class="muted small">Games each ${numSel('lcN', ui.lcN || 100, [50, 100, 250])}</label>
          ${run('lc')}
        </div>
        ${out('lc')}
      </section>`;
  }

  const tile = (big, small) => `<div class="stat-tile"><b>${esc(big)}</b><span class="muted small">${esc(small)}</span></div>`;
  const turnText = t => (t == null ? '–' : `Turn ${Number.isInteger(t) ? t : t.toFixed(1)}`);

  function autoOut(kind) {
    if (autoRun && autoRun.kind === kind) return `<p class="muted">Playing game ${Math.min(autoRun.done + 1, autoRun.total)} of ${autoRun.total}… <button class="link-btn" data-act="auto-stop">Stop</button></p>`;
    const r = autoLast[kind];
    if (!r) return '';
    const errs = r.errors ? `<p class="muted small">${r.errors} game${r.errors === 1 ? '' : 's'} stopped with an error and ${r.errors === 1 ? "isn't" : "aren't"} counted.</p>` : '';
    const html = { gf: goldfishHtml, mu: matchupHtml, gt: gauntletHtml, br: bracketHtml, tc: changeHtml, lc: landsHtml }[kind](r);
    return html + errs;
  }

  // Kill turns as bars: games won on each turn, and how many never did.
  function killChart(s) {
    const items = s.kill.hist.map((n, i) => ({ x: `T${i + 1}`, value: n, text: n ? String(n) : '', tip: `Won on turn ${i + 1}: ${n} of ${s.games} games (${pct(n / s.games)})` }));
    if (s.kill.never) items.push({ x: 'Later', value: s.kill.never, text: String(s.kill.never), tip: `Not won by the last turn: ${s.kill.never} games`, hot: true });
    return barChart(items, { label: 'Kill turns' });
  }

  function goldfishHtml(r) {
    const s = r.sum;
    const last = s.per[s.per.length - 1];
    const t4 = s.per[Math.min(3, s.per.length - 1)];
    return `<p class="small"><b>${esc(r.deck)}</b>, ${s.games} games ${r.onDraw ? 'on the draw' : 'on the play'}:</p>
      <div class="stat-tiles">
        ${tile(turnText(s.kill.median), `usual kill turn (won in ${pct(s.kill.rate)} by turn ${last.turn})`)}
        ${s.commander ? tile(turnText(s.commander.avg), `commander out on average (${pct(s.commander.cast)} of games)`) : ''}
        ${tile(t4.lands.toFixed(1), 'lands on turn 4')}
        ${tile(s.missedBy4.toFixed(1), 'land drops missed by turn 4')}
        ${tile(pct(s.stall), 'stalled (under 3 lands on turn 4)')}
        ${tile(pct(s.flood), 'flooded (2+ lands stuck in hand on turn 6)')}
      </div>
      <h4>Kill turns</h4>
      ${killChart(s)}
      <h4>Damage dealt by each turn (average)</h4>
      ${barChart(s.per.map(p => ({ x: `T${p.turn}`, value: p.damage, text: String(Math.round(p.damage)), tip: `Turn ${p.turn}: ${p.damage.toFixed(1)} damage so far, already won in ${pct(p.won)}` })), { label: 'Damage by turn' })}
      <details><summary>Turn by turn</summary>
        <table class="list compact"><thead><tr><th>Turn</th><th class="num">Lands</th><th class="num">Land drop made</th><th class="num">Creatures</th><th class="num">Damage so far</th><th class="num">Already won</th></tr></thead>
          <tbody>${s.per.map(p => `<tr><td>${p.turn}</td><td class="num">${p.lands.toFixed(1)}</td><td class="num">${pct(p.landDrop)}</td><td class="num">${p.creatures.toFixed(1)}</td><td class="num">${p.damage.toFixed(1)}</td><td class="num">${pct(p.won)}</td></tr>`).join('')}</tbody></table>
      </details>
      ${openingHtml(s)}
      ${impactHtml(r.impact, 'alone')}`;
  }

  // The mulligan guide: games grouped by lands in the opening hand.
  function openingHtml(s) {
    if (!s.byOpen.length) return '';
    return `<details open><summary>Opening hands</summary>
      <p class="muted small">Games grouped by how many lands were in the hand it kept${s.mulligan ? ` (it mulliganed ${pct(s.mulligan)} of the time; Opp keeps 2 to 5 lands)` : ''}. A hand that stalls or floods often is one to mulligan.</p>
      <table class="list compact"><thead><tr><th>Lands in hand</th><th class="num">Games</th><th class="num">Usual kill turn</th><th class="num">Won by the last turn</th><th class="num">Stalled</th><th class="num">Flooded</th></tr></thead>
        <tbody>${s.byOpen.map(b => `<tr><td>${esc(b.lands)}</td><td class="num">${b.games} (${pct(b.share)})</td><td class="num">${turnText(b.killMedian)}</td><td class="num">${pct(b.killRate)}</td><td class="num ${b.stall >= 0.4 ? 'bad' : ''}">${pct(b.stall)}</td><td class="num ${b.flood >= 0.4 ? 'bad' : ''}">${pct(b.flood)}</td></tr>`).join('')}</tbody></table>
    </details>`;
  }

  // Card impact: what casting each card did for the deck (alone: kill turn; matchup: wins).
  function impactHtml(rows, mode) {
    if (!rows || !rows.length) return '';
    const fmt = v => (v == null ? '–' : mode === 'alone' ? `T${v.toFixed(1)}` : pct(v));
    const lift = v => (v == null ? '–' : mode === 'alone' ? `${v >= 0 ? '' : '+'}${(-v).toFixed(1)} turns` : `${v >= 0 ? '+' : ''}${Math.round(v * 100)} pts`);
    const enough = rows.filter(r => r.castGames >= 3 && r.lift != null);
    const best = enough.slice(0, 3).filter(r => r.lift > 0);
    const worst = enough.slice(-3).reverse().filter(r => r.lift < 0);
    const dead = rows.filter(r => r.stuck != null && r.stuck >= 0.5 && r.drawnRate >= 0.2).slice(0, 5);
    return `<details><summary>Card impact</summary>
      <p class="muted small">For each nonland card: how often it was drawn and cast, and how the deck did ${mode === 'alone' ? '(usual kill turn; lower is faster)' : '(how often it won)'} in games where it was cast compared with games where it wasn't.
        Cards drawn early get cast more in fast games, so treat small differences as noise, especially with few games.</p>
      ${best.length ? `<p class="small">Pulling their weight: ${best.map(r => `<b>${esc(r.name)}</b> (${lift(r.lift)})`).join(', ')}.</p>` : ''}
      ${worst.length ? `<p class="small">Could be cut: ${worst.map(r => `<b>${esc(r.name)}</b> (${lift(r.lift)})`).join(', ')}.</p>` : ''}
      ${dead.length ? `<p class="small">Often stuck in hand: ${dead.map(r => `<b>${esc(r.name)}</b> (${pct(r.stuck)} of the times it was drawn)`).join(', ')}.</p>` : ''}
      <table class="list compact"><thead><tr><th>Card</th><th class="num">Drawn</th><th class="num">Cast</th><th class="num">Cast on turn</th><th class="num">With it cast</th><th class="num">Without</th><th class="num">Difference</th><th class="num">Stuck in hand</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.name)}${r.qty > 1 ? ` <span class="muted">×${r.qty}</span>` : ''}${r.commander ? ' <span class="muted">(commander)</span>' : ''}</td>
          <td class="num">${pct(r.drawnRate)}</td><td class="num">${pct(r.castRate)}</td><td class="num">${r.avgTurn == null ? '–' : r.avgTurn.toFixed(1)}</td>
          <td class="num">${fmt(r.withIt)}</td><td class="num">${fmt(r.without)}</td>
          <td class="num ${r.lift == null ? '' : r.lift > 0 ? 'ok' : r.lift < 0 ? 'bad' : ''}">${lift(r.lift)}</td>
          <td class="num">${r.stuck == null ? '–' : pct(r.stuck)}</td></tr>`).join('')}</tbody></table>
    </details>`;
  }

  const WHY = { life: 'life to 0', poison: '10 poison', 'commander damage': '21 commander damage', 'empty library': 'drew from an empty library', 'turn limit': 'no winner by turn 25', 'both at once': 'both lost at once' };
  function matchupHtml(r) {
    const t = r.tally;
    const n = t.games || 1;
    const side = (x, who) => (x.games ? `${pct(x.a / x.games)} for ${esc(r.a)} (${x.a} of ${x.games})` : '–');
    return `<p class="small"><b>${esc(r.a)}</b> against <b>${esc(r.b)}</b>, ${t.games} games:</p>
      <div class="stat-tiles">
        ${tile(pct(t.a / n), `${r.a} won (${t.a})`)}
        ${tile(pct(t.b / n), `${r.b} won (${t.b})`)}
        ${t.draws ? tile(String(t.draws), 'no winner') : ''}
        ${tile(t.avgTurns.toFixed(1), 'turns per game (each)')}
        ${tile(pct(t.firstWins / Math.max(1, t.a + t.b)), 'won by whoever went first')}
      </div>
      <h4>Who went first</h4>
      ${barChart([
        { x: `${r.a} first`, value: t.aFirst.games ? t.aFirst.a / t.aFirst.games : 0, text: t.aFirst.games ? pct(t.aFirst.a / t.aFirst.games) : '–', tip: `${r.a} went first: ${side(t.aFirst)}` },
        { x: `${r.b} first`, value: t.bFirst.games ? t.bFirst.a / t.bFirst.games : 0, text: t.bFirst.games ? pct(t.bFirst.a / t.bFirst.games) : '–', tip: `${r.b} went first: ${side(t.bFirst)}` },
      ], { max: 1, label: `${r.a} win rate by who went first`, axis: `How often ${r.a} won` })}
      <p class="muted small">How games ended: ${Object.entries(t.why).map(([k, v]) => `${esc(WHY[k] || k)} ${v}`).join(', ')}.</p>
      ${impactHtml(r.impact, 'match')}`;
  }

  // Gauntlet: a win-rate table (row deck's wins against the column deck) and a ranking.
  function gauntletHtml(r) {
    const names = r.decks;
    const cell = (i, j) => r.pairs[`${i}|${j}`];
    const rank = names.map((name, i) => {
      let w = 0;
      let g = 0;
      names.forEach((_, j) => { const c = cell(i, j); if (c) { w += c.w; g += c.g; } });
      return { name, i, rate: g ? w / g : null, g };
    }).filter(x => x.g).sort((a, b) => b.rate - a.rate);
    const cols = r.focus == null ? names.map((_, j) => j) : names.map((_, j) => j).filter(j => j !== r.focus);
    const rows = r.focus == null ? rank.map(x => x.i) : [r.focus];
    const shade = v => (v == null ? '' : v >= 0.6 ? 'ok' : v <= 0.4 ? 'bad' : '');
    return `<p class="small">${r.focus == null ? 'Every deck against every deck' : `<b>${esc(names[r.focus])}</b> against your other decks`}, ${r.per} games per pairing:</p>
      <div class="table-scroll"><table class="list compact gauntlet"><thead><tr><th>Wins of ↓ against →</th>${cols.map(j => `<th class="num">${esc(names[j])}</th>`).join('')}<th class="num">Overall</th></tr></thead>
        <tbody>${rows.map(i => {
          const overall = rank.find(x => x.i === i);
          return `<tr><td><b>${esc(names[i])}</b></td>${cols.map(j => {
            if (i === j) return '<td class="num muted">–</td>';
            const c = cell(i, j);
            const v = c && c.g ? c.w / c.g : null;
            return `<td class="num ${shade(v)}" title="${c ? `${c.w} wins in ${c.g} games` : ''}">${v == null ? '–' : pct(v)}</td>`;
          }).join('')}<td class="num"><b>${overall && overall.rate != null ? pct(overall.rate) : '–'}</b></td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="muted small">Each cell is how often the row's deck beat the column's. A pair can add up to less than 100% when some games had no winner by turn 25.</p>
      ${r.focus == null ? `<h4>Ranking</h4><ol>${rank.map(x => `<li><b>${esc(x.name)}</b> ${pct(x.rate)} of ${x.g} games won${r.brackets && r.brackets[x.i] ? ` <span class="muted">(Bracket ${r.brackets[x.i]})</span>` : ''}</li>`).join('')}</ol>`
        : (() => {
          const worst = cols.map(j => ({ j, c: cell(r.focus, j) })).filter(x => x.c && x.c.g).sort((a, b) => a.c.w / a.c.g - b.c.w / b.c.g)[0];
          return worst ? `<p class="small">Hardest matchup: <b>${esc(names[worst.j])}</b> (${pct(worst.c.w / worst.c.g)} won).</p>` : '';
        })()}`;
  }

  // Bracket estimate: one row per deck, then what put each deck where it is.
  function bracketHtml(r) {
    const cmd = r.decks.filter(d => d.est.commander);
    const other = r.decks.filter(d => !d.est.commander);
    const names = items => items.map(x => `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}`).join(', ');
    const num = items => {
      const n = items.reduce((s, x) => s + (x.qty || 1), 0);
      return `<td class="num" title="${esc(names(items.map(x => x.cards ? { name: x.cards.join(' + '), qty: 1 } : x)))}">${n || '–'}</td>`;
    };
    const label = e => `Bracket ${e.bracket}${e.bracket === 2 ? ' or 1' : e.bracket === 4 ? ' or 5' : ''}`;
    const list = (title, items) => (items.length ? `<li>${title}: ${esc(names(items))}</li>` : '');
    if (!cmd.length) return '<p class="muted small">None of your decks look like Commander decks (a commander, or 100 cards), and brackets are only for Commander.</p>';
    return `<div class="table-scroll"><table class="list compact"><thead><tr><th>Deck</th><th>Estimate</th><th class="num">Game Changers</th><th class="num">Tutors</th><th class="num">Extra turns</th><th class="num">Land denial</th><th class="num">Two-card combos</th></tr></thead>
        <tbody>${cmd.map(({ name, est: e }) => `<tr><td><b>${esc(name)}</b></td><td><b>${label(e)}</b> <span class="muted">${esc(e.name)}</span></td>
          ${num(e.gameChangers)}${num(e.tutors)}${num(e.extraTurns)}${num(e.landDenial)}${num(e.combos)}</tr>`).join('')}</tbody></table></div>
      <p class="muted small">Bracket 1 is a Bracket 2 deck built around a theme more than winning, and Bracket 5 is a Bracket 4 deck tuned for tournaments; the list can't tell those apart.
        Hover a number to see the cards.</p>
      ${cmd.map(({ name, est: e }) => `<details><summary><b>${esc(name)}</b>: ${label(e)}</summary><ul class="small">
        ${e.reasons.length ? e.reasons.map(x => `<li>${esc(x.why)}: at least Bracket ${x.bracket}.</li>`).join('') : '<li>Nothing in the list goes past Bracket 2.</li>'}
        ${list('Game Changers', e.gameChangers)}
        ${list('Tutors', e.tutors)}
        ${list('Extra turns', e.extraTurns)}
        ${list('Mass land denial', e.landDenial)}
        ${e.combos.length ? `<li>Two-card combos: ${e.combos.map(c => `${esc(c.cards.join(' + '))} (${c.mv} mana${c.early ? ', can go off early' : ''})`).join('; ')}</li>` : ''}
        ${e.unchecked ? `<li class="muted">${e.unchecked} card${e.unchecked === 1 ? '' : 's'} couldn't be checked against the Game Changers list.</li>` : ''}
      </ul></details>`).join('')}
      ${other.length ? `<p class="muted small">Not Commander decks, so no bracket: ${other.map(d => esc(d.name)).join(', ')}.</p>` : ''}`;
  }

  // Try a change: the two versions side by side.
  function changeHtml(r) {
    const row = (label, f) => `<tr><td>${label}</td><td class="num">${f(r.before)}</td><td class="num">${f(r.after)}</td></tr>`;
    const t4 = s => s.per[Math.min(3, s.per.length - 1)];
    const better = (a, b, lowIsGood) => (a == null || b == null || a === b ? '' : (lowIsGood ? b < a : b > a) ? 'ok' : 'bad');
    const killA = r.before.sum.kill.median;
    const killB = r.after.sum.kill.median;
    return `<p class="small">${r.changes.map(esc).join('; ')}${r.missing.length ? ` <span class="bad">(not in the deck: ${r.missing.map(esc).join(', ')})</span>` : ''}</p>
      <table class="list compact"><thead><tr><th></th><th class="num">As it is</th><th class="num">Changed</th></tr></thead><tbody>
        ${row('Usual kill turn (alone)', x => turnText(x.sum.kill.median))}
        ${row('Won alone by the last turn', x => pct(x.sum.kill.rate))}
        ${r.before.sum.commander ? row('Commander out on average', x => (x.sum.commander ? turnText(x.sum.commander.avg) : '–')) : ''}
        ${row('Lands on turn 4', x => t4(x.sum).lands.toFixed(1))}
        ${row('Land drops missed by turn 4', x => x.sum.missedBy4.toFixed(1))}
        ${row('Stalled', x => pct(x.sum.stall))}
        ${row('Flooded', x => pct(x.sum.flood))}
        ${r.opp ? row(`Won against ${esc(r.opp)}`, x => (x.match ? pct(x.match.a / Math.max(1, x.match.games)) : '–')) : ''}
      </tbody></table>
      <p class="small ${better(killA, killB, true)}">${killA === killB ? 'About the same speed alone.' : killB < killA ? 'The change makes the deck faster alone.' : 'The change makes the deck slower alone.'}${r.opp && r.before.match && r.after.match
        ? ` Against ${esc(r.opp)} it wins ${pct(r.after.match.a / Math.max(1, r.after.match.games))} instead of ${pct(r.before.match.a / Math.max(1, r.before.match.games))}.` : ''}</p>`;
  }

  // How many lands: each count side by side, and the one that did best.
  function landsHtml(r) {
    const best = r.variants.reduce((a, b) => (score(b) < score(a) ? b : a));
    // Average kill turn (games not won count as one turn past the end), nudged by missed drops and floods.
    function score(v) {
      const s = v.sum;
      const kill = (s.kill.avg == null ? r.turns + 1 : s.kill.avg * s.kill.rate + (r.turns + 1) * (1 - s.kill.rate));
      return kill + s.missedBy4 * 0.3 + s.flood * 0.5;
    }
    return `<p class="small"><b>${esc(r.deck)}</b>, ${r.per} games for each land count:</p>
      <table class="list compact"><thead><tr><th>Lands</th><th class="num">Usual kill turn</th><th class="num">Average kill turn</th><th class="num">Won by turn ${r.turns}</th><th class="num">Land drops missed by turn 4</th><th class="num">Stalled</th><th class="num">Flooded</th></tr></thead>
        <tbody>${r.variants.map(v => `<tr class="${v === best ? 'best' : ''}"><td>${v.lands}${v.delta ? ` <span class="muted">(${v.delta > 0 ? '+' : ''}${v.delta})</span>` : ' <span class="muted">(as it is)</span>'}</td>
          <td class="num">${turnText(v.sum.kill.median)}</td><td class="num">${v.sum.kill.avg == null ? '–' : v.sum.kill.avg.toFixed(2)}</td><td class="num">${pct(v.sum.kill.rate)}</td><td class="num">${v.sum.missedBy4.toFixed(1)}</td>
          <td class="num">${pct(v.sum.stall)}</td><td class="num">${pct(v.sum.flood)}</td></tr>`).join('')}</tbody></table>
      <p class="small"><b>${best.delta ? `About ${best.lands} lands looks best` : `${best.lands} lands, as it is, looks right`}</b>: the fastest usual kill with the fewest missed land drops and floods.
        Differences of a turn or less can be chance; run more games to be sure.</p>`;
  }

  // Plays the games one after another, a few at a time so the page stays responsive. jobs: functions
  // that each play one game and return its result. finish(results) gets the ones that didn't fail.
  function runJobs(kind, jobs, finish) {
    const run = autoRun = { kind, done: 0, total: jobs.length, errors: 0, stop: false, list: [] };
    renderTest();
    const step = () => {
      if (autoRun !== run) return;
      const t0 = performance.now();
      while (!run.stop && run.done < run.total && performance.now() - t0 < 60) {
        try { run.list.push(jobs[run.done]()); } catch (e) { run.errors++; console.error(e); }
        run.done++;
      }
      if (!run.stop && run.done < run.total) {
        const el = $(`#out-${kind}`);
        if (el && ui.tab === 'test') el.innerHTML = autoOut(kind);
        setTimeout(step, 0);
        return;
      }
      autoRun = null;
      if (run.list.length) {
        autoLast[kind] = finish(run.list);
        autoLast[kind].errors = run.errors;
      }
      if (ui.tab === 'test') renderTest();
      status(run.stop ? `Stopped after ${run.list.length} game${run.list.length === 1 ? '' : 's'}.` : `Played ${run.list.length} game${run.list.length === 1 ? '' : 's'}.`, 'ok');
    };
    setTimeout(step, 0);
  }

  // Card info for these decks (from Scryfall when it isn't saved yet), as autoplay.js wants it.
  async function defsFor(decks) {
    await ensureDefs(decks.flatMap(d => d.rows.map(r => r.id)), true);
    const defs = {};
    decks.forEach(d => d.rows.forEach(r => { if (def(r.id)) defs[r.id] = def(r.id); }));
    return defs;
  }

  // Like defsFor, and also asks Scryfall again for cards saved before they had the Game Changer mark.
  async function bracketDefs(decks) {
    const defs = await defsFor(decks);
    const stale = [...new Set(decks.flatMap(d => d.rows.map(r => r.id)))].filter(id => def(id) && typeof def(id).gameChanger !== 'boolean');
    if (stale.length) {
      status(`Checking ${stale.length} cards against the Game Changers list…`);
      const { found } = await Scryfall.collection(stale.map(id => ({ id })));
      found.forEach(c => { local.cards[c.id] = c; defs[c.id] = c; });
      await saveLocal();
      hideStatus();
    }
    return defs;
  }
  const bracketOf = deck => Brackets.estimate(deck.rows, def);

  // "2 Shock" lines to cards: [{ id, name, qty }] (Scryfall finds the ones the Simulator doesn't know).
  async function cardsFromLines(text) {
    const { entries } = parseList(text);
    if (!entries.length) return { cards: [], unknown: [] };
    const known = Object.values(local.cards).concat(tracker ? Object.values(tracker.cards) : []);
    const byName = name => known.find(c => c && c.names && c.names.includes(name.toLowerCase().split(' // ')[0]));
    const need = entries.filter(e => !byName(e.name));
    if (need.length) {
      const res = await Scryfall.collection(need.map(e => ({ name: e.name.split(' // ')[0] })));
      res.found.forEach(c => { local.cards[c.id] = c; });
      if (res.found.length) saveLocal();
    }
    const cards = [];
    const unknown = [];
    for (const e of entries) {
      const c = byName(e.name) || Object.values(local.cards).find(x => x.names && x.names.includes(e.name.toLowerCase().split(' // ')[0]));
      if (c) cards.push({ id: c.id, name: c.name, qty: e.qty });
      else unknown.push(e.name);
    }
    return { cards, unknown };
  }

  // Card impact for one deck from its games: [{ cards, won, kill }].
  const impactOf = (deck, games, mode, maxTurns) => Autoplay.cardImpact(games, deck, isLandId, mode, maxTurns);

  async function runAuto(kind) {
    if (autoRun) return;
    const val = id => $('#' + id).value;
    const fail = e => { autoRun = null; if (ui.tab === 'test') renderTest(); status(`Could not get the card info from Scryfall (${e.message}).`, 'error'); };
    try {
      if (kind === 'gf') {
        Object.assign(ui, { gfDeck: val('gfDeck'), gfN: Number(val('gfN')), gfT: Number(val('gfT')), gfDraw: $('#gfDraw').checked });
        saveSoon();
        const deck = findDeck(ui.gfDeck);
        if (!deck) return status('That deck is no longer available.', 'error');
        const defs = await defsFor([deck]);
        const { gfT: turns, gfDraw: onDraw } = ui;
        runJobs('gf', Array.from({ length: ui.gfN }, () => () => Autoplay.goldfish(deck, defs, { maxTurns: turns, onDraw })), list => ({
          deck: deck.name, onDraw, sum: Autoplay.summarize(list, turns),
          impact: impactOf(deck, list.map(g => ({ cards: g.cards, kill: g.killTurn })), 'alone', turns),
        }));
      } else if (kind === 'mu') {
        Object.assign(ui, { muA: val('muA'), muB: val('muB'), muN: Number(val('muN')) });
        saveSoon();
        const a = findDeck(ui.muA);
        const b = findDeck(ui.muB);
        if (!a || !b) return status('That deck is no longer available.', 'error');
        const defs = await defsFor([a, b]);
        runJobs('mu', Array.from({ length: ui.muN }, (_, i) => () => Autoplay.match(a, b, defs, { aFirst: i % 2 === 0 })), list => ({
          a: a.name, b: b.name, tally: Autoplay.tally(list),
          impact: impactOf(a, list.map(m => ({ cards: m.cardsA, won: m.winner === 'A' })), 'match'),
        }));
      } else if (kind === 'gt') {
        Object.assign(ui, { gtDeck: val('gtDeck'), gtN: Number(val('gtN')) });
        saveSoon();
        const decks = allDecks();
        const focus = ui.gtDeck === '*' ? null : decks.findIndex(d => d.key === ui.gtDeck);
        if (decks.length < 2) return status('Add at least two decks for a gauntlet.', 'warn');
        const pairs = [];
        if (focus == null) decks.forEach((_, i) => decks.forEach((__, j) => { if (j > i) pairs.push([i, j]); }));
        else decks.forEach((_, j) => { if (j !== focus) pairs.push([focus, j]); });
        const defs = await bracketDefs(decks.filter((_, i) => pairs.some(p => p.includes(i))));
        const jobs = pairs.flatMap(([i, j]) => Array.from({ length: ui.gtN }, (_, k) => () => ({ i, j, r: Autoplay.match(decks[i], decks[j], defs, { aFirst: k % 2 === 0 }) })));
        runJobs('gt', jobs, list => {
          const cells = {};
          const add = (x, y, won) => { const c = cells[`${x}|${y}`] = cells[`${x}|${y}`] || { w: 0, g: 0 }; c.g++; if (won) c.w++; };
          list.forEach(({ i, j, r }) => { add(i, j, r.winner === 'A'); add(j, i, r.winner === 'B'); });
          const brackets = decks.map(d => { const e = bracketOf(d); return e.commander ? e.bracket : null; });
          return { decks: decks.map(d => d.name), pairs: cells, focus, per: ui.gtN, brackets };
        });
      } else if (kind === 'br') {
        const decks = allDecks();
        await bracketDefs(decks);
        autoLast.br = { decks: decks.map(d => ({ name: d.name, est: bracketOf(d) })) };
        if (ui.tab === 'test') renderTest();
      } else if (kind === 'tc') {
        Object.assign(ui, { tcDeck: val('tcDeck'), tcOpp: val('tcOpp'), tcN: Number(val('tcN')), tcOut: val('tcOut'), tcIn: val('tcIn') });
        saveSoon();
        const deck = findDeck(ui.tcDeck);
        const opp = ui.tcOpp ? findDeck(ui.tcOpp) : null;
        if (!deck) return status('That deck is no longer available.', 'error');
        if (!ui.tcOut.trim() && !ui.tcIn.trim()) return status('Write the cards to take out or put in first.', 'warn');
        status('Looking up the cards…');
        const out = await cardsFromLines(ui.tcOut);
        const add = await cardsFromLines(ui.tcIn);
        if (add.unknown.length) return status(`Couldn't find these cards: ${add.unknown.join(', ')}.`, 'warn');
        const changed = Autoplay.withChanges(deck, out.cards.concat(out.unknown.map(name => ({ name, qty: 1 }))), add.cards);
        const defs = await defsFor([deck, changed.deck, ...(opp ? [opp] : [])]);
        const n = ui.tcN;
        const turns = 10;
        const jobs = [];
        for (const [side, d] of [['before', deck], ['after', changed.deck]]) {
          for (let k = 0; k < n; k++) jobs.push(() => ({ side, kind: 'alone', r: Autoplay.goldfish(d, defs, { maxTurns: turns }) }));
          if (opp) for (let k = 0; k < Math.max(10, Math.round(n / 2)); k++) jobs.push(() => ({ side, kind: 'match', r: Autoplay.match(d, opp, defs, { aFirst: k % 2 === 0 }) }));
        }
        const changes = [...out.cards.map(c => `−${c.qty} ${c.name}`), ...add.cards.map(c => `+${c.qty} ${c.name}`)];
        runJobs('tc', jobs, list => {
          const part = (side, kind) => list.filter(x => x.side === side && x.kind === kind).map(x => x.r);
          const sideOf = side => ({ sum: Autoplay.summarize(part(side, 'alone'), turns), match: opp ? Autoplay.tally(part(side, 'match')) : null });
          return { changes, missing: changed.missing, opp: opp ? opp.name : null, before: sideOf('before'), after: sideOf('after') };
        });
      } else if (kind === 'lc') {
        Object.assign(ui, { lcDeck: val('lcDeck'), lcN: Number(val('lcN')) });
        saveSoon();
        const deck = findDeck(ui.lcDeck);
        if (!deck) return status('That deck is no longer available.', 'error');
        const defs = await defsFor([deck]);
        const variants = [-4, -2, 0, 2, 4].map(delta => ({ delta, deck: delta ? Autoplay.withLands(deck, delta, isLandId, isBasicId) : deck })).filter(v => v.deck);
        if (variants.length < 2) return status('This deck has no lands to add or take out.', 'warn');
        const landCount = d => d.rows.filter(r => isLandId(r.id)).reduce((s, r) => s + (r.qty || 1), 0);
        const turns = 10;
        const jobs = variants.flatMap((v, vi) => Array.from({ length: ui.lcN }, () => () => ({ vi, r: Autoplay.goldfish(v.deck, defs, { maxTurns: turns }) })));
        runJobs('lc', jobs, list => ({
          deck: deck.name, per: ui.lcN, turns,
          variants: variants.map((v, vi) => ({ delta: v.delta, lands: landCount(v.deck), sum: Autoplay.summarize(list.filter(x => x.vi === vi).map(x => x.r), turns) })),
        }));
      }
    } catch (e) {
      fail(e);
    }
  }

  // ---------- Odds tab ----------

  function barChart(items, opts = {}) {
    const max = opts.max || Math.max(...items.map(i => i.value), 0.0001);
    return `<div class="bars" role="img" aria-label="${esc(opts.label || '')}">
      ${items.map(i => `<div class="bar-col" data-tip="${esc(i.tip)}">
        <span class="bar-val">${esc(i.text)}</span>
        <div class="bar-track"><div class="bar-fill ${i.hot ? 'hot' : ''}" style="height:${Math.max(0, (i.value / max) * 100)}%"></div></div>
        <span class="bar-x">${esc(i.x)}</span>
      </div>`).join('')}
    </div>${opts.axis ? `<div class="axis-label muted small">${esc(opts.axis)}</div>` : ''}`;
  }

  const oddsFetched = new Set(); // card ids the Odds tab already asked Scryfall for

  function renderOdds() {
    const decks = allDecks();
    if (!decks.length) {
      view.innerHTML = '<div class="empty-play"><h3>No decks yet</h3><p class="muted">Link MTG Tracker or paste a deck on the Decks tab.</p></div>';
      return;
    }
    if (!findDeck(ui.oddsDeck)) ui.oddsDeck = (game && findDeck(game.deckKey) ? game.deckKey : decks[0].key);
    const deck = findDeck(ui.oddsDeck);
    // The color charts need each card's mana info; fetch it once for cards that lack it.
    const missing = deck.rows.filter(r => !oddsFetched.has(r.id) && (!def(r.id) || !Array.isArray(def(r.id).producedMana))).map(r => r.id);
    if (missing.length) {
      missing.forEach(id => oddsFetched.add(id));
      view.innerHTML = '<div class="empty">Getting card info…</div>';
      ensureDefs(missing, true).then(() => ui.tab === 'odds' && renderOdds()).catch(e => status(e.message, 'error'));
      return;
    }
    const lib = deck.rows.filter(r => !r.commander);
    const N = lib.reduce((n, r) => n + r.qty, 0);
    const typeOf = r => (def(r.id) || {}).typeLine || '';
    const isLandRow = r => /\bland\b/i.test(typeOf(r).split('//')[0]);
    const L = lib.filter(isLandRow).reduce((n, r) => n + r.qty, 0);
    const mdfc = lib.filter(r => !isLandRow(r) && /\bland\b/i.test(typeOf(r))).reduce((n, r) => n + r.qty, 0);
    const nonland = lib.filter(r => !isLandRow(r));
    const avgCmc = nonland.length ? nonland.reduce((n, r) => n + ((def(r.id) || {}).cmc || 0) * r.qty, 0) / nonland.reduce((n, r) => n + r.qty, 0) : 0;
    const onDraw = ui.oddsOnDraw;

    const dist = Odds.handDistribution(N, L, 7);
    const keep = dist.slice(2, 5).reduce((a, b) => a + b, 0);
    const drops = Odds.landDrops(N, L, 8, onDraw);

    const curve = new Array(8).fill(0);
    nonland.forEach(r => { curve[Math.min(7, Math.floor((def(r.id) || {}).cmc || 0))] += r.qty; });

    const cats = [...new Set(lib.flatMap(r => r.categories || []))].filter(c => !/^cards for this deck$/i.test(c)).sort();
    if (ui.oddsCategory && !cats.includes(ui.oddsCategory)) ui.oddsCategory = '';
    const pickedSet = new Set(ui.oddsPicked);
    const groupRows = lib.filter(r => (ui.oddsCategory && (r.categories || []).includes(ui.oddsCategory)) || pickedSet.has(r.id));
    const K = groupRows.reduce((n, r) => n + r.qty, 0);
    const anyBy = Odds.anyBy(N, K, 10, onDraw);

    // Card types. A card with two types (Artifact Creature) counts under both.
    const TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land'];
    const typeCounts = TYPES.map(t => ({ t, n: lib.filter(r => typeOf(r).split('//')[0].split(/[^A-Za-z]+/).includes(t)).reduce((n, r) => n + r.qty, 0) })).filter(x => x.n);

    // Colored mana symbols in costs (hybrid counts for both colors) vs. lands that make each color.
    const COLORS = ['W', 'U', 'B', 'R', 'G'];
    const pips = Object.fromEntries(COLORS.map(c => [c, 0]));
    nonland.forEach(r => {
      for (const sym of ((def(r.id) || {}).manaCost || '').match(/\{[^}]+\}/g) || []) {
        COLORS.forEach(c => { if (sym.includes(c)) pips[c] += r.qty; });
      }
    });
    const sources = Object.fromEntries(COLORS.map(c => [c, 0]));
    lib.filter(isLandRow).forEach(r => {
      const made = (def(r.id) || {}).producedMana || [];
      COLORS.forEach(c => { if (made.includes(c)) sources[c] += r.qty; });
    });
    const deckColors = COLORS.filter(c => pips[c] || sources[c]);

    // Casting on curve: lands for turn t plus a spell that costs exactly t, by turn t.
    const curvePlays = [1, 2, 3, 4, 5, 6, 7].map(t => ({ t, k: curve[t], p: curve[t] ? Odds.onCurve(N, L, curve[t], t, onDraw) : 0 }));

    // Lands seen by your turn 4: too few is screw, too many is flood.
    const t4 = Odds.seenBy(4, onDraw);
    const byT4 = [];
    for (let k = 0; k <= 8; k++) byT4.push(k < 8 ? Odds.exactly(N, L, t4, k) : Odds.atLeast(N, L, t4, 8));

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Draw odds</h1><div class="muted small">Exact math for a shuffled deck. Mulligans aren't included.</div></div>
        <div class="toolbar tight">
          <select data-act="odds-deck">${decks.map(d => `<option value="${esc(d.key)}" ${d.key === deck.key ? 'selected' : ''}>${esc(d.name)}${d.source === 'tracker' ? '' : ' (Simulator)'}</option>`).join('')}</select>
          <div class="seg"><button data-act="odds-play" class="${onDraw ? '' : 'active'}">On the play</button><button data-act="odds-draw" class="${onDraw ? 'active' : ''}">On the draw</button></div>
          <button class="btn sm" data-act="play" data-key="${esc(deck.key)}">Play this deck</button>
        </div>
      </div>
      <div class="tiles">
        <div class="tile"><b>${N}</b><span>cards in library${deck.rows.some(r => r.commander) ? ' (commander not counted)' : ''}</span></div>
        <div class="tile"><b>${L}</b><span>lands (${N ? Math.round((L / N) * 100) : 0}%)${mdfc ? ` + ${mdfc} modal double-faced` : ''}</span></div>
        <div class="tile"><b>${avgCmc.toFixed(2)}</b><span>average mana value (non-land)</span></div>
        <div class="tile"><b>${pct(keep)}</b><span>chance of 2–4 lands in your opening 7</span></div>
      </div>
      <div class="two-col">
        <section class="panel">
          <h3>Lands in your opening hand</h3>
          ${barChart(dist.map((p, k) => ({ x: String(k), value: p, text: pct(p), hot: k >= 2 && k <= 4, tip: `${k} land${k === 1 ? '' : 's'}: ${(p * 100).toFixed(1)}%` })), { label: 'Chance of each land count in opening hand', axis: 'Lands in hand' })}
        </section>
        <section class="panel">
          <h3>Hitting every land drop</h3>
          ${barChart(drops.map(d => ({ x: 'T' + d.turn, value: d.p, max: 1, text: pct(d.p), tip: `Turn ${d.turn}: ${(d.p * 100).toFixed(1)}% to have ${d.turn}+ lands (${d.seen} cards seen, ${d.expected.toFixed(1)} lands expected)` })), { max: 1, label: 'Chance to have hit every land drop by each turn', axis: 'Your turn' })}
        </section>
        <section class="panel">
          <h3>Mana curve <span class="muted small">(non-land cards)</span></h3>
          ${barChart(curve.map((n, i) => ({ x: i === 7 ? '7+' : String(i), value: n, text: n ? String(n) : '', tip: `Mana value ${i === 7 ? '7 or more' : i}: ${n} card${n === 1 ? '' : 's'}` })), { label: 'Cards by mana value', axis: 'Mana value' })}
        </section>
        <section class="panel">
          <h3>Chance to draw a type of card</h3>
          <div class="toolbar">
            <select data-act="odds-cat"><option value="">${cats.length ? 'Pick a category…' : 'No categories in this deck'}</option>${cats.map(c => `<option ${c === ui.oddsCategory ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
            <button class="btn sm ghost" data-act="odds-pick">Pick cards…</button>
            ${K ? `<span class="muted small"><b>${K}</b> card${K === 1 ? '' : 's'} chosen</span>` : ''}
          </div>
          ${K ? barChart(anyBy.map(d => ({ x: 'T' + d.turn, value: d.p, text: pct(d.p), tip: `By turn ${d.turn}: ${(d.p * 100).toFixed(1)}% to have drawn at least one` })), { max: 1, label: 'Chance to have drawn at least one chosen card', axis: 'Your turn' })
            : '<p class="muted small">Choose a category from your Tracker deck (like Ramp or Removal) or pick cards to see the chance of drawing at least one by each turn.</p>'}
        </section>
        <section class="panel">
          <h3>Lands by your turn 4 <span class="muted small">(${t4} cards seen)</span></h3>
          ${barChart(byT4.map((p, k) => ({ x: k === 8 ? '8+' : String(k), value: p, text: pct(p), hot: k >= 3 && k <= 5, tip: `${k === 8 ? '8 or more' : k} land${k === 1 ? '' : 's'} by turn 4: ${(p * 100).toFixed(1)}%${k < 3 ? ' (short on lands)' : k > 5 ? ' (flooding)' : ''}` })), { label: 'Chance of each land count by turn 4', axis: 'Lands seen' })}
          <p class="muted small">Short on lands (0–2): <b>${pct(byT4.slice(0, 3).reduce((a, b) => a + b, 0))}</b> · Flooding (6+): <b>${pct(byT4.slice(6).reduce((a, b) => a + b, 0))}</b></p>
        </section>
        <section class="panel">
          <h3>Casting on curve</h3>
          ${barChart(curvePlays.map(d => ({ x: d.t === 7 ? 'T7+' : 'T' + d.t, value: d.p, text: d.k ? pct(d.p) : '–', tip: d.k ? `Turn ${d.t}: ${(d.p * 100).toFixed(1)}% to have ${d.t}+ land${d.t === 1 ? '' : 's'} and one of your ${d.k} ${d.t === 7 ? '7+' : d.t}-drop${d.k === 1 ? '' : 's'} in hand` : `No ${d.t === 7 ? '7+' : d.t}-drops in this deck` })), { max: 1, label: 'Chance to have a spell to cast on curve each turn', axis: 'A land for each turn plus a spell that costs exactly that much' })}
        </section>
        <section class="panel">
          <h3>Card types</h3>
          ${barChart(typeCounts.map(x => ({ x: x.t, value: x.n, text: String(x.n), tip: `${x.t}: ${x.n} card${x.n === 1 ? '' : 's'} (${N ? Math.round((x.n / N) * 100) : 0}% of the library)` })), { label: 'Cards by type', axis: 'Cards with two types count under both' })}
        </section>
        <section class="panel">
          <h3>Colored mana symbols <span class="muted small">(in non-land costs)</span></h3>
          ${deckColors.length ? barChart(deckColors.map(c => ({ x: MANA_NAMES[c][0].toUpperCase() + MANA_NAMES[c].slice(1), value: pips[c], text: String(pips[c]), tip: `${MANA_NAMES[c]}: ${pips[c]} symbol${pips[c] === 1 ? '' : 's'} across the deck's costs` })), { label: 'Colored mana symbols by color', axis: 'How much each color is asked for' }) : '<p class="muted small">No colored costs in this deck.</p>'}
        </section>
        <section class="panel">
          <h3>Lands that make each color</h3>
          ${deckColors.length ? barChart(deckColors.map(c => ({ x: MANA_NAMES[c][0].toUpperCase() + MANA_NAMES[c].slice(1), value: sources[c], text: String(sources[c]), tip: `${MANA_NAMES[c]}: ${sources[c]} land${sources[c] === 1 ? '' : 's'} (${pct(Odds.atLeast(N, sources[c], Odds.seenBy(3, onDraw), 1))} to have one by turn 3)` })), { label: 'Lands that make each color', axis: 'Compare with the mana symbols chart' }) : '<p class="muted small">No colored lands in this deck.</p>'}
          ${deckColors.filter(c => pips[c] && !sources[c]).length ? `<p class="muted small">No lands make ${deckColors.filter(c => pips[c] && !sources[c]).map(c => MANA_NAMES[c]).join(' or ')}.</p>` : ''}
        </section>
      </div>
      <section class="panel">
        <div class="page-head"><h3>Sample hand</h3><div class="toolbar tight">
          <button class="btn sm" data-act="sample">Draw a new 7</button>
          ${sample && sample.deckKey === deck.key ? '<button class="btn sm ghost" data-act="sample-more">Draw next card</button>' : ''}
        </div></div>
        <div class="sample">${sample && sample.deckKey === deck.key ? sample.order.slice(0, sample.shown).map(id => {
          const c = def(id) || {};
          return c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" title="${esc(c.name)}">` : `<div class="text-face"><b>${esc(c.name)}</b></div>`;
        }).join('') : '<p class="muted small">See what a random opening hand looks like.</p>'}</div>
      </section>`;
  }

  function openPicker() {
    const deck = findDeck(ui.oddsDeck);
    if (!deck) return;
    const rows = deck.rows.filter(r => !r.commander).slice().sort((a, b) => a.name.localeCompare(b.name));
    const picked = new Set(ui.oddsPicked);
    openModal(`
      <div class="page-head"><h3>Pick cards</h3><button class="btn sm" data-act="close-modal">Done</button></div>
      <input type="search" id="pickFilter" placeholder="Filter" style="width:100%;margin-bottom:.6rem">
      <div class="toolbar"><button class="btn sm ghost" data-act="pick-none">Clear</button></div>
      <div class="pick-list">${rows.map(r => `<label class="check" data-name="${esc(r.name.toLowerCase())} ${esc(((def(r.id) || {}).typeLine || '').toLowerCase())}"><input type="checkbox" data-pick="${esc(r.id)}" ${picked.has(r.id) ? 'checked' : ''}> ${esc(r.name)}${r.qty > 1 ? ` <span class="muted">×${r.qty}</span>` : ''} <span class="muted small">${esc((def(r.id) || {}).typeLine || '')}</span></label>`).join('')}</div>`);
  }

  // ---------- Help tab ----------

  function renderHelp() {
    view.innerHTML = `
      <section class="panel prose">
        <h3>Getting your decks</h3>
        <p><b>From MTG Tracker:</b> open MTG Tracker in the same browser you use for the Simulator (Chrome or Edge). Your Tracker decks appear on the <b>Decks</b> tab. Click <b>Refresh</b> after you change a deck in the Tracker. The Simulator only reads Tracker data; it never changes your collection.</p>
        <p>If they don't appear (for example in Firefox, or on another computer), in the Tracker go to <b>Account &amp; backup → Download backup</b> and use <b>Load backup file…</b> here.</p>
        <p><b>Any other deck:</b> paste a list on the Decks tab. You don't need to own the cards.</p>
        <h3>Playing</h3>
        <ul>
          <li><b>Click</b> a card in your hand to play it. Lands go to the bottom of the table, everything else to the top.</li>
          <li><b>Click</b> a card on the table to tap or untap it.</li>
          <li><b>Drag</b> any card anywhere: around the table, back to your hand, onto the graveyard, exile or library (top; hold <b>Shift</b> for the bottom).</li>
          <li><b>Right-click</b> a card for everything else: counters, flip, face down, token copies, move to a zone. Right-click the library for scry, search and mill.</li>
          <li>Click the library to draw. Click the graveyard or exile to look through them.</li>
          <li>Counters show on the card. Click a counter to add one, right-click to remove one. For any other kind of counter, right-click the card → <b>Add any counter…</b> (or hover it and press <b>C</b>) and type a name: suggestions show as you type (arrow keys and Enter, or click one). Real counter names you type are saved, so next time they're one click (your 3 latest are right in the right-click menu).</li>
          <li><b>Copies:</b> right-click a card → <b>Make a copy</b>, or <b>Make copies…</b> for several (optionally with its counters). Works on tokens, and on cards in your hand, graveyard or exile (they stay put; a token copy goes on the battlefield).</li>
          <li><b>✕ End game</b> clears the table and takes you back to your decks.</li>
          <li><b>Mana:</b> tapping a land adds its mana to the pool (a land that makes several colors asks which). Untapping it takes the mana back out. <b>Free mana</b> shows what your untapped lands can still make. Mana rocks like Sol Ring and Arcane Signet work the same way. Creatures like Llanowar Elves just tap when clicked (for attacking); right-click → <b>Tap for … mana</b>. For anything else, click a symbol to add, right-click to remove. The pool empties on Next turn.</li>
          <li><b>Auto-tap lands</b> (top bar): playing a spell taps what it needs: floating mana first, then lands (saving dual lands when it can), mana rocks, mana creatures (not ones that arrived this turn) and last Treasures, which get sacrificed. Commander tax is included. So are discounts from your permanents, like "Goblin spells you cast cost {1} less" or "creature spells of the chosen type cost {2} less" (only the generic part gets cheaper). If you can't pay, nothing is tapped.</li>
          <li><b>Choose a creature type</b>: when a card like Urza's Incubator or Herald's Horn enters, pick the type from your deck's list or type one in. It shows on the card; right-click to change it.</li>
          <li><b>Upkeep:</b> at the start of your turn, cards with "At the beginning of your upkeep" glow and are listed by your stats until you click <b>Done</b>. Turn this off with <b>Upkeep reminders</b> in the top bar.</li>
          <li><b>Commander damage:</b> tracked under your stats. Online, it's damage to you from each friend's commander; playing alone, it's what your commander dealt to Opp. + also takes the life off. 21 from one commander and you're warned.</li>
          <li><b>Draw triggers:</b> a card that says "When this enters, draw a card" (or two) draws automatically. "You may draw" and "if…" draws you do yourself.</li>
          <li><b>Discarding</b>: when a card like Earsplitting Rats enters (yours or Opp's), you're asked which card to discard and Opp throws away its worst. Abilities that cost "Discard a card" ask which one too.</li>
          <li><b>End step</b>: when you end your turn, cards like Ashcoat of the Shadow Swarm ask whether to mill and which cards to get back.</li>
          <li><b>New cards</b> in your hand get a yellow outline for 5 seconds. On the draw, your first-turn card is drawn on top of your opening 7 (and again after a mulligan).</li>
          <li><b>Hand size:</b> you can't end your turn with more than 7 cards unless you control something like Reliquary Tower. You're asked which cards to discard.</li>
          <li>Lands that always enter tapped (like Scoured Barrens) come in tapped. "Enters tapped unless…" lands come in untapped, so tap them yourself if needed.</li>
          <li><b>Life:</b> when a card enters with "you gain / you lose / each opponent loses N life", it happens automatically. Amounts like "X life" or "for each…" you do yourself. Undo reverses anything wrong.</li>
          <li><b>Mulligan</b> shuffles your hand back and draws 7. Then right-click cards → <b>Bottom of library</b> for each mulligan.</li>
          <li>Your commander starts in the command zone. Click it to cast; the tax is tracked for you.</li>
          <li>Your game is saved, so you can close the page and pick up where you left off.</li>
          <li><b>↺ Reset</b> starts the deck over: everything shuffled back, a new hand, life back to the start. <b>More ▾</b> lets you restart on the play or on the draw.</li>
        </ul>
        <h3>Playing against the computer</h3>
        <ul>
          <li>On the Decks tab, under <b>Play against the computer</b>, pick your deck, Opp's deck and who goes first, then click <b>Play</b>. Opp's table shows across the top.</li>
          <li>Opp plays a land each turn and casts the biggest creatures, artifacts and enchantments it can afford. It also uses simple removal ("destroy target creature"), burn ("deals 3 damage to any target") and card draw. Other card text, like abilities and auras, is ignored.</li>
          <li><b>Attack…</b> (or <kbd>A</kbd>): tick the creatures that attack and pick what each one goes after: Opp or one of Opp's planeswalkers. Opp picks its blocks and the damage is done for you. Opp can go after your planeswalkers too: the block screen shows what each attacker is aimed at. Flying, reach, first strike, double strike, deathtouch, trample, lifelink, menace, fear, intimidate, skulk, shadow, landwalk, vigilance and indestructible count, including keywords a lord gives ("Goblins you control have haste"). "Whenever this attacks or blocks, … get +X/+X" pumps happen too, until the end of the turn.</li>
          <li><b>Regenerate</b>: activate an ability like "Discard a card: Regenerate" before combat (right-click → Activate). The card shows REGEN until the turn ends, and the next time it would be destroyed it's tapped instead. Opp regenerates its own creatures when they'd die, if it can pay.</li>
          <li><b>End turn ▸</b> (or <kbd>N</kbd>): Opp takes its turn. When it attacks, you pick your blockers. Then your turn starts: you untap and draw.</li>
          <li>Use − and + on Opp's life for anything the game doesn't do itself. Undo takes back Opp's turn one step at a time.</li>
          <li><b>Responses</b> (top bar): Opp holds instant removal for when you attack or your end step, and counters your spells that cost 3 or more. When Opp casts something and you have an instant you can pay for, its spell waits: <b>Answer it</b> to cast yours (a counterspell counters it), or <b>Let it resolve</b>.</li>
          <li><b>Targets:</b> your cards that destroy, exile, bounce, burn, tap, pump or put counters on a target ask you to pick it. Opp picks its own.</li>
          <li><b>Your record:</b> when a game ends, closing the message saves a win or loss for your deck (or use <b>More ▾ → Record a win / loss</b>). It shows on the Decks tab and on the deck's page in MTG Tracker.</li>
        </ul>
        <h3>Auto-test</h3>
        <p>The computer plays a deck by itself many times (how fast it gets going), or two decks against each other (who wins how often). It plays like Opp, so treat it as a rough guide.</p>
        <h3>Playing online</h3>
        <ul>
          <li>Play against up to 3 friends. Everyone needs the MTG Tracker folder and internet.</li>
          <li><b>To host:</b> on the Decks tab, type your name and click <b>Host a game</b>. Send the game code to your friends.</li>
          <li><b>To join:</b> type the code and click <b>Join</b>.</li>
          <li>Everyone then picks their own deck and clicks <b>Play</b>. Your friends' tables show across the top. Hover their cards to read them, and click their <b>Graveyard</b> or <b>Exile</b> to look through it. Nobody can see your hand or library.</li>
          <li>Use − and + next to a friend's life to deal damage or give them life. "Each opponent loses N life" cards do this for you. Undo sends it back.</li>
          <li><b>Next turn</b> tells everyone it's your turn. <b>Pass turn ▸</b> hands the turn to the next player.</li>
          <li><b>Attack…</b> (or <kbd>A</kbd>): tick your attackers and pick who each one goes after: any player or one of their planeswalkers. Each player you attack sees what's aimed at them and picks blockers, then the damage is done on both tables (life, loyalty, and creatures that die). A creature can only attack once a turn.</li>
          <li>Type in the box under the log to chat.</li>
          <li>If the host leaves, the game connection ends for everyone, but everyone's table is kept. Host again and rejoin to carry on.</li>
        </ul>
        <h3>Keyboard</h3>
        <table class="keys">
          <tr><td><kbd>N</kbd></td><td>Next turn (untap and draw)</td></tr>
          <tr><td><kbd>A</kbd></td><td>Attack Opp (playing against the computer)</td></tr>
          <tr><td><kbd>D</kbd></td><td>Draw a card</td></tr>
          <tr><td><kbd>U</kbd></td><td>Untap everything</td></tr>
          <tr><td><kbd>S</kbd></td><td>Shuffle library</td></tr>
          <tr><td><kbd>T</kbd></td><td>Tap/untap the card under the mouse</td></tr>
          <tr><td><kbd>F</kbd></td><td>Flip the card under the mouse</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>Undo</td></tr>
        </table>
      </section>`;
  }

  // ---------- events ----------

  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  document.addEventListener('click', async e => {
    if (!menu.hidden && !e.target.closest('#menu')) hideMenu();
    if (e.target === modal) return closeModal();
    const go = e.target.closest('[data-tab-go]');
    if (go) return setTab(go.dataset.tabGo);

    const tq = e.target.closest('[data-token-q]');
    if (tq) { $('#tokenQuery').value = tq.dataset.tokenQ; return searchTokens(tq.dataset.tokenQ); }
    const ti = e.target.closest('[data-token-i]');
    if (ti) return makeTokens(tokenResults[Number(ti.dataset.tokenI)]);

    const dc = e.target.closest('[data-discard]');
    if (dc && game) return discardDown(dc.dataset.discard);

    const vc = e.target.closest('[data-viewer]');
    if (vc) {
      const iid = vc.dataset.viewer;
      const inst = game.cards[iid];
      if (!inst) return;
      // Ebondeath from your graveyard; Reno and Rude's or Ugin's cards from exile.
      const cast = [];
      if (inst.zone === 'graveyard' && Bot.graveCast(game, inst, def)) cast.push({ label: 'Cast from graveyard', action: () => { closeModal(); tryPlay(iid, { cast: true }); } });
      // Aftermath (Dusk // Dawn): the back half from your graveyard; it's exiled after.
      // Flashback (Revenge of the Rats): cast from your graveyard for its flashback cost, then exiled.
      const fb = inst.zone === 'graveyard' && Bot.flashbackOf(inst, def);
      if (fb) cast.push({ label: `Cast with flashback (${fb})`, action: () => { closeModal(); tryPlay(iid, { cast: true, flashback: true, cost: fb }); } });
      const after = inst.zone === 'graveyard' && Bot.aftermathOf(inst, def);
      if (after) cast.push({ label: `Cast ${after.name} (aftermath, ${after.cost})`, action: () => { closeModal(); tryPlay(iid, { cast: true, aftermath: true, cost: after.cost }); } });
      if (inst.zone === 'exile' && inst.playable) cast.push({ label: inst.playable.free ? 'Cast without paying its mana cost' : `Play it${inst.playable.anyMana ? ' (any mana)' : ''}`, action: () => { closeModal(); tryPlay(iid); } });
      return showMenu(e.clientX, e.clientY, [...cast, ...(cast.length ? [{ sep: true }] : []), ...moveItems(iid, inst.zone).filter(i => !(viewer && viewer.top && i.label === 'Top of library'))]);
    }

    const cb = e.target.closest('[data-iid] .counter');
    if (cb && game) {
      const iid = cb.closest('[data-iid]').dataset.iid;
      return act(() => Game.counter(game, iid, cb.dataset.counter, 1));
    }
    const pip = e.target.closest('[data-mana]');
    if (pip && game) return act(() => { game.mana[pip.dataset.mana]++; });

    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (b.tagName === 'SELECT' || b.tagName === 'INPUT' && b.type !== 'button') return;
    switch (a) {
      case 'play': return startGame(b.dataset.key, true); // turn 1's card is already drawn
      case 'precons-load': b.disabled = true; return loadPrecons().finally(() => { b.disabled = false; });
      case 'precon-add': b.disabled = true; return addPrecon(b.dataset.file).finally(() => { b.disabled = false; });
      case 'odds': ui.oddsDeck = b.dataset.key; saveSoon(); return setTab('odds');
      case 'resume': return setTab('play');
      case 'resume-game': return resumeGame(b.dataset.id);
      case 'delete-game': return deleteGame(b.dataset.id);
      case 'reconnect': return reconnectGame();
      case 'refresh': await connectTracker(); return renderDecks();
      case 'delete-deck': {
        const d = local.decks.find(x => x.key === b.dataset.key);
        if (d && confirm(`Delete "${d.name}" from the Simulator?`)) {
          local.decks = local.decks.filter(x => x !== d);
          await saveLocal();
          renderDecks();
        }
        return;
      }
      case 'host': return startOnline('host');
      case 'start-match': return startMatch();
      case 'back-to-game': inLobby = false; return renderPlay();
      case 'open-lobby': inLobby = true; return setTab('play');
      case 'join': return startOnline('join');
      case 'rejoin': return startOnline('rejoin');
      case 'leave':
        if (Online.state() === 'connected' && !confirm(Online.role() === 'host' ? 'Leave the online game? You are the host, so this ends it for everyone.' : 'Leave the online game?')) return;
        Online.leave();
        chat = [];
        return;
      case 'copy-code': return copyCode();
      case 'online-play': {
        const key = onlineDeckKey();
        if (!key) return;
        if (game && linkedOnline(gameMeta()) && !confirm(`Start over with ${findDeck(key).name}? Your current table in this online game will be lost.`)) return;
        return startGame(key, false);
      }
      case 'pass': return passTurn();
      case 'attack': return openAttack();
      case 'attack-go': return attackGo();
      case 'attack-all': // tick (or untick) every creature that can attack
        modalBox.querySelectorAll('[data-attacker]:not(:disabled)').forEach(x => { x.checked = !!b.dataset.on; });
        return;
      case 'crew': return openCrew(b.dataset.iid, b.dataset.back);
      case 'crew-go': return crewGo(b.dataset.iid, b.dataset.back);
      case 'blocks-done': return blocksDone();
      case 'taps-done': return tapsDone();
      case 'respond-open': return openRespond();
      case 'auto-run': return runAuto(b.dataset.kind);
      case 'auto-stop': if (autoRun) autoRun.stop = true; return;
      case 'blocks-online': return blocksOnlineDone();
      case 'bot-play': return playBot();
      case 'hit': {
        const d = Number(b.dataset.d);
        if (b.dataset.pid === BOT) return act(() => { game.oppLife += d; });
        return act(() => { (game.oppHits = game.oppHits || []).push({ to: b.dataset.pid, d }); });
      }
      case 'opp-zone': return openOppZone(b.dataset.pid, b.dataset.z);
      case 'next-turn': return nextTurn();
      case 'draw': return act(() => Game.drawCards(game, 1));
      case 'untap': return act(() => Game.untapAll(game));
      case 'mulligan': return act(() => Game.mulligan(game));
      case 'undo': return undo();
      case 'clear-mana': return act(() => { Game.MANA.forEach(k => { game.mana[k] = 0; }); });
      case 'reset': return confirmRestart(game.onDraw);
      case 'end-game': return endGame();
      case 'token': return openTokens();
      case 'scry': return libraryAction('top');
      case 'shuffle': return act(() => Game.shuffle(game));
      case 'd20': return roll(20);
      case 'tools': { const r = b.getBoundingClientRect(); return toolsMenu(r.left, r.bottom + 4); }
      case 'life': return act(() => { game.life += Number(b.dataset.d); });
      case 'opp': return act(() => { game.oppLife += Number(b.dataset.d); });
      case 'poison': return act(() => { game.poison = Math.max(0, game.poison + Number(b.dataset.d)); });
      case 'cmd-dmg': return commanderDamage('cmdDamage', b.dataset.key, Number(b.dataset.d));
      case 'cmd-dealt': return commanderDamage('cmdDealt', b.dataset.key, Number(b.dataset.d));
      case 'upkeep-done': return act(() => { game.upkeep = null; });
      case 'close-modal': return closeModal();
      case 'vmove': {
        const lib = game.zones.library;
        const shown = lib.filter(iid => viewer.ids.includes(iid));
        const k = shown.indexOf(b.dataset.iid) + Number(b.dataset.d);
        if (k < 0 || k >= shown.length) return;
        const i = lib.indexOf(b.dataset.iid);
        const j = lib.indexOf(shown[k]);
        return act(() => { [lib[i], lib[j]] = [lib[j], lib[i]]; });
      }
      case 'vbottom':
        viewer.ids = viewer.ids.filter(iid => iid !== b.dataset.iid);
        viewer.bottomed = (viewer.bottomed || 0) + 1;
        return act(() => Game.move(game, b.dataset.iid, 'library', { bottom: true }));
      case 'deck-tokens': {
        const deck = findDeck(game ? game.deckKey : ui.oddsDeck);
        return deck ? showRelatedTokens(deck.rows.map(r => r.id)) : null;
      }
      case 'odds-play': ui.oddsOnDraw = false; saveSoon(); return renderOdds();
      case 'odds-draw': ui.oddsOnDraw = true; saveSoon(); return renderOdds();
      case 'odds-pick': return openPicker();
      case 'pick-none': ui.oddsPicked = []; modalBox.querySelectorAll('[data-pick]').forEach(x => { x.checked = false; }); return renderOdds();
      case 'sample': {
        const deck = findDeck(ui.oddsDeck);
        const order = Game.shuffleArray(deck.rows.filter(r => !r.commander).flatMap(r => new Array(r.qty).fill(r.id)));
        sample = { deckKey: deck.key, order, shown: 7 };
        return renderOdds();
      }
      case 'sample-more': if (sample) sample.shown = Math.min(sample.order.length, sample.shown + 1); return renderOdds();
    }
  });

  document.addEventListener('change', async e => {
    const t = e.target;
    const a = t.dataset.act;
    if (a === 'backup' && t.files[0]) {
      try {
        tracker = TrackerLink.fromBackup(await t.files[0].text());
        status('Loaded the Tracker backup.', 'ok');
      } catch (err) {
        status(err.message, 'error');
      }
      renderLinkState();
      renderDecks();
    } else if (a === 'size') { ui.cardW = Number(t.value); saveSoon(); renderBoard(); }
    else if (a === 'online-deck') {
      ui.onlineDeck = t.value;
      saveSoon();
      sendPick();
      if ($('#onlinePanel')) $('#onlinePanel').innerHTML = onlinePanelHtml();
      else if (ui.tab === 'play' && inLobby) renderLobby();
    }
    else if (a === 'online-name') { ui.playerName = t.value.trim() || 'Player'; saveSoon(); Online.setName(ui.playerName); }
    else if (a === 'odds-deck') { ui.oddsDeck = t.value; ui.oddsCategory = ''; ui.oddsPicked = []; saveSoon(); renderOdds(); }
    else if (a === 'odds-cat') { ui.oddsCategory = t.value; renderOdds(); }
    else if (a === 'shuffle-close') viewer.shuffleOnClose = t.checked;
    else if (t.dataset.pick) {
      const set = new Set(ui.oddsPicked);
      if (t.checked) set.add(t.dataset.pick); else set.delete(t.dataset.pick);
      ui.oddsPicked = [...set];
      renderOdds();
    }
  });

  document.addEventListener('input', e => {
    if (e.target.dataset.act === 'size') { ui.cardW = Number(e.target.value); renderBoard(); }
    if (e.target.dataset.act === 'autotap') { ui.autoTap = e.target.checked; saveSoon(); status(ui.autoTap ? 'Auto-tap is on: playing a spell taps the lands it needs.' : 'Auto-tap is off.'); }
    if (e.target.dataset.act === 'respondhelp') {
      ui.respond = e.target.checked;
      saveSoon();
      status(ui.respond ? 'Opp now waits for your answer when you could respond, and answers on your turn too.' : 'Opp no longer waits for your answers, and casts everything on its own turn.');
    }
    if (e.target.dataset.act === 'upkeephelp') {
      ui.upkeepOff = !e.target.checked;
      saveSoon();
      if (ui.upkeepOff && game && game.upkeep) act(() => { game.upkeep = null; });
      status(ui.upkeepOff ? 'Upkeep reminders are off.' : 'Upkeep reminders are on: upkeep triggers get highlighted at the start of your turn.');
    }
    if (e.target.id === 'viewerFilter' && viewer) { viewer.filter = e.target.value; renderViewer(); }
    if (e.target.id === 'preconFilter') { preconQuery = e.target.value; const l = $('#preconList'); if (l) l.innerHTML = preconRowsHtml(); }
    if (e.target.id === 'pickFilter') {
      const q = e.target.value.toLowerCase();
      modalBox.querySelectorAll('.pick-list label').forEach(l => { l.hidden = q && !l.dataset.name.includes(q); });
    }
  });

  document.addEventListener('submit', async e => {
    if (e.target.id === 'pasteForm') {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button');
      btn.disabled = true;
      try { await importPasted(f.elements.name.value.trim(), f.elements.list.value); } catch (err) { status('Import failed: ' + err.message, 'error'); } finally { btn.disabled = false; }
    } else if (e.target.id === 'chatForm') {
      e.preventDefault();
      const input = e.target.elements.msg;
      const msg = input.value.trim();
      if (!msg) return;
      if (!Online.connected()) return status('No one else is in the game yet.');
      Online.send({ t: 'chat', msg });
      chat.unshift({ at: Date.now(), from: Online.id(), msg });
      input.value = '';
      renderLog();
    } else if (e.target.id === 'customToken') {
      e.preventDefault();
      const f = e.target;
      const el = f.elements;
      makeTokens({ custom: true, id: null, name: el.name.value.trim(), pt: el.pt.value.trim(), text: el.text.value.trim(), typeLine: 'Token' });
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'tokenQuery') { e.preventDefault(); searchTokens(e.target.value); return; }
    if (e.key === 'Enter' && e.target.id === 'joinCode') { e.preventDefault(); startOnline('join'); return; }
    if (e.key === 'Escape') {
      if (press && press.dragging) { press.el.classList.remove('dragging'); ghost.hidden = true; document.body.classList.remove('is-dragging'); press = null; return; }
      hideMenu();
      cancelAttach();
      if (!modal.hidden) closeModal();
      return;
    }
    if (ui.tab !== 'play' || !game || !modal.hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const hovered = hoverIid && game.cards[hoverIid];
    if (k === 'n') nextTurn();
    else if (k === 'a' && (hasBot() || isOnline())) openAttack();
    else if (k === 'd') act(() => Game.drawCards(game, 1));
    else if (k === 'u') act(() => Game.untapAll(game));
    else if (k === 's') act(() => Game.shuffle(game));
    else if (k === 't' && hovered && hovered.zone === 'battlefield') tapCard(hoverIid);
    else if (k === 'c' && hovered && hovered.zone === 'battlefield') counterPrompt(hoverIid);
    else if (k === 'e' && hovered && hovered.zone === 'battlefield' && Game.isAttachment(hovered)) startAttach(hoverIid);
    else if (k === 'f' && hovered && def(hovered.id) && def(hovered.id).backImage) act(() => Game.toggle(game, hoverIid, 'flipped'));
  });

  let lastPointer = 'mouse';
  document.addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, true);

  document.addEventListener('contextmenu', e => {
    if (ui.tab !== 'play' || !game) return;
    if (appMode && lastPointer !== 'mouse' && e.target.closest('.table .card[data-iid], [data-oiid]')) { e.preventDefault(); return; }
    const cb = e.target.closest('[data-iid] .counter');
    if (cb) {
      e.preventDefault();
      const iid = cb.closest('[data-iid]').dataset.iid;
      return act(() => Game.counter(game, iid, cb.dataset.counter, -1));
    }
    const pip = e.target.closest('[data-mana]');
    if (pip) { e.preventDefault(); return act(() => { game.mana[pip.dataset.mana] = Math.max(0, game.mana[pip.dataset.mana] - 1); }); }
    const card = e.target.closest('.table .card[data-iid]');
    if (card) { e.preventDefault(); return cardMenu(card.dataset.iid, e.clientX, e.clientY); }
    const pile = e.target.closest('[data-pile]');
    if (pile) { e.preventDefault(); return pileMenu(pile.dataset.pile, e.clientX, e.clientY); }
    if (e.target.closest('.battlefield')) {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: 'Create token…', action: () => openTokens() },
        { label: 'Untap everything', hint: 'U', action: () => act(() => Game.untapAll(game)) },
        { label: 'Next turn', hint: 'N', action: nextTurn },
      ]);
    }
  });

  view.addEventListener('mouseover', e => {
    const card = e.target.closest('.table .card[data-iid]');
    if (card && card.dataset.iid !== hoverIid) showPreview(card.dataset.iid);
    const theirs = e.target.closest('[data-oiid]');
    if (theirs && theirs.dataset.opid + '|' + theirs.dataset.oiid !== hoverOpp) showOppPreview(theirs.dataset.opid, theirs.dataset.oiid);
  });
  // Hovering a card in the block popup shows it in the preview pane, lifted above the popup's shade.
  modalBox.addEventListener('mouseover', e => {
    const peek = e.target.closest('[data-peek]');
    const inst = peek && blockPreviews[peek.dataset.peek];
    if (inst) previewCard(inst);
    document.body.classList.toggle('peek', !!inst);
  });
  modalBox.addEventListener('mouseleave', () => document.body.classList.remove('peek'));
  // Closing or hiding the app saves the game first. Leaving the online game doesn't end
  // your saved game: reopen it from the Decks tab and click Reconnect.
  window.addEventListener('beforeunload', () => { saveNow(); if (Online.active()) Online.leave(); });
  window.addEventListener('pagehide', saveNow);
  // Back from MTG Tracker (or another app): pick up any decks changed there.
  window.addEventListener('pageshow', e => { if (e.persisted && ui.tab === 'decks') refreshTracker(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.tab === 'decks') refreshTracker(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  // Hover tooltips for chart bars.
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = e.clientY + 16 + 'px';
  });

  view.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', () => {
    if (!press) return;
    clearTimeout(press.holdTimer);
    zoom.hidden = true;
    ghost.hidden = true;
    press.el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    press = null;
  });
  window.addEventListener('resize', () => { if (ui.tab === 'play') { fitTable(); renderBoard(); } });

  // ---------- inside MTG Tracker ----------

  // The Tracker tells its Simulator tab: 'sim:refresh' (you opened the tab: read your decks again) and
  // 'sim:open' { key, mode } (a deck page's buttons: 'play' starts it, 'bot' picks it for playing
  // against the computer, 'odds' shows its odds).
  window.addEventListener('message', async e => {
    if (!embedded || e.source !== window.parent || !e.data || typeof e.data.type !== 'string') return;
    const m = e.data;
    if (m.type === 'sim:refresh') return refreshTracker();
    // MTG Tracker's tab bar: Playtest (decks), Play, Odds, Auto-test, Help.
    if (m.type === 'sim:tab' && ['decks', 'play', 'odds', 'test', 'help'].includes(m.tab)) return setTab(m.tab);
    if (m.type !== 'sim:open' || typeof m.key !== 'string') return;
    await connectTracker(true);
    if (!findDeck(m.key)) return status("That deck isn't here yet. Click Refresh on the Decks tab.", 'warn');
    if (m.mode === 'play') return startGame(m.key, true);
    if (m.mode === 'odds') { ui.oddsDeck = m.key; saveSoon(); return setTab('odds'); }
    ui.botYou = m.key;
    saveSoon();
    setTab('decks');
    const panel = document.querySelector('.bot-panel');
    if (panel) { panel.scrollIntoView({ block: 'start' }); panel.classList.add('flash'); setTimeout(() => panel.classList.remove('flash'), 1500); }
    status('Pick Opp\'s deck and who goes first, then click Play.', 'ok');
  });

  // ---------- start ----------

  (async () => {
    try {
      local.decks = (await Store.get('decks')) || [];
      local.cards = (await Store.get('cards')) || {};
      Object.assign(ui, (await Store.get('ui')) || {});
      games = (await Store.get('games')) || [];
      results = (await Store.get('results')) || [];
      // Saved before there could be more than one game.
      const old = await Store.get('game');
      if (old) {
        const id = newGameId();
        games.unshift({ id, deckName: old.deckName, deckKey: old.deckKey, turn: old.turn, life: old.life, createdAt: Date.now(), updatedAt: Date.now(), online: null });
        await Store.set('game:' + id, old);
        await Store.set('games', games);
        await Store.set('game', null);
        ui.gameId = id;
      }
      gameId = games.some(g => g.id === ui.gameId) ? ui.gameId : null;
      game = gameId ? (await Store.get('game:' + gameId)) || null : null;
      if (!game) gameId = null;
      const m = gameMeta();
      activePid = (m && m.online && m.online.activePid) || null;
    } catch (e) {
      status('Browser storage is unavailable, so nothing will be saved: ' + e.message, 'error');
    }
    // Show the page right away; the Tracker's decks fill in as soon as they're read.
    setTab('decks'); // your saved games are listed there; Continue picks one back up
    if (embedded) window.parent.postMessage({ type: 'sim:ready' }, location.origin === 'null' ? '*' : location.origin);
    if (game) upgradeSavedGame();
    // Offline support (../sw.js). Needs a web address; a double-clicked file skips it.
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('../sw.js').catch(() => {});
  })();
})();
