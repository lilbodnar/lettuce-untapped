/*
 * Playing online with up to 3 friends. Each player runs their own game; after every change
 * the public part of it (battlefield, graveyard, exile, command zone, life, how many cards in
 * hand and library) is sent to everyone else. Hands and libraries stay private.
 *
 * Connections go straight between browsers (WebRTC) using PeerJS. PeerJS's free public server
 * is only used to find each other by game code. The host's browser passes every message on to
 * the other players, so if the host leaves, the game connection ends.
 */
const Online = (() => {
  'use strict';
  const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'mtgsim-';
  const PROTOCOL = 1;
  const MAX_PLAYERS = 4;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CONNECT_TIMEOUT = 20000;

  let peer = null;
  let hostConn = null; // guest: the connection to the host
  const guests = new Map(); // host: pid -> connection
  let role = null; // 'host' | 'guest'
  let code = null;
  let myName = 'Player';
  let players = []; // [{ pid, name }] in seat order, host first
  let state = 'off'; // off | starting | waiting | connecting | connected | lost
  let handlers = {};
  let connectTimer = null;

  const emit = (name, ...args) => handlers[name] && handlers[name](...args);

  function setState(next, msg) {
    state = next;
    emit('status', state, msg || '');
  }

  function randomCode(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += CODE_CHARS[Game.randomInt(CODE_CHARS.length)];
    return s;
  }

  const normalize = c => String(c || '').toUpperCase().replace(/^MTGSIM-/, '').replace(/[^A-Z0-9]/g, '');

  let libPromise;
  function loadLib() {
    if (window.Peer) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PEERJS_URL;
        s.onload = () => resolve();
        s.onerror = () => {
          libPromise = null;
          reject(new Error("Couldn't load the online library. Check your internet connection."));
        };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  // Opens a PeerJS peer with this id. Resolves once the matchmaking server accepts it.
  function openPeer(id) {
    return new Promise((resolve, reject) => {
      const p = new window.Peer(id, { debug: 1 });
      let opened = false;
      p.on('open', () => { opened = true; resolve(p); });
      p.on('error', err => {
        if (!opened) { p.destroy(); reject(err); } else onPeerError(err);
      });
      // Lost the matchmaking server (not the game). Reconnect so new players can still join.
      p.on('disconnected', () => { if (peer === p && !p.destroyed) setTimeout(() => !p.destroyed && p.reconnect(), 1500); });
    });
  }

  function errorText(err) {
    switch (err && err.type) {
      case 'peer-unavailable': return `No game found with code ${code}. Check the code, and that the host still has the game open.`;
      case 'browser-incompatible': return 'This browser can\'t play online. Use Chrome or Edge.';
      case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
        return "Couldn't reach the matchmaking server. Check your internet connection (some work networks block it).";
      default: return 'Connection problem: ' + ((err && err.message) || err);
    }
  }

  function onPeerError(err) {
    if (err.type === 'peer-unavailable' && role === 'guest') {
      clearTimeout(connectTimer);
      teardown();
      setState('off', errorText(err));
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      emit('notice', errorText(err));
    }
  }

  function rosterChanged() {
    if (role === 'host') broadcastRaw({ t: 'roster', players });
    emit('roster', players);
  }

  // ---------- host ----------

  async function host(name, preferredCode) {
    await loadLib();
    teardown();
    myName = name || myName;
    role = 'host';
    setState('starting');
    let lastErr;
    for (let i = 0; i < 5 && !peer; i++) {
      code = i === 0 && preferredCode ? normalize(preferredCode) : randomCode(6);
      try {
        peer = await openPeer(PREFIX + code);
      } catch (err) {
        lastErr = err;
        if (err.type !== 'unavailable-id') break;
      }
    }
    if (!peer) {
      role = null;
      setState('off', errorText(lastErr));
      return;
    }
    players = [{ pid: peer.id, name: myName }];
    peer.on('connection', acceptGuest);
    setState('waiting');
    emit('roster', players);
  }

  function acceptGuest(c) {
    c.on('open', () => {
      if (guests.size >= MAX_PLAYERS - 1) {
        c.send({ t: 'full' });
        setTimeout(() => c.close(), 500);
        return;
      }
      guests.set(c.peer, c);
      players.push({ pid: c.peer, name: (c.metadata && c.metadata.name) || 'Player' });
      if (c.metadata && c.metadata.v !== PROTOCOL) c.send({ t: 'version', v: PROTOCOL });
      setState('connected');
      rosterChanged();
    });
    c.on('data', m => fromGuest(c.peer, m));
    c.on('close', () => dropGuest(c.peer));
    c.on('error', () => dropGuest(c.peer));
  }

  function dropGuest(pid) {
    if (!guests.has(pid)) return;
    guests.delete(pid);
    const who = players.find(p => p.pid === pid);
    players = players.filter(p => p.pid !== pid);
    if (state !== 'off') setState(guests.size ? 'connected' : 'waiting', `${who ? who.name : 'A player'} left the game.`);
    rosterChanged();
  }

  // Host: a message from a guest. Deliver it here and pass it on to the right players.
  function fromGuest(pid, m) {
    if (!m || typeof m !== 'object') return;
    m.from = pid;
    if (m.t === 'name') {
      const p = players.find(x => x.pid === pid);
      if (p) p.name = String(m.name || 'Player').slice(0, 30);
      rosterChanged();
      return;
    }
    if (m.to) {
      if (m.to === peer.id) emit('message', m);
      else if (guests.has(m.to)) guests.get(m.to).send(m);
      return;
    }
    for (const [gid, c] of guests) if (gid !== pid && c.open) c.send(m);
    emit('message', m);
  }

  function broadcastRaw(m) {
    for (const c of guests.values()) if (c.open) c.send(m);
  }

  // ---------- guest ----------

  // preferredId: the player id used last time in this game, so the others still know who you are
  // (whose turn it is). A new one is made if it's still taken.
  async function join(joinCode, name, preferredId) {
    await loadLib();
    teardown();
    myName = name || myName;
    role = 'guest';
    code = normalize(joinCode);
    if (!code) { role = null; setState('off', 'Type the game code your friend sent you.'); return; }
    setState('connecting');
    const ids = [preferredId && preferredId.startsWith(PREFIX) ? preferredId : null, PREFIX + randomCode(10)].filter(Boolean);
    let lastErr;
    for (const id of ids) {
      try {
        peer = await openPeer(id);
        break;
      } catch (err) {
        lastErr = err;
        if (err.type !== 'unavailable-id') break;
      }
    }
    if (!peer) {
      role = null;
      setState('off', errorText(lastErr));
      return;
    }
    const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json', metadata: { name: myName, v: PROTOCOL } });
    hostConn = c;
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (state !== 'connecting') return;
      teardown();
      setState('off', `Couldn't connect to game ${code}. The host may have closed it, or a network firewall is blocking the connection.`);
    }, CONNECT_TIMEOUT);
    c.on('open', () => {
      clearTimeout(connectTimer);
      setState('connected');
    });
    c.on('data', m => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'roster') { players = m.players || []; emit('roster', players); }
      else if (m.t === 'full') { teardown(); setState('off', `Game ${code} is full (${MAX_PLAYERS} players).`); }
      else if (m.t === 'version') emit('notice', 'The host has a different version of the Simulator. Some things may not work. Make sure you both have the latest MTG Tracker folder.');
      else emit('message', m);
    });
    c.on('close', () => {
      if (hostConn !== c) return;
      hostConn = null;
      players = [];
      emit('roster', players);
      setState('lost', 'The connection to the host was lost.');
    });
  }

  // ---------- both ----------

  function teardown() {
    clearTimeout(connectTimer);
    guests.clear();
    hostConn = null;
    players = [];
    if (peer) {
      const p = peer;
      peer = null;
      p.destroy();
    }
  }

  function leave() {
    teardown();
    role = null;
    setState('off');
    emit('roster', players);
  }

  // Sends to every other player, or to one player with to: pid.
  function send(m, to) {
    if (state !== 'connected') return;
    const msg = Object.assign({}, m, to ? { to } : {});
    if (role === 'guest') {
      if (hostConn && hostConn.open) hostConn.send(msg);
      return;
    }
    msg.from = peer.id;
    if (to) {
      const c = guests.get(to);
      if (c && c.open) c.send(msg);
    } else broadcastRaw(msg);
  }

  function setName(name) {
    myName = String(name || 'Player').slice(0, 30);
    if (role === 'host' && players[0]) {
      players[0].name = myName;
      rosterChanged();
    } else if (role === 'guest') send({ t: 'name', name: myName });
  }

  // ---------- what other players see ----------

  function publicCard(inst) {
    const hidden = !!inst.faceDown;
    return {
      iid: inst.iid,
      id: hidden ? null : inst.id,
      name: hidden ? 'Face-down card' : inst.name,
      typeLine: hidden ? '' : inst.typeLine,
      tapped: !!inst.tapped,
      faceDown: hidden,
      flipped: !!inst.flipped,
      counters: inst.counters || {},
      x: inst.x,
      y: inst.y,
      token: !!inst.token,
      custom: hidden ? null : inst.custom || null,
      commander: !!inst.commander,
      castCount: inst.castCount || 0,
      // An aura on another player's creature, with what it does to it (Arrest: can't attack or block).
      enchanting: inst.enchanting ? { pid: inst.enchanting.pid, iid: inst.enchanting.iid, bonus: inst.enchanting.bonus } : null,
    };
  }

  function snapshot(game) {
    const pub = zone => game.zones[zone].map(iid => publicCard(game.cards[iid]));
    return {
      t: 'state',
      now: Date.now(),
      deckName: game.deckName,
      commander: game.commander,
      startedAt: game.startedAt,
      turn: game.turn,
      life: game.life,
      poison: game.poison,
      energy: game.energy || 0,
      monarch: game.monarch || 0, // when this player became the monarch (the newest one is)
      cmdDamage: game.cmdDamage || {},
      hand: game.zones.hand.length,
      lastCast: game.lastCast || null, // so another player's counterspell can find it
      library: game.zones.library.length,
      battlefield: pub('battlefield'),
      graveyard: pub('graveyard'),
      exile: pub('exile'),
      command: pub('command'),
      log: game.log.slice(0, 40),
    };
  }

  // The parts of a Scryfall card another player needs to draw it.
  const slimDef = c => ({
    id: c.id, name: c.name, typeLine: c.typeLine, image: c.image, imageLarge: c.imageLarge,
    backImage: c.backImage, power: c.power, toughness: c.toughness, loyalty: c.loyalty,
  });

  return {
    MAX_PLAYERS,
    host, join, leave, send, setName, snapshot, slimDef,
    on: h => { handlers = h; },
    state: () => state,
    active: () => state !== 'off',
    connected: () => state === 'connected',
    role: () => role,
    code: () => code,
    id: () => (peer ? peer.id : null),
    players: () => players,
  };
})();
