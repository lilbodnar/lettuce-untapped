/*
 * Estimates where a Commander deck sits in Wizards' Commander Brackets, from its list alone:
 *   1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH.
 * The brackets are told apart by Game Changers (Scryfall marks them), mass land denial, extra turns,
 * tutors and two-card infinite combos. Brackets 1 and 5 are about intent (a theme deck, a tournament
 * deck), which a list can't show, so the estimate stops at 2 and 4 and says so.
 */
const Brackets = (() => {
  'use strict';

  const NAMES = { 1: 'Exhibition', 2: 'Core', 3: 'Upgraded', 4: 'Optimized', 5: 'cEDH' };

  // Well-known two-card infinite combos (not every one there is). Front face names.
  const COMBOS = [
    ["Thassa's Oracle", 'Demonic Consultation'], ["Thassa's Oracle", 'Tainted Pact'],
    ['Laboratory Maniac', 'Demonic Consultation'], ['Laboratory Maniac', 'Tainted Pact'],
    ['Jace, Wielder of Mysteries', 'Demonic Consultation'], ['Jace, Wielder of Mysteries', 'Tainted Pact'],
    ['Isochron Scepter', 'Dramatic Reversal'],
    ['Heliod, Sun-Crowned', 'Walking Ballista'],
    ['Mikaeus, the Unhallowed', 'Triskelion'],
    ['Exquisite Blood', 'Sanguine Bond'], ['Exquisite Blood', 'Vito, Thorn of the Dusk Rose'],
    ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'], ['Kiki-Jiki, Mirror Breaker', 'Pestermite'],
    ['Kiki-Jiki, Mirror Breaker', 'Deceiver Exarch'], ['Kiki-Jiki, Mirror Breaker', 'Restoration Angel'],
    ['Kiki-Jiki, Mirror Breaker', 'Felidar Guardian'], ['Kiki-Jiki, Mirror Breaker', 'Corridor Monitor'],
    ['Kiki-Jiki, Mirror Breaker', 'Village Bell-Ringer'],
    ['Splinter Twin', 'Pestermite'], ['Splinter Twin', 'Deceiver Exarch'],
    ['Saheeli Rai', 'Felidar Guardian'],
    ['Devoted Druid', 'Vizier of Remedies'],
    ['Niv-Mizzet, Parun', 'Curiosity'], ['Niv-Mizzet, Parun', 'Ophidian Eye'], ['Niv-Mizzet, Parun', 'Tandem Lookout'],
    ['Niv-Mizzet, the Firemind', 'Curiosity'], ['Niv-Mizzet, the Firemind', 'Ophidian Eye'],
    ['Worldgorger Dragon', 'Animate Dead'], ['Worldgorger Dragon', 'Dance of the Dead'], ['Worldgorger Dragon', 'Necromancy'],
    ['Grim Monolith', 'Power Artifact'], ['Basalt Monolith', 'Power Artifact'],
    ['Basalt Monolith', 'Rings of Brighthearth'], ['Basalt Monolith', 'Kinnan, Bonder Prodigy'],
    ["Painter's Servant", 'Grindstone'],
    ['Peregrine Drake', 'Deadeye Navigator'], ['Palinchron', 'Deadeye Navigator'], ['Great Whale', 'Deadeye Navigator'],
    ['Bloom Tender', 'Freed from the Real'], ['Faeburrow Elder', 'Freed from the Real'],
    ['Dualcaster Mage', 'Twinflame'], ['Dualcaster Mage', 'Heat Shimmer'],
    ['Godo, Bandit Warlord', 'Helm of the Host'],
    ['Sword of the Meek', 'Thopter Foundry'],
    ['Food Chain', 'Eternal Scourge'], ['Food Chain', 'Misthollow Griffin'], ['Food Chain', 'Squee, the Immortal'],
    ['Professor Onyx', 'Chain of Smog'],
    ['Bloodchief Ascension', 'Mindcrank'], ['Duskmantle Guildmage', 'Mindcrank'],
    ['Aggravated Assault', 'Sword of Feast and Famine'], ['Aggravated Assault', 'Bear Umbra'],
    ['Earthcraft', 'Squirrel Nest'],
    ['Midnight Guard', 'Presence of Gond'],
    ["Lion's Eye Diamond", 'Auriok Salvagers'],
  ];
  // Two cards costing this much or less together can go off early (Bracket 3 allows only late ones).
  const EARLY_MV = 6;

  const LAND_WORDS = /\bland\b|\blands\b|\bbasic\b|\bplains\b|\bislands?\b|\bswamps?\b|\bmountains?\b|\bforests?\b/i;

  // "Search your library for a card" and the like, but not for lands or for cards named after itself.
  function isTutor(text) {
    const re = /search(?:es)? your library for ([^.]*)/gi;
    let m;
    while ((m = re.exec(text))) {
      const what = m[1];
      if (/\bcards?\b/i.test(what) && !LAND_WORDS.test(what) && !/\bnamed\b/i.test(what)) return true;
    }
    return false;
  }

  const isExtraTurn = text => /\btakes? an extra turn\b|\btakes? (?:two|three|x) extra turns\b/i.test(text);

  // Destroys, bounces or locks down many lands, or changes the mana they make.
  const LAND_DENIAL = [
    /\b(?:destroy|exile) all [^.]*\blands\b/i,
    /\breturn all [^.]*\blands\b[^.]* to their owners'? hands?/i,
    /\beach (?:player|opponent) sacrifices (?:all|half|three|four|five|six|seven|x) [^.]*\blands?\b/i,
    /\blands?\b[^.]*\b(?:don't|doesn't) untap\b/i,
    /\bcan't untap more than (?:one|two) (?:lands?|permanents?)\b/i,
    /\bskip (?:their|each player's) untap steps?\b/i,
    /\bnonbasic lands are mountains\b/i,
  ];
  const isLandDenial = text => LAND_DENIAL.some(re => re.test(text));

  const key = name => String(name || '').split(' // ')[0].trim().toLowerCase();

  // rows: [{ id, name, qty, commander }]; def: id => card info ({ oracle, cmc, typeLine, gameChanger }).
  // Returns { commander, bracket, name, reasons, gameChangers, tutors, extraTurns, landDenial, combos, unchecked }.
  function estimate(rows, def) {
    const cards = rows.map(r => ({ row: r, card: def(r.id) || {} }));
    const size = rows.reduce((n, r) => n + (r.qty || 1), 0);
    const commander = rows.some(r => r.commander) || size >= 98;
    const list = pick => cards.filter(pick).map(({ row, card }) => ({ name: card.name || row.name, qty: row.qty || 1 }));
    const count = items => items.reduce((n, x) => n + x.qty, 0);
    const text = c => c.oracle || '';

    const gameChangers = list(({ card }) => card.gameChanger === true);
    const unchecked = cards.filter(({ card }) => typeof card.gameChanger !== 'boolean').length;
    const tutors = list(({ card }) => isTutor(text(card)));
    const extraTurns = list(({ card }) => isExtraTurn(text(card)));
    const landDenial = list(({ card }) => isLandDenial(text(card)));

    const byName = new Map();
    cards.forEach(({ row, card }) => byName.set(key(card.name || row.name), card));
    const combos = COMBOS.filter(([a, b]) => byName.has(key(a)) && byName.has(key(b))).map(([a, b]) => {
      const mv = (byName.get(key(a)).cmc || 0) + (byName.get(key(b)).cmc || 0);
      return { cards: [a, b], mv, early: mv <= EARLY_MV };
    });

    const reasons = [];
    let bracket = 2;
    const atLeast = (b, why) => { reasons.push({ bracket: b, why }); if (b > bracket) bracket = b; };
    const nGc = count(gameChangers);
    if (nGc > 3) atLeast(4, `${nGc} Game Changers (Bracket 3 allows up to 3)`);
    else if (nGc) atLeast(3, `${nGc} Game Changer${nGc === 1 ? '' : 's'} (Brackets 1 and 2 allow none)`);
    if (landDenial.length) atLeast(4, 'Mass land denial (only Bracket 4 and up)');
    const early = combos.filter(c => c.early);
    if (early.length) atLeast(4, 'Two-card combo that can go off early (only Bracket 4 and up)');
    else if (combos.length) atLeast(3, 'Two-card combo, but a late-game one (Bracket 3 allows those)');
    const nTurns = count(extraTurns);
    if (nTurns >= 5) atLeast(4, `${nTurns} extra-turn cards, enough to chain them (Brackets 1 to 3 shouldn't)`);
    else if (nTurns >= 3) atLeast(3, `${nTurns} extra-turn cards (Brackets 1 and 2 keep them to a few)`);
    const nTutors = count(tutors);
    if (nTutors > 3) atLeast(3, `${nTutors} tutors (Brackets 1 and 2 keep them to a few)`);

    return { commander, bracket, name: NAMES[bracket], reasons, gameChangers, tutors, extraTurns, landDenial, combos, unchecked };
  }

  return { estimate, isTutor, isExtraTurn, isLandDenial, COMBOS, NAMES };
})();

if (typeof module !== 'undefined') module.exports = Brackets;
