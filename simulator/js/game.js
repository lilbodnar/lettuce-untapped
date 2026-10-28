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
  // hooks.tokenEntered(s, inst) when a token is created; hooks.died(s, inst, { counters, to }) when one
  // goes from the battlefield to the graveyard ("When this dies, …", undying); hooks.cast(s, inst)
  // after a spell cast from hand or the command zone arrives (prowess).
  // hooks.casting(s, inst) returns true when the spell being cast is countered (Opp's counterspell).
  // hooks.wouldDie(s, inst) can send a creature somewhere else instead of the graveyard (The Darkness
  // Crystal: 'exile'). hooks.discard(s, inst) can send a discarded card somewhere else (madness:
  // 'exile'). hooks.moved(s, inst, from, to) runs after any card changes zones (Syr Konrad).
  // hooks.sendHome(s, inst, to) takes a card you control but don't own back to its owner's table once
  // it leaves the battlefield. hooks.oppDamaged(s, n) runs when a card's "deals N damage to each
  // opponent" happens on entering (Massacre Girl, Most Wanted).
  // hooks.drew(s, n) runs after a player draws (Smothering Tithe).
  // hooks.counters(s, inst, kind, n) runs after counters are put on a permanent (Exemplar of Light).
  // hooks.manaTapped(s, inst) after a permanent is tapped for mana (Treasure Nabber); hooks.drawInstead(s, first) can take a draw away (Notion Thief).
  // hooks.graveInstead(s, inst) true sends a card on its way to a graveyard to exile instead (Dauthi Voidwalker).
  const hooks = { entered: null, tokenEntered: null, died: null, cast: null, casting: null, wouldDie: null, discard: null, moved: null, sendHome: null, oppDamaged: null, drew: null, counters: null, manaTapped: null, drawInstead: null, graveInstead: null, spent: null };

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

  // The type line of the face that's up: the back of a flipped two-faced card (Boggart Trawler played
  // as Boggart Bog), otherwise the front.
  const faceType = inst => { const t = String(inst.typeLine || '').split('//'); return (inst.flipped && t[1]) || t[0]; };
  const isLand = inst => /\bland\b/i.test(faceType(inst));
  // A crewed Vehicle counts as a creature until the turn ends, and so does a Restless land animated
  // until end of turn (inst.becomes). A card cast for impending (time counters left) or bestowed on a
  // creature (it's an aura then) isn't one, and a card mutated onto another is part of that creature.
  const stationed = inst => inst.stationAt > 0 && ((inst.counters || {}).charge || 0) >= inst.stationAt; // Spacecraft (station)
  const isCreature = inst => (!!inst.crewed || !!inst.becomes || stationed(inst) || /\bcreature\b/i.test(faceType(inst))) && !inst.impending && !inst.bestowed && !inst.mutatedOnto;
  const isVehicle = inst => /\bvehicle\b/i.test(faceType(inst));
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
    if (Array.isArray(inst.produces) && inst.produces.length) return MANA.filter(m => inst.produces.includes(m) && !(inst.lifeColors || []).includes(m)); // Ifnir Deadlands
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
  // Elementalist's Palette: "{T}: Add {C} for each charge counter on this artifact. Spend this mana only on costs that contain {X}." (its other
  // "{T}: Add one mana of any color." otherwise; manaUnits picks the counters for a spell with {X})
  const PALETTE = /^\{T\}:\s*add \{C\} for each ([\w-]+) counter on this \w+\. spend this mana only on costs that contain \{X\}\.?$/im;
  // City of Brass: "Whenever this land becomes tapped, it deals 1 damage to you." (autoPay)
  const TAP_PAIN = /^whenever this land becomes tapped, it deals (\d+) damage to you\.?$/im;
  function manaAbility(name, oracle) {
    const pain = oracle && TAP_PAIN.exec(oracle);
    const r = manaAbilityTwo(name, oracle);
    return r && pain ? { ...r, pain: Number(pain[1]) } : r;
  }
  function manaAbilityTwo(name, oracle) {
    const one = manaAbilityOne(name, oracle);
    const pal = oracle && PALETTE.exec(oracle);
    if (!pal) return one;
    return one ? { ...one, xCounters: pal[1].toLowerCase() } : { colors: ['C'], amount: 0, sacrifice: false, xCounters: pal[1].toLowerCase() };
  }
  function manaAbilityOne(name, oracle) {
    if (!oracle) return null;
    const front = (name || '').split(' // ')[0].toLowerCase();
    // Cabal Coffers: "{2}, {T}: Add {B} for each Swamp you control." Cabal Stronghold: "… for each basic
    // Swamp you control." (its plain "{T}: Add {C}" is used while there aren't enough Swamps, see sourceOf)
    for (const line of oracle.split('\n')) {
      const c = line.trim().match(/^\{(\d+)\},\s*\{T\}:\s*add \{([WUBRGC])\} for each (basic )?(\w+) you control\.?$/i);
      if (c) return { colors: [c[2].toUpperCase()], amount: 0, sacrifice: false, filter: Number(c[1]), makes: [], countLand: { type: c[4].toLowerCase(), basic: !!c[3] } };
    }
    for (const line of oracle.split('\n')) {
      // Shadowmoor filter lands (Flooded Grove): "{G/U}, {T}: Add {G}{G}, {G}{U}, or {U}{U}." Two mana, each
      // either color; its hybrid {G/U} is paid like a {1} here.
      const h = line.trim().match(/^\{([WUBRG])\/([WUBRG])\},\s*\{T\}:\s*add \{\1\}\{\1\}, \{\1\}\{\2\}, or \{\2\}\{\2\}\.?$/i);
      if (h) { const pair = [h[1].toUpperCase(), h[2].toUpperCase()]; return { colors: pair, amount: 2, sacrifice: false, filter: 1, makes: [pair, pair] }; }
      // Chrome Mox: "{T}: Add one mana of any of the exiled card's colors." (inst.imprintColors, bot.js's imprint)
      if (/^\{T\}:\s*add one mana of any of the exiled card's colou?rs\.?$/i.test(line.trim())) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: 1, sacrifice: false, imprint: true };
      // Heraldic Banner: "{T}: Add one mana of the chosen color." (inst.chosenColor)
      if (/^\{T\}:\s*add one mana of the chosen colou?r\.?$/i.test(line.trim())) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: 1, sacrifice: false, chosenColor: true };
      // Throne of Eldraine: "{T}: Add four mana of the chosen color. Spend this mana only to cast monocolored spells of that color." (spendable)
      const thr4 = line.trim().match(/^\{T\}:\s*add (\w+) mana of the chosen colou?r\. spend this mana only to cast monocolored spells of that colou?r\.?$/i);
      if (thr4 && toNumber(thr4[1])) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: toNumber(thr4[1]), sacrifice: false, chosenColor: true, monoOnly: true };
      // Thriving Isle: "{T}: Add {U} or one mana of the chosen color."
      const thr = line.trim().match(/^\{T\}:\s*add \{([WUBRG])\} or one mana of the chosen colou?r\.?$/i);
      if (thr) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: 1, sacrifice: false, chosenColor: true, base: thr[1].toUpperCase() };
      // "{T}: Add {G} for each creature you control with defender." (Overgrown Battlement), "{T}: Add X
      // mana in any combination of colors, where X is the number of creatures you control with
      // defender." (Axebane Guardian): as much as s.kwCount says (kept by bot.js's refreshGrants).
      const each = line.trim().match(/^\{T\}:\s*add (?:\{([WUBRGC])\} for each|x mana in any combination of colors, where x is the number of) creatures? you control with ([a-z ]+?)\.?$/i);
      if (each) return { colors: each[1] ? [each[1].toUpperCase()] : ['W', 'U', 'B', 'R', 'G'], amount: 1, sacrifice: false, countKw: each[2].toLowerCase() };
      // Wall of Roots: "Put a -0/-1 counter on this creature: Add {G}. Activate only once each turn." (tapped once used, like Mana Bloom; the counter goes on as it's used)
      const roots = line.trim().match(/^put an? ([\w+/-]+) counter on this creature: add \{([WUBRGC])\}\. activate only once each turn\.?$/i);
      if (roots) return { colors: [roots[2].toUpperCase()], amount: 1, sacrifice: false, addCounter: roots[1].toLowerCase() };
      // Everflowing Chalice: "{T}: Add {C} for each charge counter on this artifact." (sourceOf counts them)
      const pc = line.trim().match(/^\{T\}:\s*add \{([WUBRGC])\} for each ([\w-]+) counter on this \w+\.?$/i);
      if (pc) return { colors: [pc[1].toUpperCase()], amount: 1, sacrifice: false, perCounter: pc[2].toLowerCase() };
      // Relic of Sauron: "{T}: Add two mana in any combination of {U}, {B}, and/or {R}."
      const combo = line.trim().match(/^\{T\}:\s*add (\w+) mana in any combination of ((?:\{[WUBRG]\},? )+(?:and\/or|or) \{[WUBRG]\})\.?$/i);
      if (combo && toNumber(combo[1])) { const cols = combo[2].toUpperCase().match(/\{[WUBRG]\}/g).map(k => k[1]); return { colors: cols, amount: toNumber(combo[1]), sacrifice: false, makes: Array(toNumber(combo[1])).fill(cols) }; }
      // Prophetic Prism: "{1}, {T}: Add one mana of any color."; Cascading Cataracts: "{5}, {T}: Add five
      // mana in any combination of colors." (each mana any color)
      // Orb of Dragonkind: "… Spend this mana only to cast Dragon spells or activate abilities of Dragons." (onlyFor: autoPay's spell)
      // Study Hall: "… When you spend this mana to cast your commander, scry X, …" (the scry isn't done; the mana is).
      // Opal Palace: "… any color in your commander's color identity. If you spend this mana to cast your commander, …" (the counters aren't added)
      const anyF = line.trim().replace(/\s+(?:when|if) you spend this mana to cast your commander, .+$/i, '').match(/^\{(\d+)\},\s*\{T\}:\s*add (one mana of any colou?r(?: in your commander's colou?r identity)?|(\w+) mana in any combination of colou?rs)\.?(?: spend this mana only to cast (\w+) spells(?: or activate abilities of \w+)?\.?)?$/i);
      if (anyF && Number(anyF[1]) > 0) {
        const k = anyF[3] ? toNumber(anyF[3]) : 1;
        if (k) return { colors: [...MANA.slice(0, 5)], amount: k, sacrifice: false, filter: Number(anyF[1]), makes: Array(k).fill(MANA.slice(0, 5)), ...(anyF[4] ? { onlyFor: anyF[4].toLowerCase() } : {}) };
      }
      // Zaxara: "{T}: Add two mana of any one color."; Component Pouch: "{T}, Remove a component counter
      // from this artifact: Add two mana of different colors." (the counter goes when it's tapped for mana)
      // Smokebraider, Flamebraider: "{T}: Add two mana in any combination of colors. Spend this mana only to cast Elemental spells or activate
      // abilities of Elementals." (spendable: Elemental spells; not for abilities here)
      const braid = line.trim().match(/^\{T\}:\s*add (\w+) mana in any combination of colou?rs\. spend this mana only to cast (\w+) spells or activate abilities of \w+(?: sources)?\.?$/i);
      if (braid && toNumber(braid[1])) return { colors: [...MANA.slice(0, 5)], amount: toNumber(braid[1]), sacrifice: false, onlyFor: braid[2].toLowerCase() };
      // Troyan, Gutsy Explorer: "{T}: Add {G}{U}. Spend this mana only to cast spells with mana value 5 or greater or spells with {X} in their
      // mana costs." (spendable)
      const big = line.trim().match(/^\{T\}:\s*add ((?:\{[WUBRGC]\})+)\. spend this mana only to cast spells with mana value (\d+) or greater or spells with \{X\} in their mana costs\.?$/i);
      if (big) { const makes = big[1].toUpperCase().match(/[WUBRGC]/g); return { colors: [...new Set(makes)], amount: makes.length, sacrifice: false, makes, bigOrX: Number(big[2]) }; }
      // Mana Bloom: "Remove a charge counter from this enchantment: Add one mana of any color. Activate only once each turn." (it's tapped
      // once used, so it's ready again next turn)
      const bloom = line.trim().match(/^remove an? ([\w-]+) counter from this \w+: add one mana of any colou?r\. activate only once each turn\.?$/i);
      if (bloom) return { colors: [...MANA.slice(0, 5)], amount: 1, sacrifice: false, remove: { kind: bloom[1].toLowerCase(), n: 1 } };
      // Jegantha, the Wellspring: "{T}: Add {W}{U}{B}{R}{G}. This mana can't be spent to pay generic mana costs."
      const five = line.trim().match(/^\{T\}:\s*add ((?:\{[WUBRG]\}){2,})\. this mana can't be spent to pay generic mana costs\.?$/i);
      if (five) { const makes = five[1].toUpperCase().match(/[WUBRG]/g); return { colors: [...new Set(makes)], amount: makes.length, sacrifice: false, makes, noGeneric: true }; }
      // Springleaf Drum: "{T}, Tap an untapped creature you control: Add one mana of any color." (autoPay taps one)
      if (/^\{T\}, tap an untapped creature you control: add one mana of any colou?r\.?$/i.test(line.trim())) return { colors: [...MANA.slice(0, 5)], amount: 1, sacrifice: false, tapCreature: true };
      // Millikin: "{T}, Mill a card: Add {C}." (autoPay mills it)
      if (/^\{T\}, mill a card: add \{C\}\.?$/i.test(line.trim())) return { colors: ['C'], amount: 1, sacrifice: false, mill: 1 };
      // Channeler Initiate: "{T}, Remove a -1/-1 counter from this creature: Add one mana of any color."
      const two = line.trim().match(/^\{T\}(?:,\s*remove an? ([\w+/-]+) counter from (?:this \w+|it))?:\s*add (\w+) mana of (?:any one colou?r|different colou?rs|any colou?r)\.?$/i);
      if (two && toNumber(two[2])) return { colors: [...MANA.slice(0, 5)], amount: toNumber(two[2]), sacrifice: false, ...(two[1] ? { remove: { kind: two[1].toLowerCase(), n: 1 } } : {}) };
      const f = line.trim().match(/^\{(\d+)\},\s*\{T\}:\s*add ((?:\{[WUBRGC]\}){2,})\.?$/i);
      if (f && Number(f[1]) > 0) {
        const makes = f[2].toUpperCase().match(/[WUBRGC]/g);
        return { colors: MANA.filter(c => makes.includes(c)), amount: makes.length, sacrifice: false, filter: Number(f[1]), makes };
      }
      const m = line.trim().match(/^\{T\}(?:,\s*sacrifice ([^:]+))?:\s*add (.+?)\.?$/i);
      if (!m) continue;
      const sacrifice = !!m[1];
      // Gilded Goose: "{T}, Sacrifice a Food: Add one mana of any color." (another permanent: sourceOf checks there's one, autoPay sacrifices it)
      const other = sacrifice && /^an? (\w+)$/i.exec(m[1].trim());
      if (other && /^one mana of any colou?r\.?$/i.test(m[2].trim())) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: 1, sacrifice: false, sacOther: other[1].toLowerCase() };
      if (sacrifice && !/^(this \w+|it)$/i.test(m[1].trim()) && m[1].trim().toLowerCase() !== front) continue;
      const add = m[2].split(/\.\s/)[0].trim(); // "Add {U} or {B}. This deals 1 damage to you."
      // Powerstone, Vibranium: "This mana can't be spent to cast a nonartifact spell." (autoPay's spendable)
      const artifactOnly = /this mana can't be spent to cast a nonartifact spell/i.test(m[2]) ? { artifactOnly: true } : {};
      let g;
      if ((g = add.match(/^((?:\{[WUBRGC]\})+)$/i))) {
        const syms = g[1].toUpperCase().match(/[WUBRGC]/g);
        if (syms.every(c => c === syms[0])) return { colors: [syms[0]], amount: syms.length, sacrifice, ...artifactOnly };
        // Timeless Lotus: "{T}: Add {W}{U}{B}{R}{G}."
        if (!sacrifice) return { colors: MANA.filter(c => syms.includes(c)), amount: syms.length, sacrifice, makes: syms, ...artifactOnly };
        continue;
      }
      if (/^\{[WUBRGC]\}(?:,? (?:or )?\{[WUBRGC]\})+$/i.test(add) && /\bor\b/i.test(add)) {
        return { colors: MANA.filter(c => add.toUpperCase().includes(`{${c}}`)), amount: 1, sacrifice };
      }
      // Exploding Barrel: "{T}: Add one mana of any color. Put a pressure counter on this artifact." (autoPay puts it on)
      const ctr = /\bput an? ([\w+/-]+) counter on this \w+\.?$/i.exec(m[2]);
      if (/^one mana of any colou?r\b/i.test(add)) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: 1, sacrifice, ...(ctr ? { addCounter: ctr[1].toLowerCase() } : {}) };
      // Goldspan Dragon's Treasures: "{T}, Sacrifice this artifact: Add two mana of any one color."
      const k = /^(\w+) mana of any one colou?r\b/i.exec(add);
      if (k && toNumber(k[1])) return { colors: ['W', 'U', 'B', 'R', 'G'], amount: toNumber(k[1]), sacrifice };
    }
    return null;
  }

  // What a card on the battlefield can tap for right now: { colors, amount, sacrifice } or null.
  // Creatures can't tap for mana the turn they arrive.
  // Forsaken Monument (s.extraC, from bot.js): a source that makes only {C} makes that many more.
  function sourceOf(s, inst) {
    // Emrakul, the Exigent Doom: 'Target land gains "{T}: Add {C}{C}" until this card is cast from exile.' (inst.landMana, app.js's handAbility)
    const lm = inst.landMana;
    if (lm && s.cards[lm.by] && s.cards[lm.by].zone === 'exile' && !inst.faceDown) return { colors: ['C'], amount: lm.n, sacrifice: false };
    const src = baseSource(s, inst);
    // Goldspan Dragon: 'Treasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."' (s.treasureMana, bot.js's refreshGrants)
    if (src && s.treasureMana && src.sacrifice && /\btreasure\b/i.test(inst.typeLine || '')) return { ...src, amount: Math.max(src.amount, s.treasureMana) };
    // Fertile Ground: "Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color."
    // Mirari's Wake, Vorinclex: "Whenever you tap a land for mana, add one mana of any type that land produced." (s.landDouble, bot.js's refreshGrants)
    if (src && isLand(inst) && s.landDouble && !src.filter) {
      const aura = auraMana(s, inst);
      return { ...src, amount: src.amount * (1 + s.landDouble) + aura.length, makes: [...Array(src.amount * (1 + s.landDouble)).fill(src.colors), ...aura] };
    }
    const extra = src && isLand(inst) ? auraMana(s, inst) : [];
    if (extra.length) return { ...src, amount: src.amount + extra.length, colors: MANA.filter(k => src.colors.includes(k) || extra.some(e => e.includes(k))), makes: [...Array(src.amount).fill(src.colors), ...extra] };
    if (!src || !s.extraC || !src.colors.every(k => k === 'C') || src.filter) return src;
    return { ...src, amount: src.amount + s.extraC };
  }
  // The extra mana the auras on a land add as it's tapped, each as the colors it can be: Fertile Ground (any color),
  // Wild Growth ({G}), Utopia Sprawl (the chosen color).
  const auraMana = (s, land) => attachmentsOf(s, land.iid).map(id => s.cards[id]).filter(a => a.extraManaAura)
    .map(a => (a.extraManaAura === 'chosen' ? [a.chosenColor || 'G'] : MANA.includes(a.extraManaAura) ? [a.extraManaAura] : MANA.slice(0, 5)));
  // The creature Springleaf Drum would tap (an untapped one, tokens first), or null.
  const drumFodder = (s, inst) => {
    const list = s.zones.battlefield.map(id => s.cards[id]).filter(c => c !== inst && !c.tapped && !c.phasedOut && !c.attacking && isCreature(c));
    return list.find(c => c.token) || list[0] || null;
  };
  // The permanent a "Sacrifice a Food: Add …" source would sacrifice (a token first), or null.
  const sacFodder = (s, inst) => {
    const kind = inst.mana && inst.mana.sacOther;
    const list = kind ? s.zones.battlefield.map(id => s.cards[id]).filter(c => c !== inst && !c.phasedOut && new RegExp(`\\b${kind}\\b`, 'i').test(c.typeLine || '')) : [];
    return list.find(c => c.token) || list[0] || null;
  };
  function baseSource(s, inst) {
    if (inst.faceDown || inst.phasedOut) return null;
    // Song of Freyalise: 'Until your next turn, creatures you control gain "{T}: Add one mana of any color."' (s.creatureManaTurn)
    if (!inst.mana && s.creatureManaTurn != null && s.turn === s.creatureManaTurn && isCreature(inst)) return inst.enteredTurn === s.turn ? null : { colors: [...MANA.slice(0, 5)], amount: 1, sacrifice: false };
    // Springleaf Drum: "{T}, Tap an untapped creature you control: Add one mana of any color." (autoPay taps one)
    if (inst.mana && inst.mana.tapCreature && !drumFodder(s, inst)) return null;
    // Rishkar: 'Each creature you control with a counter on it has "{T}: Add {G}."' (inst.grantedMana, bot.js)
    if (!inst.mana && inst.grantedMana && isCreature(inst)) return inst.enteredTurn === s.turn ? null : inst.grantedMana;
    if (inst.mana && inst.mana.countLand) {
      const { type, basic } = inst.mana.countLand;
      const n = s.zones.battlefield.map(id => s.cards[id]).filter(c => isLand(c) && !c.phasedOut && (!basic || /\bbasic\b/i.test(c.typeLine || ''))
        && String(c.typeLine || '').toLowerCase().split(/[^a-z]+/).includes(type.replace(/s$/, ''))).length;
      inst.mana.makes = Array(n).fill(inst.mana.colors[0]);
      inst.mana.amount = n;
      if (n > inst.mana.filter) return inst.mana;
      if (!isLand(inst)) return null;
      const colors = producesOf(inst).filter(k => k === 'C'); // Cabal Stronghold's {T}: Add {C}
      return colors.length ? { colors, amount: 1, sacrifice: false } : null;
    }
    if (inst.mana && inst.mana.imprint) {
      const cols = (inst.imprintColors || []).filter(k => MANA.includes(k));
      return cols.length ? { ...inst.mana, colors: cols } : null;
    }
    if (inst.mana && inst.mana.chosenColor) {
      const cols = [...new Set([inst.mana.base, inst.chosenColor].filter(Boolean))]; // Thriving lands: their own color too
      return cols.length ? { ...inst.mana, colors: cols } : null;
    }
    if (inst.mana && inst.mana.countKw) {
      if (isCreature(inst) && inst.enteredTurn === s.turn) return null;
      const n = (s.kwCount || {})[inst.mana.countKw] || 0;
      return n ? { ...inst.mana, amount: n } : null;
    }
    // Everflowing Chalice: "{T}: Add {C} for each charge counter on this artifact."
    if (inst.mana && inst.mana.perCounter) {
      const n = (inst.counters || {})[inst.mana.perCounter] || 0;
      return n ? { ...inst.mana, amount: n } : null;
    }
    if (Object.values(inst.boosts || {}).some(b => b && b.noAbilities)) return null; // Arrest
    if (inst.mana && inst.mana.sacOther && !sacFodder(s, inst)) return null; // Gilded Goose with no Food
    if (inst.mana && inst.mana.remove && (inst.counters[inst.mana.remove.kind] || 0) < inst.mana.remove.n) return null; // Component Pouch with no counters
    if (inst.mana && inst.mana.mill && !s.zones.library.length) return null; // Millikin with nothing to mill
    if (inst.mana && inst.mana.filter && !(isCreature(inst) && inst.enteredTurn === s.turn)) return inst.mana;
    if (isLand(inst)) {
      // Abundant Growth: 'Enchanted land has "{T}: Add one mana of any color."'
      const given = Object.values(inst.boosts || {}).some(b => b && (b.lines || []).some(l => /^\{T\}:\s*add one mana of any colou?r\.?$/i.test(l)));
      const made = given ? MANA.slice(0, 5) : producesOf(inst);
      // Yavimaya, Cradle of Growth: every land is a Forest too, so it can tap for {G} (s.allForests, bot.js's refreshGrants)
      // Prismatic Omen: every basic land type, so any color (s.allBasics)
      const colors = s.allBasics ? MANA.slice(0, 5) : s.allForests && !made.includes('G') ? MANA.filter(k => made.includes(k) || k === 'G') : made;
      return colors.length ? { colors, amount: 1, sacrifice: false } : null;
    }
    if (!inst.mana) return null;
    if (isCreature(inst) && inst.enteredTurn === s.turn) return null;
    return inst.mana;
  }

  // Every untapped mana source, as one unit per mana it makes, in the order auto-tap uses them:
  // lands (fewest colors first), then mana rocks, then creatures, then things you sacrifice (Treasure).
  // Sources that cost {1} to tap (filterSources) aren't in it.
  // spell: what's being paid for ({ typeLine }), for mana that can only be spent on some spells (Orb of Dragonkind).
  const spendable = (src, spell) => (!src.onlyFor || (!!spell && new RegExp(`\\b${src.onlyFor}\\b`, 'i').test(spell.typeLine || '')))
    && (!src.artifactOnly || !spell || /\bartifact\b/i.test(spell.typeLine || '')) // Vibranium: abilities and artifact spells
    && (!src.monoOnly || (!!spell && (spell.cardColors || []).length === 1 && src.colors.includes(spell.cardColors[0]))) // Throne of Eldraine
    && (!src.bigOrX || (!!spell && (hasX(spell) || (spell.cmc || 0) >= src.bigOrX))); // Troyan
  const hasX = spell => /\{X\}/i.test((spell && spell.cost) || '');

  function manaUnits(s, spell) {
    const units = [];
    for (const iid of s.zones.battlefield) {
      const inst = s.cards[iid];
      if (inst.tapped) continue;
      let src = sourceOf(s, inst);
      // Elementalist's Palette: its charge counters' {C} for a spell with {X}, when that's more
      const xn = inst.mana && inst.mana.xCounters && hasX(spell) ? inst.counters[inst.mana.xCounters] || 0 : 0;
      if (xn > ((src && src.amount) || 0)) src = { colors: ['C'], amount: xn, sacrifice: false };
      if (!src || src.filter || !spendable(src, spell)) continue;
      const rank = isLand(inst) ? 0 : src.sacrifice ? 3 : isCreature(inst) ? 2 : 1;
      // Jegantha: each mana its own color (src.makes), and none of it for generic costs (noGeneric, payWith).
      for (let i = 0; i < src.amount; i++) units.push({ inst, colors: src.makes ? [].concat(src.makes[i]) : src.colors, rank, kind: `${rank}${(src.makes ? [].concat(src.makes[i]) : src.colors).join('')}${src.amount}`, ...(src.noGeneric ? { noGeneric: true } : {}) });
    }
    // Relic of Legends: "Tap an untapped legendary creature you control: Add one mana of any color." (last resort)
    if (s.zones.battlefield.some(iid => s.cards[iid].tapLegend && !s.cards[iid].faceDown && !s.cards[iid].phasedOut)) {
      for (const iid of s.zones.battlefield) {
        const c = s.cards[iid];
        if (!c.tapped && !c.faceDown && !c.phasedOut && isCreature(c) && /\blegendary\b/i.test(c.typeLine || '') && !units.some(u => u.inst === c)) units.push({ inst: c, colors: [...MANA.slice(0, 5)], rank: 4, kind: '4L' });
      }
    }
    return units.sort((a, b) => a.rank - b.rank || a.colors.length - b.colors.length);
  }

  // Untapped sources like "{1}, {T}: Add {G}{W}." (Sungrass Prairie, Signets).
  const filterSources = (s, spell) => s.zones.battlefield.map(iid => s.cards[iid]).filter(inst => { const src = !inst.tapped && sourceOf(s, inst); return !!src && !!src.filter && spendable(src, spell); });

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
    let dmg = 0; // the part of opp that's damage ("deals 2 damage to each opponent"), not life loss
    for (const effect of enterEffects(name, oracle)) {
      if (/for each|equal to|\bx life\b/i.test(effect)) continue;
      let g;
      if ((g = effect.match(/\byou gain (\w+) life\b/i)) && toNumber(g[1])) you += toNumber(g[1]);
      if ((g = effect.match(/\byou lose (\w+) life\b/i)) && toNumber(g[1])) you -= toNumber(g[1]);
      if ((g = effect.match(/\beach opponent loses (\w+) life\b/i)) && toNumber(g[1])) opp -= toNumber(g[1]);
      if ((g = effect.match(/\btarget opponent loses (\w+) life\b/i)) && toNumber(g[1])) target -= toNumber(g[1]);
      if ((g = effect.match(/\bdeals (\w+) damage to each opponent\b/i)) && toNumber(g[1])) { opp -= toNumber(g[1]); dmg += toNumber(g[1]); }
    }
    return you || opp || target ? { you, opp, target, dmg } : null;
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
      if ((m = /^vanishing (\d+)$/i.exec(line))) out.time = (out.time || 0) + Number(m[1]); // Lost Auramancers (bot.js's upkeepSuspend takes them off)
      for (const sentence of line.split(/(?<=\.)\s+/)) {
        m = /^.+? enters(?: the battlefield)? with (\w+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on (?:it|him|her)\.?$/i.exec(sentence); // The Duke: "… on him"
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
  // "As this artifact enters, choose a color." (Heraldic Banner)
  const choosesColor = oracle => /\bas (?:this|.+?) enters, choose a colou?r\b/i.test(oracle || '');

  // Reads "<types> spells you cast cost {N} less to cast" from rules text. Returns a list of
  // { n, types, chosen }: types are the words a spell's type line needs (any one of them; "non…"
  // means it must not have it; empty means any spell), and chosen means it also has to be the
  // creature type picked for this card. Spells your opponents cast, and discounts with conditions
  // ("with flying", "for each…"), aren't read.
  function costReductions(oracle) {
    const out = [];
    for (const sentence of String(oracle || '').split(/\n+|(?<=\.)\s+/)) {
      // Eminence (The Ur-Sphinx): "As long as The Ur-Sphinx is in the command zone or on the
      // battlefield, other Sphinx spells you cast cost {1} less to cast." (from the command zone too)
      const em = /^(?:eminence\s*[—-]\s*)?as long as .+? is in the command zone or on the battlefield, (?:other )?(.+)$/i.exec(sentence.trim());
      const m = (em ? em[1] : sentence.trim()).match(/^(.*?)\s*\bspells (you cast )?(of the chosen type )?(you cast )?cost \{(\d+)\} less to cast\.?$/i);
      if (!m || !(m[2] || m[3] || m[4])) continue;
      const words = m[1].toLowerCase().split(/,?\s+(?:and\/or|and|or)\s+|,\s*|\s+/).filter(Boolean);
      if (words.length > 4 || !words.every(w => /^[a-z-]+$/.test(w))) continue;
      out.push({ n: Number(m[5]), types: words, chosen: !!m[3], ...(em ? { eminence: true } : {}) });
    }
    return out;
  }

  // How much less a spell costs from the permanents on your battlefield. oracleOf(inst) gives a
  // card's rules text. Only generic mana is taken off; autoPay won't go below zero.
  const AFFINITY_GRANT = /^(\w+) spells you cast have affinity for (\w+)\.?$/im;
  const TARGET_DISCOUNT = /^spells you cast that target an? (\w+) cost \{(\d+)\} less to cast\.?$/im;
  // Gran-Gran: "Noncreature spells you cast cost {1} less to cast as long as there are three or more Lesson cards in your graveyard."
  const GRAVE_DISCOUNT = /^(\w+) spells you cast cost \{(\d+)\} less to cast as long as there are (\w+) or more (\w+) cards in your graveyard\.?$/im;
  // Momo, Friendly Flier: "The first non-Lemur creature spell with flying you cast during each of your turns costs {1} less to cast."
  // (s.castThisTurn: bot.js's spellCast, which marks the fliers)
  const FIRST_FLIER = /^the first non-(\w+) creature spell with flying you cast during each of your turns costs \{(\d+)\} less to cast\.?$/im;
  const hasFlying = text => /(?:^|\n)(?:[a-z ]+, )*flying(?:,|\n|$)/i.test(String(text || ''));
  function discount(s, spell, oracleOf) {
    const typeWords = String(spell.typeLine || '').split('//')[0].toLowerCase().split(/[^a-z-]+/).filter(Boolean);
    const has = w => typeWords.includes(w);
    let total = 0;
    for (const iid of [...s.zones.battlefield, ...s.zones.command]) {
      const src = s.cards[iid];
      if (src.faceDown || src.iid === spell.iid) continue;
      for (const r of costReductions(oracleOf(src))) {
        if (src.zone === 'command' && !r.eminence) continue;
        const plain = r.types.filter(w => !w.startsWith('non'));
        const nots = r.types.filter(w => w.startsWith('non')).map(w => w.replace(/^non-?/, ''));
        if (nots.some(has) || (plain.length && !plain.some(has))) continue;
        if (r.chosen && !(src.chosenType && has(src.chosenType.toLowerCase()))) continue;
        total += r.n;
      }
      // Pearl-Ear, Imperial Advisor: "Enchantment spells you cast have affinity for Auras." ({1} less for each Aura you control)
      const aff = src.zone === 'battlefield' && AFFINITY_GRANT.exec(String(oracleOf(src) || ''));
      if (aff && has(aff[1].toLowerCase())) {
        const kind = aff[2].toLowerCase().replace(/s$/, '');
        total += s.zones.battlefield.filter(id => id !== spell.iid && new RegExp(`\\b${kind}\\b`, 'i').test(String(s.cards[id].typeLine || '').split('//')[0])).length;
      }
      // Killian, Ink Duelist: "Spells you cast that target a creature cost {2} less to cast." (a spell whose text targets one)
      const tg = src.zone === 'battlefield' && TARGET_DISCOUNT.exec(String(oracleOf(src) || ''));
      if (tg && new RegExp(`\\btarget\\b[^.]*?\\b${tg[1]}s?\\b`, 'i').test(String(oracleOf(spell) || ''))) total += Number(tg[2]);
      const gd = src.zone === 'battlefield' && GRAVE_DISCOUNT.exec(String(oracleOf(src) || ''));
      if (gd && (gd[1].toLowerCase() === 'noncreature' ? !has('creature') : has(gd[1].toLowerCase()))
        && s.zones.graveyard.filter(id => new RegExp(`\\b${gd[4]}\\b`, 'i').test(String(s.cards[id].typeLine || ''))).length >= (COUNT_WORDS[gd[3].toLowerCase()] || Number(gd[3]) || 0)) total += Number(gd[2]);
      const ff = src.zone === 'battlefield' && FIRST_FLIER.exec(String(oracleOf(src) || ''));
      if (ff && !s.offTurn && has('creature') && !has(ff[1].toLowerCase()) && hasFlying(oracleOf(spell))
        && !(s.spellTurn === s.turn && (s.castThisTurn || []).some(x => x.flying && /\bcreature\b/i.test(String(x.typeLine || '').split('//')[0]) && !new RegExp(`\\b${ff[1]}\\b`, 'i').test(String(x.typeLine || ''))))) total += Number(ff[2]);
      // Advanced Reconstruction (a Class, from level 3): "Spells you cast from anywhere other than your hand cost {2} less to cast."
      if (src.zone !== 'battlefield' || spell.zone === 'hand') continue;
      let level = 1;
      for (const l of String(oracleOf(src) || '').split('\n').map(x => x.trim())) {
        const lv = /:\s*level (\d+)$/i.exec(l);
        if (lv) { level = Number(lv[1]); continue; }
        const m = /^spells you cast from anywhere other than your hand cost \{(\d+)\} less to cast\.?$/i.exec(l);
        if (m && (src.level || 1) >= level) total += Number(m[1]);
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
  function autoPay(s, cost, extraGeneric = 0, spell = null) {
    const need = parseCost(cost);
    need.generic = Math.max(0, need.generic + extraGeneric);
    if (!need.generic && !need.pips.length) return { sources: [], life: 0, pool: 0 };
    const filters = filterSources(s, spell).slice(0, 3);
    const sets = filters.reduce((acc, f) => acc.concat(acc.map(a => [...a, f])), [[]]).sort((a, b) => a.length - b.length);
    let plan = null;
    for (const set of sets) if ((plan = withFilters(need, manaUnits(s, spell), set, Object.assign({}, s.mana), new Set(), 0))) break;
    // Channel (Yavimaya Bloomsage): "Until end of turn, any time you could activate a mana ability, you may pay 1 life. If you do, add {C}."
    // (s.lifeManaTurn): life covers the generic mana the sources can't.
    let lifeMana = 0;
    for (let k = 1; !plan && s.lifeManaTurn === s.turn && k <= need.generic && k < s.life; k++) {
      const less = { ...need, generic: need.generic - k };
      for (const set of sets) if ((plan = withFilters(less, manaUnits(s, spell), set, Object.assign({}, s.mana), new Set(), 0))) { lifeMana = k; break; }
    }
    if (!plan) return null;
    const { units, used, pool, life, tapping } = plan;
    if (lifeMana) { s.life -= lifeMana; log(s, `Paid ${lifeMana} life for {C} (Channel).`); }
    // How many colors of mana were spent (converge: Radiant Flames, Painful Truths). A source that
    // makes more than one color counts as whichever color isn't spent yet, as you'd pick.
    const spent = new Set(need.pips.filter(p => p.colors.length === 1 && p.colors[0] !== 'C').map(p => p.colors[0]));
    [...used].map(u => units[u].colors.filter(k => k !== 'C')).sort((a, b) => a.length - b.length)
      .forEach(cs => { const k = cs.find(c => !spent.has(c)); if (k) spent.add(k); });
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
      if (inst.mana && inst.mana.remove) counter(s, inst.iid, inst.mana.remove.kind, -inst.mana.remove.n); // Component Pouch
      if (inst.mana && inst.mana.addCounter) counter(s, inst.iid, inst.mana.addCounter, 1); // Exploding Barrel
      if (inst.mana && inst.mana.pain) { s.life -= inst.mana.pain; log(s, `${inst.name} dealt ${inst.mana.pain} damage to its controller as it was tapped.`); } // City of Brass
      if (inst.mana && inst.mana.mill && s.zones.library.length) move(s, s.zones.library[0], 'graveyard'); // Millikin
      if (inst.mana && inst.mana.tapCreature) { const c = drumFodder(s, inst); if (c) { c.tapped = true; c.tappedFor = null; } } // Springleaf Drum
      if (s.landsFrozen && isLand(inst)) inst.skipUntap = true; // the opponent's Vorinclex: it doesn't untap during your next untap step
      if (hooks.manaTapped) hooks.manaTapped(s, inst); // Treasure Nabber (bot.js)
      if (sourceOf(s, inst) && inst.mana && inst.mana.sacrifice) move(s, inst.iid, 'graveyard');
      if (inst.mana && inst.mana.sacOther) { const f = sacFodder(s, inst); if (f) move(s, f.iid, 'graveyard'); } // Gilded Goose's Food
    }
    // Coin of Mastery: "for each mana from an artifact source spent to cast it"
    const artifactMana = [...used].filter(u => units[u] && units[u].inst && /\bartifact\b/i.test(String(units[u].inst.typeLine || '').split('//')[0])).length;
    const treasureMana = [...used].filter(u => units[u] && units[u].inst && /\btreasure\b/i.test(String(units[u].inst.typeLine || '') + ' ' + (units[u].inst.name || ''))).length;
    if (spell && treasureMana) spell.treasureSpent = treasureMana;
    const key = `${s.turn}${s.offTurn ? 'o' : ''}`;
    if (s.spentKey !== key) { s.spentKey = key; s.spent = 0; }
    const before = s.spent;
    s.spent += need.generic + need.pips.length;
    if (hooks.spent && s.spent > before) hooks.spent(s, before, s.spent);
    return { sources: sources.map(i => i.name + (i.mana && i.mana.sacrifice ? ' (sacrificed)' : '')), life, pool: plan.fromPool, colors: spent.size, artifactMana, treasureMana };
  }

  // Turns on the filter sources in set one at a time: each one's {N} is paid by pool mana or other
  // sources (tried one kind at a time), and the mana it adds joins the units. Then pays the spell.
  function withFilters(need, units, set, pool, forced, fromPool) {
    if (!set.length) return payWith(need, units, pool, forced, fromPool);
    const [f, ...rest] = set;
    const out = f.mana.makes.map(c => ({ inst: f, colors: [].concat(c), rank: 1, kind: `F${[].concat(c).join('')}` })); // [G, U]: either (Flooded Grove)
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
      if (i === pips.length) return units.filter((u, k) => !used.has(k) && !u.noGeneric).length + poolLeft >= generic;
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
      const free = units.map((u, i) => i).filter(i => !used.has(i) && !units[i].noGeneric);
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
  //   { minBasics: 2 }          unless you control two or more basic lands (battle lands)
  // Other conditions return false and are left for you to decide.
  const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4 };
  const BASICS = '(plains|island|swamp|mountain|forest)';
  function entersTapped(name, oracle) {
    if (!oracle) return false;
    const front = (name || '').split(' // ')[0].toLowerCase();
    // "As this land enters, you may pay 3 life. If you don't, it enters tapped." (Boggart Bog, shock lands)
    const shock = /\bas (?:this land|[^.,]+?) enters, you may pay (\w+) life\. if you don't, it enters tapped\b/i.exec(oracle); // The Black Gate: by its name
    if (shock && toNumber(shock[1])) return { payLife: toNumber(shock[1]) };
    // Game Trail, Murmuring Bosk: "As this land enters, you may reveal a Mountain or Forest card from
    // your hand. If you don't, this land enters tapped." (revealed for you when you have one)
    const reveal = /\bas this land enters, you may reveal an? (\w+)(?: or (\w+))? card from your hand\. if you don't, (?:this land|it) enters tapped\b/i.exec(oracle);
    if (reveal) return { revealHand: [reveal[1], reveal[2]].filter(Boolean).map(t => t.toLowerCase()) };
    // Temple of the Dragon Queen: "As this land enters, you may reveal a Dragon card from your hand. This land enters tapped unless you revealed a
    // Dragon card this way or you control a Dragon."
    const temple = /\bas this land enters, you may reveal an? (\w+) card from your hand\. this land enters tapped unless you revealed an? \1 card this way or you control an? \1\b/i.exec(oracle);
    if (temple) return { revealHand: [temple[1].toLowerCase()], orControl: temple[1].toLowerCase() };
    // Den of the Bugbear: "If you control two or more other lands, this land enters tapped." (a fast land with one fewer)
    const many = /\bif you control (one|two|three|four) or more other lands, (?:this land|it) enters tapped\b/i.exec(oracle);
    if (many) return { maxOther: COUNT_WORDS[many[1].toLowerCase()] - 1 };
    let out = false;
    oracle.split(/\n+|(?<=\.)\s+(?=[A-Z])/).forEach(line => {
      const m = line.match(/^(.+?) enters(?: the battlefield)? tapped(?: unless (.+?))?\.$/i);
      if (!m) return;
      const subject = m[1].toLowerCase();
      // "Ebondeath enters tapped." for Ebondeath, Dracolich
      if (!(subject === front || subject === front.split(',')[0] || /^this (land|creature|artifact|permanent)$/.test(subject))) return;
      const cond = (m[2] || '').toLowerCase();
      let c;
      if (!cond) out = true;
      else if ((c = cond.match(/^you have (one|two|three|four) or more opponents$/))) out = { opponents: COUNT_WORDS[c[1]] };
      else if ((c = cond.match(/^you control (one|two|three|four) or (fewer|more) other lands$/))) out = c[2] === 'fewer' ? { maxOther: COUNT_WORDS[c[1]] } : { minOther: COUNT_WORDS[c[1]] };
      else if ((c = cond.match(/^you control (one|two|three|four) or more basic lands$/))) out = { minBasics: COUNT_WORDS[c[1]] }; // battle lands
      else if ((c = cond.match(new RegExp(`^you control an? ${BASICS}(?:,? or an? ${BASICS})?$`)))) out = { control: [c[1], c[2]].filter(Boolean) };
      else if ((c = cond.match(/^your opponents control (\w+) or more lands$/))) out = { oppLands: toNumber(c[1]) }; // Turbulent lands
      else if ((c = cond.match(/^you control (\w+) or more other (\w+?)s$/))) out = { minOtherType: { n: toNumber(c[1]), type: c[2] } }; // Witch's Cottage: "three or more other Swamps"
      else if ((c = cond.match(/^you control an? ((?:legendary )?(?:creature|artifact|enchantment|planeswalker))$/))) out = { controlKind: c[1].split(' ') }; // Minas Tirith: "a legendary creature"
    });
    return out;
  }

  // Does this card come in tapped right now? s.opponents is how many opponents you have
  // (unknown when goldfishing, so then that condition is left to you). "You may pay 3 life" lands
  // come in untapped; app.js asks whether you pay, and Opp decides in bot.js.
  function tapsOnEntry(s, inst) {
    // Archelos: "As long as Archelos is tapped, other permanents enter tapped. As long as Archelos is
    // untapped, other permanents enter untapped." (s.enterState, kept by bot.js's refreshGrants)
    if (s.enterState && s.enterState.src !== inst.iid && !inst.faceDown) return s.enterState.tapped;
    if (s.landsUntapped && isLand(inst)) return false;
    // Thalia, Heretic Cathar (the opponent's): "Creatures and nonbasic lands your opponents control enter tapped." (s.tapKinds, bot.js's refreshGrants)
    const type = (inst.typeLine || '').split('//')[0];
    if ((s.tapKinds || []).some(k => (k === 'nonbasic land' ? isLand(inst) && !/\bbasic\b/i.test(type) : new RegExp(`\\b${k}\\b`, 'i').test(type)))) return true;
    const et = inst.entersTapped;
    if (!et || inst.faceDown) return false;
    if (et === true) return true;
    if (et.payLife) return false;
    // s.oppLandCount: how many lands the opponent has (bot.js); online it isn't known, so it's tapped.
    if (et.oppLands) return !(s.oppLandCount >= et.oppLands);
    if (et.revealHand) return !s.zones.hand.some(iid => et.revealHand.some(t => new RegExp(`\\b${t}\\b`, 'i').test(s.cards[iid].typeLine || '')))
      && !(et.orControl && s.zones.battlefield.some(iid => s.cards[iid] !== inst && new RegExp(`\\b${et.orControl}\\b`, 'i').test(s.cards[iid].typeLine || ''))); // Temple of the Dragon Queen
    const others = s.zones.battlefield.map(iid => s.cards[iid]).filter(c => c !== inst);
    const otherLands = others.filter(isLand).length;
    if (et.opponents) return s.opponents != null && s.opponents < et.opponents;
    if (et.maxOther != null) return otherLands > et.maxOther;
    if (et.minOther != null) return otherLands < et.minOther;
    if (et.minBasics != null) return others.filter(c => isLand(c) && /\bbasic\b/i.test(c.typeLine || '')).length < et.minBasics;
    if (et.control) return !others.some(c => et.control.some(t => new RegExp(`\\b${t}\\b`, 'i').test(c.typeLine || '')));
    if (et.minOtherType) return others.filter(c => new RegExp(`\\b${et.minOtherType.type}\\b`, 'i').test(c.typeLine || '')).length < et.minOtherType.n;
    if (et.controlKind) return !others.some(c => et.controlKind.every(t => new RegExp(`\\b${t}\\b`, 'i').test(faceType(c))));
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
    if (inst.enterLife.dmg && hooks.oppDamaged) hooks.oppDamaged(s, inst.enterLife.dmg);
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
    if (/^changeling\b/im.test(String(def.oracle || ''))) inst.changeling = true; // every creature type (bot.js)
    if (Array.isArray(def.colors) && def.colors.length && !def.custom) inst.cardColors = def.colors; // "multicolored card" (bot.js)
    if (/^.+? is all colors\b/im.test(String(def.oracle || ''))) inst.allColors = true; // Transguild Courier
    if (/^tap an untapped legendary creature you control: add one mana of any colou?r\.?$/im.test(String(def.oracle || ''))) inst.tapLegend = true; // Relic of Legends (manaUnits)
    if (/^rebound\b/im.test(String(def.oracle || ''))) inst.hasRebound = true; // Terramorph (move)
    if (/^you may play an additional land on each of your turns\.?$/im.test(String(def.oracle || ''))) inst.extraLandDrop = true; // Exploration (move)
    if (/^compleated\b/im.test(String(def.oracle || ''))) inst.compleated = true; // Vraska, Betrayal's Sting (startLoyalty)
    if (/^whenever enchanted land is tapped for mana, its controller adds an additional one mana of any colou?r\.?$/im.test(String(def.oracle || ''))) inst.extraManaAura = true; // Fertile Ground (sourceOf)
    const auraAdds = /^whenever enchanted (?:land|forest) is tapped for mana, its controller adds an additional (?:\{([WUBRGC])\}|one mana of the (chosen) colou?r)\.?$/im.exec(String(def.oracle || ''));
    if (auraAdds) inst.extraManaAura = auraAdds[1] ? auraAdds[1].toUpperCase() : 'chosen'; // Wild Growth, Utopia Sprawl (auraMana)
    if (/^if one or more creature tokens would be created under your control, that many 4\/4 white angel creature tokens with flying and vigilance are created instead\.?$/im.test(String(def.oracle || ''))) inst.angelTokens = true; // Divine Visitation (createToken)
    // Ifnir Deadlands: "{T}, Pay 1 life: Add {B}." That color isn't auto-tapped (producesOf); you activate it (bot.js's activatedAbilities).
    const lines = String(def.oracle || '').split('\n');
    // Boseiju, Who Shelters All: "… Add {C}. If that mana is spent on an instant or sorcery spell, that spell can't be countered."
    const lifeOnly = MANA.filter(k => lines.some(l => new RegExp(`^\\{T\\}, pay \\w+ life: add \\{${k}\\}(?:\\. if that mana is spent on .+)?\\.?$`, 'i').test(l.trim()))
      && !lines.some(l => new RegExp(`^\\{T\\}: add [^.]*\\{${k}\\}`, 'i').test(l.trim())));
    if (lifeOnly.length) inst.lifeColors = lifeOnly;
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
        if (LEYLINE.test(def.oracle || '')) inst.leyline = true;
        inst.zone = row.commander ? 'command' : 'library';
        s.zones[inst.zone].push(inst.iid);
      }
    }
    shuffleArray(s.zones.library);
    log(s, `New game with ${deck.name}${s.onDraw ? ' (on the draw)' : ' (on the play)'}.`);
    drawCards(s, 7, true);
    delete s.drawnThisTurn; // the opening hand isn't a draw this turn (Narset)
    firstDraw(s);
    beginLeylines(s);
    return s;
  }

  // Leyline of the Guildpact, Quicksilver: "If this card is in your opening hand, you may begin the game with it on the battlefield."
  // (always; a mulligan takes them back first: inst.leylineStart)
  const LEYLINE = /^if (?:this card|.+?) is in your opening hand, you may begin the game with (?:it|him|her|them) on the battlefield\.?$/im;
  function beginLeylines(s) {
    for (const iid of s.zones.hand.filter(i => s.cards[i].leyline)) {
      move(s, iid, 'battlefield', { put: true });
      s.cards[iid].leylineStart = true;
      s.cards[iid].enteredTurn = 0;
      log(s, `${s.cards[iid].name} began the game on the battlefield.`);
    }
  }
  // Before a mulligan: the ones that began on the battlefield go back with the hand.
  function takeBackLeylines(s) {
    for (const iid of s.zones.battlefield.filter(i => s.cards[i].leylineStart)) {
      move(s, iid, 'library');
      delete s.cards[iid].leylineStart;
    }
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
    // Narset, Parter of Veils (the opponent's): "Each opponent can't draw more than one card each turn." (s.drawCap, bot.js's refreshGrants)
    if (s.drawCap != null && n > s.drawCap - (s.drawnThisTurn || 0)) {
      n = Math.max(0, s.drawCap - (s.drawnThisTurn || 0));
      log(s, `Can't draw more than ${s.drawCap === 1 ? 'one card' : `${s.drawCap} cards`} this turn.`);
    }
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      // Notion Thief (the opponent's): "If an opponent would draw a card except the first one they draw in each of their draw steps,
      // instead that player skips that draw and you draw a card." (bot.js's drawInstead)
      if (hooks.drawInstead && hooks.drawInstead(s, !!s.inDrawStep && i === 0)) continue;
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
    s.drawnThisTurn = (s.drawnThisTurn || 0) + drawn;
    if (!quiet && drawn) log(s, `Drew ${drawn === 1 ? 'a card' : drawn + ' cards'}.`);
    if (drawn && hooks.drew) hooks.drew(s, drawn);
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

  // Bestowed (Chromanticore) and mutated (Illuna) cards ride on a creature like an aura.
  const isAttachment = inst => !!inst.bestowed || !!inst.mutatedOnto || /\b(equipment|aura)\b/i.test((inst.typeLine || '').split('//')[0]);
  const isAura = inst => !!inst.bestowed || !!inst.mutatedOnto || /\baura\b/i.test((inst.typeLine || '').split('//')[0]);
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
    // Flickering Ward: "Enchanted creature has protection from the chosen color."
    if (bonus && bonus.proChosen && inst.chosenColor) bonus = { ...bonus, kw: [...(bonus.kw || []), `protection from ${inst.chosenColor}`] };
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
    delete inst.imprint; // Duplicant
    delete inst.monstrous; // Fleecemane Lion
    delete inst.echoDone; // Mogg War Marshal: echo is due again
    delete inst.tempFlashback; // Past in Flames: only while it stays in the graveyard
    delete inst.modesEver; // Kimoyo Beads: "choose one that hasn't been chosen"
    delete inst.monarchAttack; // Okoye
    delete inst.animatedBy; // Animate Dead
    delete inst.overloaded; // Vandalblast
    delete inst.unearthed;
    delete inst.exileOnLeave;
    delete inst.kickCount;
    delete inst.prepared;
    delete inst.evoked;
    delete inst.enchanting; // an aura on another player's creature
    delete inst.pump;
    delete inst.regen;
    delete inst.granted;
    delete inst.grantedLines;
    delete inst.wasCast;
    delete inst.castFrom;
    delete inst.altPaid;
    delete inst.exileIfDies;
    delete inst.attacking;
    delete inst.loyaltyTurn;
    delete inst.auraPlaced;
    delete inst.offspringPaid;
    delete inst.baseTou;
    delete inst.skipUntap;
    delete inst.frozenBy;
    delete inst.phasedOut;
    delete inst.extraKw;
    delete inst.bounceAfterCombat;
    delete inst.castAftermath;
    delete inst.damageTaken;
    // The Commander precons' choices and states (bot.js).
    ['becomes', 'impending', 'bestowed', 'mutatedOnto', 'chosenMode', 'chosenCardType', 'level', 'heldBy', 'goad', 'noAttackTurn',
      'firstTurn', 'freeCast', 'xValue', 'spentColors', 'suspended', 'foretold', 'retype'].forEach(k => delete inst[k]);
    // A copy (Wall of Stolen Identity) is itself again.
    if (inst.original) { Object.assign(inst, inst.original); delete inst.original; }
    delete inst.keepLines; // Irma's own ability, kept while she was a copy
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
    // Compleated: two fewer for each Phyrexian symbol paid with (2) life.
    const less = inst.compleated && inst.phyrexianLife ? inst.phyrexianLife : 0;
    if (less) log(s, `${inst.name} (compleated): ${less} fewer loyalty, for the life paid.`);
    inst.counters.loyalty = Math.max(0, n - less) * 2 ** twice.length;
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
  // typeLine: the tokens' type line, when it's known (Stridehangar Automaton: one more Thopter when they're artifacts).
  function tokenCount(s, n, typeLine) {
    const by = doublers(s, d => d.tokens);
    if (s.plusSquirrels && n > 0 && !s.squirrelBusy) {
      s.squirrelBusy = true;
      try { for (let i = 0; i < n * s.plusSquirrels; i++) createToken(s, { custom: true, name: 'Squirrel', typeLine: 'Token Creature — Squirrel', pt: '1/1', text: '', oracle: '', colors: ['G'] }, { quiet: true }); } finally { s.squirrelBusy = false; }
      log(s, `Chatterfang: ${n * s.plusSquirrels} Squirrel token${n * s.plusSquirrels === 1 ? '' : 's'} too.`);
    }
    // Stridehangar Automaton: "If one or more artifact tokens would be created under your control, those tokens plus an additional 1/1 colorless
    // Thopter artifact creature token with flying are created instead." (s.plusThopter: how many, from bot.js's refreshGrants)
    if (s.plusThopter && n > 0 && /\bartifact\b/i.test(typeLine || '') && !s.thopterBusy) {
      s.thopterBusy = true;
      try { for (let i = 0; i < s.plusThopter; i++) createToken(s, { custom: true, name: 'Thopter', typeLine: 'Token Artifact Creature — Thopter', pt: '1/1', text: 'Flying', oracle: 'Flying' }, { quiet: true }); } finally { s.thopterBusy = false; }
      log(s, 'Stridehangar Automaton: a Thopter token too.');
    }
    // Donatello, the Brains: "… those tokens plus a Mutagen token are created instead." (s.plusMutagen: its text, from bot.js's refreshGrants)
    if (s.plusMutagen && n > 0 && !s.mutagenBusy) {
      s.mutagenBusy = true;
      try { createToken(s, { custom: true, name: 'Mutagen', typeLine: 'Token Artifact — Mutagen', text: s.plusMutagen, oracle: s.plusMutagen }, { quiet: true }); } finally { s.mutagenBusy = false; }
      log(s, 'Donatello: a Mutagen token too.');
    }
    const kaya = s.tokensTwiceTurn === s.turn ? 2 : 1; // Kaya, Geist Hunter's −2 (bot.js)
    return { n: n * 2 ** by.length * kaya, by: kaya > 1 ? [...by, 'Kaya, Geist Hunter'] : by };
  }

  // "Until end of turn" pumps and regeneration shields wear off, and so do the turn's "if it would
  // die this turn, exile it instead" (Bleed Dry), "you may play that card this turn" (Reno and Rude),
  // "whenever a creature dies this turn" (Massacre Girl) and the creatures that died this turn.
  function endOfTurn(s) {
    for (const inst of Object.values(s.cards)) {
      delete inst.pump;
      delete inst.basePTUntil; // Lord of the Nazgûl's 9/9 (bot.js's grantsOnce)
      delete inst.regen;
      delete inst.undoPump; // the pump it gave is gone anyway
      delete inst.exileIfDies;
      delete inst.handIfDies; // Together Forever (bot.js's died)
      // Cards you may play from exile: this turn, until a later turn (playable.until), or for as long as they stay exiled (forever).
      if (inst.playable && !inst.playable.forever && !(inst.playable.until > s.turn)) delete inst.playable;
      delete inst.tempFlashback; // Past in Flames
      delete inst.damageTaken;
      delete inst.damagedBy; // Hawkeye: the sources that dealt it damage this turn
      if (!(inst.becomes && inst.becomes.forever)) delete inst.becomes; // Restless lands stop being creatures (Excava's Spirits stay)
      delete inst.attackedNow;
      delete inst.modesUsed; // Parapet Thrasher: modes chosen this turn
      // Cursed Mirror's copy lasts until end of turn.
      if (inst.copyUntil != null && inst.original) { Object.assign(inst, inst.original); delete inst.original; delete inst.extraKw; delete inst.copyUntil; }
    }
    delete s.lostLife; // Archfiend of Despair: life lost this turn
    delete s.attackersNow; // Arachnogenesis: creatures attacking this player
    delete s.redirect; // Heroic Sacrifice
    delete s.marked;
    delete s.delayed;
    delete s.deathsThisTurn;
    delete s.nontokenDeaths; // Gadrak (bot.js)
    delete s.leftThisTurn;
    delete s.cantCast; // Silence
    delete s.drawnThisTurn; // Narset
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

  // opts: { index, bottom, x, y, faceDown, cast, put } (put: an effect puts it there, it isn't cast or played)
  function move(s, iid, to, opts = {}) {
    const inst = s.cards[iid];
    if (!inst) return;
    const from = inst.zone;
    if (from !== 'graveyard') s.moveSeq = (s.moveSeq || 0) + 1; // cards leaving a graveyard together share one (bot.js's cardMoved)
    if (from === 'graveyard' && to !== 'graveyard') s.graveLeftTurn = s.turn; // Primary Research, Relic Retriever: "if a card left your graveyard this turn"
    // Countered as it's cast (hooks.casting, Opp's counterspell): it never arrives. Its mana stays spent.
    if (to === 'battlefield' && !opts.put && (from === 'hand' || from === 'command' || opts.cast) && !isLand(inst) && !opts.faceDown && hooks.casting && hooks.casting(s, inst)) {
      if (from !== 'command') return move(s, iid, 'graveyard');
      inst.castCount = (inst.castCount || 0) + 1; // the tax still goes up
      log(s, `${inst.name} was countered and stays in the command zone.`);
      return;
    }
    // "If that creature would die this turn, exile it instead" (Bleed Dry), and The Darkness Crystal's
    // "If a nontoken creature an opponent controls would die, instead exile it".
    if (from === 'battlefield' && to === 'graveyard' && !inst.faceDown && isCreature(inst)) {
      if (inst.exileIfDies) to = 'exile';
      else if (hooks.wouldDie) to = hooks.wouldDie(s, inst) || to;
    }
    // Unearth: "Exile it … if it would leave the battlefield." Moira and Teshar: "If it would leave the battlefield, exile it instead …" (exileOnLeave)
    if (from === 'battlefield' && to !== 'battlefield' && to !== 'exile' && (inst.unearthed || inst.exileOnLeave)) to = 'exile';
    // A finality counter (Shuri's Fabricator): "If a permanent with a finality counter on it would die, exile it instead."
    if (from === 'battlefield' && to === 'graveyard' && (inst.counters || {}).finality > 0) to = 'exile';
    // Madness: a discarded card can go to exile instead, to be cast from there.
    if (from === 'hand' && to === 'graveyard' && hooks.discard) to = hooks.discard(s, inst) || to;
    // Dauthi Voidwalker (the opponent's): "If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it."
    if (to === 'graveyard' && from !== 'graveyard' && !inst.token && hooks.graveInstead && hooks.graveInstead(s, inst)) { to = 'exile'; inst.voidCounter = true; }
    // Rebound (Terramorph): cast from your hand, it's exiled as it resolves, to be cast again at your next upkeep (bot.js's upkeepSuspend).
    // Gravestorm (Ominous Harvest): permanents put into a graveyard from the battlefield this turn.
    // Welcome the Dead: "cards that were put into your graveyard from your hand or library this turn" (mill counts too)
    if ((from === 'hand' || from === 'library') && to === 'graveyard') noteHandLibGrave(s);
    if (from === 'battlefield' && to === 'graveyard' && !inst.faceDown) { if (s.toGraveTurn !== s.turn) { s.toGraveTurn = s.turn; s.toGraveN = 0; } s.toGraveN++; }
    // Buyback (Capsize): the paid-for spell goes back to its owner's hand.
    if (from === 'battlefield' && to === 'graveyard' && inst.boughtBack && /\b(instant|sorcery)\b/i.test(inst.typeLine || '')) { delete inst.boughtBack; to = 'hand'; }
    let rebound = false;
    if (from === 'battlefield' && to === 'graveyard' && inst.reboundArmed && /\b(instant|sorcery)\b/i.test(inst.typeLine || '')) { to = 'exile'; rebound = true; }
    // Quintorius, Loremaster: "If that spell would be put into a graveyard, put it on the bottom of its owner's library instead."
    if (from === 'battlefield' && to === 'graveyard' && inst.bottomInstead && /\b(instant|sorcery)\b/i.test(inst.typeLine || '')) { delete inst.bottomInstead; return move(s, iid, 'library', { bottom: true }); }
    // Soulless Jailer: "Permanent cards in graveyards can't enter the battlefield." (s.graveLocked, bot.js's refreshGrants)
    if (from === 'graveyard' && to === 'battlefield' && s.graveLocked && !(opts.cast && !isLand(inst))) { // a spell cast from there goes by the stack
      log(s, `${inst.name} can't enter the battlefield from a graveyard.`);
      return;
    }
    const list = s.zones[from];
    const at = list.indexOf(iid);
    if (at >= 0) list.splice(at, 1);
    // What it was like on the battlefield, for "if it had no counters on it", undying and persist,
    // and "if its toughness was less than 1" (taken before its equipment and pumps come off).
    const info = { counters: Object.assign({}, inst.counters), to, pump: inst.pump || null, anthem: inst.anthem || null, cda: inst.cda || null, boosts: inst.boosts ? Object.assign({}, inst.boosts) : null, custom: inst.custom || null, damage: inst.damageTaken || 0 };
    if (from === 'battlefield' && (to !== 'battlefield' || opts.x != null)) {
      closeStack(s, inst);
      delete inst.stacked;
      // Dragged off the creature it was on, or leaving the battlefield: no longer attached.
      if (inst.attachedTo) detach(s, iid);
    }
    if (from === 'battlefield' && to !== 'battlefield') {
      inst.lastInfo = { counters: info.counters, pump: info.pump, anthem: info.anthem, damage: info.damageTaken || 0 }; // Rapacious Guest: "equal to its power" as it left (bot.js)
      // A creature leaving takes nothing with it: auras go to the graveyard, equipment stays, unattached.
      for (const id of attachmentsOf(s, iid)) {
        const a = s.cards[id];
        detach(s, id, true);
        // Bestow: a creature again. Mutate: the merged card goes where the creature went.
        if (a.bestowed) { delete a.bestowed; autoPlace(s, a); log(s, `${a.name} is a creature again.`); } else if (a.mutatedOnto) { delete a.mutatedOnto; move(s, id, ['hand', 'library', 'exile'].includes(to) ? to : 'graveyard'); } else if (isAura(a)) move(s, id, 'graveyard');
        else { autoPlace(s, a); log(s, `${a.name} stays on the battlefield, unattached.`); }
      }
      delete inst.boosts;
    }

    // A commander sent to the command zone instead of the graveyard still died.
    const died = from === 'battlefield' && (to === 'graveyard' || (to === 'command' && inst.commander)) && !inst.faceDown;
    if (inst.token && to !== 'battlefield') {
      delete s.cards[iid];
      log(s, `${inst.name} token left the battlefield and is gone.`);
      if (died && hooks.died) hooks.died(s, inst, info);
      if (hooks.moved) hooks.moved(s, inst, from, to);
      return;
    }

    if (from === 'battlefield' && to !== 'battlefield') resetForZoneChange(inst);
    inst.zone = to;
    if (opts.faceDown) inst.faceDown = true;
    delete inst.reboundArmed;
    if (rebound) { inst.rebounding = true; log(s, `${inst.name} (rebound) is exiled; cast it again at your next upkeep.`); }
    // Rebound: only when it's cast from the hand.
    if (from === 'hand' && to === 'battlefield' && inst.hasRebound && !opts.put) inst.reboundArmed = true;

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
      if (from !== 'battlefield') { inst.enteredTurn = s.turn; inst.enteredFrom = from; delete inst.attackedTurn; startLoyalty(s, inst); countEntered(s, inst); }
      // A spell cast or a nontoken permanent put onto the battlefield on this player's own turn
      // (s.offTurn is set while someone else's turn is on), for Arboria.
      if (from !== 'battlefield' && !inst.token && !s.offTurn) s.actedTurn = s.turn;
      if (from !== 'battlefield' && tapsOnEntry(s, inst)) {
        inst.tapped = true;
        inst.tappedFor = null;
      }
      // Exploration: "You may play an additional land on each of your turns." (inst.extraLandDrop)
      if (from === 'hand' && isLand(inst) && !opts.put) {
        s.landsThisTurn = (s.landsThisTurn || 0) + 1;
        s.landPlayed = s.landsThisTurn > s.zones.battlefield.filter(id => s.cards[id].extraLandDrop && !s.cards[id].faceDown).length + (s.extraLandAll || 0); // Rites of Flourishing (bot.js)
      }
      if (from === 'command' && inst.commander) inst.castCount = (inst.castCount || 0) + 1;
      // Cast, not just put onto the battlefield (The Sibsig Ceremony's "if you cast it").
      if (from !== 'battlefield' && !opts.put && (from === 'hand' || from === 'command' || opts.cast) && !isLand(inst) && !opts.faceDown) { inst.wasCast = true; inst.castFrom = from; } // Dirgur Focusmage: "… from your hand"
      // Arena of Glory: "If any of that mana is spent on a creature spell, it gains haste until end of turn." (the next creature spell this turn)
      if (inst.wasCast && s.hasteMana === s.turn && isCreature(inst)) { delete s.hasteMana; inst.pump = { pow: 0, tou: 0, ...inst.pump, kw: [...new Set([...((inst.pump && inst.pump.kw) || []), 'haste'])] }; }
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
    if (died && hooks.died) hooks.died(s, inst, info);
    if (hooks.moved) hooks.moved(s, inst, from, to);
    // A card you control but another player owns goes back to them once it leaves the battlefield.
    if (inst.owner && from === 'battlefield' && to !== 'battlefield' && hooks.sendHome && s.cards[iid]) hooks.sendHome(s, inst, to);
    if (to === 'battlefield') {
      applyEnterLife(s, inst);
      applyEnterDraw(s, inst);
      if (hooks.entered) hooks.entered(s, inst);
      // Cast from your hand or the command zone (or for free, like cascade): prowess and "whenever you cast".
      if (!opts.put && (from === 'hand' || from === 'command' || opts.cast) && !isLand(inst) && !inst.faceDown && hooks.cast) hooks.cast(s, inst);
      // A spell cast from your hand or the command zone, for counterspells (see counterLast). Not one
      // that's already gone, like a resolved counterspell, unless its pump can still be taken back.
      if (!opts.put && (from === 'hand' || from === 'command') && !isLand(inst) && s.cards[iid] && (inst.zone === 'battlefield' || inst.undoPump)) s.lastCast = { iid, at: Date.now() };
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
      const src = isLand(inst) ? { colors: producesOf(inst), amount: 1 } : inst.mana && (inst.mana.countKw || inst.mana.perCounter || inst.mana.chosenColor || inst.mana.imprint) ? sourceOf(s, inst) : inst.mana;
      if (!src || inst.faceDown) return;
      let c = color;
      if (c === undefined) c = src.colors.length === 1 && !(isCreature(inst) && !isLand(inst)) ? src.colors[0] : null;
      if (c && MANA.includes(c)) {
        s.mana[c] += src.amount;
        inst.tappedFor = c;
        inst.tappedAmount = src.amount;
        // Wild Growth, Utopia Sprawl, Fertile Ground: their extra mana too (any color: the same as the land's; click the pool to change it)
        const extra = isLand(inst) ? auraMana(s, inst).map(cs => (cs.includes(c) ? c : cs[0])) : [];
        if (extra.length) { extra.forEach(k => { s.mana[k]++; }); inst.auraTapped = extra; }
        if (hooks.manaTapped) hooks.manaTapped(s, inst); // Treasure Nabber (bot.js)
      }
    } else if (inst.tappedFor) {
      s.mana[inst.tappedFor] = Math.max(0, s.mana[inst.tappedFor] - (inst.tappedAmount || 1));
      (inst.auraTapped || []).forEach(k => { s.mana[k] = Math.max(0, s.mana[k] - 1); });
      delete inst.auraTapped;
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
    const one = c => [].concat(c)[0]; // Flooded Grove by hand: the first color of each (click the pool to change it)
    makes.forEach(c => { s.mana[one(c)]++; });
    log(s, `Paid {${filter}}${paid.sources.length ? ` (tapped ${paid.sources.join(', ')})` : ''} and tapped ${inst.name} for ${makes.map(c => `{${one(c)}}`).join('')}.`);
  }

  function untapFilter(s, inst) {
    const { iids, spent } = inst.filterPaid;
    inst.tapped = false;
    inst.mana.makes.forEach(c => { const k = [].concat(c)[0]; s.mana[k] = Math.max(0, s.mana[k] - 1); });
    MANA.forEach(k => { s.mana[k] += spent[k] || 0; });
    iids.forEach(iid => { if (s.cards[iid] && s.cards[iid].zone === 'battlefield') s.cards[iid].tapped = false; });
    delete inst.filterPaid;
  }

  function untapAll(s) {
    s.zones.battlefield.forEach(iid => setTapped(s, iid, false));
    log(s, 'Untapped everything.');
  }

  // Unspent mana empties. Omnath, Locus of the Void: "If you would lose unspent mana, that mana
  // becomes colorless instead." (s.keepMana, kept by bot.js's refreshGrants)
  // Leyline Tyrant: "You don't lose unspent red mana" (s.keepRed).
  function emptyMana(s) {
    const left = s.keepMana ? Object.values(s.mana).reduce((n, v) => n + (v || 0), 0) : 0;
    const red = s.keepRed && !s.keepMana ? s.mana.R || 0 : 0;
    Object.keys(s.mana).forEach(k => { s.mana[k] = 0; });
    if (left) { s.mana.C = left; log(s, `${left} unspent mana became colorless instead of emptying.`); }
    if (red) s.mana.R = red;
  }
  // Goddric's celebration: how many nonland permanents entered under this player's control this turn.
  function countEntered(s, inst) {
    if (isLand(inst)) return;
    // Gyome: nontoken creatures that entered this turn.
    if (isCreature(inst) && !inst.token) { if (s.creaturesInTurn !== s.turn) { s.creaturesInTurn = s.turn; s.creaturesIn = 0; } s.creaturesIn++; }
    if (s.enteredMark !== s.turn) { s.enteredMark = s.turn; s.enteredCount = 0; }
    s.enteredCount++;
  }

  function nextTurn(s) {
    endCrew(s);
    endOfTurn(s);
    s.turn++;
    s.landPlayed = false;
    s.landsThisTurn = 0;
    emptyMana(s);
    const stunned = [];
    // Teferi's Protection: "Until your next turn, …" ends, and phased-out permanents come back.
    delete s.untilNextTurn;
    delete s.lockNoncreature; // Hope of Ghirapur (bot.js)
    delete s.shrinkAttackers; // Tamiyo, Seasoned Scholar (bot.js)
    Object.values(s.cards).forEach(c => { delete c.untilNextKw; }); // Elspeth, Storm Slayer: "gain flying until your next turn" (bot.js's stats)
    delete s.attackedYou; // "players who attacked you during their last turn"
    s.zones.battlefield.forEach(iid => { if (!s.cards[iid].heldBy) delete s.cards[iid].phasedOut; }); // Oubliette keeps its one (heldBy)
    s.zones.battlefield.forEach(iid => {
      const c = s.cards[iid];
      // A stun counter: instead of untapping, one comes off.
      if (c.tapped && c.counters && c.counters.stun > 0) { counter(s, iid, 'stun', -1); stunned.push(c.name); return; }
      // Wall of Frost ("doesn't untap during its controller's next untap step"), Wall of Stolen Identity's copied creature.
      if (c.tapped && (c.skipUntap || c.frozenBy)) { delete c.skipUntap; stunned.push(c.name); return; }
      if (c.tapped && c.noUntap) { stunned.push(c.name); return; } // Basalt Monolith: "doesn't untap during your untap step" (bot.js's refreshGrants)
      // Fall from Favor: it stays tapped unless its controller is the monarch.
      if (c.tapped && !s.monarch && Object.values(c.boosts || {}).some(b => b && b.noUntapUnlessMonarch)) { stunned.push(c.name); return; }
      c.tapped = false;
      c.tappedFor = null;
      delete c.filterPaid;
    });
    log(s, `— Turn ${s.turn} — untapped.${stunned.length ? ` ${stunned.join(', ')} stayed tapped (a stun counter came off).` : ''}`);
    drawCards(s, 1);
  }

  function mulligan(s) {
    takeBackLeylines(s);
    for (const iid of s.zones.hand.splice(0)) {
      s.cards[iid].zone = 'library';
      s.zones.library.push(iid);
    }
    shuffleArray(s.zones.library);
    s.mulligans++;
    drawCards(s, 7, true);
    delete s.drawnThisTurn; // the opening hand isn't a draw this turn (Narset)
    firstDraw(s);
    beginLeylines(s);
    log(s, `Mulligan #${s.mulligans}: drew a new 7${drawsTurnOne(s) && s.turn === 1 ? ' plus your first-turn card' : ''}. Put ${s.mulligans} on the bottom (right-click a card → Bottom of library).`);
  }

  const noteHandLibGrave = s => { if (s.handLibGraveTurn !== s.turn) { s.handLibGraveTurn = s.turn; s.handLibGrave = 0; } s.handLibGrave++; };
  function mill(s, n) {
    let count = 0;
    s.lastMilled = []; // The Ur-Sphinx: "a card that player milled this way"
    for (let i = 0; i < n && s.zones.library.length; i++) {
      const iid = s.zones.library.shift();
      if (hooks.graveInstead && hooks.graveInstead(s, s.cards[iid])) { s.cards[iid].zone = 'exile'; s.zones.exile.push(iid); s.cards[iid].voidCounter = true; count++; continue; } // Dauthi Voidwalker
      s.cards[iid].zone = 'graveyard';
      s.zones.graveyard.push(iid);
      s.lastMilled.push(iid);
      noteHandLibGrave(s);
      count++;
      if (hooks.moved) hooks.moved(s, s.cards[iid], 'library', 'graveyard');
    }
    log(s, `Milled ${count}.`);
  }

  // opts.effect: a card's effect is putting these counters on (not you fixing the number by hand),
  // so Doubling Season and the like double them. Returns how many were really added or taken off.
  function counter(s, iid, name, delta, opts = {}) {
    const inst = s.cards[iid];
    if (!inst) return 0;
    // Darksteel Angel: "Creatures you control can't have -1/-1 counters put on them." (s.noMinusCounters, bot.js)
    if (name === '-1/-1' && delta > 0 && s.noMinusCounters && isCreature(inst) && inst.zone === 'battlefield') { log(s, `${inst.name} can't have -1/-1 counters put on it.`); return 0; }
    // Hardened Scales, Ozolith, Kami of Whispered Hopes, Benevolent Hydra: "If one or more +1/+1 counters would be put on a creature (an artifact
    // or creature, a permanent, another creature) you control, that many plus one +1/+1 counters are put on it instead." (s.counterPlus, bot.js)
    if (name === '+1/+1' && delta > 0 && inst.zone === 'battlefield' && (s.counterPlus || []).length) {
      const type = String(inst.typeLine || '').toLowerCase();
      const more = s.counterPlus.filter(p => p.not !== inst.iid && (p.what === 'permanent' || (/creature/.test(p.what) && isCreature(inst)) || (/artifact/.test(p.what) && /\bartifact\b/.test(type)))).length;
      if (more) { delta += more; log(s, `${inst.name} gets ${more} more +1/+1 counter${more === 1 ? '' : 's'}.`); }
    }
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
    if (name === '+1/+1' && delta > 0) inst.plusTurn = s.turn; // Kid Loki: "that you've put one or more +1/+1 counters on this turn" (bot.js)
    // Exemplar of Light: "Whenever you put one or more +1/+1 counters on this creature, …" (bot.js)
    if (delta > 0 && inst.zone === 'battlefield' && hooks.counters) hooks.counters(s, inst, name, delta);
    return delta;
  }

  function toggle(s, iid, field) {
    const inst = s.cards[iid];
    if (inst) inst[field] = !inst[field];
  }

  // def: a Scryfall card, or { custom: true, name, pt, text } for a hand-made token.
  function createToken(s, def, opts = {}) {
    for (let k = 0; k < 3 && s.tokenSwap && s.tokenSwap[String(def.name || '').toLowerCase()]; k++) def = { ...s.tokenSwap[String(def.name).toLowerCase()] };
    // Divine Visitation: "If one or more creature tokens would be created under your control, that many 4/4 white
    // Angel creature tokens with flying and vigilance are created instead."
    const angel = /\bcreature\b/i.test(def.typeLine || '') && s.zones.battlefield.some(iid => s.cards[iid].angelTokens && !s.cards[iid].phasedOut && !s.cards[iid].faceDown);
    if (angel) def = { custom: true, name: 'Angel', typeLine: 'Token Creature — Angel', pt: '4/4', text: 'Flying, vigilance' };
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
    if (angel) { inst.extraKw = ['flying', 'vigilance']; inst.tokenColors = ['W']; }
    s.tokenTurn = s.turn; // Idol of Oblivion: "if you created a token this turn"
    if (s.tokensMadeTurn !== s.turn) { s.tokensMadeTurn = s.turn; s.tokensMade = 0; }
    s.tokensMade++; // Thalisse: "the number of tokens you created this turn"
    startLoyalty(s, inst);
    countEntered(s, inst);
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
    const { n, by } = tokenCount(s, opts.n || 1, src.typeLine); // Doubling Season, Parallel Lives…
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
    choosesType, choosesColor, sourceOf, costReductions, discount, AFFINITY_GRANT, TARGET_DISCOUNT, GRAVE_DISCOUNT, FIRST_FLIER, TAP_PAIN, enterDiscard, entersWithCounters, doublesOf, tokenCount, endOfTurn, drawsTurnOne, isCounterspell, counterLast,
    create, drawCards, shuffle, move, setTapped, untapAll, nextTurn, mulligan, mill,
    counter, toggle, createToken, copyAsToken, log, isLand, count, shuffleArray, randomInt,
    beginLeylines, takeBackLeylines, LEYLINE, attach, detach, isAttachment, isAura, attachmentsOf, sortHand, isVehicle, endCrew, uncrew, emptyMana,
    place: autoPlace,
  };
})();

if (typeof module !== 'undefined') module.exports = Game;
