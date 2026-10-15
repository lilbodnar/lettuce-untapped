/*
 * The game being played: zones, cards in them, life, turn, and every action you can take.
 * No screen code lives here. Each action changes the game object in place; app.js keeps
 * copies of earlier states for Undo.
 *
 * Battlefield positions are stored in "card widths" so changing the card size keeps the layout.
 */
const Game = (() => {
  'use strict';

  const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  const ZONE_NAMES = {
    library: 'library', hand: 'hand', battlefield: 'battlefield',
    graveyard: 'graveyard', exile: 'exile', command: 'command zone',
  };
  const CELL_W = 1.12; // card widths per battlefield column
  const CELL_H = 1.5; // card widths per battlefield row
  const layout = { cols: 10, rows: 4 }; // set by app.js from the battlefield's size
  // app.js: hooks.entered(s, inst) runs when a card arrives on a battlefield (landfall);
  // hooks.tokenEntered(s, inst) when a token is created; hooks.died(s, inst) when one goes from
  // the battlefield to the graveyard ("When this dies, …").
  const hooks = { entered: null, tokenEntered: null, died: null };

  function randomInt(n) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / n) * n;
      do crypto.getRandomValues(buf); while (buf[0] >= limit);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function shuffleArray(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const isLand = inst => /\bland\b/i.test((inst.typeLine || '').split('//')[0]);
  // A crewed Vehicle counts as a creature until the turn ends.
  const isCreature = inst => !!inst.crewed || /\bcreature\b/i.test((inst.typeLine || '').split('//')[0]);
  const isVehicle = inst => /\bvehicle\b/i.test((inst.typeLine || '').split('//')[0]);
  // The turn is over: Vehicles stop being creatures.
  const endCrew = s => s.zones.battlefield.forEach(iid => { delete s.cards[iid].crewed; delete s.cards[iid].crewedBy; });

  // Takes a crew back: the Vehicle stops being a creature and the creatures that crewed it untap.
  function uncrew(s, iid) {
    const v = s.cards[iid];
    if (!v || !v.crewed) return;
    const back = (v.crewedBy || []).map(id => s.cards[id]).filter(c => c && c.zone === 'battlefield' && c.tapped);
    back.forEach(c => { c.tapped = false; });
    delete v.crewed;
    delete v.crewedBy;
    log(s, `Uncrewed ${v.name}${back.length ? `; untapped ${back.map(c => c.name).join(', ')}` : ''}.`);
  }

  const MANA = ['W', 'U', 'B', 'R', 'G', 'C'];
  const BASIC_TYPES = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G', wastes: 'C' };

  // The colors of mana a land can make. Uses Scryfall's list when we have it, otherwise
  // the basic land types in its type line (so "Land — Forest Plains" makes G or W).
  function producesOf(inst) {
    if (!isLand(inst)) return [];
    if (Array.isArray(inst.produces) && inst.produces.length) return MANA.filter(m => inst.produces.includes(m));
    const words = (inst.typeLine || '').split('//')[0].toLowerCase().split(/[^a-z]+/);
    return MANA.filter(m => words.some(w => BASIC_TYPES[w] === m));
  }

  // A nonland card's simple mana ability, read from its rules text:
  //   "{T}: Add {G}."  "{T}: Add {C}{C}."  "{T}: Add {R} or {G}."  "{T}: Add one mana of any color."
  //   "{T}, Sacrifice this artifact: Add one mana of any color."  (Treasure)
  //   "{1}, {T}: Add {G}{W}."  (filter lands like Sungrass Prairie, and Signets)
  // Returns { colors, amount, sacrifice } or null; the "{1}, {T}" kind also has filter (the {N} it
  // costs) and makes (each mana it adds, like ['G', 'W']). Other costs and "any one color" sources
  // are left for you to do by hand.
  function manaAbility(name, oracle) {
    if (!oracle) return null;
    const front = (name || '').split(' // ')[0].toLowerCase();
    for (const line of oracle.split('\n')) {
      const f = line.trim().match(/^\{(\d+)\},\s*\{T\}:\s*add ((?:\{[WUBRGC]\}){2,})\.?$/i);
      if (f && Number(f[1]) > 0) {
        const makes = f[2].toUpperCase().match(/[WUBRGC]/g);
        return { colors: MANA.filter(c => makes.includes(c)), amount: makes.length, sacrifice: false, filter: Number(f[1]), makes };
      }
      const m = line.trim().match(/^\{T\}(?:,\s*sacrifice ([^:]+))?:\s*add (.+?)\.?$/i);
      if (!m) continue;
      const sacrifice = !!m[1];
      if (sacrifice && !/^(this \w+|it)$/i.test(m[1].trim()) && m[1].trim().toLowerCase() !== front) continue;
      const add = m[2].split(/\.\s/)[0].trim(); // "Add {U} or {B}. This deals 1 damage to you."
      let g;
      if ((g = add.match(/^((?:\{[WUBRGC]\})+)$/i))) {
        const syms = g[1].toUpperCase().match(/[WUBRGC]/g);
        if (syms.every(c => c === syms[0])) return { colors: [syms[0]], amount: syms.length, sacrifice };
        continue;
      }
      if (/^\{[WUBRGC]\}(?:,? (?:or )?\{[WUBRGC]\})+$/i.test(add) && /\bor\b/i.test(add)) {
        return { colors: MANA.filter(c => add.toUpperCase().includes(`{${c}}`)), amount: 1, sacrifice };
      }
      if (/^one mana of any colou?r\b/i.test(add)) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: 1, sacrifice };
    }
    return null;
  }

  // What a card on the battlefield can tap for right now: { colors, amount, sacrifice } or null.
  // Creatures can't tap for mana the turn they arrive.
  function sourceOf(s, inst) {
    if (inst.faceDown) return null;
    if (Object.values(inst.boosts || {}).some(b => b && b.noAbilities)) return null; // Arrest
    if (inst.mana && inst.mana.filter && !(isCreature(inst) && inst.enteredTurn === s.turn)) return inst.mana;
    if (isLand(inst)) {
      const colors = producesOf(inst);
      return colors.length ? { colors, amount: 1, sacrifice: false } : null;
    }
    if (!inst.mana) return null;
    if (isCreature(inst) && inst.enteredTurn === s.turn) return null;
    return inst.mana;
  }

  // Every untapped mana source, as one unit per mana it makes, in the order auto-tap uses them:
  // lands (fewest colors first), then mana rocks, then creatures, then things you sacrifice (Treasure).
  // Sources that cost {1} to tap (filterSources) aren't in it.
  function manaUnits(s) {
    const units = [];
    for (const iid of s.zones.battlefield) {
      const inst = s.cards[iid];
      if (inst.tapped) continue;
      const src = sourceOf(s, inst);
      if (!src || src.filter) continue;
      const rank = isLand(inst) ? 0 : src.sacrifice ? 3 : isCreature(inst) ? 2 : 1;
      for (let i = 0; i < src.amount; i++) units.push({ inst, colors: src.colors, rank, kind: `${rank}${src.colors.join('')}${src.amount}` });
    }
    return units.sort((a, b) => a.rank - b.rank || a.colors.length - b.colors.length);
  }

  // Untapped sources like "{1}, {T}: Add {G}{W}." (Sungrass Prairie, Signets).
  const filterSources = s => s.zones.battlefield.map(iid => s.cards[iid]).filter(inst => !inst.tapped && (sourceOf(s, inst) || {}).filter);

  const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const toNumber = w => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w.toLowerCase()] || null);

  // The effect text of a card's own "When this enters, …" triggers.
  function enterEffects(name, oracle) {
    if (!oracle) return [];
    const front = (name || '').split(' // ')[0].toLowerCase();
    const short = front.split(',')[0];
    const effects = [];
    for (const sentence of oracle.split(/\n+|(?<=\.)\s+(?=[A-Z])/)) {
      const m = sentence.match(/^when(?:ever)?\s+(.+?)\s+enters(?: the battlefield)?(?: or [^,]+)?,\s*(.+)$/i);
      if (!m) continue;
      const subject = m[1].toLowerCase().replace(/^[^:]*:\s*/, '');
      if (subject === front || subject === short || /^this (creature|land|artifact|enchantment|permanent|card|planeswalker|battle|vehicle|equipment|aura)$/.test(subject)) effects.push(m[2]);
    }
    return effects;
  }

  // Reads a card's own "When this enters, you gain/lose N life" triggers from its rules text.
  // Returns { you, opp, target } (life change for you, for each opponent, and for one target
  // opponent) or null. Only fixed amounts count; "X life" or "for each…" are left for you to do by hand.
  function enterLife(name, oracle) {
    let you = 0;
    let opp = 0;
    let target = 0;
    for (const effect of enterEffects(name, oracle)) {
      if (/for each|equal to|\bx life\b/i.test(effect)) continue;
      let g;
      if ((g = effect.match(/\byou gain (\w+) life\b/i)) && toNumber(g[1])) you += toNumber(g[1]);
      if ((g = effect.match(/\byou lose (\w+) life\b/i)) && toNumber(g[1])) you -= toNumber(g[1]);
      if ((g = effect.match(/\beach opponent loses (\w+) life\b/i)) && toNumber(g[1])) opp -= toNumber(g[1]);
      if ((g = effect.match(/\btarget opponent loses (\w+) life\b/i)) && toNumber(g[1])) target -= toNumber(g[1]);
      if ((g = effect.match(/\bdeals (\w+) damage to each opponent\b/i)) && toNumber(g[1])) opp -= toNumber(g[1]);
    }
    return you || opp || target ? { you, opp, target } : null;
  }

  // Reads "When this enters, draw a card" (or "draw two cards", "draw a card, then discard…").
  // Returns how many cards you draw. Optional ("you may"), conditional ("if …") and variable
  // ("for each…") draws, and other players drawing, are left for you to do by hand.
  function enterDraw(name, oracle) {
    let n = 0;
    for (const effect of enterEffects(name, oracle)) {
      if (/^if\b|\byou may\b|for each|equal to|\bx cards\b/i.test(effect)) continue;
      const g = effect.match(/(?:^|\byou |\bthen |\band |, )draw (\w+) cards?\b/i);
      if (g && toNumber(g[1])) n += toNumber(g[1]);
    }
    return n;
  }

  // Reads "When this enters, each player discards a card" (or "each opponent / target opponent
  // discards", "you discard", "draw a card, then discard a card"). Returns { you, opp, random }
  // (how many you and each opponent discard) or null. Optional and variable discards are left to you.
  function enterDiscard(name, oracle) {
    const out = { you: 0, opp: 0, random: false };
    for (const effect of enterEffects(name, oracle)) {
      if (/^if\b|\byou may\b|for each|equal to|\bx cards\b|\bunless\b/i.test(effect)) continue;
      let g;
      if ((g = effect.match(/\beach player discards (\w+) cards?\b/i)) && toNumber(g[1])) { out.you += toNumber(g[1]); out.opp += toNumber(g[1]); }
      else if ((g = effect.match(/\b(?:each|target) opponent discards (\w+) cards?\b/i)) && toNumber(g[1])) out.opp += toNumber(g[1]);
      else if ((g = effect.match(/(?:^|\byou |\bthen |\band |, )discard (\w+) cards?\b/i)) && toNumber(g[1])) out.you += toNumber(g[1]);
      else continue;
      if (/\bat random\b/i.test(effect)) out.random = true;
    }
    return out.you || out.opp ? out : null;
  }

  // Counters a permanent enters with: "Modular 1" (+1/+1 counters) and "This creature enters with
  // two +1/+1 counters on it." Returns { kind: n }. "Enters with X counters" and conditional ones
  // ("…if you control a Goblin") are left to you.
  function entersWithCounters(oracle) {
    const out = {};
    for (const raw of String(oracle || '').split('\n')) {
      const line = raw.replace(/\([^)]*\)/g, '').trim();
      let m;
      if ((m = /^modular (\d+)\b/i.exec(line))) out['+1/+1'] = (out['+1/+1'] || 0) + Number(m[1]);
      for (const sentence of line.split(/(?<=\.)\s+/)) {
        m = /^.+? enters(?: the battlefield)? with (\w+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on it\.?$/i.exec(sentence);
        if (m && toNumber(m[1]) && m[2].toLowerCase() !== 'loyalty') out[m[2].toLowerCase()] = (out[m[2].toLowerCase()] || 0) + toNumber(m[1]);
      }
    }
    return out;
  }

  // Reads a mana cost like "{2}{W/U}{G}" into { generic, pips }, one pip per colored symbol with
  // the colors that can pay it. Only the first half of split and adventure cards counts; X is 0.
  function parseCost(cost) {
    const need = { generic: 0, pips: [] };
    for (const [, raw] of String(cost || '').split(' // ')[0].matchAll(/\{([^}]+)\}/g)) {
      const sym = raw.toUpperCase();
      const parts = sym.split('/');
      if (/^\d+$/.test(sym)) need.generic += Number(sym);
      else if (sym === 'S') need.generic++; // snow: any of your mana will do here
      else if (parts.length === 1 && MANA.includes(sym)) need.pips.push({ colors: [sym] });
      else if (parts.length > 1) {
        need.pips.push({ colors: parts.filter(p => MANA.includes(p)), phyrexian: parts.includes('P'), orTwo: parts.includes('2') });
      }
    }
    return need;
  }

  // "As this enters, choose a creature type" (Urza's Incubator, Herald's Horn, Vanquisher's Banner).
  const choosesType = oracle => /\bchoose a creature type\b/i.test(oracle || '');

  // Reads "<types> spells you cast cost {N} less to cast" from rules text. Returns a list of
  // { n, types, chosen }: types are the words a spell's type line needs (any one of them; "non…"
  // means it must not have it; empty means any spell), and chosen means it also has to be the
  // creature type picked for this card. Spells your opponents cast, and discounts with conditions
  // ("with flying", "for each…"), aren't read.
  function costReductions(oracle) {
    const out = [];
    for (const sentence of String(oracle || '').split(/\n+|(?<=\.)\s+/)) {
      const m = sentence.trim().match(/^(.*?)\s*\bspells (you cast )?(of the chosen type )?(you cast )?cost \{(\d+)\} less to cast\.?$/i);
      if (!m || !(m[2] || m[3] || m[4])) continue;
      const words = m[1].toLowerCase().split(/,?\s+(?:and\/or|and|or)\s+|,\s*|\s+/).filter(Boolean);
      if (words.length > 4 || !words.every(w => /^[a-z-]+$/.test(w))) continue;
      out.push({ n: Number(m[5]), types: words, chosen: !!m[3] });
    }
    return out;
  }

  // How much less a spell costs from the permanents on your battlefield. oracleOf(inst) gives a
  // card's rules text. Only generic mana is taken off; autoPay won't go below zero.
  function discount(s, spell, oracleOf) {
    const typeWords = String(spell.typeLine || '').split('//')[0].toLowerCase().split(/[^a-z-]+/).filter(Boolean);
    const has = w => typeWords.includes(w);
    let total = 0;
    for (const iid of s.zones.battlefield) {
      const src = s.cards[iid];
      if (src.faceDown || src.iid === spell.iid) continue;
      for (const r of costReductions(oracleOf(src))) {
        const plain = r.types.filter(w => !w.startsWith('non'));
        const nots = r.types.filter(w => w.startsWith('non')).map(w => w.replace(/^non-?/, ''));
        if (nots.some(has) || (plain.length && !plain.some(has))) continue;
        if (r.chosen && !(src.chosenType && has(src.chosenType.toLowerCase()))) continue;
        total += r.n;
      }
    }
    return total;
  }

  // Pays a spell's cost: mana already in the pool first, then taps untapped mana sources (without
  // adding their mana to the pool, since it's spent right away). Lands go first, then mana rocks,
  // then creatures, then Treasure-style sources, which are sacrificed. Colored symbols use the
  // sources that make the fewest colors so dual lands stay free. Extra mana from a source that makes
  // more than one (Sol Ring) goes into the pool. Phyrexian symbols are paid with 2 life only when
  // the mana isn't there. Taps nothing and returns null when you can't pay; otherwise returns
  // { sources, life, pool } describing what was spent. extraGeneric adds to (tax) or, when
  // negative, takes off (discounts) the generic part. Sources like "{1}, {T}: Add {G}{W}" are
  // used only when the spell can't be paid without them; their {1} comes from another source or the pool.
  function autoPay(s, cost, extraGeneric = 0) {
    const need = parseCost(cost);
    need.generic = Math.max(0, need.generic + extraGeneric);
    if (!need.generic && !need.pips.length) return { sources: [], life: 0, pool: 0 };
    const filters = filterSources(s).slice(0, 3);
    const sets = filters.reduce((acc, f) => acc.concat(acc.map(a => [...a, f])), [[]]).sort((a, b) => a.length - b.length);
    let plan = null;
    for (const set of sets) if ((plan = withFilters(need, manaUnits(s), set, Object.assign({}, s.mana), new Set(), 0))) break;
    if (!plan) return null;
    const { units, used, pool, life, tapping } = plan;
    // Mana a tapped source made but the spell didn't need floats in the pool.
    units.forEach((unit, u) => {
      if (!used.has(u) && tapping.has(unit.inst) && unit.colors.length === 1) pool[unit.colors[0]]++;
    });
    s.mana = pool;
    const sources = [...tapping];
    s.life -= life;
    for (const inst of sources) {
      inst.tapped = true;
      inst.tappedFor = null;
      if (sourceOf(s, inst) && inst.mana && inst.mana.sacrifice) move(s, inst.iid, 'graveyard');
    }
    return { sources: sources.map(i => i.name + (i.mana && i.mana.sacrifice ? ' (sacrificed)' : '')), life, pool: plan.fromPool };
  }

  // Turns on the filter sources in set one at a time: each one's {N} is paid by pool mana or other
  // sources (tried one kind at a time), and the mana it adds joins the units. Then pays the spell.
  function withFilters(need, units, set, pool, forced, fromPool) {
    if (!set.length) return payWith(need, units, pool, forced, fromPool);
    const [f, ...rest] = set;
    const out = f.mana.makes.map(c => ({ inst: f, colors: [c], rank: 1, kind: `F${c}` }));
    const on = new Set([...forced, f]);
    const tryPay = (n, us, p, tapped, spent) => {
      if (!n) return withFilters(need, us.concat(out), rest, p, new Set([...on, ...tapped]), fromPool + spent);
      const tried = new Set();
      for (const k of MANA) {
        if (!(p[k] > 0)) continue;
        const r = tryPay(n - 1, us, Object.assign({}, p, { [k]: p[k] - 1 }), tapped, spent + 1);
        if (r) return r;
      }
      for (let u = 0; u < us.length; u++) {
        if (tried.has(us[u].kind)) continue;
        tried.add(us[u].kind);
        const r = tryPay(n - 1, us.filter((x, i) => i !== u), p, [...tapped, us[u].inst], spent);
        if (r) return r;
      }
      return null;
    };
    return tryPay(f.mana.filter, units, pool, [], 0);
  }

  // Pays need from pool mana and units. forced: sources already being tapped (filter sources and
  // what paid for them), whose leftover mana is used first. Returns the plan or null.
  function payWith(need, units, pool, forced, fromPool) {
    const pips = need.pips.filter(p => {
      const c = p.colors.find(k => pool[k] > 0);
      if (!c) return true;
      pool[c]--;
      fromPool++;
      return false;
    });
    const canPay = (unit, pip) => unit.colors.some(k => pip.colors.includes(k));
    const options = pip => units.filter(u => canPay(u, pip)).length;
    pips.sort((a, b) => options(a) - options(b));
    const poolLeft = MANA.reduce((n, k) => n + pool[k], 0);
    const used = new Set(); // indexes into units
    let life = 0;
    let generic = need.generic;

    // Tries pips in order. Units of the same kind are interchangeable, so only one of each kind is tried.
    function solve(i) {
      if (i === pips.length) return units.length - used.size + poolLeft >= generic;
      const pip = pips[i];
      const tried = new Set();
      for (let u = 0; u < units.length; u++) {
        if (used.has(u) || !canPay(units[u], pip)) continue;
        if (tried.has(units[u].kind)) continue;
        tried.add(units[u].kind);
        used.add(u);
        if (solve(i + 1)) return true;
        used.delete(u);
      }
      if (pip.orTwo) {
        generic += 2;
        if (solve(i + 1)) return true;
        generic -= 2;
      }
      if (pip.phyrexian) {
        life += 2;
        if (solve(i + 1)) return true;
        life -= 2;
      }
      return false;
    }
    if (!solve(0)) return null;

    // Generic: leftover pool mana first, then the rest of a source that's already being tapped
    // (Sol Ring's second mana). After that, sources whose whole output fits what's still owed,
    // colorless-only and bigger ones first, so Sol Ring pays {2} but a Forest pays {1}.
    for (const k of MANA) {
      const n = Math.min(pool[k], generic);
      pool[k] -= n;
      generic -= n;
      fromPool += n;
    }
    const tapping = () => new Set([...forced, ...[...used].map(u => units[u].inst)]);
    while (generic > 0) {
      const busy = tapping();
      const free = units.map((u, i) => i).filter(i => !used.has(i));
      const left = inst => free.filter(i => units[i].inst === inst).length;
      const colorless = i => (units[i].colors.join('') === 'C' ? 0 : 1);
      let pick = free.find(i => busy.has(units[i].inst));
      if (pick === undefined) {
        pick = free.filter(i => left(units[i].inst) <= generic)
          .sort((a, b) => colorless(a) - colorless(b) || left(units[b].inst) - left(units[a].inst) || a - b)[0];
      }
      if (pick === undefined) pick = free[0];
      if (pick === undefined) break;
      used.add(pick);
      generic--;
    }
    return { units, used, pool, life, fromPool, tapping: tapping() };
  }

  // true for cards that always enter tapped. For the common "enters tapped unless…" lands it's
  // the condition, checked when the card enters (see tapsOnEntry):
  //   { opponents: 2 }          unless you have two or more opponents (Battlebond lands)
  //   { control: ['forest'] }   unless you control a Forest or a Plains (check lands)
  //   { maxOther: 2 }           unless you control two or fewer other lands (fast lands)
  //   { minOther: 2 }           unless you control two or more other lands (slow lands)
  // Other conditions return false and are left for you to decide.
  const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4 };
  const BASICS = '(plains|island|swamp|mountain|forest)';
  function entersTapped(name, oracle) {
    if (!oracle) return false;
    const front = (name || '').split(' // ')[0].toLowerCase();
    let out = false;
    oracle.split(/\n+|(?<=\.)\s+(?=[A-Z])/).forEach(line => {
      const m = line.match(/^(.+?) enters(?: the battlefield)? tapped(?: unless (.+?))?\.$/i);
      if (!m) return;
      const subject = m[1].toLowerCase();
      if (!(subject === front || /^this (land|creature|artifact|permanent)$/.test(subject))) return;
      const cond = (m[2] || '').toLowerCase();
      let c;
      if (!cond) out = true;
      else if ((c = cond.match(/^you have (one|two|three|four) or more opponents$/))) out = { opponents: COUNT_WORDS[c[1]] };
      else if ((c = cond.match(/^you control (one|two|three|four) or (fewer|more) other lands$/))) out = c[2] === 'fewer' ? { maxOther: COUNT_WORDS[c[1]] } : { minOther: COUNT_WORDS[c[1]] };
      else if ((c = cond.match(new RegExp(`^you control an? ${BASICS}(?:,? or an? ${BASICS})?$`)))) out = { control: [c[1], c[2]].filter(Boolean) };
    });
    return out;
  }

  // Does this card come in tapped right now? s.opponents is how many opponents you have
  // (unknown when goldfishing, so then that condition is left to you).
  function tapsOnEntry(s, inst) {
    const et = inst.entersTapped;
    if (!et || inst.faceDown) return false;
    if (et === true) return true;
    const others = s.zones.battlefield.map(iid => s.cards[iid]).filter(c => c !== inst);
    const otherLands = others.filter(isLand).length;
    if (et.opponents) return s.opponents != null && s.opponents < et.opponents;
    if (et.maxOther != null) return otherLands > et.maxOther;
    if (et.minOther != null) return otherLands < et.minOther;
    if (et.control) return !others.some(c => et.control.some(t => new RegExp(`\\b${t}\\b`, 'i').test(c.typeLine || '')));
    return false;
  }

  // Life lost by opponents is also listed in s.oppHits ({ to: 'each' | 'target', d }) so an
  // online game can send it to the other players.
  function applyEnterLife(s, inst) {
    if (!inst.enterLife || inst.faceDown) return;
    const { you, opp, target = 0 } = inst.enterLife;
    const parts = [];
    if (you) {
      s.life += you;
      parts.push(`you ${you > 0 ? 'gain' : 'lose'} ${Math.abs(you)} life (now ${s.life})`);
    }
    if (opp || target) {
      s.oppLife += opp + target;
      s.oppHits = s.oppHits || [];
      if (opp) s.oppHits.push({ to: 'each', d: opp });
      if (target) s.oppHits.push({ to: 'target', d: target });
      if (opp) parts.push(`each opponent loses ${-opp} life`);
      if (target) parts.push(`target opponent loses ${-target} life`);
      parts[parts.length - 1] += ` (opp. now ${s.oppLife})`;
    }
    const msg = `${inst.name} entered: ${parts.join(', ')}.`;
    log(s, msg);
    s.notice = msg;
  }

  function applyEnterDraw(s, inst) {
    if (!inst.enterDraw || inst.faceDown) return;
    const drawn = drawCards(s, inst.enterDraw, true);
    if (!drawn) return;
    const msg = `${inst.name} entered: you drew ${drawn === 1 ? 'a card' : drawn + ' cards'}.`;
    log(s, msg);
    s.notice = s.notice ? `${s.notice} ${msg}` : msg;
  }

  // What your untapped lands can still make: { total, byColor: { G: 3, W: 2, … } }.
  // A land that makes several colors counts once in the total and once under each color.
  function available(s) {
    const byColor = {};
    const units = manaUnits(s);
    units.forEach(u => u.colors.forEach(c => { byColor[c] = (byColor[c] || 0) + 1; }));
    // "{1}, {T}: Add {G}{W}": one more mana (and both colors) as long as something can pay its {1}.
    let total = units.length;
    let payers = units.length + MANA.reduce((n, k) => n + s.mana[k], 0);
    for (const f of filterSources(s)) {
      if (payers < f.mana.filter) break;
      payers += f.mana.amount - f.mana.filter;
      total += f.mana.amount - f.mana.filter;
      f.mana.colors.forEach(c => { byColor[c] = (byColor[c] || 0) + 1; });
    }
    return { total, byColor };
  }

  function log(s, msg) {
    s.log.unshift({ turn: s.turn, msg, at: Date.now() });
    if (s.log.length > 300) s.log.length = 300;
  }

  function makeInstance(s, def, extra) {
    const iid = 'c' + s.nextId++;
    const inst = Object.assign({
      iid,
      id: def.id || null,
      name: def.name,
      typeLine: def.typeLine || '',
      zone: 'library',
      tapped: false,
      faceDown: false,
      flipped: false,
      counters: {},
      x: 0,
      y: 0,
    }, extra);
    s.cards[iid] = inst;
    return inst;
  }

  // deck: { name, key, rows: [{ id, name, qty, commander }] }, defs: { scryfallId: card }
  function create(deck, defs, opts = {}) {
    const hasCommander = deck.rows.some(r => r.commander);
    const s = {
      v: 1,
      deckKey: deck.key,
      deckName: deck.name,
      commander: hasCommander,
      onDraw: !!opts.onDraw,
      turn: 1,
      life: hasCommander ? 40 : 20,
      oppLife: hasCommander ? 40 : 20,
      poison: 0,
      mulligans: 0,
      landPlayed: false,
      mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
      cards: {},
      log: [],
      nextId: 1,
      startedAt: Date.now(),
    };
    for (const row of deck.rows) {
      const def = defs[row.id] || { id: row.id, name: row.name, typeLine: '' };
      for (let i = 0; i < (row.qty || 1); i++) {
        const inst = makeInstance(s, def, { commander: !!row.commander, castCount: 0, cmc: def.cmc || 0, cost: def.manaCost || '', produces: def.producedMana || null, enterLife: enterLife(def.name, def.oracle), enterDraw: enterDraw(def.name, def.oracle), mana: manaAbility(def.name, def.oracle), entersTapped: entersTapped(def.name, def.oracle), loyalty: def.loyalty == null ? null : def.loyalty, doubles: doublesOf(def.oracle) });
        inst.zone = row.commander ? 'command' : 'library';
        s.zones[inst.zone].push(inst.iid);
      }
    }
    shuffleArray(s.zones.library);
    log(s, `New game with ${deck.name}${s.onDraw ? ' (on the draw)' : ' (on the play)'}.`);
    drawCards(s, 7, true);
    firstDraw(s);
    return s;
  }

  // Does turn 1 start with a draw? On the draw, yes. On the play only in Commander, where nobody
  // skips their first draw (multiplayer rules, which most tables use even one-on-one).
  const drawsTurnOne = s => s.onDraw || !!s.commander;

  // Your first turn's card comes on top of the opening 7 (and again after a mulligan).
  function firstDraw(s) {
    const iid = s.zones.library[0];
    if (!drawsTurnOne(s) || s.turn !== 1 || !iid) return;
    drawCards(s, 1, true);
    s.cards[iid].newAt = Date.now();
    log(s, `Drew a card for your first turn${s.onDraw ? ' (on the draw)' : ''}.`);
  }

  // Drawn cards remember when they arrived (newAt) so the hand can light them up for a moment.
  // The opening hand doesn't (quiet), except the first-turn card on the draw.
  function drawCards(s, n = 1, quiet) {
    let drawn = 0;
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const iid = s.zones.library.shift();
      if (!iid) {
        log(s, 'Tried to draw from an empty library.');
        break;
      }
      s.cards[iid].zone = 'hand';
      if (!quiet) s.cards[iid].newAt = now;
      addToHand(s, iid);
      drawn++;
    }
    if (!quiet && drawn) log(s, `Drew ${drawn === 1 ? 'a card' : drawn + ' cards'}.`);
    return drawn;
  }

  // How a card sorts in hand, left to right: basic lands, other lands, artifacts, enchantments,
  // sorceries, instants, creatures, then planeswalkers (and battles). Within each, cheapest first; at
  // the same mana value, more generic (colorless) mana in the cost first. Copies of a card stay together.
  function handGroup(inst) {
    const type = (inst.typeLine || '').split('//')[0];
    if (isLand(inst)) return /\bbasic\b/i.test(type) ? 0 : 1;
    if (isCreature(inst)) return 6;
    if (/\bartifact\b/i.test(type)) return 2;
    if (/\benchantment\b/i.test(type)) return 3;
    if (/\bsorcery\b/i.test(type)) return 4;
    if (/\binstant\b/i.test(type)) return 5;
    if (/\b(planeswalker|battle)\b/i.test(type)) return 7;
    return 8;
  }

  function handOrder(a, b) {
    return handGroup(a) - handGroup(b)
      || (a.cmc || 0) - (b.cmc || 0)
      || parseCost(b.cost).generic - parseCost(a.cost).generic
      || a.name.localeCompare(b.name);
  }

  function sortHand(s) {
    s.zones.hand.sort((x, y) => handOrder(s.cards[x], s.cards[y]));
  }

  // Puts a card in its place in hand: after every card that sorts before it or with it.
  function addToHand(s, iid) {
    const hand = s.zones.hand;
    const inst = s.cards[iid];
    let at = -1;
    hand.forEach((id, i) => { if (handOrder(s.cards[id], inst) <= 0) at = i; });
    hand.splice(at + 1, 0, iid);
  }

  function shuffle(s) {
    shuffleArray(s.zones.library);
    log(s, 'Shuffled library.');
  }

  function cellFree(s, col, row, ignore) {
    const x = col * CELL_W + 0.25;
    const y = row * CELL_H + 0.1;
    return !s.zones.battlefield.some(iid => {
      if (iid === ignore) return false;
      const c = s.cards[iid];
      // Cards on a stack, and ones attached to another card, sit on a spot the bottom card already holds.
      if (c.stacked || c.attachedTo) return false;
      return Math.abs(c.x - x) < 0.7 && Math.abs(c.y - y) < 0.9;
    });
  }

  const STACK_STEP = 0.12; // offset between cards in a stack, in card widths
  const MAX_STACK = 6;

  // Copies of the same land, or the same token, stack on each other. Returns the spot on top of
  // a stack that has room, or null.
  function stackSpot(s, inst) {
    if (!isLand(inst) && !inst.token) return null;
    const same = s.zones.battlefield.map(id => s.cards[id])
      .filter(c => c.iid !== inst.iid && c.name === inst.name && !!c.token === !!inst.token && !c.attachedTo);
    for (const c of same) {
      const col = Math.round((c.x - 0.25) / CELL_W);
      const row = Math.round((c.y - 0.1) / CELL_H);
      const x = col * CELL_W + 0.25;
      const y = row * CELL_H + 0.1;
      if (Math.abs(c.x - x) > 0.05 || Math.abs(c.y - y) > 0.05) continue; // only stacks that start on a grid spot
      const n = same.filter(o => Math.abs(o.x - x) < 0.7 && Math.abs(o.y - y) < 0.9).length;
      if (n < MAX_STACK) return { x: x + n * STACK_STEP, y: y + n * STACK_STEP };
    }
    return null;
  }

  // Finds a spot, keeping the battlefield tidy: lands in the bottom half (copies stacked), creatures
  // from the top row down, and other permanents (artifacts, equipment, enchantments, planeswalkers)
  // in the row just above the lands. Tokens of the same kind stack too.
  function autoPlace(s, inst) {
    const rows = Math.max(2, layout.rows);
    const cols = Math.max(3, layout.cols);
    const stacked = stackSpot(s, inst);
    delete inst.stacked;
    if (stacked) { inst.x = stacked.x; inst.y = stacked.y; inst.stacked = true; return; }
    const landRows = Math.max(1, Math.floor(rows / 2));
    const top = rows - landRows; // rows for everything that isn't a land
    const order = [];
    const add = r => { if (r >= 0 && r < rows && !order.includes(r)) order.push(r); };
    if (isLand(inst)) for (let r = rows - 1; r >= top; r--) add(r);
    else if (isCreature(inst)) for (let r = 0; r < top; r++) add(r);
    else for (let r = top - 1; r >= 0; r--) add(r);
    for (let r = 0; r < rows; r++) add(r); // its own area is full: anywhere with room
    for (const row of order) {
      for (let col = 0; col < cols; col++) {
        if (cellFree(s, col, row, inst.iid)) {
          inst.x = col * CELL_W + 0.25;
          inst.y = row * CELL_H + 0.1;
          return;
        }
      }
    }
    // Battlefield is full: overlap slightly so nothing is hidden.
    const n = s.zones.battlefield.length;
    inst.x = 0.1 + (n % cols) * CELL_W + 0.25;
    inst.y = 0.1 + (isLand(inst) ? (rows - 1) * CELL_H - 0.3 : 0.3);
  }

  // A card left its spot (died, bounced, dragged away): the cards stacked on it slide down one
  // step, so the next one becomes the bottom of the stack.
  function closeStack(s, gone) {
    const rest = s.zones.battlefield.map(id => s.cards[id])
      .filter(c => c.iid !== gone.iid && c.stacked && c.name === gone.name
        && c.x - gone.x > -0.01 && c.x - gone.x < STACK_STEP * MAX_STACK && c.y - gone.y > -0.01 && c.y - gone.y < STACK_STEP * MAX_STACK)
      .sort((a, b) => a.x - b.x);
    rest.forEach(c => { c.x -= STACK_STEP; c.y -= STACK_STEP; });
    if (rest.length && !gone.stacked) delete rest[0].stacked;
  }

  // ---------- equipment and auras ----------

  const isAttachment = inst => /\b(equipment|aura)\b/i.test((inst.typeLine || '').split('//')[0]);
  const isAura = inst => /\baura\b/i.test((inst.typeLine || '').split('//')[0]);
  const attachmentsOf = (s, hostIid) => s.zones.battlefield.filter(id => s.cards[id].attachedTo === hostIid);
  const ATTACH_PEEK = 0.22; // how far each attached card shows above its creature, in card widths

  // Tucks a creature's equipment and auras behind it, each peeking out above the one before
  // (below, when the creature is at the top of the battlefield).
  function placeAttached(s, host) {
    const list = attachmentsOf(s, host.iid);
    const up = host.y - ATTACH_PEEK * list.length >= 0;
    list.forEach((id, k) => {
      const a = s.cards[id];
      a.x = host.x;
      a.y = host.y + (up ? -1 : 1) * ATTACH_PEEK * (k + 1);
    });
  }

  // bonus: { pow, tou, kw: [] } the creature gets from it (read by the combat code).
  function attach(s, iid, hostIid, bonus) {
    const inst = s.cards[iid];
    const host = s.cards[hostIid];
    if (!inst || !host || inst.zone !== 'battlefield' || host.zone !== 'battlefield' || iid === hostIid) return;
    if (inst.attachedTo) detach(s, iid, true);
    closeStack(s, inst);
    delete inst.stacked;
    inst.attachedTo = hostIid;
    host.boosts = Object.assign({}, host.boosts, { [iid]: bonus || { pow: 0, tou: 0, kw: [] } });
    placeAttached(s, host);
    log(s, `Attached ${inst.name} to ${host.name}.`);
  }

  function detach(s, iid, quiet) {
    const inst = s.cards[iid];
    if (!inst || !inst.attachedTo) return;
    const host = s.cards[inst.attachedTo];
    delete inst.attachedTo;
    if (host && host.boosts) {
      delete host.boosts[iid];
      if (!Object.keys(host.boosts).length) delete host.boosts;
      placeAttached(s, host);
    }
    if (!quiet) log(s, `${inst.name} is no longer attached${host ? ` to ${host.name}` : ''}.`);
  }

  function resetForZoneChange(inst) {
    inst.tapped = false;
    inst.tappedFor = null; // mana it already made stays in the pool
    delete inst.filterPaid;
    inst.faceDown = false;
    inst.flipped = false;
    inst.counters = {};
    delete inst.crewed;
    delete inst.crewedBy;
    delete inst.chosenType;
    delete inst.enchanting; // an aura on another player's creature
    delete inst.pump;
    delete inst.regen;
    delete inst.granted;
  }

  // A planeswalker enters with loyalty counters equal to its printed loyalty (not for "X", or one
  // that already has some, like a copy you set up by hand).
  const isPlaneswalkerType = typeLine => /\bplaneswalker\b/i.test(typeLine);
  function startLoyalty(s, inst) {
    const n = Number(inst.loyalty);
    if (inst.faceDown || inst.loyalty == null || !Number.isFinite(n) || !isPlaneswalkerType((inst.typeLine || '').split('//')[0])) return;
    inst.counters = inst.counters || {};
    if (inst.counters.loyalty != null) return;
    const twice = counterDoublers(s, inst, 'loyalty');
    inst.counters.loyalty = n * 2 ** twice.length;
    if (twice.length) log(s, `${inst.name} enters with ${inst.counters.loyalty} loyalty instead of ${n} (${twice.join(', ')}).`);
  }

  // Doubling Season, Parallel Lives, Anointed Procession, Corpsejack Menace and the like, read from
  // the card's text: { tokens: true, counters: 'all' | '+1/+1' }, or null for most cards.
  function doublesOf(oracle) {
    const text = String(oracle || '').replace(/\([^)]*\)/g, '');
    const out = {};
    // "would create one or more (creature) tokens under your control, it creates twice that many" (Parallel
    // Lives' creature-only limit isn't checked) and Primal Vigor's "If one or more tokens would be created".
    if (/(?:would create one or more (?:[a-z]+ )?tokens|one or more (?:[a-z]+ )?tokens would be created)[^.]*?, (?:it creates )?twice that many/i.test(text)) out.tokens = true;
    // Doubling Season's "would put one or more counters on a permanent you control", and Corpsejack
    // Menace's "If one or more +1/+1 counters would be put on a creature you control".
    const m = /(?:would put one or more (\+1\/\+1 )?counters on|one or more (\+1\/\+1 )?counters would be put on) [^.]*?you control[^.]*?, (?:it puts )?twice that many/i.exec(text);
    if (m) out.counters = m[1] || m[2] ? '+1/+1' : 'all';
    return Object.keys(out).length ? out : null;
  }

  const doublers = (s, test) => s.zones.battlefield.map(id => s.cards[id]).filter(c => c && !c.faceDown && c.doubles && test(c.doubles)).map(c => c.name);
  // Names of your permanents that double counters of this kind put on this permanent of yours.
  const counterDoublers = (s, inst, kind) => (inst.zone === 'battlefield' && s.cards[inst.iid] === inst
    ? doublers(s, d => d.counters === 'all' || (d.counters === '+1/+1' && kind === '+1/+1' && isCreature(inst))) : []);

  // How many tokens an effect that makes n of them really makes on this table: { n, by: [names] }.
  function tokenCount(s, n) {
    const by = doublers(s, d => d.tokens);
    return { n: n * 2 ** by.length, by };
  }

  // "Until end of turn" pumps and regeneration shields wear off.
  function endOfTurn(s) {
    for (const inst of Object.values(s.cards)) {
      delete inst.pump;
      delete inst.regen;
      delete inst.undoPump; // the pump it gave is gone anyway
    }
  }

  // "Counter target spell" (or "…creature spell", "…noncreature spell", "…unless its controller pays {3}").
  const isCounterspell = oracle => /^counter target (?:[a-z ,-]+ )?spell\b/im.test(String(oracle || '').replace(/\([^)]*\)/g, ''));

  // Counters s.lastCast, the newest spell cast on this table: a permanent goes to the graveyard (a
  // commander to the command zone), and an instant or sorcery's pump is taken back. The mana paid
  // for it stays spent. Returns what happened, or null if there was nothing it could undo.
  function counterLast(s) {
    const last = s.lastCast;
    delete s.lastCast;
    const inst = last && s.cards[last.iid];
    if (!inst) return null;
    const spell = /\b(instant|sorcery)\b/i.test((inst.typeLine || '').split('//')[0]);
    if (inst.undoPump) {
      for (const [iid, prev] of Object.entries(inst.undoPump)) {
        const c = s.cards[iid];
        if (!c) continue;
        if (prev) c.pump = prev;
        else delete c.pump;
      }
      delete inst.undoPump;
    } else if (inst.zone !== 'battlefield') return null; // already resolved: undo what it did by hand
    if (inst.zone === 'battlefield') move(s, inst.iid, inst.commander && !spell ? 'command' : 'graveyard');
    const msg = `${inst.name} was countered (${spell ? 'its effect is undone' : `now in the ${ZONE_NAMES[inst.zone]}`}); its mana stays spent.`;
    log(s, msg);
    return msg;
  }

  // opts: { index, bottom, x, y, faceDown }
  function move(s, iid, to, opts = {}) {
    const inst = s.cards[iid];
    if (!inst) return;
    const from = inst.zone;
    const list = s.zones[from];
    const at = list.indexOf(iid);
    if (at >= 0) list.splice(at, 1);
    if (from === 'battlefield' && (to !== 'battlefield' || opts.x != null)) {
      closeStack(s, inst);
      delete inst.stacked;
      // Dragged off the creature it was on, or leaving the battlefield: no longer attached.
      if (inst.attachedTo) detach(s, iid);
    }
    if (from === 'battlefield' && to !== 'battlefield') {
      // A creature leaving takes nothing with it: auras go to the graveyard, equipment stays, unattached.
      for (const id of attachmentsOf(s, iid)) {
        const a = s.cards[id];
        detach(s, id, true);
        if (isAura(a)) move(s, id, 'graveyard');
        else { autoPlace(s, a); log(s, `${a.name} stays on the battlefield, unattached.`); }
      }
      delete inst.boosts;
    }

    // A commander sent to the command zone instead of the graveyard still died.
    const died = from === 'battlefield' && (to === 'graveyard' || (to === 'command' && inst.commander)) && !inst.faceDown;
    if (inst.token && to !== 'battlefield') {
      delete s.cards[iid];
      log(s, `${inst.name} token left the battlefield and is gone.`);
      if (died && hooks.died) hooks.died(s, inst);
      return;
    }

    if (from === 'battlefield' && to !== 'battlefield') resetForZoneChange(inst);
    inst.zone = to;
    if (opts.faceDown) inst.faceDown = true;

    if (to === 'battlefield') {
      // Cards arriving from another zone always go to their tidy spot, even when dropped somewhere;
      // dragging a card around the battlefield puts it exactly where you drop it.
      if (from !== 'battlefield') autoPlace(s, inst);
      else if (opts.x != null) {
        inst.x = Math.max(0, opts.x);
        inst.y = Math.max(0, opts.y);
        placeAttached(s, inst); // its equipment and auras come along
      }
      s.zones.battlefield.push(iid); // last = drawn on top
      if (from !== 'battlefield') { inst.enteredTurn = s.turn; delete inst.attackedTurn; startLoyalty(s, inst); }
      if (from !== 'battlefield' && tapsOnEntry(s, inst)) {
        inst.tapped = true;
        inst.tappedFor = null;
      }
      if (from === 'hand' && isLand(inst)) s.landPlayed = true;
      if (from === 'command' && inst.commander) inst.castCount = (inst.castCount || 0) + 1;
    } else if (to === 'library') {
      if (opts.bottom) s.zones.library.push(iid);
      else s.zones.library.splice(opts.index || 0, 0, iid);
    } else if (opts.index != null) {
      s.zones[to].splice(opts.index, 0, iid);
    } else if (to === 'hand') {
      inst.newAt = Date.now();
      addToHand(s, iid);
    } else {
      s.zones[to].push(iid);
    }

    if (from === to) return;
    const name = inst.faceDown ? 'A face-down card' : inst.name;
    let where = ZONE_NAMES[to];
    if (to === 'library') where = opts.bottom ? 'bottom of library' : 'top of library';
    let msg = `${name}: ${ZONE_NAMES[from]} → ${where}.`;
    if (from === 'hand' && to === 'battlefield') msg = `Played ${name}${inst.tapped && inst.entersTapped && !inst.tappedFor ? ' (enters tapped)' : ''}.`;
    if (from === 'command' && to === 'battlefield') msg = `Cast ${name} from the command zone (cast #${inst.castCount}).`;
    log(s, msg);
    if (died && hooks.died) hooks.died(s, inst);
    if (to === 'battlefield') {
      applyEnterLife(s, inst);
      applyEnterDraw(s, inst);
      if (hooks.entered) hooks.entered(s, inst);
      // A spell cast from your hand or the command zone, for counterspells (see counterLast). Not one
      // that's already gone, like a resolved counterspell, unless its pump can still be taken back.
      if ((from === 'hand' || from === 'command') && !isLand(inst) && s.cards[iid] && (inst.zone === 'battlefield' || inst.undoPump)) s.lastCast = { iid, at: Date.now() };
    }
  }

  // Tapping a land or mana rock adds its mana to the pool (color picks which, for sources that
  // make several; null taps it without adding mana). A creature only adds mana when a color is
  // picked, since it's usually tapped to attack. Untapping takes that mana back out.
  function setTapped(s, iid, tapped, color) {
    const inst = s.cards[iid];
    if (!inst || inst.zone !== 'battlefield') return;
    const next = tapped == null ? !inst.tapped : tapped;
    if (next === inst.tapped) return;
    if (next && color !== null && !inst.faceDown && (sourceOf(s, inst) || {}).filter) return tapFilter(s, inst);
    if (!next && inst.filterPaid) return untapFilter(s, inst);
    inst.tapped = next;
    if (next) {
      const src = isLand(inst) ? { colors: producesOf(inst), amount: 1 } : inst.mana;
      if (!src || inst.faceDown) return;
      let c = color;
      if (c === undefined) c = src.colors.length === 1 && !(isCreature(inst) && !isLand(inst)) ? src.colors[0] : null;
      if (c && MANA.includes(c)) {
        s.mana[c] += src.amount;
        inst.tappedFor = c;
        inst.tappedAmount = src.amount;
      }
    } else if (inst.tappedFor) {
      s.mana[inst.tappedFor] = Math.max(0, s.mana[inst.tappedFor] - (inst.tappedAmount || 1));
      inst.tappedFor = null;
      inst.tappedAmount = 0;
    }
  }

  // "{1}, {T}: Add {G}{W}." by hand: its {1} is paid like a spell (pool mana first, then a land),
  // then both mana go into the pool. Untapping it takes them back out and gives the {1} back.
  function tapFilter(s, inst) {
    const { filter, makes } = inst.mana;
    const before = Object.assign({}, s.mana);
    const untapped = s.zones.battlefield.filter(iid => !s.cards[iid].tapped && iid !== inst.iid);
    inst.tapped = true; // so it doesn't pay for itself
    const paid = autoPay(s, `{${filter}}`);
    if (!paid) {
      inst.tapped = false;
      s.notice = `${inst.name} needs {${filter}} to tap for mana. You have nothing untapped to pay it with.`;
      return;
    }
    const spent = {};
    MANA.forEach(k => { if (before[k] > s.mana[k]) spent[k] = before[k] - s.mana[k]; });
    inst.filterPaid = { iids: untapped.filter(iid => s.cards[iid].tapped && s.cards[iid].zone === 'battlefield'), spent };
    makes.forEach(c => { s.mana[c]++; });
    log(s, `Paid {${filter}}${paid.sources.length ? ` (tapped ${paid.sources.join(', ')})` : ''} and tapped ${inst.name} for ${makes.map(c => `{${c}}`).join('')}.`);
  }

  function untapFilter(s, inst) {
    const { iids, spent } = inst.filterPaid;
    inst.tapped = false;
    inst.mana.makes.forEach(c => { s.mana[c] = Math.max(0, s.mana[c] - 1); });
    MANA.forEach(k => { s.mana[k] += spent[k] || 0; });
    iids.forEach(iid => { if (s.cards[iid] && s.cards[iid].zone === 'battlefield') s.cards[iid].tapped = false; });
    delete inst.filterPaid;
  }

  function untapAll(s) {
    s.zones.battlefield.forEach(iid => setTapped(s, iid, false));
    log(s, 'Untapped everything.');
  }

  function nextTurn(s) {
    endCrew(s);
    endOfTurn(s);
    s.turn++;
    s.landPlayed = false;
    Object.keys(s.mana).forEach(k => { s.mana[k] = 0; });
    s.zones.battlefield.forEach(iid => { s.cards[iid].tapped = false; s.cards[iid].tappedFor = null; delete s.cards[iid].filterPaid; });
    log(s, `— Turn ${s.turn} — untapped.`);
    drawCards(s, 1);
  }

  function mulligan(s) {
    for (const iid of s.zones.hand.splice(0)) {
      s.cards[iid].zone = 'library';
      s.zones.library.push(iid);
    }
    shuffleArray(s.zones.library);
    s.mulligans++;
    drawCards(s, 7, true);
    firstDraw(s);
    log(s, `Mulligan #${s.mulligans}: drew a new 7${drawsTurnOne(s) && s.turn === 1 ? ' plus your first-turn card' : ''}. Put ${s.mulligans} on the bottom (right-click a card → Bottom of library).`);
  }

  function mill(s, n) {
    let count = 0;
    for (let i = 0; i < n && s.zones.library.length; i++) {
      const iid = s.zones.library.shift();
      s.cards[iid].zone = 'graveyard';
      s.zones.graveyard.push(iid);
      count++;
    }
    log(s, `Milled ${count}.`);
  }

  // opts.effect: a card's effect is putting these counters on (not you fixing the number by hand),
  // so Doubling Season and the like double them. Returns how many were really added or taken off.
  function counter(s, iid, name, delta, opts = {}) {
    const inst = s.cards[iid];
    if (!inst) return 0;
    if (opts.effect && delta > 0) {
      const twice = counterDoublers(s, inst, name);
      if (twice.length) {
        log(s, `${inst.name} gets ${delta * 2 ** twice.length} ${name} counters instead of ${delta} (${twice.join(', ')}).`);
        delta *= 2 ** twice.length;
      }
    }
    const n = (inst.counters[name] || 0) + delta;
    if (n <= 0) delete inst.counters[name];
    else inst.counters[name] = n;
    return delta;
  }

  function toggle(s, iid, field) {
    const inst = s.cards[iid];
    if (inst) inst[field] = !inst[field];
  }

  // def: a Scryfall card, or { custom: true, name, pt, text } for a hand-made token.
  function createToken(s, def, opts = {}) {
    const inst = makeInstance(s, def, {
      token: true,
      custom: def.custom ? { pt: def.pt || '', text: def.text || '' } : null,
      zone: 'battlefield',
      produces: def.producedMana || null,
      enterLife: def.enterLife || enterLife(def.name, def.oracle),
      enterDraw: def.enterDraw != null ? def.enterDraw : enterDraw(def.name, def.oracle),
      mana: def.mana !== undefined ? def.mana : manaAbility(def.name, def.oracle),
      loyalty: def.loyalty == null ? null : def.loyalty,
      doubles: def.doubles !== undefined ? def.doubles : doublesOf(def.oracle),
      enteredTurn: s.turn,
    });
    startLoyalty(s, inst);
    if (opts.x != null) {
      inst.x = opts.x;
      inst.y = opts.y;
    } else autoPlace(s, inst);
    s.zones.battlefield.push(inst.iid);
    if (!opts.quiet) log(s, `Created a ${def.name} token.`);
    applyEnterLife(s, inst);
    applyEnterDraw(s, inst);
    if (hooks.tokenEntered) hooks.tokenEntered(s, inst);
    return inst;
  }

  // Token copies of a card (from the battlefield or any other zone). opts: { n, counters }.
  // Copies on the battlefield are placed next to the original, fanned out a little.
  function copyAsToken(s, iid, opts = {}) {
    const src = s.cards[iid];
    if (!src) return;
    const { n, by } = tokenCount(s, opts.n || 1); // Doubling Season, Parallel Lives…
    const def = { id: src.id, name: src.name, typeLine: src.typeLine, custom: !!src.custom, pt: src.custom && src.custom.pt, text: src.custom && src.custom.text, producedMana: src.produces, enterLife: src.enterLife, enterDraw: src.enterDraw || 0, mana: src.mana || null, loyalty: src.loyalty, doubles: src.doubles || null };
    let last;
    for (let i = 1; i <= n; i++) {
      const at = src.zone === 'battlefield' ? { x: src.x + 0.3 * i, y: src.y + 0.3 * i } : {};
      last = createToken(s, def, Object.assign(at, { quiet: true }));
      if (opts.counters) last.counters = Object.assign({}, src.counters);
    }
    log(s, `Made ${n === 1 ? 'a token copy' : n + ' token copies'} of ${src.name}${opts.counters ? ' (with counters)' : ''}${by.length ? ` (doubled by ${by.join(', ')})` : ''}.`);
    return last;
  }

  const count = (s, zone, pred) => s.zones[zone].filter(iid => !pred || pred(s.cards[iid])).length;

  return {
    ZONES, ZONE_NAMES, CELL_W, CELL_H, MANA, layout, hooks, producesOf, available, enterLife, enterDraw, entersTapped, tapsOnEntry, parseCost, autoPay, manaAbility, isCreature,
    choosesType, costReductions, discount, enterDiscard, entersWithCounters, doublesOf, tokenCount, endOfTurn, drawsTurnOne, isCounterspell, counterLast,
    create, drawCards, shuffle, move, setTapped, untapAll, nextTurn, mulligan, mill,
    counter, toggle, createToken, copyAsToken, log, isLand, count, shuffleArray, randomInt,
    attach, detach, isAttachment, isAura, attachmentsOf, sortHand, isVehicle, endCrew, uncrew,
  };
})();

if (typeof module !== 'undefined') module.exports = Game;
