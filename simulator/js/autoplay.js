/*
 * Automatic games, for the Auto-test tab. A deck plays by itself against an empty table, to see how
 * fast it gets going (goldfish), or two decks play each other with Opp's rules on both sides
 * (match). Every game is made fresh from the deck lists: your saved games are never touched.
 *
 * Both sides are Opp-style tables (bot.js). On each turn the active deck is "Opp" and the other is
 * "you", so the same code that plays Opp's turn against you plays every turn here; the defending
 * side blocks with the same rules Opp blocks with.
 */
const Autoplay = (() => {
  'use strict';
  const G = typeof Game !== 'undefined' ? Game : require('./game.js');
  const B = typeof Bot !== 'undefined' ? Bot : require('./bot.js');

  const isCommander = deck => deck.rows.some(r => r.commander);
  const startLife = deck => (isCommander(deck) ? 40 : 20);

  // While an automatic game runs, game.js's hooks and Bot's responder point here, and are put back
  // afterwards, so nothing in the app sees these games. view() is the table seen as "you" right now.
  function isolated(view, defOf, fn) {
    const saved = { ...G.hooks };
    const responder = B.getResponder();
    G.hooks.died = (s, inst, info) => {
      const v = view();
      B.died(s, inst, defOf, null, v, info || {});
      if (v) B.afterDeath(v, s, inst, info || {}, defOf, null);
    };
    G.hooks.wouldDie = (s, inst) => { const v = view(); return v && v.bot ? B.wouldDie(v, s, inst, defOf) : null; };
    G.hooks.moved = (s, inst, from, to) => { const v = view(); if (v && v.bot) B.cardMoved(v, s, inst, from, to, defOf, null); };
    G.hooks.sendHome = (s, inst, to) => { const v = view(); if (v && v.bot) B.sendHome(v, s, inst, to, defOf); };
    G.hooks.oppDamaged = (s, n) => { const v = view(); if (v && v.bot) B.opponentDamaged(v, s, n, defOf); };
    G.hooks.discard = null;
    G.hooks.entered = (s, inst) => {
      if (!inst.faceDown) {
        for (const [kind, n] of Object.entries(G.entersWithCounters((defOf(inst.id) || {}).oracle))) G.counter(s, inst.iid, kind, n, { effect: true });
      }
      B.enterTrigger(s, inst, defOf);
      const v = view();
      if (v && v.bot) B.enterEffects(v, s, inst, defOf, null);
      if (v && v.bot && s === v.bot.s) {
        if (G.isLand(inst) && !inst.faceDown) B.landEntered(v, inst, defOf, null, s);
        B.creatureEntered(v, inst, defOf, null, s);
      }
    };
    G.hooks.tokenEntered = (s, inst) => {
      B.enterTrigger(s, inst, defOf);
      const v = view();
      if (v && v.bot && s === v.bot.s) B.creatureEntered(v, inst, defOf, null, s);
    };
    G.hooks.cast = null;
    G.hooks.casting = null;
    B.setResponder(null);
    try {
      return fn();
    } finally {
      Object.assign(G.hooks, saved);
      B.setResponder(responder);
    }
  }

  // Choices the defending side would be asked for: discards (its worst cards), sacrifices (its cheapest permanents).
  function settle(t) {
    const cmc = c => (c.bot ? c.bot.cmc : 0);
    if (t.mustDiscard) {
      const lands = t.zones.battlefield.filter(iid => G.isLand(t.cards[iid])).length;
      const junk = c => (G.isLand(c) ? (lands >= 6 ? 50 : -50) : cmc(c));
      for (let i = 0; i < t.mustDiscard.n && t.zones.hand.length; i++) {
        const iid = [...t.zones.hand].sort((a, b) => junk(t.cards[b]) - junk(t.cards[a]))[0];
        G.move(t, iid, 'graveyard');
      }
      delete t.mustDiscard;
    }
    if (t.mustSacrifice) {
      const cost = c => (c.token ? -10 : G.isLand(c) ? 50 : cmc(c));
      const picks = t.zones.battlefield.map(iid => t.cards[iid]).sort((a, b) => cost(a) - cost(b)).slice(0, t.mustSacrifice.n);
      picks.forEach(c => G.move(t, c.iid, c.commander ? 'command' : 'graveyard'));
      delete t.mustSacrifice;
    }
    delete t.mustDestroy;
    delete t.mustTarget;
    ['mustModes', 'mustCards', 'mustRecover', 'mustMadness', 'mustShock', 'mustHand', 'mustSacToPlay', 'mustLibrary'].forEach(k => { delete t[k]; });
  }

  // The defending table ("you") blocks Opp's pending attack the way Opp would.
  function autoBlocks(view, defOf) {
    const s = view.bot.s;
    const pending = view.bot.pending;
    const attackers = pending.attackers.map(iid => s.cards[iid]).filter(a => a && a.zone === 'battlefield')
      .map(inst => ({ inst, st: B.botStats(inst), pw: (pending.targets || {})[inst.iid] || null }))
      .sort((a, b) => B.hitOf(b.st) - B.hitOf(a.st));
    const free = B.yourCreatures(view, defOf).filter(c => !c.inst.tapped).map(c => ({ ...c, uses: B.blocksAllowed(view, c.inst, defOf) }));
    const limit = B.blockRules(B.botRules(view, defOf).all, attackers.map(a => a.inst), defOf);
    const out = {};
    for (const [a, picks] of B.pickBlocks(attackers, free, view.life, limit.cap, view)) out[a.inst.iid] = picks.map(p => p.inst.iid);
    return out;
  }

  // One turn of the active player against the defender. Each is { bot: { s, started, pending }, life }.
  function takeTurn(active, defender, defOf) {
    const view = defender.bot.s;
    view.bot = active.bot;
    view.life = defender.life;
    view.oppLife = active.life;
    let res = B.beginTurn(view, defOf);
    if (res.notes.some(n => /empty library/.test(n))) active.decked = true;
    if (res.tapChoice) { // the defender's Sentinel taps the attacker's best creature
      const c = B.tapChoices(view, defOf);
      const taps = {};
      if (c.best) c.tappers.forEach(t => { taps[t.iid] = c.best.iid; });
      res = B.beginCombat(view, defOf, taps, view.bot.tapChoice.notes);
    }
    if (view.bot.pending) B.resolveOppAttack(view, autoBlocks(view, defOf), defOf);
    settle(view);
    B.endTurn(view, defOf);
    settle(view);
    defender.life = view.life;
    active.life = view.oppLife;
    delete view.bot;
  }

  // Why a player has lost, or ''.
  function lost(p) {
    const s = p.bot.s;
    if (p.life <= 0) return 'life';
    if ((s.poison || 0) >= 10) return 'poison';
    if (Object.values(s.cmdDamage || {}).some(n => n >= 21)) return 'commander damage';
    if (p.decked) return 'empty library';
    return '';
  }

  // What a deck did with its cards in one game: { cast: { cardId: first turn cast }, drawn: [cardId, …] }
  // (drawn: every card that left the library, the opening hand included; not tokens).
  function cardsUsed(s) {
    const drawn = new Set();
    for (const c of Object.values(s.cards)) if (!c.token && c.zone !== 'library' && c.zone !== 'command' && c.id) drawn.add(c.id);
    return { cast: { ...(s.casts || {}) }, drawn: [...drawn] };
  }

  const handLands = s => s.zones.hand.filter(iid => G.isLand(s.cards[iid])).length;

  // A deck's Opp-style table for an automatic game, recording what it casts.
  function table(deck, defs, onDraw) {
    const bot = B.create(deck, defs, { onDraw });
    bot.s.trackCasts = true;
    return bot;
  }

  // deckA against deckB, both played with Opp's rules. defs: { scryfallId: card } for both.
  // opts: { aFirst, maxTurns (each, default 25) }. Returns { winner: 'A' | 'B' | null, turns, why,
  // first, cardsA, cardsB, openA, openB } (open: lands in the opening hand).
  function match(deckA, deckB, defs, opts = {}) {
    const defOf = id => defs[id];
    const aFirst = opts.aFirst == null ? G.randomInt(2) === 0 : !!opts.aFirst;
    const maxTurns = opts.maxTurns || 25;
    let current = null;
    return isolated(() => current, defOf, () => {
      const A = { key: 'A', bot: table(deckA, defs, !aFirst), life: startLife(deckA) };
      const Bp = { key: 'B', bot: table(deckB, defs, aFirst), life: startLife(deckB) };
      const open = { A: handLands(A.bot.s), B: handLands(Bp.bot.s) };
      const order = aFirst ? [A, Bp] : [Bp, A];
      const done = (winner, turns, why) => ({
        winner, turns, why, first: aFirst ? 'A' : 'B',
        cardsA: cardsUsed(A.bot.s), cardsB: cardsUsed(Bp.bot.s), openA: open.A, openB: open.B,
      });
      for (let t = 0; t < maxTurns * 2; t++) {
        const active = order[t % 2];
        const defender = order[(t + 1) % 2];
        current = defender.bot.s;
        takeTurn(active, defender, defOf);
        current = null;
        const turns = Math.floor(t / 2) + 1;
        const outD = lost(defender);
        const outA = lost(active);
        if (outD && outA) return done(null, turns, 'both at once');
        if (outD) return done(active.key, turns, outD);
        if (outA) return done(defender.key, turns, outA);
      }
      return done(null, maxTurns, 'turn limit');
    });
  }

  // The deck plays alone against an empty table that never blocks or takes a turn.
  // opts: { maxTurns (default 10), onDraw }. Returns { turns: [{ lands, landDrop, creatures, hand,
  // landsInHand, damage, poison }] (one per turn), commanderTurn, killTurn (null when it didn't
  // happen), openLands (lands in the opening hand), mulligans, cards (see cardsUsed) }.
  function goldfish(deck, defs, opts = {}) {
    const defOf = id => defs[id];
    const maxTurns = opts.maxTurns || 10;
    const target = startLife(deck);
    let current = null;
    return isolated(() => current, defOf, () => {
      const dummy = G.create({ key: 'goldfish', name: 'Goldfish', rows: [] }, {}, {});
      const P = { bot: table(deck, defs, !!opts.onDraw), life: startLife(deck) };
      const D = { bot: { s: dummy }, life: 100000 };
      const s = P.bot.s;
      const out = { turns: [], commanderTurn: null, killTurn: null, openLands: handLands(s), mulligans: s.mulligans || 0 };
      for (let t = 1; t <= maxTurns; t++) {
        current = dummy;
        takeTurn(P, D, defOf);
        current = null;
        const cards = s.zones.battlefield.map(iid => s.cards[iid]);
        const damage = 100000 - D.life;
        const poison = dummy.poison || 0;
        out.turns.push({
          lands: cards.filter(G.isLand).length,
          landDrop: !!s.landPlayed,
          creatures: cards.filter(c => G.isCreature(c)).length,
          hand: s.zones.hand.length,
          landsInHand: handLands(s),
          damage,
          poison,
        });
        if (out.commanderTurn == null && Object.values(s.cards).some(c => c.commander && (c.castCount || 0) > 0)) out.commanderTurn = t;
        if (out.killTurn == null && (damage >= target || poison >= 10)) out.killTurn = t;
        if (P.decked) break;
      }
      out.cards = cardsUsed(s);
      return out;
    });
  }

  const median = list => {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const mean = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

  // "Stalled": fewer than 3 lands out on turn 4 (or the last turn played, if fewer).
  const stalled = g => { const t = g.turns[Math.min(3, g.turns.length - 1)]; return !!t && t.lands < 3; };
  // "Flooded": 2 or more lands stuck in hand on turn 6 (or the last turn played).
  const flooded = g => { const t = g.turns[Math.min(5, g.turns.length - 1)]; return !!t && t.landsInHand >= 2; };

  // Over goldfish games: per turn (lands, how often the land drop was made, creatures, damage so
  // far, % of games already won), the commander's turn, the kill turn (median, rate, and a
  // histogram: hist[t - 1] games won on turn t, plus never), how often it stalled or flooded,
  // missed land drops by turn 4, and the same split by lands in the opening hand (byOpen).
  function summarize(games, maxTurns) {
    const n = games.length || 1;
    const per = [];
    for (let t = 0; t < maxTurns; t++) {
      const at = games.map(g => g.turns[t] || g.turns[g.turns.length - 1]).filter(Boolean);
      const avg = f => at.reduce((sum, x) => sum + f(x), 0) / (at.length || 1);
      per.push({
        turn: t + 1,
        lands: avg(x => x.lands),
        landDrop: games.filter(g => g.turns[t] && g.turns[t].landDrop).length / n,
        creatures: avg(x => x.creatures),
        damage: avg(x => x.damage),
        won: games.filter(g => g.killTurn != null && g.killTurn <= t + 1).length / n,
      });
    }
    const cmd = games.map(g => g.commanderTurn).filter(x => x != null);
    const kills = games.map(g => g.killTurn).filter(x => x != null);
    const hist = new Array(maxTurns).fill(0);
    kills.forEach(k => { if (k >= 1 && k <= maxTurns) hist[k - 1]++; });
    const missedBy4 = mean(games.map(g => g.turns.slice(0, 4).filter(t => !t.landDrop).length)) || 0;
    // Opening hands: 0–1 lands, 2, 3, 4, 5 or more.
    const bucket = k => (k <= 1 ? '0–1' : k >= 5 ? '5+' : String(k));
    const groups = new Map(['0–1', '2', '3', '4', '5+'].map(k => [k, []]));
    games.forEach(g => { if (g.openLands != null) groups.get(bucket(g.openLands)).push(g); });
    const byOpen = [...groups.entries()].filter(([, list]) => list.length).map(([lands, list]) => {
      const k = list.map(g => g.killTurn).filter(x => x != null);
      return {
        lands, games: list.length, share: list.length / n,
        killMedian: median(k), killRate: k.length / list.length,
        stall: list.filter(stalled).length / list.length, flood: list.filter(flooded).length / list.length,
      };
    });
    return {
      games: games.length,
      per,
      commander: cmd.length ? { avg: mean(cmd), cast: cmd.length / n } : null,
      kill: { median: median(kills), rate: kills.length / n, avg: mean(kills), hist, never: games.length - kills.length },
      stall: games.filter(stalled).length / n,
      flood: games.filter(flooded).length / n,
      missedBy4,
      mulligan: games.filter(g => g.mulligans > 0).length / n,
      byOpen,
    };
  }

  // Over matches: { games, a, b, draws, avgTurns, why: { reason: count }, firstWins, aFirst: { games,
  // a, b }, bFirst: { games, a, b } } (who won when A went first, and when B did).
  function tally(results) {
    const out = { games: results.length, a: 0, b: 0, draws: 0, avgTurns: 0, why: {}, firstWins: 0,
      aFirst: { games: 0, a: 0, b: 0 }, bFirst: { games: 0, a: 0, b: 0 } };
    for (const r of results) {
      if (r.winner === 'A') out.a++;
      else if (r.winner === 'B') out.b++;
      else out.draws++;
      if (r.winner && r.winner === r.first) out.firstWins++;
      const side = r.first === 'A' ? out.aFirst : out.bFirst;
      side.games++;
      if (r.winner === 'A') side.a++;
      if (r.winner === 'B') side.b++;
      out.avgTurns += r.turns;
      out.why[r.why] = (out.why[r.why] || 0) + 1;
    }
    out.avgTurns /= results.length || 1;
    return out;
  }

  // How each card did, over games of one deck. games: [{ cards, won (true/false), kill (turn or null) }].
  // For every nonland card in the deck: how often it was drawn and cast, win rate (or kill turn,
  // alone) when it was cast and when it wasn't, and how often it was drawn but never cast.
  // isLand(id) leaves lands out. Sorted by how much casting it helped (lift).
  function cardImpact(games, deck, isLand, mode, maxTurns = 10) {
    const rows = [];
    const score = g => (mode === 'alone' ? (g.kill == null ? maxTurns + 1 : g.kill) : g.won ? 1 : 0);
    for (const r of deck.rows) {
      if (!r.id || isLand(r.id)) continue;
      const cast = games.filter(g => r.id in g.cards.cast);
      const notCast = games.filter(g => !(r.id in g.cards.cast));
      const drawn = games.filter(g => g.cards.drawn.includes(r.id) || r.commander);
      const stuck = drawn.filter(g => !(r.id in g.cards.cast)).length;
      const a = mean(cast.map(score));
      const b = mean(notCast.map(score));
      rows.push({
        id: r.id, name: r.name, qty: r.qty || 1, commander: !!r.commander,
        drawnRate: drawn.length / (games.length || 1), castRate: cast.length / (games.length || 1),
        castGames: cast.length,
        withIt: a, without: b,
        // Wins: higher is better. Kill turn: lower is better, so the lift is turned around.
        lift: a == null || b == null ? null : mode === 'alone' ? b - a : a - b,
        stuck: drawn.length ? stuck / drawn.length : null,
        avgTurn: mean(cast.map(g => g.cards.cast[r.id])),
      });
    }
    return rows.sort((x, y) => (y.lift == null ? -1e9 : y.lift) - (x.lift == null ? -1e9 : x.lift));
  }

  // ---------- deck variants (nothing saved) ----------

  const copyDeck = (deck, name, rows) => ({ ...deck, key: `${deck.key}~${name}`, name, rows });

  // The deck with n more lands (or fewer, n < 0): basic lands are added to (or taken from) the one
  // there are most of; with no basics, the most common land. Nothing else changes, so the deck
  // gets n cards bigger or smaller. isLand(id), isBasic(id) from the card info. Returns null when
  // there aren't enough lands to take out.
  function withLands(deck, n, isLand, isBasic) {
    const rows = deck.rows.map(r => ({ ...r }));
    const pool = rows.filter(r => isBasic(r.id)).length ? rows.filter(r => isBasic(r.id)) : rows.filter(r => isLand(r.id) && !r.commander);
    if (!pool.length) return null;
    for (let i = 0; i < Math.abs(n); i++) {
      const most = pool.reduce((a, b) => ((b.qty || 1) > (a.qty || 1) ? b : a));
      if (n > 0) most.qty = (most.qty || 1) + 1;
      else if ((most.qty || 1) > 1) most.qty--;
      else return null;
    }
    const lands = rows.filter(r => isLand(r.id)).reduce((s, r) => s + (r.qty || 1), 0);
    return copyDeck(deck, `${lands} lands`, rows);
  }

  // The deck with some cards taken out and others put in: out / add are [{ id, name, qty }].
  // Returns { deck, missing: names of cards to take out that aren't in the deck }.
  function withChanges(deck, out, add, name = `${deck.name} (changed)`) {
    const rows = deck.rows.map(r => ({ ...r }));
    const missing = [];
    for (const o of out) {
      let left = o.qty;
      for (const r of rows) {
        if (!left) break;
        if (r.id !== o.id && (!o.name || String(r.name || '').toLowerCase() !== o.name.toLowerCase())) continue;
        const k = Math.min(left, r.qty || 1);
        r.qty = (r.qty || 1) - k;
        left -= k;
      }
      if (left) missing.push(o.name);
    }
    for (const a of add) {
      const row = rows.find(r => r.id === a.id && !r.commander);
      if (row) row.qty = (row.qty || 0) + a.qty;
      else rows.push({ id: a.id, name: a.name, qty: a.qty, categories: [], commander: false });
    }
    return { deck: copyDeck(deck, name, rows.filter(r => r.qty > 0)), missing };
  }

  return { match, goldfish, summarize, tally, cardImpact, withLands, withChanges, median };
})();

if (typeof module !== 'undefined') module.exports = Autoplay;
