#!/usr/bin/env node
// Runs every card in Scryfall's "Oracle Cards" bulk file through simulator/js/coverage.js and
// writes coverage.json: how many cards the Simulator plays on its own (yours and Opp's), and the
// wordings it doesn't do, most common first. Deck CSVs (Archidekt/MTG Tracker exports) get a
// card-by-card list too.
//
//   node tools/coverage-report.js <oracle-cards.jsonl> <out-dir> [deck.csv …]
//
// Get the bulk file from https://api.scryfall.com/bulk-data/oracle-cards (jsonl_download_uri, gunzip it).
const fs = require('fs');
const path = require('path');
global.Game = require('../simulator/js/game.js');
global.Bot = require('../simulator/js/bot.js');
const Coverage = require('../simulator/js/coverage.js');

const [bulk, outDir, ...decks] = process.argv.slice(2);
if (!bulk || !outDir) {
  console.error('usage: node tools/coverage-report.js <oracle-cards.jsonl> <out-dir> [deck.csv …]');
  process.exit(1);
}

// The card as js/scryfall.js keeps it (only what the Simulator reads).
function simplify(c) {
  const faces = c.card_faces || [];
  const face = faces[0] || {};
  return {
    name: c.name,
    typeLine: c.type_line || face.type_line || '',
    manaCost: c.mana_cost || face.mana_cost || '',
    cmc: c.cmc || 0,
    colors: c.colors || face.colors || [],
    oracle: c.oracle_text || faces.map(f => `${f.name}: ${f.oracle_text || ''}`).join('\n\n'),
    power: c.power || face.power || null,
    toughness: c.toughness || face.toughness || null,
    loyalty: c.loyalty || face.loyalty || null,
    producedMana: c.produced_mana || [],
    uri: c.scryfall_uri,
  };
}

// Real, playable paper cards: no tokens, art cards, joke sets or digital-only cards.
const SKIP_LAYOUTS = ['token', 'double_faced_token', 'art_series', 'emblem', 'planar', 'scheme', 'vanguard', 'reversible_card'];
const playable = c => !SKIP_LAYOUTS.includes(c.layout) && c.set_type !== 'funny' && c.set_type !== 'memorabilia'
  && ['vintage', 'commander', 'legacy'].some(f => c.legalities && c.legalities[f] !== 'not_legal');

const raw = fs.readFileSync(bulk, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const cards = raw.filter(playable).map(simplify);
const byName = new Map(cards.map(c => [c.name.toLowerCase(), c]));
for (const c of cards) if (c.name.includes(' // ')) byName.set(c.name.split(' // ')[0].toLowerCase(), c);

const tally = { you: { all: 0, some: 0, none: 0 }, opp: { all: 0, some: 0, none: 0, never: 0 } };
const never = {};
const gaps = new Map(); // "kind|side|phrase" → { kind, side, phrase, n, examples }
const results = new Map();
for (const card of cards) {
  const r = Coverage.check(card);
  results.set(card.name, r);
  tally.you[r.you]++;
  tally.opp[r.opp]++;
  if (r.oppSkips) never[r.oppSkips] = (never[r.oppSkips] || 0) + 1;
  const seen = new Set();
  for (const line of r.lines) {
    for (const g of line.gaps) {
      const key = `${g.kind}|${g.side}|${Coverage.phrase(card, g.phrase).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const e = gaps.get(key) || { kind: g.kind, side: g.side, phrase: Coverage.phrase(card, g.phrase), n: 0, examples: [] };
      e.n++;
      if (e.examples.length < 5) e.examples.push(card.name);
      gaps.set(key, e);
    }
  }
}

// One CSV row → { qty, name }.
function csvRows(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(',');
  return lines.map(l => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    const row = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
    return { qty: Number(row.Count || row.Quantity || 1), name: row.Name };
  });
}

const deckOut = decks.map(file => {
  const rows = csvRows(file).map(({ qty, name }) => {
    const key = String(name).toLowerCase();
    const card = byName.get(key) || byName.get(key.split(' // ')[0]); // "Sol Ring // Sol Ring" in some exports
    if (!card) return { qty, name, missing: true };
    const r = results.get(card.name) || Coverage.check(card);
    return {
      qty, name: card.name, typeLine: card.typeLine, you: r.you, opp: r.opp, oppSkips: r.oppSkips,
      lines: r.lines.filter(l => l.gaps.length).map(l => ({ text: l.text, gaps: l.gaps })),
    };
  });
  return { deck: path.basename(file).replace(/-\d{4}-\d{2}-\d{2}\.csv$/, '').replace(/_/g, ' '), rows };
});

const list = [...gaps.values()].sort((a, b) => b.n - a.n);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify({ made: new Date().toISOString(), cards: cards.length, tally, never, gaps: list, decks: deckOut }, null, 1));

const pct = (n, of) => `${n} (${Math.round((n / of) * 100)}%)`;
console.log(`${cards.length} cards`);
console.log(`Yours: all done ${pct(tally.you.all, cards.length)}, partly ${pct(tally.you.some, cards.length)}, none ${pct(tally.you.none, cards.length)}`);
console.log(`Opp's: all done ${pct(tally.opp.all, cards.length)}, partly ${pct(tally.opp.some, cards.length)}, none ${pct(tally.opp.none, cards.length)}, never cast ${pct(tally.opp.never, cards.length)}`);
console.log('Never cast:', never);
for (const kind of ['keyword', 'trigger', 'effect', 'activated', 'spell', 'static', 'cost', 'mana', 'loyalty']) {
  console.log(`\n== ${kind} ==`);
  list.filter(g => g.kind === kind).slice(0, 25).forEach(g => console.log(`${String(g.n).padStart(5)}  [${g.side}] ${g.phrase.slice(0, 110)}   e.g. ${g.examples.slice(0, 2).join('; ')}`));
}
for (const d of deckOut) {
  const t = side => d.rows.filter(r => !r.missing).reduce((o, r) => { o[r[side]] = (o[r[side]] || 0) + 1; return o; }, {});
  console.log(`\n${d.deck}: yours ${JSON.stringify(t('you'))}, Opp's ${JSON.stringify(t('opp'))}${d.rows.some(r => r.missing) ? `, not found: ${d.rows.filter(r => r.missing).map(r => r.name).join('; ')}` : ''}`);
}
