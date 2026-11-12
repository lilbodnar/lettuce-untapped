#!/usr/bin/env node
// When a new set comes out: downloads Scryfall's latest "Oracle Cards" file (only if it changed since the
// last download), runs every card through simulator/js/coverage.js, and lists the ones the Simulator
// doesn't play by itself yet. Joke sets (Unglued, Unhinged, Unstable, Unsanctioned, Unfinity and other
// "funny" sets) are left out.
//
//   node tools/new-cards.js [work-dir] [--offline]
//
// work-dir (default: <system temp>/mtg-tracker-cards) keeps the downloaded file and gets:
//   not-done.txt                  every card that isn't done, by set
//   not-done-spells.json          the instants and sorceries among them, as test fixtures ({ name: card })
//   not-done-permanents-N.json    the rest, in groups of at most 100
// The fixtures are what the line-rewrite batches start from (see tools/add-lines.js).
// --offline: use the file already in work-dir, don't check Scryfall.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
global.Game = require('../simulator/js/game.js');
global.Bot = require('../simulator/js/bot.js');
const Coverage = require('../simulator/js/coverage.js');

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const dir = path.resolve(args.find(a => !a.startsWith('--')) || path.join(os.tmpdir(), 'mtg-tracker-cards'));
fs.mkdirSync(dir, { recursive: true });
const bulk = path.join(dir, 'oracle-cards.jsonl');
const stamp = path.join(dir, 'oracle-cards.updated');
const HEADERS = { 'User-Agent': 'MTGTracker/1.0', Accept: 'application/json;q=0.9,*/*;q=0.8' }; // Scryfall asks for both

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: HEADERS }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(get(res.headers.location)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url}: HTTP ${res.statusCode}`)); }
      resolve(res);
    }).on('error', reject);
  });
}
const readAll = res => new Promise((resolve, reject) => { const b = []; res.on('data', d => b.push(d)); res.on('end', () => resolve(Buffer.concat(b))); res.on('error', reject); });

async function download() {
  const meta = JSON.parse(String(await readAll(await get('https://api.scryfall.com/bulk-data/oracle-cards'))));
  const had = fs.existsSync(stamp) && fs.existsSync(bulk) ? fs.readFileSync(stamp, 'utf8').trim() : '';
  if (had === meta.updated_at) { console.log(`Card file is up to date (${meta.updated_at}).`); return; }
  const url = meta.jsonl_download_uri;
  if (!url) throw new Error('Scryfall gave no jsonl_download_uri');
  console.log(`Downloading ${url} …`);
  const res = await get(url);
  const tmp = bulk + '.part';
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    (/\.gz$/.test(url) ? res.pipe(zlib.createGunzip()) : res).pipe(out);
    out.on('finish', resolve); out.on('error', reject); res.on('error', reject);
  });
  fs.renameSync(tmp, bulk);
  fs.writeFileSync(stamp, meta.updated_at);
  console.log(`Saved ${bulk} (${meta.updated_at}).`);
}

// The card as js/scryfall.js keeps it (only what the Simulator reads); same as tools/coverage-report.js.
function simplify(c) {
  const faces = c.card_faces || [];
  const face = faces[0] || {};
  const d = {
    id: c.name, name: c.name,
    typeLine: String(c.type_line || face.type_line || '').replace(/^Summon(?: —)? (.+)$/, 'Creature — $1'),
    manaCost: c.mana_cost || face.mana_cost || '', cmc: c.cmc || 0, colors: c.colors || face.colors || [],
    oracle: c.oracle_text || faces.map(f => `${f.name}: ${f.oracle_text || ''}`).join('\n\n'),
  };
  for (const k of ['power', 'toughness', 'loyalty']) if (c[k] || face[k]) d[k] = c[k] || face[k];
  if ((c.produced_mana || []).length) d.producedMana = c.produced_mana;
  return d;
}
const SKIP_LAYOUTS = new Set(['art_series', 'token', 'double_faced_token', 'emblem', 'planar', 'scheme', 'vanguard', 'augment', 'host']);
const isJoke = c => (c.set_type || '') === 'funny' || /\bUn(glued|hinged|stable|sanctioned|finity)\b/.test(c.set_name || '');

function report() {
  const seen = new Set(); const left = []; let total = 0;
  for (const raw of fs.readFileSync(bulk, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    let c; try { c = JSON.parse(raw.replace(/,\s*$/, '')); } catch (e) { continue; }
    if (SKIP_LAYOUTS.has(c.layout) || seen.has(c.name) || isJoke(c)) continue;
    seen.add(c.name); total++;
    const d = simplify(c);
    let r; try { r = Coverage.check({ ...d, producedMana: d.producedMana || [] }); } catch (e) { r = { you: 'error', lines: [] }; }
    if (r.you !== 'all') left.push({ d, set: c.set_name || '?', you: r.you, gaps: (r.lines || []).flatMap(l => l.gaps.filter(g => g.side !== 'opp').map(g => g.phrase)) });
  }
  const bySet = {};
  left.forEach(x => (bySet[x.set] = bySet[x.set] || []).push(x));
  const text = [`${total} cards (joke sets left out), ${left.length} not done.`, '']
    .concat(...Object.entries(bySet).sort((a, b) => b[1].length - a[1].length).map(([set, xs]) =>
      [`${set} (${xs.length})`, ...xs.map(x => `  ${x.d.name} [${x.you}]${x.gaps.length ? ': ' + x.gaps.slice(0, 2).join(' | ').slice(0, 160) : ''}`), '']));
  fs.writeFileSync(path.join(dir, 'not-done.txt'), text.join('\n'));
  for (const f of fs.readdirSync(dir)) if (/^not-done-.*\.json$/.test(f)) fs.unlinkSync(path.join(dir, f));
  const isSpell = d => /^(?:(?:Tribal|Kindred) )?(Instant|Sorcery)\b/.test(d.typeLine.split(' // ')[0]);
  const spells = left.filter(x => isSpell(x.d)), perms = left.filter(x => !isSpell(x.d));
  const write = (name, xs) => { if (xs.length) fs.writeFileSync(path.join(dir, name), JSON.stringify(Object.fromEntries(xs.map(x => [x.d.name, x.d])), null, 1)); };
  write('not-done-spells.json', spells);
  for (let i = 0; i * 100 < perms.length; i++) write(`not-done-permanents-${i + 1}.json`, perms.slice(i * 100, i * 100 + 100));
  console.log(text.slice(0, 2).join('\n') + `Spells ${spells.length}, permanents ${perms.length}. Details: ${path.join(dir, 'not-done.txt')}`);
  Object.entries(bySet).sort((a, b) => b[1].length - a[1].length).slice(0, 10).forEach(([s, xs]) => console.log(`  ${s}: ${xs.length}`));
}

(async () => {
  if (!offline) await download();
  else if (!fs.existsSync(bulk)) throw new Error(`no card file at ${bulk}; run without --offline first`);
  report();
})().catch(e => { console.error(e.message || e); process.exit(1); });
