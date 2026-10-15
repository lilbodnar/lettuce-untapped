/*
 * Reads Archidekt "Text" exports in this format (one card per line):
 *   1x Example Card (set) 123 *F* [Example category] ^Buy,#0066ff^
 * Everything after the name is optional, so plain "1 Sol Ring" lines also work.
 */
const ArchidektParser = (() => {
  'use strict';

  function parseLine(raw) {
    let line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) return null;

    // Tags at the end: ^Buy,#0066ff^ (there can be more than one)
    const tags = [];
    let m;
    while ((m = line.match(/\s*\^([^^]*)\^\s*$/))) {
      const label = m[1].split(',').find(part => part && !part.startsWith('#'));
      if (label) tags.unshift(label.trim());
      line = line.slice(0, m.index);
    }

    // Categories: [Ramp,Maybeboard{noDeck}{noPrice}]
    let categories = [];
    let inDeck = true;
    if ((m = line.match(/\s*\[([^\]]*)\]\s*$/))) {
      for (const part of m[1].split(',')) {
        const flags = part.match(/\{[^}]*\}/g) || [];
        if (flags.some(f => f.toLowerCase() === '{nodeck}')) inDeck = false;
        const name = part.replace(/\{[^}]*\}/g, '').trim();
        if (name) categories.push(name);
      }
      line = line.slice(0, m.index);
    }

    // Finish markers: *F* = foil, *E* = etched
    let finish = 'nonfoil';
    while ((m = line.match(/\s*\*([A-Za-z]+)\*\s*$/))) {
      const code = m[1].toUpperCase();
      if (code === 'F') finish = 'foil';
      else if (code === 'E') finish = 'etched';
      line = line.slice(0, m.index);
    }

    // Quantity: "1x " or "1 "
    m = line.match(/^(\d+)\s*x?\s+/i);
    if (!m) return { error: true, raw };
    const qty = parseInt(m[1], 10);
    line = line.slice(m[0].length);

    // Set and collector number: "(cmm) 410"
    let set = null;
    let cn = null;
    if ((m = line.match(/\s+\(([A-Za-z0-9]+)\)\s+(\S+)$/))) {
      set = m[1].toLowerCase();
      cn = m[2];
      line = line.slice(0, m.index);
    } else if ((m = line.match(/\s+\(([A-Za-z0-9]{2,6})\)$/))) {
      set = m[1].toLowerCase();
      line = line.slice(0, m.index);
    }

    const name = line.trim();
    if (!name || qty < 1) return { error: true, raw };
    return { qty, name, set, cn, finish, categories, inDeck, tags };
  }

  // Section headings used by Moxfield, Arena and MTGO lists ("Commander", "SIDEBOARD:", "// Maybeboard").
  // Cards below one get that category, and sideboard/maybeboard cards are kept out of the deck.
  const SECTIONS = [
    [/^commanders?$/, 'Commander', true],
    [/^companions?$/, 'Companion', false],
    [/^(deck|main|mainboard|main deck)$/, null, true],
    [/^sideboard$/, 'Sideboard', false],
    [/^(maybeboard|maybe|considering)$/, 'Maybeboard', false],
  ];
  function sectionOf(raw) {
    const s = raw.trim().replace(/^\/\/\s*/, '').replace(/:$/, '').replace(/\s*\(\d+\)$/, '').trim().toLowerCase();
    const hit = SECTIONS.find(([re]) => re.test(s));
    return hit ? { category: hit[1], inDeck: hit[2] } : null;
  }

  function parse(text) {
    const entries = [];
    const errors = [];
    let section = null;
    for (const raw of text.split(/\r?\n/)) {
      const heading = sectionOf(raw);
      if (heading) { section = heading; continue; }
      const result = parseLine(raw);
      if (!result) continue;
      if (result.error) { errors.push(result.raw.trim()); continue; }
      if (section && !result.categories.length) {
        if (section.category) result.categories = [section.category];
        result.inDeck = section.inDeck;
      }
      entries.push(result);
    }
    return { entries, errors };
  }

  return { parse, parseLine };
})();

if (typeof module !== 'undefined') module.exports = ArchidektParser;
