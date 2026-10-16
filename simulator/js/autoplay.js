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
      B.died(s, inst, defOf, null);
      if (v) B.afterDeath(v, s, inst, info || {}, defOf, null);
    };
    G.hooks.entered = (s, inst) => {
      if (!inst.faceDown) {
        for (const [kind, n] of Object.entries(G.entersWithCounters((defOf(inst.id) || {}).oracle))) G.counter(s, inst.iid, kind, n, { effect: true });
      }
      B.enterTrigger(s, inst, defOf);
      const v = view();
      if (v && v.bot) B.enterEffects(v, s, inst, defOf, null);
    };
    G.hooks.tokenEntered = (s, inst) => B.enterTrigger(s, inst, defOf);
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
  }

  // The defending table ("you") blocks Opp's pending attack the way Opp would.
  function autoBlocks(view, defOf) {
    const s = view.bot.s;
    const pending = view.bot.pending;
    const attackers = pending.attackers.map(iid => s.cards[iid]).filter(a => a && a.zone === 'battlefield')
      .map(inst => ({ inst, st: B.botStats(inst), pw: (pending.targets || {})[inst.iid] || null }))
      .sort((a, b) => b.st.pow - a.st.pow);
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

  // deckA against deckB, both played with Opp's rules. defs: { scryfallId: card } for both.
  // opts: { aFirst, maxTurns (each, default 25) }. Returns { winner: 'A' | 'B' | null, turns, why, first }.
  function match(deckA, deckB, defs, opts = {}) {
    const defOf = id => defs[id];
    const aFirst = opts.aFirst == null ? G.randomInt(2) === 0 : !!opts.aFirst;
    const maxTurns = opts.maxTurns || 25;
    let current = null;
    return isolated(() => current, defOf, () => {
      const A = { key: 'A', bot: B.create(deckA, defs, { onDraw: !aFirst }), life: startLife(deckA) };
      const Bp = { key: 'B', bot: B.create(deckB, defs, { onDraw: aFirst }), life: startLife(deckB) };
      const order = aFirst ? [A, Bp] : [Bp, A];
      for (let t = 0; t < maxTurns * 2; t++) {
        const active = order[t % 2];
        const defender = order[(t + 1) % 2];
        current = defender.bot.s;
        takeTurn(active, defender, defOf);
        current = null;
        const turns = Math.floor(t / 2) + 1;
        const outD = lost(defender);
        const outA = lost(active);
        if (outD && outA) return { winner: null, turns, why: 'both at once', first: aFirst ? 'A' : 'B' };
        if (outD) return { winner: active.key, turns, why: outD, first: aFirst ? 'A' : 'B' };
        if (outA) return { winner: defender.key, turns, why: outA, first: aFirst ? 'A' : 'B' };
      }
      return { winner: null, turns: maxTurns, why: 'turn limit', first: aFirst ? 'A' : 'B' };
    });
  }

  // The deck plays alone against an empty table that never blocks or takes a turn.
  // opts: { maxTurns (default 10), onDraw }. Returns { turns: [{ lands, landDrop, creatures, hand,
  // damage, poison }] (one per turn), commanderTurn, killTurn } (null when it didn't happen).
  function goldfish(deck, defs, opts = {}) {
    const defOf = id => defs[id];
    const maxTurns = opts.maxTurns || 10;
    const target = startLife(deck);
    let current = null;
    return isolated(() => current, defOf, () => {
      const dummy = G.create({ key: 'goldfish', name: 'Goldfish', rows: [] }, {}, {});
      const P = { bot: B.create(deck, defs, { onDraw: !!opts.onDraw }), life: startLife(deck) };
      const D = { bot: { s: dummy }, life: 100000 };
      const s = P.bot.s;
      const out = { turns: [], commanderTurn: null, killTurn: null };
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
          damage,
          poison,
        });
        if (out.commanderTurn == null && Object.values(s.cards).some(c => c.commander && (c.castCount || 0) > 0)) out.commanderTurn = t;
        if (out.killTurn == null && (damage >= target || poison >= 10)) out.killTurn = t;
        if (P.decked) break;
      }
      return out;
    });
  }

  // Averages over goldfish games: per turn (lands, how often the land drop was made, creatures,
  // damage so far, % of games already won), the commander's turn and the kill turn.
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
    const median = list => {
      if (!list.length) return null;
      const s = [...list].sort((a, b) => a - b);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    const cmd = games.map(g => g.commanderTurn).filter(x => x != null);
    const kills = games.map(g => g.killTurn).filter(x => x != null);
    return {
      games: games.length,
      per,
      commander: cmd.length ? { avg: cmd.reduce((a, b) => a + b, 0) / cmd.length, cast: cmd.length / n } : null,
      kill: { median: median(kills), rate: kills.length / n },
    };
  }

  // Totals over matches: { games, a, b, draws, avgTurns, why: { reason: count }, firstWins }.
  function tally(results) {
    const out = { games: results.length, a: 0, b: 0, draws: 0, avgTurns: 0, why: {}, firstWins: 0 };
    for (const r of results) {
      if (r.winner === 'A') out.a++;
      else if (r.winner === 'B') out.b++;
      else out.draws++;
      if (r.winner && r.winner === r.first) out.firstWins++;
      out.avgTurns += r.turns;
      out.why[r.why] = (out.why[r.why] || 0) + 1;
    }
    out.avgTurns /= results.length || 1;
    return out;
  }

  return { match, goldfish, summarize, tally };
})();

if (typeof module !== 'undefined') module.exports = Autoplay;
