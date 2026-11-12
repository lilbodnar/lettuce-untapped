#!/usr/bin/env node
// Adds line rewrites to simulator/js/wp-lines.js (the table bot.js reads whole oracle lines through).
//
//   node tools/add-lines.js <map.json> [label]     add every entry of the map (keeps the file sorted)
//   node tools/add-lines.js --remove <map.json>    take that map's keys out again
//
// map.json is { "map": { "exact oracle line": "line it plays as", … } } or just the { line: replacement } object.
// A replacement of "This ability is never activated." (permanents) / "Nothing happens here." (spells) switches
// a line off; "" drops it. Lines already in the table are left as they are and listed.
// Afterwards run tools/new-cards.js --offline (or the batch's own tests) to check every card is done.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'simulator', 'js', 'wp-lines.js');
const args = process.argv.slice(2);
const remove = args[0] === '--remove';
const [mapFile, label] = remove ? args.slice(1) : args;
if (!mapFile) { console.error('usage: node tools/add-lines.js [--remove] <map.json> [label]'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const map = raw && typeof raw.map === 'object' ? raw.map : raw;

const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('const WpLines = {\n'), end = src.indexOf('\n};\n', start);
if (start < 0 || end < 0) throw new Error('wp-lines.js: table not found');
delete require.cache[require.resolve(file)];
const table = { ...require(file) };

let added = 0, removed = 0; const kept = [];
for (const [k, v] of Object.entries(map)) {
  if (remove) { if (Object.prototype.hasOwnProperty.call(table, k)) { delete table[k]; removed++; } continue; }
  if (typeof v !== 'string') throw new Error(`not a string: ${k}`);
  if (Object.prototype.hasOwnProperty.call(table, k)) { if (table[k] !== v) kept.push(k); continue; }
  table[k] = v; added++;
}
let head = src.slice(0, start);
if (!remove && label && added) head = head.replace(/\n \*\/\n$/, `\n *   (${label})\n */\n`);
const body = Object.keys(table).sort().map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])},`).join('\n');
fs.writeFileSync(file, `${head}const WpLines = {\n${body}${src.slice(end)}`);
kept.forEach(k => console.log('already there with another replacement, left as it is:', k.slice(0, 100)));
console.log(remove ? `removed ${removed}` : `added ${added}`, `(table: ${Object.keys(table).length} lines)`);
