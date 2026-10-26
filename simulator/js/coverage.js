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
    oppsExileGreatest: noop, exileGrave: noop, oppsHandPick: noop, oppsDraw: noop, oppsDiscard: noop, exileTop: noop, sacToPlay: noop, flicker: noop, blocked: {},
    dead: {}, choose: noop, chooseModes: noop, made: ['token'] }); // dead: the creature a "dies" trigger is about (Avacyn's "return that card"); made: a token just created
  const runs = (text, inst) => P.canRunAll(text, ctxFor(inst));
  // The parts of an effect runEffect can't do.
  // (X filled in first, as runEffect does: Shimmercreep's "each opponent loses X life and you gain X life, where X is …")
  const notRun = (text, inst) => P.effectParts(P.fillWhereX(P.settleIfYouDo(text, null), null, null, ctxFor(inst))).filter(p => !P.canRunAll(p, ctxFor(inst)));

  // Words that don't change the game once you're playing (or that you just follow, like flash).
  const NOTHING_TO_DO = ['partner', 'partner with', 'friends forever', 'choose a background', 'doctor\'s companion', 'flash', 'enchant',
    'changeling', 'devoid']; // changeling: every creature type (bot.js's isA reads it); devoid: colorless (the card's colors say so)
  // Done for you when you cast it (app.js asks), but Opp never uses them.
  const YOURS_ONLY = ['offspring', 'freerunning', 'madness', 'cycling', 'transmute', 'aftermath', 'ninjutsu', 'flashback', 'harmonize', 'dredge',
    'impending', 'bestow', 'mutate', 'morph', 'megamorph', 'suspend', 'basic landcycling',
    'plainscycling', 'islandcycling', 'swampcycling', 'mountaincycling', 'forestcycling', 'kicker', 'gift', 'improvise', 'evoke', 'convoke', 'overload', 'foretell', 'squad', 'fuse', 'blitz', 'dash'];
  // Done on every table (bot.js).
  const DONE_KEYWORDS = ['extort', 'vanishing', 'hideaway', 'affinity', 'living weapon', 'read ahead', 'rebound', 'encore', 'unearth', 'ascend', 'echo', 'compleated', 'backup', 'delve', 'demonstrate', 'eternalize', 'evolve', 'riot',
    'miracle', 'undaunted', 'soulbond', 'embalm', 'afflict', 'station', 'sunburst', 'retrace', 'ravenous']; // ravenous: enterTrigger // retrace: graveDiscards // station: activatedAbilities, byLevel; sunburst: enterTrigger // embalm: graveAbilities; afflict: becameBlocked's afflictOf // soulbond: staticExtra's soulMate (paired for you) // miracle: opponentActed's draw, app.js's castCost; undaunted: selfDiscount

  // ---------- one keyword line ----------

  function keywordLine(card, line) {
    const parts = line.toLowerCase().replace(/\.$/, '').split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const starts = (p, k) => p === k || p.startsWith(k + ' ') || p.startsWith(k + '—');
    const known = p => P.isKeyword(p, B.KEYWORDS) || P.isKeyword(p, P.OTHER_KEYWORDS) || YOURS_ONLY.some(k => starts(p, k)) || DONE_KEYWORDS.some(k => starts(p, k)) || NOTHING_TO_DO.some(k => starts(p, k));
    if (!parts.length || !parts.every(known)) return null;
    const out = { you: true, opp: true, gaps: [] };
    for (const p of parts) {
      const name = p.split(/[\s—{]/)[0];
      if (NOTHING_TO_DO.some(k => starts(p, k)) || DONE_KEYWORDS.some(k => starts(p, k))) continue;
      const mine = YOURS_ONLY.find(k => starts(p, k));
      if (mine) { gap(out, 'opp', 'keyword', `${mine} (Opp never uses it)`); continue; }
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
    // Amounts runEffect works out itself ("… for each creature destroyed this way", "X creature cards, where X is …").
    if (/for each|equal to|\bx\b/i.test(p)) return !P.enteredElsewhere(p) && runs(p, inst);
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
    return P.isSelf(p[1], inst) || /^(other )?(.+?) you control$/i.test(p[1]) || /^(other )?attacking (modified )?creatures$/i.test(p[1]); // Namor, Firebird
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

    // The Commander precons' triggers (bot.js): done as they are, or the effect after them runs.
    const DONE = [
      /^at the beginning of combat on each opponent's turn, they may pay \{\d+\}\. if they don't, creatures they control can't attack jaces you control this turn\.?$/i, // Jace (Opp leaves Jaces alone)
      /^whenever one or more creatures deal combat damage to you while you're the monarch, tap those creatures and put a stun counter on each of them\.?$/i, // Tamiyo
      /^whenever you discard a card, (?:you may )?exile that card from your graveyard\.?$/i, // Currency Converter
      /^whenever an? \w+ you control becomes the target of a spell or ability an opponent controls, .+? deals \d+ damage to that player\.?$/i, // Thunderbreak Regent
      /^whenever a goaded creature attacks, it deals \d+ damage to its controller\.?$/i, // Vengeful Ancestor
      /^whenever a land you control enters tapped, choose one\s*[—-]?$/i, // Tiller Engine (its modes are read below)
      /^whenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you\.?$/i, // Firemane Commando (only you attack it here)
      /^whenever you tap a permanent for \{C\}, add an additional \{C\}\.?$/i, // Forsaken Monument (game.js's sourceOf)
      /^when there are \w+ or more [\w+/-]+ counters on (?:this \w+|it), exile it\. if you do, you gain \w+ life\.?$/i, // Mazemind Tome (refreshGrants)
      /^when this artifact enters during the declare attackers step, you may reselect which player or permanent target attacking creature is attacking\.?$/i, // Misleading Signpost (one opponent here)
    ];
    if (DONE.some(re => re.test(line)) || P.DOVESCAPE.test(line)) return out; // Dovescape (bot.js's doveCounter)
    if (P.ERESTOR.test(line) || P.UNITY.test(line)) return out; // Erestor of the Council, Model of Unity (bot.js's votingDone)
    if (P.CHAMPIONS.test(line)) return out; // Champions of Minas Tirith (bot.js's tableRules: handTax)
    if (P.MONARCH_DRAW.test(line) || P.FORTH.test(line) || P.HARSH.test(line)) return out;
    if (P.NABBER.test(line)) return out; // Treasure Nabber (bot.js's manaTapped, refreshGrants, returnLent)
    if (P.URN.test(line)) return out; // Colfenor's Urn (bot.js's cardMoved)
    if (P.BIBLIOPHILE.test(line)) return out; // Voracious Bibliophile (bot.js's spellCast)
    if ((m = P.AINOK.exec(line))) { effectGaps('both', m[1]); return out; } // Ainok Strike Leader (bot.js's attackWatch)
    // Crawling Sensation, Kishla Skimmer, River Kelpie, Colossal Grave-Reaver (bot.js's graveWatch)
    if ((m = P.LAND_TO_GRAVE.exec(line) || P.LEAVE_GRAVE.exec(line) || P.KELPIE.exec(line))) { effectGaps('both', m[1]); return out; }
    if (P.REAVER.test(line)) return out;
    if ((m = P.KELPIE_CAST.exec(line))) { effectGaps('both', m[1]); return out; } // River Kelpie (bot.js's spellCast)
    if ((m = /^when (?:this creature|.+?) becomes monstrous, (.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; } // Stormbreath Dragon (bot.js's monstrosity) // Archivist of Gondor (monarchExtra), Forth Eorlingas! (spellCast), Harsh Mentor (abilityActivated)
    if ((m = P.PREVENT_GROW.exec(line)) && self(m[2])) return out; // Selfless Squire (bot.js's damagePrevented)
    if ((m = P.SCRY_GROW.exec(line)) && self(m[1])) return out; // Celeborn the Wise (bot.js's applyScry)
    if ((m = P.TOKEN_WATCH.exec(line))) { effectGaps('both', m[1]); return out; } // Rosie Cotton, Mirkwood Bats (creatureEntered, sacrificed)
    const THEN = [
      /^whenever you create one or more creature tokens, (?:you may )?(.+)$/i, // Staff of the Storyteller
      /^whenever you cast your (?:first|second|third|fourth|fifth) (?:[\w,]+ )*?spell each turn, (?:you may )?(.+)$/i, // Plan for All Outcomes, The Fantasticar, Lady Loki
      /^whenever an opponent casts their (?:first|second|third) (?:\w+ )*?spell each turn, (?:you may )?(?!draw a card unless that player pays)(.+)$/i, // Monologue Tax, Mind's Dilation (Esper Sentinel: TAX_WATCH)
      P.ROLL_WATCH, // Vrondiss, Barbarian Class
      P.SEARCH_WATCH, // Archivist of Oghma (refreshGrants)
      /^whenever an opponent casts (?:an? )?(?:(?!first|second)[^,])*?\s*spell(?: during your turn)?, (?:you may )?((?:(?!\bunless\b).)+)$/i, // Taurean Mauler, Arasta, Witchstalker
      /^whenever a player casts (?:an? )?[^,]*?spell, (?:you may )?(.+)$/i, // Managorger Hydra
      /^whenever an opponent draws a card, (?!that player may pay)(?:you may (?=draw ))?(.+)$/i, // Scrawling Crawler, Mind's Eye, Consecrated Sphinx
      /^whenever you draw (?:a card|your second card each turn), (?:you may )?(.+)$/i, // Psychosis Crawler, Thopter Fabricator
      /^whenever an opponent draws (?:their|his or her) second card each turn, (?:you may )?(.+)$/i,
      /^whenever a creature attacks you(?: or a planeswalker you control)?, (?:you may )?(.+)$/i, // Search the Premises, Marchesa's Decree
      /^whenever you attack with \w+ or more creatures, (?:you may )?(.+)$/i, // Firemane Commando
      /^whenever your commander (?:enters or )?attacks, (?:you may )?(.+)$/i, // Tome of Legends
      /^whenever you put one or more [\w+/-]+ counters on .+?, (?:you may )?(.+?)(?:\. this ability triggers only once each turn)?\.?$/i, // Exemplar of Light
      /^whenever one or more [\w+/-]+ counters are put on (?:a|another) .+? you control, (?:you may )?(.+)$/i,
      /^whenever a land an opponent controls enters, (?:if that player controls more lands than you, )?(?:you may )?(.+)$/i, // Archaeomancer's Map (landEntered)
      /^whenever another (?:nontoken )?creature enters, (?:you may )?(?!its controller may draw a card if its power)(.+)$/i, // Soul Warden, Bramble Sovereign (creatureEntered, any table; Selvala below)
      /^whenever one or more cards are put into exile from your library and\/or your graveyard, (?:you may )?(.+)$/i, // Laelia (cardMoved)
      /^when this creature enters and whenever one or more creature tokens you control deal combat damage to a player, (?:you may )?(.+)$/i, // Inspired Skypainter (enterEffects, hitTrigger)
      // Wickersmith's Tools, Flourishing Defenses; Auntie Ool (her "draw a card if you control that creature …", countersPut)
      /^whenever (?:one or more [\w+/-]+ counters are|an? [\w+/-]+ counter is) put on a creature, (?:you may )?(?!draw a card if you control that creature\. )(.+)$/i,
      /^whenever one or more [\w+/-]+ counters are put on a creature, (draw a card) if you control that creature\. if you don't control it, its controller loses \w+ life\.?$/i,
      /^when enchanted creature dies, (?:you may )?(.+)$/i, // Angelic Destiny
      /^when(?:ever)? .+? dies or is put into exile from the battlefield, (?:you may )?(.+)$/i, // God-Eternal Bontu
      /^when(?:ever)? (?:this land|.+?) enters untapped, (?:you may )?(.+)$/i, // Witch's Cottage
      /^whenever a source you control deals \w+ or more damage to a player, (?:you may )?(.+)$/i, // Dragonborn Champion
      /^whenever an opponent draws a card except the first one they draw in each of their draw steps, (?:you may )?(.+)$/i, // Xyris
      /^whenever you cast a spell with \{x\} in its mana cost, (?:you may )?(.+)$/i, // Zaxara
    ];
    for (const re of THEN) {
      if ((m = re.exec(line))) { effectGaps('both', m[1].replace(/\bX\b/g, '1').replace(/\bthat much damage\b/gi, '1 damage').replace(/\bthat many\b/gi, '1')); return out; } // Simic Ascendancy: "that many" (countersPut) // Casey Jones: "that much" (countersPut)
    }
    // Primeval Spawn: "When this creature leaves the battlefield, …"
    if ((m = /^when (.+?) leaves the battlefield, (?:you may )?(.+)$/i.exec(line)) && self(m[1])) { effectGaps('both', m[2]); return out; }
    // Shark Typhoon, Decree of Savagery: "When you cycle this card, …" (X is what you paid; Gempalm Incinerator's X is counted)
    if ((m = /^when you cycle (?:this card|.+?), (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', /\bwhere x is\b/i.test(m[1]) ? m[1] : m[1].replace(/\bX\b/g, '1')); gap(out, 'opp', 'trigger', 'when you cycle (Opp never cycles)'); return out; }
    // Equipment: "Whenever equipped creature attacks / deals combat damage / dies, …" (Sword of Hours, Heirloom Blade)
    if ((m = /^whenever equipped creature (?:attacks|deals combat damage|dies), (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'keyword', 'equip (Opp never equips)'); return out; }
    // Songbirds' Blessing: an aura's "Whenever enchanted creature attacks, …" (attachBonus makes it the creature's own).
    if ((m = /^whenever (?:enchanted|equipped) creature (?:attacks|deals combat damage(?: to a player)?|dies), (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'keyword', 'aura (Opp never casts auras)'); return out; }
    // Maddening Hex (on an opponent)
    if ((m = /^whenever enchanted player casts a noncreature spell, (.+)$/i.exec(line))) { effectGaps('you', m[1]); return out; }
    // Illuna, Nethroi: "Whenever this creature mutates, …" (Opp never mutates)
    if ((m = /^whenever this creature mutates, (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'trigger', 'mutate (Opp never mutates)'); return out; }

    // "When this enters (or attacks), …"
    if ((m = /^when(?:ever)? (.+?) enters(?: the battlefield)?(?: or ([^,]+))?, (?:you may )?(.+)$/i.exec(line)) && self(m[1])) {
      const text = P.settleIfYouDo(m[3], null);
      if (/\bif you do\b/i.test(text)) { gap(out, 'both', 'effect', m[3]); return out; }
      const parts = P.effectParts(P.fillWhereX(text, null, null, ctxFor(inst))); // Shimmercreep's "loses X life …, where X is …"
      const first = text.trim().split(/(?<=\.)\s+/)[0];
      if (COUNTER_EACH.test(first)) { if (!combatEffect(text, inst)) gap(out, 'both', 'effect', text); return out; }
      for (const part of parts) if (!enterPart(part, may, inst)) gap(out, 'both', 'effect', part);
      return out;
    }
    // "When this dies, …" (Unstoppable Slasher: "if it had no counters on it, return it to the battlefield …")
    if ((m = /^when(?:ever)? (.+?) (?:dies|is put into (?:a|your) graveyard from (?:the battlefield|play)), (?:you may )?(.+)$/i.exec(line)) && self(m[1])) {
      if (P.TOKEN_TEXT.test(m[2].trim()) || P.RETURN_STUNNED.test(m[2].trim())) return out;
      // Oft-Nabbed Goat (bot.js's died)
      if (/^if it had one or more [\w+/-]+ counters on it, its owner draws that many cards and each other player loses that much life\.?$/i.test(m[2].trim())) return out;
      effectGaps('both', m[2].replace(/\bequal to its power\b/i, 'equal to 1') // Goldvein, Lifeblood Hydra (died fills it in)
        .replace(/^if it had no [\w+/-]+ counters on it, (?:you may )?/i, '')); // Lost Auramancers (died)
      return out;
    }
    // "Whenever this attacks / blocks, …", "Whenever this creature attacks a player, …", "… for the first time each turn", "… while you don't control another Dinosaur"
    if ((m = /^when(?:ever)? (.+?) (enters(?: the battlefield)? or attacks|attacks or blocks|attacks or becomes the target of a spell|attacks|blocks)( a player)?(?: a creature)?(?: for the first time each turn)?(?: while (.+?))?, (.+)$/i.exec(P.moreLifeAttack(line))) && self(m[1])) { // Namor's "attacks a player who has more life than you"
      if (m[4] && P.condition(null, m[4]) === null) gap(out, 'both', 'trigger', `attacks while ${m[4]}`);
      if (!combatEffect(m[5], inst)) gap(out, 'both', 'effect', m[5]);
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
    // Frontline Heroism: "… then copy that spell. The copy targets that token." (bot.js's spellTargeted does the copy)
    if ((m = P.TARGET_WATCH.exec(line))) { effectGaps('both', m[2].replace(/, then copy that spell\. the copy targets that token\.?$/i, '')); return out; }
    // Massacre Girl, Most Wanted: "Whenever an opponent is dealt noncombat damage, …"
    if ((m = P.DEALT_WATCH.exec(line))) { effectGaps('both', m[1]); return out; }
    // Bloodthirsty Conqueror: "Whenever an opponent loses life, you gain that much life."
    if ((m = P.LOSS_WATCH.exec(line))) { effectGaps('both', m[2].replace(/\bthat much life\b/gi, '1 life')); return out; }
    // Rhystic Study, Smothering Tithe: "… unless that player pays {1}"
    if (P.TAX_WATCH.some(re => re.test(line))) return out;
    // Flumph: "Whenever this creature is dealt damage, …"
    if ((m = /^whenever (.+?) is dealt damage(?: for the first time each turn)?, (?:you may )?(.+)$/i.exec(line)) && self(m[1])) { effectGaps('both', m[2].replace(/\bthat (?:much|many)\b/gi, '1')); return out; } // Metropolis Reformer: "you gain that much life"; Hercules
    // The Marvel precons.
    // Shang-Chi: "When the tenth +1/+1 counter is put on Shang-Chi, …" (countersPut)
    if ((m = /^when the (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) [\w+/-]+ counter is put on (.+?), (.+)$/i.exec(line)) && self(m[1])) { effectGaps('both', m[2]); return out; }
    // Love on the Battlefield (attackWatch)
    if ((m = /^whenever you attack with exactly \w+ creatures, those creatures gain (.+?) until end of turn(?:, then (.+?))?(?:\. whenever either of those creatures deals combat damage to a player this combat, (.+?))?\.?$/i.exec(line))) {
      effectGaps('both', [m[2], m[3]].filter(Boolean).join('. '));
      return out;
    }
    // Captain America, Living Legend (vigilance on your turn, staticExtra); She-Hulk (becameBlocked).
    if (P.CAP_UNTAP.test(line) || P.BLOCKED_GROW.test(line) || P.BLOCKED_PUMP.test(line)) return out; // Somberwald Alpha (becameBlocked)
    // Szarel, Evendo Brushrazer, Scouring Swarm, Baloth Prime (sacrificed); Centaur Vinecrasher, The Gitrog Monster, Eumidian Hatchery (graveWatch)
    if ((m = P.SAC_WATCH.exec(line)) && !/\. the token gains haste until end of turn\. at the beginning of your next end step, sacrifice it unless you pay/i.test(line)) { effectGaps('both', m[5]); return out; } // (Ashling's: below)
    if (P.VINECRASHER.test(line)) return out;
    if ((m = /^whenever one or more land cards are put into your graveyard from anywhere, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    if ((m = /^when this land is put into a graveyard from the battlefield, (.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // Bloomburrow: expend (manaSpent), gifts (giftGiven), Bloodroot Apothecary (sacrificed), Rapid Augmenter (creatureEntered), Pollywog Prodigy (opponentActed)
    if ((m = P.EXPEND.exec(line))) { effectGaps('both', m[2]); return out; }
    if ((m = /^whenever you give a gift, (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'trigger', 'gifts (Opp never promises one)'); return out; }
    if (P.OPP_SAC_POISON.test(line)) return out;
    if (/^whenever another creature you control with base power \d+ enters, it gains .+ until end of turn\.?$/i.test(line)) return out;
    if ((m = /^whenever an opponent casts an? \w+ spell with mana value less than (?:this creature's|its) power, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // Tenuous Truce: the enchanted opponent's end step (both draw), and it goes when either of you attacks the other (tenuousTruce)
    if (/^at the beginning of enchanted opponent's end step, you and that player each draw a card\.?$/i.test(line) || /^when you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, sacrifice this aura\.?$/i.test(line)) return out;
    // Darksteel Reactor (refreshGrants)
    if (/^when (?:this \w+|.+?) has \w+ or more [\w+/-]+ counters on it, you win the game\.?$/i.test(line)) return out;
    // Patrolling Peacemaker (spellTargeted)
    if ((m = P.CRIME.exec(line))) { effectGaps('both', m[1]); return out; }
    // Kilo: "Whenever Kilo becomes tapped, …" (tappedWatch; attacking: plainLine)
    if ((m = /^whenever (.+?) becomes tapped, (?:you may )?(.+)$/i.exec(line)) && self(m[1])) { effectGaps('both', m[2]); return out; }
    // Resourceful Defense (graveWatch)
    if (P.DEFENSE.test(line)) return out;
    // Lazotep Chancellor, Hashaton (discardWatch); Wizened Mentor (abilityActivated)
    if (P.DISCARD_PAY.test(line)) return out;
    if ((m = P.MENTOR.exec(line))) { effectGaps('both', m[1]); return out; }
    // Aetherworks Marvel (graveWatch)
    if ((m = P.MARVEL.exec(line))) { effectGaps('both', m[1]); return out; }
    // Silverfur Partisan (spellTargeted)
    if ((m = P.SILVERFUR.exec(line))) { effectGaps('both', m[2]); return out; }
    // Jocasta: back from the graveyard attacking with your commander (declareAttack).
    if (/^whenever you attack with your commander, if this card is in your graveyard, (?:you may )?return it to the battlefield tapped and attacking\.?$/i.test(line)) return out;
    // Witherbloom Pestilence: Morbid Opportunist, Nether Traitor (afterDeath); sacrifice watchers (sacrificed).
    if (/^whenever one or more other creatures die, draw a card\. this ability triggers only once each turn\.?$/i.test(line)) return out;
    if (/^whenever another creature is put into your graveyard from the battlefield, you may pay (?:\{[^}]+\})+\. if you do, return this card from your graveyard to the battlefield\.?$/i.test(line)) return out;
    if ((m = /^whenever (?:a player sacrifices (?:another )?(?:a )?\w+|you sacrifice an? \w+), (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // Doom Prevails: discard watchers (discardWatch), Klaw (cardMoved), Archnemesis (attackWatch; one opponent, always enchanted),
    // Puppet Master (goaded creatures attack the one who goaded them in a two-player game: never your opponents).
    if (/^whenever you discard a card, you may exile that card from your graveyard\. if you do, (?:you may play that card this turn|until the end of your next turn, you may play that card)\.?$/i.test(line)) return out;
    if (/^whenever you discard one or more land cards, each opponent loses \w+ life\.?$/i.test(line)) return out;
    // Ashling: the token copy of a sacrificed nontoken Elemental (sacrificed; its end-step payment: runAtEnd)
    if (/^whenever you sacrifice a nontoken \w+, create a token that's a copy of it\. the token gains haste until end of turn\. at the beginning of your next end step, sacrifice it unless you pay (?:\{[^}]+\})+\.?$/i.test(line)) return out;
    // Nev, Zimone, Owlin Spiralmancer, Lattice Library: "whenever you cast your first spell with {X} in its mana cost each turn, …" (spellCast; X: the spell's)
    if ((m = /^(?:when (?:this \w+|.+?) enters and )?whenever you cast your (?:first|second|third) spell with \{x\} in its mana cost each turn, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1].replace(/\bX\b/g, '1')); return out; }
    // Tomik, Mangara (attackWatch: the defending player's), Combat Calligrapher (attackWatch), Breena (never, with one opponent).
    if ((m = /^whenever an opponent attacks with creatures, if \w+ or more of those creatures are attacking you and\/or planeswalkers you control, (.+)$/i.exec(line))) { effectGaps('both', m[1].replace(/\bthat opponent loses\b/i, 'each opponent loses')); return out; }
    if ((m = /^whenever a player attacks one of your opponents, that attacking player creates an? tapped (.+? creature tokens?(?: with [a-z, ]+?)?) that's attacking that opponent\.?$/i.exec(line))) { effectGaps('both', `create a ${m[1]} that's tapped and attacking`); return out; }
    if (/^whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, /i.test(line)) return out;
    // Unbound Flourishing: X doubled, the {X} instant or sorcery copied (spellCast); abilities aren't copied.
    if (P.UNBOUND_DOUBLE.test(line)) return out;
    if (P.UNBOUND_COPY.test(line)) { gap(out, 'opp', 'trigger', 'copies of Opp\'s spells'); return out; }
    // Cleric Class: "When this Class becomes level 3, …" (bot.js's "level N")
    if ((m = /^when this class becomes level \d+, (.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'activated', 'class levels (Opp never levels up)'); return out; }
    // Mirari's Wake, Vorinclex: land mana doubled; the opponent's tapped lands stay tapped (game.js's sourceOf, autoPay)
    if (/^whenever you tap a land for mana, add one mana of any type that land produced\.?$/i.test(line)) return out;
    if (/^whenever an opponent taps a land for mana, that land doesn't untap during its controller's next untap step\.?$/i.test(line)) return out;
    // Suture Priest (creatureEntered)
    if (/^whenever a creature an opponent controls enters, (?:you may )?have that player lose \w+ life\.?$/i.test(line)) return out;
    if ((m = /^whenever a creature an opponent controls enters, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; } // Authority of the Consuls
    // Selvala (creatureEntered), Fertile Ground (game.js's sourceOf)
    if (/^whenever another creature enters, its controller may draw a card if its power is greater than each other creature's power\.?$/i.test(line)) return out;
    if (/^whenever enchanted land is tapped for mana, its controller adds an additional one mana of any colou?r\.?$/i.test(line)) return out;
    // Wild Growth, Utopia Sprawl (game.js's auraMana)
    if (/^whenever enchanted (?:land|forest) is tapped for mana, its controller adds an additional (?:\{[WUBRGC]\}|one mana of the chosen colou?r)\.?$/i.test(line)) return out;
    // Mirrorwing Dragon (spellTargeted: the spell's effect on each of the caster's other creatures)
    if (/^whenever a player casts an instant or sorcery spell that targets only (?:this creature|.+?), that player copies that spell for each other creature they control that the spell could target\. each copy targets a different one of those creatures\.?$/i.test(line)) return out;
    if (/^whenever you discard one or more nonland cards, you may exile one of them from your graveyard\. if you do, you may cast it this turn\.?$/i.test(line)) return out; // Conspiracy Theorist
    if ((m = /^whenever you cycle or discard (?:another|a) card, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; } // Archfiend of Ifnir (discardWatch)
    if ((m = /^whenever (?:you play a card from exile|you attack enchanted player), (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    if (/^whenever a player attacks you, you may attach this aura to that player\.?$/i.test(line)) return out;
    if (/^whenever one or more goaded creatures deal combat damage to one of your opponents, /i.test(line)) return out;
    // Galvanic Iteration (an effect line of the spell; spellCast copies the next one).
    if (/^when you next cast an instant or sorcery spell this turn, copy that spell\. you may choose new targets for the copy\.?$/i.test(line)) return out;
    // Ancestral Communion (spellCast); Coveted Jewel (jewelSteal, after blocks).
    if (/^when you cast this spell while you control your commander, copy this spell\b/i.test(line)) return out;
    if (/^whenever one or more creatures an opponent controls attack you and aren't blocked, that player draws \w+ cards? and gains control of this artifact\. untap it\.?$/i.test(line)) return out;
    // Wakanda Forever: Everett K. Ross, Storm (attackedBy); M'Baku (declareAttack); The Spear of Bashenga (attachBonus);
    // Ingenious Smith, Tocasia's Welcome (creatureEntered).
    if ((m = /^whenever an opponent attacks you with \w+ or more creatures, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    if (/^whenever a creature with \w+ attacks you, .+? deals damage equal to (?:his|her|its) power to that creature\.?$/i.test(line)) return out;
    if (/^whenever a creature attacks one of your opponents, if that player is the monarch, that creature gets [+-]\d+\/[+-]\d+(?: and gains .+?)? until end of turn\.?$/i.test(line)) return out;
    if ((m = /^whenever equipped creature attacks the monarch, (.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'keyword', 'equip (Opp never equips)'); return out; }
    if ((m = /^whenever one or more (?:other )?\w+ you control(?: with (?:mana value|power) \d+ or less)? enter, (?:you may )?(.+?)(?:\.\s*this ability triggers only once each turn)?\.?$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // The Lord of the Rings precons (bot.js's attackWatch): Mirkwood Trapper, Frontier Warmonger, Frontline Medic's battalion.
    if (P.MIRKWOOD.test(line) || P.WARMONGER.test(line) || P.NOT_ATTACKING_YOU.test(line)) return out;
    if ((m = P.BATTALION.exec(line)) && self(m[1])) { effectGaps('both', m[3]); return out; }
    // Nakia (creatureEntered), W'Kabi (attackWatch).
    if ((m = /^whenever (?:your commander enters(?: or attacks)?|you attack with your commander), (?:you may )?(.+)$/i.exec(line)) && !/if this card is in your graveyard/i.test(m[1])) { effectGaps('both', m[1]); return out; }
    // Quintorius (cardMoved); Ultron, Iron Monger (connived).
    if ((m = /^whenever (?:one or more cards leave your graveyard|a creature you control connives), (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // Folk Hero's commanders (spellCast).
    if ((m = P.SHARES_TYPE.exec(line))) { effectGaps('both', m[1]); return out; }
    // Syr Konrad
    if ((m = P.KONRAD.exec(line))) { effectGaps('both', m[1]); return out; }
    // Roshan: "Whenever a permanent you control is turned face up, …" (you turn it up yourself; Opp never does)
    if ((m = /^whenever a permanent you control is turned face up, (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', m[1]); gap(out, 'opp', 'trigger', 'turned face up (Opp never plays face down)'); return out; }
    // "Whenever a creature / a Dragon / this creature or another Cat you control enters (or attacks
    // or blocks), …". "with defender" needs a keyword it knows; other "with …" words it can't check.
    // Noxious Ghoul: "Whenever this creature or another Zombie enters" (bot.js reads it for its own side).
    const watchHead = /you control|under your control/i.test(line.split(',')[0]) || /^whenever this creature or another \w+ enters,/i.test(line);
    const withOk = w => !/ with /i.test(w[4]) && (!w[5] || w[6] || /mana value/i.test(w[5]) || B.KEYWORDS.includes(w[5].replace(/^\s*with\s+/i, '').toLowerCase()));
    // Thornbite Staff, Hero's Blade ("Whenever a legendary creature you control enters, you may attach this Equipment to it.")
    if (/^whenever an? (.+?) enters, (?:you may )?attach this (?:equipment|aura) to (?:it|that creature)\.?$/i.test(line)) return out; // Shielded by Faith too
    for (const watch of [P.ENTER_WATCH, P.ATTACK_WATCH, P.BLOCK_WATCH]) {
      if (!(m = watch.exec(line)) || !watchHead || (m[1] && !self(m[1]))) continue;
      if (withOk(m)) effectGaps('both', m[8].replace(/^if you cast it, /i, '')); // The Sibsig Ceremony
      else gap(out, 'both', 'trigger', t.head);
      return out;
    }
    if ((m = /^whenever one or more (.+?) you control attack, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[2].replace(/\bthat many\b/gi, '1')); return out; }
    // Ashcoat: "At the beginning of your end step, you may mill four cards. If you do, return up to two …"
    if (new RegExp(`^at the beginning of your end step, (?:you may )?mill ${P.COUNT} cards?\\. if you do, return up to ${P.COUNT} (.+?) cards? from your graveyard to your hand\\.?$`, 'i').test(line)) return out;
    // "At the beginning of your upkeep / end step / combat on your turn, …" (Rat King, Verminister: "if a permanent left the battlefield …")
    if ((m = P.PHASE_TRIGGER.exec(line))) { effectGaps('both', m[3].replace(/^if a permanent left the battlefield under your control this turn, /i, '')); return out; }
    // Rat King, Pale Piper: "Whenever Rat King or another nontoken creature you control leaves the battlefield, …"
    if ((m = P.LEAVES_WATCH.exec(line))) { effectGaps('both', m[6]); return out; }
    // Crackdown Construct: "Whenever you activate an ability of an artifact or creature …" (Opp never activates abilities)
    if ((m = P.ACTIVATE_WATCH.exec(line))) { effectGaps('you', m[2]); gap(out, 'opp', 'trigger', 'whenever you activate an ability (Opp never activates them)'); return out; }
    // Thornbite Staff: "Whenever a Shaman creature enters, you may attach this Equipment to it."
    if (/^whenever an? (.+?) enters, (?:you may )?attach this (?:equipment|aura) to (?:it|that creature)\.?$/i.test(line)) return out; // Shielded by Faith too
    if ((m = /^whenever you attack, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // Combat damage to a player
    if ((m = /^whenever (.+?) deals? (?:combat )?damage to (?:a player|an opponent|one or more players)(?: or battle)?, (?:you may )?(.+)$/i.exec(line))) { // Goblin Lackey: "deals damage to a player"
      const who = m[1].toLowerCase();
      const fits = /^one or more (.+?) you control/.test(who) || /^(?:an?|another) (.+?) you control/.test(who) || self(who) || who === 'your commander';
      if (fits) {
        if (P.destroyTheirs(m[2])) return out;
        // Desmond Miles: "surveil X, where X is the amount of damage it dealt to that player"
        effectGaps('both', m[2].replace(/\b(surveil|scry|draw|mill) x(?: cards)?, where x is the amount of damage .+? dealt to that player\b/i, '$1 1').replace(/\bthat many\b/gi, '1') // Glint-Eye, Xyris: "draw that many cards"
          .replace(/ with mana value x or less (.+?), where x is the amount of damage .+? dealt to that player\.?$/i, ' with mana value 1 or less $1') // Venerable Warsinger (hitTrigger)
          .replace(/\bequal to the damage dealt\b/i, 'equal to 1') // Primo (hitTrigger)
          .replace(/\bwith mana value less than or equal to that damage\b/i, 'with mana value 1 or less')); // Broodcaller Scourge (hitTrigger)
        return out;
      }
    }
    // "Whenever another creature dies" (Blood Artist), on any table. Massacre Girl, Known Killer: "if its toughness was less than 1, …"
    // Boggart Shenanigans: "Whenever another Goblin you control is put into a graveyard from the battlefield, …" (the same as dying)
    if ((m = P.DIES_WATCH.exec(line.replace(/ is put into a graveyard from the battlefield, /i, " dies, ")))) { effectGaps('both', m[6].replace(/^if its toughness was less than \d+, /i, '').replace(/^if it had an? [\w+/-]+ counter on it, /i, '')); return out; } // Blowfly Infestation
    // "Whenever you cast …" (Nightmare Sower: "… during an opponent's turn")
    if ((m = P.CAST_WATCH.exec(line.replace(/ with mana value \d+ or greater(?=,| from your hand,)/i, '').replace(/ from your hand(?=,)/i, '').replace(/^whenever you cast a spell that's one or more colors, /i, 'whenever you cast a colored spell, '))) && !/\b(first|second)\b/i.test(line.replace(/\bthe second time this ability has resolved\b/i, ''))) { // (Ms. Bumbleflower's "the second time …" is its effect's) Zuri: "… with mana value 4 or greater"; Dirgur Focusmage: "… from your hand"
      const e = m[4].trim().replace(/\+X\/\+0 until end of turn, where X is that spell's mana value/i, '+1/+0 until end of turn') // Renegade Bull (spellCast)
        .replace(/\bwith mana value less than or equal to that spell's mana value\b/i, 'with mana value 1 or less') // Hammerhead Tyrant (spellCast)
        .replace(/\bwhere x is the amount of mana spent to cast that spell\b/i, "where X is that spell's mana value") // Manaform Hellkite
        .replace(/\bX\b(.*?),? where X is that spell's mana value/i, '1$1'); // Deekah (spellCast)
      const p = /^(.+?) gets? ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i.exec(e);
      if ((p && self(p[1])) || PUMP_SENTENCE.test(e)) return out;
      effectGaps('both', e);
      return out;
    }
    if ((m = /^when you cast this spell, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; } // Ugin, Eye of the Storms
    if ((m = /^whenever you gain life( for the first time each turn)?, (?:you may )?(.+)$/i.exec(line))) {
      effectGaps('both', P.gainFill(m[2], 1));
      return out;
    }
    // Odds and Ends: Marvo's clash, Aboleth Spawn (creatureEntered), Inniaz (attackWatch), Aerial Extortionist (opponentActed).
    if ((m = /^whenever you win a clash, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    if (P.ABOLETH.test(line)) return out;
    if (/^whenever \w+ or more creatures you control with \w+ attack, each player gains control of a nonland permanent of your choice controlled by the player to their right\.?$/i.test(line)) return out;
    if ((m = /^whenever another player casts a spell from anywhere other than their hand, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // Krang (opponentActed): draw triggers twice; "Whenever a player draws their second card each turn, …"
    if (P.KRANG.test(line)) return out;
    if ((m = /^whenever a player draws (?:their|his or her) second card each turn, (?:you may )?(.+)$/i.exec(line))) { effectGaps('both', m[1]); return out; }
    // City of Brass (game.js's autoPay)
    if (G.TAP_PAIN.test(line)) return out;
    // Vigor (cardMoved)
    if (P.SHUFFLE_BACK.test(line)) return out;
    // Pearl-Ear (spellTargeted; Opp never casts auras)
    if ((m = /^whenever you cast an aura spell that targets a modified permanent you control, (?:you may )?(.+)$/i.exec(line))) { effectGaps('you', m[1]); return out; }
    // Intermediate Chirography (lifeChanged)
    if ((m = P.SELF_LOSS_WATCH.exec(line))) { effectGaps('both', m[2].replace(/\bthat much life\b/gi, '1 life').replace(/\bthat many\b/gi, '1')); return out; }
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
    // Oft-Nabbed Goat: only the other player activates it (bot.js's nab: app.js's menu on Opp's card; oppNabs).
    if (/^\{[^}]+\}: draw a card\. gain control of this creature and put an? [\w+/-]+ counter on it\. only your opponents may activate this ability and only as a sorcery\.?$/i.test(line)) return out;
    // Planeswalker loyalty abilities: "+1: …", "−X: …" (you pick X), "0: Add {C}{C}{C}." Opp never casts planeswalkers.
    if (/^[+−-]?(\d+|x)$/i.test(m[1].trim())) {
      notRun(m[2].replace(/\bx\b/gi, '1'), inst).forEach(p => gap(out, 'you', 'loyalty', p));
      gap(out, 'opp', 'loyalty', 'planeswalker loyalty abilities (Opp never casts planeswalkers)');
      return out;
    }
    // A Class's "{1}{R}: Level 2" (Barbarian Class); Desert's end-of-combat ping (used for whoever's defending).
    if (/^level \d+\.?$/i.test(m[2].trim())) { gap(out, 'opp', 'activated', 'class levels (Opp never levels up)'); return out; }
    if (P.DESERT.test(line)) return out;
    if (/^add\b/i.test(m[2]) && !/\bremove x\b/i.test(m[1])) {
      // A land's plain "{T}: Add {B}." (Scryfall's produced_mana); others need manaAbility (Cabal Coffers).
      if ((is(card, 'land') && /^\{T\}$/i.test(m[1].trim()) && !/for each|chosen|equal to|\bx\b/i.test(m[2])) || G.manaAbility(card.name, line)) return out;
      if (/^tap an untapped legendary creature you control$/i.test(m[1].trim()) && /^add one mana of any colou?r\.?$/i.test(m[2].trim())) return out; // Relic of Legends (game.js manaUnits)
      // Elvish Spirit Guide (Bot.handAbilities; app.js's hand menu)
      if (B.handAbilities(inst, () => ({ oracle: line })).some(a => a.kind === 'handMana')) { gap(out, 'opp', 'activated', 'abilities from the hand (Opp never uses them)'); return out; }
      // Skirk Prospector: "Sacrifice a Goblin: Add {R}." Not auto-tapped, but you activate it (its "add {R}" fills your mana pool).
      const sac = B.activatedAbilities(inst, () => ({ oracle: line }))[0];
      if (!(sac && !notRun(sac.effect, inst).length)) { gap(out, 'both', 'mana', `mana ability: ${m[1]}: ${m[2]}`); return out; }
      gap(out, 'opp', 'activated', 'activated abilities (Opp never activates them)');
      return out;
    }
    if (/^(equip|crew|cycling|ward)\b/i.test(m[1])) return null; // keyword lines
    // T'Chaka: "{3}, Exile this card from your graveyard: You become the monarch. Activate only if you control your commander." (Bot.graveAbilities)
    const ga = B.graveAbilities(inst, () => ({ oracle: line }))[0];
    if (ga) { notRun(ga.effect, inst).forEach(p => gap(out, 'both', 'activated', p)); return out; }
    // Emrakul, the Exigent Doom: "{3}, Exile this card from your hand: …" (Bot.handAbilities; app.js's hand menu)
    if (B.handAbilities(inst, () => ({ oracle: line })).some(a => a.kind === 'landMana')) { gap(out, 'opp', 'activated', 'abilities from the hand (Opp never uses them)'); return out; }
    // Magma Opus: "{U/R}{U/R}, Discard this card: Create a Treasure token." (app.js's hand menu)
    const hd = B.handAbilities(inst, () => ({ oracle: line })).find(a => a.kind === 'discardEffect');
    if (hd) { notRun(hd.effect, inst).forEach(p => gap(out, 'you', 'activated', p)); gap(out, 'opp', 'activated', 'abilities from the hand (Opp never uses them)'); return out; }
    const ab = B.activatedAbilities(inst, () => ({ oracle: line }))[0];
    if (!ab) { gap(out, 'both', 'cost', m[1]); return out; }
    const left = notRun(/\{X\}/i.test(ab.mana) || ab.removeAnyX || ab.sacX || ab.tapX ? ab.effect.replace(/\bx\b/gi, '1') : ab.effect, inst); // Crypt Rats, Moxite Refinery: you pick X
    left.forEach(p => gap(out, 'you', 'activated', p));
    // Opp uses only "…: Regenerate this" (to save a creature) and its fetch lands (crackFetches).
    const regen = /^regenerate (.+?)\.?$/i.exec(ab.effect.trim());
    const fetch = is(card, 'land') && ab.sacrifice && !ab.discard && !ab.remove && B.searchSpec(P.effectParts(ab.effect)[0]);
    if (!(regen && P.isSelf(regen[1], inst) && !ab.sacrifice) && !fetch) gap(out, 'opp', 'activated', 'activated abilities (Opp never activates them)');
    return out;
  }

  // ---------- always-on (static) lines ----------

  const LORD = /^(other )?(.+?) you control(?: with ([a-z]+(?: [a-z]+)?))? (?:get ([+-]\d+)\/([+-]\d+)(?: and have (.+?))?|have (.+?))\.?$/i;

  // Always-on lines from the Commander precons that bot.js and game.js read.
  const STATIC_DONE = [
    /\bcan be your commander\.?$/i,
    /^.+? gets \+1\/\+1 for each (?:unspent mana you have|color among permanents you control)\.?$/i, // Omnath, Faeburrow Elder
    /^if you would lose unspent mana, that mana becomes colorless instead\.?$/i, // Omnath
    /^you can't lose the game and your opponents can't win the game\.?$/i, /^creatures you control can't have -1\/-1 counters put on them\.?$/i, // Darksteel Angel
    /^if a creature you control would deal damage to a permanent or player, it deals double that damage instead\.?$/i, // Gratuitous Violence
    /^each other (?:multicolored )?creature you control gets \+1\/\+1 for each of its colors\.?$/i, // Knight of New Alara
    /^.+? is all colors\b/i, // Transguild Courier, Fallaji Wayfarer
    /^as long as .+? is (?:un)?tapped, other permanents enter (?:un)?tapped\.?$/i, // Archelos
    /^creature spells you control can't be countered\.?$/i, // Surrak
    /^as (?:this|.+?) enters, choose a card type\.?$/i, /^you and creatures you control have protection from the chosen card type\.?$/i, // Serra's Emissary
    P.SIEGE, P.CLONE_EOT, P.DICE_PLUS, P.ATTACK_TWICE,
    /^enchanted creature's controller may have it assign its combat damage as though it weren't blocked\.?$/i, // Indomitable Might
    /^as (?:this creature|.+?) enters, roll x d\d+\. it enters with a number of [\w+/-]+ counters on it equal to the total of those results\.?$/i, // Neverwinter Hydra
    /^.+? attacks each combat if able\.?$/i, // Chaos Dragon
    /^if this creature would enter and it wasn't cast or no mana was spent to cast it, exile it instead\.?$/i, // Primeval Spawn
    /^the first spell you cast each turn has cascade\.?$/i, // Maelstrom Nexus
    /^multicolored spells you cast have convoke\.?$/i, // Fallaji Wayfarer
    /^enchanted land has "\{T\}: add one mana of any colou?r\.?"\.?$/i, // Abundant Growth
    /^(?:other )?\w+ creatures get [+-]\d+\/[+-]\d+\.?$/i, // Lord of the Undead, Bad Moon (bot.js's grantsOnce, every table)
    /^if you would gain life, you gain that much life plus \d+ instead\.?$/i, // Angel of Vitality
    /^you may cast (?:\w+ )*(?:creature |artifact )?spells as though they had flash\.?$/i, // Yeva, Shimmer Myr: you cast them when you like here
    /^\w+ spells and \w+ spells you cast cost \{\d+\} less to cast for each [\w+/-]+ counter on (?:this creature|it)\.?$/i, // Herald of War (selfDiscount)
    /^creature spells you cast with power \d+ or greater cost \{\d+\} less to cast\.?$/i, // Goreclaw
    /^you can't cast .+? during your first, second, or third turns of the game\.?$/i, // Serra Avenger
    /^you may pay (?:\{[^}]+\})+ and tap \w+ untapped .+? you control(?: with \w+)? rather than pay this spell's mana cost\.?$/i, // Sephara (costChoices)
    /^if a nontoken creature an opponent controls would die, instead exile that card and create .+? creature token\.?$/i, // Kalitas
    /^you may cast this card from your graveyard as long as you control an? \w+\.?$/i, // Gravecrawler
    /^each (?:other )?(?:non-)?\w+(?: creature)?(?: or \w+)? you control(?: of the chosen type)? enters with an additional [\w+/-]+ counter on it\.?$/i, // Metallic Mimic, Dragonstorm Globe, Arlinn (enterTrigger)
    /^if a creature an opponent controls would die, exile it instead\. when you do, create .+? creature token\.?$/i, // Head of the Hunt (wouldDie)
    /^if a triggered ability of another \w+ or battle you control triggers, that ability triggers an additional time\.?$/i, // Chief of the Wilds (extraTriggers)
    /^(?:this creature|.+?) enters with x [\w+/-]+ counters on it\.?$/i, // Shivan Devastator
    // The Marvel precons.
    /^if a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time\.?$/i, // Roaming Throne (extraTriggers)
    /^if a triggered ability of (?:an? \w+ or )?another \w+ you control triggers, that ability triggers an additional time\.?$/i, // Harmonic Prodigy (extraTriggers)
    /^if you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.?$/i, // Veyran (extraTriggers)
    /^.+? can block only creatures with flying\.?$/i, // Brazen Borrower (canBlock)
    /^spells you control can't be countered\.?$/i, // Chimil (oppCounters)
    /^untap all creatures you control during each other player's untap step\.?$/i, // Drumbellower (upkeepSuspend)
    /^no card in your starting deck has more than one of the same mana symbol in its mana cost\.?$/i, // Jegantha's companion rule (deck building only)
    /^whenever enchanted land is tapped for mana, its controller adds an additional one mana of any colou?r\.?$/i, // Fertile Ground (game.js's sourceOf)
    /^during each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard\.?$/i, // Muldrotha (graveCast, landsFromGrave, cardMoved)
    /^\w+ permanent spells you cast from your hand gain evoke (?:\{[^}]+\})+ as you cast them\.?$/i, // Ashling (costChoices: yours)
    /^as long as (?:this creature|.+?) has \w+ or more [\w+/-]+ counters on it, it has [a-z ,]+\.?$/i, // Voice of the Blessed (staticExtra)
    /^(?:this creature|.+?) has [a-z ,]+ as long as it has \w+ or more [\w+/-]+ counters on it\.?$/i, // Primordial Hydra (staticExtra)
    /^creatures you control with counters on them have [a-z ,]+\.?$/i, // Nev (staticExtra)
    /^creatures with power less than (?:this creature's|its) power can't block it\.?$/i, // Elusive Otter (canBlock)
    /^(?:this creature|.+?) gets \+\d+\/\+\d+ for each aura attached to it\.?$/i, // Kor Spiritdancer (staticExtra)
    /^double all damage that creatures you control with counters on them would deal\.?$/i, // Raphael (staticExtra: combat damage)
    /^if damage would be dealt to another creature you control, prevent that damage\. put a \+1\/\+1 counter on that creature for each 1 damage prevented this way\.?$/i, // Vigor
    /^partner with .+$/i, // Rocksteady and Bebop: both commanders already
    /^creatures you don't control get [+-]\d+\/[+-]\d+ for each [\w+/-]+ counter on them\.?$/i, // Toxrill (grantsOnce: hostile, perCounter)
    /^(?:this creature|.+?) can't be blocked as long as you control no other creatures\.?$/i, // Jeskai Infiltrator (staticExtra)
    /^enchant [a-z]+(?:, [a-z]+)*,? or [a-z]+\.?$/i, // "Enchant creature, land, or planeswalker" (you pick what it goes on)
    /^enchanted permanent is a colorless land with "\{t\}: add \{c\}\.?" and loses all other card types and abilities\.?$/i, // Imprisoned in the Moon (attachBonus)
    /^enchanted permanent is a vehicle artifact with crew \d+ and it loses all other card types\.?$/i, // Swift Reconfiguration (attachBonus)
    /^if a player drawing a card causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.?$/i, // Krang (opponentActed)
    /^this creature and enchanted creature each get \+1\/\+1 for each creature you control and \+1\/\+1 for each aura you control\.?$/i, // Eidolon of Countless Battles
    /^the first spell you cast with \{x\} in its mana cost each turn costs \{\d+\} less to cast for each [\w+/-]+ counter on .+?\.?$/i, // Zimone, Infinite Analyst (selfDiscount)
    /^(?:this creature|.+?) enters with twice x [\w+/-]+ counters on it\.?$/i, // Primo (enterTrigger)
    /^.+?['’]s power and toughness are each equal to your life total\.?$/i, // Soul of Eternity (staticExtra)
    /^if you would gain life, you gain twice that much life instead\.?$/i, // Boon Reflection (lifeChanged)
    /^as this artifact enters, pay any amount of life\.?$/i, // Phyrexian Processor (enterEffects; countOf's "the life paid")
    /^if one or more \+1\/\+1 counters would be put on (?:another creature|an? [a-z ]+?) you control, that many plus one \+1\/\+1 counters are put on (?:it|that permanent) instead\.?$/i, // Hardened Scales & co. (game.js's counter)
    /^creature spells you cast have (?:demonstrate|convoke)\.?$/i, // Silverquill Lecturer (spellCast asks you), Dazzling Theater (hasConvoke)
    /^untap (?:all|each) creatures? you control during each other player's untap step\.?$/i, // Prop Room, Drumbellower (upkeepSuspend)
    /^if a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.?$/i, // Yarok (extraTriggers)
    /^spells you cast from anywhere other than your hand cost \{\d+\} less to cast\.?$/i, // Advanced Reconstruction (game.js's discount)
    /^once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value \d+ or less from your graveyard\. if you do, it gains "when this permanent is put into a graveyard from the battlefield, exile it and you gain \d+ life\."\.?"?$/i, // Serra Paragon (graveCast, landsFromGrave, cardMoved)
    /^damage can't be prevented\.?$/i, /^all damage is dealt as though its source had wither\.?$/i, // Everlasting Torment (grantsOnce, creatureDamaged)
    /^creatures your opponents control with counters on them can't attack or block\.?$/i, // Kulrath Knight (grantsOnce's hostile)
    /^play with the top card of your library revealed\.?$/i, // Conspicuous Snoop: nothing hidden to keep here
    /^you may cast \w+ spells(?: of the chosen type)? from the top of your library\.?$/i, // Conspicuous Snoop, Realmwalker (topCastable; app.js's library menu)
    /^you may look at the top card of your library any time\.?$/i, // Realmwalker (the library menu shows it)
    /^as long as the top card of your library is an? \w+ card, .+? has all activated abilities of that card\.?$/i, // Conspicuous Snoop (staticExtra)
    /^\w+ you control get \+1\/\+1 for each time you've cast your commander from the command zone this game\.?$/i, // Vanguard of the Restless (staticExtra)
    /^start your engines!?$/i,// Howlsquad Heavy: speed (bot.js's refreshGrants; "Max speed — …" lines at 4, byLevel)
    /^the "legend rule" doesn't apply to creatures you control\.?$/i, // Council of Reeds: the legend rule isn't enforced here anyway
    /^mayhem (?:\{[^}]+\})+$/i, // Chameleon: from the graveyard the turn it's discarded (mayhemOk; Opp's castOptions)
    // The Strixhaven precons.
    /^escape\s*[—-]\s*(?:\{[^}]+\})+, exile \w+ other cards from your graveyard\.?$/i, // Woe Strider (escapeOk; app.js's graveyard menu)
    /^(?:this creature|.+?) escapes with \w+ [\w+/-]+ counters? on it\.?$/i, // (enterTrigger)
    /^devour (?:food )?\d+$/i, // Mycoloth (app.js asks; Opp devours its small tokens), Feasting Hobbit (Foods)
    /^nontoken creatures you control enter with an additional \+1\/\+1 counter on them for each creature that died under your control this turn\.?$/i, // Gorma (enterTrigger)
    /^nonland cards in your hand have miracle \{0\}\.?$/i, // Molecule Man (opponentActed's draw: the first card drawn each turn)
    /^multikicker (?:\{[^}]+\})+$/i, // Batroc (costChoices; Opp casts it unkicked)
    /^.+? enters with an? [\w+/-]+ counter on (?:him|her|it) for each time (?:he|she|it) was kicked\.?$/i, // Batroc (enterTrigger)
    /^you may cast this card from your graveyard by discarding a card in addition to paying its other costs\.?$/i, // Dragon Man (graveCast, graveDiscards)
    /^as long as you're the monarch, creatures with power \d+ or less can't attack you\.?$/i, // Queen Mother Ramonda (tooWeakToAttack)
    /^if a source an opponent controls would deal damage to you, prevent 1 of that damage\.?$/i, // Heart-Shaped Herb (preventsOne)
    /^you may play lands from your graveyard\.?$/i, // Conduit of Worlds (playLand, app.js's graveyard menu)
    /^if equipped creature would be dealt damage, prevent that damage and put that many \+1\/\+1 counters on it\.?$/i, // Panther Habit (DMG_COUNTERS)
    /^if one or more creature tokens would be created under your control, that many 4\/4 white angel creature tokens with flying and vigilance are created instead\.?$/i, // Divine Visitation (game.js createToken)
    /^this spell costs \{x\} less to cast, where x is the total mana value of noncreature artifacts you control\.?$/i, // Metalwork Colossus (selfDiscount)
    /^when you cast this spell while you control your commander, copy this spell\b/i, // Ancestral Communion (spellCast, spellResolve)
    /^if another source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead\.?$/i, // Thor (PLUS_DMG, damagePlayer, applyTarget)
    /^(?:[\w ]+ — )?as long as .+?, you may cast spells as though they had flash\.?$/i, // Captain Mar-Vell, Quicksilver: you cast when you like here
    /^you may look at the top card of your library any time\.?$/i, // Thundermane Dragon (app.js's library menu)
    /^you may cast creature spells with power \d+ or greater from the top of your library\. if you cast a creature spell this way, it gains haste until end of turn\.?$/i, // (topCastable)
    /^as long as a card exiled with this creature is a creature card, this creature has the power, toughness, and creature types of the last creature card exiled with it\. it's still an? \w+\.?$/i, // Duplicant (targetEffect, grantsOnce)
    /^(?:this creature|.+?) enters with an? [\w+/-]+ counter on it for each .+? cards? in your graveyard\.?$/i, // Diregraf Colossus
    // "Is Your Turn Over Yet?" (Etali, Primal Conqueror).
    /^you may play an additional land on each of your turns\.?$/i, // Exploration (game.js's move)
    /^if an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.?$/i, // Panharmonicon (extraTriggers)
    /^(?:nontoken )?creatures you control have riot\.?$/i, // Rhythm of the Wild (enterTrigger)
    /^\w+ spells you cast have prowl (?:\{[^}]+\})+\.?$/i, // Hunting Velociraptor (costChoices; Opp pays the mana cost)
    /^creatures you control can boast twice during each of your turns rather than once\.?$/i, // Birgi: boast isn't held to once a turn here
    /^cumulative upkeep\s*[—-]\s*add (?:\{[WUBRGC]\})+\.?$/i, // Braid of Fire (phaseTriggers)
    // The Lord of the Rings precons.
    P.ARWEN, P.DEARLY, P.REALM, // Arwen, Dearly Departed, Realm Seekers (enterTrigger)
    P.ABILITY_DISCOUNT, P.NO_SAC, // Sam, Loyal Attendant (app.js's activate; oppEats); Hithlain Rope (choiceIds, oppSacrifices)
    P.VERGE, // Verge Rangers (playLand; app.js's library menu)
    /^the monarch controls enchanted creature\.?$/i, // Fealty to the Realm (bot.js's syncAuras)
    P.NO_UNTAP, P.NOTION, // Basalt Monolith (game.js's nextTurn); Notion Thief (bot.js's drawInstead)
    P.HOARD, // Cavern-Hoard Dragon (selfDiscount)
    // Tarkir: Dragonstorm precons.
    /^untap all permanents you control during each other player's untap step\.?$/i, // Seedborn Muse (upkeepSuspend)
    /^during your turn, each creature assigns combat damage equal to its toughness rather than its power\.?$/i, // Baldin (combatRuleOf)
    /^spells can't be countered\.?$/i, P.LIER, // Lier (oppCounters; refreshGrants' lierFlashback)
    P.DIED_COUNTERS, // Bone Devourer (enterTrigger)
    P.DAUTHI, // Dauthi Voidwalker (game.js's graveInstead hook)
    P.STEWARD, P.KOTIS, // Steward of the Harvest (grantsOnce: the exiled lands' mana); Kotis (graveCast, payKotis)
  ];

  function staticLine(card, line, inst) {
    const out = { you: true, opp: true, gaps: [] };
    let m;
    if (STATIC_DONE.some(re => re.test(line)) || P.staticKnown(line, inst)) return out;
    // Banners: "Creatures you control of the chosen type / color get +1/+1" read like grantsOnce reads them.
    line = line.replace(/^(other )?(\w+) you control of the chosen type\b/i, '$1Elf $2 you control').replace(/ you control of the chosen colou?r\b/i, ' you control');
    // Marrow-Gnawer ("All Rats have fear."); Dirty Wererat (threshold); Coat of Arms; Heraldic Banner's color; Rat Colony.
    if ((m = /^all (.+?) (?:have (.+?)|get [+-]\d+\/[+-]\d+)\.?$/i.exec(line)) && (!m[2] || B.grantKws(m[2]).length === kwOnly(m[2]).length)) return out;
    if (/^as long as there are \w+ or more cards in your graveyard, (.+?) gets [+-]\d+\/[+-]\d+(?: and (?:can't block|can't attack|has .+?))?\.?$/i.test(line)
      || /^each creature gets \+1\/\+1 for each other creature on the battlefield that shares at least one creature type with it\.?$/i.test(line)
      || G.choosesColor(line) || /^a deck can have any number of cards named /i.test(line)) return out;
    // 'Commander creatures you own have "Whenever this creature attacks a player, …"': the ability it gives.
    if ((m = /^(?:other )?(.+?) you (?:control|own) have "(.+)"\.?$/i.exec(line)) && !m[1].includes(':')) {
      const given = { id: 'given', name: 'this creature', typeLine: 'Creature' };
      if (B.grantKws(`"${m[2]}"`).length && keywordLine(card, m[2])) return keywordLine(card, m[2]); // Hexing Squelcher: 'have "Ward—Pay 2 life."'
      return triggerLine(card, m[2], given) || activatedLine(card, m[2], given) || staticLine(card, m[2], given);
    }
    // Roshan; recover (Garza's Assassin); Ebondeath from the graveyard; The Darkness Crystal; The Immortal Sun; Rune of Mortality.
    if (/^other creatures you control are \w+ in addition to their other types\./i.test(line) || P.RECOVER.test(line) || P.GRAVE_CAST.test(line) || P.GRAVE_CAST3.test(line)
      || P.CRYSTAL.test(line) || /^players can't activate planeswalkers' loyalty abilities\.?$/i.test(line)) return out;
    // Tetsuko Umezawa; Weathered Sentinels; Reliquary Tower; Crystal Barricade and Teyo (hexproof, damage
    // prevention); Wall of Glare and Brave the Sands; Wall of Stolen Identity; Towering Titan.
    if (/^(.+?) you control with power or toughness \d+ or less can't be blocked\.?$/i.test(line)
      || /^(.+?) can attack players who attacked you during their last turn as though it didn't have defender\.?$/i.test(line)
      || /^you have (?:no maximum hand size|hexproof)\.?$/i.test(line) || /^prevent all noncombat damage that would be dealt to other creatures you control\.?$/i.test(line)
      || P.EXTRA_BLOCK.test(line) || P.CLONE.test(line) || P.CLONE_OWN.test(line) || P.CLONE_X.test(line) || P.CLONE_POWER.test(line)
      || (/^(.+?) enters(?: the battlefield)? with x ([\w+/-]+) counters on it, where x is the total (power|toughness) of other (.+?) you control\.?$/i.test(line))) return out;
    if ((m = /^as long as enchanted permanent is an? (creature|equipment), it has (.+?)\.?$/i.exec(line))) {
      const kws = kwOnly(m[2].replace(/^"equipped creature has (.+?)\.?"$/i, '$1'));
      if (!kws.every(k => B.KEYWORDS.includes(k))) gap(out, 'you', 'static', line);
      return out;
    }
    if (/^you may pay (?:\{[^}]+\})+ rather than pay this spell's mana cost\.?$/i.test(line)) { gap(out, 'opp', 'static', 'other cost (Opp pays the mana cost)'); return out; }
    if (/^other \w+?s you control have afflict \d+\.?$/i.test(line)) return out; // Lost Monarch of Ifnir (becameBlocked's afflictOf)
    if ((m = LORD.exec(line)) && !m[2].includes(':')) {
      if (m[3] && !B.KEYWORDS.includes(m[3].toLowerCase())) { gap(out, 'both', 'static', line); return out; } // "with power 4 or greater"
      // "protection from black and from red" (Akroma's Memorial) is one keyword it gives.
      const raw = m[6] || m[7] || '';
      const pro = /protection from [a-z-]+(?:,? (?:and )?from [a-z-]+)*/i.exec(raw);
      const kws = kwOnly(pro ? raw.replace(pro[0], '') : raw).concat(pro && !B.grantKws(pro[0]).length ? ['protection'] : []);
      const unknown = kws.filter(k => !B.KEYWORDS.includes(k) && !B.grantKws(k).length); // "toxic 1" is toxic
      if (!kws.length || !unknown.length) return out;
      unknown.forEach(k => gap(out, 'both', 'static', `… you control have ${k}`));
      return out;
    }
    if (/^(other )?(.+?) you control can't be blocked except by two or more creatures\.?$/i.test(line)) return out;
    if ((m = /^(.+?) gets ([+-]\d+)\/([+-]\d+) for each (other )?(.+?) you control(?: and each (.+?) cards? in your graveyard)?\.?$/i.exec(line)) && P.isSelf(m[1], inst)) return out;
    if ((m = /^(.+?)['’]s (power and toughness are each|power is|toughness is) equal to the number of (other )?(.+?) (?:you control|on the battlefield)\.?$/i.exec(line)) && P.isSelf(m[1], inst)) return out;
    if ((m = P.GRAVE_CDA.exec(line)) && P.isSelf(m[1], inst)) return out; // Haughty Djinn, Consuming Aberration, Lord of Extinction (grantsOnce)
    if (/^(.+?) your opponents control get ([+-]\d+)\/([+-]\d+)\.?$/i.test(line)) return out;
    if (P.TOUGH_RULE.test(line) || P.DEFENDER_RULE.test(line)) return out; // Arcades, Doran, High Alert
    if (P.SELF_DISCOUNT.test(line) || P.GRAVE_TYPES_DISCOUNT.test(line)) return out; // The Pride of Hull Clade, Emrakul
    // Wolfies: Cemetery Prowler (selfDiscount), Ascendant Packleader (enterTrigger), Wolfir Silverheart, Wolf Pack (staticExtra)
    if (P.PROWLER.test(line) || P.PACKLEADER.test(line) || P.SOULBOND.test(line) || P.LONE_WOLF.test(line)) return out;
    if (P.ATTACK_TAX.test(line) || P.NO_GAIN.test(line) || P.ARBORIA.test(line) || P.ATTACK_CAP.test(line) || P.BLOCK_CAP.test(line)) return out;
    if (P.SPELL_TAX.test(line) && !/\btarget/i.test(line)) return out;
    if (P.OLD_MENACE.test(line) || P.UNBLOCKABLE.test(line) || P.CANT.test(line)) return out;
    if (/^this spell can't be countered\.?$/i.test(line)) return out; // Opp doesn't try
    if (G.costReductions(line).length || G.doublesOf(line) || G.choosesType(line)) return out;
    if (Object.keys(G.entersWithCounters(line)).length && !/\bif\b|\bunless\b/i.test(line)) return out;
    if ((m = /^(.+?) enters(?: the battlefield)? with (?:an? ([\w+/-]+) counter on it for each (?:other )?(.+?)|x ([\w+/-]+) counters on it, where x is the number of (?:other )?(.+?)) you control\.?$/i.exec(line)) && P.isSelf(m[1], inst)) return out;
    if (/\benters(?: the battlefield)? tapped\b/i.test(line) && G.entersTapped(card.name, line)) return out;
    // Kenrith's Transformation, Fall from Favor, Nettlecyst, Tangleweave Armor (read whole by attachBonus).
    if (/^enchanted creature (?:loses all abilities and is|doesn't untap during its controller's untap step unless)|^equipped creature gets \+(?:1\/\+1 for each|x\/\+x, where x is the greatest mana value)/i.test(line)) {
      const b = B.attachBonus(line);
      if (b.loseAll || b.noUntapUnlessMonarch || b.perEach || b.perCommanderMv) return out;
    }
    // Hulkbuster Armor: "Equipped creature has base power and toughness 9/9 and has flying."
    if (/^(?:equipped|enchanted) creature has base power and toughness \d+\/\d+/i.test(line) && B.attachBonus(line).setPT) {
      if (is(card, 'equipment')) gap(out, 'opp', 'keyword', 'equip (Opp never equips)');
      return out;
    }
    // Door of Destinies: "Creatures you control of the chosen type get +1/+1 for each charge counter on this artifact." (grantsOnce)
    if (/^.+? you control(?: of the chosen type)? get [+-]\d+\/[+-]\d+ for each [\w+/-]+ counter on (?:this \w+|it)\.?$/i.test(line)) return out;
    // Donatello: a Mutagen token with each batch of tokens (game.js's tokenCount)
    if (P.PLUS_MUTAGEN.test(line) || P.PLUS_THOPTER.test(line)) return out; // Donatello, Stridehangar Automaton (game.js's tokenCount)
    // Eternal Might: On Wings of Gold, Maskwood Nexus, Rhet-Tomb Mystic, Vizier of Many Faces, Zombie Master, Lost Monarch (afflict)
    if (P.TOKEN_SWAP.test(line) || P.BELLO.test(line)) return out;
    if (/^(?:this creature|.+?) enters with a number of [\w+/-]+ counters on it equal to one plus the number of other creatures you control\.?$/i.test(line)) return out; // Boss's Chauffeur (enterTrigger) // Fisher's Talent (game.js's createToken), Bello (refreshGrants)
    if (/^if one or more tokens would be created under your control, those tokens plus that many 1\/1 green squirrel creature tokens are created instead\.?$/i.test(line)) return out; // Chatterfang (tokenCount)
    if (/^if you would create a clue, food, or treasure token, instead create one of each\.?$/i.test(line)) return out; // Academy Manufactor (artifactTokens)
    if (/^(?:this creature|.+?) gets \+x\/\+0, where x is the number of other creatures you control with base power \d+\.?$/i.test(line)) return out; // Zinnia
    if (/^creature spells you cast gain offspring (?:\{[^}]+\})+ as you cast them\.?$/i.test(line)) { gap(out, 'opp', 'static', 'offspring (Opp never pays it)'); return out; } // Zinnia (costChoices)
    if (/^during your turn, artifacts you control are foods in addition to their other types and have ".+"\.?$/i.test(line)) return out; // Gourmand's Talent
    if (/^foods you control have all activated abilities of all creature cards exiled with this creature\.?$/i.test(line)) return out; // Hazel's Brewmaster
    if (/^each fungus and saproling you control has "\{t\}: add \{g\}\."\.?$/i.test(line)) return out; // Brightcap Badger (grantedMana)
    if (/^enchantment spells you cast from your hand have cascade\.?$/i.test(line) || /^the first spell you cast each turn that mana from a treasure was spent to cast has cascade\.?$/i.test(line)) return out; // Wildsear, Rain of Riches (spellCast)
    if (/^(?:enchanted land|it) has "\{t\}: create an? .+ token\."\.?$/i.test(line)) return out; // Squirrel Nest (attachBonus)
    if (/^(?:as long as you've cast a spell this turn, )?you may play cards from the top of your library\.?$/i.test(line)) return out; // Fortune Teller's Talent (topCastable)
    if (/^each player may play an additional land on each of their turns\.?$/i.test(line)) return out; // Rites of Flourishing, Ghirapur Orrery (refreshGrants)
    if (P.BRUSHRAZER.test(line) || P.LANDS_FROM_TOP.test(line) || P.AUGUR.test(line) || P.BROOD.test(line) || P.ENTER_EQUAL.test(line)) return out;
    if (/^(?:this creature|.+?) enters tapped with \w+ [\w+/-]+ counters on it\.?$/i.test(line) || /^each creature you control gets \+\d+\/\+0 for each time it has attacked this turn\.?$/i.test(line) || /^lands you control enter untapped\.?$/i.test(line)) return out;
    if (P.CONVERGE_ENTER.test(line) || /^when (?:this \w+|.+?) has \w+ or more [\w+/-]+ counters on it, you win the game\.?$/i.test(line)) return out; // Crystalline Crawler, Darksteel Reactor
    if (/^spells you cast of the chosen type cost \{\d+\} less to cast\.?$/i.test(line) || /^as (?:this|.+?) enters, choose artifact, creature, enchantment, instant, or sorcery\.?$/i.test(line)) return out; // Cloud Key
    if (/^if you would proliferate, proliferate twice instead\.?$/i.test(line)) return out; // Tekuthal (proliferate)
    if (/^equipped creature gets \+\d+\/\+\d+ for each counter on this equipment\.?$/i.test(line) || /^as long as this equipment has \w+ or more counters on it, equipped creature has .+$/i.test(line)) return out; // Gavel (staticExtra)
    if (P.WINGS.test(line) || P.MASKWOOD.test(line) || P.RHET_TOMB.test(line) || P.VIZIER.test(line)) return out;
    if (/^other \w+ creatures have [a-z]+\.?$/i.test(line) || /^other \w+?s have "\{[^}]+\}: regenerate this permanent\."\.?$/i.test(line) || /^other \w+?s you control have afflict \d+\.?$/i.test(line)) return out;
    if (P.NISSA.test(line)) { gap(out, 'opp', 'static', "Nissa's energy cost (Opp pays mana)"); return out; } // Nissa, Worldsoul Speaker (costChoices)
    // Pearl-Ear: affinity for Auras given to enchantment spells (game.js's discount)
    if (G.AFFINITY_GRANT.test(line)) return out;
    // Raffine's Guidance: cast from your graveyard (app.js's graveyard menu, Bot.graveAltCost)
    if (P.GRAVE_ALT.test(line)) { gap(out, 'opp', 'static', "Opp doesn't cast it from its graveyard"); return out; }
    // Void Winnower: Opp can't cast or block with even mana values (castOptions, Opp's blocks); Opp's doesn't stop you.
    // Grand Abolisher, Drannith Magistrate: Opp can't cast (castOptions, oppCounters); Opp's doesn't stop you.
    if ([P.OPPS_ENTER_TAPPED, P.DRAW_CAP, P.GRAVE_LOCK, P.NO_GRAVE_CAST, P.SEARCH_TOP, P.KW_LOST, P.ALL_ISLANDS, P.GROUNDED, P.PRO_FROM_OPPS].some(re => re.test(line))) return out; // Blind Obedience, Thalia, Narset, Soulless Jailer (refreshGrants)
    if (P.ABOLISHER.test(line) || P.HAND_ONLY.test(line)) { gap(out, 'opp', 'static', "Opp's doesn't stop your spells"); return out; }
    if (P.WINNOW_CAST.test(line) || P.WINNOW_BLOCK.test(line)) { gap(out, 'opp', 'static', "Opp's doesn't stop your spells or blocks"); return out; }
    // Coin of Mastery (game.js's autoPay counts artifact mana; creatureEntered)
    if (P.COIN_MASTERY.test(line)) return out;
    // Combat Calligrapher, Nils: Opp's creatures don't attack you past them (pickAttackers); yours aren't stopped by Opp's.
    if (P.NO_KIND_ATTACK.test(line) || P.NO_COUNTERED_ATTACK.test(line)) { gap(out, 'opp', 'static', "Opp's doesn't stop your attacks"); return out; }
    // Flickering Ward (attachBonus's proChosen; its color is picked as it enters). Darksteel Mutation (attachBonus).
    if (/^enchanted creature has protection from the chosen colou?r\. this effect doesn't remove this aura\.?$/i.test(line)) return out;
    if (/^enchanted creature is an? \w+ (?:artifact creature )?with base power and toughness/i.test(line) && B.attachBonus(line).loseAll) return out; // Lignify too
    if ((m = /^(?:equipped|enchanted) creature (.+?)\.?$/i.exec(line))) {
      const b = B.attachBonus(line);
      // Angelic Destiny: "… and is an Angel in addition to its other types" (b.types).
      const has = /\bhas (.+?)(?:\.|$)/i.exec(m[1].replace(/"[^"]*"/g, '').replace(/,? and is an? \w+ in addition to its other types/i, '')
        .replace(/ and mobilize x, where x is its power$/i, '')); // Infantry Shield (attachBonus' line)
      // Also "annihilator 2", "ward {2}", "protection from creatures" and "is goaded" (attachBonus, syncAuras).
      const unknown = has ? kwOnly(has[1]).filter(k => !B.KEYWORDS.includes(k.replace(/ \d+$/, '')) && !/^ward \{\d+\}$|^is goaded$/.test(k) && !P.protectionKw(k)) : [];
      // Thornbite Staff: abilities it gives in quotes are read like the creature's own.
      const given = { id: 'given', name: 'this creature', typeLine: 'Creature' };
      (b.lines || []).forEach(l => {
        const r = triggerLine(card, l, given) || activatedLine(card, l, given) || staticLine(card, l, given);
        r.gaps.filter(g => g.side !== 'opp').forEach(g => gap(out, 'you', g.kind, g.phrase));
      });
      if (b.pow || b.tou || b.kw.length || b.cantAttack || b.cantBlock || b.noAbilities || b.fealty || (b.lines || []).length) {
        unknown.forEach(k => gap(out, 'you', 'static', `equipped/enchanted creature has ${k}`));
        if (line.replace(/"[^"]*"/g, '"…"').split(/(?<=\.)\s+/).length > 1) gap(out, 'you', 'static', `${/^equipped/i.test(line) ? 'equipped' : 'enchanted'} creature: ${line.split(/(?<=\.)\s+/).slice(1).join(' ')}`);
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
    // X is asked for when you cast it (app.js), so read it as a number. Lines only about casting it
    // (Flawless Maneuver's free cast, Berserker's Frenzy's timing) are offered when you cast it.
    const text = lines.filter(l => !P.CAST_ONLY.test(l)).join(' ').replace(/\bX\b/g, /\{X\}/i.test(card.manaCost || '') ? '1' : 'X');
    const modes = B.spellModes(inst, () => card);
    if (modes) {
      modes.modes.forEach(mode => {
        if (!mode.split(/(?<=\.)\s+/).every(s => PUMP_SENTENCE.test(s.trim())) && !runs(mode, inst)) gap(out, 'you', 'spell', `modal spell: ${mode}`);
      });
    } else if (/\binstant\b/i.test(front(card.typeLine)) && G.isCounterspell(card.oracle)) {
      // Its other sentences: ones counterExtras does (An Offer You Can't Refuse, Arcane Denial, Dovin's Veto).
      const extras = P.counterExtraParts(text).filter(x => !P.COUNTER_EXTRAS.some(re => re.test(x)));
      if (!/^counter target (?:[a-z ,-]+ )?spell(?: unless its controller pays \{\d+\})?\b/im.test(text.replace(/^this spell can't be countered\.\s*/i, '')) || extras.length) gap(out, 'you', 'spell', `counterspell: ${text}`);
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
    const inst = { id: 'card', name: card.name, typeLine: card.typeLine || '', xValue: /\{X\}/i.test(card.manaCost || '') ? 1 : undefined };
    // Both faces of a two-faced card, each read as the Simulator reads it when that face is up.
    const text = [B.faceOracle(card.oracle, card.name, false), ...(String(card.name).includes(' // ') ? [B.faceOracle(card.oracle, card.name, true)] : [])];
    // Max speed and Boast lines read as the abilities they are (bot.js's byLevel, activatedAbilities).
    const lines = [...new Set(text)].join('\n').split('\n').map(P.plainLine).map(l => l.replace(/^(?:max speed|boast)\s*—\s*/i, '')).filter(Boolean);
    // A creature with a spell on its other face (prepare: Stensian Sanguinist // Exsanguinate): the spell face's lines are a spell.
    const faceTypes = String(card.typeLine || '').split(' // ');
    const spellFace = !(is(card, 'instant') || is(card, 'sorcery')) && faceTypes.length > 1 && /\b(instant|sorcery)\b/i.test(faceTypes[1]) && text[1]
      ? new Set(text[1].split('\n').map(P.plainLine).filter(Boolean)) : null;
    const isSpellLine = l => is(card, 'instant') || is(card, 'sorcery') || (!!spellFace && spellFace.has(l));
    let isSpell = is(card, 'instant') || is(card, 'sorcery');
    const out = [];
    const spellLines = [];
    const siege = lines.some(l => P.SIEGE.test(l));
    for (let text of lines) {
      isSpell = isSpellLine(text);
      // Station: "8+ | Flying" is read as the ability it is (bot.js's byLevel turns it on).
      const st = P.STATION_ROW.exec(text);
      if (st) text = st[2];
      // A die's table ("1—9 | Each player sacrifices a permanent of their choice."): its effect runs on that roll.
      const row = P.ROLL_ROW.exec(text);
      const chapter = !row && /\bsaga\b/i.test(card.typeLine || '') && P.CHAPTER.exec(text); // a Saga's "II — …" (bot.js's loreUp)
      if (row || chapter) {
        const r = { you: true, opp: true, gaps: [] };
        notRun(row ? row[3] : chapter[2], inst).forEach(p => gap(r, 'both', 'effect', p));
        out.push({ text, ...r });
        continue;
      }
      // A Siege's "• Khans — At the beginning of your upkeep, …": read as its own line once chosen.
      if (siege && /^•\s*\w+\s*[—-]\s*/.test(text)) text = text.replace(/^•\s*\w+\s*[—-]\s*/, '');
      if (/^•/.test(text) || /^choose (one|two|three|four|five|one or more|one or both|any number)\b/i.test(text)) {
        if (isSpell) { spellLines.push(text); continue; }
        // A mode of the trigger above ("Choose one —"): runEffect does it once it's picked.
        if (/^•/.test(text)) {
          const mode = { you: true, opp: true, gaps: [] };
          notRun(text.replace(/^•\s*/, '').replace(/\bX\b/g, x => (/\bwhere x is\b/i.test(text) ? x : '1')).replace(/^[A-Z][A-Za-z'’ -]{1,40}? — /, ''), inst).forEach(p => gap(mode, 'both', 'effect', p)); // a mode's name ("AV Bead — ") only names it
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
