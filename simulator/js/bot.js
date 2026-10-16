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
    'protection from each color',
    // Done in combat, on death or when you cast a spell (see "more abilities" below):
    'prowess', 'exalted', 'battle cry', 'infect', 'wither', 'toxic', 'annihilator', 'flanking', 'bushido', 'rampage',
    'undying', 'persist', 'afterlife', 'decayed', 'cascade', 'storm', 'unblockable'];
  // Keywords with a number ("Toxic 2", "Annihilator 2", "Bushido 1"): stats keeps the numbers in st.n.
  const NUMBERED = ['toxic', 'annihilator', 'bushido', 'rampage', 'afterlife'];

  // Other keywords that share a line with the ones above ("Flying, lifelink, ward {2}"). Opp
  // ignores what they do, but they mustn't hide the keywords next to them.
  const OTHER_KEYWORDS = ['protection', 'flash', 'partner', 'changeling',
    'devoid', 'afflict', 'convoke', 'crew', 'cycling',
    'echo', 'evolve', 'extort', 'horsemanship', 'riot',
    'mentor', 'training', 'myriad', 'backup', 'enlist', 'fabricate', 'dethrone',
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

  // "This creature can't be blocked except by two or more creatures." about itself (not "creatures you control …").
  const OLD_MENACE = /^(?!(?:other|enchanted|equipped|each|all|creatures?)\b)(?!.*\byou control\b).+? can't be blocked except by two or more creatures\.?$/i;
  const UNBLOCKABLE = /^(?!(?:other|enchanted|equipped|each|all|creatures?|target)\b)(?!.*\byou control\b)[^,.]+? can't be blocked\.?$/i;

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
    const lines = String(oracle || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim());
    // Menace in older words: "Goblin Glory Chaser can't be blocked except by two or more creatures."
    if (lines.some(l => OLD_MENACE.test(l))) found.add('menace');
    if (lines.some(l => UNBLOCKABLE.test(l))) found.add('unblockable'); // "This creature can't be blocked."
    return [...found];
  }

  // The numbers of a card's numbered keywords: "Toxic 2\nAfterlife 1" → { toxic: 2, afterlife: 1 }.
  function keywordNumbers(oracle) {
    const out = {};
    for (const raw of String(oracle || '').split('\n')) {
      const line = raw.replace(/\([^)]*\)/g, '').trim().toLowerCase().replace(/\.$/, '');
      for (const part of line.split(/,\s*|;\s*/)) {
        const m = /^([a-z ]+?) (\d+)$/.exec(part.trim());
        if (m && NUMBERED.includes(m[1])) out[m[1]] = (out[m[1]] || 0) + Number(m[2]);
      }
    }
    return out;
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
      if (/\bcan't be blocked except by two or more creatures\b/i.test(m[1])) out.kw.push('menace');
      else if (/\bcan't be blocked$/i.test(m[1])) out.kw.push('unblockable');
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
    if (inst.cda && !pt) { pow += inst.cda.pow; tou += inst.cda.tou; } // */* from its own text, see refreshGrants
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
    const n = card.n || keywordNumbers(card.oracle || (inst.custom && inst.custom.text));
    return { pow, tou, kw, n, cmc: card.cmc || 0, colors: colorsOf(card), artifact: /\bartifact\b/i.test(front(inst.typeLine)) };
  }

  // A numbered keyword's number ("Toxic 2" → 2), 1 if it has the keyword some other way (a lord), or 0.
  const kwN = (st, k) => (st.kw.has(k) ? (st.n && st.n[k]) || 1 : 0);

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
  // Decayed creatures can't block; "can't be blocked" ones (unblockable) aren't.
  const canBlock = (blocker, attacker, defender) => !blocker.kw.has("can't block") && !blocker.kw.has('decayed') && !attacker.kw.has('unblockable')
    && !walksPast(attacker, defender) && !shielded(attacker, blocker)
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

  // A whole combat: list [{ st, blockers: [{ key, st }] }], one per attacker. A creature blocking more
  // than one attacker (Brave the Sands) splits its damage: lethal to each one in turn, the rest to the
  // last. The damage it takes adds up over its fights, and whether it dies is only set on its last
  // one. Returns combat()'s result for each attacker, in order.
  // Before damage, the "becomes blocked" keywords: flanking (each blocker without flanking gets
  // -1/-1), bushido N (+N/+N to an attacker that's blocked and to a blocker), rampage N (+N/+N for
  // each blocker past the first). Works on copies of the stats.
  function blockedStep(list) {
    const pump = (st, p, t) => ({ ...st, pow: st.pow + p, tou: st.tou + t });
    return list.map(x => {
      if (!x.blockers.length) return x;
      const n = x.blockers.length;
      const a = pump(x.st, kwN(x.st, 'bushido') + kwN(x.st, 'rampage') * (n - 1), kwN(x.st, 'bushido') + kwN(x.st, 'rampage') * (n - 1));
      const blockers = x.blockers.map(b => {
        const flank = x.st.kw.has('flanking') && !b.st.kw.has('flanking') ? -1 : 0;
        const bush = kwN(b.st, 'bushido');
        return flank || bush ? { ...b, st: pump(b.st, flank + bush, flank + bush) } : b;
      });
      return { ...x, st: a, blockers };
    });
  }

  function combatAll(list) {
    list = blockedStep(list);
    const fights = new Map(); // blocker key → indexes of the attackers it blocks
    list.forEach((x, i) => x.blockers.forEach(b => fights.set(b.key, [...(fights.get(b.key) || []), i])));
    const shared = key => fights.get(key).length > 1;
    const powFor = new Map(); // `${key}|${i}` → the shared blocker's damage to attacker i
    for (const [key, idx] of fights) {
      if (idx.length < 2) continue;
      const b = list[idx[0]].blockers.find(y => y.key === key).st;
      let left = Math.max(0, b.pow);
      idx.forEach((i, k) => {
        const lethal = b.kw.has('deathtouch') ? 1 : Math.max(0, list[i].st.tou);
        const n = k === idx.length - 1 ? left : Math.min(left, lethal);
        powFor.set(`${key}|${i}`, n);
        left -= n;
      });
    }
    const taken = new Map(); // shared blocker key → { dmg, dt }
    return list.map((x, i) => {
      const bsts = x.blockers.map(b => (shared(b.key)
        ? { ...b.st, pow: powFor.get(`${b.key}|${i}`), tou: Math.max(1, b.st.tou - (taken.get(b.key) || { dmg: 0 }).dmg) }
        : b.st));
      const r = combat(x.st, bsts);
      x.blockers.forEach((b, j) => {
        if (!shared(b.key)) return;
        const t = taken.get(b.key) || { dmg: 0, dt: false };
        t.dmg += r.b[j].dmg;
        t.dt = t.dt || r.b[j].dt;
        taken.set(b.key, t);
        const idx = fights.get(b.key);
        r.b[j].dead = idx[idx.length - 1] === i && !b.st.kw.has('indestructible') && (t.dt || t.dmg >= b.st.tou);
      });
      return r;
    });
  }

  // How many attackers a creature on table s can block: 1, plus "Each creature you control can block
  // an additional creature each combat" (Brave the Sands) or "This creature can block an additional
  // creature each combat"; "can block any number of creatures" is no limit (Infinity).
  const EXTRA_BLOCK = /^(each creature you control|.+?) can block (any number of creatures|an additional (?:(\w+) )?creatures?)(?: each combat)?\.?$/i;
  function blocksAllowed(s, inst, defOf) {
    let n = 1;
    for (const src of permanents(s)) {
      for (const line of oracleLines(src, defOf)) {
        const m = EXTRA_BLOCK.exec(line);
        if (!m || !(/^each creature you control$/i.test(m[1]) || (src === inst && isSelf(m[1], inst)))) continue;
        if (/^any number/i.test(m[2])) return Infinity;
        n += m[3] ? toNumber(m[3]) || 1 : 1;
      }
    }
    return n;
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
      n: keywordNumbers(card.oracle),
      colors: colorsOf(card),
      spell: /\b(instant|sorcery)\b/i.test(front(card.typeLine)) ? spellEffect(card.oracle) || counterSpell(card.oracle) || plainSpell(card.oracle) : null,
    };
  }

  // An instant or sorcery runEffect can do all of ("Each opponent loses 3 life.", "Proliferate."): { effect: text }, or null.
  function plainSpell(oracle) {
    const text = String(oracle || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(l => l && !keywords(l).length).join(' ');
    if (!text || !canRunAll(text, { hitOpps: true, other: true, target: true })) return null;
    // removal: it destroys, exiles, bounces or burns a target ("Destroy target nonblack creature.")
    const removal = effectParts(text).some(p => { const e = targetEffect(p); return !!e && ['destroy', 'exile', 'bounce', 'damage'].includes(e.action); });
    return { effect: text, removal };
  }

  // deck: { name, key, rows }, defs: { scryfallId: card }. onDraw: Opp goes second.
  function create(deck, defs, opts = {}) {
    const s = G.create(deck, defs, { onDraw: !!opts.onDraw });
    s.opponents = 1; // you
    s.offTurn = true; // until its first turn
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

  // When you play against Opp in the app, it can wait for your answer to its spells and holds some
  // instants for your turn. responder(game, inst) says whether you could answer this spell (you have
  // an instant you can pay for); app.js sets it. Without one (tests, automatic games) nothing waits.
  let responder = null;
  const setResponder = fn => { responder = fn; };
  const getResponder = () => responder;

  const isInstantSpeed = (inst, defOf) => /\binstant\b/i.test(front(inst.typeLine)) || /^flash\b/im.test(oracleText(inst, defOf));

  // Removal and creature burn Opp saves for your turn (on an attacker, or at your end step) when
  // it can answer you (game.bot.respond). Counterspells only ever answer your spells.
  const heldForYourTurn = (game, inst) => !!game.bot.respond && /\binstant\b/i.test(front(inst.typeLine)) && !!inst.bot.spell
    && !!(inst.bot.spell.kill || (inst.bot.spell.damage && inst.bot.spell.creature) || inst.bot.spell.removal);

  // The first thing Opp would hit with a removal effect ({ inst, st, s } or { player }), or null.
  const removalPick = (game, src, text, defOf) => {
    for (const part of effectParts(text)) {
      const eff = targetEffect(part);
      if (eff && ['destroy', 'exile', 'bounce', 'damage'].includes(eff.action)) return oppTarget(game, src, eff, defOf, true);
    }
    return null;
  };

  // Can Opp find a target for every targeted part of this effect?
  const oppCanTargetAll = (game, src, text, defOf) => effectParts(text).every(part => {
    const eff = targetEffect(part);
    return !eff || !!oppTarget(game, src, eff, defOf, true);
  });

  // The spells Opp could cast right now, best first: [{ iid, inst, zone, tax, target, priority }].
  // moment: 'main' (its own turn), or on your turn 'attack' (attackers: your attacking creatures,
  // [{ inst, st }]) or 'end' (your end step: removal on your best creature, card draw).
  function castOptions(game, defOf, moment = 'main', attackers = null) {
    const s = game.bot.s;
    const you = moment === 'attack' ? attackers || [] : yourCreatures(game, defOf);
    const options = [];
    // Thalia and the like, on either table.
    const taxes = [{ rules: tableRules(s, defOf), own: true }, { rules: tableRules(game, defOf), own: false }];
    for (const zone of moment === 'main' ? ['command', 'hand'] : ['hand']) {
      for (const iid of s.zones[zone]) {
        const inst = s.cards[iid];
        const f = inst.bot;
        const type = front(inst.typeLine);
        if (G.isLand(inst) || /\b(planeswalker|battle)\b/i.test(type) || /\baura\b/i.test(type)) continue;
        const isSpell = /\b(instant|sorcery)\b/i.test(type);
        if (isSpell && !f.spell) continue;
        if (!isSpell && !/\b(creature|artifact|enchantment)\b/i.test(type)) continue;
        if (f.spell && f.spell.counter) continue; // only in answer to your spell (oppCounters)
        if (moment !== 'main' && (!isInstantSpeed(inst, defOf) || !f.spell || !(f.spell.kill || f.spell.damage || f.spell.removal || (moment === 'end' && f.spell.draw)))) continue;
        const tax = (zone === 'command' ? (inst.castCount || 0) * 2 : 0) + spellTax(taxes, inst, defOf);
        if (!affordable(s, f.cost, tax - G.discount(s, inst, oracleOf(defOf)))) continue;
        let target = null;
        let priority = f.cmc + (G.isCreature(inst) ? 0.5 : 0);
        const held = moment === 'main' && heldForYourTurn(game, inst);
        if (f.spell && f.spell.kill) {
          if (held) continue;
          target = bestTarget(you);
          if (!target || value(target.st) < (moment === 'attack' ? 3 : 4)) continue;
          priority += 10;
        } else if (f.spell && f.spell.damage) {
          const n = f.spell.damage;
          target = f.spell.creature && !held ? bestTarget(you, n) : null;
          // At you only when it's lethal, or you're low and there's no creature worth it.
          if (f.spell.player && moment !== 'attack' && (game.life <= n || (!target && game.life <= 10 && !held))) target = 'face';
          if (!target) continue;
          priority += target === 'face' ? (game.life <= n ? 20 : -5) : 8;
        } else if (f.spell && f.spell.effect) {
          if (held || !oppCanTargetAll(game, inst, f.spell.effect, defOf)) continue;
          // On your turn: only on an attacker worth it (when you attack), or your best creature (end step).
          if (moment !== 'main' && f.spell.removal) {
            const hit = removalPick(game, inst, f.spell.effect, defOf);
            if (!hit || !hit.inst || value(hit.st) < (moment === 'attack' ? 3 : 4)) continue;
            if (moment === 'attack' && !you.some(a => a.inst === hit.inst)) continue;
            priority += 10;
          }
        }
        options.push({ iid, inst, zone, tax, target, priority });
      }
    }
    return options.sort((a, b) => b.priority - a.priority);
  }

  // Casts one spell if it can: removal when there's a good target, otherwise the most expensive
  // thing it can afford. Returns true if it cast something, or 'wait' if the spell is on the stack
  // waiting for your answer (s.stack; resolveStack finishes it).
  function castOne(game, defOf, notes, moment = 'main', attackers = null) {
    const s = game.bot.s;
    const pick = castOptions(game, defOf, moment, attackers)[0];
    if (!pick) return false;
    const { iid, inst, zone, tax, target } = pick;
    onOpp(game, () => G.autoPay(s, inst.bot.cost, tax - G.discount(s, inst, oracleOf(defOf))));
    if (moment === 'main' && responder && responder(game, inst)) {
      s.zones[zone].splice(s.zones[zone].indexOf(iid), 1);
      inst.zone = 'stack';
      s.stack = { iid, from: zone, target: target === 'face' ? 'face' : target ? target.inst.iid : null };
      const aim = target === 'face' ? ' at you' : target ? ` on your ${target.inst.name}` : '';
      G.log(s, `Opp is casting ${inst.name}${aim}.`);
      notes.push(`is casting ${inst.name}${aim}`);
      return 'wait';
    }
    resolveCast(game, defOf, inst, target, notes);
    return true;
  }

  // Opp's spell on the stack resolves (unless its target is gone).
  function resolveStack(game, defOf, notes = []) {
    const s = game.bot.s;
    const st = s.stack;
    delete s.stack;
    const inst = st && s.cards[st.iid];
    if (!inst || inst.zone !== 'stack') return;
    inst.zone = st.from; // back where it came from, so moving it works as usual
    s.zones[st.from].push(inst.iid);
    let target = null;
    if (st.target === 'face') target = 'face';
    else if (st.target) {
      const t = game.cards[st.target];
      if (!t || t.zone !== 'battlefield') {
        G.log(s, `Opp's ${inst.name} has no target any more, so it does nothing.`);
        G.move(s, inst.iid, 'graveyard');
        return;
      }
      target = { inst: t, st: stats(t, defOf(t.id)) };
    }
    resolveCast(game, defOf, inst, target, notes, true);
  }

  // Your counterspell answers Opp's spell on the stack: it goes to the graveyard (a commander to the
  // command zone, its tax counted). Returns its name, or null if nothing was waiting.
  function counterStack(game) {
    const s = game.bot && game.bot.s;
    const st = s && s.stack;
    const inst = st && s.cards[st.iid];
    if (!inst) return null;
    delete s.stack;
    inst.zone = st.from;
    s.zones[st.from].push(inst.iid);
    if (st.from === 'command') inst.castCount = (inst.castCount || 0) + 1;
    else G.move(s, inst.iid, 'graveyard');
    G.log(s, `Opp's ${inst.name} was countered.`);
    return inst.name;
  }

  // What happens when Opp's spell resolves. noted: its "cast …" note was already added.
  function resolveCast(game, defOf, inst, target, notes, noted) {
    const s = game.bot.s;
    const iid = inst.iid;
    const f = inst.bot;
    const note = text => { if (!noted) notes.push(text); };
    if (!f.spell) {
      onOpp(game, () => G.move(s, iid, 'battlefield'));
      spellCast(game, s, inst, defOf, null); // prowess, "whenever you cast", cascade
      if (G.choosesType(oracleOf(defOf)(inst))) {
        inst.chosenType = commonType(s);
        if (inst.chosenType) G.log(s, `Chose ${inst.chosenType} for ${inst.name}.`);
      }
      // "When this enters, each player discards a card": Opp drops its worst; you're asked to pick yours.
      const d = G.enterDiscard(inst.name, oracleOf(defOf)(inst));
      if (d && d.you) oppDiscards(game, d.you, d.random, inst.name);
      if (d && d.opp) youDiscard(game, d.opp, d.random, `Opp's ${inst.name}`);
      note(`cast ${inst.name}`);
      return;
    }
    if (f.spell.kill) {
      G.log(s, `Cast ${inst.name} on your ${target.inst.name}.`);
      if (f.spell.exile || !regenerates(game, target.inst, defOf, false)) moveYours(game, target.inst, f.spell.exile ? 'exile' : 'graveyard');
      note(`cast ${inst.name} on your ${target.inst.name}`);
    } else if (f.spell.damage) {
      if (target === 'face') {
        game.life -= f.spell.damage;
        G.log(s, `Cast ${inst.name}: ${f.spell.damage} damage to you.`);
        dealtDamage(game, f.spell.damage, defOf);
        note(`cast ${inst.name} for ${f.spell.damage} damage to you`);
      } else {
        G.log(s, `Cast ${inst.name}: ${f.spell.damage} damage to your ${target.inst.name}.`);
        if (!regenerates(game, target.inst, defOf, false)) moveYours(game, target.inst, 'graveyard');
        note(`cast ${inst.name} on your ${target.inst.name}`);
      }
    } else if (f.spell.draw) {
      G.log(s, `Cast ${inst.name} and drew ${f.spell.draw}.`);
      G.drawCards(s, f.spell.draw, true);
      note(`cast ${inst.name}`);
    } else if (f.spell.effect) {
      runFor(game, s, inst, f.spell.effect, 'cast', null, defOf);
      note(`cast ${inst.name}`);
    }
    spellCast(game, s, inst, defOf, null);
    if (inst.zone !== 'graveyard') G.move(s, iid, 'graveyard');
  }

  // You cast a spell: Opp may counter it with a counterspell from its hand, if it can pay and the
  // spell is worth it (mana value 3 or more, or your commander). "Unless its controller pays {N}"
  // is paid for you when your untapped mana can. Returns true if your spell is countered.
  function oppCounters(game, spell, defOf) {
    if (!game.bot || !game.bot.respond || !spell || spell.faceDown) return false;
    const s = game.bot.s;
    const cmc = (defOf(spell.id) || {}).cmc || 0;
    if (cmc < 3 && !spell.commander) return false;
    const creature = G.isCreature(spell);
    const counter = s.zones.hand.map(iid => s.cards[iid]).find(c => {
      const k = c.bot && c.bot.spell && c.bot.spell.counter;
      return k && (k.what === 'spell' || (k.what === 'creature' ? creature : k.what === 'noncreature' ? !creature : false))
        && affordable(s, c.bot.cost, 0);
    });
    if (!counter) return false;
    onOpp(game, () => G.autoPay(s, counter.bot.cost));
    G.move(s, counter.iid, 'graveyard');
    const unless = counter.bot.spell.counter.unless;
    if (unless) {
      const paid = G.autoPay(game, `{${unless}}`);
      if (paid) {
        G.log(game, `Opp cast ${counter.name} on your ${spell.name}; you paid {${unless}}${paid.sources.length ? ` (tapped ${paid.sources.join(', ')})` : ''}, so it resolves.`);
        return false;
      }
    }
    G.log(game, `Opp cast ${counter.name}: your ${spell.name} is countered.`);
    game.notice = `Opp countered your ${spell.name} with ${counter.name}.`;
    return true;
  }

  // Opp's instants on your turn: when you attack (on an attacker; attackers [{ inst, st }]) or at
  // your end step. Returns what it did, for a message.
  function oppInstantAt(game, defOf, moment, attackers) {
    if (!game.bot || !game.bot.respond || !game.bot.started) return [];
    const notes = [];
    for (let i = 0; i < 3; i++) {
      const list = moment === 'attack' ? (attackers || []).filter(a => a.inst.zone === 'battlefield') : null;
      if (!castOne(game, defOf, notes, moment, list)) break;
    }
    return notes;
  }

  // "Counter target spell.", "Counter target creature spell.", "Counter target noncreature spell
  // unless its controller pays {3}.": { counter: { what: 'spell' | 'creature' | 'noncreature', unless } }, or null.
  function counterSpell(oracle) {
    const m = /^counter target (creature |noncreature )?spell(?: unless its controller pays \{(\d+)\})?\.?$/im.exec(String(oracle || '').replace(/\([^)]*\)/g, '').trim());
    return m ? { counter: { what: m[1] ? m[1].trim() : 'spell', unless: m[2] ? Number(m[2]) : 0 } } : null;
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
    return w === name || w === name.split(',')[0] || w === 'it' || /^this (creature|artifact|enchantment|permanent|land|card|token|spell)$/.test(w)
      || (w.length >= 4 && name.startsWith(w + ' ') && /\blegendary\b/i.test(inst.typeLine || '')); // "Ashcoat" for Ashcoat of the Shadow Swarm
  };

  // The effects runEffect knows: [pattern, do(table, match, ctx), can(match, ctx) if it needs more than the words].
  const EFFECTS = [
    [new RegExp(`^(?:you )?draw ${COUNT} cards?$`, 'i'), (g, m) => G.drawCards(g, toNumber(m[1]))],
    [new RegExp(`^you gain ${COUNT} life$`, 'i'), (g, m) => { g.life += toNumber(m[1]); }],
    [new RegExp(`^you lose ${COUNT} life$`, 'i'), (g, m) => { g.life -= toNumber(m[1]); }],
    [new RegExp(`^each opponent loses ${COUNT} life$`, 'i'), (g, m, ctx) => ctx.hitOpps(toNumber(m[1])), (m, ctx) => !!ctx.hitOpps],
    // Blood Artist's "target player loses 1 life": an opponent, picked by you online.
    [new RegExp(`^target (?:player|opponent) loses ${COUNT} life$`, 'i'), (g, m, ctx) => (ctx.hitTarget || ctx.hitOpps)(toNumber(m[1])), (m, ctx) => !!(ctx.hitTarget || ctx.hitOpps)],
    [new RegExp(`^put ${COUNT} ([\\w+/-]+) counters? on (.+)$`, 'i'), (g, m, ctx) => G.counter(g, ctx.self.iid, m[2].toLowerCase(), toNumber(m[1]), { effect: true }),
      (m, ctx) => !!ctx.self && isSelf(m[3], ctx.self)],
    [/^regenerate (.+)$/i, (g, m, ctx) => { ctx.self.regen = (ctx.self.regen || 0) + 1; }, (m, ctx) => !!ctx.self && isSelf(m[1], ctx.self)], // used up by regenerates()
    [/^proliferate$/i, (g, m, ctx) => proliferate(g, ctx.other)],
    [/^you become the monarch$/i, g => becomeMonarch(g)],
    [/^untap all creatures you control$/i, g => creatures(g).forEach(c => { c.tapped = false; c.tappedFor = null; })],
    [/^untap all creatures that attacked this turn$/i, g => creatures(g, c => c.attackedTurn === g.turn).forEach(c => { c.tapped = false; c.tappedFor = null; })],
    [/^after this (?:main )?phase, there is an additional combat phase(?: followed by an additional main phase)?$/i, g => extraCombat(g)],
    [/^create .+$/i, (g, m, ctx) => triggerTokens(g, ctx.self || { name: 'Effect' }, m[0], 'effect') !== null, m => TOKEN_TEXT.test(m[0])],
    // "Destroy target creature", "deals 3 damage to any target"…: ctx.target(effect) picks the target
    // (you're asked; Opp picks its own). See targetEffect.
    [/^.+$/, (g, m, ctx) => ctx.target(targetEffect(m[0]), m[0], ctx.self), (m, ctx) => !!ctx.target && !!targetEffect(m[0])],
  ];

  // ---------- targets ----------

  // A targeted part of an effect: { action, what, n, pow, tou, kw, kind }, or null.
  //   destroy / exile target …, return target … to its owner's hand (bounce), … deals N damage to
  //   any target / target …, tap / untap target …, target … gets +X/+Y (and gains …) until end of
  //   turn (pump), put N … counters on target … (counter). what must be something targetFilter reads.
  function targetEffect(part) {
    const p = String(part).trim().replace(/\.$/, '');
    let m;
    let out = null;
    if ((m = /^(destroy|exile) (?:up to one )?target (.+)$/i.exec(p))) out = { action: m[1].toLowerCase(), what: m[2] };
    else if ((m = /^return (?:up to one )?target (.+?) to (?:its|their) owner's hand$/i.exec(p))) out = { action: 'bounce', what: m[1] };
    else if ((m = /^.+? deals (\d+) damage to (any target|(?:up to one )?target (.+))$/i.exec(p))) out = { action: 'damage', n: Number(m[1]), what: m[3] || 'any target' };
    else if ((m = /^(tap|untap) (?:up to one )?target (.+)$/i.exec(p))) out = { action: m[1].toLowerCase(), what: m[2] };
    else if ((m = /^target (.+?) gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))? until end of turn$/i.exec(p))) {
      out = { action: 'pump', what: m[1], pow: Number(m[2]), tou: Number(m[3]), kw: kwWords(m[4]) };
    } else if ((m = /^target (.+?) gains (.+?) until end of turn$/i.exec(p)) && kwWords(m[2]).length) out = { action: 'pump', what: m[1], pow: 0, tou: 0, kw: kwWords(m[2]) };
    else if ((m = new RegExp(`^put ${COUNT} ([\\w+/-]+) counters? on (?:up to one )?target (.+)$`, 'i').exec(p))) out = { action: 'counter', n: toNumber(m[1]), kind: m[2].toLowerCase(), what: m[3] };
    return out && targetFilter(out.what) ? out : null;
  }
  const kwWords = text => String(text || '').toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(k => KEYWORDS.includes(k));

  // What a target can be: "creature", "creature an opponent controls", "artifact or enchantment",
  // "nonland permanent", "attacking creature", "creature with flying", "creature or planeswalker",
  // "any target", "player", "opponent"… Returns { players: null | 'any' | 'opps', fits(inst, mine) }
  // (mine: it's on the table of whoever's effect it is), or null for words it doesn't know.
  const TYPES = ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
  function targetFilter(what) {
    let w = String(what).toLowerCase().trim().replace(/\.$/, '');
    if (w === 'any target') return { players: 'any', fits: inst => ['creature', 'planeswalker', 'battle'].some(t => isA(inst, t)) };
    let whose = null;
    const own = /\s+(you control|an opponent controls|you don't control|your opponents control)$/.exec(w);
    if (own) { whose = /^you control$/.test(own[1]) ? 'mine' : 'theirs'; w = w.slice(0, own.index); }
    let extra = () => true;
    const x = /\s+with (flying|power (\d+) or less|power (\d+) or greater|mana value (\d+) or less)$/.exec(w);
    if (x) {
      w = w.slice(0, x.index);
      extra = (inst, st) => (x[1] === 'flying' ? st.kw.has('flying') : x[2] ? st.pow <= Number(x[2]) : x[3] ? st.pow >= Number(x[3]) : (st.cmc || 0) <= Number(x[4]));
    }
    let players = null;
    const alts = [];
    for (const alt of w.split(/\s+or\s+|,\s*/).map(a => a.trim()).filter(Boolean)) {
      if (alt === 'player') { players = 'any'; continue; }
      if (alt === 'opponent') { players = players || 'opps'; continue; }
      const words = alt.split(/\s+/);
      const checks = [];
      let base = false;
      for (const word of words) {
        const not = /^non-?(.+)$/.exec(word);
        if (TYPES.includes(singular(word))) { base = true; checks.push(inst => isA(inst, singular(word))); } else if (word === 'permanent' || word === 'permanents') { base = true; checks.push(() => true); } else if (not && (TYPES.includes(not[1]) || not[1] === 'token')) checks.push(inst => (not[1] === 'token' ? !inst.token : !isA(inst, not[1])));
        else if (not && PRO_COLORS[not[1]]) checks.push((inst, st) => !(st.colors || []).includes(PRO_COLORS[not[1]]));
        else if (PRO_COLORS[word]) checks.push((inst, st) => (st.colors || []).includes(PRO_COLORS[word]));
        else if (word === 'token') checks.push(inst => !!inst.token);
        else if (word === 'tapped') checks.push(inst => !!inst.tapped);
        else if (word === 'untapped') checks.push(inst => !inst.tapped);
        else if (word === 'attacking' || word === 'blocking') return null; // combat isn't a moment you can target in here
        else if (word === 'legendary') checks.push(inst => /\blegendary\b/i.test(front(inst.typeLine)));
        else if (/^[a-z]+$/.test(word) && word !== 'spell' && word !== 'ability' && words.length > 1) checks.push(inst => typeWords(inst).includes(singular(word))); // "Elf creature"
        else return null;
      }
      if (!base) return null;
      alts.push(checks);
    }
    if (!alts.length && !players) return null;
    return {
      players: whose === 'mine' ? null : players,
      fits: (inst, mine, st) => alts.length > 0 && !(whose === 'mine' && !mine) && !(whose === 'theirs' && mine)
        && alts.some(checks => checks.every(f => f(inst, st))) && extra(inst, st),
    };
  }

  // Can this effect target that permanent? (On the battlefield, the right kind, and not hexproof or
  // shroud against an opponent's effect; Opp also skips ward, since it doesn't pay for it.)
  // mine: it's on the effect's own table. opp: Opp is the one choosing.
  function canTarget(eff, inst, st, mine, opp) {
    const f = targetFilter(eff.what);
    if (!f || !inst || inst.zone !== 'battlefield' || inst.faceDown) return false;
    if (st.kw.has('shroud') || (!mine && (st.kw.has('hexproof') || (opp && st.kw.has('ward'))))) return false;
    return f.fits(inst, mine, st);
  }

  // Does a targeted effect to one permanent on table s (or to a player: who is 'you' or 'opp' as
  // seen from game, and life is changed there; online players are app.js's job). src: its name.
  // Returns a log line.
  function applyTarget(game, s, inst, eff, src, defOf) {
    const st = stats(inst, inst.bot || defOf(inst.id));
    const theirs = !!(game.bot && s === game.bot.s);
    const gone = to => { G.move(s, inst.iid, inst.commander && to !== 'hand' ? 'command' : to); };
    let what;
    if (eff.action === 'destroy' || (eff.action === 'damage' && G.isCreature(inst) && st.tou <= eff.n)) {
      if (st.kw.has('indestructible')) what = `${inst.name} is indestructible`;
      else if (regenerates(game, inst, defOf, theirs)) what = `${inst.name} regenerated`;
      else { gone('graveyard'); what = eff.action === 'damage' ? `${eff.n} damage kills ${inst.name}` : `destroyed ${inst.name}`; }
    } else if (eff.action === 'damage' && isPlaneswalker(inst)) {
      const dead = damagePlaneswalker(inst, inst.bot || defOf(inst.id), eff.n);
      if (dead) gone('graveyard');
      what = `${eff.n} damage to ${inst.name}${dead ? ', which dies' : ` (loyalty ${inst.counters.loyalty})`}`;
    } else if (eff.action === 'damage') what = `${eff.n} damage to ${inst.name} (not enough to kill it)`;
    else if (eff.action === 'exile') { gone('exile'); what = `exiled ${inst.name}`; } else if (eff.action === 'bounce') { gone('hand'); what = `returned ${inst.name} to its owner's hand`; } else if (eff.action === 'tap' || eff.action === 'untap') {
      inst.tapped = eff.action === 'tap';
      inst.tappedFor = null;
      what = `${eff.action === 'tap' ? 'tapped' : 'untapped'} ${inst.name}`;
    } else if (eff.action === 'pump') {
      pumpBy(inst, eff.pow, eff.tou);
      if (eff.kw.length) inst.pump.kw = [...new Set([...(inst.pump.kw || []), ...eff.kw])];
      what = `${inst.name} gets ${eff.pow >= 0 ? '+' : ''}${eff.pow}/${eff.tou >= 0 ? '+' : ''}${eff.tou}${eff.kw.length ? ` and ${eff.kw.join(', ')}` : ''} until end of turn`;
    } else if (eff.action === 'counter') {
      G.counter(s, inst.iid, eff.kind, eff.n, { effect: true });
      what = `${eff.n} ${eff.kind} counter${eff.n === 1 ? '' : 's'} on ${inst.name}`;
    }
    const line = `${src}: ${what}.`;
    G.log(s, line);
    return line;
  }

  // Damage to a player as the target, seen from game: who 'you' or 'opp'.
  function damagePlayer(game, who, n, src) {
    if (who === 'you') game.life -= n;
    else game.oppLife -= n;
    G.log(game, `${src}: ${n} damage to ${who === 'you' ? 'you' : 'Opp'}.`);
  }

  // Opp picks a target for its own effect (src on its table): removal and damage on your most
  // valuable creature it can hit (damage only on one it kills, else your face for "any target"),
  // pumps and counters on its own best creature, tap on your best untapped creature.
  // Returns { inst, s } or { player: 'you' } or null. dry: just look.
  function oppTarget(game, src, eff, defOf, dry) {
    const s = game.bot.s;
    const pool = [...permanents(game).map(inst => ({ inst, s: game, mine: false, st: stats(inst, defOf(inst.id)) })),
      ...permanents(s).map(inst => ({ inst, s, mine: true, st: botStats(inst) }))].filter(x => canTarget(eff, x.inst, x.st, x.mine, true));
    const best = list => list.sort((a, b) => value(b.st) - value(a.st))[0] || null;
    let pick = null;
    if (['destroy', 'exile', 'bounce'].includes(eff.action)) pick = best(pool.filter(x => !x.mine && !(eff.action === 'destroy' && x.st.kw.has('indestructible'))));
    else if (eff.action === 'damage') {
      pick = best(pool.filter(x => !x.mine && G.isCreature(x.inst) && x.st.tou <= eff.n && !x.st.kw.has('indestructible')));
      const f = targetFilter(eff.what);
      if (!pick && f && f.players) pick = { player: 'you' };
    } else if (eff.action === 'tap') pick = best(pool.filter(x => !x.mine && !x.inst.tapped));
    else if (eff.action === 'untap') pick = best(pool.filter(x => x.mine && x.inst.tapped));
    else pick = best(pool.filter(x => x.mine && G.isCreature(x.inst)));
    if (!pick || dry) return pick;
    if (pick.player) damagePlayer(game, 'you', eff.n, src.name);
    else applyTarget(game, pick.s, pick.inst, eff, `Opp's ${src.name}`, defOf);
    return pick;
  }

  // Your "When this enters, …" (or Opp's): the targeted parts ("destroy target creature an opponent
  // controls") and tokens ("create two 1/1 …"). Life, cards and counters on entering are done elsewhere.
  // s: the table it entered on. ctx.target is how you pick (app.js); Opp picks with oppTarget.
  function enterEffects(game, s, inst, defOf, ctx) {
    if (!inst || inst.faceDown) return;
    const opps = isOpps(game, s);
    for (const line of oracleLines(inst, defOf)) {
      const m = /^when(?:ever)? (.+?) enters(?: the battlefield)?(?: or [^,]+)?, (?:you may )?(.+)$/i.exec(line);
      if (!m || !isSelf(m[1], inst)) continue;
      for (const part of effectParts(m[2])) {
        const eff = targetEffect(part);
        if (eff && opps) oppTarget(game, inst, eff, defOf);
        else if (eff && ctx && ctx.target) ctx.target(eff, part, inst);
        else if (TOKEN_TEXT.test(part)) triggerTokens(s, inst, part, 'enters');
      }
    }
  }
  const effectParts = text => String(text).replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '')
    .split(/\.\s+|,?\s+and\s+(?=you |draw |each |put |target )|,\s+then\s+/i).map(p => p.trim()).filter(Boolean);
  const effectFor = (part, ctx) => EFFECTS.find(([re, , can]) => { const m = re.exec(part); return m && (!can || can(m, ctx)); });
  // Can runEffect do all of this text? (Then a spell made of it can resolve on its own.)
  const canRunAll = (text, ctx) => { const parts = effectParts(text); return parts.length > 0 && parts.every(p => effectFor(p, ctx)); };

  // Does the easy parts of an ability's effect: drawing, life, counters on the card itself,
  // tokens, proliferate, the monarch, untapping and extra combats. game: the table it happens on.
  // ctx: { self, hitOpps(n), hitTarget(n), other } where hitOpps takes life from each opponent
  // and other is the opponent's table (for proliferate). Returns the parts it couldn't do (for you to do by hand), or [].
  function runEffect(game, text, ctx, times = 1) {
    const left = [];
    for (const part of effectParts(text)) {
      for (let i = 0; i < times; i++) {
        const found = effectFor(part, ctx);
        if (!found || found[1](game, found[0].exec(part), ctx) === false) { left.push(part); break; }
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
  // "Creatures your opponents control get -2/-2" (Elesh Norn) reaches the other table. Then a
  // creature left with 0 or less toughness goes to the graveyard, which can change the lords again.
  function refreshGrants(game, defOf) {
    const tables = [game, game.bot && game.bot.s].filter(Boolean);
    for (let i = 0; i < 10; i++) {
      grantsOnce(tables, defOf);
      if (!zeroToughness(tables, defOf)) return;
    }
  }

  // Puts each creature with 0 or less toughness into its owner's graveyard (its commander into the
  // command zone). Indestructible doesn't help. One whose toughness is "*" and that nothing here
  // works out is left alone. Returns true if any died.
  function zeroToughness(tables, defOf) {
    let any = false;
    for (const s of tables) {
      for (const c of creatures(s)) {
        const card = c.bot || defOf(c.id) || {};
        const printed = c.custom && c.custom.pt ? String(c.custom.pt).split('/')[1] : card.toughness;
        if (!/^-?\d+$/.test(String(printed == null ? '' : printed).trim()) && !c.cda) continue;
        if (stats(c, card).tou > 0) continue;
        G.log(s, `${c.name} has 0 or less toughness.`);
        G.move(s, c.iid, c.commander ? 'command' : 'graveyard');
        any = true;
      }
    }
    return any;
  }

  function grantsOnce(tables, defOf) {
    const kwList = text => text.toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(Boolean);
    // "Creatures your opponents control get -2/-2": from each table, for the other ones.
    const hostile = [];
    for (const s of tables) {
      for (const src of permanents(s)) {
        for (const line of oracleLines(src, defOf)) {
          const m = /^(.+?) your opponents control get ([+-]\d+)\/([+-]\d+)\.?$/i.exec(line);
          if (m && !m[1].includes(':')) hostile.push({ from: s, what: m[1], pow: Number(m[2]), tou: Number(m[3]) });
        }
      }
    }
    for (const s of tables) {
      const lords = hostile.filter(h => h.from !== s).map(h => ({ src: null, other: false, what: h.what, kws: [], pow: h.pow, tou: h.tou }));
      const each = []; // "This gets +1/+1 for each other Cat you control"
      for (const src of permanents(s)) {
        for (const line of oracleLines(src, defOf)) {
          let m = /^(other )?(.+?) you control can't be blocked except by two or more creatures\.?$/i.exec(line);
          if (m) { lords.push({ src, other: !!m[1], what: m[2], kws: ['menace'], pow: 0, tou: 0 }); continue; } // menace, older words
          m = /^(other )?(.+?) you control (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+?))?|have (.+?))\.?$/i.exec(line);
          if (m && m[2].includes(':')) continue; // an activated ability ("{2}: Elves you control get …"), not always on
          if (m) {
            const kws = kwList(m[5] || m[6] || '').filter(k => KEYWORDS.includes(k)); // "protection from Dogs" is left to you
            const pow = Number(m[3] || 0);
            const tou = Number(m[4] || 0);
            if (kws.length || pow || tou) lords.push({ src, other: !!m[1], what: m[2], kws, pow, tou });
            continue;
          }
          m = /^(.+?) gets ([+-]\d+)\/([+-]\d+) for each (other )?(.+?) you control\.?$/i.exec(line);
          if (m && isSelf(m[1], src)) { each.push({ src, pow: Number(m[2]), tou: Number(m[3]), other: !!m[4], what: m[5] }); continue; }
          // "Silverwing Squadron's power and toughness are each equal to the number of creatures you control."
          m = /^(.+?)['’]s (power and toughness are each|power is|toughness is) equal to the number of (other )?(.+?) you control\.?$/i.exec(line);
          if (m && isSelf(m[1], src)) each.push({ src, pow: /power/i.test(m[2]) ? 1 : 0, tou: /toughness/i.test(m[2]) ? 1 : 0, other: !!m[3], what: m[4], cda: true });
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
        const cda = { pow: 0, tou: 0 };
        each.filter(e => e.src === c).forEach(e => {
          const n = all.filter(p => !(e.other && p === c) && isA(p, e.what)).length;
          if (e.cda) { cda.pow += e.pow * n; cda.tou += e.tou * n; return; }
          pow += e.pow * n;
          tou += e.tou * n;
        });
        if (each.some(e => e.src === c && e.cda)) c.cda = cda;
        else delete c.cda;
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
      if (m && isSelf(m[1], inst) && /^you become the monarch\.?$/i.test(m[2].trim())) becomeMonarch(s);
      // "This creature enters with a +1/+1 counter on it for each other creature you control." or
      // "… enters with X +1/+1 counters on it, where X is the number of Elves you control." (it doesn't count itself)
      const c = /^(.+?) enters(?: the battlefield)? with (?:an? ([\w+/-]+) counter on it for each (?:other )?(.+?)|x ([\w+/-]+) counters on it, where x is the number of (?:other )?(.+?)) you control\.?$/i.exec(line);
      if (c && isSelf(c[1], inst)) {
        const kind = (c[2] || c[4]).toLowerCase();
        const n = permanents(s).filter(p => p !== inst && isA(p, c[3] || c[5])).length;
        if (n) G.counter(s, inst.iid, kind, n, { effect: true });
        G.log(s, `${inst.name} enters with ${n} ${kind} counter${n === 1 ? '' : 's'}.`);
      }
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

  // ---------- more abilities: attacking, dying, casting, gaining life ----------

  const oracleText = (inst, defOf) => (defOf(inst.id) || {}).oracle || '';
  const kwOf = (inst, defOf) => new Set(inst.bot ? inst.bot.kw || [] : keywords(oracleText(inst, defOf)));
  const pumpBy = (c, pow, tou) => { c.pump = { ...c.pump, pow: (c.pump ? c.pump.pow : 0) + pow, tou: (c.pump ? c.pump.tou : 0) + tou }; };
  const isOpps = (game, s) => !!(game.bot && s === game.bot.s);

  // Runs an effect for whoever controls src: on your table (ctx as for runEffect), or on Opp's with
  // your life as its opponent's. Logs it, with what's left to do by hand. Returns what's left.
  function runFor(game, s, src, text, what, ctx, defOf, times = 1) {
    if (isOpps(game, s)) {
      const target = eff => { oppTarget(game, src, eff, defOf); };
      const left = onOpp(game, t => runEffect(t, text, { self: src, hitOpps: n => { t.oppLife -= n; }, other: game, target }, times));
      G.log(s, `${src.name}: ${what}${times > 1 ? ` (×${times})` : ''}.${left.length ? ` Not done: ${left.join('; ')}.` : ''}`);
      return left;
    }
    const left = runEffect(s, text, Object.assign({ self: src, other: game.bot ? game.bot.s : null }, ctx), times);
    G.log(s, `${src.name}: ${what}${times > 1 ? ` (×${times})` : ''}.${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
    return left;
  }

  // Proliferate on table s: one more of each kind of counter on its permanents (not -1/-1), and on
  // the opponent's table (other, if there is one) one more -1/-1 counter and poison counter.
  function proliferate(s, other) {
    let n = 0;
    for (const c of permanents(s)) {
      for (const [kind, k] of Object.entries(c.counters || {})) if (k > 0 && kind !== '-1/-1') { G.counter(s, c.iid, kind, 1, { effect: true }); n++; }
    }
    if (other) {
      for (const c of permanents(other)) if ((c.counters || {})['-1/-1'] > 0) { G.counter(other, c.iid, '-1/-1', 1, { effect: true }); n++; }
      if (other.poison > 0) { other.poison++; n++; }
    }
    G.log(s, `Proliferated: ${n} counter${n === 1 ? '' : 's'} added.`);
  }

  // The monarch draws a card at the end of their turn, and loses it to a player whose creature
  // deals them combat damage. Each table keeps when it became the monarch (s.monarch); the newest wins.
  function becomeMonarch(s) {
    s.monarch = Date.now();
    G.log(s, 'Became the monarch.');
  }
  // Playing against Opp: 'you', 'opp' or null.
  function monarchOf(game) {
    const a = game.monarch || 0;
    const b = (game.bot && game.bot.s.monarch) || 0;
    if (!a && !b) return null;
    return a >= b ? 'you' : 'opp';
  }
  // who ('you' or 'opp') dealt combat damage to the other: they take the crown if the other had it.
  function takeMonarch(game, who) {
    const holder = monarchOf(game);
    if (!holder || holder === who) return;
    const [to, from] = who === 'you' ? [game, game.bot.s] : [game.bot.s, game];
    to.monarch = Math.max(Date.now(), (from.monarch || 0) + 1);
    delete from.monarch;
    G.log(to, `${who === 'you' ? 'You' : 'Opp'} dealt combat damage to the monarch and became the monarch.`);
  }

  // "After this main phase, there is an additional combat phase": creatures that attacked can attack again.
  function extraCombat(s) {
    creatures(s).forEach(c => { delete c.attackedTurn; });
    delete s.combatTapTurn;
    G.log(s, 'An additional combat phase: creatures that attacked can attack again (once untapped).');
  }

  // Attackers are declared on table s: "whenever this attacks" triggers (combatTrigger), exalted (a
  // creature attacking alone gets +1/+1 for each exalted), battle cry (each other attacker gets
  // +1/+0) and annihilator N (opts.sacrifice(n, why) makes the defending player sacrifice).
  // Returns [[attackerIid, tokenIid]] for tokens that entered attacking.
  function declareAttack(s, insts, defOf, opts = {}) {
    insts = insts.filter(i => i && i.zone === 'battlefield');
    const joined = [];
    insts.forEach(inst => combatTrigger(s, inst, 'attacks', defOf).forEach(iid => joined.push([inst.iid, iid])));
    const stOf = inst => stats(inst, inst.bot || defOf(inst.id));
    if (insts.length === 1) {
      const n = permanents(s).filter(p => (G.isCreature(p) ? stOf(p).kw.has('exalted') : kwOf(p, defOf).has('exalted'))).length;
      if (n) {
        pumpBy(insts[0], n, n);
        G.log(s, `Exalted: ${insts[0].name} attacks alone and gets +${n}/+${n} until end of turn.`);
      }
    }
    const all = [...insts, ...joined.map(([, iid]) => s.cards[iid]).filter(Boolean)];
    for (const inst of insts) {
      const st = stOf(inst);
      if (st.kw.has('battle cry')) {
        all.filter(c => c !== inst).forEach(c => pumpBy(c, 1, 0));
        G.log(s, `${inst.name} (battle cry): each other attacking creature gets +1/+0.`);
      }
      const an = kwN(st, 'annihilator');
      if (an && opts.sacrifice) opts.sacrifice(an, `${inst.name} (annihilator ${an})`);
    }
    return joined;
  }

  // End of combat: decayed creatures that attacked are sacrificed.
  function endOfCombat(s, attackers, defOf) {
    for (const inst of attackers) {
      if (!inst || inst.zone !== 'battlefield' || !stats(inst, inst.bot || defOf(inst.id)).kw.has('decayed')) continue;
      G.log(s, `${inst.name} (decayed) is sacrificed at end of combat.`);
      G.move(s, inst.iid, inst.commander ? 'command' : 'graveyard');
    }
  }

  // Opp sacrifices n permanents: tokens first, then its cheapest cards, lands last (unless it has plenty).
  function oppSacrifices(game, n, why) {
    const s = game.bot.s;
    const lands = permanents(s).filter(G.isLand).length;
    const cost = c => (c.token ? -10 : G.isLand(c) ? (lands >= 6 ? 0 : 50) : (c.bot ? c.bot.cmc : 0) + 1);
    const gone = permanents(s).sort((a, b) => cost(a) - cost(b)).slice(0, n);
    gone.forEach(c => moveOpps(s, c));
    if (gone.length) G.log(game, `${why}: Opp sacrificed ${andList(gone.map(c => c.name))}.`);
  }
  // You sacrifice n permanents: you pick them (app.js shows game.mustSacrifice).
  function youSacrifice(game, n, why) {
    if (!permanents(game).length) return;
    game.mustSacrifice = { n: ((game.mustSacrifice || {}).n || 0) + n, why };
  }

  // "Whenever Blood Artist or another creature dies", "Whenever a creature you control dies",
  // "… or another creature or planeswalker you control dies", "a nontoken creature", "a creature an opponent controls".
  const DIES_WATCH = /^whenever (?:(.+?) or )?(another |an? )(nontoken )?(.+?)( you control| an opponent controls| your opponents control)? dies, (?:you may )?(.+)$/i;

  // Something died on table s (info: { counters it had, to: where it went }). Undying and persist
  // bring it back; afterlife leaves Spirits; Blood Artist and friends on any table trigger.
  function afterDeath(game, s, inst, info, defOf, ctx) {
    const kw = kwOf(inst, defOf);
    const had = info.counters || {};
    if (!inst.token && !inst.faceDown && inst.zone === 'graveyard' && s.cards[inst.iid]) {
      const back = (kw.has('undying') && !(had['+1/+1'] > 0) && '+1/+1') || (kw.has('persist') && !(had['-1/-1'] > 0) && '-1/-1');
      if (back) {
        G.move(s, inst.iid, 'battlefield');
        G.counter(s, inst.iid, back, 1, { effect: true });
        G.log(s, `${inst.name} (${back === '+1/+1' ? 'undying' : 'persist'}) came back with a ${back} counter.`);
      }
    }
    const spirits = (inst.bot ? (inst.bot.n || {}).afterlife : keywordNumbers(oracleText(inst, defOf)).afterlife) || 0;
    if (spirits) triggerTokens(s, inst, `create ${spirits} 1/1 white and black Spirit creature tokens with flying`, 'dies');
    if (!G.isCreature(inst) && !isPlaneswalker(inst)) return;
    for (const t of [game, game.bot && game.bot.s].filter(Boolean)) {
      const watchers = permanents(t).filter(w => w !== inst);
      if (t === s) watchers.push(inst); // "Blood Artist or another creature dies" sees itself die
      for (const w of watchers) {
        for (const line of oracleLines(w, defOf)) {
          const m = DIES_WATCH.exec(line);
          if (!m) continue;
          // The one that died sees itself only with "Blood Artist or another creature".
          if (w === inst && !(m[1] && isSelf(m[1], w))) continue;
          if (m[3] && inst.token) continue;
          if (!m[4].split(/\s+or\s+/).some(x => isA(inst, x))) continue;
          if (m[5] && (/you control/i.test(m[5]) ? t !== s : t === s)) continue;
          runFor(game, t, w, m[6], `${inst.name} died`, t === game ? ctx : null, defOf);
        }
      }
    }
  }

  // "Whenever you cast a noncreature spell", "Magecraft — Whenever you cast or copy an instant or sorcery spell", …
  const CAST_WATCH = /^(?:magecraft\s*[—-]\s*)?whenever you cast (?:or copy )?(?:an? )?(.*?)\s*spells?, (?:you may )?(.+)$/i;

  // A spell was cast on table s (a permanent spell is already on the battlefield, an instant or
  // sorcery may be too): prowess, "whenever you cast" triggers, cascade and storm. ctx: as for runEffect, for yours.
  function spellCast(game, s, spell, defOf, ctx) {
    if (s.spellTurn !== s.turn) { s.spellTurn = s.turn; s.spellsThisTurn = 0; }
    s.spellsThisTurn++;
    // Automatic games keep the turn each card was first cast, for the Auto-test card impact table.
    if (s.trackCasts && spell.id && !(spell.id in (s.casts = s.casts || {}))) s.casts[spell.id] = s.turn;
    if (!G.isCreature(spell)) {
      const prowess = creatures(s, c => c !== spell && stats(c, c.bot || defOf(c.id)).kw.has('prowess'));
      prowess.forEach(c => pumpBy(c, 1, 1));
      if (prowess.length) G.log(s, `Prowess: ${andList(prowess.map(c => c.name))} get${prowess.length === 1 ? 's' : ''} +1/+1 until end of turn.`);
    }
    for (const w of permanents(s)) {
      if (w === spell) continue;
      for (const line of oracleLines(w, defOf)) {
        const m = CAST_WATCH.exec(line);
        if (!m || /\b(first|second)\b/i.test(line) || !spellFits(spell, m[1], defOf)) continue;
        const effect = m[2].trim();
        const p = /^(.+?) gets? ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i.exec(effect);
        if (p && isSelf(p[1], w)) {
          pumpBy(w, Number(p[2]), Number(p[3]));
          G.log(s, `${w.name}: you cast ${spell.name}, so it gets ${p[2]}/${p[3]} until end of turn.`);
        } else if (!pumpSentence(s, w, effect)) runFor(game, s, w, effect, `you cast ${spell.name}`, isOpps(game, s) ? null : ctx, defOf);
      }
    }
    const lines = oracleLines(spell, defOf);
    if (lines.some(l => /^cascade\b/i.test(l))) cascade(game, s, spell, defOf, ctx);
    if (lines.some(l => /^storm\b/i.test(l)) && s.spellsThisTurn > 1) {
      const n = s.spellsThisTurn - 1;
      const text = spellText(spell, defOf);
      if (canRunAll(text, Object.assign({ other: true, hitOpps: true }, ctx))) runFor(game, s, spell, text, 'storm copies', ctx, defOf, n);
      else {
        G.log(s, `${spell.name} (storm): copy it ${n} time${n === 1 ? '' : 's'}. Do the copies by hand.`);
        if (!isOpps(game, s)) s.notice = `${spell.name} has storm: copy it ${n} time${n === 1 ? '' : 's'} (do the copies by hand).`;
      }
    }
  }

  // An instant or sorcery's rules text without its keyword lines (Storm, Cascade).
  const spellText = (spell, defOf) => oracleLines(spell, defOf).filter(l => l && !keywords(l).length).join(' ');

  // Your instant or sorcery whose whole text runEffect can do ("Draw two cards.", "Each opponent
  // loses 3 life.", "Proliferate.", Relentless Assault): it's done and goes to the graveyard.
  // Returns true if it did that.
  function spellResolve(game, s, spell, defOf, ctx) {
    if (!spell || spell.faceDown || spell.zone !== 'battlefield' || !/\b(instant|sorcery)\b/i.test(front(spell.typeLine))) return false;
    const text = spellText(spell, defOf);
    if (!canRunAll(text, Object.assign({ self: spell, other: true }, ctx))) return false;
    runFor(game, s, spell, text, 'resolved', ctx, defOf);
    if (spell.zone === 'battlefield') G.move(s, spell.iid, 'graveyard');
    return true;
  }

  // Cascade: cards come off the top of the library until a nonland card that costs less; that one
  // is cast for free, the rest go on the bottom in a random order. Opp's instants and sorceries are
  // done only if runEffect can do all of them.
  function cascade(game, s, spell, defOf, ctx) {
    const cmcOf = c => (c.bot ? c.bot.cmc : (defOf(c.id) || {}).cmc) || 0;
    const cmc = cmcOf(spell);
    const k = s.zones.library.findIndex(iid => !G.isLand(s.cards[iid]) && cmcOf(s.cards[iid]) < cmc);
    const shown = s.zones.library.splice(0, k < 0 ? s.zones.library.length : k);
    G.shuffleArray(shown);
    if (k < 0) {
      s.zones.library.push(...shown);
      G.log(s, `${spell.name} (cascade): no card that costs less than ${cmc}.`);
      return;
    }
    const hit = s.cards[s.zones.library[0]];
    s.zones.library.push(...shown);
    G.log(s, `${spell.name} (cascade): revealed ${shown.length + 1} and cast ${hit.name} for free.`);
    const opps = isOpps(game, s);
    if (opps && /\b(instant|sorcery)\b/i.test(front(hit.typeLine))) {
      const text = spellText(hit, defOf);
      if (canRunAll(text, { hitOpps: true, other: true })) runFor(game, s, hit, text, 'cast by cascade', null, defOf);
      G.move(s, hit.iid, 'graveyard');
      return;
    }
    G.move(s, hit.iid, 'battlefield', { cast: true }); // yours: game.js tells app.js it was cast
    if (opps) spellCast(game, s, hit, defOf, null);
  }

  // After an action: life gained ("Whenever you gain life, put a +1/+1 counter on Ajani's
  // Pridemate", "… that many …"), unless a card says that player can't gain life (Sulfuric Vortex),
  // in which case the gain is taken back. before: { you, opp } life totals before the action.
  // friends: online, the other players' tableRules (their Erebos counts too).
  function lifeChanged(game, before, defOf, ctx, friends = []) {
    const tables = [{ t: game, key: 'life', was: before.you }];
    if (game.bot && before.opp != null) tables.push({ t: game.bot.s, key: 'oppLife', was: before.opp });
    const rules = tables.map(x => tableRules(x.t, defOf)).concat(friends.map(r => ({ noGain: r.noGain || {} })));
    tables.forEach((x, i) => {
      const gained = game[x.key] - x.was;
      if (!(gained > 0)) return;
      const blocked = rules.some((r, j) => r.noGain.all || (r.noGain.opps && j !== i) || (r.noGain.self && j === i));
      if (blocked) {
        game[x.key] = x.was;
        G.log(x.t, `${x.t === game ? 'You' : 'Opp'} can't gain life, so the ${gained} life is taken back.`);
        return;
      }
      for (const w of permanents(x.t)) {
        for (const line of oracleLines(w, defOf)) {
          const m = /^whenever you gain life( for the first time each turn)?, (?:you may )?(.+)$/i.exec(line);
          if (!m) continue;
          if (m[1] && x.t.gainTurn === x.t.turn) continue;
          runFor(game, x.t, w, m[2].replace(/\bthat much life\b/gi, `${gained} life`).replace(/\bthat many\b/gi, String(gained)), `gained ${gained} life`, x.t === game ? ctx : null, defOf);
        }
      }
      x.t.gainTurn = x.t.turn;
    });
  }

  // ---------- rules that limit attacks and blocks ----------

  // Arboria: "Creatures can't attack a player unless that player cast a spell or put a nontoken
  // permanent onto the battlefield during their last turn." (game.js keeps s.actedTurn.)
  const ARBORIA = /^creatures can't attack a player unless that player cast a spell or put a nontoken permanent onto the battlefield during (?:his or her|their) last turn\.?$/i;
  // Mirri, Weatherlight Duelist: "As long as Mirri is tapped, no more than one creature can attack
  // you each combat." Silent Arbiter: "No more than one creature can attack each combat."
  const ATTACK_CAP = /^(?:as long as (.+?) is (un)?tapped, )?no more than (\w+) creatures? can attack( you)?(?: each combat)?\.?$/i;
  const BLOCK_CAP = /^(?:as long as (.+?) is (un)?tapped, )?no more than (\w+) creatures? can block(?: each combat)?\.?$/i;
  // Mirri: "Whenever Mirri attacks, each opponent can't block with more than one creature this combat."
  const ATTACK_BLOCK_CAP = /^whenever (.+?) attacks, (?:each opponent|defending player) can't block with more than (\w+) creatures? this combat\.?$/i;
  // Ghostly Prison, Propaganda: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."
  const ATTACK_TAX = /^creatures can't attack you(?: or planeswalkers you control)? unless their controller pays \{(\d+)\} for each (?:creature they control that's attacking you|of those creatures)\.?$/i;
  // Thalia: "Noncreature spells cost {1} more to cast." Also "… spells your opponents cast cost {1} more to cast."
  const SPELL_TAX = /^(?:(.+?) )?spells( your opponents cast)? cost \{(\d+)\} more to cast\.?$/i;
  // Sulfuric Vortex, Erebos: "Players can't gain life." / "Your opponents can't gain life."
  // (Sulfuric Vortex's own words: "If a player would gain life, that player gains no life instead.")
  const NO_GAIN = /^(?:(players|your opponents|you) can't gain life|if (a player|an opponent) would gain life, that player gains no life instead)\.?$/i;
  const holds = (who, untapped, inst) => !who || (isSelf(who, inst) && !inst.tapped === !!untapped);
  const lower = (a, n) => (a == null ? n : Math.min(a, n));

  // What one table's own cards say about combat: { arboria: it has one, acted: this player cast a
  // spell or put a nontoken permanent onto the battlefield during their latest turn, attackCap: the
  // most creatures that can attack this player, allAttackCap: … that can attack at all, blockCap }
  // (null: no limit). Online, each player sends theirs with their table.
  // attackTax: what each creature attacking this player costs (Ghostly Prison). spellTaxes: [{ what,
  // n, opps }] (Thalia; opps: only other players' spells). noGain: { all, opps, self }, who can't gain life.
  const NO_GAIN_WHO = { players: 'all', 'a player': 'all', 'your opponents': 'opps', 'an opponent': 'opps', you: 'self' };
  function tableRules(s, defOf) {
    const out = { arboria: false, acted: s.actedTurn === s.turn, attackCap: null, allAttackCap: null, blockCap: null, attackTax: 0, spellTaxes: [], noGain: {} };
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        let m;
        if ((m = ATTACK_TAX.exec(line))) out.attackTax += Number(m[1]);
        else if ((m = SPELL_TAX.exec(line)) && !/\btarget/i.test(line)) out.spellTaxes.push({ what: (m[1] || '').trim(), n: Number(m[3]), opps: !!m[2] });
        else if ((m = NO_GAIN.exec(line))) out.noGain[NO_GAIN_WHO[(m[1] || m[2]).toLowerCase()]] = true;
        else if (ARBORIA.test(line)) out.arboria = true;
        else if ((m = ATTACK_CAP.exec(line)) && holds(m[1], m[2], inst) && toNumber(m[3])) {
          if (m[4]) out.attackCap = lower(out.attackCap, toNumber(m[3]));
          else out.allAttackCap = lower(out.allAttackCap, toNumber(m[3]));
        } else if ((m = BLOCK_CAP.exec(line)) && holds(m[1], m[2], inst) && toNumber(m[3])) out.blockCap = lower(out.blockCap, toNumber(m[3]));
      }
    }
    return out;
  }

  // Attacking one player. all: every table's tableRules; defender: that player's.
  // Returns { cap: the most creatures that can attack them (0: none, Infinity: no limit), why,
  // tax: mana to pay for each one (Ghostly Prison) }.
  function attackRules(all, defender) {
    const tax = defender.attackTax || 0;
    if (!defender.acted && all.some(r => r.arboria)) return { cap: 0, tax, why: "Arboria: they didn't cast a spell or put a nontoken permanent onto the battlefield during their last turn" };
    let cap = defender.attackCap == null ? Infinity : defender.attackCap;
    let why = cap < Infinity ? `no more than ${cap} creature${cap === 1 ? '' : 's'} can attack them each combat` : '';
    const all1 = all.reduce((n, r) => lower(n, r.allAttackCap), null);
    if (all1 != null && all1 < cap) { cap = all1; why = `no more than ${cap} creature${cap === 1 ? '' : 's'} can attack each combat`; }
    if (tax) why = `${why ? why + '; ' : ''}attacking them costs {${tax}} for each creature`;
    return { cap, why, tax };
  }

  // Does a spell fit words like "noncreature", "creature", "instant or sorcery", "multicolored"? ('' fits any.)
  // Words it doesn't know ("kicked", "with mana value 4 or greater") never fit.
  function spellFits(spell, what, defOf) {
    if (!what) return true;
    const types = typeWords(spell);
    const card = (spell.bot && Array.isArray(spell.bot.colors) ? spell.bot : null) || defOf(spell.id) || {};
    const colors = colorsOf(card);
    const word = w => {
      if (w === 'multicolored') return colors.length > 1;
      if (w === 'monocolored') return colors.length === 1;
      if (w === 'colorless') return !colors.length;
      if (PRO_COLORS[w]) return colors.includes(PRO_COLORS[w]);
      const not = /^non-?(.+)$/.exec(w);
      if (not) return !types.includes(singular(not[1]));
      return /^[a-z]+$/.test(w) && types.includes(singular(w));
    };
    return what.toLowerCase().replace(/,/g, '').split(/\s+(?:and\/or|or|and)\s+/)
      .some(alt => alt.split(/\s+/).filter(Boolean).every(word));
  }

  // The extra a spell costs because of Thalia and the like. all: [{ rules, own }], own being the
  // table of whoever casts it.
  const spellTax = (all, spell, defOf) => all.reduce((n, t) => n + t.rules.spellTaxes
    .filter(x => (!x.opps || !t.own) && spellFits(spell, x.what, defOf)).reduce((m, x) => m + x.n, 0), 0);

  // The most creatures a player can block with this combat: from any table (Silent Arbiter) and from
  // the attackers themselves (Mirri attacking). attackers: [inst] on table s. Returns { cap, why } (cap Infinity: no limit).
  function blockRules(all, attackers, defOf) {
    let cap = all.reduce((n, r) => lower(n, r.blockCap), null);
    let why = cap != null ? `no more than ${cap} creature${cap === 1 ? '' : 's'} can block each combat` : '';
    for (const inst of attackers) {
      if (!inst || inst.faceDown) continue;
      for (const line of oracleLines(inst, defOf)) {
        const m = ATTACK_BLOCK_CAP.exec(line);
        const n = m && isSelf(m[1], inst) && toNumber(m[2]);
        if (n && (cap == null || n < cap)) { cap = n; why = `${inst.name} attacked: no blocking with more than ${n} creature${n === 1 ? '' : 's'}`; }
      }
    }
    return { cap: cap == null ? Infinity : cap, why };
  }

  // Both tables' rules when playing against Opp: { you, opp, all }.
  const botRules = (game, defOf) => {
    const you = tableRules(game, defOf);
    const opp = tableRules(game.bot.s, defOf);
    return { you, opp, all: [you, opp] };
  };

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
  // "opponents you have" or "Elves you control" on table s, or null if it's something else.
  function numberOf(s, phrase) {
    const p = phrase.trim().toLowerCase();
    if (/^opponents you have$/.test(p)) return s.opponents || 1;
    const m = /^(.+?) you control$/.exec(p);
    return m ? permanents(s).filter(c => isA(c, m[1])).length : null;
  }
  // Also "create a number of 2/2 white Knight creature tokens with vigilance equal to the number of
  // opponents you have" (or "… of Elves you control"), and X: "create X 1/1 white Soldier creature
  // tokens that are tapped and attacking, where X is the number of opponents you have", "create an
  // X/X green Ooze creature token, where X is the number of creatures you control".
  const TOKEN_TEXT = /^create (a number of|\w+) (\d+|x)\/(\d+|x) ([a-z ,'-]+?) creature tokens?(?: with ([^.]+?))?(?: that(?: are|'s| is) (?:(tapped and )?(attacking)|(blocking) that creature))?(?: equal to the number of (.+?))?(?:,? where x is (?:the number of )?(.+?))?\.?$/i;
  function triggerTokens(s, inst, text, event) {
    const m = TOKEN_TEXT.exec(text);
    if (!m) return null;
    if (/^a number of$/i.test(m[1]) !== !!m[9]) return null;
    const usesX = [m[1], m[2], m[3]].some(v => /^x$/i.test(v));
    if (usesX !== !!m[10]) return null; // an X with nothing saying what it is (or the other way round)
    const x = m[10] ? numberOf(s, m[10]) : 0;
    if (m[10] && x == null) return null; // an X it can't count
    const val = v => (/^x$/i.test(v) ? x : /^\d+$/.test(v) ? Number(v) : toNumber(v));
    const made = m[9] ? numberOf(s, m[9]) : val(m[1]);
    const pow = val(m[2]);
    const tou = val(m[3]);
    if ((m[9] || /^x$/i.test(m[1])) && made === 0) { G.log(s, `${inst.name} ${event}: no tokens to make (X is 0).`); return []; }
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
      const tok = G.createToken(s, { custom: true, name: type, typeLine: `Token Creature — ${type}`, pt: `${pow}/${tou}`, text: abilities }, { quiet: true });
      if (inst.bot) tok.bot = { cost: '', cmc: 0, power: String(pow), toughness: String(tou), kw, colors, spell: null }; // Opp's: the facts botStats reads
      if (tapped) { tok.tapped = true; tok.tappedFor = null; }
      if (joins) out.push(tok.iid);
    }
    const how = !joins ? '' : event === 'blocks' ? ', blocking the same creature' : tapped ? ', tapped and attacking' : ', attacking';
    G.log(s, `${inst.name} ${event}: created ${n} ${pow}/${tou} ${type} token${n === 1 ? '' : 's'}${kw.length ? ` with ${kw.join(', ')}` : ''}${how}${by.length ? ` (doubled by ${by.join(', ')})` : ''}.`);
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
  // Arboria and Mirri (see attackRules) can keep some or all of them home.
  function chooseAttackers(game, defOf) {
    const rules = botRules(game, defOf);
    let { cap } = attackRules(rules.all, rules.you);
    const { tax } = attackRules(rules.all, rules.you);
    if (tax) { // Ghostly Prison: only as many as it can pay for
      let n = 0;
      while (n < 20 && affordable(game.bot.s, `{${tax * (n + 1)}}`, 0)) n++;
      cap = Math.min(cap, n);
    }
    const picked = pickAttackers(game, defOf);
    if (picked.length <= cap) return picked;
    const s = game.bot.s;
    return picked.map(iid => s.cards[iid]).sort((a, b) => value(botStats(b)) - value(botStats(a))).slice(0, cap).map(c => c.iid);
  }

  function pickAttackers(game, defOf) {
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
  // If Opp's spell waits for your answer (s.stack), it returns { waiting: true } and resumeTurn carries on.
  function beginTurn(game, defOf) {
    const bot = game.bot;
    const s = bot.s;
    const notes = [];
    // Your end step: Opp's held removal and card draw.
    notes.push(...oppInstantAt(game, defOf, 'end'));
    game.offTurn = true; // what you play now isn't on your turn (Arboria)
    delete s.offTurn;
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
    return mainOne(game, defOf, notes);
  }

  // Casts what Opp wants in a main phase. Returns true if a spell is waiting on the stack (bot.wait remembers where).
  function mainCasts(game, defOf, notes, phase) {
    for (let i = 0; i < 15; i++) {
      const r = castOne(game, defOf, notes);
      if (!r) break;
      if (r === 'wait') { game.bot.wait = { phase, notes }; return true; }
      refreshGrants(game, defOf);
    }
    return false;
  }

  // Opp's first main phase, then combat.
  function mainOne(game, defOf, notes) {
    const bot = game.bot;
    const s = bot.s;
    if (mainCasts(game, defOf, notes, 'main1')) return { attackers: [], notes, waiting: true };
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
    // Your Ghostly Prison or Propaganda: Opp pays for each attacker (chooseAttackers kept it affordable).
    const { tax } = attackRules(botRules(game, defOf).all, botRules(game, defOf).you);
    if (tax && attackers.length) {
      const paid = onOpp(game, () => G.autoPay(s, `{${tax * attackers.length}}`));
      if (paid) G.log(s, `Opp paid {${tax * attackers.length}} to attack you (${paid.sources.join(', ') || 'floating mana'}).`);
    }
    attackers.forEach(iid => { if (!botStats(s.cards[iid]).kw.has('vigilance')) s.cards[iid].tapped = true; });
    // "Whenever this attacks" triggers, exalted, battle cry, annihilator; tokens that enter attacking join in.
    attackers.push(...declareAttack(s, attackers.map(iid => s.cards[iid]), defOf, { sacrifice: (n, why) => youSacrifice(game, n, why) }).map(([, iid]) => iid));
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

  // Combat damage n to a player from a creature: infect gives poison counters instead of life loss,
  // toxic N adds N poison counters too. Returns { life, poison }.
  const playerHit = (st, n) => ({
    life: n > 0 && !st.kw.has('infect') ? n : 0,
    poison: n > 0 ? (st.kw.has('infect') ? n : 0) + kwN(st, 'toxic') : 0,
  });

  // Damage from infect or wither to creatures is -1/-1 counters, which stay after the turn.
  // Returns how many go on the attacker (a) and on each blocker (b), for the ones that live.
  const witherCounters = (ast, bsts, r) => ({
    a: bsts.reduce((n, st, i) => n + (st.kw.has('infect') || st.kw.has('wither') ? r.b[i].dealt : 0), 0),
    b: bsts.map((st, i) => (ast.kw.has('infect') || ast.kw.has('wither') ? r.b[i].dmg : 0)),
  });

  // Puts those counters on the ones still on the battlefield. aT/bT: the attacker's and blockers' tables.
  function applyWither(aT, a, bT, bl, w) {
    if (w.a && a.zone === 'battlefield') G.counter(aT, a.iid, '-1/-1', w.a, { effect: true });
    bl.forEach((b, i) => { if (w.b[i] && b.zone === 'battlefield') G.counter(bT, b.iid, '-1/-1', w.b[i], { effect: true }); });
  }

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
    let poison = 0;
    const oppHits = []; // Opp's creatures that dealt combat damage to you, for oppCombatDamage
    const lines = [];
    const own = n => `your ${n}`;
    const theirs = n => n;
    const oppDies = a => { if (!regenerates(game, a, defOf, true)) moveOpps(s, a); };
    const yoursDies = b => { if (!regenerates(game, b, defOf, false)) moveYours(game, b, 'graveyard'); };
    // Everyone's stats first: a creature of yours can block more than one (Brave the Sands).
    const plan = pending.attackers.map(iid => s.cards[iid]).filter(a => a && a.zone === 'battlefield').map(a => {
      const bl = [].concat(blocks[a.iid] || []).map(id => game.cards[id]).filter(b => b && b.zone === 'battlefield');
      return { a, st: botStats(a), bl, blockers: bl.map(b => ({ key: b.iid, st: stats(b, defOf(b.id)) })) };
    });
    const results = combatAll(plan);
    for (const [i, { a, st: ast, bl, blockers }] of plan.entries()) {
      const iid = a.iid;
      const bsts = blockers.map(b => b.st);
      const r = results[i];
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
        applyWither(s, a, game, bl, witherCounters(ast, bsts, r));
        if (pw && (pw.counters || {}).loyalty <= 0) moveYours(game, pw, 'graveyard');
        continue;
      }
      const ph = playerHit(ast, hit);
      if (ph.poison) { game.poison = (game.poison || 0) + ph.poison; poison += ph.poison; }
      if (hit) {
        dmg += ph.life;
        oppHits.push({ inst: a, st: ast, card: a.bot });
        if (a.commander) {
          const key = `Opp|${a.name}`;
          game.cmdDamage = game.cmdDamage || {};
          game.cmdDamage[key] = (game.cmdDamage[key] || 0) + hit;
        }
      }
      const px = ph.poison ? ` (${ph.poison} poison)` : '';
      if (!bl.length) { lines.push(`${a.name} hits you for ${hit}${px}${ll}`); continue; }
      lines.push(`${a.name} is blocked by ${blockText(a.name, bl.map(b => b.name), r, own, theirs)}${hit ? `, ${hit} tramples over${px}` : ''}${ll}`);
      if (r.a.dead) oppDies(a);
      bl.forEach((b, i) => { if (r.b[i].dead) yoursDies(b); });
      applyWither(s, a, game, bl, witherCounters(ast, bsts, r));
    }
    game.life -= dmg;
    const msg = `Attacked: ${lines.join('; ')}.${dmg ? ` You took ${dmg} (now ${game.life}).` : ''}${poison ? ` You got ${poison} poison (now ${game.poison}).` : ''}`;
    dealtDamage(game, dmg, defOf);
    G.log(s, msg); // shown in your log as Opp's line
    oppCombatDamage(game, oppHits, defOf);
    if (oppHits.length) takeMonarch(game, 'opp'); // combat damage to the monarch takes it
    endOfCombat(s, plan.map(x => x.a), defOf);
    return msg;
  }

  // Opp's turn after combat: anything it can still cast, then discard down to 7 and empty its mana.
  // Returns its notes; with a spell waiting for your answer (s.stack), resumeTurn finishes the turn.
  function endTurn(game, defOf) {
    return mainTwo(game, defOf, []);
  }

  // After you answer (or let it resolve): Opp's waiting spell resolves, then its turn goes on from
  // where it stopped. Returns what beginTurn would (first main phase) or { notes, ended: true }.
  function resumeTurn(game, defOf) {
    const bot = game.bot;
    const wait = bot.wait || { phase: 'main1', notes: [] };
    delete bot.wait;
    const notes = wait.notes || [];
    if (bot.s.stack) resolveStack(game, defOf, notes);
    refreshGrants(game, defOf);
    if (wait.phase === 'main1') return mainOne(game, defOf, notes);
    const out = mainTwo(game, defOf, notes);
    return { notes: out, ended: !bot.s.stack };
  }

  function mainTwo(game, defOf, notes) {
    const s = game.bot.s;
    if (mainCasts(game, defOf, notes, 'main2')) return notes;
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
    if (monarchOf(game) === 'opp') {
      G.drawCards(s, 1, true);
      G.log(s, 'Opp is the monarch and drew a card.');
    }
    while (s.zones.hand.length > 7) G.move(s, worstInHand(s), 'graveyard');
    G.MANA.forEach(k => { s.mana[k] = 0; });
    G.endOfTurn(s);
    G.endOfTurn(game);
    delete game.offTurn;
    s.offTurn = true;
    G.log(s, 'Opp ended its turn.');
    return notes;
  }

  // Opp blocks your attack and the damage is done. attacks: [{ iid, pw }], your creatures that
  // attack and, for ones going after a planeswalker, which of Opp's. Returns a short summary for a message.
  function resolveYourAttack(game, attacks, defOf) {
    const s = game.bot.s;
    refreshGrants(game, defOf);
    // "Whenever this attacks" triggers, exalted, battle cry, annihilator; tokens that enter attacking
    // go after the same player or planeswalker.
    const list = attacks.map(x => (typeof x === 'string' ? { iid: x } : x));
    const joined = declareAttack(game, list.map(a => game.cards[a.iid]), defOf, { sacrifice: (n, why) => oppSacrifices(game, n, why) })
      .map(([from, iid]) => ({ iid, pw: (list.find(a => a.iid === from) || {}).pw }));
    attacks = list.concat(joined);
    let attackers = attacks.map(x => (typeof x === 'string' ? { iid: x } : x))
      .map(x => ({ inst: game.cards[x.iid], pw: x.pw && s.cards[x.pw] && s.cards[x.pw].zone === 'battlefield' ? s.cards[x.pw] : null }))
      .filter(a => a.inst && a.inst.zone === 'battlefield')
      .map(a => Object.assign(a, { st: stats(a.inst, defOf(a.inst.id)) }))
      .sort((a, b) => b.st.pow - a.st.pow);
    // Opp's instants when you attack: removal on an attacker, before blocks.
    const answered = oppInstantAt(game, defOf, 'attack', attackers);
    attackers = attackers.filter(a => a.inst.zone === 'battlefield');
    // uses: how many attackers it can still block (Brave the Sands gives each one more).
    const free = creatures(s, c => !c.tapped).map(inst => ({ inst, st: botStats(inst), uses: blocksAllowed(s, inst, defOf) }));
    // Mirri attacking (or Silent Arbiter): only so many of Opp's creatures can block.
    const limit = blockRules(botRules(game, defOf).all, attackers.map(a => a.inst), defOf);
    if (limit.why) G.log(game, `${limit.why[0].toUpperCase()}${limit.why.slice(1)}.`);
    const blocks = pickBlocks(attackers, free, game.oppLife, limit.cap, s);

    // Opp's "whenever this blocks" triggers, then everyone's stats again with the pumps.
    // Tokens made "blocking that creature" (Brimaz) block the same attacker.
    for (const list of blocks.values()) [...list].forEach(b => combatTrigger(s, b.inst, 'blocks', defOf).forEach(iid => list.push({ inst: s.cards[iid], st: botStats(s.cards[iid]) })));
    if (blocks.size) {
      attackers.forEach(a => { a.st = stats(a.inst, defOf(a.inst.id)); });
      [...blocks.values()].flat().forEach(b => { b.st = botStats(b.inst); });
    }
    return finishYourAttack(game, attackers, blocks, defOf, answered);
  }

  // How the defending side blocks: kill an attacker without dying, trade for something at least as
  // good, or wall it; chump only when the rest would be lethal. attackers [{ inst, st, pw }], free
  // [{ inst, st, uses }] its untapped creatures, life its life, cap the most creatures that may block
  // (Mirri), defender its table (for landwalk). Returns Map attacker → [blockers].
  function pickBlocks(attackers, free, life, cap, defender) {
    free = [...free];
    const blocks = new Map();
    let room = cap;
    const take = (a, picks) => {
      const fresh = (picks || []).filter(p => !p.used).length;
      if (!picks || !picks.length || fresh > room) return;
      room -= fresh;
      blocks.set(a, picks);
      // One that can block again does so with what it has left: its power after killing this
      // attacker, its toughness after the damage it takes.
      const r = combat(a.st, picks.map(p => p.st));
      picks.forEach((p, i) => {
        p.used = true;
        p.uses--;
        if (p.uses > 0 && !r.b[i].dead) p.st = { ...p.st, pow: Math.max(0, p.st.pow - Math.max(0, a.st.tou)), tou: p.st.tou - r.b[i].dmg };
        else free.splice(free.indexOf(p), 1);
      });
    };
    const byValue = list => [...list].sort((x, y) => value(x.st) - value(y.st));
    const lostIn = (group, r) => group.filter((b, i) => r.b[i].dead).reduce((n, b) => n + value(b.st), 0);
    for (const a of attackers) {
      const can = byValue(free.filter(b => canBlock(b.st, a.st, defender)));
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
      if (incoming() < life) break;
      if (blocks.has(a)) continue;
      const picks = byValue(free.filter(b => canBlock(b.st, a.st, defender))).slice(0, a.st.kw.has('menace') ? 2 : 1);
      if (legalBlock(a.st, picks.length)) take(a, picks);
    }
    return blocks;
  }

  // Your attack after Opp has blocked: the damage, deaths and triggers. answered: what Opp cast first.
  function finishYourAttack(game, attackers, blocks, defOf, answered) {
    const s = game.bot.s;
    const oppDies = b => { if (!regenerates(game, b, defOf, true)) moveOpps(s, b); };
    const yoursDies = a => { if (!regenerates(game, a, defOf, false)) moveYours(game, a, 'graveyard'); };
    let dmg = 0;
    let poison = 0;
    const lines = [];
    const own = n => `your ${n}`;
    const theirs = n => n;
    const hits = []; // your creatures that dealt combat damage to Opp, for "whenever … deals combat damage" cards
    const results = combatAll(attackers.map(a => ({ st: a.st, blockers: (blocks.get(a) || []).map(b => ({ key: b.inst.iid, st: b.st })) })));
    for (const [i, a] of attackers.entries()) {
      if (!a.st.kw.has('vigilance')) a.inst.tapped = true;
      a.inst.attackedTurn = game.turn; // one attack per creature per turn, even if it gets untapped
      const bl = blocks.get(a) || [];
      const r = results[i];
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
        applyWither(game, a.inst, s, bl.map(b => b.inst), witherCounters(a.st, bl.map(b => b.st), r));
        if (!alreadyDead && (a.pw.counters || {}).loyalty <= 0) moveOpps(s, a.pw);
        continue;
      }
      const ph = playerHit(a.st, hit);
      if (ph.poison) { s.poison = (s.poison || 0) + ph.poison; poison += ph.poison; }
      dmg += ph.life;
      if (hit) hits.push({ inst: a.inst, st: a.st, card: defOf(a.inst.id) });
      if (hit && a.inst.commander) {
        game.cmdDealt = game.cmdDealt || {};
        game.cmdDealt[a.inst.name] = (game.cmdDealt[a.inst.name] || 0) + hit;
      }
      const px = ph.poison ? ` (${ph.poison} poison)` : '';
      if (!bl.length) { lines.push(`${a.inst.name} hits Opp for ${hit}${px}${ll}`); continue; }
      lines.push(`${blockedBy()}${hit ? `, ${hit} tramples over${px}` : ''}${ll}`);
      bl.forEach((b, i) => { if (r.b[i].dead) oppDies(b.inst); });
      if (r.a.dead) yoursDies(a.inst);
      applyWither(game, a.inst, s, bl.map(b => b.inst), witherCounters(a.st, bl.map(b => b.st), r));
    }
    game.oppLife -= dmg;
    const first = answered && answered.length ? `Opp ${answered.join(', ')}. ` : '';
    const msg = `${first}You attacked: ${lines.join('; ') || 'nothing left to attack with'}.${dmg ? ` Opp took ${dmg} (now ${game.oppLife}).` : ''}${poison ? ` Opp got ${poison} poison (now ${s.poison}).` : ''}`;
    G.log(game, msg);
    combatDamage(game, hits.filter(h => h.inst.zone === 'battlefield' || h.inst.zone === 'graveyard'), defOf, { hitOpps: n => { game.oppLife -= n; } });
    if (hits.length) takeMonarch(game, 'you');
    endOfCombat(game, attackers.map(a => a.inst), defOf);
    return msg;
  }

  return { KEYWORDS, keywordCounter, tableRules, attackRules, blockRules, botRules, combatAll, blocksAllowed,
    declareAttack, endOfCombat, afterDeath, spellCast, spellResolve, spellTax, lifeChanged, proliferate, monarchOf, takeMonarch,
    extraCombat, playerHit, witherCounters, keywordNumbers, kwN,
    targetEffect, targetFilter, canTarget, applyTarget, damagePlayer, oppTarget, enterEffects,
    setResponder, getResponder, isInstantSpeed, resumeTurn, resolveStack, counterStack, oppCounters, oppInstantAt, pickBlocks, castOptions, castOne, blockTriggers, combatTappers, oppCombatTaps, tapChoices, beginCombat, spellModes, runModes, refreshGrants, spellPump, regenerates, combatTrigger, endStepTriggers, returnable, oppDiscards, colorsOf, create, beginTurn, resolveOppAttack, endTurn, resolveYourAttack, stats, keywords, attachBonus, equipCost, runEffect, dealtDamage, landEntered, creatureEntered, enterTrigger, died, noAttack, silenced, syncAuras, combatDamage, destroyable, activatedAbilities, crewOf, spellEffect, fight, combat, canBlock, legalBlock, toPlayer, lifelinkGain, blockText,
    yourCreatures, botStats, sick, isPlaneswalker, loyaltyOf, damagePlaneswalker };
})();

if (typeof module !== 'undefined') module.exports = Bot;
