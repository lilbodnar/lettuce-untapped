/*
 * Which parts of a card's rules text the Simulator does on its own, for your cards and for Opp's.
 * It reads the text with the same patterns bot.js and game.js use, so a line it calls done is one
 * those files act on. Your cards: what isn't done you do by hand on the table. Opp's cards: what
 * isn't done never happens, and some cards Opp never casts at all (planeswalkers, auras, battles,
 * X spells, and instants or sorceries it can't read).
 *
 * Coverage.check(card) with a Scryfall card as scryfall.js keeps it ({ name, typeLine, manaCost,
 * oracle, … }) returns { you, opp, oppCasts, lines: [{ text, you, opp, gaps }] }: you and opp are
 * 'all' (everything done), 'some' or 'none' (nothing done; for Opp also 'never' when it isn't cast).
 * gaps: [{ kind, phrase }] for each part that isn't done, phrase with numbers and names taken out so
 * the same wording on many cards counts together.
 */
const Coverage = (() => {
  'use strict';
  const B = typeof Bot !== 'undefined' ? Bot : require('./bot.js');
  const G = typeof Game !== 'undefined' ? Game : require('./game.js');
  const P = B.parts;

  const front = typeLine => String(typeLine || '').split('//')[0];
  const is = (card, type) => new RegExp(`\\b${type}\\b`, 'i').test(front(card.typeLine));
  const NUM = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';

  // A context like the ones app.js and bot.js pass to runEffect: one that can pick targets, hit
  // opponents and do the other things both sides can (Opp's in bot.js's oppCtx, yours in app.js's effectCtx).
  const noop = () => {};
  const ctxFor = inst => ({ self: inst, other: true, defOf: () => null, hitOpps: noop, hitTarget: noop, target: noop, oppsSacrifice: noop, loseHalf: noop,
    oppsExileGreatest: noop, exileGrave: noop, oppsHandPick: noop, oppsDraw: noop, oppsDiscard: noop, exileTop: noop, sacToPlay: noop });
  const runs = (text, inst) => P.canRunAll(text, ctxFor(inst));
  // The parts of an effect runEffect can't do.
  const notRun = (text, inst) => P.effectParts(P.settleIfYouDo(text, null)).filter(p => !P.canRunAll(p, ctxFor(inst)));

  // Words that don't change the game once you're playing (or that you just follow, like flash).
  const NOTHING_TO_DO = ['partner', 'partner with', 'friends forever', 'choose a background', 'doctor\'s companion', 'flash', 'enchant'];
  // Done for you when you cast it (app.js asks), but Opp never uses them.
  const YOURS_ONLY = ['offspring', 'freerunning', 'madness'];

  // ---------- one keyword line ----------

  function keywordLine(card, line) {
    const parts = line.toLowerCase().replace(/\.$/, '').split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const known = p => P.isKeyword(p, B.KEYWORDS) || P.isKeyword(p, P.OTHER_KEYWORDS) || P.isKeyword(p, YOURS_ONLY) || NOTHING_TO_DO.some(k => p === k || p.startsWith(k + ' '));
    if (!parts.length || !parts.every(known)) return null;
    const out = { you: true, opp: true, gaps: [] };
    for (const p of parts) {
      const name = p.split(/[\s—{]/)[0];
      if (NOTHING_TO_DO.some(k => p === k || p.startsWith(k + ' '))) continue;
      if (YOURS_ONLY.includes(name)) { gap(out, 'opp', 'keyword', `${name} (Opp never uses it)`); continue; }
      if (/^protection\b/.test(p)) {
        if (!P.protectionKw(p)) gap(out, 'both', 'keyword', p.replace(/\{[^}]+\}/g, '{M}'));
        continue;
      }
      if (B.KEYWORDS.some(k => p === k || p.startsWith(k + ' ') || p.startsWith(k + '—'))) continue;
      if (name === 'equip') { if (!B.equipCost(p)) gap(out, 'you', 'keyword', 'equip (cost that isn\'t mana)'); gap(out, 'opp', 'keyword', 'equip (Opp never equips)'); continue; }
      if (name === 'crew') { gap(out, 'opp', 'keyword', 'crew (Opp never crews)'); continue; }
      const kw = P.OTHER_KEYWORDS.find(k => p === k || p.startsWith(k + ' ') || p.startsWith(k + '—')) || name;
      gap(out, 'both', 'keyword', kw);
    }
    return out;
  }

  function gap(out, side, kind, phrase) {
    if (side !== 'opp') out.you = false;
    if (side !== 'you') out.opp = false;
    out.gaps.push({ kind, phrase, side });
  }

  // ---------- triggered abilities ----------

  const COUNTER_EACH = new RegExp(`^put ${P.COUNT} ([\\w+/-]+) counters? on each (other )?(.+?) you control\\.?$`, 'i');
  const LIFE = /^(?:you gain|you lose|each opponent loses|target opponent loses) (\w+) life$|^.+? deals (\w+) damage to each opponent$/i;
  const ENTER_DRAW = new RegExp(`^(?:you )?draw ${NUM} cards?$`, 'i');
  const ENTER_DISCARD = new RegExp(`^(?:each player|each opponent|target opponent|you)? ?discards? ${NUM} cards?(?: at random)?$`, 'i');
  const COMBAT_PUMP = /^(.+?) gets? ([+-](?:\d+|x))\/([+-](?:\d+|x)) until end of turn(?:, where x is the number of (.+?) you control)?\.?$/i;
  const PUMP_SENTENCE = /^(.+?) you control (?:get ([+-]\d+)\/([+-]\d+)(?: and gain (.+?))?|gain (.+?)) until end of turn\.?$/i;
  const THOSE_GAIN = /^(?:those creatures|they|each of them) gain (.+?) until end of turn\.?$/i;
  const kwOnly = text => String(text || '').toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/).map(k => k.trim()).filter(Boolean);
  const allKw = text => { const k = kwOnly(text); return k.length > 0 && k.every(w => B.KEYWORDS.includes(w)); };

  // Can bot.js's enterEffects / game.js's enter readers do this part of a "When this enters, …"?
  function enterPart(part, may, inst) {
    const p = part.trim().replace(/\.$/, '');
    if (B.targetEffect(p) || P.TOKEN_TEXT.test(p) || COUNTER_EACH.test(p) || /^you become the monarch$/i.test(p)) return true;
    if (/for each|equal to|\bx\b/i.test(p)) return false;
    if (LIFE.test(p)) return true;
    if (!may && ENTER_DRAW.test(p)) return true;
    if (!may && ENTER_DISCARD.test(p)) return true;
    // Other parts runEffect can do run too (enterEffects), unless game.js is the one that does them.
    return !P.enteredElsewhere(p) && runs(p, inst);
  }

  // A pump or counters a "whenever this attacks / blocks" does (combatTrigger), for every side, or
  // anything else runEffect can do there.
  function combatEffect(effect, inst) {
    const e = effect.trim().replace(/^if no opponent has more life than that player, /i, '');
    const [first, ...rest] = e.split(/(?<=\.)\s+/);
    if (COUNTER_EACH.test(first)) return rest.every(s => THOSE_GAIN.test(s) && allKw(THOSE_GAIN.exec(s)[1]));
    if (P.TOKEN_TEXT.test(e)) return true;
    const p = COMBAT_PUMP.exec(e);
    if (!p || (/x/i.test(p[2] + p[3]) && !p[4])) return runs(e, inst);
    return P.isSelf(p[1], inst) || /^(other )?(.+?) you control$/i.test(p[1]);
  }

  // Splits "Whenever …, effect" into its head and effect; strips an ability word ("Landfall — ").
  function triggerParts(line) {
    const m = /^(?:([a-z' -]+?)\s+[—-]\s+)?((?:when|whenever|at)\b[^,]*?),\s*(.+)$/i.exec(line);
    return m ? { word: m[1] || '', head: m[2], effect: m[3] } : null;
  }

  function triggerLine(card, line, inst) {
    const t = triggerParts(line);
    if (!t) return null;
    const out = { you: true, opp: true, gaps: [] };
    const effectGaps = (side, effect) => {
      const left = notRun(effect, inst);
      if (!left.length) return;
      left.forEach(p => gap(out, side, 'effect', p));
    };
    const may = /^you may\b/i.test(t.effect);
    const effect = t.effect.replace(/^you may /i, '');
    const self = words => P.isSelf(words, inst);
    let m;

    // "When this enters (or attacks), …"
    if ((m = /^when(?:ever)? (.+?) enters(?: the battlefield)?(?: or ([^,]+))?, (?:you may )?(.+)$/i.exec(line)) && self(m[1])) {
      const text = P.settleIfYouDo(m[3], null);
      if (/\bif you do\b/i.test(text)) { gap(out, 'both', 'effect', m[3]); return out; }
      const parts = P.effectParts(text);
      const first = text.trim().split(/(?<=\.)\s+/)[0];
      if (COUNTER_EACH.test(first)) { if (!combatEffect(text, inst)) gap(out, 'both', 'effect', text); return out; }
      for (const part of parts) if (!enterPart(part, may, inst)) gap(out, 'both', 'effect', part);
      return out;
    }
    // "When this dies, …" (Unstoppable Slasher: "if it had no counters on it, return it to the battlefield …")
    if ((m = /^when(?:ever)? (.+?) (?:dies|is put into (?:a|your) graveyard from (?:the battlefield|play)), (?:you may )?(.+)$/i.exec(line)) && self(m[1])) {
      if (P.TOKEN_TEXT.test(m[2].trim()) || P.RETURN_STUNNED.test(m[2].trim())) return out;
      effectGaps('both', m[2]);
      return out;
    }
    // "Whenever this attacks / blocks, …", "Whenever this creature attacks a player, …"
    if ((m = /^whenever (.+?) (enters(?: the battlefield)? or attacks|attacks or blocks|attacks|blocks)( a player)?(?: a creature)?, (.+)$/i.exec(line)) && self(m[1])) {
      if (!combatEffect(m[4], inst)) gap(out, 'both', 'effect', m[4]);
      return out;
    }
    if ((m = P.ATTACK_BLOCK_CAP.exec(line)) && self(m[1])) return out;
    // Interceptor: "Whenever you attack with one or more legendary creatures, you may pay {2}{B}. If you do, return this card from your graveyard …"
    if (P.GRAVE_ATTACK.test(line)) return out;
    // Landfall (Guul Draz Overseer's "If that land is a Swamp, …" too)
    if ((m = /^(?:landfall\s*[—-]\s*)?whenever a land(?: you control)? enters(?: the battlefield)?(?: under your control)?, (?:you may )?(.+)$/i.exec(line))) {
      effectGaps('both', B.parts.landfallText(m[1], null));
      return out;
    }
    // Heroic, Danitha: "Whenever you cast a spell that targets …"
    if ((m = P.TARGET_WATCH.exec(line))) { effectGaps('both', m[2]); return out; }
    // Massacre Girl, Most Wanted: "Whenever an opponent is dealt noncombat damage, …"
    if ((m = P.DEALT_WATCH.exec(line))) { effectGaps('both', m[1]); return out; }
    // Bloodthirsty Conqueror: "Whenever an opponent loses life, you gain that much life."
    if ((m = P.LOSS_WATCH.exec(line))) { effectGaps('both', m[2].replace(/\bthat much life\b/gi, '1 life')); return out; }
    // Syr Konrad
    if ((m = P.KONRAD.exec(line))) { effectGaps('both', m[1]); return out; }
    // Roshan: "Whenever a permanent you control is turned face up, …" (you turn it up yourself; Opp never does)
    if ((m = /^whenever a permanent you control is turned face up, (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'trigger', 'turned face up (Opp never plays face down)'); return out; }
    // "Whenever a creature / a Dragon / this creature or another Cat you control enters (or attacks
    // or blocks), …". "with defender" needs a keyword it knows; other "with …" words it can't check.
    const watchHead = /you control|under your control/i.test(line.split(',')[0]);
    const withOk = w => !/ with /i.test(w[4]) && (!w[5] || w[6] || B.KEYWORDS.includes(w[5].replace(/^\s*with\s+/i, '').toLowerCase()));
    for (const watch of [P.ENTER_WATCH, P.ATTACK_WATCH, P.BLOCK_WATCH]) {
      if (!(m = watch.exec(line)) || !watchHead || (m[1] && !self(m[1]))) continue;
      if (withOk(m)) effectGaps('both', m[8].replace(/^if you cast it, /i, '')); // The Sibsig Ceremony
      else gap(out, 'both', 'trigger', t.head);
      return out;
    }
    if ((m = /^whenever one or more (.+?) you control attack, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[2].replace(/\bthat many\b/gi, '1')); return out; }
    // "At the beginning of your upkeep / end step / combat on your turn, …"
    if ((m = P.PHASE_TRIGGER.exec(line))) { effectGaps('both', m[3]); return out; }
    if ((m = /^whenever you attack, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // Combat damage to a player
    if ((m = /^whenever (.+?) deals? combat damage to (?:a player|an opponent|one or more players)(?: or battle)?, (?:you may )?(.+)$/i.exec(line))) {
      const who = m[1].toLowerCase();
      const fits = /^one or more (.+?) you control/.test(who) || /^(?:an?|another) (.+?) you control/.test(who) || self(who);
      if (fits) {
        if (P.destroyTheirs(m[2])) return out;
        // Desmond Miles: "surveil X, where X is the amount of damage it dealt to that player"
        effectGaps('both', m[2].replace(/\b(surveil|scry|draw|mill) x(?: cards)?, where x is the amount of damage .+? dealt to that player\b/i, '$1 1'));
        return out;
      }
    }
    // "Whenever another creature dies" (Blood Artist), on any table. Massacre Girl, Known Killer: "if its toughness was less than 1, …"
    if ((m = P.DIES_WATCH.exec(line))) { effectGaps('both', m[6].replace(/^if its toughness was less than \d+, /i, '')); return out; }
    // "Whenever you cast …" (Nightmare Sower: "… during an opponent's turn")
    if ((m = P.CAST_WATCH.exec(line)) && !/\b(first|second)\b/i.test(line)) {
      const e = m[3].trim();
      const p = /^(.+?) gets? ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i.exec(e);
      if ((p && self(p[1])) || PUMP_SENTENCE.test(e)) return out;
      effectGaps('both', e);
      return out;
    }
    if ((m = /^when you cast this spell, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; } // Ugin, Eye of the Storms
    if ((m = /^whenever you gain life( for the first time each turn)?, (?:you may )?(.+)$/i.exec(line))) {
      effectGaps('both', m[2].replace(/\bthat much life\b/gi, '1 life').replace(/\bthat many\b/gi, '1'));
      return out;
    }
    if (/^whenever you(?:'re| are) dealt damage, (?:you may )?put that many ([\w+/-]+) counters? on (.+?)\.?$/i.test(line)) { gap(out, 'opp', 'trigger', 'whenever you\'re dealt damage (Opp\'s)'); return out; }
    if (P.COMBAT_TAP.test(line)) return out;
    if (new RegExp(`^at the beginning of your end step, (?:you may )?mill ${P.COUNT} cards?\\. if you do, return up to ${P.COUNT} (.+?) cards? from your graveyard to your hand\\.?$`, 'i').test(line)) return out;
    gap(out, 'both', 'trigger', t.head);
    return out;
  }

  // ---------- activated abilities ----------

  function activatedLine(card, line, inst) {
    const m = /^([^:"]+):\s*(.+)$/.exec(line);
    if (!m || /^(when|whenever|at|if|as)\b/i.test(m[1])) return null;
    const out = { you: true, opp: true, gaps: [] };
    // Planeswalker loyalty abilities: "+1: …", "−X: …" (you pick X), "0: Add {C}{C}{C}." Opp never casts planeswalkers.
    if (/^[+−-]?(\d+|x)$/i.test(m[1].trim())) {
      notRun(m[2].replace(/\bx\b/gi, '1'), inst).forEach(p => gap(out, 'you', 'loyalty', p));
      gap(out, 'opp', 'loyalty', 'planeswalker loyalty abilities (Opp never casts planeswalkers)');
      return out;
    }
    if (/^add\b/i.test(m[2])) {
      if (is(card, 'land') || G.manaAbility(card.name, line)) return out;
      gap(out, 'both', 'mana', `mana ability: ${m[1]}: ${m[2]}`);
      return out;
    }
    if (/^(equip|crew|cycling|ward)\b/i.test(m[1])) return null; // keyword lines
    const ab = B.activatedAbilities(inst, () => ({ oracle: line }))[0];
    if (!ab) { gap(out, 'both', 'cost', m[1]); return out; }
    const left = notRun(ab.effect, inst);
    left.forEach(p => gap(out, 'you', 'activated', p));
    // Opp uses only "…: Regenerate this" (to save a creature) and its fetch lands (crackFetches).
    const regen = /^regenerate (.+?)\.?$/i.exec(ab.effect.trim());
    const fetch = is(card, 'land') && ab.sacrifice && !ab.discard && !ab.remove && B.searchSpec(P.effectParts(ab.effect)[0]);
    if (!(regen && P.isSelf(regen[1], inst) && !ab.sacrifice) && !fetch) gap(out, 'opp', 'activated', 'activated abilities (Opp never activates them)');
    return out;
  }

  // ---------- always-on (static) lines ----------

  const LORD = /^(other )?(.+?) you control(?: with ([a-z]+(?: [a-z]+)?))? (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+?))?|have (.+?))\.?$/i;

  function staticLine(card, line, inst) {
    const out = { you: true, opp: true, gaps: [] };
    let m;
    // 'Commander creatures you own have "Whenever this creature attacks a player, …"': the ability it gives.
    if ((m = /^(?:other )?(.+?) you (?:control|own) have "(.+)"\.?$/i.exec(line)) && !m[1].includes(':')) {
      const given = { id: 'given', name: 'this creature', typeLine: 'Creature' };
      return triggerLine(card, m[2], given) || activatedLine(card, m[2], given) || staticLine(card, m[2], given);
    }
    // Roshan; recover (Garza's Assassin); Ebondeath from the graveyard; The Darkness Crystal; The Immortal Sun; Rune of Mortality.
    if (/^other creatures you control are \w+ in addition to their other types\./i.test(line) || P.RECOVER.test(line) || P.GRAVE_CAST.test(line)
      || P.CRYSTAL.test(line) || /^players can't activate planeswalkers' loyalty abilities\.?$/i.test(line)) return out;
    if ((m = /^as long as enchanted permanent is an? (creature|equipment), it has (.+?)\.?$/i.exec(line))) {
      const kws = kwOnly(m[2].replace(/^"equipped creature has (.+?)\.?"$/i, '$1'));
      if (!kws.every(k => B.KEYWORDS.includes(k))) gap(out, 'you', 'static', line);
      return out;
    }
    if (/^you may pay (?:\{[^}]+\})+ rather than pay this spell's mana cost\.?$/i.test(line)) { gap(out, 'opp', 'static', 'other cost (Opp pays the mana cost)'); return out; }
    if ((m = LORD.exec(line)) && !m[2].includes(':')) {
      if (m[3] && !B.KEYWORDS.includes(m[3].toLowerCase())) { gap(out, 'both', 'static', line); return out; } // "with power 4 or greater"
      const kws = kwOnly(m[6] || m[7] || '');
      const unknown = kws.filter(k => !B.KEYWORDS.includes(k));
      if (!kws.length || !unknown.length) return out;
      unknown.forEach(k => gap(out, 'both', 'static', `… you control have ${k}`));
      return out;
    }
    if (/^(other )?(.+?) you control can't be blocked except by two or more creatures\.?$/i.test(line)) return out;
    if ((m = /^(.+?) gets ([+-]\d+)\/([+-]\d+) for each (other )?(.+?) you control(?: and each (.+?) cards? in your graveyard)?\.?$/i.exec(line)) && P.isSelf(m[1], inst)) return out;
    if ((m = /^(.+?)['’]s (power and toughness are each|power is|toughness is) equal to the number of (other )?(.+?) you control\.?$/i.exec(line)) && P.isSelf(m[1], inst)) return out;
    if (/^(.+?) your opponents control get ([+-]\d+)\/([+-]\d+)\.?$/i.test(line)) return out;
    if (P.TOUGH_RULE.test(line) || P.DEFENDER_RULE.test(line)) return out; // Arcades, Doran, High Alert
    if (P.SELF_DISCOUNT.test(line)) return out; // The Pride of Hull Clade    if (P.ATTACK_TAX.test(line) || P.NO_GAIN.test(line) || P.ARBORIA.test(line) || P.ATTACK_CAP.test(line) || P.BLOCK_CAP.test(line)) return out;
    if (P.SPELL_TAX.test(line) && !/\btarget/i.test(line)) return out;
    if (P.OLD_MENACE.test(line) || P.UNBLOCKABLE.test(line) || P.CANT.test(line)) return out;
    if (/^this spell can't be countered\.?$/i.test(line)) return out; // Opp doesn't try
    if (G.costReductions(line).length || G.doublesOf(line) || G.choosesType(line)) return out;
    if (Object.keys(G.entersWithCounters(line)).length && !/\bif\b|\bunless\b/i.test(line)) return out;
    if ((m = /^(.+?) enters(?: the battlefield)? with (?:an? ([\w+/-]+) counter on it for each (?:other )?(.+?)|x ([\w+/-]+) counters on it, where x is the number of (?:other )?(.+?)) you control\.?$/i.exec(line)) && P.isSelf(m[1], inst)) return out;
    if (/\benters(?: the battlefield)? tapped\b/i.test(line) && G.entersTapped(card.name, line)) return out;
    if ((m = /^(?:equipped|enchanted) creature (.+?)\.?$/i.exec(line))) {
      const b = B.attachBonus(line);
      const has = /\bhas (.+?)(?:\.|$)/i.exec(m[1]);
      const unknown = has ? kwOnly(has[1]).filter(k => !B.KEYWORDS.includes(k)) : [];
      if (b.pow || b.tou || b.kw.length || b.cantAttack || b.cantBlock || b.noAbilities) {
        unknown.forEach(k => gap(out, 'you', 'static', `equipped/enchanted creature has ${k}`));
        if (line.split(/(?<=\.)\s+/).length > 1) gap(out, 'you', 'static', `${/^equipped/i.test(line) ? 'equipped' : 'enchanted'} creature: ${line.split(/(?<=\.)\s+/).slice(1).join(' ')}`);
      } else gap(out, 'you', 'static', line);
      if (is(card, 'equipment')) gap(out, 'opp', 'keyword', 'equip (Opp never equips)');
      return out;
    }
    gap(out, 'both', 'static', line);
    return out;
  }

  // ---------- instants and sorceries, as a whole ----------

  function spell(card, lines, inst) {
    const out = { you: true, opp: true, gaps: [] };
    const text = lines.join(' ');
    const modes = B.spellModes(inst, () => card);
    if (modes) {
      modes.modes.forEach(mode => {
        if (!mode.split(/(?<=\.)\s+/).every(s => PUMP_SENTENCE.test(s.trim())) && !runs(mode, inst)) gap(out, 'you', 'spell', `modal spell: ${mode}`);
      });
    } else if (/\binstant\b/i.test(front(card.typeLine)) && G.isCounterspell(card.oracle)) {
      if (!/^counter target (?:[a-z ,-]+ )?spell(?: unless its controller pays \{\d+\})?\.?$/i.test(text.trim())) gap(out, 'you', 'spell', `counterspell: ${text}`);
    } else if (!text.split(/(?<=\.)\s+/).every(s => PUMP_SENTENCE.test(s.trim()) && !/\btarget\b/i.test(s)) && !runs(text, inst)) {
      notRun(text, inst).forEach(p => gap(out, 'you', 'spell', p));
      if (!out.gaps.length) gap(out, 'you', 'spell', text);
    }
    return out;
  }

  // Would Opp ever cast this? (castOptions in bot.js.) Returns why not, or ''.
  function oppSkips(card) {
    const type = front(card.typeLine);
    if (/\bland\b/i.test(type)) return '';
    if (/\b(planeswalker|battle)\b/i.test(type)) return 'Opp never casts planeswalkers or battles';
    if (/\baura\b/i.test(type)) return 'Opp never casts auras';
    if (/\{X\}/i.test(card.manaCost || '')) return 'Opp never casts spells with X in the cost';
    if (/\b(instant|sorcery)\b/i.test(type)) return B.parts.facts(card).spell ? '' : 'Opp never casts instants or sorceries it can\'t read';
    if (!/\b(creature|artifact|enchantment)\b/i.test(type)) return `Opp never casts ${type.trim() || 'this'}`;
    return '';
  }

  // ---------- one card ----------

  function check(card) {
    const inst = { id: 'card', name: card.name, typeLine: card.typeLine || '' };
    // Both faces of a two-faced card, each read as the Simulator reads it when that face is up.
    const text = [B.faceOracle(card.oracle, card.name, false), ...(String(card.name).includes(' // ') ? [B.faceOracle(card.oracle, card.name, true)] : [])];
    const lines = [...new Set(text)].join('\n').split('\n').map(P.plainLine).filter(Boolean);
    const isSpell = is(card, 'instant') || is(card, 'sorcery');
    const out = [];
    const spellLines = [];
    for (const text of lines) {
      if (/^•/.test(text) || /^choose (one|two|three|one or more|one or both|any number)\b/i.test(text)) {
        if (isSpell) { spellLines.push(text); continue; }
        // A mode of the trigger above ("Choose one —"): runEffect does it once it's picked.
        if (/^•/.test(text)) {
          const mode = { you: true, opp: true, gaps: [] };
          notRun(text.replace(/^•\s*/, ''), inst).forEach(p => gap(mode, 'both', 'effect', p));
          out.push({ text, ...mode });
          continue;
        }
      }
      const kw = keywordLine(card, text);
      if (kw) { out.push({ text, ...kw }); continue; }
      if (isSpell && !/^(when|whenever|at)\b/i.test(text) && !/^[^:"]+:/.test(text)) { spellLines.push(text); continue; }
      const r = triggerLine(card, text, inst) || activatedLine(card, text, inst) || staticLine(card, text, inst);
      out.push({ text, ...r });
    }
    const skip = oppSkips(card);
    // Opp casts an instant or sorcery only when it can do all of it (facts in bot.js), so then it's all done.
    if (spellLines.length) out.push({ text: spellLines.join('\n'), ...spell(card, spellLines, inst), opp: !skip });
    const sum = side => {
      if (!out.length) return 'all';
      const done = out.filter(l => l[side]).length;
      return done === out.length ? 'all' : done ? 'some' : 'none';
    };
    return { you: sum('you'), opp: skip ? 'never' : sum('opp'), oppSkips: skip, lines: out };
  }

  // A part's wording with the card's name, numbers and mana taken out, so the same wording on
  // different cards counts together.
  function phrase(card, text) {
    const names = [card.name, ...String(card.name).split(' // ')].flatMap(n => [n, n.split(',')[0]]).filter(n => n && n.length > 2);
    let t = String(text);
    for (const n of [...new Set(names)].sort((a, b) => b.length - a.length)) t = t.split(n).join('CARDNAME');
    return t.replace(/\{[^}]+\}/g, '{M}').replace(/[+−-]?\b\d+\b/g, 'N').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, 'N')
      .replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  }

  return { check, phrase, oppSkips };
})();

if (typeof module !== 'undefined') module.exports = Coverage;
