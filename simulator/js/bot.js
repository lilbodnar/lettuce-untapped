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
    'landwalk', 'aftermath', 'transmute', 'offspring', 'freerunning'];
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
  // "This creature can't block.", "Goblin Roughrider can't attack or block." about itself.
  const CANT = /^(?!(?:other|enchanted|equipped|each|all|creatures?|target)\b)(?!.*\byou control\b)[^,.]+? can't (attack|block|attack or block)\.?$/i;

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
    for (const l of lines) {
      const c = CANT.exec(l);
      if (c) c[1].toLowerCase().split(' or ').forEach(w => found.add(`can't ${w}`));
    }
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
      // Rune of Mortality: "As long as enchanted permanent is a creature, it has deathtouch." and "…
      // is an Equipment, it has "Equipped creature has deathtouch."" (equipKw, see grantsOnce).
      const al = /^as long as enchanted permanent is an? (creature|equipment), it has (.+?)\.?$/i.exec(line);
      if (al) {
        const q = /^"equipped creature has (.+?)\.?"$/i.exec(al[2]);
        const kw = kwWords(q ? q[1] : al[2]);
        if (/^equipment$/i.test(al[1]) && q) out.equipKw = [...new Set([...(out.equipKw || []), ...kw])];
        else if (/^creature$/i.test(al[1]) && !q) kw.forEach(k => { if (!out.kw.includes(k)) out.kw.push(k); });
        continue;
      }
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
      // Thornbite Staff: 'Equipped creature has "{2}, {T}: This creature deals 1 damage to any target" and "…"'.
      const quoted = has ? [...has[1].matchAll(/"([^"]+)"/g)].map(q => q[1].replace(/\.$/, '')) : [];
      if (quoted.length) out.lines = [...(out.lines || []), ...quoted];
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

  // A two-faced card's text is kept as "Front name: …\n\nBack name: …" (scryfall.js). Its rules
  // are the face that's up: the back once it's flipped (transformed), otherwise the front.
  function faceOracle(oracle, name, flipped) {
    const text = String(oracle || '');
    const names = String(name || '').split(' // ');
    if (names.length < 2 || !text.includes('\n\n')) return text;
    const faces = text.split('\n\n').map((face, i) => (names[i] && face.startsWith(`${names[i]}: `) ? face.slice(names[i].length + 2) : face));
    return faces[flipped ? 1 : 0] || faces[0];
  }

  // Power, toughness and keywords of a creature right now, counters included.
  // card is the Scryfall card for your cards, or the facts stored on Opp's cards.
  function stats(inst, card) {
    card = card || {};
    let pow;
    let tou;
    const pt = inst.custom && /^(\S+)\/(\S+)$/.exec(String(inst.custom.pt || '').trim());
    if (pt) { pow = num(pt[1]); tou = num(pt[2]); } else { pow = num(card.power); tou = inst.baseTou != null ? inst.baseTou : num(card.toughness); } // baseTou: Tree of Redemption's exchange
    const c = inst.counters || {};
    // Any power/toughness counter: +1/+1, -1/-1, or ones you name like +2/+2 or +1/+0.
    for (const [name, n] of Object.entries(c)) {
      const m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(String(name).trim());
      if (m && n) { pow += Number(m[1]) * n; tou += Number(m[2]) * n; }
    }
    if (inst.pump) { pow += inst.pump.pow; tou += inst.pump.tou; } // "gets +X/+X until end of turn"
    if (inst.cda && !pt) { pow += inst.cda.pow; tou += inst.cda.tou; } // */* from its own text, see refreshGrants
    if (inst.anthem) { pow += inst.anthem.pow; tou += inst.anthem.tou; } // from lords, see refreshGrants
    const kw = new Set(card.kw || keywords(faceOracle(card.oracle, card.name, inst.flipped) || (inst.custom && inst.custom.text)));
    for (const [name, n] of Object.entries(c)) { const k = n > 0 && counterKw(name); if (k) kw.add(k); }
    (inst.granted || []).forEach(k => kw.add(k)); // from lords, see refreshGrants
    (inst.extraKw || []).forEach(k => kw.add(k)); // Wall of Stolen Identity's copy "has defender"
    ((inst.pump && inst.pump.kw) || []).forEach(k => kw.add(k)); // "gain trample until end of turn"
    // Equipment and auras attached to it.
    for (const b of Object.values(inst.boosts || {})) {
      pow += b.pow || 0;
      tou += b.tou || 0;
      (b.kw || []).forEach(k => kw.add(k));
      if (b.cantAttack) kw.add("can't attack");
      if (b.cantBlock) kw.add("can't block");
    }
    const n = card.n || keywordNumbers(faceOracle(card.oracle, card.name, inst.flipped) || (inst.custom && inst.custom.text));
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

  // "Assigns combat damage equal to its toughness rather than its power" (Arcades, Doran) and "can
  // attack as though it didn't have defender": given out by grantsOnce as these words in kw.
  const TOUGH_DMG = 'toughness damage';
  const DEFENDER_ATTACKS = 'defender attacks';
  // The combat damage a creature deals: its power, or its toughness with TOUGH_DMG.
  const hitOf = st => (st.kw.has(TOUGH_DMG) ? st.tou : st.pow);

  const value = st => hitOf(st) + st.tou + st.kw.size + st.cmc / 2;

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
  // Defender (unless Arcades lets it attack anyway), or an aura like Arrest on it.
  const noAttack = st => (st.kw.has('defender') && !st.kw.has(DEFENDER_ATTACKS)) || st.kw.has("can't attack");
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
      const aHits = step(a) && !A.dead && hitOf(a) > 0;
      const bHits = bs.map((b, i) => step(b) && !B[i].dead && hitOf(b) > 0);
      if (aHits) {
        let left = hitOf(a);
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
        A.dmg += hitOf(b);
        B[i].dealt += hitOf(b);
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
      let left = Math.max(0, hitOf(b));
      idx.forEach((i, k) => {
        const lethal = b.kw.has('deathtouch') ? 1 : Math.max(0, list[i].st.tou);
        const n = k === idx.length - 1 ? left : Math.min(left, lethal);
        powFor.set(`${key}|${i}`, n);
        left -= n;
      });
    }
    const taken = new Map(); // shared blocker key → { dmg, dt }
    // Its share is already worked out, so it deals that (not its toughness, which is cut down here).
    const asShared = kw => new Set([...kw].filter(k => k !== TOUGH_DMG));
    return list.map((x, i) => {
      const bsts = x.blockers.map(b => (shared(b.key)
        ? { ...b.st, pow: powFor.get(`${b.key}|${i}`), tou: Math.max(1, b.st.tou - (taken.get(b.key) || { dmg: 0 }).dmg), kw: asShared(b.st.kw) }
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
    const oracle = faceOracle(card.oracle, card.name, false); // Opp plays the front face
    return {
      cost: card.manaCost || '',
      cmc: card.cmc || 0,
      power: card.power,
      toughness: card.toughness,
      loyalty: card.loyalty,
      kw: keywords(oracle),
      n: keywordNumbers(oracle),
      colors: colorsOf(card),
      spell: /\b(instant|sorcery)\b/i.test(front(card.typeLine)) ? spellEffect(oracle) || counterSpell(oracle) || plainSpell(oracle) : null,
    };
  }

  // An instant or sorcery runEffect can do all of ("Each opponent loses 3 life.", "Proliferate."): { effect: text }, or null.
  function plainSpell(oracle) {
    const text = String(oracle || '').split('\n').map(l => l.replace(/\([^)]*\)/g, '').trim()).filter(l => l && !keywords(l).length).join(' ');
    if (!text || !canRunAll(text, { hitOpps: true, other: true, target: true })) return null;
    // removal: it destroys, exiles, bounces or burns a target ("Destroy target nonblack creature.")
    const removal = effectParts(text).some(p => { const e = targetEffect(p); return !!e && ['destroy', 'exile', 'bounce', 'damage'].includes(e.action); });
    const wipe = effectParts(text).some(p => CHOOSE_WIPE.test(p) || !!wipeOf(p)); // see wipeGain
    return { effect: text, removal, wipe };
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
  const creatures = (s, pred) => s.zones.battlefield.map(iid => s.cards[iid]).filter(c => G.isCreature(c) && !c.faceDown && !c.phasedOut && (!pred || pred(c))); // phased out (Teferi's Protection): not there
  const sick = (s, inst, st) => inst.enteredTurn === s.turn && !st.kw.has('haste');

  // Runs an action on Opp's table with the real life totals: Opp's own life is game.oppLife,
  // and "each opponent loses" on Opp's table is you. Inside one, another just runs (the totals are
  // already on Opp's table), and addLife changes them there.
  let oppDepth = 0;
  function onOpp(game, fn) {
    const s = game.bot.s;
    if (oppDepth) return fn(s);
    s.life = game.oppLife;
    s.oppLife = game.life;
    oppDepth++;
    let out;
    try { out = fn(s); } finally { oppDepth--; }
    game.oppLife = s.life;
    game.life = s.oppLife;
    delete s.oppHits;
    delete s.notice;
    return out;
  }
  // Changes your life (who 'you') or Opp's ('opp') by n, even in the middle of onOpp.
  function addLife(game, who, n) {
    const s = game.bot && game.bot.s;
    if (oppDepth && s) {
      if (who === 'opp') s.life += n;
      else s.oppLife += n;
    } else if (who === 'opp') game.oppLife += n;
    else game.life += n;
  }
  const lifeOf = (game, who) => {
    const s = game.bot && game.bot.s;
    if (oppDepth && s) return who === 'opp' ? s.life : s.oppLife;
    return who === 'opp' ? game.oppLife : game.life;
  };

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
    // "As this land enters, you may pay 3 life. If you don't, it enters tapped.": Opp pays while it has more than 10.
    const et = s.cards[pick].entersTapped;
    if (et && et.payLife) {
      if (s.life - et.payLife > 10) { s.life -= et.payLife; G.log(s, `Opp paid ${et.payLife} life so ${s.cards[pick].name} entered untapped.`); }
      else s.cards[pick].tapped = true;
    }
  }

  // Opp's fetch lands ("{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or
  // Plains card, put it onto the battlefield, then shuffle") and Evolving Wilds: used right away,
  // when it can pay and keeps more than 5 life.
  function crackFetches(game, defOf) {
    const s = game.bot.s;
    for (const inst of permanents(s).filter(c => G.isLand(c) && !c.tapped)) {
      const ab = activatedAbilities(inst, defOf).find(a => a.sacrifice && !a.discard && !a.remove && searchSpec(effectParts(a.effect)[0]));
      if (!ab || (ab.life && game.oppLife - ab.life <= 5) || (ab.mana && !affordable(s, ab.mana, 0))) continue;
      if (ab.mana) onOpp(game, () => G.autoPay(s, ab.mana));
      if (ab.life) game.oppLife -= ab.life;
      G.move(s, inst.iid, 'graveyard');
      runFor(game, s, inst, ab.effect, 'activated', null, defOf);
    }
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

  const oracleOf = defOf => inst => oracleText(inst, defOf);

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
    for (const zone of moment === 'main' ? ['command', 'hand', 'graveyard'] : ['hand']) {
      for (const iid of s.zones[zone]) {
        const inst = s.cards[iid];
        const f = inst.bot;
        if (zone === 'graveyard' && !graveCast(s, inst, defOf)) continue; // Ebondeath, Dracolich
        const type = front(inst.typeLine);
        if (G.isLand(inst) || /\b(planeswalker|battle)\b/i.test(type) || /\baura\b/i.test(type)) continue;
        const isSpell = /\b(instant|sorcery)\b/i.test(type);
        if (isSpell && !f.spell) continue;
        if (!isSpell && !/\b(creature|artifact|enchantment)\b/i.test(type)) continue;
        if (f.spell && f.spell.counter) continue; // only in answer to your spell (oppCounters)
        if (moment !== 'main' && (!isInstantSpeed(inst, defOf) || !f.spell || !(f.spell.kill || f.spell.damage || f.spell.removal || (moment === 'end' && f.spell.draw)))) continue;
        const tax = (zone === 'command' ? (inst.castCount || 0) * 2 : 0) + spellTax(taxes, inst, defOf);
        if (!affordable(s, f.cost, tax - G.discount(s, inst, oracleOf(defOf)) - selfDiscount(s, inst, defOf))) continue;
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
          // At you only when it's lethal, or you're low and there's no creature worth it (and you don't have hexproof).
          if (f.spell.player && moment !== 'attack' && !playerShielded(game, 'you', defOf) && (game.life <= n || (!target && game.life <= 10 && !held))) target = 'face';
          if (!target) continue;
          priority += target === 'face' ? (game.life <= n ? 20 : -5) : 8;
        } else if (f.spell && f.spell.effect) {
          if (held || !oppCanTargetAll(game, inst, f.spell.effect, defOf)) continue;
          // A board wipe only when it takes clearly more from you than from Opp.
          if (f.spell.wipe) {
            if (wipeGain(game, f.spell.effect, defOf) < 4) continue;
            priority += 10;
          }
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
    onOpp(game, () => G.autoPay(s, inst.bot.cost, tax - G.discount(s, inst, oracleOf(defOf)) - selfDiscount(s, inst, defOf)));
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
      onOpp(game, () => G.move(s, iid, 'battlefield', inst.zone === 'graveyard' ? { cast: true } : {}));
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
    if (/\bcan't be countered\b/i.test((defOf(spell.id) || {}).oracle || '')) return false; // "This spell can't be countered."
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
    counterExtras(game, s, game, (defOf(counter.id) || {}).oracle, `Opp's ${counter.name}`);
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
  // Its other sentences that counterExtras knows are done too (Arcane Denial, An Offer You Can't Refuse); others are ignored.
  function counterSpell(oracle) {
    const text = String(oracle || '').replace(/\([^)]*\)/g, '').trim();
    const m = /^counter target (creature |noncreature )?spell(?: unless its controller pays \{(\d+)\})?\.?(?=\s|$)/im.exec(text);
    if (!m) return null;
    return { counter: { what: m[1] ? m[1].trim() : 'spell', unless: m[2] ? Number(m[2]) : 0 } };
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
    return w === name || w === name.split(',')[0] || w === 'it'
      || /^this (creature|artifact|enchantment|permanent|land|card|token|spell|aura|equipment|vehicle|saga|planeswalker|battle|class|case|room|siege|spacecraft)$/.test(w)
      || (w.length >= 4 && name.startsWith(w + ' ') && /\blegendary\b/i.test(inst.typeLine || '')); // "Ashcoat" for Ashcoat of the Shadow Swarm
  };

  // ---------- your library: search, scry, surveil ----------

  // "Search your library for a basic land card, put it onto the battlefield tapped" (", then shuffle"
  // is a part of its own), "… for up to two basic land cards, reveal those cards, put one onto the
  // battlefield tapped and the other into your hand" (Cultivate), "… for a card, put that card into
  // your hand" (Demonic Tutor). Returns { n, what, to, tapped, rest: { to, tapped } | null } or null.
  const SEARCH = new RegExp(`^search your library for (a|an|up to ${COUNT}) (.*?)\\s*cards?(?:, reveal (?:it|them|that card|those cards))?,? (?:and )?put (?:it|that card|them|those cards|(one)) (onto the battlefield|into your hand)( tapped)?(?: and the other (onto the battlefield|into your hand)( tapped)?)?$`, 'i');
  const SEARCH_WORDS = /^(basic|nonbasic|land|nonland|creature|noncreature|artifact|enchantment|instant|sorcery|planeswalker|legendary|snow|aura|equipment|colorless|[A-Z][a-z]+)$/;
  // Ugin, Eye of the Storms: "Search your library for any number of colorless nonland cards, exile them".
  const SEARCH_EXILE = /^search your library for any number of (.*?)\s*cards?, exile (?:them|those cards)$/i;
  function searchSpec(part) {
    const x = SEARCH_EXILE.exec(String(part).trim().replace(/\.$/, ''));
    if (x && x[1].split(/\s+/).filter(Boolean).every(w => SEARCH_WORDS.test(w))) return { n: 99, what: x[1].trim(), to: 'exile', tapped: false, rest: null };
    // Shield-Wall Sentinel: "… for a creature card with defender, reveal it, …" (kw).
    let text = String(part).trim().replace(/\.$/, '');
    const k = /^(search your library for .*?\bcards?) with ([a-z]+(?: [a-z]+)?)(,.*)$/i.exec(text);
    const kw = k && KEYWORDS.includes(k[2].toLowerCase()) ? k[2].toLowerCase() : null;
    if (kw) text = k[1] + k[3];
    const m = SEARCH.exec(text);
    if (!m) return null;
    const what = m[3].trim();
    // Only words that name a type ("basic land", "Forest", "Plains or Island", "Dragon creature").
    if (what && !what.split(/,\s*(?:or\s+)?|\s+or\s+|\s+/).filter(Boolean).every(w => SEARCH_WORDS.test(w))) return null;
    const n = /^up to/i.test(m[1]) ? toNumber(m[2]) : 1;
    if (!n) return null;
    return { n: m[4] ? 1 + (m[7] ? 1 : 0) : n, what, to: /battlefield/i.test(m[5]) ? 'battlefield' : 'hand', tapped: !!m[6],
      rest: m[7] ? { to: /battlefield/i.test(m[7]) ? 'battlefield' : 'hand', tapped: !!m[8] } : null, ...(kw ? { kw } : {}) };
  }
  // Does a card fit "basic land", "Plains or Island", "Dragon creature"? ('' fits any card.)
  const searchFits = (inst, what) => !what || what.split(/,\s*(?:or\s+)?|\s+or\s+/).map(a => a.trim()).filter(Boolean)
    .some(alt => alt.split(/\s+/).every(w => {
      const basic = /\bbasic\b/i.test(front(inst.typeLine));
      if (/^basic$/i.test(w)) return basic;
      if (/^nonbasic$/i.test(w)) return !basic;
      if (/^colorless$/i.test(w)) return !/\{[^}]*[WUBRG][^}]*\}/i.test(String((inst.bot && inst.bot.cost) || inst.cost || ''));
      const not = /^non(\w+)$/i.exec(w);
      if (not) return !typeWords(inst).includes(singular(not[1]));
      const tw = typeWords(inst);
      return tw.includes(w.toLowerCase()) || tw.includes(singular(w)); // "Plains" is its own singular
    }));
  // spec.kw: a keyword it must have ("with defender"); spec.mv: its mana value (transmute).
  const searchable = (s, spec, defOf = () => null) => s.zones.library.filter(iid => {
    const c = s.cards[iid];
    if (!searchFits(c, spec.what)) return false;
    if (spec.mv != null && ((c.bot ? c.bot.cmc : c.cmc) || 0) !== spec.mv) return false;
    return !spec.kw || (c.bot ? c.bot.kw || [] : keywords(oracleText(c, defOf))).includes(spec.kw);
  });
  // Puts the found cards where the effect says: picks[0] first, the rest where "the other" goes.
  function applySearch(s, spec, picks, src) {
    picks.forEach((iid, i) => {
      const dest = i > 0 && spec.rest ? spec.rest : spec;
      G.move(s, iid, dest.to);
      if (dest.to === 'battlefield' && dest.tapped) { s.cards[iid].tapped = true; s.cards[iid].tappedFor = null; }
    });
    s.lastSearched = [...picks]; // "those cards" (Ugin: "you may cast those cards without paying their mana costs")
    const names = picks.map(iid => s.cards[iid] && s.cards[iid].name).filter(Boolean);
    G.log(s, `${src}: searched the library${names.length ? ` for ${andList(names)}` : ' and found nothing'}.`);
  }
  // What Opp (or an automatic game) takes: lands that add colors its hand needs, else its priciest cards.
  function autoSearch(s, spec, src, defOf) {
    const have = new Set(s.zones.battlefield.flatMap(iid => G.producesOf(s.cards[iid])));
    const wanted = new Set(s.zones.hand.flatMap(iid => String((s.cards[iid].bot || defOf(s.cards[iid].id) || {}).cost || (defOf(s.cards[iid].id) || {}).manaCost || '').match(/[WUBRG]/g) || []));
    const score = iid => {
      const c = s.cards[iid];
      if (G.isLand(c)) return 10 + G.producesOf(c).filter(k => wanted.has(k) && !have.has(k)).length * 3 + G.producesOf(c).length;
      return ((c.bot && c.bot.cmc) || (defOf(c.id) || {}).cmc || 0) + (G.isCreature(c) ? 0.5 : 0);
    };
    const picks = [...new Set(searchable(s, spec, defOf))].sort((a, b) => score(b) - score(a)).slice(0, spec.n);
    applySearch(s, spec, picks, src);
  }

  // Scry N (unwanted cards to the bottom) or surveil N (to the graveyard), the way Opp does it: lands
  // stay while it has fewer than five, spells it can soon cast stay.
  function autoScry(s, n, kind, src, defOf) {
    const top = s.zones.library.slice(0, n);
    const lands = s.zones.battlefield.concat(s.zones.hand).filter(iid => G.isLand(s.cards[iid])).length;
    const away = top.filter(iid => {
      const c = s.cards[iid];
      return G.isLand(c) ? lands >= 5 : ((c.bot && c.bot.cmc) || (defOf(c.id) || {}).cmc || 0) > lands + 2;
    });
    applyScry(s, kind, top, away, src);
  }
  // top: the cards looked at; away: the ones going to the bottom (scry) or the graveyard (surveil).
  function applyScry(s, kind, top, away, src) {
    away.forEach(iid => G.move(s, iid, kind === 'surveil' ? 'graveyard' : 'library', { bottom: true }));
    G.log(s, `${src}: ${kind} ${top.length}, ${away.length} ${kind === 'surveil' ? 'into the graveyard' : 'on the bottom'}.`);
  }

  // The artifact tokens cards make by name, with the text they're printed with. Treasure taps for
  // mana on its own (game.js reads its mana ability); the others you use by hand.
  const ARTIFACT_TOKENS = {
    treasure: '{T}, Sacrifice this artifact: Add one mana of any color.',
    food: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    clue: '{2}, Sacrifice this artifact: Draw a card.',
    blood: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
    gold: 'Sacrifice this artifact: Add one mana of any color.',
    map: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.',
    powerstone: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
  };
  function artifactTokens(s, src, n, kind, tapped) {
    const name = kind[0].toUpperCase() + kind.slice(1).toLowerCase();
    const text = ARTIFACT_TOKENS[kind.toLowerCase()];
    const { n: made, by } = G.tokenCount(s, n);
    for (let i = 0; i < made; i++) {
      const tok = G.createToken(s, { custom: true, name, typeLine: `Token Artifact — ${name}`, pt: '', text, oracle: text }, { quiet: true });
      if (src && src.bot) tok.bot = facts({ typeLine: tok.typeLine, oracle: text });
      if (tapped) tok.tapped = true;
    }
    G.log(s, `${src ? src.name : 'Effect'}: created ${made} ${name} token${made === 1 ? '' : 's'}${by.length ? ` (doubled by ${by.join(', ')})` : ''}.`);
  }
  const kwList = text => String(text || '').toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(Boolean);

  // ---------- board wipes ----------

  // "Destroy all creatures", "… with power 4 or greater", "… with power 2 or less", "… with power
  // greater than or equal to 3". Expel the Interlopers: "Choose a number between 0 and 10. Destroy
  // all creatures with power greater than or equal to the chosen number" (one part, see effectParts).
  const WIPE = /^destroy all creatures(?: with power (?:(\d+|the chosen number) or (greater|less)|(greater|less) than or equal to (\d+|the chosen number)))?\.?$/i;
  const CHOOSE_WIPE = /^choose a number between (\d+) and (\d+)\. (destroy all .+ the chosen number)\.?$/i;
  // { test(st) }: does a creature with these stats get destroyed? null if the text isn't a wipe.
  function wipeOf(text) {
    const m = WIPE.exec(String(text).trim());
    if (!m) return null;
    const n = Number(m[1] || m[4]);
    const dir = (m[2] || m[3] || '').toLowerCase();
    return { test: st => !dir || (dir === 'greater' ? st.pow >= n : st.pow <= n) };
  }
  // The creatures a wipe destroys: on g (whoever's effect it is) and other (the opponent's table, if
  // there is one here). Indestructible ones stay. Returns { mine, theirs }, each [{ c, st, t }].
  function wipeVictims(g, other, text, defOf) {
    const w = wipeOf(text);
    const hit = t => (w && t && t.zones ? creatures(t).map(c => ({ c, t, st: stats(c, c.bot || defOf(c.id)) })).filter(x => w.test(x.st) && !x.st.kw.has('indestructible')) : []);
    return { mine: hit(g), theirs: hit(other) };
  }
  // The number that's best for g's side: the most value destroyed on the other side less its own
  // (the highest number on a tie, which destroys the fewest). Returns { n, net, mine, theirs }.
  function bestNumber(g, other, text, min, max, defOf) {
    const worth = list => list.reduce((k, x) => k + value(x.st), 0);
    let best = null;
    for (let n = max; n >= min; n--) {
      const v = wipeVictims(g, other, text.replace(/the chosen number/gi, String(n)), defOf);
      const net = worth(v.theirs) - worth(v.mine);
      if (!best || net > best.net) best = { n, net, ...v };
    }
    return best;
  }
  // Destroys them (a regeneration shield taps one instead). ctx.other is the opponent's table.
  function destroyAll(g, ctx, text) {
    const defOf = ctx.defOf || (() => null);
    const v = wipeVictims(g, ctx.other, text, defOf);
    const names = [];
    for (const { c, t } of [...v.mine, ...v.theirs]) {
      if (c.regen > 0) {
        c.regen--;
        if (!c.regen) delete c.regen;
        c.tapped = true;
        continue;
      }
      G.move(t, c.iid, c.commander ? 'command' : 'graveyard');
      names.push(c.name);
    }
    G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: destroyed ${names.length ? andList(names) : 'no creatures'}.`);
  }
  // What a board wipe in Opp's spell is worth to Opp, choosing its best number.
  function wipeGain(game, text, defOf) {
    let total = 0;
    for (const part of effectParts(text)) {
      const m = CHOOSE_WIPE.exec(part);
      if (m) total += bestNumber(game.bot.s, game, m[3], Number(m[1]), Number(m[2]), defOf).net;
      else if (wipeOf(part)) total += bestNumber(game.bot.s, game, part, 0, 0, defOf).net;
    }
    return total;
  }

  // The effects runEffect knows: [pattern, do(table, match, ctx), can(match, ctx) if it needs more than the words].
  const EFFECTS = [
    // Board wipes, on every table here. Expel the Interlopers: you pick the number (ctx.chooseNumber,
    // app.js; the wipe waits for it); Opp and automatic games pick the one that's best for them.
    [WIPE, (g, m, ctx) => destroyAll(g, ctx, m[0]), m => !/the chosen number/i.test(m[0])],
    [CHOOSE_WIPE, (g, m, ctx) => {
      const [min, max] = [Number(m[1]), Number(m[2])];
      const src = (ctx.self && ctx.self.name) || 'Effect';
      if (ctx.chooseNumber) {
        ctx.chooseNumber(min, max, src, m[3]);
        return 'pause';
      }
      const { n } = bestNumber(g, ctx.other, m[3], min, max, ctx.defOf || (() => null));
      G.log(g, `${src}: chose ${n}.`);
      destroyAll(g, ctx, m[3].replace(/the chosen number/gi, String(n)));
    }],
    [new RegExp(`^(?:you )?draw ${COUNT} cards?$`, 'i'), (g, m) => G.drawCards(g, toNumber(m[1]))],
    [new RegExp(`^(?:you )?gain ${COUNT} life$`, 'i'), (g, m) => { g.life += toNumber(m[1]); }], // "you may gain 1 life" comes without its "you"
    [new RegExp(`^(?:you )?lose ${COUNT} life$`, 'i'), (g, m) => { g.life -= toNumber(m[1]); }],
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
    // "Create a Treasure token", "create two Food tokens": the artifact tokens every set uses.
    [new RegExp(`^create ${COUNT} (tapped )?(${Object.keys(ARTIFACT_TOKENS).join('|')}) tokens?$`, 'i'), (g, m, ctx) => artifactTokens(g, ctx.self, toNumber(m[1]), m[3], !!m[2])],
    // "This creature gets +2/+0 until end of turn", "Ashcoat gains flying until end of turn" (itself).
    [/^(.+?) gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))? until end of turn$/i, (g, m, ctx) => {
      pumpBy(ctx.self, Number(m[2]), Number(m[3]));
      const kw = kwWords(m[4]);
      if (kw.length) ctx.self.pump.kw = [...new Set([...(ctx.self.pump.kw || []), ...kw])];
    }, (m, ctx) => !!ctx.self && isSelf(m[1], ctx.self) && (!m[4] || kwWords(m[4]).length === kwList(m[4]).length)],
    [/^(.+?) gains (.+?) until end of turn$/i, (g, m, ctx) => {
      ctx.self.pump = { pow: 0, tou: 0, ...ctx.self.pump };
      ctx.self.pump.kw = [...new Set([...(ctx.self.pump.kw || []), ...kwWords(m[2])])];
    }, (m, ctx) => !!ctx.self && isSelf(m[1], ctx.self) && kwWords(m[2]).length > 0 && kwWords(m[2]).length === kwList(m[2]).length],
    // "Creatures you control get +1/+1 until end of turn", "Goblins you control gain haste until end of turn".
    [/^.+? you control (?:get [+-]\d+\/[+-]\d+(?: and gain .+?)?|gain .+?) until end of turn$/i, (g, m, ctx) => pumpSentence(g, ctx.self || { name: 'Effect' }, m[0]),
      m => !/\btarget\b/i.test(m[0])],
    [new RegExp(`^mill ${COUNT} cards?$`, 'i'), (g, m) => { G.mill(g, toNumber(m[1])); }],
    // Searching your library: you pick (ctx.search, app.js); Opp and automatic games pick for themselves.
    [/^search your library .+$/i, (g, m, ctx) => {
      const spec = searchSpec(m[0]);
      const src = (ctx.self && ctx.self.name) || 'Effect';
      if (!ctx.search) return autoSearch(g, spec, src, ctx.defOf || (() => null));
      ctx.search(spec, src);
      return 'pause';
    }, m => !!searchSpec(m[0])],
    [/^(?:then )?shuffle$/i, g => G.shuffle(g)],
    [new RegExp(`^(scry|surveil) ${COUNT}$`, 'i'), (g, m, ctx) => {
      const kind = m[1].toLowerCase();
      const src = (ctx.self && ctx.self.name) || 'Effect';
      if (!ctx.scry) return autoScry(g, toNumber(m[2]), kind, src, ctx.defOf || (() => null));
      ctx.scry(toNumber(m[2]), kind, src);
      return 'pause';
    }],
    [/^untap (.+)$/i, (g, m, ctx) => { ctx.self.tapped = false; ctx.self.tappedFor = null; }, (m, ctx) => !!ctx.self && isSelf(m[1], ctx.self)],
    // Limits on when an ability can be used: you keep to them; nothing to do.
    [/^activate (?:this ability )?only (?:as a sorcery|once each turn|during your turn|during your upkeep|any time you could cast a sorcery)$/i, () => {}],
    // Syr Konrad's "deals 1 damage to each opponent" (damage, so Massacre Girl, Most Wanted sees it).
    [/^.+? deals (\w+) damage to each opponent$/i, (g, m, ctx) => ctx.hitOpps(toNumber(m[1]), true), (m, ctx) => !!ctx.hitOpps && toNumber(m[1]) > 0],
    // Agent of the Fates: "each opponent sacrifices a creature of their choice".
    [new RegExp(`^each opponent sacrifices ${COUNT} (.+?) of their choice$`, 'i'), (g, m, ctx) => ctx.oppsSacrifice(toNumber(m[1]), singular(m[2])), (m, ctx) => !!ctx.oppsSacrifice],
    // Unstoppable Slasher: "they lose half their life, rounded up" (the player it hit).
    [/^(?:they|that player) loses? half (?:their|his or her) life, rounded up$/i, (g, m, ctx) => ctx.loseHalf(), (m, ctx) => !!ctx.loseHalf],
    // Drana: "put a +1/+1 counter on each attacking creature you control".
    [new RegExp(`^put ${COUNT} ([\\w+/-]+) counters? on each attacking creature you control$`, 'i'), (g, m) => {
      const who = creatures(g, c => c.attacking);
      who.forEach(c => G.counter(g, c.iid, m[2].toLowerCase(), toNumber(m[1]), { effect: true }));
      G.log(g, `${m[1]} ${m[2]} counter${toNumber(m[1]) === 1 ? '' : 's'} on each attacking creature (${who.length}).`);
    }],
    // Massacre Girl: "each other creature gets -1/-1 until end of turn", "each creature other than Massacre Girl gets …".
    [/^each (other )?creatures?(?: other than (.+?))? gets? ([+-]\d+)\/([+-]\d+) until end of turn$/i, (g, m, ctx) => {
      const skip = c => (m[1] || (m[2] && isSelf(m[2], ctx.self || {}))) && ctx.self && c.iid === ctx.self.iid && c.name === ctx.self.name;
      const hit = [g, ctx.other].filter(t => t && t.zones).flatMap(t => creatures(t).filter(c => !skip(c)));
      hit.forEach(c => pumpBy(c, Number(m[3]), Number(m[4])));
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: ${hit.length} creature${hit.length === 1 ? '' : 's'} get ${m[3]}/${m[4]} until end of turn.`);
    }],
    // Massacre Girl: "Whenever a creature dies this turn, …" lasts until the turn ends (afterDeath runs it).
    [/^whenever a creature dies this turn, (.+)$/i, (g, m, ctx) => {
      g.delayed = [...(g.delayed || []), { on: 'dies', effect: m[1], src: ctx.self ? ctx.self.iid : null, name: ctx.self ? ctx.self.name : 'Effect' }];
    }],
    // The Sibsig Ceremony: "destroy that creature" (the one that entered).
    [/^destroy (?:that creature|it|this creature)$/i, (g, m, ctx) => {
      const c = ctx.self;
      if (c.zone !== 'battlefield') return;
      if (stats(c, c.bot || (ctx.defOf || (() => null))(c.id)).kw.has('indestructible')) return G.log(g, `${c.name} is indestructible.`);
      G.move(g, c.iid, c.commander ? 'command' : 'graveyard');
    }, (m, ctx) => !!ctx.self && !!ctx.self.iid],
    // Blot Out: the opponent exiles their creature or planeswalker with the greatest mana value.
    [/^target opponent exiles an? (.+?) they control with the greatest mana value among .+? they control$/i, (g, m, ctx) => ctx.oppsExileGreatest(m[1]), (m, ctx) => !!ctx.oppsExileGreatest],
    // Bojuka Bog, Boggart Trawler: the opponent's graveyard (the one worth exiling).
    [/^exile target (?:player|opponent)'s graveyard$/i, (g, m, ctx) => ctx.exileGrave(), (m, ctx) => !!ctx.exileGrave],
    // Appetite for Brains: "Target opponent reveals their hand. You choose a card from it with mana value 4 or greater and exile that card."
    [/^target opponent reveals (?:their|his or her) hand$/i, () => {}, (m, ctx) => !!ctx.oppsHandPick],
    [/^you choose an? (?:(nonland|creature|noncreature|nonland, noncreature|instant or sorcery) )?card from it(?: with mana value (\d+) or greater)? and (exile|discard)s? that card$/i,
      (g, m, ctx) => ctx.oppsHandPick({ what: m[1] || '', mv: Number(m[2] || 0), to: m[3].toLowerCase() === 'exile' ? 'exile' : 'graveyard' }), (m, ctx) => !!ctx.oppsHandPick],
    // Baleful Mastery: its other cost is picked when you cast it (app.js); an opponent draws if it was.
    [/^you may pay ((?:\{[^}]+\})+) rather than pay this spell's mana cost$/i, () => {}],
    [/^if the ((?:\{[^}]+\})+) cost was paid, an opponent draws (\w+) cards?$/i, (g, m, ctx) => { if (ctx.self && ctx.self.altPaid) ctx.oppsDraw(toNumber(m[2])); }, (m, ctx) => !!ctx.oppsDraw],
    // Junji: "Each opponent discards two cards and loses 2 life."
    [new RegExp(`^each opponent discards ${COUNT} cards?(?: and loses ${COUNT} life)?$`, 'i'), (g, m, ctx) => {
      ctx.oppsDiscard(toNumber(m[1]));
      if (m[2]) ctx.hitOpps(toNumber(m[2]));
    }, (m, ctx) => !!ctx.oppsDiscard && (!m[2] || !!ctx.hitOpps)],
    // Ob Nixilis, the Fallen: "have target player lose 3 life".
    [new RegExp(`^have target (?:player|opponent) lose ${COUNT} life$`, 'i'), (g, m, ctx) => (ctx.hitTarget || ctx.hitOpps)(toNumber(m[1])), (m, ctx) => !!(ctx.hitTarget || ctx.hitOpps)],
    // Syr Konrad: "Each player mills a card."
    [new RegExp(`^each player mills ${COUNT} cards?$`, 'i'), (g, m, ctx) => {
      G.mill(g, toNumber(m[1]));
      if (ctx.other && ctx.other.zones) G.mill(ctx.other, toNumber(m[1]));
      else if (ctx.othersMill) ctx.othersMill(toNumber(m[1]));
    }],
    // The Immortal Sun: "At the beginning of your draw step, draw an additional card."
    [/^draw an additional card$/i, g => { G.drawCards(g, 1); }],
    // Ugin, Eye of the Storms' "0: Add {C}{C}{C}." (a loyalty ability, so not tapping for mana).
    [/^add ((?:\{[WUBRGC]\})+)$/i, (g, m) => { m[1].toUpperCase().match(/[WUBRGC]/g).forEach(k => { g.mana[k] = (g.mana[k] || 0) + 1; }); }],
    // Ugin, the Spirit Dragon's −X: "Exile each permanent with mana value X or less that's one or more colors." (X filled in when you activate it)
    [/^exile each (nonland )?permanent with mana value (\d+) or less that's one or more colors$/i, (g, m, ctx) => {
      const gone = [];
      for (const t of [g, ctx.other].filter(x => x && x.zones)) {
        for (const c of permanents(t)) {
          const card = c.bot || (ctx.defOf || (() => null))(c.id) || {};
          if (!colorsOf(card).length || (card.cmc || 0) > Number(m[2]) || (m[1] && G.isLand(c))) continue;
          G.move(t, c.iid, c.commander ? 'command' : 'exile');
          gone.push(c.name);
        }
      }
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: exiled ${gone.length ? andList(gone) : 'nothing'}.`);
    }],
    // Ugin, Eye of the Storms' −11: the cards it exiled can be cast for free this turn (app.js offers it from exile).
    [/^until end of turn, you may cast those cards without paying their mana costs$/i, g => {
      (g.lastSearched || []).forEach(iid => { if (g.cards[iid] && g.cards[iid].zone === 'exile') g.cards[iid].playable = { free: true }; });
    }],
    // Reno and Rude: "exile the top card of that player's library", then "you may sacrifice another
    // creature or artifact to play the exiled card this turn" (see settleIfYouDo).
    [/^exile the top card of that player's library$/i, (g, m, ctx) => ctx.exileTop(ctx.self), (m, ctx) => !!ctx.exileTop],
    [/^you may sacrifice another (.+?) to play the exiled card this turn$/i, (g, m, ctx) => ctx.sacToPlay(m[1], ctx.self), (m, ctx) => !!ctx.sacToPlay],
    // "Choose one —" on a trigger (Retreat to Hagra, Junji): you tick the mode (ctx.chooseModes,
    // app.js); Opp and automatic games pick one themselves.
    [/^choose (one|two|three|one or both|one or more)\s*[—-]?$/i, (g, m, ctx) => {
      const modes = oracleLines(ctx.self, ctx.defOf).filter(l => /^•/.test(l)).map(l => l.replace(/^•\s*/, ''));
      const pick = /both|more/i.test(m[1]) ? modes.length : toNumber(m[1]) || 1;
      if (ctx.chooseModes) { ctx.chooseModes(modes, pick, ctx.self); return 'pause'; }
      const chosen = autoModes(g, modes, pick, ctx);
      for (const mode of chosen) runEffect(g, mode, ctx);
      G.log(g, `${ctx.self.name}: chose "${chosen.join('" and "')}".`);
    }, (m, ctx) => !!ctx.self && !!ctx.defOf],
    // Huatli, Last March of the Ents: "equal to the greatest toughness among creatures you control".
    [/^(?:you )?(gain life|draw cards) equal to the greatest (power|toughness) among creatures you control$/i, (g, m, ctx) => {
      const n = Math.max(0, ...creatures(g).map(c => { const st = stats(c, c.bot || (ctx.defOf || (() => null))(c.id)); return /power/i.test(m[2]) ? st.pow : st.tou; }));
      if (/life/i.test(m[1])) g.life += n;
      else G.drawCards(g, n);
      G.log(g, `${/life/i.test(m[1]) ? 'Gained' : 'Drew'} ${n} (the greatest ${m[2].toLowerCase()} among your creatures).`);
    }],
    // The Battle of Bywater: "Then create a Food token for each creature you control."
    [new RegExp(`^(?:then )?create an? (${Object.keys(ARTIFACT_TOKENS).join('|')}) token for each (.+?) you control$`, 'i'), (g, m, ctx) => {
      const n = permanents(g).filter(c => isA(c, m[2])).length;
      if (n) artifactTokens(g, ctx.self, n, m[1]);
    }],
    // Towering Titan: "All creatures gain trample until end of turn."
    [/^all creatures (?:gain (.+?)|get ([+-]\d+)\/([+-]\d+)) until end of turn$/i, (g, m, ctx) => {
      const kw = kwWords(m[1]);
      [g, ctx.other].filter(t => t && t.zones).forEach(t => creatures(t).forEach(c => {
        pumpBy(c, Number(m[2] || 0), Number(m[3] || 0));
        if (kw.length) c.pump.kw = [...new Set([...(c.pump.kw || []), ...kw])];
      }));
    }, m => !m[1] || kwWords(m[1]).length === kwList(m[1]).length],
    // Flumph: "you and target opponent each draw a card".
    [new RegExp(`^you and target opponent each draw ${COUNT} cards?$`, 'i'), (g, m, ctx) => { G.drawCards(g, toNumber(m[1])); ctx.oppsDraw(toNumber(m[1])); }, (m, ctx) => !!ctx.oppsDraw],
    // Tree of Redemption: "Exchange your life total with this creature's toughness."
    [/^exchange your life total with (.+?)'s toughness$/i, (g, m, ctx) => {
      const tou = stats(ctx.self, ctx.self.bot || (ctx.defOf || (() => null))(ctx.self.id)).tou;
      const life = g.life;
      const extra = tou - (ctx.self.baseTou != null ? ctx.self.baseTou : num(((ctx.self.bot || (ctx.defOf || (() => ({})))(ctx.self.id)) || {}).toughness));
      ctx.self.baseTou = life - extra; // its toughness becomes your life total (counters and pumps still count on top)
      g.life = tou;
      G.log(g, `${ctx.self.name}: life ${life} ↔ toughness ${tou}.`);
    }, (m, ctx) => !!ctx.self && isSelf(m[1], ctx.self)],
    // Dawn: "Return all creature cards with power 2 or less from your graveyard to your hand."
    [/^return all (.+?) cards with (power|toughness|mana value) (\d+) or (less|greater) from your graveyard to your hand$/i, (g, m, ctx) => {
      const defOf = ctx.defOf || (() => null);
      const val = c => { const card = c.bot || defOf(c.id) || {}; return /mana/i.test(m[2]) ? card.cmc || 0 : num(/power/i.test(m[2]) ? card.power : card.toughness); };
      const back = g.zones.graveyard.filter(iid => cardFits(g.cards[iid], m[1]) && (/less/i.test(m[4]) ? val(g.cards[iid]) <= Number(m[3]) : val(g.cards[iid]) >= Number(m[3])));
      back.forEach(iid => G.move(g, iid, 'hand'));
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: returned ${back.length} card${back.length === 1 ? '' : 's'} to your hand.`);
    }],
    // Slaughter the Strong: each player keeps creatures with total power 4 or less (the most valuable
    // such group, worked out for everyone) and sacrifices the rest.
    [/^each player chooses any number of creatures they control with total power (\d+) or less$/i, (g, m, ctx) => {
      for (const t of [g, ctx.other].filter(x => x && x.zones)) {
        const list = creatures(t).map(c => ({ c, st: stats(c, c.bot || (ctx.defOf || (() => null))(c.id)) }));
        const keep = keepByPower(list, Number(m[1]));
        const gone = list.filter(x => !keep.includes(x));
        gone.forEach(x => G.move(t, x.c.iid, x.c.commander ? 'command' : 'graveyard'));
        G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: ${t === g ? 'you' : 'Opp'} kept ${keep.map(x => x.c.name).join(', ') || 'nothing'}${gone.length ? ` and sacrificed ${andList(gone.map(x => x.c.name))}` : ''}.`);
      }
    }],
    [/^sacrifices all other creatures they control$/i, () => {}],
    // Wave of Reckoning: "Each creature deals damage to itself equal to its power."
    [/^each creature deals damage to itself equal to its power$/i, (g, m, ctx) => {
      const defOf = ctx.defOf || (() => null);
      const game = g.bot ? g : ctx.other && ctx.other.bot ? ctx.other : null;
      for (const t of [g, ctx.other].filter(x => x && x.zones)) {
        for (const c of creatures(t)) {
          const st = stats(c, c.bot || defOf(c.id));
          if (st.pow <= 0 || preventsDamage(t, c, defOf)) continue;
          if (st.kw.has('lifelink') && game) addLife(game, t === game ? 'you' : 'opp', st.pow);
          if (st.kw.has('indestructible') || !(st.kw.has('deathtouch') || st.pow >= st.tou)) continue;
          if (game && regenerates(game, c, defOf, t !== game)) continue;
          G.move(t, c.iid, c.commander ? 'command' : 'graveyard');
        }
      }
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: each creature dealt damage to itself equal to its power.`);
    }],
    // Teferi's Protection (until your next turn, see G.nextTurn).
    [/^until your next turn, your life total can't change$/i, g => { g.untilNextTurn = { ...g.untilNextTurn, lifeLock: true }; }],
    [/^you gain protection from everything$/i, g => { g.untilNextTurn = { ...g.untilNextTurn, protection: true }; }],
    [/^all permanents you control phase out$/i, g => {
      g.zones.battlefield.forEach(iid => { g.cards[iid].phasedOut = true; });
      G.log(g, 'All your permanents phased out until your next turn.');
    }],
    // "Exile Teferi's Protection." / "This spell can't be countered." (Dovin's Veto, Last March of the Ents: Opp never counters it).
    [/^exile (.+)$/i, (g, m, ctx) => { if (ctx.self.iid && g.cards[ctx.self.iid]) G.move(g, ctx.self.iid, 'exile'); }, (m, ctx) => !!ctx.self && (isSelf(m[1], ctx.self) || /^this spell$/i.test(m[1]))],
    [/^this spell can't be countered$/i, () => {}],
    // Eerie Interlude: "Exile any number of target creatures you control. Return those cards to the
    // battlefield under their owner's control at the beginning of the next end step." You pick (ctx.flicker).
    [/^exile any number of target (.+?) you control$/i, (g, m, ctx) => { ctx.flicker(m[1], ctx.self); return 'pause'; }, (m, ctx) => !!ctx.flicker],
    [/^return those cards to the battlefield under their owner's control at the beginning of the next end step$/i, () => {}],
    // Wall of Frost: "that creature doesn't untap during its controller's next untap step" (the one it blocked).
    [/^that creature doesn't untap during its controller's next untap step$/i, (g, m, ctx) => { ctx.blocked.skipUntap = true; G.log(g, `${ctx.blocked.name} won't untap during its controller's next untap step.`); }, (m, ctx) => !!ctx.blocked],
    // Wall of Junk: "return it to its owner's hand at end of combat".
    [/^return (?:it|this creature) to its owner's hand at end of combat$/i, (g, m, ctx) => { ctx.self.bounceAfterCombat = true; }, (m, ctx) => !!ctx.self],
    // Pack Rat: "Create a token that's a copy of this creature."
    [/^create a token that's a copy of (.+)$/i, (g, m, ctx) => { G.copyAsToken(g, ctx.self.iid); }, (m, ctx) => !!ctx.self && isSelf(m[1], ctx.self)],
    // Herald's Horn (see settleIfYouDo): the top card goes to your hand if it fits.
    [/^take the top card of your library if it's an? (.+?) card( of the chosen type)?$/i, (g, m, ctx) => {
      const top = g.cards[g.zones.library[0]];
      if (!top) return;
      const fits = cardFits(top, m[1]) && (!m[2] || (ctx.self && ctx.self.chosenType && isA(top, ctx.self.chosenType)));
      if (fits) G.move(g, top.iid, 'hand');
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: the top card is ${top.name}${fits ? ', so it went to your hand' : ''}.`);
    }],
    // Karumonix (see settleIfYouDo): "dig 5 for any number of Rat cards". You pick (ctx.dig); Opp takes them all.
    [/^dig (\w+) for (any number of|an?|up to \w+) (.+?) cards$/i, (g, m, ctx) => {
      const n = toNumber(m[1]);
      const max = /any number/i.test(m[2]) ? 99 : toNumber(m[2].replace(/^up to /i, '')) || 1;
      const top = g.zones.library.slice(0, n);
      const fits = top.filter(iid => cardFits(g.cards[iid], m[3]));
      if (ctx.dig) { ctx.dig({ top, fits, max, what: m[3] }, ctx.self); return 'pause'; }
      applyDig(g, top, fits.slice(0, max), (ctx.self && ctx.self.name) || 'Effect');
    }],
    // Lord Skitter's Butcher (see settleIfYouDo): sacrifice another creature, then the rest. You pick
    // (ctx.sacThen); Opp only sacrifices a token, then does the rest.
    [/^sacrifice another (.+?) to do "(.+)"$/i, (g, m, ctx) => {
      if (ctx.sacThen) { ctx.sacThen(m[1], m[2], ctx.self); return 'pause'; }
      const tok = permanents(g).filter(c => c.token && c !== ctx.self && cardFits(c, m[1]))[0];
      if (!tok) return;
      G.move(g, tok.iid, 'graveyard');
      runEffect(g, m[2], ctx);
    }],
    // Kindred Dominance: "Choose a creature type. Destroy all creatures that aren't of the chosen type."
    // The type picked is the one that's best for whoever cast it (their own most valuable type).
    [/^choose a creature type$/i, (g, m, ctx) => {
      if (!ctx.self) return;
      ctx.self.chosenType = bestOwnType(creatures(g), ctx.defOf || (() => null));
      if (ctx.self.chosenType) G.log(g, `${ctx.self.name}: chose ${ctx.self.chosenType}.`);
    }],
    [/^destroy all creatures that aren't of the chosen type$/i, (g, m, ctx) => {
      const type = ctx.self && ctx.self.chosenType;
      const defOf = ctx.defOf || (() => null);
      const game = g.bot ? g : ctx.other && ctx.other.bot ? ctx.other : null;
      const gone = [];
      for (const t of [g, ctx.other].filter(x => x && x.zones)) {
        for (const c of creatures(t)) {
          if (type && isA(c, type)) continue;
          if (stats(c, c.bot || defOf(c.id)).kw.has('indestructible') || (game && regenerates(game, c, defOf, t !== game))) continue;
          G.move(t, c.iid, c.commander ? 'command' : 'graveyard');
          gone.push(c.name);
        }
      }
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: destroyed ${gone.length ? andList(gone) : 'nothing'}.`);
    }],
    // Patriarch's Bidding: each player picks their best type in their graveyard; every creature card of
    // either type comes back.
    [/^each player chooses a creature type$/i, (g, m, ctx) => {
      if (!ctx.self) return;
      const grave = t => t.zones.graveyard.map(iid => t.cards[iid]).filter(c => /\bcreature\b/i.test(front(c.typeLine)));
      ctx.self.chosenTypes = [g, ctx.other].filter(t => t && t.zones).map(t => bestOwnType(grave(t), ctx.defOf || (() => null), true)).filter(Boolean);
      G.log(g, `${ctx.self.name}: the types chosen are ${ctx.self.chosenTypes.join(' and ') || 'none'}.`);
    }],
    [/^each player returns all creature cards of a type chosen this way from their graveyard to the battlefield$/i, (g, m, ctx) => {
      const types = (ctx.self && ctx.self.chosenTypes) || [];
      for (const t of [g, ctx.other].filter(x => x && x.zones)) {
        const back = t.zones.graveyard.filter(iid => /\bcreature\b/i.test(front(t.cards[iid].typeLine)) && types.some(ty => isA(t.cards[iid], ty)));
        back.forEach(iid => G.move(t, iid, 'battlefield', { put: true }));
        if (back.length) G.log(t, `${(ctx.self && ctx.self.name) || 'Effect'}: returned ${back.length} creature card${back.length === 1 ? '' : 's'} to the battlefield.`);
      }
    }],
    // Lord Skitter, Sewer King: "exile up to one target card from an opponent's graveyard" (their best one).
    [/^exile (?:up to one )?target card from an opponent's graveyard$/i, (g, m, ctx) => {
      const t = ctx.other && ctx.other.zones ? ctx.other : null;
      if (!t) return false;
      const cmc = c => ((c.bot ? c.bot.cmc : ((ctx.defOf || (() => null))(c.id) || {}).cmc) || 0) + (/\bcreature\b/i.test(front(c.typeLine)) ? 5 : 0);
      const pick = t.zones.graveyard.map(iid => t.cards[iid]).sort((a, b) => cmc(b) - cmc(a))[0];
      if (pick) { G.move(t, pick.iid, 'exile'); G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: exiled ${pick.name} from the opponent's graveyard.`); }
    }],
    // Crypt Rats: "This creature deals X damage to each creature and each player." (X filled in when activated)
    [/^.+? deals (\d+) damage to each creature and each player$/i, (g, m, ctx) => {
      const n = Number(m[1]);
      const defOf = ctx.defOf || (() => null);
      const game = g.bot ? g : ctx.other && ctx.other.bot ? ctx.other : null;
      for (const t of [g, ctx.other].filter(x => x && x.zones)) {
        for (const c of creatures(t)) {
          if (preventsDamage(t, c, defOf)) continue;
          const st = stats(c, c.bot || defOf(c.id));
          if (game) creatureDamaged(game, t, c, n, defOf);
          if (n > 0 && st.tou <= n && !st.kw.has('indestructible') && !(game && regenerates(game, c, defOf, t !== game))) G.move(t, c.iid, c.commander ? 'command' : 'graveyard');
        }
      }
      g.life -= n;
      if (ctx.hitOpps) ctx.hitOpps(n, true);
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: ${n} damage to each creature and each player.`);
    }],
    [/^spend only (\w+) mana on (?:x|\d+)$/i, () => {}], // paid that way when activated (app.js)
    // Three Tree City: "{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of
    // creatures you control of the chosen type." The color is the one your hand needs most.
    [/^choose a color$/i, (g, m, ctx) => { ctx.chosenColor = neededColor(g); }],
    [/^add an amount of mana of that color equal to the number of creatures you control of the chosen type$/i, (g, m, ctx) => {
      const k = ctx.chosenColor || neededColor(g);
      const n = creatures(g).filter(c => ctx.self && ctx.self.chosenType && isA(c, ctx.self.chosenType)).length;
      g.mana[k] = (g.mana[k] || 0) + n;
      G.log(g, `${(ctx.self && ctx.self.name) || 'Effect'}: added ${n} {${k}}.`);
    }],
    // Rat King, Verminister: "Return target creature card and all other cards with the same name as that
    // card from your graveyard to the battlefield tapped."
    [/^return target (.+?) card and all other cards with the same name as that card from your graveyard to the battlefield( tapped)?$/i, (g, m, ctx) => {
      const spec = { min: 1, max: 1, what: m[1].toLowerCase(), from: 'mine', to: 'battlefield', tapped: !!m[2], counters: null, sameName: true };
      if (ctx.moveCards) { ctx.moveCards(spec, ctx.self); return 'pause'; }
      autoMoveCards(g, ctx.other, spec, ctx.self, ctx.defOf || (() => null));
    }],
    // Cards from a graveyard (or your hand) to your hand or the battlefield: Liliana, Junji,
    // Archenemy's Charm, Ugin's −10, The Darkness Crystal. You pick (ctx.moveCards, app.js); Opp picks its best.
    [/^.+$/, (g, m, ctx) => {
      const spec = cardMoveSpec(m[0]);
      if (ctx.moveCards) { ctx.moveCards(spec, ctx.self); return 'pause'; }
      autoMoveCards(g, ctx.other, spec, ctx.self, ctx.defOf || (() => null));
    }, m => !!cardMoveSpec(m[0])],
    // "Destroy target creature", "deals 3 damage to any target"…: ctx.target(effect) picks the target
    // (you're asked; Opp picks its own). See targetEffect.
    // "another target …" and "… other than this creature" can't pick the card itself (eff.exclude);
    // "destroy up to two target creatures" asks twice.
    [/^.+$/, (g, m, ctx) => {
      const eff = targetEffect(m[0]);
      if (ctx.self && ctx.self.iid) {
        eff.srcIid = ctx.self.iid;
        if (eff.another || (targetFilter(eff.what) || {}).notSelf) eff.exclude = ctx.self.iid;
        const card = ctx.self.bot || (ctx.defOf && ctx.defOf(ctx.self.id));
        if (card) eff.colors = colorsOf(card); // for protection from a color
      }
      for (let i = 0; i < (eff.count || 1); i++) ctx.target(eff, m[0], ctx.self);
    }, (m, ctx) => !!ctx.target && !!targetEffect(m[0])],
  ];

  // ---------- cards from graveyards, your hand or exile ----------

  // "Return target creature card from your graveyard to your hand", "Put target non-Dragon creature
  // card from a graveyard onto the battlefield under your control", "Put up to two creature cards from
  // graveyards onto the battlefield under your control", "Return one or two target creature and/or
  // planeswalker cards from your graveyard to your hand", "put up to seven permanent cards from your
  // hand onto the battlefield", "Put target creature card exiled with The Darkness Crystal onto the
  // battlefield tapped under your control with two additional +1/+1 counters on it".
  // Returns { min, max, what, from: 'mine' | 'any' | 'theirs' | 'hand' | 'exiled', exiledWith, to, tapped, counters } or null.
  const CARD_MOVE = new RegExp(`^(?:return|put) (up to )?(one or two|any number of|${COUNT.slice(1, -1)}|eight|nine|ten)? ?(?:target )?(.+?) cards? from (your graveyard|a graveyard|graveyards|an opponent's graveyard|that player's graveyard|your hand) (to your hand|onto the battlefield( tapped)?(?: under your control)?)$`, 'i');
  const EXILED_MOVE = /^put target (.+?) cards? exiled with (.+?) onto the battlefield( tapped)? under your control(?: with (\w+) additional ([\w+/-]+) counters? on it)?$/i;
  // Also "put any number of creature cards from your hand onto the battlefield" (Last March of the
  // Ents) and "You may put a land card from your hand onto the battlefield" (Growth Spiral).
  function cardMoveSpec(part) {
    let p = String(part).trim().replace(/\.$/, '');
    const may = /^you may /i.test(p);
    p = p.replace(/^you may /i, '');
    let m = CARD_MOVE.exec(p);
    if (m) {
      const any = /any number/i.test(m[2] || '');
      const n = any ? 99 : m[2] ? (/one or two/i.test(m[2]) ? 2 : toNumber(m[2])) : 1;
      if (!n) return null;
      const min = m[1] || may || any ? 0 : /one or two/i.test(m[2] || '') ? 1 : n;
      const from = { 'your graveyard': 'mine', 'a graveyard': 'any', graveyards: 'any', "an opponent's graveyard": 'theirs', "that player's graveyard": 'theirs', 'your hand': 'hand' }[m[4].toLowerCase()];
      return { min, max: n, what: m[3].toLowerCase(), from, to: /hand/i.test(m[5]) ? 'hand' : 'battlefield', tapped: !!m[6], counters: null };
    }
    m = EXILED_MOVE.exec(p);
    if (m) return { min: 1, max: 1, what: m[1].toLowerCase(), from: 'exiled', exiledWith: m[2], to: 'battlefield', tapped: !!m[3], counters: m[4] ? { n: toNumber(m[4]), kind: m[5].toLowerCase() } : null };
    return null;
  }
  // Does a card fit "creature", "non-Dragon creature", "creature and/or planeswalker", "permanent"?
  const cardFits = (inst, what) => String(what).toLowerCase().split(/\s+(?:and\/or|or)\s+|,\s*/).some(alt => alt.split(/\s+/).filter(Boolean).every(w => {
    const not = /^non-?(.+)$/.exec(w);
    if (not) return !typeWords(inst).includes(singular(not[1]));
    if (w === 'token' || w === 'tokens') return !!inst.token;
    if (w === 'permanent' || w === 'permanents') return !/\b(instant|sorcery)\b/i.test(front(inst.typeLine));
    return typeWords(inst).includes(singular(w));
  }));
  // The cards a spec can take, from table g (whoever's effect it is) and other (the other table):
  // [{ s, iid }].
  function moveChoices(g, other, spec) {
    const tables = spec.from === 'mine' || spec.from === 'hand' ? [g] : spec.from === 'theirs' ? [other] : [g, other];
    const zone = spec.from === 'hand' ? 'hand' : spec.from === 'exiled' ? 'exile' : 'graveyard';
    return tables.filter(t => t && t.zones).flatMap(t => t.zones[zone].filter(iid => {
      const c = t.cards[iid];
      return c && cardFits(c, spec.what) && (spec.from !== 'exiled' || c.exiledWith === spec.exiledWith);
    }).map(iid => ({ s: t, iid })));
  }
  // Karumonix: picks from the top cards go to your hand, the rest to the bottom in a random order.
  function applyDig(g, top, picks, src) {
    picks.forEach(iid => G.move(g, iid, 'hand'));
    const rest = G.shuffleArray(top.filter(iid => !picks.includes(iid) && g.cards[iid] && g.cards[iid].zone === 'library'));
    rest.forEach(iid => G.move(g, iid, 'library', { bottom: true }));
    G.log(g, `${src}: took ${picks.length ? andList(picks.map(iid => g.cards[iid].name)) : 'nothing'}; ${rest.length} on the bottom.`);
  }
  // The creature type worth the most among these cards (for "choose a creature type"); grave: count cards
  // (Patriarch's Bidding) rather than their stats.
  function bestOwnType(list, defOf, grave) {
    const worth = {};
    for (const c of list) {
      const sub = (front(c.typeLine).split('—')[1] || '').trim().split(/\s+/).filter(Boolean).concat(c.extraTypes || []);
      const v = grave ? 1 + ((c.bot ? c.bot.cmc : (defOf(c.id) || {}).cmc) || 0) / 10 : value(stats(c, c.bot || defOf(c.id)));
      new Set(sub.map(w => w.toLowerCase())).forEach(w => { worth[w] = (worth[w] || 0) + v; });
    }
    const best = Object.keys(worth).sort((a, b) => worth[b] - worth[a])[0];
    return best ? best[0].toUpperCase() + best.slice(1) : null;
  }
  // The color the cards in hand on table g need most (B when nothing says).
  function neededColor(g) {
    const n = {};
    g.zones.hand.forEach(iid => (String((g.cards[iid].bot && g.cards[iid].bot.cost) || g.cards[iid].cost || '').match(/[WUBRG]/g) || []).forEach(k => { n[k] = (n[k] || 0) + 1; }));
    return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'B';
  }

  // Moves the picked cards where the spec says, onto g (taking them from the other table if they're there).
  // spec.sameName: every other card in that graveyard with the same name comes too (Rat King, Verminister).
  function applyMoveCards(g, spec, picks, src, defOf) {
    if (spec.sameName) {
      const more = [];
      picks.forEach(p => { const name = p.s.cards[p.iid] && p.s.cards[p.iid].name; p.s.zones.graveyard.forEach(iid => { if (iid !== p.iid && p.s.cards[iid].name === name) more.push({ s: p.s, iid }); }); });
      picks = [...picks, ...more];
    }
    const names = [];
    for (const { s, iid } of picks) {
      const c = s.cards[iid];
      if (!c) continue;
      names.push(c.name);
      const inst = s === g ? c : takeCard(s, iid, g, 'exile', { defOf });
      G.move(g, inst.iid, spec.to, { put: true });
      if (spec.to !== 'battlefield') continue;
      if (spec.tapped) { inst.tapped = true; inst.tappedFor = null; }
      if (spec.counters) G.counter(g, inst.iid, spec.counters.kind, spec.counters.n, { effect: true });
      delete inst.exiledWith;
    }
    const to = spec.to === 'hand' ? 'to your hand' : `onto the battlefield${spec.tapped ? ' tapped' : ''}`;
    G.log(g, `${src ? src.name : 'Effect'}: ${names.length ? `put ${andList(names)} ${to}` : 'no cards to take'}.`);
  }
  // Opp (or an automatic game) takes the most expensive cards it can.
  function autoMoveCards(g, other, spec, src, defOf) {
    const cmc = c => (c.bot ? c.bot.cmc : (defOf(c.id) || {}).cmc) || 0;
    const picks = moveChoices(g, other, spec).sort((a, b) => cmc(b.s.cards[b.iid]) - cmc(a.s.cards[a.iid])).slice(0, spec.max);
    applyMoveCards(g, spec, picks, src, defOf);
  }

  // A card changes tables (Junji putting Opp's creature onto your battlefield, Reno and Rude exiling
  // Opp's top card for you): it leaves fromS's zones and arrives in toS's zone. The card remembers its
  // owner ('you' or 'opp'), so it goes back to them once it leaves the battlefield (G.hooks.sendHome).
  // opts.quiet: it just appears there (no zone-change triggers); opts.defOf: for Opp's facts about
  // a card of yours it takes. Your table is the one with game.bot on it. Returns the card on toS.
  const roleOf = t => (t.bot ? 'you' : 'opp');
  function takeCard(fromS, iid, toS, zone, opts = {}) {
    const c = fromS.cards[iid];
    const from = c.zone;
    const list = fromS.zones[from];
    if (list && list.indexOf(iid) >= 0) list.splice(list.indexOf(iid), 1);
    delete fromS.cards[iid];
    const inst = Object.assign({}, c, { iid: 'c' + toS.nextId++, zone: 'exile' });
    const owner = c.owner || roleOf(fromS);
    if (owner === roleOf(toS)) delete inst.owner;
    else inst.owner = owner;
    if (roleOf(toS) === 'you') delete inst.bot;
    else if (!inst.bot) inst.bot = facts((opts.defOf && opts.defOf(c.id)) || { typeLine: c.typeLine });
    toS.cards[inst.iid] = inst;
    toS.zones.exile.push(inst.iid);
    if (!opts.quiet && G.hooks.moved) G.hooks.moved(fromS, c, from, zone);
    if (zone !== 'exile') G.move(toS, inst.iid, zone);
    return inst;
  }
  // A card you control but someone else owns left the battlefield (G.hooks.sendHome): it goes to
  // the same zone on its owner's table. game: your table (with game.bot).
  function sendHome(game, s, inst, to, defOf) {
    const home = inst.owner === 'opp' ? game.bot && game.bot.s : inst.owner === 'you' ? game : null;
    if (!home || home === s || !s.cards[inst.iid]) return;
    const back = takeCard(s, inst.iid, home, 'exile', { quiet: true, defOf });
    if (to === 'exile') return;
    home.zones.exile.splice(home.zones.exile.indexOf(back.iid), 1); // where it was going, without new triggers
    back.zone = to;
    if (to === 'library') home.zones.library.unshift(back.iid);
    else home.zones[to].push(back.iid);
  }

  // ---------- targets ----------

  // A targeted part of an effect: { action, what, n, pow, tou, kw, kind }, or null.
  //   destroy / exile target …, return target … to its owner's hand (bounce), … deals N damage to
  //   any target / target …, tap / untap target …, target … gets +X/+Y (and gains …) until end of
  //   turn (pump), put N … counters on target … (counter). what must be something targetFilter reads.
  //   Also: target player draws N cards and loses N life (player), attach it to target … (attach).
  //   "up to two target creatures" asks count times; "another target …" can't be the card itself.
  // Sentences after it about the same creature (effectParts keeps them together) add to it:
  //   "It gains lifelink until end of turn." (kw), "That creature can't be regenerated." (noRegen),
  //   "If that creature would die this turn, exile it instead." (exileInstead), "If that creature is
  //   an Assassin, it gains deathtouch until end of turn." (ifType), "Put X +1/+1 counters on a
  //   commander creature you control, where X is the power of the creature exiled this way." (powerTo).
  function targetEffect(part) {
    const [first, ...more] = String(part).trim().replace(/\.$/, '').split(/\.\s+/);
    let p = first;
    let m;
    // "Until end of turn, target creature gets …" reads as "target creature gets … until end of turn".
    if ((m = /^until end of turn, (.+)$/i.exec(p))) p = `${m[1]} until end of turn`;
    // The Pride of Hull Clade: "gets +1/+0, gains "…," and can attack as though …"
    p = p.replace(/ gets ([+-]\d+\/[+-]\d+), gains ("[^"]*"),? and can attack/i, ' gets $1 and gains $2 and can attack');
    // Fell the Mighty: "Destroy all creatures with power greater than target creature's power."
    if ((m = /^destroy all creatures with power greater than target (.+?)'s power$/i.exec(p))) return targetFilter(m[1]) ? { action: 'fell', what: m[1] } : null;
    let out = null;
    const T = '(?:up to (one|two|three) )?(another )?target';
    const take = (o, n, another) => Object.assign(o, n && toNumber(n) > 1 ? { count: toNumber(n) } : {}, another ? { another: true } : {});
    if ((m = new RegExp(`^(destroy|exile) ${T} (.+)$`, 'i').exec(p))) out = take({ action: m[1].toLowerCase(), what: m[4] }, m[2], m[3]);
    else if ((m = /^return (?:up to one )?(another )?target (.+?) to (?:its|their) owner's hand$/i.exec(p))) out = take({ action: 'bounce', what: m[2] }, null, m[1]);
    else if ((m = /^.+? deals (\d+) damage to (any target|(?:up to one )?(another )?target (.+))$/i.exec(p))) out = take({ action: 'damage', n: Number(m[1]), what: m[4] || 'any target' }, null, m[3]);
    else if ((m = /^(tap|untap) (?:up to one )?target (.+)$/i.exec(p))) out = { action: m[1].toLowerCase(), what: m[2] };
    else if ((m = /^(another )?target (.+?) gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))?( and can attack as though it didn['’]?t have defender)? until end of turn$/i.exec(p))) {
      // It can also gain a quoted ability ("Whenever this creature deals combat damage …") as lines.
      const lines = [...String(m[5] || '').matchAll(/"([^"]+)"/g)].map(q => q[1].replace(/[,.]$/, ''));
      out = take({ action: 'pump', what: m[2], pow: Number(m[3]), tou: Number(m[4]), kw: kwWords(String(m[5] || '').replace(/"[^"]*"/g, '')), lines, attack: !!m[6] }, null, m[1]);
    } else if ((m = /^(another )?target (.+?) gains (.+?) until end of turn$/i.exec(p)) && kwWords(m[3]).length) out = take({ action: 'pump', what: m[2], pow: 0, tou: 0, kw: kwWords(m[3]) }, null, m[1]);
    else if ((m = new RegExp(`^put ${COUNT} ([\\w+/-]+) counters? on (?:up to one )?(another )?target (.+)$`, 'i').exec(p))) out = take({ action: 'counter', n: toNumber(m[1]), kind: m[2].toLowerCase(), what: m[4], kw: [] }, null, m[3]);
    else if ((m = new RegExp(`^target (player|opponent) draws ${COUNT} cards? and loses ${COUNT} life$`, 'i').exec(p))) out = { action: 'player', what: m[1], draw: toNumber(m[2]), lose: toNumber(m[3]) };
    else if ((m = /^attach (?:it|this equipment|this aura) to target (.+)$/i.exec(p))) out = { action: 'attach', what: m[1] };
    else if ((m = /^gain control of target (.+)$/i.exec(p))) out = { action: 'steal', what: m[1] }; // Piper of the Swarm
    else if ((m = /^regenerate target (.+)$/i.exec(p))) out = { action: 'regen', what: m[1] }; // Swarmyard
    if (!out || !targetFilter(out.what)) return null;
    for (const s of more) {
      if ((m = /^(?:it|that creature) gains (.+?) until end of turn$/i.exec(s)) && kwWords(m[1]).length) out.kw = [...new Set([...(out.kw || []), ...kwWords(m[1])])];
      else if (/^(?:it|that creature) can't be regenerated$/i.test(s)) out.noRegen = true;
      else if (/^if that creature would die this turn, exile it instead$/i.test(s)) out.exileInstead = true;
      else if ((m = /^if that creature is an? (.+?), it gains (.+?) until end of turn$/i.exec(s)) && kwWords(m[2]).length) out.ifType = { type: m[1], kw: kwWords(m[2]) };
      else if ((m = /^put x ([\w+/-]+) counters on a commander creature you control, where x is the power of the creature exiled this way$/i.exec(s))) out.powerTo = { kind: m[1].toLowerCase() };
      // Swords to Plowshares, Path to Exile: what the creature's controller gets.
      else if (/^its controller gains life equal to its power$/i.test(s)) out.lifeFor = true;
      else if (/^its controller may search their library for a basic land card, put (?:that card|it) onto the battlefield tapped$/i.test(s)) out.landFor = true;
      else if (/^(?:then )?shuffle$/i.test(s) && out.landFor) continue;
      else return null;
    }
    return out;
  }
  // Sentences that say more about the target of the sentence before them.
  const FOLLOW_UP = /^(?:(?:it|that creature) (?:gains .+ until end of turn|can't be regenerated)|if that creature (?:would die this turn, exile it instead|is an? .+?, it gains .+ until end of turn)|put x .+ exiled this way|its controller (?:gains life equal to its power|may search their library for a basic land card, put (?:that card|it) onto the battlefield tapped))$/i;
  const kwWords = text => String(text || '').toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(k => KEYWORDS.includes(k));

  // What a target can be: "creature", "creature an opponent controls", "artifact or enchantment",
  // "nonland permanent", "attacking creature", "creature with flying", "creature or planeswalker",
  // "any target", "player", "opponent"… Returns { players: null | 'any' | 'opps', fits(inst, mine) }
  // (mine: it's on the table of whoever's effect it is), or null for words it doesn't know.
  const TYPES = ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
  function targetFilter(what) {
    let w = String(what).toLowerCase().trim().replace(/\.$/, '');
    if (w === 'any target') return { players: 'any', fits: inst => ['creature', 'planeswalker', 'battle'].some(t => isA(inst, t)) };
    // "creature other than this creature" (Weed-Pruner Poplar): not the card itself (eff.exclude, see canTarget).
    let notSelf = false;
    const other = /\s+other than this (?:creature|permanent|artifact|enchantment)$/.exec(w);
    if (other) { notSelf = true; w = w.slice(0, other.index); }
    // "permanent that's one or more colors" (Ugin): not colorless.
    let colored = false;
    const col = /\s+that's one or more colors$/.exec(w);
    if (col) { colored = true; w = w.slice(0, col.index); }
    let whose = null;
    const own = /\s+(you control|an opponent controls|you don't control|your opponents control)$/.exec(w);
    if (own) { whose = /^you control$/.test(own[1]) ? 'mine' : 'theirs'; w = w.slice(0, own.index); }
    let extra = () => true;
    // "with mana value 3" (Hearth Kami's X, once you've picked it) is exactly that.
    const x = /\s+with (flying|power (\d+) or less|power (\d+) or greater|mana value (\d+)( or less)?|power (\d+))$/.exec(w);
    if (x) {
      w = w.slice(0, x.index);
      extra = (inst, st) => (x[1] === 'flying' ? st.kw.has('flying') : x[2] ? st.pow <= Number(x[2]) : x[3] ? st.pow >= Number(x[3])
        : x[6] ? st.pow === Number(x[6]) : x[5] ? (st.cmc || 0) <= Number(x[4]) : (st.cmc || 0) === Number(x[4]));
    }
    let players = null;
    const alts = [];
    // "artifact, enchantment, or land" are three; in "nonartifact, nonblack creature" the words that
    // only rule things out go with the one after them.
    const pieces = [];
    let carry = '';
    for (const a of w.split(/,?\s+or\s+|,\s*(?:or\s+)?/).map(x => x.trim()).filter(Boolean)) {
      if (a.split(/\s+/).every(x => /^non-?[a-z]+$/.test(x))) { carry += `${a} `; continue; }
      pieces.push(carry + a);
      carry = '';
    }
    if (carry) return null;
    for (const alt of pieces) {
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
        else if (/^[a-z]+$/.test(word) && !['spell', 'ability', 'card'].includes(word) && words.length === 1) { base = true; checks.push(inst => typeWords(inst).includes(singular(word))); } // "target Assassin"
        else return null;
      }
      if (!base) return null;
      alts.push(checks);
    }
    if (!alts.length && !players) return null;
    return {
      players: whose === 'mine' ? null : players,
      notSelf,
      fits: (inst, mine, st) => alts.length > 0 && !(whose === 'mine' && !mine) && !(whose === 'theirs' && mine)
        && alts.some(checks => checks.every(f => f(inst, st))) && extra(inst, st) && (!colored || (st.colors || []).length > 0),
    };
  }

  // Can this effect target that permanent? (On the battlefield, the right kind, and not hexproof or
  // shroud against an opponent's effect; Opp also skips ward, since it doesn't pay for it.)
  // mine: it's on the effect's own table. opp: Opp is the one choosing. eff.exclude: the card the
  // effect is from, when it says "another target" or "other than this creature".
  function canTarget(eff, inst, st, mine, opp) {
    const f = targetFilter(eff.what);
    if (!f || !inst || inst.zone !== 'battlefield' || inst.faceDown || inst.phasedOut) return false;
    if (eff.exclude && mine && inst.iid === eff.exclude) return false;
    if (st.kw.has('shroud') || (!mine && (st.kw.has('hexproof') || (opp && st.kw.has('ward'))))) return false;
    // Protection from a color: not by a spell or ability of that color (Black Knight and white cards).
    if (!mine && eff.colors && shielded(st, { colors: eff.colors })) return false;
    return f.fits(inst, mine, st);
  }

  // Does a targeted effect to one permanent on table s (or to a player: who is 'you' or 'opp' as
  // seen from game, and life is changed there; online players are app.js's job). src: its name.
  // Returns a log line.
  // caster: the table of whoever's effect it is (for "put X +1/+1 counters on a commander creature you
  // control" and attaching equipment); s when not given.
  function applyTarget(game, s, inst, eff, src, defOf, caster = s) {
    const st = stats(inst, inst.bot || defOf(inst.id));
    const theirs = !!(game.bot && s === game.bot.s);
    const gone = to => { G.move(s, inst.iid, inst.commander && to !== 'hand' ? 'command' : to); };
    let what;
    // Crystal Barricade: "Prevent all noncombat damage that would be dealt to other creatures you control."
    if (eff.action === 'damage' && G.isCreature(inst) && preventsDamage(s, inst, defOf)) {
      const line = `${src}: the ${eff.n} damage to ${inst.name} is prevented.`;
      G.log(s, line);
      return line;
    }
    if (eff.action === 'damage' && G.isCreature(inst)) creatureDamaged(game, s, inst, eff.n, defOf);
    if (eff.action === 'fell') {
      const n = st.pow;
      const names = [];
      for (const t of [game, game.bot && game.bot.s].filter(Boolean)) {
        for (const c of creatures(t)) {
          const cst = stats(c, c.bot || defOf(c.id));
          if (cst.pow <= n || cst.kw.has('indestructible') || regenerates(game, c, defOf, t !== game)) continue;
          G.move(t, c.iid, c.commander ? 'command' : 'graveyard');
          names.push(c.name);
        }
      }
      const line = `${src}: ${inst.name} has power ${n}; destroyed ${names.length ? andList(names) : 'nothing'}.`;
      G.log(s, line);
      return line;
    }
    if (eff.action === 'destroy' || (eff.action === 'damage' && G.isCreature(inst) && st.tou <= eff.n)) {
      if (st.kw.has('indestructible')) what = `${inst.name} is indestructible`;
      else if (!eff.noRegen && regenerates(game, inst, defOf, theirs)) what = `${inst.name} regenerated`;
      else { gone('graveyard'); what = eff.action === 'damage' ? `${eff.n} damage kills ${inst.name}` : `destroyed ${inst.name}`; }
    } else if (eff.action === 'damage' && isPlaneswalker(inst)) {
      const dead = damagePlaneswalker(inst, inst.bot || defOf(inst.id), eff.n);
      if (dead) gone('graveyard');
      what = `${eff.n} damage to ${inst.name}${dead ? ', which dies' : ` (loyalty ${inst.counters.loyalty})`}`;
    } else if (eff.action === 'damage') what = `${eff.n} damage to ${inst.name} (not enough to kill it)`;
    else if (eff.action === 'exile') {
      gone('exile');
      what = `exiled ${inst.name}`;
      // Swords to Plowshares: its controller gains life equal to its power.
      if (eff.lifeFor && st.pow > 0) { addLife(game, s === game ? 'you' : 'opp', st.pow); what += ` (its controller gains ${st.pow} life)`; }
      // Path to Exile: its controller searches for a basic land (picked for them), tapped.
      if (eff.landFor) { autoSearch(s, { n: 1, what: 'basic land', to: 'battlefield', tapped: true, rest: null }, `${inst.name}'s controller`, defOf); G.shuffle(s); }
      // Astarion's Thirst: counters equal to its power on a commander creature of the caster's.
      const cmd = eff.powerTo && creatures(caster, c => c.commander)[0];
      if (cmd && st.pow > 0) { G.counter(caster, cmd.iid, eff.powerTo.kind, st.pow, { effect: true }); what += ` and put ${st.pow} ${eff.powerTo.kind} counter${st.pow === 1 ? '' : 's'} on ${cmd.name}`; }
    } else if (eff.action === 'bounce') { gone('hand'); what = `returned ${inst.name} to its owner's hand`; } else if (eff.action === 'regen') {
      inst.regen = (inst.regen || 0) + 1;
      what = `${inst.name} will regenerate this turn`;
    } else if (eff.action === 'steal') {
      // "Gain control of target creature": it moves to the caster's battlefield (and goes home when it leaves).
      if (s !== caster) {
        const mine = takeCard(s, inst.iid, caster, 'exile', { quiet: true, defOf });
        caster.zones.exile.splice(caster.zones.exile.indexOf(mine.iid), 1);
        mine.zone = 'battlefield';
        caster.zones.battlefield.push(mine.iid);
        G.place(caster, mine);
        mine.enteredTurn = caster.turn;
      }
      what = `gained control of ${inst.name}`;
    } else if (eff.action === 'attach') {
      // Hidden Blade: "attach it to target creature you control. If that creature is an Assassin, it gains deathtouch until end of turn."
      const gear = caster.cards[eff.srcIid];
      if (gear && gear.zone === 'battlefield') G.attach(caster, gear.iid, inst.iid, attachBonus(oracleText(gear, defOf)));
      what = `attached ${gear ? gear.name : 'it'} to ${inst.name}`;
    } else if (eff.action === 'tap' || eff.action === 'untap') {
      inst.tapped = eff.action === 'tap';
      inst.tappedFor = null;
      what = `${eff.action === 'tap' ? 'tapped' : 'untapped'} ${inst.name}`;
    } else if (eff.action === 'pump') {
      pumpBy(inst, eff.pow, eff.tou);
      const kw = [...eff.kw, ...(eff.attack ? [DEFENDER_ATTACKS] : [])];
      if (kw.length) inst.pump.kw = [...new Set([...(inst.pump.kw || []), ...kw])];
      const lines = eff.lines || [];
      if (lines.length) inst.pump.lines = [...(inst.pump.lines || []), ...lines]; // oracleLines reads them until end of turn
      const gains = [...eff.kw, ...lines.map(l => `"${l}"`)];
      what = `${inst.name} gets ${eff.pow >= 0 ? '+' : ''}${eff.pow}/${eff.tou >= 0 ? '+' : ''}${eff.tou}${gains.length ? ` and ${gains.join(', ')}` : ''}${eff.attack ? ' and can attack as though it didn\'t have defender' : ''} until end of turn`;
    } else if (eff.action === 'counter') {
      G.counter(s, inst.iid, eff.kind, eff.n, { effect: true });
      what = `${eff.n} ${eff.kind} counter${eff.n === 1 ? '' : 's'} on ${inst.name}`;
      if (eff.kw && eff.kw.length) {
        inst.pump = { pow: 0, tou: 0, ...inst.pump, kw: [...new Set([...((inst.pump && inst.pump.kw) || []), ...eff.kw])] };
        what += ` and it gains ${eff.kw.join(', ')} until end of turn`;
      }
    }
    // "If that creature would die this turn, exile it instead." (Bleed Dry)
    if (eff.exileInstead && inst.zone === 'battlefield') inst.exileIfDies = true;
    // "If that creature is an Assassin, it gains deathtouch until end of turn." (Hidden Blade)
    if (eff.ifType && inst.zone === 'battlefield' && isA(inst, eff.ifType.type)) {
      inst.pump = { pow: 0, tou: 0, ...inst.pump, kw: [...new Set([...((inst.pump && inst.pump.kw) || []), ...eff.ifType.kw])] };
      what += ` (an ${eff.ifType.type}, so it gains ${eff.ifType.kw.join(', ')} until end of turn)`;
    }
    const line = `${src}: ${what}.`;
    G.log(s, line);
    return line;
  }

  // Damage to a player as the target, seen from game: who 'you' or 'opp'. With defOf, Massacre
  // Girl, Most Wanted and the like on the damage dealer's side see it.
  function damagePlayer(game, who, n, src, defOf) {
    addLife(game, who, -n);
    G.log(game, `${src}: ${n} damage to ${who === 'you' ? 'you' : 'Opp'}.`);
    if (defOf && game.bot) opponentDamaged(game, who === 'you' ? game.bot.s : game, n, defOf);
  }
  // "Target player draws two cards and loses 2 life." (Sign in Blood) for who: 'you' or 'opp'.
  function playerEffect(game, who, eff, src) {
    const t = who === 'you' ? game : game.bot.s;
    if (eff.draw) G.drawCards(t, eff.draw, t !== game);
    if (eff.lose) addLife(game, who, -eff.lose);
    const line = `${src}: ${who === 'you' ? 'you' : 'Opp'} drew ${eff.draw} and lost ${eff.lose} life.`;
    G.log(game, line);
    return line;
  }

  // Opp picks a target for its own effect (src on its table): removal and damage on your most
  // valuable creature it can hit (damage only on one it kills, else your face for "any target"),
  // pumps and counters on its own best creature, tap on your best untapped creature.
  // Returns { inst, s } or { player: 'you' } or null. dry: just look.
  function oppTarget(game, src, eff, defOf, dry) {
    return autoTarget(game, game.bot.s, src, eff, defOf, dry);
  }
  // A target picked without asking, for whoever controls src (table s): Opp's effects, and yours in
  // the middle of combat ("Whenever this attacks, another target Assassin you control gains
  // deathtouch"). Harmful effects go on the other side's most valuable creature it can hit; helpful
  // ones on its own best creature (one that's attacking and lacks the keyword, when there is one).
  // The player for "target player draws two cards and loses 2 life" is itself.
  function autoTarget(game, s, src, eff, defOf, dry) {
    const other = s === game ? game.bot && game.bot.s : game;
    const theirs = s !== game; // Opp's effect
    const statsOf = inst => stats(inst, inst.bot || defOf(inst.id));
    const pool = [...(other ? permanents(other).map(inst => ({ inst, s: other, mine: false, st: statsOf(inst) })) : []),
      ...permanents(s).map(inst => ({ inst, s, mine: true, st: statsOf(inst) }))].filter(x => canTarget(eff, x.inst, x.st, x.mine, true));
    const best = list => list.sort((a, b) => value(b.st) - value(a.st))[0] || null;
    const foe = theirs ? 'you' : 'opp';
    const harmful = (eff.action === 'pump' && (eff.tou < 0 || eff.pow < 0)) || (eff.action === 'counter' && /^-/.test(eff.kind));
    let pick = null;
    if (['destroy', 'exile', 'bounce', 'steal'].includes(eff.action)) pick = best(pool.filter(x => !x.mine && !(eff.action === 'destroy' && x.st.kw.has('indestructible'))));
    else if (eff.action === 'damage') {
      pick = best(pool.filter(x => !x.mine && G.isCreature(x.inst) && x.st.tou <= eff.n && !x.st.kw.has('indestructible')));
      const f = targetFilter(eff.what);
      if (!pick && f && f.players && !playerShielded(game, foe, defOf)) pick = { player: foe };
    } else if (harmful) {
      const cut = eff.action === 'pump' ? -eff.tou : eff.n;
      const theirsC = pool.filter(x => !x.mine && G.isCreature(x.inst));
      pick = best(theirsC.filter(x => x.st.tou <= cut && !x.st.kw.has('indestructible'))) || best(theirsC);
    } else if (eff.action === 'fell') {
      // Fell the Mighty: the creature whose power destroys the most of the other side's and the least of its own.
      const all = pool.filter(x => G.isCreature(x.inst));
      const net = x => all.filter(y => y.st.pow > x.st.pow && !y.st.kw.has('indestructible')).reduce((n, y) => n + (y.mine ? -value(y.st) : value(y.st)), 0);
      pick = all.map(x => ({ x, n: net(x) })).filter(o => o.n > 0).sort((a, b) => b.n - a.n).map(o => o.x)[0] || null;
    } else if (eff.action === 'player') pick = { player: theirs ? 'opp' : 'you', self: true };
    else if (eff.action === 'tap') pick = best(pool.filter(x => !x.mine && !x.inst.tapped));
    else if (eff.action === 'untap') pick = best(pool.filter(x => x.mine && x.inst.tapped));
    else {
      const own = pool.filter(x => x.mine && G.isCreature(x.inst));
      const wants = x => (eff.kw || []).some(k => !x.st.kw.has(k));
      pick = best(own.filter(x => x.inst.attacking && wants(x))) || best(own.filter(x => x.inst.attacking)) || best(own);
    }
    if (!pick || dry) return pick;
    const name = `${theirs ? "Opp's " : ''}${src.name}`;
    if (pick.self) playerEffect(game, pick.player, eff, name);
    else if (pick.player) damagePlayer(game, pick.player, eff.n, name, defOf);
    else applyTarget(game, pick.s, pick.inst, eff, name, defOf, s);
    if (/\b(instant|sorcery)\b/i.test(front(src.typeLine || ''))) spellTargeted(game, s, src, pick, defOf, null);
    return pick;
  }

  // Your "When this enters, …" (or Opp's): the targeted parts ("destroy target creature an opponent
  // controls") and tokens ("create two 1/1 …"). Life, cards and counters on entering are done elsewhere.
  // s: the table it entered on. ctx.target is how you pick (app.js); Opp picks with oppTarget.
  // Other parts ("each other creature gets -1/-1 until end of turn", "search your library …") run
  // through runEffect; life, drawing and discarding on entering are done by game.js, and counters on
  // each creature and the monarch by enterTrigger.
  const ENTER_ELSEWHERE = [/^(?:you gain|you lose|each opponent loses|target opponent loses) \w+ life$/i, /^.+? deals \w+ damage to each opponent$/i,
    new RegExp(`^(?:you )?draw ${COUNT} cards?$`, 'i'), /\bdiscards?\b/i, /^put .+ counters? on each (?!attacking)/i, /^you become the monarch$/i];
  const enteredElsewhere = part => ENTER_ELSEWHERE.some(re => re.test(part));
  function enterEffects(game, s, inst, defOf, ctx) {
    if (!inst || inst.faceDown) return;
    const opps = isOpps(game, s);
    for (const line of oracleLines(inst, defOf)) {
      const m = /^when(?:ever)? (.+?) enters(?: the battlefield)?(?: or [^,]+)?, (?:you may )?(.+)$/i.exec(line);
      if (!m || !isSelf(m[1], inst)) continue;
      const text = settleIfYouDo(m[2], s);
      if (/\bif you do\b/i.test(text)) continue; // left to you
      const rest = effectParts(text).filter(p => !enteredElsewhere(p)).join('. ');
      if (!rest) continue;
      if (opps) runFor(game, s, inst, rest, 'entered', null, defOf);
      else fire(s, inst, 'entered', rest, Object.assign({ other: game.bot ? game.bot.s : null, defOf }, ctx));
    }
  }
  // "Choose a number between 0 and 10." stays with the sentence that uses it (CHOOSE_WIPE), and so
  // do sentences about the target before them ("It gains lifelink until end of turn.", FOLLOW_UP).
  // Nothing inside quotes is split (a quoted ability it gives: 'gains "Whenever …, draw a card."').
  const effectParts = text => String(text).replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '')
    .split(/((?<!\bbetween \d+ and \d+)\.\s+|,?\s+and\s+(?=you |draw |each |put |target )|,\s+then\s+|,\s+(?=draw (?:a|an|one|two|three|four|five|six|seven|\d+) cards?\b))/i)
    .reduce((acc, piece, i) => {
      const open = acc.length && (acc[acc.length - 1].match(/"/g) || []).length % 2 === 1;
      if (open) acc[acc.length - 1] += piece; // still inside quotes: keep the separator and the rest
      else if (i % 2 === 0) acc.push(piece);
      return acc;
    }, [])
    .map(p => p.trim()).filter(Boolean)
    .reduce((out, p) => {
      const last = out[out.length - 1];
      if (last && /\btarget\b/i.test(last) && (FOLLOW_UP.test(p) || (/^shuffle$/i.test(p) && /its controller may search/i.test(last)))) out[out.length - 1] = `${last}. ${p}`;
      else if (last && /^you$/i.test(last)) out[out.length - 1] = `${last} and ${p}`; // Flumph: "you and target opponent each draw a card"
      else if (last && /^each player$/i.test(p) && /\beach creature$/i.test(last)) out[out.length - 1] = `${last} and ${p}`; // Crypt Rats
      else out.push(p);
      return out;
    }, []);
  const effectFor = (part, ctx) => EFFECTS.find(([re, , can]) => { const m = re.exec(part); return m && (!can || can(m, ctx)); });
  // Can runEffect do all of this text? (Then a spell made of it can resolve on its own.)
  const canRunAll = (text, ctx) => {
    const t = fillWhereX(settleIfYouDo(text, null), null);
    const parts = effectParts(t).map(p => fillForEach(p, null));
    return parts.length > 0 && !/\bif you do\b/i.test(t) && parts.every(p => effectFor(p, ctx));
  };

  // "If you do" after a choice that's always worth making, so it's made for you:
  //   Ob Nixilis, the Fallen: "have target player lose 3 life. If you do, put three +1/+1 counters on Ob Nixilis."
  //   Nightshade Assassin: "reveal X black cards in your hand. If you do, target creature gets -X/-X
  //   until end of turn." X is every black card in hand on table g (1 when there's no table).
  //   Reno and Rude: "Then you may sacrifice another creature or artifact. If you do, you may play the
  //   exiled card this turn, …" becomes one choice (ctx.sacToPlay).
  function settleIfYouDo(text, g) {
    let t = String(text).trim();
    t = t.replace(/^(have target (?:player|opponent) lose \w+ life)\. if you do, /i, '$1. ');
    const r = /^(?:you may )?reveal x (white|blue|black|red|green) cards in your hand\. if you do, (.+?) gets -x\/-x until end of turn\.?$/i.exec(t);
    if (r) {
      const color = PRO_COLORS[r[1].toLowerCase()];
      const x = g ? g.zones.hand.filter(iid => colorsOf(g.cards[iid].bot || { manaCost: g.cards[iid].cost || '' }).includes(color)).length : 1;
      t = x ? `${r[2]} gets -${x}/-${x} until end of turn` : '';
    }
    t = t.replace(/\.\s+then you may sacrifice another (.+?)\. if you do, you may play the exiled card this turn, and mana of any type can be spent to cast it\.?$/i, '. You may sacrifice another $1 to play the exiled card this turn');
    // Herald's Horn: "look at the top card of your library. If it's a creature card of the chosen type,
    // you may reveal it and put it into your hand." (always taken when it fits)
    t = t.replace(/^look at the top card of your library\. if it's an? (.+?) card( of the chosen type)?, you may reveal it and put it into your hand\.?$/i, 'take the top card of your library if it\'s a $1 card$2');
    // Karumonix: "look at the top five cards of your library. You may reveal any number of Rat cards
    // from among them and put the revealed cards into your hand. Put the rest on the bottom …"
    t = t.replace(/^look at the top (\w+) cards of your library\. you may reveal (any number of|an?|up to \w+) (.+?) cards? from among them and put (?:the revealed cards|it|them|that card) into your hand\. put the rest on the bottom of your library in (?:a random|any) order\.?$/i, 'dig $1 for $2 $3 cards');
    // Lord Skitter's Butcher: "You may sacrifice another creature. If you do, scry 2, then draw a card."
    // (the rest is quoted so it stays one part, see ctx.sacThen)
    t = t.replace(/^(?:you may )?sacrifice another (\w+(?: \w+)?)\. if you do, (.+?)\.?$/i, (all, what, rest) => `sacrifice another ${what} to do "${rest}"`);
    return t;
  }

  // Amounts worked out from the table g (1 when there's no table, for coverage.js), self the card:
  //   "…, where X is the number of other Squirrels, Bats, Lizards, and Rats you control" (Valley Rotcaller)
  //   "Each opponent loses 1 life for each creature you control." (Gruesome Fate)
  //   "Create a tapped 1/1 black Rat creature token for each creature card in your graveyard." (Revenge of the Rats)
  function countOf(g, phrase, self) {
    if (!g) return 1;
    const p = phrase.trim().toLowerCase();
    const kinds = list => list.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+/).map(x => x.trim()).filter(Boolean);
    let m = /^(other )?(.+?) you control$/.exec(p);
    if (m) return permanents(g).filter(c => !(m[1] && self && c.iid === self.iid) && kinds(m[2]).some(k => cardFits(c, k))).length;
    m = /^(.+?) cards? in your graveyard$/.exec(p);
    if (m) return g.zones.graveyard.filter(iid => kinds(m[1]).some(k => cardFits(g.cards[iid], k))).length;
    m = /^opponents? you have$/.exec(p);
    if (m) return g.opponents || 1;
    return null;
  }
  // On a whole effect (before it's split into parts, so "… and you gain X life, where X is …" keeps it).
  function fillWhereX(text, g, self) {
    const m = /^(.+?),? where x is the number of (.+?)\.?$/i.exec(String(text));
    if (!m || /^create .*\bcreature tokens?\b/i.test(m[1]) || /\.\s/.test(m[1])) return text; // tokens count their own X (triggerTokens)
    const n = countOf(g, m[2], self);
    return n == null ? text : m[1].replace(/\bx\b/gi, String(n));
  }
  // On one part: "loses 1 life for each creature you control" → "loses 3 life".
  function fillForEach(part, g, self) {
    const m = /^(?:then )?(.*?\b)(a|an|one|two|three|\d+) (.+?) for each (.+?)\.?$/i.exec(String(part));
    if (!m || /\bgets? [+-]/i.test(m[1])) return part;
    const n = countOf(g, m[4], self);
    return n == null ? part : `${m[1]}${toNumber(m[2]) * n} ${m[3].replace(/\btoken\b/i, 'tokens')}`;
  }

  // Does the easy parts of an ability's effect: drawing, life, counters on the card itself,
  // tokens, proliferate, the monarch, untapping and extra combats. game: the table it happens on.
  // ctx: { self, hitOpps(n), hitTarget(n), other } where hitOpps takes life from each opponent
  // and other is the opponent's table (for proliferate). Returns the parts it couldn't do (for you to do by hand), or [].
  function runEffect(game, text, ctx, times = 1) {
    text = fillWhereX(settleIfYouDo(text, game), game, ctx && ctx.self);
    // "You may mill two cards. If you do, …": the first half is a choice the rest depends on, so it's all yours to do.
    if (/\bif you do\b/i.test(text)) return effectParts(text);
    const left = [];
    const parts = effectParts(text);
    for (const [k, raw] of parts.entries()) {
      const part = fillForEach(raw, game, ctx && ctx.self);
      for (let i = 0; i < times; i++) {
        const found = effectFor(part, ctx);
        const r = found ? found[1](game, found[0].exec(part), ctx) : false;
        if (r === false) { left.push(part); break; }
        // You're picking cards (a search, a scry): the rest of the effect waits until you have (ctx.later).
        if (r === 'pause') {
          const rest = parts.slice(k + 1);
          if (rest.length && ctx.later) ctx.later(rest.join('. '), ctx.self);
          else left.push(...rest);
          return left;
        }
      }
    }
    return left;
  }

  // The modes Opp (or an automatic game) picks for "Choose one —" on a trigger: ones that hit the
  // opponent first, then ones it can do all of; "you lose" counts against a mode.
  function autoModes(g, modes, pick, ctx) {
    const score = m => {
      const spec = cardMoveSpec(effectParts(m)[0] || '');
      return (/\bopponent\b|\btarget player\b/i.test(m) ? 3 : 0) + (canRunAll(m, ctx) ? 2 : 0)
        + (spec && moveChoices(g, ctx.other, spec).length ? 3 : 0) - (/\byou lose\b/i.test(m) ? 1 : 0);
    };
    return [...modes].sort((a, b) => score(b) - score(a)).slice(0, pick);
  }

  // ---------- "unless that player pays", counterspell extras, delayed draws ----------

  // Rhystic Study ("Whenever an opponent casts a spell, you may draw a card unless that player pays
  // {1}.") and Smothering Tithe ("Whenever an opponent draws a card, that player may pay {2}. If the
  // player doesn't, you create a Treasure token."). A request: { cost, why, payer: 'you' | 'opp',
  // gets: 'you' | 'opp', draw: n, token: kind }. You're asked when you're the one paying
  // (ctx.payTax, app.js); Opp pays for Rhystic Study when it can, never for Smothering Tithe.
  function taxRequests(game, s, line, w, event) {
    const payer = s === game ? 'you' : 'opp';
    const gets = payer === 'you' ? 'opp' : 'you';
    let m = /^whenever an opponent casts a spell, (?:you may )?draw (\w+) cards? unless that player pays ((?:\{[^}]+\})+)\.?$/i.exec(line);
    if (m && event === 'cast') return { cost: m[2], why: w.name, payer, gets, draw: toNumber(m[1]) || 1 };
    m = /^whenever an opponent draws a card, that player may pay ((?:\{[^}]+\})+)\. if the player doesn't, you create an? (\w+) token\.?$/i.exec(line);
    if (m && event === 'draw') return { cost: m[1], why: w.name, payer, gets, token: m[2].toLowerCase() };
    return null;
  }
  const TAX_WATCH = [/^whenever an opponent casts a spell, (?:you may )?draw (\w+) cards? unless that player pays ((?:\{[^}]+\})+)\.?$/i,
    /^whenever an opponent draws a card, that player may pay ((?:\{[^}]+\})+)\. if the player doesn't, you create an? (\w+) token\.?$/i];
  // Table s cast a spell (event 'cast') or drew n cards ('draw'): the other side's watchers.
  function opponentActed(game, s, event, n, defOf, ctx) {
    if (!game.bot) return;
    const other = s === game ? game.bot.s : game;
    for (const w of permanents(other)) {
      for (const line of oracleLines(w, defOf)) {
        for (let i = 0; i < (event === 'draw' ? n : 1); i++) {
          const req = taxRequests(game, s, line, w, event);
          if (!req) break;
          if (req.payer === 'you' && ctx && ctx.payTax) { ctx.payTax(req); continue; }
          const pays = req.payer === 'opp' ? !!req.draw && affordable(game.bot.s, req.cost, 0) : !!req.draw && !!G.autoPay(JSON.parse(JSON.stringify(game)), req.cost);
          applyTax(game, req, pays);
        }
      }
    }
  }
  // The tax is paid (pays) or not, and the watcher's side gets its card or token.
  function applyTax(game, req, pays) {
    const t = req.gets === 'you' ? game : game.bot.s;
    if (pays) {
      if (req.payer === 'opp') onOpp(game, () => G.autoPay(game.bot.s, req.cost));
      else G.autoPay(game, req.cost);
      G.log(game, `${req.why}: ${req.payer === 'you' ? 'you' : 'Opp'} paid ${req.cost}.`);
      return;
    }
    if (req.draw) G.drawCards(t, req.draw, t !== game);
    if (req.token) artifactTokens(t, { name: req.why }, 1, req.token);
    G.log(game, `${req.why}: ${req.payer === 'you' ? 'you' : 'Opp'} didn't pay ${req.cost}, so ${req.gets === 'you' ? 'you' : 'Opp'} ${req.draw ? `drew ${req.draw === 1 ? 'a card' : req.draw + ' cards'}` : `got a ${req.token} token`}.`);
  }

  // What a counterspell does besides countering, from its other sentences: An Offer You Can't Refuse
  // ("Its controller creates two Treasure tokens."), Arcane Denial ("Its controller may draw up to two
  // cards at the beginning of the next turn's upkeep. You draw a card at the beginning of the next
  // turn's upkeep."). by: the table of whoever cast it; hit: the countered spell's table (null online).
  const COUNTER_EXTRAS = [
    /^this spell can't be countered$/i,
    new RegExp(`^its controller creates ${COUNT} (${Object.keys(ARTIFACT_TOKENS).join('|')}) tokens?$`, 'i'),
    new RegExp(`^its controller may draw up to ${COUNT} cards? at the beginning of the next turn's upkeep$`, 'i'),
    new RegExp(`^you draw ${COUNT} cards? at the beginning of the next turn's upkeep$`, 'i'),
  ];
  const counterExtraParts = oracle => String(oracle || '').replace(/\([^)]*\)/g, '').split(/\n|(?<=\.)\s+/).map(x => x.trim().replace(/\.$/, ''))
    .filter(x => x && !/^counter target (?:[a-z ,-]+ )?spell(?: unless its controller pays \{\d+\})?$/i.test(x));
  function counterExtras(game, by, hit, oracle, src) {
    const role = t => (t === game ? 'you' : 'opp');
    for (const part of counterExtraParts(oracle)) {
      let m;
      if ((m = COUNTER_EXTRAS[1].exec(part))) {
        if (hit) artifactTokens(hit, { name: src }, toNumber(m[1]), m[2]);
        else G.log(by, `${src}: its controller creates ${m[1]} ${m[2]} tokens (on their side).`);
      } else if ((m = COUNTER_EXTRAS[2].exec(part))) {
        if (hit) game.nextUpkeep = [...(game.nextUpkeep || []), { who: role(hit), n: toNumber(m[1]), why: src }];
      } else if ((m = COUNTER_EXTRAS[3].exec(part))) game.nextUpkeep = [...(game.nextUpkeep || []), { who: role(by), n: toNumber(m[1]), why: src }];
    }
  }
  // At the beginning of the next turn's upkeep (whoever's it is): the draws counterExtras saved.
  function upkeepDraws(game) {
    for (const d of game.nextUpkeep || []) {
      const t = d.who === 'you' ? game : game.bot && game.bot.s;
      if (!t) continue;
      G.drawCards(t, d.n, t !== game);
      G.log(game, `${d.why}: ${d.who === 'you' ? 'you' : 'Opp'} drew ${d.n === 1 ? 'a card' : d.n + ' cards'}.`);
    }
    delete game.nextUpkeep;
  }
  // Crackdown Construct: "Whenever you activate an ability of an artifact or creature that isn't a mana
  // ability, this creature gets +1/+1 until end of turn." src: what was activated, on table s.
  const ACTIVATE_WATCH = /^whenever you activate an ability of an? (.+?)(?: that isn't a mana ability)?, (?:you may )?(.+)$/i;
  function abilityActivated(game, s, src, defOf, ctx) {
    for (const w of permanents(s)) {
      for (const line of oracleLines(w, defOf)) {
        const m = ACTIVATE_WATCH.exec(line);
        if (m && m[1].split(/\s+or\s+/).some(k => isA(src, k))) runFor(game, s, w, m[2], `${src.name}'s ability was activated`, isOpps(game, s) ? null : ctx, defOf);
      }
    }
  }
  // Heraldic Banner's "choose a color": the color most of table s's creature cards are.
  function bestColor(s, defOf) {
    const n = {};
    Object.values(s.cards).filter(c => /\bcreature\b/i.test(front(c.typeLine))).forEach(c => colorsOf(c.bot || defOf(c.id) || {}).forEach(k => { n[k] = (n[k] || 0) + 1; }));
    return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'B';
  }
  // Flashback {2}{B}{B}: its cost, or null.
  const flashbackOf = (inst, defOf) => { const m = oracleLines(inst, defOf).map(l => /^flashback ((?:\{[^}]+\})+)/i.exec(l)).find(Boolean); return m ? m[1] : null; };
  // Ninjutsu {1}{B}: its cost, or null.
  const ninjutsuOf = (inst, defOf) => { const m = oracleLines(inst, defOf).map(l => /^ninjutsu ((?:\{[^}]+\})+)/i.exec(l)).find(Boolean); return m ? m[1] : null; };

  // "You have no maximum hand size." (Reliquary Tower) on table s.
  const noMaxHand = (s, defOf) => permanents(s).some(c => oracleLines(c, defOf).some(l => /^you have no maximum hand size\.?$/i.test(l)));

  // Eerie Interlude: the cards on table s (iids) come back at the beginning of the next end step.
  function flickerOut(game, s, iids, src) {
    const gone = iids.map(iid => s.cards[iid]).filter(c => c && c.zone === 'battlefield');
    gone.forEach(c => G.move(s, c.iid, 'exile'));
    game.flickerBack = [...(game.flickerBack || []), { who: s === game ? 'you' : 'opp', iids: gone.map(c => c.iid) }];
    G.log(s, `${src}: exiled ${gone.length ? andList(gone.map(c => c.name)) : 'nothing'} until the next end step.`);
  }
  function flickerReturn(game) {
    for (const f of game.flickerBack || []) {
      const t = f.who === 'you' ? game : game.bot && game.bot.s;
      if (!t) continue;
      const back = f.iids.filter(iid => t.cards[iid] && t.cards[iid].zone === 'exile');
      back.forEach(iid => G.move(t, iid, 'battlefield', { put: true }));
      if (back.length) G.log(t, `Returned ${andList(back.map(iid => t.cards[iid].name))} to the battlefield (end step).`);
    }
    delete game.flickerBack;
  }

  // Wall of Stolen Identity: "You may have this creature enter as a copy of any creature on the
  // battlefield, except it's a Wall in addition to its other types and has defender. When you do, tap
  // the copied creature and it doesn't untap during its controller's untap step for as long as you
  // control this creature." The card becomes the other one (its id, name and type line) until it
  // leaves the battlefield (G's resetForZoneChange puts it back).
  const CLONE = /^you may have (?:this creature|.+?) enter as a copy of any creature on the battlefield(, except it's an? (\w+) in addition to its other types and has (\w+))?\.(?: when you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control this creature\.)?$/i;
  const cloneLine = (inst, defOf) => oracleLines(inst, defOf).map(l => CLONE.exec(l)).find(Boolean) || null;
  // The creatures it can copy: [{ s, inst }].
  const cloneChoices = (game, inst) => [game, game.bot && game.bot.s].filter(Boolean).flatMap(t => creatures(t).filter(c => c !== inst).map(c => ({ s: t, inst: c })));
  function becomeCopy(game, s, inst, pick, defOf) {
    const m = cloneLine(inst, defOf);
    if (!m || !pick) return;
    const target = pick.inst;
    inst.original = { id: inst.id, name: inst.name, typeLine: inst.typeLine, bot: inst.bot };
    inst.id = target.id;
    inst.name = target.name;
    const type = front(target.typeLine);
    inst.typeLine = m[2] && !new RegExp(`\\b${m[2]}\\b`, 'i').test(type) ? `${type}${type.includes('—') ? '' : ' —'} ${m[2]}` : type;
    if (m[3]) inst.extraKw = [m[3].toLowerCase()];
    if (s === game) delete inst.bot;
    else inst.bot = facts(defOf(target.id) || { typeLine: inst.typeLine });
    if (/when you do, tap the copied creature/i.test(m[0])) {
      target.tapped = true;
      target.tappedFor = null;
      target.frozenBy = { who: s === game ? 'you' : 'opp', iid: inst.iid };
    }
    G.log(s, `${inst.original.name} entered as a copy of ${pick.s === s ? '' : pick.s === game ? 'your ' : "Opp's "}${target.name}${/when you do/i.test(m[0]) ? `, which is tapped and doesn't untap while it stays` : ''}.`);
  }
  // Opp (or an automatic game) copies the best creature there is.
  function autoCopy(game, s, inst, defOf) {
    const pick = cloneChoices(game, inst).sort((a, b) => value(stats(b.inst, b.inst.bot || defOf(b.inst.id))) + (b.s !== s ? 1 : 0) - value(stats(a.inst, a.inst.bot || defOf(a.inst.id))) - (a.s !== s ? 1 : 0))[0];
    if (pick) becomeCopy(game, s, inst, pick, defOf);
  }
  // The copied creature untaps again once the copy is gone (refreshGrants).
  function thawCopies(game) {
    const tables = [game, game.bot && game.bot.s].filter(Boolean);
    for (const t of tables) {
      for (const c of Object.values(t.cards)) {
        if (!c.frozenBy) continue;
        const src = (c.frozenBy.who === 'you' ? game : game.bot && game.bot.s);
        const w = src && src.cards[c.frozenBy.iid];
        if (!w || w.zone !== 'battlefield' || !w.original || c.zone !== 'battlefield') delete c.frozenBy;
      }
    }
  }

  // Abilities used from your hand: Cycling {3} (Spara's Headquarters), Transmute {1}{U}{U} (Drift of
  // Phantasms: "search your library for a card with the same mana value"). [{ kind, cost, label }].
  function handAbilities(inst, defOf) {
    const out = [];
    for (const line of oracleLines(inst, defOf)) {
      const m = /^(cycling|transmute) ((?:\{[^}]+\})+)/i.exec(line);
      if (m) out.push({ kind: m[1].toLowerCase(), cost: m[2], label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} (${m[2]})` });
    }
    return out;
  }
  // Aftermath (Dusk // Dawn): the back half, cast from your graveyard. { name, cost } or null.
  function aftermathOf(inst, defOf) {
    const card = defOf(inst.id) || {};
    const names = String(card.name || '').split(' // ');
    if (names.length < 2 || !/^aftermath\b/im.test(faceOracle(card.oracle, card.name, true))) return null;
    return { name: names[1], cost: String(card.manaCost || '').split(' // ')[1] || '' };
  }

  // The permanents on table s that fit "creature with defender" (a cost to sacrifice one), not src.
  function sacChoices(s, src, what, defOf) {
    const m = /^(.+?) with ([a-z]+(?: [a-z]+)?)$/i.exec(what);
    return permanents(s).filter(c => c !== src && cardFits(c, m ? m[1] : what) && (!m || stats(c, c.bot || defOf(c.id)).kw.has(m[2].toLowerCase())));
  }

  // Slaughter the Strong: the most valuable creatures [{ c, st }] with total power cap or less
  // (power 0 or less always stays). Exact, since the cap is small.
  function keepByPower(list, cap) {
    const free = list.filter(x => x.st.pow <= 0);
    const rest = list.filter(x => x.st.pow > 0 && x.st.pow <= cap);
    let best = { v: 0, set: [] };
    const go = (i, left, v, set) => {
      if (v > best.v) best = { v, set: [...set] };
      for (let k = i; k < rest.length; k++) {
        if (rest[k].st.pow <= left) { set.push(rest[k]); go(k + 1, left - rest[k].st.pow, v + value(rest[k].st), set); set.pop(); }
      }
    };
    if (rest.length <= 18) go(0, cap, 0, []);
    else { let left = cap; [...rest].sort((a, b) => value(b.st) / b.st.pow - value(a.st) / a.st.pow).forEach(x => { if (x.st.pow <= left) { best.set.push(x); left -= x.st.pow; } }); }
    return [...free, ...best.set];
  }

  // Crystal Barricade on table s: "Prevent all noncombat damage that would be dealt to other creatures you control."
  const preventsDamage = (s, inst, defOf) => permanents(s).some(w => w !== inst && oracleLines(w, defOf).some(l => /^prevent all noncombat damage that would be dealt to other creatures you control\.?$/i.test(l)));

  // Flumph: "Whenever this creature is dealt damage, you and target opponent each draw a card." s: its table.
  function creatureDamaged(game, s, inst, n, defOf, ctx) {
    if (!(n > 0) || !inst) return;
    inst.damageTaken = (inst.damageTaken || 0) + n; // this turn (Tangled Colony)
    for (const line of oracleLines(inst, defOf)) {
      const m = /^whenever (.+?) is dealt damage, (?:you may )?(.+)$/i.exec(line);
      if (!m || !isSelf(m[1], inst)) continue;
      const mine = Object.assign({ oppsDraw: k => { if (game.bot) G.drawCards(game.bot.s, k, true); }, other: game.bot ? game.bot.s : null, defOf }, ctx);
      runFor(game, s, inst, m[2], `dealt ${n} damage`, isOpps(game, s) ? null : mine, defOf);
    }
  }

  // Does player who ('you' or 'opp') have hexproof (Crystal Barricade, Teyo) or protection from everything (Teferi's Protection)?
  const playerShielded = (game, who, defOf) => {
    const t = who === 'you' ? game : game.bot && game.bot.s;
    return !!t && (!!(t.untilNextTurn && t.untilNextTurn.protection) || permanents(t).some(c => oracleLines(c, defOf).some(l => /^you have hexproof\.?$/i.test(l))));
  };

  // An opponent of table s was dealt noncombat damage n: "Whenever an opponent is dealt noncombat
  // damage, put a +1/+1 counter on Massacre Girl." on s.
  const DEALT_WATCH = /^whenever an opponent is dealt noncombat damage, (?:you may )?(.+)$/i;
  function opponentDamaged(game, s, n, defOf, ctx) {
    if (!(n > 0) || !s) return;
    for (const w of permanents(s)) {
      for (const line of oracleLines(w, defOf)) {
        const m = DEALT_WATCH.exec(line);
        if (m) runFor(game, s, w, m[1], `an opponent was dealt ${n} noncombat damage`, isOpps(game, s) ? null : ctx, defOf);
      }
    }
  }

  // A spell cast on table s targets something (pick: { inst, s } or { player }): heroic ("Whenever you
  // cast a spell that targets this creature, …") and Danitha ("… that targets an opponent or a
  // creature an opponent controls, …").
  const TARGET_WATCH = /^(?:heroic\s*[—-]\s*)?whenever you cast a spell that targets (.+?), (?:you may )?(.+)$/i;
  function spellTargeted(game, s, spell, pick, defOf, ctx) {
    if (!pick || !spell) return;
    const foe = s === game ? 'opp' : 'you';
    for (const w of permanents(s)) {
      for (const line of oracleLines(w, defOf)) {
        const m = TARGET_WATCH.exec(line);
        if (!m) continue;
        const hit = m[1].split(/\s+or\s+/).some(alt => {
          const a = alt.trim().toLowerCase();
          if (pick.player) return /^an opponent$/.test(a) ? pick.player === foe : /^a player$/.test(a);
          const mine = pick.s === s;
          if (isSelf(a, w)) return pick.inst === w;
          const c = /^an? (.+?)(?: (you control|an opponent controls))?$/.exec(a);
          return !!c && isA(pick.inst, c[1]) && (!c[2] || (c[2] === 'you control') === mine);
        });
        if (hit) runFor(game, s, w, m[2], `${spell.name} targeted ${pick.player ? (pick.player === 'you' ? 'you' : 'Opp') : pick.inst.name}`, isOpps(game, s) ? null : ctx, defOf);
      }
    }
  }

  // Ebondeath, Dracolich: "You may cast this card from your graveyard if a creature not named
  // Ebondeath, Dracolich died this turn." (s.deathsThisTurn, kept by afterDeath.)
  const GRAVE_CAST = /^you may cast this card from your graveyard if a creature not named (.+?) died this turn\.?$/i;
  function graveCast(s, inst, defOf) {
    if (!inst || inst.zone !== 'graveyard') return false;
    const m = oracleLines(inst, defOf).map(l => GRAVE_CAST.exec(l)).find(Boolean);
    return !!m && (s.deathsThisTurn || []).some(n => n.toLowerCase() !== m[1].toLowerCase());
  }

  const yourPermanents = game => game.zones.battlefield.map(iid => game.cards[iid]).filter(c => c && !c.faceDown && !c.phasedOut);
  // A rules line without reminder text or an ability word ("Raid — When …", "Landfall — Whenever …"),
  // which only names the ability. Saga chapters ("I, II — …") keep theirs.
  const plainLine = l => l.replace(/\([^)]*\)/g, '').trim().replace(/^(?![IVX]+(?:, [IVX]+)* —)[A-Z][A-Za-z'’ -]{1,40}? — (?=[A-Z{+−-])/, '');
  // Abilities a pump gave it until end of turn (inst.pump.lines) count too, and ones other cards give
  // it ('Commander creatures you own have "Whenever this creature attacks …"', inst.grantedLines).
  const oracleLines = (inst, defOf) => oracleText(inst, defOf).split('\n').map(plainLine).concat((inst.pump && inst.pump.lines) || [], inst.grantedLines || [],
    Object.values(inst.boosts || {}).flatMap(b => (b && b.lines) || [])); // abilities its equipment gives (Thornbite Staff)

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

  // A trigger on table s: yours with ctx (fire), or Opp's (runFor, Opp picks its own targets).
  const fireOn = (game, s, inst, what, effect, ctx, defOf, times = 1) => (isOpps(game, s)
    ? runFor(game, s, inst, effect, what, null, defOf, times) : fire(s, inst, what, effect, ctx, times));

  // Landfall: "Whenever a land (you control) enters (the battlefield under your control), …".
  // s: the table it entered on (yours unless given).
  function landEntered(game, land, defOf, ctx, s = game) {
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        const m = /^(?:landfall\s*[—-]\s*)?whenever a land(?: you control)? enters(?: the battlefield)?(?: under your control)?, (?:you may )?(.+)$/i.exec(line);
        if (m) fireOn(game, s, inst, `landfall (${land.name})`, landfallText(m[1], land), ctx, defOf);
      }
    }
  }
  // Guul Draz Overseer: "other creatures you control get +1/+0 until end of turn. If that land is a
  // Swamp, those creatures get +2/+0 until end of turn instead." becomes the one that applies.
  function landfallText(effect, land) {
    const m = /^(.+?) get ([+-]\d+\/[+-]\d+) until end of turn\. if that land is an? (\w+), those creatures get ([+-]\d+\/[+-]\d+) until end of turn instead\.?$/i.exec(String(effect).trim());
    if (!m) return effect;
    return `${m[1]} get ${land && isA(land, m[3]) ? m[4] : m[2]} until end of turn`;
  }

  // "Whenever a creature (you control) enters (the battlefield under your control), …" (Ajani's
  // Welcome), also "another creature", "nontoken creature", "a Dragon you control", "this creature or
  // another Dragon you control", "a creature you control with flying / with defender / with power 4
  // or greater" ("a creature with defender you control" too) and "… of the chosen type". Face-down
  // cards are creatures too (of no type). Ones that see every player's creatures (Soul Warden) are
  // left to you. s: the table it entered on.
  const WATCH_HEAD = '^whenever (?:(.+?) or )?(an?|another) (nontoken )?(.+?)(?: you control)?( with (?:power (\\d+) or greater|[a-z]+(?: [a-z]+)?))?(?: you control)?( of the chosen type)?';
  const ENTER_WATCH = new RegExp(`${WATCH_HEAD} enters(?: the battlefield)?(?: under your control)?(?: or attacks)?, (?:you may )?(.+)$`, 'i');
  const ATTACK_WATCH = new RegExp(`${WATCH_HEAD}(?: enters(?: the battlefield)? or)? attacks, (?:you may )?(.+)$`, 'i');
  const BLOCK_WATCH = new RegExp(`${WATCH_HEAD} blocks(?: a creature)?, (?:you may )?(.+)$`, 'i');
  // Does creature (on table s) fit a watcher's words? m: an ENTER_WATCH or ATTACK_WATCH match on inst's line.
  function watched(m, inst, creature, defOf) {
    const self = creature === inst;
    if (self && !(m[1] && isSelf(m[1], inst)) && m[2].toLowerCase() === 'another') return false;
    if (self && m[1] && isSelf(m[1], inst)) return true; // "Whenever this creature or another Dragon you control enters"
    if (m[3] && creature.token) return false;
    if (creature.faceDown) return /^creatures?$/i.test(m[4]) && !m[5] && !m[7];
    if (!G.isCreature(creature) || !isA(creature, m[4])) return false;
    if (m[7] && !(inst.chosenType && isA(creature, inst.chosenType))) return false;
    if (m[5]) {
      const st = stats(creature, creature.bot || defOf(creature.id));
      if (m[6] ? st.pow < Number(m[6]) : !st.kw.has(m[5].replace(/^\s*with\s+/i, '').toLowerCase())) return false;
    }
    return true;
  }
  // In "…, it gains haste" or "put a +1/+1 counter on that creature", "it" is the creature that
  // entered or attacked, not the card watching. Returns which one the effect is about.
  const subjectOf = (effect, watcher, creature) => (/\b(it|that creature|that token)\b/i.test(effect) && !/\bthis (creature|enchantment|artifact|permanent)\b/i.test(effect)
    && !effect.toLowerCase().includes(watcher.name.split(',')[0].toLowerCase()) ? creature : watcher);
  function creatureEntered(game, creature, defOf, ctx, s = game) {
    if (!creature.faceDown && !G.isCreature(creature)) return;
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        // Thornbite Staff: "Whenever a Shaman creature enters, you may attach this Equipment to it."
        const at = /^whenever an? (.+?) enters, (?:you may )?attach this equipment to it\.?$/i.exec(line);
        if (at) {
          if (!creature.faceDown && creature !== inst && isA(creature, at[1]) && !inst.attachedTo) G.attach(s, inst.iid, creature.iid, attachBonus(oracleText(inst, defOf)));
          continue;
        }
        const m = ENTER_WATCH.exec(line);
        if (!m || !/you control|under your control/i.test(line.split(',')[0]) || !watched(m, inst, creature, defOf)) continue;
        let effect = m[8];
        // The Sibsig Ceremony: "if you cast it, destroy that creature, …"
        const cast = /^if you cast it, (.+)$/i.exec(effect);
        if (cast) {
          if (!creature.wasCast) continue;
          effect = cast[1];
        }
        const who = subjectOf(effect, inst, creature);
        fireOn(game, s, who, `${creature.faceDown ? 'a creature' : creature.name} entered (${inst.name})`, effect, ctx, defOf);
      }
    }
  }

  // "At the beginning of your upkeep / end step / combat on your turn, …" and "… of each upkeep /
  // each end step" on every table. phase: 'upkeep', 'end step' or 'combat'; active: the table whose
  // turn it is. ctx: as for runEffect, for your cards. What can't be done is logged to do by hand.
  // dry: just count them. Returns how many there were.
  const PHASE_TRIGGER = /^at the beginning of (?:(your|each|each player's|each opponent's) )?(upkeep|draw step|end step|combat on your turn|combat)(?:,| on [^,]+,) (?:you may )?(.+)$/i;
  function phaseTriggers(game, active, phase, defOf, ctx, dry) {
    let n = 0;
    for (const t of [game, game.bot && game.bot.s].filter(Boolean)) {
      for (const inst of permanents(t)) {
        for (const line of oracleLines(inst, defOf)) {
          const m = PHASE_TRIGGER.exec(line);
          if (!m || m[2].toLowerCase().replace(' on your turn', '') !== phase) continue;
          // "At the beginning of combat on your turn" is yours; "… of each combat" is everyone's.
          const whose = (m[1] || (/on your turn/i.test(m[2]) ? 'your' : 'each')).toLowerCase();
          if (whose === 'your' && t !== active) continue;
          if (whose === "each opponent's" && t === active) continue;
          if (END_MILL.test(line)) continue; // Ashcoat's: endStepTriggers asks for it
          // Rat King, Verminister (disappear): "if a permanent left the battlefield under your control this turn, …"
          let effect = m[3];
          const left = /^if a permanent left the battlefield under your control this turn, (.+)$/i.exec(effect);
          if (left) {
            if (!t.leftThisTurn) continue;
            effect = left[1];
          }
          n++;
          if (dry) continue;
          const yours = ctx || { hitOpps: k => { game.oppLife -= k; }, other: game.bot ? game.bot.s : null };
          fireOn(game, t, inst, `beginning of ${phase === 'end step' ? 'the end step' : phase}`, effect, t === game ? yours : null, defOf);
        }
      }
    }
    return n;
  }

  // Attackers were declared on table s: "Whenever you attack, …", "Whenever a Dragon you control
  // attacks, …" (once for each one) and "Whenever one or more Dragons you control attack, …" (once;
  // "that many" is how many attack). attackers: the attacking creatures.
  function attackWatch(game, s, defOf, ctx, attackers = []) {
    const list = attackers.filter(a => a && a.zone === 'battlefield');
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        let m = /^whenever you attack, (?:you may )?(.+)$/i.exec(line);
        if (m) { fireOn(game, s, inst, 'you attacked', m[1], ctx, defOf); continue; }
        m = /^whenever one or more (.+?) you control attack, (?:you may )?(.+)$/i.exec(line);
        if (m) {
          const n = list.filter(a => isA(a, m[1])).length;
          if (n) fireOn(game, s, inst, `${n} ${m[1]} attacked`, m[2].replace(/\bthat many\b/gi, String(n)), ctx, defOf);
          continue;
        }
        m = ATTACK_WATCH.exec(line);
        if (!m || !/you control/i.test(line.split(',')[0])) continue;
        for (const a of list) {
          if (!watched(m, inst, a, defOf)) continue;
          fireOn(game, s, subjectOf(m[8], inst, a), `${a.name} attacked (${inst.name})`, m[8], ctx, defOf);
        }
      }
    }
  }

  // Blockers were declared on table s: "Whenever a creature you control with defender blocks, …"
  // (Perimeter Captain), once for each one. blockers: the blocking creatures.
  function blockWatch(game, s, defOf, ctx, blockers = []) {
    const list = [...new Set(blockers)].filter(b => b && b.zone === 'battlefield');
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        const m = BLOCK_WATCH.exec(line);
        if (!m || !/you control/i.test(line.split(',')[0])) continue;
        for (const b of list) {
          if (!watched(m, inst, b, defOf)) continue;
          fireOn(game, s, subjectOf(m[8], inst, b), `${b.name} blocked (${inst.name})`, m[8], ctx, defOf);
        }
      }
    }
  }

  // "When this creature dies, create a 2/1 black Cat creature token." (older wording: "is put into
  // a graveyard from play / the battlefield"). s: the table it died on. Tokens are made on either
  // table; other effects run on yours (ctx) and on Opp's (game, when s is Opp's table), and what's
  // left is logged to do by hand.
  // Unstoppable Slasher: "When this creature dies, if it had no counters on it, return it to the
  // battlefield tapped under its owner's control with two stun counters on it."
  const RETURN_STUNNED = /^if it had no counters on it, return it to the battlefield( tapped)? under its owner's control(?: with (\w+) ([\w+/-]+) counters? on it)?\.?$/i;
  function died(s, inst, defOf, ctx, game, info = {}) {
    for (const line of oracleLines(inst, defOf)) {
      const m = /^when(?:ever)? (.+?) (?:dies|is put into (?:a|your) graveyard from (?:the battlefield|play)), (?:you may )?(.+)$/i.exec(line);
      if (!m || !isSelf(m[1], inst)) continue;
      // Tangled Colony: "create X 1/1 … tokens …, where X is the amount of damage dealt to it this turn"
      m[2] = m[2].replace(/^(create )x\b(.+?),? where x is the amount of damage dealt to it this turn\.?$/i, (all, a, b) => `${a}${info.damage || 0}${b}`);
      const back = RETURN_STUNNED.exec(m[2].trim());
      if (back) {
        const had = Object.values(info.counters || {}).some(n => n > 0);
        if (had || inst.token || !s.cards[inst.iid] || inst.zone !== 'graveyard') { G.log(s, `${inst.name} died${had ? ' with counters on it, so it stays dead' : ''}.`); continue; }
        G.move(s, inst.iid, 'battlefield');
        inst.tapped = true;
        inst.tappedFor = null;
        if (back[2]) G.counter(s, inst.iid, back[3].toLowerCase(), toNumber(back[2]), { effect: true });
        G.log(s, `${inst.name} came back tapped${back[2] ? ` with ${back[2]} ${back[3]} counters` : ''}.`);
        continue;
      }
      if (triggerTokens(s, inst, m[2].trim(), 'dies')) continue;
      if (ctx) fire(s, inst, 'dies', m[2], ctx);
      else if (game && isOpps(game, s)) runFor(game, s, inst, m[2], 'died', null, defOf);
      else G.log(s, `${inst.name} died: ${m[2]}`);
    }
  }

  // Combat damage to a player. hits:[{ inst, st, card }] for each of your creatures that dealt
  // combat damage to a player. Handles "Whenever this creature / a creature you control / one or
  // more creatures you control (each with power greater than its base power) deals combat damage
  // to a player, …".
  function combatDamage(game, hits, defOf, ctx) {
    if (!hits.length) return;
    // Freerunning: "if you dealt combat damage to a player this turn with an Assassin or commander".
    if (hits.some(h => h.inst.commander || isA(h.inst, 'assassin'))) game.freerunTurn = game.turn;
    for (const inst of yourPermanents(game)) {
      for (const line of oracleLines(inst, defOf)) {
        const h = hitTrigger(line, inst, hits);
        if (!h) continue;
        const d = destroyTheirs(h.effect);
        if (d) {
          // You pick (or skip) which one: afterChange opens the picker for game.mustDestroy.
          game.mustDestroy = [...(game.mustDestroy || []), { what: d, why: inst.name }];
          G.log(game, `${inst.name}: combat damage to Opp, so you may destroy up to one ${d} Opp controls.`);
        } else if (h.hitters && h.hitters.some(c => subjectOf(h.effect, inst, c) === c)) {
          // "… put a +1/+1 counter on it": on each creature that dealt the damage.
          h.hitters.forEach(c => fire(game, c, `combat damage to a player (${inst.name})`, h.effect, ctx));
        } else fire(game, inst, 'combat damage to a player', h.effect, ctx, h.times);
      }
    }
  }

  // Opp's creatures hit you: its "…, destroy up to one target artifact or enchantment that player
  // controls" takes your priciest one; other effects ("draw a card") run as Opp's.
  function oppCombatDamage(game, hits, defOf) {
    if (!hits.length) return;
    const s = game.bot.s;
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        const h = hitTrigger(line, inst, hits);
        const d = h && destroyTheirs(h.effect);
        if (h && !d) runFor(game, s, inst, h.effect, 'combat damage to you', null, defOf, h.times);
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
    let effect = m[2];
    let hitters = null;
    if ((g = /^one or more (.+?) you control/.exec(who))) times = hits.some(h => bigger(h) && isA(h.inst, g[1])) ? 1 : 0;
    else if ((g = /^(?:an?|another) (.+?) you control(?: with ([a-z]+(?: [a-z]+)?))?/.exec(who))) {
      // White Widow: "a creature you control with deathtouch"
      const kw = g[2] && KEYWORDS.includes(g[2]) ? g[2] : null;
      hitters = hits.filter(h => bigger(h) && isA(h.inst, g[1]) && !(/^another/.test(who) && h.inst === inst) && (!kw || h.st.kw.has(kw))).map(h => h.inst);
      times = hitters.length;
    } else if (isSelf(who, inst)) {
      const hit = hits.find(h => h.inst === inst);
      times = hit ? 1 : 0;
      // "draw cards equal to its toughness": the number, from its stats as it dealt the damage.
      if (hit) effect = effect.replace(/\bcards equal to (?:its|this creature's) (power|toughness)\b/i, (all, k) => `${Math.max(0, /power/i.test(k) ? hit.st.pow : hit.st.tou)} cards`);
      // Desmond Miles: "surveil X, where X is the amount of damage it dealt to that player".
      if (hit) effect = effect.replace(/\b(surveil|scry|draw|mill) x(?: cards)?, where x is the amount of damage (?:it|this creature|[^,]+?) dealt to that player\b/i, (all, verb) => `${verb} ${Math.max(0, hit.dmg != null ? hit.dmg : hitOf(hit.st))}${/draw|mill/i.test(verb) ? ' cards' : ''}`);
    }
    return times ? { times, effect, hitters } : null;
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
      const loyal = m && /^[+−-]?(\d+|x)$/i.test(m[1].trim()); // planeswalkers: "+1: …", "−X: …", "0: Add {C}{C}{C}."
      if (!m || (/^add\b/i.test(m[2]) && !loyal) || /^(equip|crew|cycling|ward)\b/i.test(m[1])) continue;
      const ab = { text: line, mana: '', tap: false, remove: null, life: 0, sacrifice: false, discard: 0, effect: m[2] };
      if (loyal) {
        const k = m[1].trim().replace('−', '-');
        ab.loyalty = /x/i.test(k) ? 'x' : Number(k);
        out.push(ab);
        continue;
      }
      let ok = true;
      for (const part of m[1].split(/,\s*/)) {
        let c;
        if (/^(\{[^}]+\})+$/.test(part) && part !== '{T}') ab.mana += part;
        else if (part === '{T}') ab.tap = true;
        else if ((c = new RegExp(`^remove ${COUNT} ([\\w+/-]+) counters? from (.+)$`, 'i').exec(part)) && isSelf(c[3], inst)) ab.remove = { n: toNumber(c[1]), kind: c[2].toLowerCase() };
        else if ((c = /^pay (\d+) life$/i.exec(part))) ab.life = Number(c[1]);
        else if ((c = /^sacrifice (.+)$/i.exec(part)) && isSelf(c[1], inst)) ab.sacrifice = true;
        // Towering Titan: "Sacrifice a creature with defender"; Piper of the Swarm: "Sacrifice three Rats"
        else if ((c = /^sacrifice (an?|another|two|three|four|five) (.+)$/i.exec(part))) { ab.sacOther = c[2]; ab.sacCount = toNumber(c[1]) || 1; }
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
  // Does this permanent have every word of a phrase like "Rat creature" in its type line? Types other
  // cards give it count too (Roshan's "Other creatures you control are Assassins", see grantsOnce).
  const typeWords = inst => front(inst.typeLine).toLowerCase().split(/[^a-z-]+/).filter(Boolean).concat(inst.extraTypes || []);
  const isA = (inst, phrase) => {
    const have = typeWords(inst);
    return phrase.toLowerCase().split(/\s+/).filter(Boolean).map(singular).every(w => have.includes(w));
  };
  const permanents = s => s.zones.battlefield.map(iid => s.cards[iid]).filter(c => c && !c.faceDown && !c.phasedOut);

  // What other permanents give, all the time: keywords ("Goblins you control have haste", "Other
  // Rats you control have menace") and +X/+X ("Other Elves you control get +1/+1 and have
  // trample", "Pride Sovereign gets +1/+1 for each other Cat you control"). Stored on each
  // creature as granted and anthem (stats adds them); run after anything that changes a battlefield.
  // "Creatures your opponents control get -2/-2" (Elesh Norn) reaches the other table. Then a
  // creature left with 0 or less toughness goes to the graveyard, which can change the lords again.
  function refreshGrants(game, defOf) {
    const tables = [game, game.bot && game.bot.s].filter(Boolean);
    thawCopies(game);
    for (let i = 0; i < 30; i++) { // Massacre Girl can take many rounds
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
        if (c.copyPending) continue; // Wall of Stolen Identity before you pick what it copies
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

  // A spell's discount on itself, from table s: "This spell costs {X} less to cast, where X is the
  // total toughness of creatures you control" (The Pride of Hull Clade) or "This spell costs {1}
  // less to cast for each Wall you control". Only generic mana comes off (autoPay).
  const SELF_DISCOUNT = /^this spell costs \{(x|\d+)\} less to cast(?:, where x is the total (power|toughness) of (.+?) you control| for each (.+?) you control)\.?$/i;
  function selfDiscount(s, inst, defOf) {
    let total = 0;
    for (const line of oracleLines(inst, defOf)) {
      const m = SELF_DISCOUNT.exec(line);
      if (!m) continue;
      const mine = what => permanents(s).filter(c => isA(c, what));
      if (m[2] && /^x$/i.test(m[1])) {
        total += mine(m[3]).reduce((n, c) => { const st = stats(c, c.bot || defOf(c.id)); return n + Math.max(0, /power/i.test(m[2]) ? st.pow : st.tou); }, 0);
      } else if (m[4] && /^\d+$/.test(m[1])) total += Number(m[1]) * mine(m[4]).length;
    }
    return total;
  }

  // "Each creature you control with defender assigns combat damage equal to its toughness rather
  // than its power and can attack as though it didn't have defender" (Arcades), "Each creature
  // assigns …" (Doran, every table's), "Creatures you control can attack as though they didn't have
  // defender" (High Alert), "Wall creatures can attack …" (Rolling Stones). Returns
  // { what, mine, self, kw, tough, attack } or null.
  const TOUGH_RULE = /^each (.+?)( you control)?(?: with ([a-z ]+?))? assigns combat damage equal to its toughness rather than its power( and can attack as though it didn['’]?t have defender)?\.?$/i;
  const DEFENDER_RULE = /^(?:each )?(.+?)( you control)?(?: with ([a-z ]+?))? can attack as though (?:it|they) didn['’]?t have defender\.?$/i;
  function combatRuleOf(line, src) {
    let m = TOUGH_RULE.exec(line);
    if (m) return { what: m[1], mine: !!m[2], self: false, kw: (m[3] || '').toLowerCase(), tough: true, attack: !!m[4] };
    m = DEFENDER_RULE.exec(line);
    if (!m || m[1].includes(':')) return null;
    const self = isSelf(m[1], src);
    return { what: m[1], mine: !!m[2] || self, self, kw: (m[3] || '').toLowerCase(), tough: false, attack: true };
  }

  function grantsOnce(tables, defOf) {
    const kwList = text => text.toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(Boolean);
    // "Creatures your opponents control get -2/-2": from each table, for the other ones.
    const hostile = [];
    const fighting = []; // combatRuleOf's rules, from each table
    const everyone = []; // Marrow-Gnawer: "All Rats have fear." (every table)
    let coats = 0; // Coat of Arms
    for (const s of tables) {
      for (const src of permanents(s)) {
        for (const line of oracleLines(src, defOf)) {
          const m = /^(.+?) your opponents control get ([+-]\d+)\/([+-]\d+)\.?$/i.exec(line);
          if (m && !m[1].includes(':')) hostile.push({ from: s, what: m[1], pow: Number(m[2]), tou: Number(m[3]) });
          const a = /^all (.+?) (?:have (.+?)|get ([+-]\d+)\/([+-]\d+))\.?$/i.exec(line);
          if (a && !a[1].includes(':')) everyone.push({ src: null, other: false, what: a[1], kws: grantKws(a[2] || ''), pow: Number(a[3] || 0), tou: Number(a[4] || 0) });
          if (/^each creature gets \+1\/\+1 for each other creature on the battlefield that shares at least one creature type with it\.?$/i.test(line)) coats++;
          const f = combatRuleOf(line, src);
          if (f) fighting.push({ from: s, src, ...f });
        }
      }
    }
    for (const s of tables) {
      const lords = hostile.filter(h => h.from !== s).map(h => ({ src: null, other: false, what: h.what, kws: [], pow: h.pow, tou: h.tou })).concat(everyone);
      const each = []; // "This gets +1/+1 for each other Cat you control"
      const threshold = []; // Dirty Wererat: "As long as there are seven or more cards in your graveyard, this creature gets +2/+2 and can't block."
      const quoted = []; // 'Commander creatures you own have "Whenever this creature attacks …"'
      const types = []; // Roshan: "Other creatures you control are Assassins in addition to their other types."
      const sneaky = []; // Tetsuko Umezawa: "Creatures you control with power or toughness 1 or less can't be blocked."
      const other = tables.find(t => t !== s);
      for (const src of permanents(s)) {
        for (let line of oracleLines(src, defOf)) {
          let q = /^(other )?(.+?) you (?:control|own) have "(.+)"\.?$/i.exec(line);
          if (q && !q[2].includes(':')) { quoted.push({ src, other: !!q[1], what: q[2], line: q[3] }); continue; }
          q = /^other creatures you control are (\w+?)s? in addition to their other types\.(.*)$/i.exec(line);
          if (q) { types.push({ src, type: q[1].toLowerCase(), everywhere: /aren't on the battlefield/i.test(q[2]) }); continue; }
          q = /^(.+?) you control with power or toughness (\d+) or less can't be blocked\.?$/i.exec(line);
          if (q) { sneaky.push({ what: q[1], n: Number(q[2]) }); continue; }
          // Weathered Sentinels: "can attack players who attacked you during their last turn as though it didn't have defender".
          q = /^(.+?) can attack players who attacked you during their last turn as though it didn't have defender\.?$/i.exec(line);
          if (q) { if (isSelf(q[1], src) && other && other.attackedYou) fighting.push({ from: s, src, self: true, mine: true, attack: true, kw: '' }); continue; }
          // Banners: "Creatures you control of the chosen type get +1/+1" reads as "Elf creatures you control get +1/+1".
          if (/ of the chosen type\b/i.test(line)) {
            if (!src.chosenType) continue;
            line = line.replace(/ of the chosen type\b/i, '').replace(/^(other )?(\w+)/i, (all, o, w) => `${o || ''}${src.chosenType} ${w}`);
          }
          // Heraldic Banner: "Creatures you control of the chosen color get +1/+0." (color: a lord for that color only)
          let color = null;
          if (/ of the chosen color\b/i.test(line)) {
            if (!src.chosenColor) continue;
            color = src.chosenColor;
            line = line.replace(/ of the chosen color\b/i, '');
          }
          q = /^as long as there are (\w+) or more cards in your graveyard, (.+?) gets ([+-]\d+)\/([+-]\d+)(?: and (can't block|can't attack|has (.+?)))?\.?$/i.exec(line);
          if (q && isSelf(q[2], src)) {
            if (s.zones.graveyard.length >= toNumber(q[1])) threshold.push({ src, pow: Number(q[3]), tou: Number(q[4]), kws: q[6] ? grantKws(q[6]) : q[5] ? [q[5].toLowerCase()] : [] });
            continue;
          }
          let m = /^(other )?(.+?) you control can't be blocked except by two or more creatures\.?$/i.exec(line);
          if (m) { lords.push({ src, other: !!m[1], what: m[2], kws: ['menace'], pow: 0, tou: 0 }); continue; } // menace, older words
          // "Other creatures you control with defender get +0/+2" (Stalwart Shield-Bearers): withKw.
          m = /^(other )?(.+?) you control(?: with ([a-z]+(?: [a-z]+)?))? (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+?))?|have (.+?))\.?$/i.exec(line);
          if (m && m[2].includes(':')) continue; // an activated ability ("{2}: Elves you control get …"), not always on
          if (m) {
            const kws = grantKws(m[6] || m[7] || ''); // "protection from Dogs" is left to you; "protection from black and from red" isn't
            const pow = Number(m[4] || 0);
            const tou = Number(m[5] || 0);
            if (kws.length || pow || tou) lords.push({ src, other: !!m[1], what: m[2], withKw: (m[3] || '').toLowerCase(), kws, pow, tou, color });
            continue;
          }
          // Desmond Miles: "… for each other Assassin you control and each Assassin card in your graveyard."
          m = /^(.+?) gets ([+-]\d+)\/([+-]\d+) for each (other )?(.+?) you control(?: and each (.+?) cards? in your graveyard)?\.?$/i.exec(line);
          if (m && isSelf(m[1], src)) { each.push({ src, pow: Number(m[2]), tou: Number(m[3]), other: !!m[4], what: m[5], grave: m[6] || null }); continue; }
          // "Silverwing Squadron's power and toughness are each equal to the number of creatures you control."
          // Pestilence Rats: "… equal to the number of other Rats on the battlefield." (every table)
          m = /^(.+?)['’]s (power and toughness are each|power is|toughness is) equal to the number of (other )?(.+?) (you control|on the battlefield)\.?$/i.exec(line);
          if (m && isSelf(m[1], src)) each.push({ src, pow: /power/i.test(m[2]) ? 1 : 0, tou: /toughness/i.test(m[2]) ? 1 : 0, other: !!m[3], what: m[4], cda: true, everywhere: /battlefield/i.test(m[5]) });
        }
      }
      // Types first, since the rest checks them ("Assassins you control have menace").
      for (const c of Object.values(s.cards)) {
        const add = types.filter(t => t.src !== c && (c.zone === 'battlefield' ? G.isCreature(c) && !c.faceDown : t.everywhere && /\bcreature\b/i.test(front(c.typeLine))))
          .map(t => singular(t.type)).filter(t => !front(c.typeLine).toLowerCase().split(/[^a-z-]+/).includes(t));
        if (add.length) c.extraTypes = [...new Set(add)];
        else delete c.extraTypes;
      }
      const all = permanents(s);
      // "commander creatures": its commander.
      const fitsWhat = (c, what) => {
        const w = what.replace(/^commander\s+/i, '');
        return (w === what || c.commander) && isA(c, w);
      };
      for (const c of creatures(s)) {
        const got = new Set();
        let pow = 0;
        let tou = 0;
        const lines = quoted.filter(q => !(q.other && q.src === c) && fitsWhat(c, q.what)).map(q => q.line);
        if (lines.length) c.grantedLines = lines;
        else delete c.grantedLines;
        // An aura on its equipment that says 'it has "Equipped creature has deathtouch."' (Rune of Mortality).
        G.attachmentsOf(s, c.iid).forEach(id => Object.values(s.cards[id].boosts || {}).forEach(b => (b.equipKw || []).forEach(k => got.add(k))));
        lords.forEach(l => {
          if ((l.other && l.src === c) || !isA(c, l.what)) return;
          if (l.withKw && !stats(c, c.bot || defOf(c.id)).kw.has(l.withKw)) return;
          if (l.color && !stats(c, c.bot || defOf(c.id)).colors.includes(l.color)) return;
          l.kws.forEach(k => got.add(k));
          pow += l.pow;
          tou += l.tou;
        });
        fighting.forEach(f => {
          if ((f.mine && f.from !== s) || !(f.self ? f.src === c : isA(c, f.what))) return;
          if (f.kw && !stats(c, c.bot || defOf(c.id)).kw.has(f.kw)) return;
          if (f.tough) got.add(TOUGH_DMG);
          if (f.attack) got.add(DEFENDER_ATTACKS);
        });
        const cda = { pow: 0, tou: 0 };
        threshold.filter(t => t.src === c).forEach(t => { pow += t.pow; tou += t.tou; t.kws.forEach(k => got.add(k)); });
        // Coat of Arms: +1/+1 for each other creature (any table) that shares a creature type with it.
        if (coats) {
          const subs = x => new Set((front(x.typeLine).split('—')[1] || '').toLowerCase().split(/\s+/).filter(Boolean).concat(x.extraTypes || []));
          const mineSubs = subs(c);
          const n = tables.flatMap(t => creatures(t)).filter(o => o !== c && [...subs(o)].some(w => mineSubs.has(w))).length;
          pow += coats * n;
          tou += coats * n;
        }
        each.filter(e => e.src === c).forEach(e => {
          const n = (e.everywhere ? tables.flatMap(t => permanents(t)) : all).filter(p => !(e.other && p === c) && isA(p, e.what)).length
            + (e.grave ? s.zones.graveyard.filter(iid => isA(s.cards[iid], e.grave)).length : 0);
          if (e.cda) { cda.pow += e.pow * n; cda.tou += e.tou * n; return; }
          pow += e.pow * n;
          tou += e.tou * n;
        });
        if (each.some(e => e.src === c && e.cda)) c.cda = cda;
        else delete c.cda;
        sneaky.forEach(t => { const st = stats(c, c.bot || defOf(c.id)); if (isA(c, t.what) && (st.pow <= t.n || st.tou <= t.n)) got.add('unblockable'); });
        if (got.size) c.granted = [...got];
        else delete c.granted;
        if (pow || tou) c.anthem = { pow, tou };
        else delete c.anthem;
      }
      // How many creatures have defender (Overgrown Battlement's and Axebane Guardian's mana, game.js).
      s.kwCount = { defender: creatures(s).filter(c => stats(c, c.bot || defOf(c.id)).kw.has('defender')).length };
    }
  }
  // Keywords a lord gives: "flying, first strike, …, and protection from black and from red" (Akroma's Memorial).
  function grantKws(text) {
    let t = String(text || '').toLowerCase();
    const out = [];
    const pro = /protection from [a-z]+(?:,? (?:and )?from [a-z]+)*/.exec(t);
    if (pro) {
      const k = protectionKw(`protection from ${pro[0].replace(/^protection from /, '').replace(/,? (?:and )?from /g, ' and ')}`);
      if (k) out.push(k);
      t = t.replace(pro[0], '');
    }
    // "toxic 1" (Karumonix) is the keyword toxic.
    return out.concat(kwList(t).map(k => { const n = /^([a-z ]+?) \d+$/.exec(k); return n && NUMBERED.includes(n[1]) ? n[1] : k; }).filter(k => KEYWORDS.includes(k)));
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
    // "Other creatures you control get +1/+0" (Guul Draz Overseer): not the card itself.
    const other = /^other /i.test(p[1]);
    const who = permanents(s).filter(c => G.isCreature(c) && isA(c, p[1].replace(/^other /i, '')) && !(other && c === inst));
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
  // ctx (as for runEffect) does the other modes ("Exile target creature or planeswalker.", "Return one
  // or two target creature … cards from your graveyard to your hand.").
  function runModes(s, inst, defOf, chosen, ctx) {
    const info = spellModes(inst, defOf);
    const left = [];
    for (const i of chosen) {
      const text = info && info.modes[i];
      if (!text) continue;
      const done = text.split(/(?<=\.)\s+/).map(sentence => pumpSentence(s, inst, sentence)).some(Boolean);
      if (done) continue;
      if (ctx && canRunAll(text, Object.assign({ self: inst, defOf }, ctx))) left.push(...runEffect(s, text, Object.assign({ self: inst, defOf }, ctx)));
      else left.push(text);
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
  // Anything else it can do ("another target Assassin you control gains deathtouch until end of turn",
  // 'put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn')
  // runs with ctx, whose targets are picked without asking (autoTarget) since combat doesn't wait.
  // "Whenever this creature attacks a player, if no opponent has more life than that player, …":
  // info.player is false when it attacks a planeswalker, info.mostLife false when someone else has more life.
  function combatTrigger(s, inst, event, defOf, ctx, info = {}) {
    const attacking = [];
    if (!inst || inst.faceDown) return attacking;
    for (const line of oracleLines(inst, defOf)) {
      const m = /^when(?:ever)? (.+?) (enters(?: the battlefield)? or attacks|attacks or blocks|attacks|blocks)( a player)?(?: a creature)?, (.+)$/i.exec(line); // "When this creature blocks" (Wall of Junk)
      if (!m || !isSelf(m[1], inst) || !m[2].toLowerCase().split(' or ').includes(event)) continue;
      if (m[3] && info.player === false) continue;
      let effect = m[4];
      const most = /^if no opponent has more life than that player, (.+)$/i.exec(effect);
      if (most) {
        if (info.mostLife === false) continue;
        effect = most[1];
      }
      m[3] = effect;
      if (counterEach(s, inst, m[3], event)) continue;
      const t = triggerTokens(s, inst, m[3].trim(), event);
      if (t) { attacking.push(...t); continue; }
      const p = /^(.+?) gets? ([+-](?:\d+|x))\/([+-](?:\d+|x)) until end of turn(?:, where x is the number of (.+?) you control)?\.?$/i.exec(m[3].trim());
      if (!p || (/x/i.test(p[2] + p[3]) && !p[4])) {
        if (ctx && canRunAll(m[3], Object.assign({ self: inst }, ctx))) {
          const go = () => runEffect(s, m[3], Object.assign({ self: inst }, ctx));
          const left = ctx.run ? ctx.run(go) : go();
          G.log(s, `${inst.name} ${event === 'blocks' ? 'blocks' : 'attacks'}: ${m[3]}${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
        }
        continue;
      }
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
      // Towering Titan: "… enters with X +1/+1 counters on it, where X is the total toughness of other creatures you control."
      const t = /^(.+?) enters(?: the battlefield)? with x ([\w+/-]+) counters on it, where x is the total (power|toughness) of other (.+?) you control\.?$/i.exec(line);
      if (t && isSelf(t[1], inst)) {
        const n = permanents(s).filter(p => p !== inst && G.isCreature(p) && isA(p, t[4])).reduce((k, p) => { const st = stats(p, p.bot || defOf(p.id)); return k + Math.max(0, /power/i.test(t[3]) ? st.pow : st.tou); }, 0);
        if (n) G.counter(s, inst.iid, t[2].toLowerCase(), n, { effect: true });
        G.log(s, `${inst.name} enters with ${n} ${t[2]} counter${n === 1 ? '' : 's'}.`);
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

  function oracleText(inst, defOf) {
    const card = defOf(inst.id) || {};
    return faceOracle(card.oracle, card.name || inst.name, inst.flipped);
  }
  const kwOf = (inst, defOf) => new Set(inst.bot ? inst.bot.kw || [] : keywords(oracleText(inst, defOf)));
  const pumpBy = (c, pow, tou) => { c.pump = { ...c.pump, pow: (c.pump ? c.pump.pow : 0) + pow, tou: (c.pump ? c.pump.tou : 0) + tou }; };
  const isOpps = (game, s) => !!(game.bot && s === game.bot.s);

  // Runs an effect for whoever controls src: on your table (ctx as for runEffect), or on Opp's with
  // your life as its opponent's. Logs it, with what's left to do by hand. Returns what's left.
  function runFor(game, s, src, text, what, ctx, defOf, times = 1) {
    if (isOpps(game, s)) {
      const left = onOpp(game, t => runEffect(t, text, Object.assign(oppCtx(game, src, defOf), ctx || {}), times));
      G.log(s, `${src.name}: ${what}${times > 1 ? ` (×${times})` : ''}.${left.length ? ` Not done: ${left.join('; ')}.` : ''}`);
      return left;
    }
    const left = runEffect(s, text, Object.assign({ self: src, other: game.bot ? game.bot.s : null }, ctx), times);
    G.log(s, `${src.name}: ${what}${times > 1 ? ` (×${times})` : ''}.${left.length ? ` Do by hand: ${left.join('; ')}.` : ''}`);
    return left;
  }

  // What Opp's effects do to you (src: Opp's card). Run inside onOpp, so life goes through addLife.
  function oppCtx(game, src, defOf) {
    const s = game.bot.s;
    const why = `Opp's ${src.name}`;
    return {
      self: src, other: game, defOf,
      target: eff => { autoTarget(game, s, src, eff, defOf); },
      hitOpps: (n, dmg) => { addLife(game, 'you', -n); if (dmg) opponentDamaged(game, s, n, defOf); },
      oppsSacrifice: (n, what) => youSacrifice(game, n, why, what),
      loseHalf: () => addLife(game, 'you', -Math.ceil(Math.max(0, lifeOf(game, 'you')) / 2)),
      oppsExileGreatest: what => exileGreatest(game, game, what, why, defOf),
      exileGrave: () => exileGraveyard(game, why),
      oppsHandPick: spec => handPick(game, s, game, spec, why, defOf),
      oppsDraw: n => G.drawCards(game, n),
      oppsDiscard: n => youDiscard(game, n, false, why),
      exileTop: () => exileTopCard(game, s, why),
    };
  }

  // Blot Out on table t: it exiles its creature or planeswalker with the greatest mana value (the
  // least valuable one when there's a tie). g: the table it's logged on.
  function exileGreatest(g, t, what, why, defOf) {
    const cmc = c => (c.bot ? c.bot.cmc : (defOf(c.id) || {}).cmc) || 0;
    const list = permanents(t).filter(c => what.split(/\s+or\s+/).some(w => isA(c, w)));
    if (!list.length) return G.log(g, `${why}: nothing to exile.`);
    const top = Math.max(...list.map(cmc));
    const pick = list.filter(c => cmc(c) === top).sort((a, b) => value(stats(a, a.bot || defOf(a.id))) - value(stats(b, b.bot || defOf(b.id))))[0];
    G.log(g, `${why}: ${t === g ? 'you' : 'Opp'} exiled ${pick.name} (mana value ${top}).`);
    G.move(t, pick.iid, pick.commander ? 'command' : 'exile');
  }
  // Bojuka Bog on table t's graveyard.
  function exileGraveyard(t, why) {
    const n = t.zones.graveyard.length;
    [...t.zones.graveyard].forEach(iid => G.move(t, iid, 'exile'));
    G.log(t, `${why}: exiled ${n} card${n === 1 ? '' : 's'} from the graveyard.`);
  }
  // Appetite for Brains: from table t's hand, the chooser (table by) takes its best card that fits
  // spec { what, mv, to }. g: where it's logged.
  function handPick(g, by, t, spec, why, defOf) {
    const cmc = c => (c.bot ? c.bot.cmc : (defOf(c.id) || {}).cmc) || 0;
    const fits = c => cmc(c) >= (spec.mv || 0) && (!spec.what || spellFits(c, spec.what.replace(/,/g, ''), defOf));
    const pick = t.zones.hand.map(iid => t.cards[iid]).filter(fits).sort((a, b) => cmc(b) - cmc(a))[0];
    G.log(g, `${why}: ${pick ? `${spec.to === 'exile' ? 'exiled' : 'discarded'} ${pick.name} from the hand` : 'no card in the hand to take'}.`);
    if (pick) G.move(t, pick.iid, spec.to);
  }
  // Reno and Rude: the top card of the other table's library goes to that player's exile. by: the
  // table of whoever's card did it. Returns the exiled card (on the other table).
  function exileTopCard(game, by, why) {
    const t = by === game ? game.bot && game.bot.s : game;
    const iid = t && t.zones.library[0];
    if (!iid) return null;
    G.move(t, iid, 'exile');
    G.log(by, `${why}: exiled ${t.cards[iid].name} from the top of ${t === game ? 'your' : "Opp's"} library.`);
    return t.cards[iid];
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
  // opts.game: the whole game, so attack triggers can pick targets (autoTarget) and change life;
  // opts.ctx: more of the context for yours (hitOpps); opts.info(inst): { player, mostLife } (see combatTrigger).
  function declareAttack(s, insts, defOf, opts = {}) {
    insts = insts.filter(i => i && i.zone === 'battlefield');
    insts.forEach(i => { i.attacking = true; }); // until endOfCombat ("each attacking creature")
    const joined = [];
    const game = opts.game;
    const ctxFor = inst => {
      if (!game) return null;
      if (isOpps(game, s)) return Object.assign(oppCtx(game, inst, defOf), { run: fn => onOpp(game, fn) });
      return Object.assign({ other: game.bot ? game.bot.s : null, defOf }, opts.ctx, { target: (eff, part, src) => { autoTarget(game, s, src || inst, eff, defOf); } });
    };
    insts.forEach(inst => combatTrigger(s, inst, 'attacks', defOf, ctxFor(inst), opts.info ? opts.info(inst) : {}).forEach(iid => joined.push([inst.iid, iid])));
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

  // After combat on both tables: "return it to its owner's hand at end of combat" (Wall of Junk).
  function combatOver(game) {
    for (const t of [game, game.bot && game.bot.s].filter(Boolean)) {
      for (const c of creatures(t).filter(x => x.bounceAfterCombat)) {
        G.move(t, c.iid, 'hand');
        G.log(t, `${c.name} returned to its owner's hand at end of combat.`);
      }
    }
  }

  // End of combat: decayed creatures that attacked are sacrificed.
  function endOfCombat(s, attackers, defOf) {
    creatures(s).forEach(c => { delete c.attacking; });
    for (const inst of attackers) {
      if (!inst || inst.zone !== 'battlefield' || !stats(inst, inst.bot || defOf(inst.id)).kw.has('decayed')) continue;
      G.log(s, `${inst.name} (decayed) is sacrificed at end of combat.`);
      G.move(s, inst.iid, inst.commander ? 'command' : 'graveyard');
    }
  }

  // Opp sacrifices n permanents (of a kind, like "creature", when what is given): tokens first, then
  // its cheapest cards, lands last (unless it has plenty).
  function oppSacrifices(game, n, why, what) {
    const s = game.bot.s;
    const lands = permanents(s).filter(G.isLand).length;
    const cost = c => (c.token ? -10 : G.isLand(c) ? (lands >= 6 ? 0 : 50) : (c.bot ? c.bot.cmc : 0) + 1);
    const gone = permanents(s).filter(c => !what || isA(c, what)).sort((a, b) => cost(a) - cost(b)).slice(0, n);
    gone.forEach(c => moveOpps(s, c));
    if (gone.length) G.log(game, `${why}: Opp sacrificed ${andList(gone.map(c => c.name))}.`);
    else if (what) G.log(game, `${why}: Opp had no ${what} to sacrifice.`);
  }
  // You sacrifice n permanents (of a kind, when what is given): you pick them (app.js shows game.mustSacrifice).
  function youSacrifice(game, n, why, what) {
    if (!permanents(game).filter(c => !what || isA(c, what)).length) return;
    game.mustSacrifice = { n: ((game.mustSacrifice || {}).n || 0) + n, why, what: what || (game.mustSacrifice || {}).what || null };
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
    const tables = [game, game.bot && game.bot.s].filter(Boolean);
    if (G.isCreature(inst)) tables.forEach(t => { t.deathsThisTurn = [...(t.deathsThisTurn || []), inst.name]; }); // Ebondeath
    for (const t of tables) {
      const watchers = permanents(t).filter(w => w !== inst);
      if (t === s) watchers.push(inst); // "Blood Artist or another creature dies" sees itself die
      for (const w of watchers) {
        for (const line of oracleLines(w, defOf)) {
          const m = DIES_WATCH.exec(line);
          if (!m || KONRAD.test(line)) continue; // Syr Konrad: cardMoved
          // The one that died sees itself only with "Blood Artist or another creature".
          if (w === inst && !(m[1] && isSelf(m[1], w))) continue;
          if (m[3] && inst.token) continue;
          if (!m[4].split(/\s+or\s+/).some(x => isA(inst, x))) continue;
          if (m[5] && (/you control/i.test(m[5]) ? t !== s : t === s)) continue;
          // Massacre Girl, Known Killer: "if its toughness was less than 1, draw a card".
          let effect = m[6];
          const cond = /^if its toughness was less than (\d+), (.+)$/i.exec(effect);
          if (cond) {
            if (!(toughnessAtDeath(inst, info, defOf) < Number(cond[1]))) continue;
            effect = cond[2];
          }
          runFor(game, t, w, effect, `${inst.name} died`, t === game ? ctx : null, defOf);
        }
      }
      // "Whenever a creature dies this turn, …" (Massacre Girl), until the turn ends.
      for (const d of [...(t.delayed || [])]) {
        if (d.on !== 'dies' || !G.isCreature(inst)) continue;
        const src = t.cards[d.src] && t.cards[d.src].name === d.name ? t.cards[d.src] : { name: d.name, iid: d.src };
        runFor(game, t, src, d.effect, `${inst.name} died`, t === game ? ctx : null, defOf);
      }
    }
    if (G.isCreature(inst) && info.to === 'graveyard') recoverTriggers(game, s, inst, defOf, ctx);
  }

  // Its toughness as it left the battlefield (Game.move's info has its counters, pumps and equipment).
  function toughnessAtDeath(inst, info, defOf) {
    const was = Object.assign({}, inst, { counters: info.counters || {}, pump: info.pump, anthem: info.anthem, cda: info.cda, boosts: info.boosts, custom: info.custom || inst.custom });
    return stats(was, inst.bot || defOf(inst.id)).tou;
  }

  // Recover (Garza's Assassin): "When another creature is put into your graveyard from the
  // battlefield, you may pay half your life, rounded up. If you do, return this card from your
  // graveyard to your hand. Otherwise, exile this card." You're asked (ctx.recover, app.js); Opp pays
  // mana when it can and life when it keeps 10 or more.
  const RECOVER = /^recover\s*[—-]?\s*(.+?)\.?$/i;
  const recoverCost = (inst, defOf) => { const m = oracleLines(inst, defOf).map(l => RECOVER.exec(l)).find(Boolean); return m ? m[1] : null; };
  function recoverTriggers(game, s, dead, defOf, ctx) {
    for (const iid of [...s.zones.graveyard]) {
      const card = s.cards[iid];
      if (!card || card === dead || card.iid === dead.iid) continue;
      const cost = recoverCost(card, defOf);
      if (!cost) continue;
      if (s === game && ctx && ctx.recover) { ctx.recover(card, cost); continue; }
      const who = s === game ? 'you' : 'opp';
      const half = /^pay half your life, rounded up$/i.test(cost) ? Math.ceil(Math.max(0, lifeOf(game, who)) / 2) : 0;
      const mana = /^(\{[^}]+\})+$/.test(cost);
      const pay = half ? lifeOf(game, who) - half >= 10 : mana && affordable(s, cost, 0);
      applyRecover(game, s, iid, pay, defOf);
    }
  }
  // Pays the recover cost and returns the card to its owner's hand (pay), or exiles it.
  function applyRecover(game, s, iid, pay, defOf) {
    const card = s.cards[iid];
    if (!card || card.zone !== 'graveyard') return;
    const cost = recoverCost(card, defOf) || '';
    const who = s === game ? 'you' : 'opp';
    if (pay) {
      if (/^pay half your life, rounded up$/i.test(cost)) addLife(game, who, -Math.ceil(Math.max(0, lifeOf(game, who)) / 2));
      else if (/^(\{[^}]+\})+$/.test(cost)) { if (who === 'opp') onOpp(game, () => G.autoPay(s, cost)); else G.autoPay(s, cost); }
      G.move(s, iid, 'hand');
      G.log(s, `${card.name} (recover): paid ${/^pay/i.test(cost) ? cost.replace(/^pay /i, '') : cost} and returned it to ${who === 'you' ? 'your' : "Opp's"} hand.`);
    } else {
      G.move(s, iid, 'exile');
      G.log(s, `${card.name} (recover): not paid, so it was exiled.`);
    }
  }

  // Syr Konrad: "Whenever another creature dies, or a creature card is put into a graveyard from
  // anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1
  // damage to each opponent." Run for every card that changes zones (G.hooks.moved), on table s.
  const KONRAD = /^whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, (?:you may )?(.+)$/i;
  // Rat King, Pale Piper: "Whenever Rat King or another nontoken creature you control leaves the battlefield, …"
  const LEAVES_WATCH = /^whenever (?:(.+?) or )?(another |an? )?(nontoken )?(.+?)( you control)? leaves the battlefield, (?:you may )?(.+)$/i;
  function cardMoved(game, s, inst, from, to, defOf, ctx) {
    if (!inst || from === to || inst.faceDown) return;
    if (from === 'battlefield') {
      s.leftThisTurn = true; // Rat King, Verminister's "if a permanent left the battlefield under your control this turn"
      const watchers = permanents(s).concat(inst);
      for (const w of watchers) {
        for (const line of oracleLines(w, defOf)) {
          const m = LEAVES_WATCH.exec(line);
          if (!m) continue;
          if (w === inst) {
            if (!(m[1] && isSelf(m[1], w))) continue; // the one that left sees itself only by name
          } else if (!m[2] || (m[3] && inst.token) || !isA(inst, m[4])) continue;
          runFor(game, s, w, m[6], `${inst.name} left the battlefield`, s === game ? ctx : null, defOf);
        }
      }
    }
    const creatureCard = /\bcreature\b/i.test(front(inst.typeLine));
    const dies = from === 'battlefield' && (to === 'graveyard' || (to === 'command' && inst.commander)) && G.isCreature(inst);
    const intoGrave = to === 'graveyard' && from !== 'battlefield' && creatureCard && !inst.token;
    const leaves = from === 'graveyard' && creatureCard;
    if (!dies && !intoGrave && !leaves) return;
    for (const t of [game, game.bot && game.bot.s].filter(Boolean)) {
      for (const w of permanents(t)) {
        if (w === inst) continue; // "another creature"
        for (const line of oracleLines(w, defOf)) {
          const m = KONRAD.exec(line);
          if (!m || (!dies && !intoGrave && !(leaves && t === s))) continue;
          runFor(game, t, w, m[1], `${inst.name} ${dies ? 'died' : intoGrave ? 'went to a graveyard' : 'left your graveyard'}`, t === game ? ctx : null, defOf);
        }
      }
    }
  }

  // "Whenever you cast a noncreature spell", "Magecraft — Whenever you cast or copy an instant or sorcery spell", …
  const CAST_WATCH = /^(?:magecraft\s*[—-]\s*)?whenever you cast (?:or copy )?(?:an? )?(.*?)\s*spells?( of the chosen type)?( during an opponent's turn| during your turn)?, (?:you may )?(.+)$/i;

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
        // Vanquisher's Banner: "a creature spell of the chosen type".
        if (m[2] && !(w.chosenType && isA(spell, w.chosenType))) continue;
        // Nightmare Sower: "during an opponent's turn" (s.offTurn while someone else's turn is on).
        if (m[3] && /opponent/i.test(m[3]) !== !!s.offTurn) continue;
        const effect = m[4].trim();
        const p = /^(.+?) gets? ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i.exec(effect);
        if (p && isSelf(p[1], w)) {
          pumpBy(w, Number(p[2]), Number(p[3]));
          G.log(s, `${w.name}: you cast ${spell.name}, so it gets ${p[2]}/${p[3]} until end of turn.`);
        } else if (!pumpSentence(s, w, effect)) runFor(game, s, w, effect, `you cast ${spell.name}`, isOpps(game, s) ? null : ctx, defOf);
      }
    }
    opponentActed(game, s, 'cast', 1, defOf, isOpps(game, s) ? null : ctx); // Rhystic Study on the other side
    const lines = oracleLines(spell, defOf);
    // Ugin, Eye of the Storms: "When you cast this spell, exile up to one target permanent that's one or more colors."
    for (const l of lines) {
      const c = /^when you cast this spell, (?:you may )?(.+)$/i.exec(l);
      if (c) runFor(game, s, spell, c[1], 'cast', isOpps(game, s) ? null : ctx, defOf);
    }
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
    if (spell.zone === 'battlefield') G.move(s, spell.iid, spell.castAftermath ? 'exile' : 'graveyard'); // aftermath: exiled after
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
  // Also "Whenever an opponent loses life, you gain that much life." (Bloodthirsty Conqueror) when the
  // other side lost life. What those triggers do can set off more (Sanguine Bond with Bloodthirsty
  // Conqueror goes on until someone is at 0), so it goes round until nothing changes (at most 100 times).
  const GAIN_WATCH = /^whenever you gain life( for the first time each turn)?, (?:you may )?(.+)$/i;
  const LOSS_WATCH = /^whenever an opponent loses life( during your turn)?, (?:you may )?(.+)$/i;
  function lifeChanged(game, before, defOf, ctx, friends = []) {
    const tables = [{ t: game, key: 'life', was: before.you }];
    if (game.bot && before.opp != null) tables.push({ t: game.bot.s, key: 'oppLife', was: before.opp });
    const rules = tables.map(x => tableRules(x.t, defOf)).concat(friends.map(r => ({ noGain: r.noGain || {} })));
    // Teferi's Protection: "your life total can't change" until your next turn.
    tables.forEach(x => {
      if (x.t.untilNextTurn && x.t.untilNextTurn.lifeLock && game[x.key] !== x.was) {
        G.log(x.t, `${x.t === game ? 'Your' : "Opp's"} life total can't change, so it stays ${x.was}.`);
        game[x.key] = x.was;
      }
    });
    const fill = (text, n) => text.replace(/\bthat much life\b/gi, `${n} life`).replace(/\bthat many\b/gi, String(n));
    for (let round = 0; round < 100; round++) {
      const fired = [];
      tables.forEach((x, i) => {
        const gained = game[x.key] - x.was;
        if (gained > 0 && rules.some((r, j) => r.noGain.all || (r.noGain.opps && j !== i) || (r.noGain.self && j === i))) {
          game[x.key] = x.was;
          G.log(x.t, `${x.t === game ? 'You' : 'Opp'} can't gain life, so the ${gained} life is taken back.`);
        }
      });
      tables.forEach((x, i) => {
        const change = game[x.key] - x.was;
        x.was = game[x.key];
        if (change > 0) {
          for (const w of permanents(x.t)) {
            for (const line of oracleLines(w, defOf)) {
              const m = GAIN_WATCH.exec(line);
              if (!m || (m[1] && x.t.gainTurn === x.t.turn)) continue;
              fired.push({ t: x.t, w, effect: fill(m[2], change), why: `gained ${change} life` });
            }
          }
          x.t.gainTurn = x.t.turn;
        } else if (change < 0 && tables.length > 1) {
          const other = tables[1 - i].t;
          for (const w of permanents(other)) {
            for (const line of oracleLines(w, defOf)) {
              const m = LOSS_WATCH.exec(line);
              if (!m || (m[1] && other.offTurn)) continue;
              fired.push({ t: other, w, effect: fill(m[2], -change), why: `${x.t === game ? 'you' : 'Opp'} lost ${-change} life` });
            }
          }
        }
      });
      if (!fired.length) return;
      fired.forEach(f => runFor(game, f.t, f.w, f.effect, f.why, f.t === game ? ctx : null, defOf));
      if (game.life <= 0 || (game.bot && game.oppLife <= 0)) return;
    }
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
  // Geist-Fueled Scarecrow: "Creature spells you cast cost {1} more to cast." (only its controller's)
  const SPELL_TAX = /^(?:(.+?) )?spells( your opponents cast| you cast)? cost \{(\d+)\} more to cast\.?$/i;
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
        else if ((m = SPELL_TAX.exec(line)) && !/\btarget/i.test(line)) out.spellTaxes.push({ what: (m[1] || '').trim(), n: Number(m[3]), opps: /opponents/i.test(m[2] || ''), own: /you cast/i.test(m[2] || '') });
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
    .filter(x => (!x.opps || !t.own) && (!x.own || t.own) && spellFits(spell, x.what, defOf)).reduce((m, x) => m + x.n, 0), 0);

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
  // blockers. s: the blockers' table (yours); ctx: as for runEffect. Then "Whenever a creature you
  // control blocks, …" (blockWatch). Returns the blocks, with every list an array.
  function blockTriggers(s, blocks, defOf, ctx) {
    const declared = [];
    for (const [a, list] of Object.entries(blocks)) {
      const ids = [].concat(list || []);
      blocks[a] = [...ids];
      // Wall of Frost: "that creature" is the attacker it blocks (on ctx.other, Opp's table).
      const attacker = ctx && ctx.other && ctx.other.cards ? ctx.other.cards[a] : null;
      ids.forEach(id => { declared.push(s.cards[id]); blocks[a].push(...combatTrigger(s, s.cards[id], 'blocks', defOf, ctx ? Object.assign({ defOf }, ctx, attacker ? { blocked: attacker } : {}) : null)); });
    }
    blockWatch(s, s, defOf, ctx, declared);
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
  // Also "create a tapped 1/1 …" and quoted abilities: 'with "This token can't block."' (Lord Skitter).
  const TOKEN_TEXT = /^create (a number of|\w+) (?:tapped )?(\d+|x)\/(\d+|x) ([a-z ,'-]+?) creature tokens?(?: with ((?:"[^"]*"|[^."])+?))?(?: that(?: are|'s| is) (?:(tapped and )?(attacking)|(blocking) that creature))?(?: equal to the number of (.+?))?(?:,? where x is (?:the number of )?(.+?))?\.?$/i;
  function triggerTokens(s, inst, text, event) {
    const m = TOKEN_TEXT.exec(text);
    if (!m) return null;
    const enterTapped = /^create (?:a number of|\w+) tapped /i.test(text);
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
    const quoted = [...String(m[5] || '').matchAll(/"([^"]+)"/g)].map(q => q[1].replace(/[,.]$/, '.'));
    const kw = String(m[5] || '').replace(/"[^"]*"/g, '').toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).filter(k => KEYWORDS.includes(k));
    const abilities = [kw.map(k => k[0].toUpperCase() + k.slice(1)).join(', '), ...quoted].filter(Boolean).join('\n');
    const joins = (!!m[7] && event === 'attacks') || (!!m[8] && event === 'blocks');
    const tapped = (joins && !!m[6]) || enterTapped;
    const out = [];
    for (let i = 0; i < n; i++) {
      const tok = G.createToken(s, { custom: true, name: type, typeLine: `Token Creature — ${type}`, pt: `${pow}/${tou}`, text: abilities }, { quiet: true });
      if (inst.bot) tok.bot = { cost: '', cmc: 0, power: String(pow), toughness: String(tou), kw: keywords(abilities), colors, spell: null }; // Opp's: the facts botStats reads
      if (tapped) { tok.tapped = true; tok.tappedFor = null; }
      if (joins) out.push(tok.iid);
    }
    const how = !joins ? '' : event === 'blocks' ? ', blocking the same creature' : tapped ? ', tapped and attacking' : ', attacking';
    G.log(s, `${inst.name} ${event}: created ${n} ${pow}/${tou} ${type} token${n === 1 ? '' : 's'}${kw.length ? ` with ${kw.join(', ')}` : ''}${how}${by.length ? ` (doubled by ${by.join(', ')})` : ''}.`);
    return out;
  }

  // "At the beginning of your end step, (you may) mill four cards. If you do, return up to two Rat
  // creature cards from your graveyard to your hand." Returns [{ inst, mill, up, what }].
  const END_MILL = new RegExp(`^at the beginning of your end step, (?:you may )?mill ${COUNT} cards?\\. if you do, return up to ${COUNT} (.+?) cards? from your graveyard to your hand\\.?$`, 'i');
  function endStepTriggers(s, defOf) {
    const out = [];
    for (const inst of permanents(s)) {
      for (const line of oracleLines(inst, defOf)) {
        const m = END_MILL.exec(line);
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
      .filter(c => !c.inst.tapped && hitOf(c.st) > 0 && !noAttack(c.st) && !sick(s, c.inst, c.st));
    if (!ready.length) return [];

    // Everyone attacks if that's lethal even after your blockers each stop the biggest one they can.
    const byPower = [...ready].sort((a, b) => hitOf(b.st) - hitOf(a.st));
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
    const yourPower = you.filter(c => !noAttack(c.st)).map(c => hitOf(c.st)).sort((a, b) => b - a);
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
      const pick = list.filter(a => !targets[a.iid] && toPlayer(a.st) >= Math.max(1, w.loyalty)).sort((a, b) => hitOf(a.st) - hitOf(b.st))[0];
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
    upkeepDraws(game); // Arcane Denial
    phaseTriggers(game, s, 'upkeep', defOf, null);
    phaseTriggers(game, s, 'draw step', defOf, null); // The Immortal Sun
    const landsBefore = s.zones.battlefield.length;
    onOpp(game, () => playLand(s));
    if (s.zones.battlefield.length > landsBefore) notes.push(`played ${s.cards[s.zones.battlefield[s.zones.battlefield.length - 1]].name}`);
    crackFetches(game, defOf);
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
    phaseTriggers(game, s, 'combat', defOf, null);
    refreshGrants(game, defOf);
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
    // Interceptor in Opp's graveyard: back tapped and attacking when Opp can pay.
    if (attackers.length) {
      for (const g of graveAttackers(s, attackers.map(iid => s.cards[iid]), defOf)) {
        if (!affordable(s, g.cost, 0)) continue;
        onOpp(game, () => G.autoPay(s, g.cost));
        attackers.push(returnAttacking(s, g.inst));
      }
    }
    // "Whenever this attacks" triggers, exalted, battle cry, annihilator; tokens that enter attacking join in.
    attackers.push(...declareAttack(s, attackers.map(iid => s.cards[iid]), defOf, { sacrifice: (n, why) => youSacrifice(game, n, why), game }).map(([, iid]) => iid));
    if (attackers.length) attackWatch(game, s, defOf, null, attackers.map(iid => s.cards[iid]));
    if (attackers.length) s.attackedYou = true; // Weathered Sentinels (until its next turn, G.nextTurn)
    bot.pending = attackers.length ? { attackers, targets: chooseTargets(game, attackers, defOf) } : null;
    return { attackers, notes };
  }

  // ---------- costs, graveyards and other rules for a few cards ----------

  // The Darkness Crystal on another table than s: "If a nontoken creature an opponent controls would
  // die, instead exile it and you gain 2 life." Returns 'exile' (G.hooks.wouldDie) or null. The card
  // remembers it (exiledWith), for "Put target creature card exiled with The Darkness Crystal …".
  const CRYSTAL = /^if a nontoken creature an opponent controls would die, instead exile it and you gain (\w+) life\.?$/i;
  function wouldDie(game, s, inst, defOf) {
    if (inst.token || inst.commander) return null;
    for (const t of [game, game.bot && game.bot.s].filter(Boolean)) {
      if (t === s) continue;
      for (const w of permanents(t)) {
        for (const line of oracleLines(w, defOf)) {
          const m = CRYSTAL.exec(line);
          if (!m) continue;
          inst.exiledWith = w.name;
          addLife(game, t === game ? 'you' : 'opp', toNumber(m[1]));
          G.log(t, `${w.name}: ${inst.name} was exiled instead of dying, and ${t === game ? 'you' : 'Opp'} gained ${toNumber(m[1])} life.`);
          return 'exile';
        }
      }
    }
    return null;
  }

  // Madness {1}{B}: the cost, or null.
  const madnessCost = (inst, defOf) => { const m = oracleLines(inst, defOf).map(l => /^madness ((?:\{[^}]+\})+)/i.exec(l)).find(Boolean); return m ? m[1] : null; };

  // The ways you can cast a spell from your hand, when it has more than one: [{ key, label, cost }].
  //   Offspring {2} (pay {2} more for a 1/1 token copy), Freerunning {3}{B} (after an Assassin or your
  //   commander dealt combat damage to a player this turn), "You may pay {1}{B} rather than pay this
  //   spell's mana cost." (Baleful Mastery). s: your table.
  function costChoices(s, inst, defOf) {
    const card = defOf(inst.id) || {};
    const cost = card.manaCost || '';
    const out = [{ key: 'normal', label: `Cast it (${cost || 'free'})`, cost }];
    for (const line of oracleLines(inst, defOf)) {
      let m;
      if ((m = /^offspring ((?:\{[^}]+\})+)/i.exec(line))) out.push({ key: 'offspring', label: `With offspring (${cost}${m[1]}): also a 1/1 token copy`, cost: cost + m[1] });
      else if ((m = /^freerunning ((?:\{[^}]+\})+)/i.exec(line)) && s.freerunTurn === s.turn) out.push({ key: 'freerun', label: `Freerunning (${m[1]})`, cost: m[1] });
      else if ((m = /^you may pay ((?:\{[^}]+\})+) rather than pay this spell's mana cost\.?$/i.exec(line))) out.push({ key: 'alt', label: `For ${m[1]} instead${oracleLines(inst, defOf).some(l => /^if the .+ cost was paid, an opponent draws/i.test(l)) ? ' (an opponent draws a card)' : ''}`, cost: m[1] });
    }
    return out;
  }
  // Offspring: "When this creature enters, create a 1/1 token copy of it."
  function offspringCopy(s, inst) {
    const tok = G.copyAsToken(s, inst.iid);
    if (!tok) return;
    tok.custom = { pt: '1/1', text: '' };
    G.log(s, `${inst.name} (offspring): made a 1/1 token copy.`);
  }

  // Interceptor, Shadow's Hound: "Whenever you attack with one or more legendary creatures, you may
  // pay {2}{B}. If you do, return this card from your graveyard to the battlefield tapped and
  // attacking." The cards in table s's graveyard that can, for these attackers: [{ inst, cost }].
  // Persistent Marshstalker: "Whenever you attack with one or more Rats, if there are seven or more cards in your graveyard, you may pay {2}{B}. …"
  const GRAVE_ATTACK = /^whenever you attack with one or more (.+?)(?: creatures?)?(?:, if there are (\w+) or more cards in your graveyard)?, you may pay ((?:\{[^}]+\})+)\. if you do, return this card from your graveyard to the battlefield tapped and attacking\.?$/i;
  function graveAttackers(s, attackers, defOf) {
    const out = [];
    for (const iid of s.zones.graveyard) {
      const inst = s.cards[iid];
      const m = oracleLines(inst, defOf).map(l => GRAVE_ATTACK.exec(l)).find(Boolean);
      if (m && (!m[2] || s.zones.graveyard.length >= toNumber(m[2])) && attackers.some(a => a && isA(a, m[1]))) out.push({ inst, cost: m[3] });
    }
    return out;
  }
  // Puts it onto the battlefield tapped and attacking (the caller adds it to the attack).
  function returnAttacking(s, inst) {
    G.move(s, inst.iid, 'battlefield');
    inst.tapped = true;
    inst.tappedFor = null;
    inst.attacking = true;
    G.log(s, `${inst.name} returned from the graveyard tapped and attacking.`);
    return inst.iid;
  }

  // Roshan, Hidden Magister: "Whenever a permanent you control is turned face up, you draw a card and you lose 1 life."
  function turnedFaceUp(game, inst, defOf, ctx) {
    for (const w of yourPermanents(game)) {
      for (const line of oracleLines(w, defOf)) {
        const m = /^whenever a permanent you control is turned face up, (?:you may )?(.+)$/i.exec(line);
        if (m) fire(game, w, `${inst.name} was turned face up`, m[1], Object.assign({ other: game.bot ? game.bot.s : null, defOf }, ctx));
      }
    }
  }

  // The Immortal Sun on any table: "Players can't activate planeswalkers' loyalty abilities."
  const loyaltyLocked = (game, defOf) => [game, game.bot && game.bot.s].filter(Boolean)
    .some(t => permanents(t).some(c => oracleLines(c, defOf).some(l => /^players can't activate planeswalkers' loyalty abilities\.?$/i.test(l))));

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
    blockTriggers(game, blocks, defOf, { hitOpps: k => { game.oppLife -= k; }, other: s });
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
      // Flumph: "whenever this creature is dealt damage"
      creatureDamaged(game, s, a, r.a.dmg, defOf);
      bl.forEach((b, j) => creatureDamaged(game, game, b, r.b[j].dmg, defOf));
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
    combatOver(game);
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
    phaseTriggers(game, s, 'end step', defOf, null);
    flickerReturn(game); // Eerie Interlude: "at the beginning of the next end step"
    if (monarchOf(game) === 'opp') {
      G.drawCards(s, 1, true);
      G.log(s, 'Opp is the monarch and drew a card.');
    }
    while (s.zones.hand.length > 7 && !noMaxHand(s, defOf)) G.move(s, worstInHand(s), 'graveyard'); // Reliquary Tower
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
  function resolveYourAttack(game, attacks, defOf, combatCtx = {}) {
    const st = yourAttackBlocks(game, attacks, defOf);
    return finishYourAttack(game, st.attackers, st.blocks, defOf, st.answered, combatCtx);
  }
  // Ninjutsu: after blocks, an unblocked attacker (attackerIid) goes back to your hand and the ninja
  // (ninjaIid, in your hand) comes in tapped and attacking in its place. state: yourAttackBlocks's.
  function ninjutsu(game, state, attackerIid, ninjaIid, defOf) {
    const a = state.attackers.find(x => x.inst.iid === attackerIid && !(state.blocks.get(x) || []).length);
    const ninja = game.cards[ninjaIid];
    if (!a || !ninja || ninja.zone !== 'hand') return false;
    const back = a.inst;
    G.move(game, back.iid, 'hand');
    ninja.combatEntry = true; // its "When this enters" picks its own targets (combat won't wait)
    G.move(game, ninjaIid, 'battlefield', { put: true });
    delete ninja.combatEntry;
    ninja.tapped = true;
    ninja.tappedFor = null;
    ninja.attacking = true;
    a.inst = ninja;
    a.st = stats(ninja, defOf(ninja.id));
    G.log(game, `Ninjutsu: ${back.name} returned to your hand and ${ninja.name} is attacking in its place.`);
    return true;
  }
  // Your attack up to Opp's blocks: { attackers, blocks, answered } for finishYourAttack.
  function yourAttackBlocks(game, attacks, defOf) {
    const s = game.bot.s;
    if (attacks.length) game.attackedYou = true; // Opp's Weathered Sentinels
    refreshGrants(game, defOf);
    // "Whenever this attacks" triggers, exalted, battle cry, annihilator; tokens that enter attacking
    // go after the same player or planeswalker.
    const list = attacks.map(x => (typeof x === 'string' ? { iid: x } : x));
    const joined = declareAttack(game, list.map(a => game.cards[a.iid]), defOf, {
      sacrifice: (n, why) => oppSacrifices(game, n, why), game, ctx: { hitOpps: n => { game.oppLife -= n; } },
      info: inst => ({ player: !(list.find(a => a.iid === inst.iid) || {}).pw }),
    })
      .map(([from, iid]) => ({ iid, pw: (list.find(a => a.iid === from) || {}).pw }));
    attacks = list.concat(joined);
    let attackers = attacks.map(x => (typeof x === 'string' ? { iid: x } : x))
      .map(x => ({ inst: game.cards[x.iid], pw: x.pw && s.cards[x.pw] && s.cards[x.pw].zone === 'battlefield' ? s.cards[x.pw] : null }))
      .filter(a => a.inst && a.inst.zone === 'battlefield')
      .map(a => Object.assign(a, { st: stats(a.inst, defOf(a.inst.id)) }))
      .sort((a, b) => hitOf(b.st) - hitOf(a.st));
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
    const declared = [...blocks.values()].flat().map(b => b.inst);
    for (const [a, list] of blocks) [...list].forEach(b => combatTrigger(s, b.inst, 'blocks', defOf, Object.assign(oppCtx(game, b.inst, defOf), { run: fn => onOpp(game, fn), blocked: a.inst })).forEach(iid => list.push({ inst: s.cards[iid], st: botStats(s.cards[iid]) })));
    blockWatch(game, s, defOf, null, declared);
    if (blocks.size) {
      attackers.forEach(a => { a.st = stats(a.inst, defOf(a.inst.id)); });
      [...blocks.values()].flat().forEach(b => { b.st = botStats(b.inst); });
    }
    return { attackers, blocks, answered };
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
        if (p.uses > 0 && !r.b[i].dead) {
          const kw = new Set([...p.st.kw].filter(k => k !== TOUGH_DMG)); // what it has left is in pow now
          p.st = { ...p.st, pow: Math.max(0, hitOf(p.st) - Math.max(0, a.st.tou)), tou: p.st.tou - r.b[i].dmg, kw };
        }
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
  function finishYourAttack(game, attackers, blocks, defOf, answered, combatCtx = {}) {
    const s = game.bot.s;
    // For "whenever … deals combat damage to a player" (app.js adds the ones that ask you things).
    const hitCtx = {
      hitOpps: n => { game.oppLife -= n; }, other: s,
      loseHalf: () => { game.oppLife -= Math.ceil(Math.max(0, game.oppLife) / 2); },
      exileTop: src => { const c = exileTopCard(game, game, src ? src.name : 'Effect'); game.lastExiledTop = c ? c.iid : null; },
      ...combatCtx,
    };
    const oppDies = b => { if (!regenerates(game, b, defOf, true)) moveOpps(s, b); };
    const yoursDies = a => { if (!regenerates(game, a, defOf, false)) moveYours(game, a, 'graveyard'); };
    let dmg = 0;
    let poison = 0;
    const lines = [];
    const own = n => `your ${n}`;
    const theirs = n => n;
    const hits = []; // your creatures that dealt combat damage to Opp, for "whenever … deals combat damage" cards
    // Unblocked first strikers hit first, so their triggers (Drana's "put a +1/+1 counter on each
    // attacking creature you control") happen before the rest deal damage.
    const firstOnly = st => st.kw.has('first strike') && !st.kw.has('double strike');
    const early = attackers.filter(a => !a.pw && !(blocks.get(a) || []).length && (a.st.kw.has('first strike') || a.st.kw.has('double strike')) && hitOf(a.st) > 0 && !a.st.kw.has('infect'));
    if (early.length && attackers.length > early.length - early.filter(a => firstOnly(a.st)).length) {
      combatDamage(game, early.map(a => ({ inst: a.inst, st: a.st, card: defOf(a.inst.id), dmg: hitOf(a.st) })), defOf, hitCtx);
      attackers.forEach(a => { if (!(early.includes(a) && firstOnly(a.st)) && a.inst.zone === 'battlefield') a.st = stats(a.inst, defOf(a.inst.id)); });
      early.forEach(a => { a.early = true; });
    }
    const results = combatAll(attackers.map(a => ({ st: a.st, blockers: (blocks.get(a) || []).map(b => ({ key: b.inst.iid, st: b.st })) })));
    for (const [i, a] of attackers.entries()) {
      if (!a.st.kw.has('vigilance')) a.inst.tapped = true;
      a.inst.attackedTurn = game.turn; // one attack per creature per turn, even if it gets untapped
      const bl = blocks.get(a) || [];
      const r = results[i];
      const hit = r.player;
      creatureDamaged(game, game, a.inst, r.a.dmg, defOf); // Flumph
      bl.forEach((b, j) => creatureDamaged(game, s, b.inst, r.b[j].dmg, defOf));
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
      if (hit && !(a.early && firstOnly(a.st))) hits.push({ inst: a.inst, st: a.st, card: defOf(a.inst.id), dmg: hit });
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
    combatDamage(game, hits.filter(h => h.inst.zone === 'battlefield' || h.inst.zone === 'graveyard'), defOf, hitCtx);
    if (hits.length) takeMonarch(game, 'you');
    endOfCombat(game, attackers.map(a => a.inst), defOf);
    combatOver(game);
    return msg;
  }

  return { KEYWORDS, keywordCounter, tableRules, attackRules, blockRules, botRules, combatAll, blocksAllowed,
    declareAttack, endOfCombat, afterDeath, spellCast, spellResolve, spellTax, lifeChanged, proliferate, monarchOf, takeMonarch,
    extraCombat, playerHit, witherCounters, keywordNumbers, kwN,
    targetEffect, targetFilter, canTarget, applyTarget, damagePlayer, oppTarget, enterEffects,
    setResponder, getResponder, isInstantSpeed, resumeTurn, resolveStack, counterStack, oppCounters, oppInstantAt, pickBlocks, castOptions, castOne, blockTriggers, combatTappers, oppCombatTaps, tapChoices, beginCombat, spellModes, runModes, refreshGrants, spellPump, regenerates, combatTrigger, endStepTriggers, returnable, oppDiscards, colorsOf, create, beginTurn, resolveOppAttack, endTurn, resolveYourAttack, stats, keywords, attachBonus, equipCost, runEffect, dealtDamage, landEntered, creatureEntered, enterTrigger, died, noAttack, silenced, syncAuras, combatDamage, destroyable, activatedAbilities, crewOf, spellEffect, fight, combat, canBlock, legalBlock, toPlayer, lifelinkGain, blockText,
    yourCreatures, botStats, sick, isPlaneswalker, loyaltyOf, damagePlaneswalker, phaseTriggers, attackWatch, blockWatch, hitOf, TOUGH_DMG, DEFENDER_ATTACKS, selfDiscount, wipeVictims, bestNumber,
    searchSpec, searchable, applySearch, applyScry, crackFetches, ARTIFACT_TOKENS, faceOracle,
    yourAttackBlocks, finishYourAttack, ninjutsu, ninjutsuOf, flashbackOf, abilityActivated, bestColor, applyDig, autoMoveCards,
    wouldDie, madnessCost, costChoices, offspringCopy, graveAttackers, returnAttacking, turnedFaceUp, loyaltyLocked, cardMoved,
    sendHome, takeCard, applyRecover, recoverCost, opponentDamaged, spellTargeted, graveCast, autoTarget, playerEffect,
    cardMoveSpec, moveChoices, applyMoveCards, exileTopCard, exileGreatest, exileGraveyard, handPick, addLife, cardFits, oppSacrifices,
    opponentActed, applyTax, counterExtras, upkeepDraws, noMaxHand, flickerOut, flickerReturn, cloneLine, cloneChoices, becomeCopy, autoCopy,
    handAbilities, aftermathOf, sacChoices, keepByPower, combatOver, creatureDamaged, playerShielded, grantKws,
    // For coverage.js, which reads card text the same way the rest of this file does.
    parts: { OTHER_KEYWORDS, isKeyword, protectionKw, effectParts, canRunAll, TOKEN_TEXT, DIES_WATCH, CAST_WATCH, COMBAT_TAP, PHASE_TRIGGER, CANT,
      OLD_MENACE, UNBLOCKABLE, ATTACK_TAX, SPELL_TAX, NO_GAIN, ARBORIA, ATTACK_CAP, BLOCK_CAP, ATTACK_BLOCK_CAP, isSelf,
      counterSpell, plainSpell, facts, destroyTheirs, COUNT, ENTER_WATCH, ATTACK_WATCH, BLOCK_WATCH, TOUGH_RULE, DEFENDER_RULE, SELF_DISCOUNT, WIPE, CHOOSE_WIPE, plainLine,
      LEAVES_WATCH, ACTIVATE_WATCH, CLONE, TAX_WATCH, COUNTER_EXTRAS, counterExtraParts, EXTRA_BLOCK, RETURN_STUNNED, KONRAD, RECOVER, GRAVE_CAST, GRAVE_ATTACK, CRYSTAL, DEALT_WATCH, TARGET_WATCH, GAIN_WATCH, LOSS_WATCH, landfallText, settleIfYouDo, enteredElsewhere } };
})();

if (typeof module !== 'undefined') module.exports = Bot;
