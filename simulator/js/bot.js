/*
 * The computer opponent ("Opp") for playing alone. It plays its own deck with simple rules:
 * a land each turn, the biggest spells it can afford, attacks that look safe, and blocks that
 * keep it alive. It understands creatures, mana rocks, simple removal ("destroy target creature",
 * "deals 3 damage to any target") and simple card draw. Other card text is ignored.
 *
 * Its table is a second game state (see game.js) kept in game.bot.s, so saving and Undo cover it.
 * Opp's life is game.oppLife, the same number the Opp counter has always shown.
 * No screen code lives here; app.js asks you for blocks and draws Opp's table.
 */
const Bot = (() => {
  'use strict';
  const G = typeof Game !== 'undefined' ? Game : require('./game.js');

  const KEYWORDS = ['flying', 'reach', 'vigilance', 'haste', 'deathtouch', 'trample', 'lifelink', 'first strike',
    'double strike', 'menace', 'defender', 'indestructible', 'hexproof', 'shroud', 'ward',
    'plainswalk', 'islandwalk', 'swampwalk', 'mountainwalk', 'forestwalk', 'fear', 'intimidate', 'skulk', 'shadow',
    'protection from each color'];

  // Other keywords that share a line with the ones above ("Flying, lifelink, ward {2}"). Opp
  // ignores what they do, but they mustn't hide the keywords next to them.
  const OTHER_KEYWORDS = ['protection', 'flash', 'prowess', 'toxic', 'infect', 'wither', 'partner', 'changeling',
    'devoid', 'exalted', 'persist', 'undying', 'afflict', 'annihilator', 'bushido', 'cascade', 'convoke', 'crew', 'cycling',
    'echo', 'evolve', 'extort', 'flanking', 'horsemanship', 'rampage', 'riot',
    'mentor', 'training', 'myriad', 'battle cry', 'backup', 'enlist', 'decayed', 'afterlife', 'fabricate', 'dethrone',
    'ravenous', 'squad', 'unearth', 'dash', 'blitz', 'escape', 'evoke', 'kicker', 'madness', 'ninjutsu', 'mutate',
    'disturb', 'daybound', 'nightbound', 'for mirrodin!', 'living weapon', 'equip', 'reconfigure', 'bestow', 'morph',
    'megamorph', 'outlast', 'renown', 'soulbond', 'split second', 'storm', 'suspend', 'vanishing', 'fading', 'modular',
    'graft', 'provoke', 'poisonous', 'bloodthirst', 'amplify', 'champion', 'haunt', 'scavenge', 'emerge', 'encore',
    'boast', 'foretell', 'casualty', 'compleated', 'read ahead', 'affinity', 'improvise', 'miracle', 'overload',
    'landwalk'];
  // "Protection from white", "protection from white and from blue", "protection from each color":
  // the keyword as stats keeps it ("protection from W U", "protection from each color"), or null.
  const PRO_COLORS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  function protectionKw(text) {
    const m = /^protection from (.+)$/i.exec(String(text).trim().toLowerCase().replace(/\.$/, ''));
    if (!m) return null;
    if (/^(each|all) colou?rs?$/.test(m[1])) return 'protection from each color';
    const words = m[1].split(/,\s*|\s+and\s+|\s+/).map(w => w.replace(/^from$/, '')).filter(Boolean);
    const cols = words.map(w => PRO_COLORS[w]);
    return cols.length && cols.every(Boolean) ? `protection from ${[...new Set(cols)].join(' ')}` : null;
  }

  // A counter you named yourself, as the keyword it gives: "flying", "double strike" (or
  // "doublestrike"), "indestructible" (or "indestructable"), "protection from white". Or null.
  const SPELLINGS = { indestructable: 'indestructible', indestructibe: 'indestructible' };
  function counterKw(name) {
    const n = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
    const pro = protectionKw(n);
    if (pro) return pro;
    const squashed = n.replace(/[\s-]/g, '');
    return KEYWORDS.find(k => k.replace(/\s/g, '') === squashed) || SPELLINGS[squashed] || null;
  }

  // A keyword counter's proper name ("doublestrike" → "double strike", "Protection from White" →
  // "protection from white"), or null if the name isn't a keyword.
  function keywordCounter(name) {
    const k = counterKw(name);
    if (!k) return null;
    return /^protection from /.test(k) && k !== 'protection from each color' ? String(name).trim().toLowerCase().replace(/\s+/g, ' ') : k;
  }

  const isKeyword = (p, list) => list.some(k => p === k || p.startsWith(k + ' ') || p.startsWith(k + '—'));

  // Keywords a card has on its own lines ("Flying, vigilance"), not ones it gives other cards.
  function keywords(oracle) {
    const found = new Set();
    for (const raw of String(oracle || '').split('\n')) {
      const line = raw.replace(/\([^)]*\)/g, '').trim().toLowerCase().replace(/\.$/, '');
      const parts = line.split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
      if (!parts.length || !parts.every(p => isKeyword(p, KEYWORDS) || isKeyword(p, OTHER_KEYWORDS))) continue;
      parts.forEach(p => KEYWORDS.forEach(k => { if (p === k || p.startsWith(k + ' ')) found.add(k); }));
      parts.forEach(p => { const pro = protectionKw(p); if (pro) found.add(pro); });
    }
    return [...found];
  }

  // What an equipment or aura gives the creature it's on, from lines like "Equipped creature gets
  // +2/+0 and has lifelink." or "Enchanted creature has flying." Returns { pow, tou, kw }, plus
  // cantAttack, cantBlock and noAbilities for "Enchanted creature can't attack or block, and its
  // activated abilities can't be activated." (Arrest, Pacifism).
  function attachBonus(oracle) {
    const out = { pow: 0, tou: 0, kw: [] };
    for (const raw of String(oracle || '').split('\n')) {
      const line = raw.replace(/\([^)]*\)/g, '').trim();
      const m = /^(?:equipped|enchanted) creature (.+?)\.?$/i.exec(line.split('. ')[0]);
      if (!m) continue;
      if (/\bcan't attack\b/i.test(m[1])) out.cantAttack = true;
      if (/\bcan't (?:attack or )?block\b/i.test(m[1])) out.cantBlock = true;
      if (/\bactivated abilities can't be activated\b/i.test(m[1])) out.noAbilities = true;
      const pt = /\bgets ([+-]\d+)\/([+-]\d+)/i.exec(m[1]);
      if (pt) { out.pow += Number(pt[1]); out.tou += Number(pt[2]); }
      const has = /\bhas (.+)$/i.exec(m[1]);
      if (has) {
        has[1].toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(p => p.trim())
          .forEach(p => { if (KEYWORDS.includes(p) && !out.kw.includes(p)) out.kw.push(p); });
      }
    }
    return out;
  }

  // An equipment's equip cost in mana ("Equip {2}", "Equip {1}{W}"), or null when it has none
  // (or only one that isn't mana, like "Equip—Pay 3 life"). A plain "Equip" line wins over
  // ones like "Equip legendary creature {1}".
  function equipCost(oracle) {
    const costs = [];
    for (const raw of String(oracle || '').split('\n')) {
      const m = /^equip( [a-z ]+?)?\s*((?:\{[^}]+\})+)/i.exec(raw.trim());
      if (m) costs.push({ plain: !m[1], cost: m[2] });
    }
    const pick = costs.find(c => c.plain) || costs[0];
    return pick ? pick.cost : null;
  }

  const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const toNumber = w => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[String(w).toLowerCase()] || 0);

  // What an instant or sorcery does, if it's simple enough for Opp to use:
  //   { kill: true }                      destroy / exile target creature
  //   { damage: n, creature, player }     deals n damage to a creature and/or a player
  //   { draw: n }                         draw n cards
  // Anything else returns null and Opp never casts it.
  function spellEffect(oracle) {
    const text = String(oracle || '').replace(/\([^)]*\)/g, '').trim();
    const first = text.split('\n')[0].trim();
    let m;
    if (/^(destroy|exile) target (creature|nonland permanent|permanent|creature or planeswalker|creature an opponent controls|creature you don't control)\.$/i.test(first)) return { kill: true, exile: /^exile/i.test(first) };
    if ((m = first.match(/^[^.]*?deals (\w+) damage to (any target|target creature or planeswalker|target creature|target player or planeswalker|target opponent or planeswalker|target opponent|each opponent)\.$/i))) {
      const n = toNumber(m[1]);
      if (!n) return null;
      const to = m[2].toLowerCase();
      return { damage: n, creature: /any target|creature/.test(to), player: /any target|player|opponent/.test(to) };
    }
    if ((m = first.match(/^draw (\w+) cards?\.$/i)) && toNumber(m[1])) return { draw: toNumber(m[1]) };
    return null;
  }

  const front = typeLine => String(typeLine || '').split('//')[0];
  const num = v => (/^-?\d+$/.test(String(v)) ? Number(v) : 0); // "*" counts as 0

  // Power, toughness and keywords of a creature right now, counters included.
  // card is the Scryfall card for your cards, or the facts stored on Opp's cards.
  function stats(inst, card) {
    card = card || {};
    let pow;
    let tou;
    const pt = inst.custom && /^(\S+)\/(\S+)$/.exec(String(inst.custom.pt || '').trim());
    if (pt) { pow = num(pt[1]); tou = num(pt[2]); } else { pow = num(card.power); tou = num(card.toughness); }
    const c = inst.counters || {};
    // Any power/toughness counter: +1/+1, -1/-1, or ones you name like +2/+2 or +1/+0.
    for (const [name, n] of Object.entries(c)) {
      const m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(String(name).trim());
      if (m && n) { pow += Number(m[1]) * n; tou += Number(m[2]) * n; }
    }
    if (inst.pump) { pow += inst.pump.pow; tou += inst.pump.tou; } // "gets +X/+X until end of turn"
    if (inst.anthem) { pow += inst.anthem.pow; tou += inst.anthem.tou; } // from lords, see refreshGrants
    const kw = new Set(card.kw || keywords(card.oracle || (inst.custom && inst.custom.text)));
    for (const [name, n] of Object.entries(c)) { const k = n > 0 && counterKw(name); if (k) kw.add(k); }
    (inst.granted || []).forEach(k => kw.add(k)); // from lords, see refreshGrants
    ((inst.pump && inst.pump.kw) || []).forEach(k => kw.add(k)); // "gain trample until end of turn"
    // Equipment and auras attached to it.
    for (const b of Object.values(inst.boosts || {})) {
      pow += b.pow || 0;
      tou += b.tou || 0;
      (b.kw || []).forEach(k => kw.add(k));
      if (b.cantAttack) kw.add("can't attack");
      if (b.cantBlock) kw.add("can't block");
    }
    return { pow, tou, kw, cmc: card.cmc || 0, colors: colorsOf(card), artifact: /\bartifact\b/i.test(front(inst.typeLine)) };
  }

  // A card's colors: from its mana cost (hybrid counts as both), or its color identity when it
  // has no cost (tokens). card is the Scryfall card or Opp's stored facts.
  function colorsOf(card) {
    if (Array.isArray(card.colors)) return card.colors;
    const cost = card.manaCost != null ? card.manaCost : card.cost || '';
    const found = G.MANA.filter(k => k !== 'C' && new RegExp(`\\{[^}]*${k}[^}]*\\}`).test(cost));
    return found.length || cost ? found : card.colorIdentity || [];
  }

  const value = st => st.pow + st.tou + st.kw.size + st.cmc / 2;

  // Can this creature be one of the blockers? (Flying needs flying or reach. Menace is about how
  // many block, so it's checked with legalBlock.)
  // Landwalk: unblockable while the defending player controls a land of that type (forestwalk and a Forest).
  const WALKS = { plainswalk: 'plains', islandwalk: 'island', swampwalk: 'swamp', mountainwalk: 'mountain', forestwalk: 'forest' };
  const walksPast = (attacker, defender) => !!defender && Object.entries(WALKS).some(([k, type]) => attacker.kw.has(k)
    && defender.zones.battlefield.some(iid => G.isLand(defender.cards[iid]) && new RegExp(`\\b${type}\\b`, 'i').test(defender.cards[iid].typeLine || '')));
  // defender: the blocking player's table (for landwalk); optional.
  // Fear: only black or artifact creatures block it. Intimidate: only artifact creatures or ones that
  // share a color with it. Skulk: not creatures with greater power. Shadow only blocks and is only
  // blocked by shadow.
  const shares = (a, b) => (a.colors || []).some(k => (b.colors || []).includes(k));
  // Protection from each color (or from white, …): creatures of that color can't block it, and
  // damage from them is prevented.
  const shielded = (x, from) => [...x.kw].some(k => {
    const m = /^protection from (.+)$/.exec(k);
    if (!m) return false;
    return m[1] === 'each color' ? (from.colors || []).length > 0 : m[1].split(' ').some(col => (from.colors || []).includes(col));
  });
  // Defender, or an aura like Arrest on it.
  const noAttack = st => st.kw.has('defender') || st.kw.has("can't attack");
  // "Its activated abilities can't be activated" (Arrest): no abilities, mana ones included.
  const silenced = inst => Object.values(inst.boosts || {}).some(b => b && b.noAbilities);
  const canBlock = (blocker, attacker, defender) => !blocker.kw.has("can't block") && !walksPast(attacker, defender) && !shielded(attacker, blocker)
    && (!attacker.kw.has('flying') || blocker.kw.has('flying') || blocker.kw.has('reach'))
    && (!attacker.kw.has('fear') || blocker.artifact || (blocker.colors || []).includes('B'))
    && (!attacker.kw.has('intimidate') || blocker.artifact || shares(blocker, attacker))
    && (!attacker.kw.has('skulk') || blocker.pow <= attacker.pow)
    && attacker.kw.has('shadow') === blocker.kw.has('shadow');
  // Is this number of blockers allowed? Menace needs none or at least two.
  const legalBlock = (attacker, n) => !n || !attacker.kw.has('menace') || n >= 2;

  // One attacker against its blockers (none, one or more), first strike and double strike included.
  // The attacker puts lethal damage on each blocker in order and the rest on the last one, or with
  // trample on the player. Deathtouch makes 1 damage lethal.
  // Returns { a: { dead, dealt }, b: [{ dead, dealt }], player }, dealt being all the damage it did.
  function combat(a, bs) {
    const firstStep = x => x.kw.has('first strike') || x.kw.has('double strike');
    const normalStep = x => !x.kw.has('first strike') || x.kw.has('double strike');
    const blank = () => ({ dmg: 0, dt: false, dead: false, dealt: 0 });
    const A = blank();
    const B = bs.map(blank);
    let player = 0;
    const lethalOn = i => (B[i].dt || B[i].dmg >= bs[i].tou ? 0 : a.kw.has('deathtouch') ? 1 : bs[i].tou - B[i].dmg);
    const check = (x, t) => { if (!x.kw.has('indestructible') && (t.dmg >= x.tou || t.dt)) t.dead = true; };
    for (const step of [firstStep, normalStep]) {
      const aHits = step(a) && !A.dead && a.pow > 0;
      const bHits = bs.map((b, i) => step(b) && !B[i].dead && b.pow > 0);
      if (aHits) {
        let left = a.pow;
        if (!bs.length) player += left;
        else {
          const alive = bs.map((b, i) => i).filter(i => !B[i].dead);
          alive.forEach((i, k) => {
            const n = k === alive.length - 1 && !a.kw.has('trample') ? left : Math.min(left, lethalOn(i));
            if (!n) return;
            left -= n;
            if (shielded(bs[i], a)) return; // assigned, but prevented
            B[i].dmg += n;
            if (a.kw.has('deathtouch')) B[i].dt = true;
            A.dealt += n;
          });
          if (a.kw.has('trample')) player += left; // blocked with no blockers left: only trample gets through
        }
        if (!bs.length || a.kw.has('trample')) A.dealt += left;
      }
      bs.forEach((b, i) => {
        if (!bHits[i] || shielded(a, b)) return;
        A.dmg += b.pow;
        B[i].dealt += b.pow;
        if (b.kw.has('deathtouch')) A.dt = true;
      });
      check(a, A);
      bs.forEach((b, i) => check(b, B[i]));
    }
    return { a: A, b: B, player };
  }

  // One attacker against one blocker. Returns { a: { dead, dealt }, b: { dead, dealt }, player }.
  function fight(a, b) {
    const r = combat(a, [b]);
    return { a: r.a, b: r.b[0], player: r.player };
  }

  // Damage an attacker deals to the player: all of it unblocked, the extra over lethal with trample.
  function toPlayer(a, b, result) {
    if (!b) return combat(a, []).player;
    return (result || fight(a, b)).player;
  }

  const isPlaneswalker = inst => !inst.faceDown && /\bplaneswalker\b/i.test(front(inst.typeLine));
  // A planeswalker's loyalty: its loyalty counters, or the printed number if it has none yet.
  const loyaltyOf = (inst, card) => (inst.counters && inst.counters.loyalty != null ? inst.counters.loyalty : num(card && card.loyalty));

  // Combat damage to a planeswalker takes off loyalty. At 0 it dies. Returns true if it died.
  function damagePlaneswalker(inst, card, n) {
    const left = loyaltyOf(inst, card) - n;
    inst.counters = Object.assign({}, inst.counters, { loyalty: Math.max(0, left) });
    return left <= 0;
  }

  // ---------- Opp's table ----------

  // The facts Opp needs about each of its cards, stored on the card so they survive saving.
  function facts(card) {
    return {
      cost: card.manaCost || '',
      cmc: card.cmc || 0,
      power: card.power,
      toughness: card.toughness,
      loyalty: card.loyalty,
      kw: keywords(card.oracle),
      colors: colorsOf(card),
      spell: /\b(instant|sorcery)\b/i.test(front(card.typeLine)) ? spellEffect(card.oracle) : null,
    };
  }

  // deck: { name, key, rows }, defs: { scryfallId: card }. onDraw: Opp goes second.
  function create(deck, defs, opts = {}) {
    const s = G.create(deck, defs, { onDraw: !!opts.onDraw });
    s.opponents = 1; // you
    s.log = [];
    for (const inst of Object.values(s.cards)) inst.bot = facts(defs[inst.id] || {});
    G.log(s, `Opp is playing ${deck.name}${s.onDraw ? ' (on the draw)' : ' (on the play)'}.`);
    keepOrMulligan(s);
    return { s, started: false, pending: null };
  }

  // Keeps 7 with 2 to 5 lands. Otherwise takes one mulligan and puts the worst card on the bottom.
  function keepOrMulligan(s) {
    const lands = () => s.zones.hand.filter(iid => G.isLand(s.cards[iid])).length;
    const n = lands();
    if (n >= 2 && n <= 5) return;
    for (const iid of s.zones.hand.splice(0)) {
      s.cards[iid].zone = 'library';
      s.zones.library.push(iid);
    }
    G.shuffleArray(s.zones.library);
    G.drawCards(s, G.drawsTurnOne(s) ? 8 : 7, true);
    s.mulligans = 1;
    const tooMany = lands() > 4;
    const worst = s.zones.hand
      .filter(iid => G.isLand(s.cards[iid]) === tooMany)
      .sort((x, y) => (s.cards[y].bot.cmc || 0) - (s.cards[x].bot.cmc || 0))[0] || s.zones.hand[0];
    G.move(s, worst, 'library', { bottom: true });
    G.log(s, `Opp mulliganed (${n} land${n === 1 ? '' : 's'} in the first hand) and put a card on the bottom.`);
  }

  const botStats = inst => stats(inst, inst.bot);
  const creatures = (s, pred) => s.zones.battlefield.map(iid => s.cards[iid]).filter(c => G.isCreature(c) && !c.faceDown && (!pred || pred(c)));
  const sick = (s, inst, st) => inst.enteredTurn === s.turn && !st.kw.has('haste');

  // Runs an action on Opp's table with the real life totals: Opp's own life is game.oppLife,
  // and "each opponent loses" on Opp's table is you.
  function onOpp(game, fn) {
    const s = game.bot.s;
    s.life = game.oppLife;
    s.oppLife = game.life;
    const out = fn(s);
    game.oppLife = s.life;
    game.life = s.oppLife;
    delete s.oppHits;
    delete s.notice;
    return out;
  }

  // Can Opp pay this cost right now? Tries it on a copy so nothing is tapped.
  function affordable(s, cost, tax) {
    if (/\{X\}/i.test(cost)) return false;
    const copy = JSON.parse(JSON.stringify({ zones: s.zones, cards: s.cards, mana: s.mana, turn: s.turn, life: 0, oppLife: 0, log: [] }));
    return !!G.autoPay(copy, cost, tax);
  }

  // Picks the land that adds a color Opp's hand needs and doesn't have yet; untapped ones first.
  function playLand(s) {
    if (s.landPlayed) return;
    const lands = s.zones.hand.filter(iid => G.isLand(s.cards[iid]));
    if (!lands.length) return;
    const have = new Set(G.MANA.filter(k => G.available(s).byColor[k]));
    const wanted = new Set();
    s.zones.hand.forEach(iid => (s.cards[iid].bot.cost.match(/[WUBRG]/g) || []).forEach(k => wanted.add(k)));
    const score = iid => {
      const inst = s.cards[iid];
      const makes = G.producesOf(inst);
      return makes.filter(k => wanted.has(k) && !have.has(k)).length * 3 + (makes.length ? 1 : 0) - (inst.entersTapped ? 2 : 0);
    };
    const pick = lands.sort((a, b) => score(b) - score(a))[0];
    G.move(s, pick, 'battlefield');
  }

  // Opp's best target among your creatures for removal: the most valuable one it can hit.
  function bestTarget(you, maxToughness) {
    return you
      .filter(c => !c.st.kw.has('hexproof') && !c.st.kw.has('shroud') && !c.st.kw.has('ward')) // Opp doesn't pay ward costs
      .filter(c => maxToughness == null || (c.st.tou <= maxToughness && !c.st.kw.has('indestructible')))
      .sort((a, b) => value(b.st) - value(a.st))[0] || null;
  }

  // Your creatures with their stats. defOf(id) gives the Scryfall card.
  function yourCreatures(game, defOf) {
    return creatures(game).map(inst => ({ inst, st: stats(inst, defOf(inst.id)) }));
  }

  const oracleOf = defOf => inst => (defOf(inst.id) || {}).oracle || '';

  // Opp's most common creature type, for "choose a creature type".
  function commonType(s) {
    const counts = {};
    for (const inst of Object.values(s.cards)) {
      if (!G.isCreature(inst)) continue;
      (front(inst.typeLine).split('—')[1] || '').split(/\s+/).filter(Boolean).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  }

  // Casts one spell if it can: removal when there's a good target, otherwise the most
  // expensive thing it can afford. Returns true if it cast something.
  function castOne(game, defOf, notes) {
    const s = game.bot.s;
    const you = yourCreatures(game, defOf);
    const options = [];
    for (const zone of ['command', 'hand']) {
      for (const iid of s.zones[zone]) {
        const inst = s.cards[iid];
        const f = inst.bot;
        const type = front(inst.typeLine);
        if (G.isLand(inst) || /\b(planeswalker|battle)\b/i.test(type) || /\baura\b/i.test(type)) continue;
        const isSpell = /\b(instant|sorcery)\b/i.test(type);
        if (isSpell && !f.spell) continue;
        if (!isSpell && !/\b(creature|artifact|enchantment)\b/i.test(type)) continue;
        const tax = zone === 'command' ? (inst.castCount || 0) * 2 : 0;
        if (!affordable(s, f.cost, tax - G.discount(s, inst, oracleOf(defOf)))) continue;
        let target = null;
        let priority = f.cmc + (G.isCreature(inst) ? 0.5 : 0);
        if (f.spell && f.spell.kill) {
          target = bestTarget(you);
          if (!target || value(target.st) < 4) continue;
          priority += 10;
        } else if (f.spell && f.spell.damage) {
          const n = f.spell.damage;
          target = f.spell.creature ? bestTarget(you, n) : null;
          // At you only when it's lethal, or you're low and there's no creature worth it.
          if (f.spell.player && (game.life <= n || (!target && game.life <= 10))) target = 'face';
          if (!target) continue;
          priority += target === 'face' ? (game.life <= n ? 20 : -5) : 8;
        }
        options.push({ iid, inst, tax, target, priority });
      }
    }
    if (!options.length) return false;
    const pick = options.sort((a, b) => b.priority - a.priority)[0];
    const { iid, inst, tax, target } = pick;
    const f = inst.bot;
    onOpp(game, () => G.autoPay(s, f.cost, tax - G.discount(s, inst, oracleOf(defOf))));
    if (!f.spell) {
      onOpp(game, () => G.move(s, iid, 'battlefield'));
      if (G.choosesType(oracleOf(defOf)(inst))) {
        inst.chosenType = commonType(s);
        if (inst.chosenType) G.log(s, `Chose ${inst.chosenType} for ${inst.name}.`);
      }
      // "When this enters, each player discards a card": Opp drops its worst; you're asked to pick yours.
      const d = G.enterDiscard(inst.name, oracleOf(defOf)(inst));
      if (d && d.you) oppDiscards(game, d.you, d.random, inst.name);
      if (d && d.opp) youDiscard(game, d.opp, d.random, `Opp's ${inst.name}`);
      notes.push(`cast ${inst.name}`);
      return true;
    }
    if (f.spell.kill) {
      G.log(s, `Cast ${inst.name} on your ${target.inst.name}.`);
      if (f.spell.exile || !regenerates(game, target.inst, defOf, false)) moveYours(game, target.inst, f.spell.exile ? 'exile' : 'graveyard');
      notes.push(`cast ${inst.name} on your ${target.inst.name}`);
    } else if (f.spell.damage) {
      if (target === 'face') {
        game.life -= f.spell.damage;
        G.log(s, `Cast ${inst.name}: ${f.spell.damage} damage to you.`);
        dealtDamage(game, f.spell.damage, defOf);
        notes.push(`cast ${inst.name} for ${f.spell.damage} damage to you`);
      } else {
        G.log(s, `Cast ${inst.name}: ${f.spell.damage} damage to your ${target.inst.name}.`);
        if (!regenerates(game, target.inst, defOf, false)) moveYours(game, target.inst, 'graveyard');
        notes.push(`cast ${inst.name} on your ${target.inst.name}`);
      }
    } else if (f.spell.draw) {
      G.log(s, `Cast ${inst.name} and drew ${f.spell.draw}.`);
      G.drawCards(s, f.spell.draw, true);
      notes.push(`cast ${inst.name}`);
    }
    G.move(s, iid, 'graveyard');
    return true;
  }

  // You discard n cards because of Opp: at random right away, otherwise you're asked to pick
  // (app.js shows game.mustDiscard).
  function youDiscard(game, n, random, why) {
    if (!random) {
      game.mustDiscard = { n: ((game.mustDiscard || {}).n || 0) + n, why };
      return;
    }
    const gone = [];
    for (let i = 0; i < n && game.zones.hand.length; i++) {
      const iid = game.zones.hand[G.randomInt(game.zones.hand.length)];
      gone.push(game.cards[iid].name);
      G.move(game, iid, 'graveyard');
    }
    if (gone.length) G.log(game, `${why}: you discarded ${andList(gone)} at random.`);
  }

  // One of your cards dies: commanders go back to the command zone, everything else to the graveyard.
  function moveYours(game, inst, to) {
    G.move(game, inst.iid, inst.commander && to === 'graveyard' ? 'command' : to);
  }
  function moveOpps(s, inst) {
    G.move(s, inst.iid, inst.commander ? 'command' : 'graveyard');
  }

  // ---------- your cards' simple abilities, done for you ----------

  const COUNT = '(a|an|one|two|three|four|five|six|seven|\\d+)';
  const isSelf = (words, inst) => {
    const w = words.toLowerCase().trim();
    const name = (inst.name || '').split(' // ')[0].toLowerCase();
    return w === name || w === name.split(',')[0] || w === 'it' || /^this (creature|artifact|enchantment|permanent|land|card)$/.test(w)
      || (w.length >= 4 && name.startsWith(w + ' ') && /\blegendary\b/i.test(inst.typeLine || '')); // "Ashcoat" for Ashcoat of the Shadow Swarm
  };

  // Does the easy parts of an ability's effect for you: drawing, life, and counters on the card
  // itself. ctx: { self, hitOpps(n) } where hitOpps takes life from each opponent.
  // Returns the parts it couldn't do (for you to do by hand), or [].
  function runEffect(game, text, ctx, times = 1) {
    const left = [];
    const parts = String(text).replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '')
      .split(/\.\s+|,?\s+and\s+(?=you |draw |each |put )|,\s+then\s+/i).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      let m;
      for (let i = 0; i < times; i++) {
        if ((m = new RegExp(`^(?:you )?draw ${COUNT} cards?$`, 'i').exec(part))) G.drawCards(game, toNumber(m[1]));
        else if ((m = new RegExp(`^you gain ${COUNT} life$`, 'i').exec(part))) game.life += toNumber(m[1]);
        else if ((m = new RegExp(`^you lose ${COUNT} life$`, 'i').exec(part))) game.life -= toNumber(m[1]);
        else if ((m = new RegExp(`^each opponent loses ${COUNT} life$`, 'i').exec(part)) && ctx.hitOpps) ctx.hitOpps(toNumber(m[1]));
        else if ((m = new RegExp(`^put ${COUNT} ([\\w+/-]+) counters? on (.+)$`, 'i').exec(part)) && ctx.self && isSelf(m[3], ctx.self)) {
          G.counter(game, ctx.self.iid, m[2].toLowerCase(), toNumber(m[1]), { effect: true });
        } else if ((m = /^regenerate (.+)$/i.exec(part)) && ctx.self && isSelf(m[1], ctx.self)) {
          ctx.self.regen = (ctx.self.regen || 0) + 1; // used up by regenerates()
        } else { left.push(part); break; }
      }
    }
    return left;
  }

  const yourPermanents = game => game.zones.battlefield.map(iid => game.cards[iid]).filter(c => c && !c.faceDown);
  const oracleLines = (inst, defOf) => String((defOf(inst.id) || {}).oracle || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim());

  // Runs one trigger and logs it. Parts it can't do are logged for you to do by hand.
  function fire(game, inst, what, effect, ctx, times = 1) {
    const left = runEffect(game, effect, Object.assign({ self: inst }, ctx), times);
    G.log(game, `${inst.name}: ${what}${times > 1 ? ` (×${times})` : ''}.${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
  }

  // You were dealt damage: "Whenever you're dealt damage, put that many charge counters on …".
  function dealtDamage(game, n, defOf) {
    if (!(n > 0)) return;
    for (const inst of yourPermanents(game)) {
      for (const line of oracleLines(inst, defOf)) {
        const m = /^whenever you(?:'re| are) dealt damage, (?:you may )?put that many ([\w+/-]+) counters? on (.+?)\.?$/i.exec(line);
        if (!m || !isSelf(m[2], inst)) continue;
        G.counter(game, inst.iid, m[1].toLowerCase(), n, { effect: true });
        G.log(game, `${inst.name}: you were dealt ${n}, so it gets ${n} ${m[1]} counter${n === 1 ? '' : 's'}.`);
      }
    }
  }

  // Landfall: "Whenever a land (you control) enters (the battlefield under your control), …".
  function landEntered(game, land, defOf, ctx) {
    for (const inst of yourPermanents(game)) {
      for (const line of oracleLines(inst, defOf)) {
        const m = /^(?:landfall\s*[—-]\s*)?whenever a land(?: you control)? enters(?: the battlefield)?(?: under your control)?, (?:you may )?(.+)$/i.exec(line);
        if (m) fire(game, inst, `landfall (${land.name})`, m[1], ctx);
      }
    }
  }

  // "Whenever a creature (you control) enters (the battlefield under your control), …" (Ajani's
  // Welcome), also "another creature" and "nontoken creature". Face-down cards are creatures too.
  // Ones that see every player's creatures (Soul Warden) are left to you.
  function creatureEntered(game, creature, defOf, ctx) {
    if (!creature.faceDown && !G.isCreature(creature)) return;
    for (const inst of yourPermanents(game)) {
      for (const line of oracleLines(inst, defOf)) {
        const m = /^whenever (?:an? )?(another )?(nontoken )?creature(?: you control)? enters(?: the battlefield)?(?: under your control)?, (?:you may )?(.+)$/i.exec(line);
        if (!m || !/you control|under your control/i.test(line.split(',')[0])) continue;
        if (m[1] && inst === creature) continue;
        if (m[2] && creature.token) continue;
        fire(game, inst, `${creature.faceDown ? 'a creature' : creature.name} entered`, m[3], ctx);
      }
    }
  }

  // "When this creature dies, create a 2/1 black Cat creature token." (older wording: "is put into
  // a graveyard from play / the battlefield"). s: the table it died on. Tokens are made on either
  // table; other effects run only on yours (ctx), and what's left is logged to do by hand.
  function died(s, inst, defOf, ctx) {
    for (const line of oracleLines(inst, defOf)) {
      const m = /^when(?:ever)? (.+?) (?:dies|is put into (?:a|your) graveyard from (?:the battlefield|play)), (?:you may )?(.+)$/i.exec(line);
      if (!m || !isSelf(m[1], inst)) continue;
      if (triggerTokens(s, inst, m[2].trim(), 'dies')) continue;
      if (ctx) fire(s, inst, 'dies', m[2], ctx);
      else G.log(s, `${inst.name} died: ${m[2]}`);
    }
  }

  // Combat damage to a player. hits:[{ inst, st, card }] for each of your creatures that dealt
  // combat damage to a player. Handles "Whenever this creature / a creature you control / one or
  // more creatures you control (each with power greater than its base power) deals combat damage
  // to a player, …".
  function combatDamage(game, hits, defOf, ctx) {
    if (!hits.length) return;
    for (const inst of yourPermanents(game)) {
      for (const line of oracleLines(inst, defOf)) {
        const h = hitTrigger(line, inst, hits);
        if (!h) continue;
        const d = destroyTheirs(h.effect);
        if (d) {
          // You pick (or skip) which one: afterChange opens the picker for game.mustDestroy.
          game.mustDestroy = [...(game.mustDestroy || []), { what: d, why: inst.name }];
          G.log(game, `${inst.name}: combat damage to Opp, so you may destroy up to one ${d} Opp controls.`);
        } else fire(game, inst, 'combat damage to a player', h.effect, ctx, h.times);
      }
    }
  }

  // Opp's creatures hit you: its "…, destroy up to one target artifact or enchantment that player
  // controls" takes your priciest one. Other triggers of this kind aren't done for Opp.
  function oppCombatDamage(game, hits, defOf) {
    if (!hits.length) return;
    const s = game.bot.s;
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        const h = hitTrigger(line, inst, hits);
        const d = h && destroyTheirs(h.effect);
        if (!d) continue;
        const pick = destroyable(game, d).sort((a, b) => ((defOf(b.id) || {}).cmc || 0) - ((defOf(a.id) || {}).cmc || 0))[0];
        if (!pick) continue;
        G.log(s, `Opp's ${inst.name}: combat damage to you, so it destroys your ${pick.name}.`);
        moveYours(game, pick, 'graveyard');
      }
    }
  }

  // "Whenever this creature / a creature you control / one or more Cats you control (each with power
  // greater than its base power) deals combat damage to a player, …" against hits [{ inst, st, card }].
  // Returns { times, effect } when it triggers, or null.
  function hitTrigger(line, inst, hits) {
    const m = /^whenever (.+?) deals? combat damage to (?:a player|an opponent|one or more players)(?: or battle)?, (?:you may )?(.+)$/i.exec(line);
    if (!m) return null;
    const who = m[1].toLowerCase();
    // A token's base power is in its own P/T ("2/1"), not on a Scryfall card.
    const base = h => num(h.inst.custom && h.inst.custom.pt ? String(h.inst.custom.pt).split('/')[0] : h.card && h.card.power);
    const bigger = h => !/power greater than its base power/.test(who) || h.st.pow > base(h);
    let g;
    let times = 0;
    if ((g = /^one or more (.+?) you control/.exec(who))) times = hits.some(h => bigger(h) && isA(h.inst, g[1])) ? 1 : 0;
    else if ((g = /^(?:an?|another) (.+?) you control/.exec(who))) times = hits.filter(h => bigger(h) && isA(h.inst, g[1]) && !(/^another/.test(who) && h.inst === inst)).length;
    else if (isSelf(who, inst)) times = hits.some(h => h.inst === inst) ? 1 : 0;
    return times ? { times, effect: m[2] } : null;
  }

  // "destroy up to one target artifact or enchantment that player controls" → 'artifact or enchantment'.
  const destroyTheirs = effect => {
    const m = /^destroy (?:up to one|target) (?:target )?(.+?) that player controls\.?$/i.exec(effect.trim());
    return m ? m[1] : null;
  };
  // The permanents on a table that fit a phrase like "artifact or enchantment".
  const destroyable = (s, what) => permanents(s).filter(c => what.split(/\s+or\s+/i).some(w => isA(c, w)));

  // A Vehicle's crew number ("Crew 3"), or null.
  function crewOf(inst, defOf) {
    const m = /^crew (\d+)/im.exec(String((defOf(inst.id) || {}).oracle || ''));
    return m ? Number(m[1]) : null;
  }

  // Activated abilities a menu can offer: "{2}, {T}, Remove four charge counters from this: You gain 2 life and draw a card."
  // Costs it knows: mana, {T}, removing counters from itself, paying life, sacrificing itself, discarding cards.
  // Returns [{ text, mana, tap, remove: { n, kind } | null, life, sacrifice, discard, effect }]. Mana abilities ("Add …") are left out.
  function activatedAbilities(inst, defOf) {
    const out = [];
    if (silenced(inst)) return out; // Arrest
    for (const line of oracleLines(inst, defOf)) {
      const m = /^([^:"]+):\s*(.+)$/.exec(line);
      if (!m || /^add\b/i.test(m[2]) || /^(equip|crew|cycling|ward)\b/i.test(m[1])) continue;
      const ab = { text: line, mana: '', tap: false, remove: null, life: 0, sacrifice: false, discard: 0, effect: m[2] };
      let ok = true;
      for (const part of m[1].split(/,\s*/)) {
        let c;
        if (/^(\{[^}]+\})+$/.test(part) && part !== '{T}') ab.mana += part;
        else if (part === '{T}') ab.tap = true;
        else if ((c = new RegExp(`^remove ${COUNT} ([\\w+/-]+) counters? from (.+)$`, 'i').exec(part)) && isSelf(c[3], inst)) ab.remove = { n: toNumber(c[1]), kind: c[2].toLowerCase() };
        else if ((c = /^pay (\d+) life$/i.exec(part))) ab.life = Number(c[1]);
        else if ((c = /^sacrifice (.+)$/i.exec(part)) && isSelf(c[1], inst)) ab.sacrifice = true;
        else if ((c = new RegExp(`^discard ${COUNT} cards?(?: from your hand)?$`, 'i').exec(part))) ab.discard = toNumber(c[1]);
        else { ok = false; break; }
      }
      if (ok) out.push(ab);
    }
    return out;
  }

  // ---------- regeneration, combat pumps, end step ----------

  // "Rats" → "rat", "Elves" → "elf", "creatures" → "creature".
  const singular = w => w.toLowerCase().replace(/ves$/, 'f').replace(/([^s])s$/, '$1');
  // Does this permanent have every word of a phrase like "Rat creature" in its type line?
  const typeWords = inst => front(inst.typeLine).toLowerCase().split(/[^a-z-]+/).filter(Boolean);
  const isA = (inst, phrase) => {
    const have = typeWords(inst);
    return phrase.toLowerCase().split(/\s+/).filter(Boolean).map(singular).every(w => have.includes(w));
  };
  const permanents = s => s.zones.battlefield.map(iid => s.cards[iid]).filter(c => c && !c.faceDown);

  // What other permanents give, all the time: keywords ("Goblins you control have haste", "Other
  // Rats you control have menace") and +X/+X ("Other Elves you control get +1/+1 and have
  // trample", "Pride Sovereign gets +1/+1 for each other Cat you control"). Stored on each
  // creature as granted and anthem (stats adds them); run after anything that changes a battlefield.
  function refreshGrants(game, defOf) {
    const kwList = text => text.toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(Boolean);
    for (const s of [game, game.bot && game.bot.s].filter(Boolean)) {
      const lords = [];
      const each = []; // "This gets +1/+1 for each other Cat you control"
      for (const src of permanents(s)) {
        for (const line of oracleLines(src, defOf)) {
          let m = /^(other )?(.+?) you control (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+?))?|have (.+?))\.?$/i.exec(line);
          if (m && m[2].includes(':')) continue; // an activated ability ("{2}: Elves you control get …"), not always on
          if (m) {
            const kws = kwList(m[5] || m[6] || '').filter(k => KEYWORDS.includes(k)); // "protection from Dogs" is left to you
            const pow = Number(m[3] || 0);
            const tou = Number(m[4] || 0);
            if (kws.length || pow || tou) lords.push({ src, other: !!m[1], what: m[2], kws, pow, tou });
            continue;
          }
          m = /^(.+?) gets ([+-]\d+)\/([+-]\d+) for each (other )?(.+?) you control\.?$/i.exec(line);
          if (m && isSelf(m[1], src)) each.push({ src, pow: Number(m[2]), tou: Number(m[3]), other: !!m[4], what: m[5] });
        }
      }
      const all = permanents(s);
      for (const c of creatures(s)) {
        const got = new Set();
        let pow = 0;
        let tou = 0;
        lords.forEach(l => {
          if ((l.other && l.src === c) || !isA(c, l.what)) return;
          l.kws.forEach(k => got.add(k));
          pow += l.pow;
          tou += l.tou;
        });
        each.filter(e => e.src === c).forEach(e => {
          const n = all.filter(p => !(e.other && p === c) && isA(p, e.what)).length;
          pow += e.pow * n;
          tou += e.tou * n;
        });
        if (got.size) c.granted = [...got];
        else delete c.granted;
        if (pow || tou) c.anthem = { pow, tou };
        else delete c.anthem;
      }
    }
  }

  // A regeneration shield saves a creature that would be destroyed: it's tapped instead and taken
  // out of combat. Opp pays for its own "…: Regenerate this" right then if it can (mana, discards,
  // life). theirs: the creature is Opp's. Returns true if it was saved.
  function regenerates(game, inst, defOf, theirs) {
    const s = theirs ? game.bot.s : game;
    if (!inst || inst.zone !== 'battlefield' || inst.faceDown) return false;
    if (!(inst.regen > 0) && theirs) {
      const ab = activatedAbilities(inst, defOf).find(a => {
        const m = /^regenerate (.+?)\.?$/i.exec(a.effect.trim());
        return m && isSelf(m[1], inst) && !a.sacrifice && !(a.tap && inst.tapped)
          && (!a.mana || affordable(s, a.mana, 0)) && s.zones.hand.length >= (a.discard || 0)
          && (!a.life || game.oppLife > a.life) && (!a.remove || (inst.counters[a.remove.kind] || 0) >= a.remove.n);
      });
      if (ab) {
        if (ab.mana) onOpp(game, () => G.autoPay(s, ab.mana));
        for (let i = 0; i < (ab.discard || 0); i++) G.move(s, worstInHand(s), 'graveyard');
        if (ab.life) game.oppLife -= ab.life;
        if (ab.remove) G.counter(s, inst.iid, ab.remove.kind, -ab.remove.n);
        G.log(s, `Opp activated ${inst.name}: ${ab.text}`);
        inst.regen = 1;
      }
    }
    if (!(inst.regen > 0)) return false;
    inst.regen--;
    if (!inst.regen) delete inst.regen;
    inst.tapped = true;
    G.log(s, `${theirs ? "Opp's " : ''}${inst.name} regenerated (tapped instead of destroyed).`);
    return true;
  }

  // An instant or sorcery like "Creatures you control get +2/+2 until end of turn", "Goblins you
  // control get +1/+0 and gain haste until end of turn" or "Creatures you control gain flying until
  // end of turn": pumps each one (and gives the keywords) until G.endOfTurn. Returns true if the spell
  // did that. s: the table of whoever cast it. Modal spells ("Choose one —") are left to runModes.
  function spellPump(s, inst, defOf) {
    if (!inst || inst.faceDown || !/\b(instant|sorcery)\b/i.test(front(inst.typeLine)) || spellModes(inst, defOf)) return false;
    let done = false;
    for (const line of oracleLines(inst, defOf)) {
      for (const sentence of line.split(/(?<=\.)\s+/)) if (pumpSentence(s, inst, sentence)) done = true;
    }
    return done;
  }

  // One "… you control get +X/+X and gain …" or "… you control gain … until end of turn" sentence.
  function pumpSentence(s, inst, sentence) {
    const p = /^(.+?) you control (?:get ([+-]\d+)\/([+-]\d+)(?: and gain (.+?))?|gain (.+?)) until end of turn\.?$/i.exec(sentence.trim());
    if (!p || /\btarget\b/i.test(p[1])) return false;
    const pow = Number(p[2] || 0);
    const tou = Number(p[3] || 0);
    const gain = p[4] || p[5];
    const kw = gain ? gain.toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(k => KEYWORDS.includes(k)) : [];
    if (!pow && !tou && !kw.length) return false;
    const who = permanents(s).filter(c => G.isCreature(c) && isA(c, p[1]));
    who.forEach(c => {
      inst.undoPump = inst.undoPump || {}; // for a counterspell (G.counterLast)
      if (!(c.iid in inst.undoPump)) inst.undoPump[c.iid] = c.pump ? { ...c.pump } : null;
      c.pump = { ...c.pump, pow: (c.pump ? c.pump.pow : 0) + pow, tou: (c.pump ? c.pump.tou : 0) + tou };
      if (kw.length) c.pump.kw = [...new Set([...(c.pump.kw || []), ...kw])];
    });
    const pt = pow || tou ? `get ${p[2]}/${p[3]}${kw.length ? ' and ' : ''}` : '';
    G.log(s, `${inst.name}: ${p[1]} you control ${pt}${kw.length ? `gain ${kw.join(', ')}` : ''} until end of turn${who.length ? ` (${who.length})` : ' (none to pump)'}.`);
    return true;
  }

  // A modal instant or sorcery: "Choose one. If you control a commander as you cast this spell, you
  // may choose both instead." then a "•" line per mode. Returns { modes, pick, commanderPick }: the
  // modes, and how many you may choose (commanderPick: with a commander on the battlefield). Or null.
  function spellModes(inst, defOf) {
    if (!inst || inst.faceDown || !/\b(instant|sorcery)\b/i.test(front(inst.typeLine))) return null;
    const lines = oracleLines(inst, defOf);
    const head = lines.map(l => /^choose (one or both|one or more|any number|one|two|three)\b/i.exec(l)).find(Boolean);
    const modes = lines.filter(l => /^•/.test(l)).map(l => l.replace(/^•\s*/, ''));
    if (!head || modes.length < 2) return null;
    const word = head[1].toLowerCase();
    const pick = /both|more|any/.test(word) ? modes.length : Math.min(modes.length, toNumber(word));
    const cmd = lines.some(l => /if you control a commander as you cast this spell, you may choose \w+ instead/i.test(l));
    return { modes, pick, commanderPick: cmd ? modes.length : pick };
  }

  // Does the chosen modes (indexes into spellModes' list) on table s. Returns the ones it couldn't
  // do, which are logged for you to do by hand.
  function runModes(s, inst, defOf, chosen) {
    const info = spellModes(inst, defOf);
    const left = [];
    for (const i of chosen) {
      const text = info && info.modes[i];
      if (!text) continue;
      const done = text.split(/(?<=\.)\s+/).map(sentence => pumpSentence(s, inst, sentence)).some(Boolean);
      if (!done) left.push(text);
    }
    if (left.length) G.log(s, `${inst.name}: do by hand: ${left.join(' ')}`);
    return left;
  }

  // "Whenever this attacks (or blocks), other Rats you control get +X/+X until end of turn, where X
  // is the number of Rats you control" and "…, it gets +2/+0 until end of turn." The pump lasts
  // until G.endOfTurn. Also "…, create two 1/1 white Cat creature tokens with lifelink that are
  // tapped and attacking." and Brimaz's "…that's attacking" / "…that's blocking that creature."
  // s: the table the creature is on. event: 'attacks' or 'blocks'. Returns the iids of tokens that
  // entered attacking (or blocking the same attacker), for the caller to add to the combat.
  function combatTrigger(s, inst, event, defOf) {
    const attacking = [];
    if (!inst || inst.faceDown) return attacking;
    for (const line of oracleLines(inst, defOf)) {
      const m = /^whenever (.+?) (enters(?: the battlefield)? or attacks|attacks or blocks|attacks|blocks)(?: a creature)?, (.+)$/i.exec(line);
      if (!m || !isSelf(m[1], inst) || !m[2].toLowerCase().split(' or ').includes(event)) continue;
      if (counterEach(s, inst, m[3], event)) continue;
      const t = triggerTokens(s, inst, m[3].trim(), event);
      if (t) { attacking.push(...t); continue; }
      const p = /^(.+?) gets? ([+-](?:\d+|x))\/([+-](?:\d+|x)) until end of turn(?:, where x is the number of (.+?) you control)?\.?$/i.exec(m[3].trim());
      if (!p || (/x/i.test(p[2] + p[3]) && !p[4])) continue;
      const x = p[4] ? permanents(s).filter(c => isA(c, p[4])).length : 0;
      const amount = v => (/x/i.test(v) ? (v[0] === '-' ? -x : x) : Number(v));
      let who;
      if (isSelf(p[1], inst)) who = [inst];
      else {
        const g = /^(other )?(.+?) you control$/i.exec(p[1]);
        if (!g) continue;
        who = permanents(s).filter(c => G.isCreature(c) && isA(c, g[2]) && !(g[1] && c === inst));
      }
      who.forEach(c => { c.pump = { ...c.pump, pow: (c.pump ? c.pump.pow : 0) + amount(p[2]), tou: (c.pump ? c.pump.tou : 0) + amount(p[3]) }; });
      G.log(s, `${inst.name} ${event === 'blocks' ? 'blocks' : 'attacks'}: ${p[1]} get${who.length === 1 && who[0] === inst ? 's' : ''} ${p[2]}/${p[3]}${p[4] ? ` (X = ${x})` : ''} until end of turn${who.length ? '' : ' (none to pump)'}.`);
    }
    return attacking;
  }

  // Your auras on Opp's creatures (aura.enchanting = { pid: 'bot', iid, name, bonus }): the aura
  // stays on your side, and Opp's creature gets its bonus (Arrest: can't attack or block) under the
  // key 'you:<aura iid>'. Once that creature is gone the aura goes to your graveyard.
  // Run after anything that changes either battlefield.
  function syncAuras(game) {
    const s = game.bot && game.bot.s;
    if (s) {
      for (const c of Object.values(s.cards)) {
        if (!c.boosts) continue;
        Object.keys(c.boosts).filter(k => k.startsWith('you:')).forEach(k => delete c.boosts[k]);
        if (!Object.keys(c.boosts).length) delete c.boosts;
      }
    }
    for (const iid of [...game.zones.battlefield]) {
      const a = game.cards[iid];
      if (!a.enchanting || a.enchanting.pid !== 'bot') continue;
      const host = s && s.cards[a.enchanting.iid];
      if (!host || host.zone !== 'battlefield') {
        const was = a.enchanting.name;
        G.move(game, iid, 'graveyard');
        G.log(game, `${a.name} went to your graveyard: Opp's ${was} left the battlefield.`);
        continue;
      }
      host.boosts = { ...host.boosts, ['you:' + iid]: a.enchanting.bonus };
    }
  }

  // "Put a +1/+1 counter on each other creature you control. Those creatures gain trample until end
  // of turn." (Spider-Man, Miles Morales), or just the counters. s: the table inst is on. Sentences
  // after the counters that it can't do are logged for you to do by hand. Returns true if it did the counters.
  function counterEach(s, inst, text, event) {
    const [first, ...rest] = String(text).trim().split(/(?<=\.)\s+/);
    const m = new RegExp(`^put ${COUNT} ([\\w+/-]+) counters? on each (other )?(.+?) you control\\.?$`, 'i').exec(first);
    if (!m || !toNumber(m[1])) return false;
    const plain = /^creatures?$/i.test(m[4]); // face-down cards are creatures too
    const who = s.zones.battlefield.map(iid => s.cards[iid])
      .filter(c => c && (c.faceDown ? plain : G.isCreature(c) && isA(c, m[4])) && !(m[3] && c === inst));
    const kind = m[2].toLowerCase();
    who.forEach(c => G.counter(s, c.iid, kind, toNumber(m[1]), { effect: true }));
    const left = [];
    let kw = [];
    for (const sentence of rest) {
      const g = /^(?:those creatures|they|each of them) gain (.+?) until end of turn\.?$/i.exec(sentence);
      const got = g ? g[1].toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(k => KEYWORDS.includes(k)) : [];
      if (!got.length) { left.push(sentence); continue; }
      kw = [...new Set([...kw, ...got])];
      who.forEach(c => { c.pump = { pow: 0, tou: 0, ...c.pump, kw: [...new Set([...((c.pump && c.pump.kw) || []), ...got])] }; });
    }
    const verb = event === 'attacks' ? 'attacks' : event === 'blocks' ? 'blocks' : 'entered';
    G.log(s, `${inst.name} ${verb}: ${who.length ? `${who.length} creature${who.length === 1 ? '' : 's'} got` : 'no creatures to get'} ${m[1]} ${kind} counter${toNumber(m[1]) === 1 ? '' : 's'}${kw.length && who.length ? ` and ${kw.join(', ')} until end of turn` : ''}.${left.length ? ` Do by hand: ${left.join(' ')}` : ''}`);
    return true;
  }

  // "When(ever) this enters (or attacks), put a +1/+1 counter on each other creature you control…"
  // on either table. Other enter effects (life, drawing) are done by game.js.
  function enterTrigger(s, inst, defOf) {
    if (!inst || inst.faceDown) return;
    for (const line of oracleLines(inst, defOf)) {
      const m = /^when(?:ever)? (.+?) enters(?: the battlefield)?(?: or [^,]+)?, (.+)$/i.exec(line);
      if (m && isSelf(m[1], inst)) counterEach(s, inst, m[2], 'enters');
    }
  }

  // "At the beginning of combat on each opponent's turn, tap target creature that player controls"
  // (Sentinel of the Eternal Watch): the permanents on table s that have it.
  const COMBAT_TAP = /^at the beginning of combat on each opponent's turn, tap (?:up to one )?target creature (?:that player controls|an opponent controls)\.?$/i;
  const combatTappers = (s, defOf) => permanents(s).filter(c => oracleLines(c, defOf).some(l => COMBAT_TAP.test(l)));

  // Each tapper taps the best creature on the other table that could attack this turn. pool: [{ inst, st }]
  // of that table's creatures; sickOf(inst, st): it arrived this turn without haste. Returns [[tapper, tapped]].
  function combatTaps(tappers, pool, sickOf) {
    const out = [];
    for (const t of tappers) {
      const pick = pool.filter(x => !x.inst.tapped && !sickOf(x.inst, x.st) && !noAttack(x.st)).sort((a, b) => value(b.st) - value(a.st))[0];
      if (!pick) continue;
      pick.inst.tapped = true;
      pick.inst.tappedFor = null;
      out.push([t, pick.inst]);
    }
    return out;
  }

  // Opp's tappers at the beginning of combat on your turn, once a turn (when you open the Attack screen).
  // Returns a message for each creature of yours it tapped.
  function oppCombatTaps(game, defOf) {
    const s = game.bot.s;
    if (game.combatTapTurn === game.turn) return [];
    game.combatTapTurn = game.turn;
    return combatTaps(combatTappers(s, defOf), yourCreatures(game, defOf), (c, st) => c.enteredTurn === game.turn && !st.kw.has('haste'))
      .map(([t, c]) => { const msg = `Opp's ${t.name} tapped your ${c.name} at the beginning of combat.`; G.log(s, msg); return msg; });
  }

  // Runs "whenever this blocks" triggers for blocks { attackerIid: [blockerIid, …] } (a single iid
  // works too), before any damage. Tokens made "blocking that creature" are added to that attacker's
  // blockers. s: the blockers' table. Returns the blocks, with every list an array.
  function blockTriggers(s, blocks, defOf) {
    for (const [a, list] of Object.entries(blocks)) {
      const ids = [].concat(list || []);
      blocks[a] = [...ids];
      ids.forEach(id => blocks[a].push(...combatTrigger(s, s.cards[id], 'blocks', defOf)));
    }
    return blocks;
  }

  // "create two 1/1 white Cat creature tokens with lifelink that are tapped and attacking", "create
  // a 1/1 … token with vigilance that's attacking", "… that's blocking that creature", or just
  // "create …". Returns the iids of tokens that join the combat ([] if none do), or null if the
  // text isn't a token like that.
  const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: null };
  function triggerTokens(s, inst, text, event) {
    const m = /^create (\w+) (\d+)\/(\d+) ([a-z ,'-]+?) creature tokens?(?: with ([^.]+?))?(?: that(?: are|'s| is) (?:(tapped and )?(attacking)|(blocking) that creature))?\.?$/i.exec(text);
    const made = m && toNumber(m[1]);
    if (!made) return null;
    const { n, by } = G.tokenCount(s, made); // Doubling Season, Parallel Lives…
    const words = m[4].replace(/,/g, ' ').split(/\s+/).filter(w => w && w.toLowerCase() !== 'and');
    const colors = words.filter(w => w.toLowerCase() in COLOR_WORDS).map(w => COLOR_WORDS[w.toLowerCase()]).filter(Boolean);
    const type = words.filter(w => !(w.toLowerCase() in COLOR_WORDS)).join(' ') || 'Creature';
    const kw = (m[5] || '').toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).filter(k => KEYWORDS.includes(k));
    const abilities = kw.map(k => k[0].toUpperCase() + k.slice(1)).join(', ');
    const joins = (!!m[7] && event === 'attacks') || (!!m[8] && event === 'blocks');
    const tapped = joins && !!m[6];
    const out = [];
    for (let i = 0; i < n; i++) {
      const tok = G.createToken(s, { custom: true, name: type, typeLine: `Token Creature — ${type}`, pt: `${m[2]}/${m[3]}`, text: abilities }, { quiet: true });
      if (inst.bot) tok.bot = { cost: '', cmc: 0, power: m[2], toughness: m[3], kw, colors, spell: null }; // Opp's: the facts botStats reads
      if (tapped) { tok.tapped = true; tok.tappedFor = null; }
      if (joins) out.push(tok.iid);
    }
    const how = !joins ? '' : event === 'blocks' ? ', blocking the same creature' : tapped ? ', tapped and attacking' : ', attacking';
    G.log(s, `${inst.name} ${event}: created ${n} ${m[2]}/${m[3]} ${type} token${n === 1 ? '' : 's'}${kw.length ? ` with ${kw.join(', ')}` : ''}${how}${by.length ? ` (doubled by ${by.join(', ')})` : ''}.`);
    return out;
  }

  // "At the beginning of your end step, (you may) mill four cards. If you do, return up to two Rat
  // creature cards from your graveyard to your hand." Returns [{ inst, mill, up, what }].
  function endStepTriggers(s, defOf) {
    const out = [];
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        const m = new RegExp(`^at the beginning of your end step, (?:you may )?mill ${COUNT} cards?\\. if you do, return up to ${COUNT} (.+?) cards? from your graveyard to your hand\\.?$`, 'i').exec(line);
        if (m) out.push({ inst, mill: toNumber(m[1]), up: toNumber(m[2]), what: m[3] });
      }
    }
    return out;
  }
  // Graveyard cards one of those triggers can return.
  const returnable = (s, t) => s.zones.graveyard.filter(iid => isA(s.cards[iid], t.what));

  // The card Opp would most like to get rid of: lands when it has plenty, spells it can't use, big costs.
  function worstInHand(s) {
    const lands = s.zones.battlefield.filter(iid => G.isLand(s.cards[iid])).length;
    const junk = c => (G.isLand(c) ? (lands >= 6 ? 50 : -50) : (c.bot ? c.bot.cmc : 0)) + (/\b(instant|sorcery)\b/i.test(front(c.typeLine)) && !(c.bot && c.bot.spell) ? 20 : 0);
    return [...s.zones.hand].sort((x, y) => junk(s.cards[y]) - junk(s.cards[x]))[0];
  }

  // Opp discards n cards (its worst ones, or at random). why: the card that made it.
  function oppDiscards(game, n, random, why) {
    const s = game.bot.s;
    const gone = [];
    for (let i = 0; i < n && s.zones.hand.length; i++) {
      const iid = random ? s.zones.hand[G.randomInt(s.zones.hand.length)] : worstInHand(s);
      gone.push(s.cards[iid].name);
      G.move(s, iid, 'graveyard');
    }
    if (gone.length) G.log(game, `${why}: Opp discarded ${andList(gone)}.`);
  }

  // Which of Opp's creatures attack. Ones that a blocker of yours could kill without dying stay
  // home, unless the whole team would be lethal. Enough stay home to survive your swing back.
  function chooseAttackers(game, defOf) {
    const s = game.bot.s;
    const you = yourCreatures(game, defOf);
    const blockers = you.filter(c => !c.inst.tapped).map(c => c.st);
    const ready = creatures(s).map(inst => ({ inst, st: botStats(inst) }))
      .filter(c => !c.inst.tapped && c.st.pow > 0 && !noAttack(c.st) && !sick(s, c.inst, c.st));
    if (!ready.length) return [];

    // Everyone attacks if that's lethal even after your blockers each stop the biggest one they can.
    const byPower = [...ready].sort((a, b) => b.st.pow - a.st.pow);
    let through = 0;
    const left = [...blockers];
    for (const a of byPower) {
      const can = left.filter(b => canBlock(b, a.st, game));
      const need = a.st.kw.has('menace') ? 2 : 1;
      if (can.length >= need) can.slice(0, need).forEach(b => left.splice(left.indexOf(b), 1));
      else through += toPlayer(a.st);
    }
    if (through >= game.life) return ready.map(c => c.inst.iid);

    // Safe to attack: no block you could make kills it without losing as much. With menace, only pairs can block.
    const safeFrom = (a, group) => {
      const r = combat(a.st, group);
      const lost = group.filter((b, i) => r.b[i].dead).reduce((n, b) => n + value(b), 0);
      return !r.a.dead || lost >= value(a.st);
    };
    let attackers = ready.filter(a => {
      const can = blockers.filter(b => canBlock(b, a.st, game));
      if (!a.st.kw.has('menace')) return can.every(b => safeFrom(a, [b]));
      return can.every((x, i) => can.slice(i + 1).every(y => safeFrom(a, [x, y])));
    });

    // Keep blockers home if your creatures could swing back for lethal.
    const yourPower = you.map(c => c.st.pow).sort((a, b) => b - a);
    const home = () => creatures(s, c => !c.tapped && (!attackers.some(a => a.inst === c) || botStats(c).kw.has('vigilance'))).length;
    const danger = () => yourPower.slice(home()).reduce((n, p) => n + Math.max(0, p), 0) >= game.oppLife;
    while (danger()) {
      const goHome = attackers.filter(a => !a.st.kw.has('vigilance')).sort((a, b) => b.st.tou - a.st.tou)[0];
      if (!goHome) break;
      attackers = attackers.filter(a => a !== goHome);
    }
    return attackers.map(c => c.inst.iid);
  }

  // Which of your planeswalkers Opp goes after: unless the whole attack would kill you, the
  // smallest attacker that can finish each one (lowest loyalty first). Returns { attackerIid: yourPlaneswalkerIid }.
  function chooseTargets(game, attackers, defOf) {
    const s = game.bot.s;
    const targets = {};
    const list = attackers.map(iid => ({ iid, st: botStats(s.cards[iid]) }));
    if (list.reduce((n, a) => n + toPlayer(a.st), 0) >= game.life) return targets;
    const walkers = game.zones.battlefield.map(iid => game.cards[iid]).filter(isPlaneswalker)
      .map(inst => ({ inst, loyalty: loyaltyOf(inst, defOf(inst.id)) })).sort((a, b) => a.loyalty - b.loyalty);
    for (const w of walkers) {
      const pick = list.filter(a => !targets[a.iid] && toPlayer(a.st) >= Math.max(1, w.loyalty)).sort((a, b) => a.st.pow - b.st.pow)[0];
      if (pick) targets[pick.iid] = w.inst.iid;
    }
    return targets;
  }

  // Opp's turn up to attacking: untap, draw, a land, spells. Returns the creatures that attack
  // (also kept in game.bot.pending until you've blocked) and what Opp did, for a message.
  function beginTurn(game, defOf) {
    const bot = game.bot;
    const s = bot.s;
    const notes = [];
    G.endCrew(game); // your turn is over: your Vehicles stop being creatures
    G.endOfTurn(game); // and "until end of turn" pumps and regeneration shields wear off
    G.endOfTurn(s);
    if (!bot.started) {
      bot.started = true;
      G.log(s, '— Turn 1 —');
    } else {
      const empty = !s.zones.library.length;
      G.nextTurn(s);
      if (empty) notes.push("couldn't draw from its empty library, so it loses");
    }
    s.opponents = 1;
    const landsBefore = s.zones.battlefield.length;
    onOpp(game, () => playLand(s));
    if (s.zones.battlefield.length > landsBefore) notes.push(`played ${s.cards[s.zones.battlefield[s.zones.battlefield.length - 1]].name}`);
    refreshGrants(game, defOf);
    for (let i = 0; i < 15 && castOne(game, defOf, notes); i++) refreshGrants(game, defOf);
    // Your Sentinel of the Eternal Watch: at the beginning of Opp's combat you pick what it taps
    // (tapChoices lists them), then beginCombat carries on.
    if (combatTappers(game, defOf).length && creatures(s).length) {
      bot.tapChoice = { notes };
      return { attackers: [], notes, tapChoice: true };
    }
    return beginCombat(game, defOf, {}, notes);
  }

  // What your tappers can tap at the beginning of Opp's combat: { tappers, targets: [{ inst, st }],
  // best: the one most worth tapping (its best creature that could attack) }.
  function tapChoices(game, defOf) {
    const s = game.bot.s;
    const targets = creatures(s).map(inst => ({ inst, st: botStats(inst) }));
    const best = targets.filter(x => !x.inst.tapped && !sick(s, x.inst, x.st) && !noAttack(x.st)).sort((a, b) => value(b.st) - value(a.st))[0];
    return { tappers: combatTappers(game, defOf), targets, best: best ? best.inst : null };
  }

  // The rest of Opp's turn from the beginning of combat. taps: { yourTapperIid: oppCreatureIid }.
  function beginCombat(game, defOf, taps, notes = []) {
    const bot = game.bot;
    const s = bot.s;
    delete bot.tapChoice;
    for (const [tIid, cIid] of Object.entries(taps || {})) {
      const t = game.cards[tIid];
      const c = s.cards[cIid];
      if (!t || !c || c.zone !== 'battlefield') continue;
      c.tapped = true;
      c.tappedFor = null;
      G.log(game, `Your ${t.name} tapped Opp's ${c.name} at the beginning of combat.`);
      notes.push(`had its ${c.name} tapped by your ${t.name}`);
    }
    const attackers = chooseAttackers(game, defOf);
    attackers.forEach(iid => { if (!botStats(s.cards[iid]).kw.has('vigilance')) s.cards[iid].tapped = true; });
    [...attackers].forEach(iid => attackers.push(...combatTrigger(s, s.cards[iid], 'attacks', defOf))); // tokens that enter attacking join in
    bot.pending = attackers.length ? { attackers, targets: chooseTargets(game, attackers, defOf) } : null;
    return { attackers, notes };
  }

  // "A", "A and B", "A, B and C"
  const andList = list => (list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

  // "is blocked by your Bear and your Elf: Goblin dies, your Bear dies" for the combat log.
  // own(name) words a blocker's name ("your Bear"), mine(name) the attacker's.
  function blockText(aName, bNames, r, own, mine) {
    const deaths = [r.a.dead ? `${mine(aName)} dies` : '', ...bNames.map((n, i) => (r.b[i].dead ? `${own(n)} dies` : ''))].filter(Boolean);
    return `${andList(bNames.map(own))}: ${deaths.join(', ') || 'nothing dies'}`;
  }

  // Life from lifelink in one fight: { attacker, blockers }.
  const lifelinkGain = (ast, bsts, r) => ({
    attacker: ast.kw.has('lifelink') ? r.a.dealt : 0,
    blockers: bsts.reduce((n, st, i) => n + (st.kw.has('lifelink') ? r.b[i].dealt : 0), 0),
  });

  // Opp's attack after you've picked blockers. blocks: { attackerIid: [yourBlockerIid, …] } (a
  // single iid works too). Returns a short summary for a message.
  function resolveOppAttack(game, blocks, defOf) {
    const s = game.bot.s;
    const pending = game.bot.pending;
    game.bot.pending = null;
    if (!pending) return '';
    refreshGrants(game, defOf);
    // "Whenever this blocks" triggers happen before any damage.
    blockTriggers(game, blocks, defOf);
    let dmg = 0;
    const oppHits = []; // Opp's creatures that dealt combat damage to you, for oppCombatDamage
    const lines = [];
    const own = n => `your ${n}`;
    const theirs = n => n;
    const oppDies = a => { if (!regenerates(game, a, defOf, true)) moveOpps(s, a); };
    const yoursDies = b => { if (!regenerates(game, b, defOf, false)) moveYours(game, b, 'graveyard'); };
    for (const iid of pending.attackers) {
      const a = s.cards[iid];
      if (!a || a.zone !== 'battlefield') continue;
      const ast = botStats(a);
      const bl = [].concat(blocks[iid] || []).map(id => game.cards[id]).filter(b => b && b.zone === 'battlefield');
      const bsts = bl.map(b => stats(b, defOf(b.id)));
      const r = combat(ast, bsts);
      const hit = r.player;
      const gain = lifelinkGain(ast, bsts, r);
      game.oppLife += gain.attacker;
      game.life += gain.blockers;
      const ll = gain.attacker ? ` (Opp gains ${gain.attacker} from lifelink)` : '';
      const pwIid = (pending.targets || {})[iid];
      const pw = pwIid && game.cards[pwIid] && game.cards[pwIid].zone === 'battlefield' ? game.cards[pwIid] : null;
      if (pwIid) { // went after one of your planeswalkers (no damage if it's already gone)
        const pwName = pw ? pw.name : (game.cards[pwIid] || {}).name || 'planeswalker';
        let what = bl.length ? `${a.name} is blocked by ${blockText(a.name, bl.map(b => b.name), r, own, theirs)}` : `${a.name} attacks your ${pwName}`;
        if (hit && pw) what += `${bl.length ? ',' : ':'} ${hit} damage to your ${pw.name}${damagePlaneswalker(pw, defOf(pw.id), hit) ? ', which dies' : ` (loyalty ${pw.counters.loyalty})`}`;
        lines.push(what + ll);
        if (r.a.dead) oppDies(a);
        bl.forEach((b, i) => { if (r.b[i].dead) yoursDies(b); });
        if (pw && (pw.counters || {}).loyalty <= 0) moveYours(game, pw, 'graveyard');
        continue;
      }
      if (hit) {
        dmg += hit;
        oppHits.push({ inst: a, st: ast, card: a.bot });
        if (a.commander) {
          const key = `Opp|${a.name}`;
          game.cmdDamage = game.cmdDamage || {};
          game.cmdDamage[key] = (game.cmdDamage[key] || 0) + hit;
        }
      }
      if (!bl.length) { lines.push(`${a.name} hits you for ${hit}${ll}`); continue; }
      lines.push(`${a.name} is blocked by ${blockText(a.name, bl.map(b => b.name), r, own, theirs)}${hit ? `, ${hit} tramples over` : ''}${ll}`);
      if (r.a.dead) oppDies(a);
      bl.forEach((b, i) => { if (r.b[i].dead) yoursDies(b); });
    }
    game.life -= dmg;
    const msg = `Attacked: ${lines.join('; ')}.${dmg ? ` You took ${dmg} (now ${game.life}).` : ''}`;
    dealtDamage(game, dmg, defOf);
    G.log(s, msg); // shown in your log as Opp's line
    oppCombatDamage(game, oppHits, defOf);
    return msg;
  }

  // Opp's turn after combat: anything it can still cast, then discard down to 7 and empty its mana.
  function endTurn(game, defOf) {
    const s = game.bot.s;
    const notes = [];
    for (let i = 0; i < 15 && castOne(game, defOf, notes); i++) refreshGrants(game, defOf);
    // End step: "mill four, then return up to two Rat creature cards" when its library can spare them.
    for (const t of endStepTriggers(s, defOf)) {
      if (s.zones.library.length < t.mill + 5) continue;
      G.mill(s, t.mill);
      const back = returnable(s, t).sort((x, y) => (s.cards[y].bot ? s.cards[y].bot.cmc : 0) - (s.cards[x].bot ? s.cards[x].bot.cmc : 0)).slice(0, t.up);
      back.forEach(iid => G.move(s, iid, 'hand'));
      const names = andList(back.map(iid => s.cards[iid].name));
      G.log(s, `${t.inst.name}: Opp milled ${t.mill}${back.length ? ` and returned ${names} to its hand` : ''}.`);
      notes.push(`milled ${t.mill} with ${t.inst.name}${back.length ? ` and got back ${names}` : ''}`);
    }
    while (s.zones.hand.length > 7) G.move(s, worstInHand(s), 'graveyard');
    G.MANA.forEach(k => { s.mana[k] = 0; });
    G.endOfTurn(s);
    G.endOfTurn(game);
    G.log(s, 'Opp ended its turn.');
    return notes;
  }

  // Opp blocks your attack and the damage is done. attacks: [{ iid, pw }], your creatures that
  // attack and, for ones going after a planeswalker, which of Opp's. Returns a short summary for a message.
  function resolveYourAttack(game, attacks, defOf) {
    const s = game.bot.s;
    refreshGrants(game, defOf);
    // "Whenever this attacks" triggers; tokens that enter attacking go after the same player or planeswalker.
    const joined = [];
    attacks.forEach(x => {
      const a = typeof x === 'string' ? { iid: x } : x;
      const inst = game.cards[a.iid];
      if (inst && inst.zone === 'battlefield') combatTrigger(game, inst, 'attacks', defOf).forEach(iid => joined.push({ iid, pw: a.pw }));
    });
    attacks = attacks.concat(joined);
    const attackers = attacks.map(x => (typeof x === 'string' ? { iid: x } : x))
      .map(x => ({ inst: game.cards[x.iid], pw: x.pw && s.cards[x.pw] && s.cards[x.pw].zone === 'battlefield' ? s.cards[x.pw] : null }))
      .filter(a => a.inst && a.inst.zone === 'battlefield')
      .map(a => Object.assign(a, { st: stats(a.inst, defOf(a.inst.id)) }))
      .sort((a, b) => b.st.pow - a.st.pow);
    const free = creatures(s, c => !c.tapped).map(inst => ({ inst, st: botStats(inst) }));
    const blocks = new Map(); // your attacker -> Opp's blockers
    const take = (a, picks) => { if (picks && picks.length) { blocks.set(a, picks); picks.forEach(p => free.splice(free.indexOf(p), 1)); } };
    const byValue = list => [...list].sort((x, y) => value(x.st) - value(y.st));
    const lostIn = (group, r) => group.filter((b, i) => r.b[i].dead).reduce((n, b) => n + value(b.st), 0);
    for (const a of attackers) {
      const can = byValue(free.filter(b => canBlock(b.st, a.st, s)));
      if (a.st.kw.has('menace')) {
        // Only two together: the pair that kills it losing the least, if that's worth it.
        let best = null;
        can.forEach((x, i) => can.slice(i + 1).forEach(y => {
          const r = combat(a.st, [x.st, y.st]);
          const lost = lostIn([x, y], r);
          if (r.a.dead && lost <= value(a.st) && (!best || lost < best.lost)) best = { pair: [x, y], lost };
        }));
        if (best) take(a, best.pair);
        continue;
      }
      const tries = can.map(b => ({ b, r: fight(a.st, b.st) }));
      const good = tries.filter(x => x.r.a.dead && !x.r.b.dead).map(x => x.b);
      const trade = tries.filter(x => x.r.a.dead && x.r.b.dead && value(a.st) >= value(x.b.st)).map(x => x.b);
      const wall = tries.filter(x => !x.r.b.dead).map(x => x.b);
      const pick = byValue(good)[0] || byValue(trade)[0] || byValue(wall)[0];
      if (pick) take(a, [pick]);
    }
    // Chump block when the rest would be lethal (two chumps for menace).
    const incoming = () => attackers.filter(a => !a.pw && !blocks.has(a)).reduce((n, a) => n + toPlayer(a.st), 0);
    for (const a of attackers) {
      if (incoming() < game.oppLife) break;
      if (blocks.has(a)) continue;
      const picks = byValue(free.filter(b => canBlock(b.st, a.st, s))).slice(0, a.st.kw.has('menace') ? 2 : 1);
      if (legalBlock(a.st, picks.length)) take(a, picks);
    }

    // Opp's "whenever this blocks" triggers, then everyone's stats again with the pumps.
    // Tokens made "blocking that creature" (Brimaz) block the same attacker.
    for (const list of blocks.values()) [...list].forEach(b => combatTrigger(s, b.inst, 'blocks', defOf).forEach(iid => list.push({ inst: s.cards[iid], st: botStats(s.cards[iid]) })));
    if (blocks.size) {
      attackers.forEach(a => { a.st = stats(a.inst, defOf(a.inst.id)); });
      [...blocks.values()].flat().forEach(b => { b.st = botStats(b.inst); });
    }
    const oppDies = b => { if (!regenerates(game, b, defOf, true)) moveOpps(s, b); };
    const yoursDies = a => { if (!regenerates(game, a, defOf, false)) moveYours(game, a, 'graveyard'); };
    let dmg = 0;
    const lines = [];
    const own = n => `your ${n}`;
    const theirs = n => n;
    const hits = []; // your creatures that dealt combat damage to Opp, for "whenever … deals combat damage" cards
    for (const a of attackers) {
      if (!a.st.kw.has('vigilance')) a.inst.tapped = true;
      a.inst.attackedTurn = game.turn; // one attack per creature per turn, even if it gets untapped
      const bl = blocks.get(a) || [];
      const r = combat(a.st, bl.map(b => b.st));
      const hit = r.player;
      const gain = lifelinkGain(a.st, bl.map(b => b.st), r);
      game.life += gain.attacker;
      game.oppLife += gain.blockers;
      const ll = gain.attacker ? ` (you gain ${gain.attacker} from lifelink)` : '';
      const blockedBy = () => `Opp blocks ${a.inst.name} with ${blockText(a.inst.name, bl.map(b => b.inst.name), r, theirs, own)}`;
      if (a.pw) {
        let what = bl.length ? blockedBy() : `${a.inst.name} attacks ${a.pw.name}`;
        const alreadyDead = a.pw.zone !== 'battlefield';
        if (hit && !alreadyDead) what += `${bl.length ? ',' : ':'} ${hit} damage to ${a.pw.name}${damagePlaneswalker(a.pw, a.pw.bot, hit) ? ', which dies' : ` (loyalty ${a.pw.counters.loyalty})`}`;
        lines.push(what + ll);
        bl.forEach((b, i) => { if (r.b[i].dead) oppDies(b.inst); });
        if (r.a.dead) yoursDies(a.inst);
        if (!alreadyDead && (a.pw.counters || {}).loyalty <= 0) moveOpps(s, a.pw);
        continue;
      }
      dmg += hit;
      if (hit) hits.push({ inst: a.inst, st: a.st, card: defOf(a.inst.id) });
      if (hit && a.inst.commander) {
        game.cmdDealt = game.cmdDealt || {};
        game.cmdDealt[a.inst.name] = (game.cmdDealt[a.inst.name] || 0) + hit;
      }
      if (!bl.length) { lines.push(`${a.inst.name} hits Opp for ${hit}${ll}`); continue; }
      lines.push(`${blockedBy()}${hit ? `, ${hit} tramples over` : ''}${ll}`);
      bl.forEach((b, i) => { if (r.b[i].dead) oppDies(b.inst); });
      if (r.a.dead) yoursDies(a.inst);
    }
    game.oppLife -= dmg;
    const msg = `You attacked: ${lines.join('; ')}.${dmg ? ` Opp took ${dmg} (now ${game.oppLife}).` : ''}`;
    G.log(game, msg);
    combatDamage(game, hits.filter(h => h.inst.zone === 'battlefield' || h.inst.zone === 'graveyard'), defOf, { hitOpps: n => { game.oppLife -= n; } });
    return msg;
  }

  return { KEYWORDS, keywordCounter, blockTriggers, combatTappers, oppCombatTaps, tapChoices, beginCombat, spellModes, runModes, refreshGrants, spellPump, regenerates, combatTrigger, endStepTriggers, returnable, oppDiscards, colorsOf, create, beginTurn, resolveOppAttack, endTurn, resolveYourAttack, stats, keywords, attachBonus, equipCost, runEffect, dealtDamage, landEntered, creatureEntered, enterTrigger, died, noAttack, silenced, syncAuras, combatDamage, destroyable, activatedAbilities, crewOf, spellEffect, fight, combat, canBlock, legalBlock, toPlayer, lifelinkGain, blockText,
    yourCreatures, botStats, sick, isPlaneswalker, loyaltyOf, damagePlaneswalker };
})();

if (typeof module !== 'undefined') module.exports = Bot;
