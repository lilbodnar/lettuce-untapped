#!/usr/bin/env node
// Writes simulator/js/precons.js: the commander(s) of every Commander precon on MTGJSON, so the
// Simulator's precon list can show them without downloading every deck. Run it again when new
// precons come out (the list shows the ones it doesn't know yet without a commander).
//
//   node tools/precon-commanders.js
const fs = require('fs');
const path = require('path');

const API = 'https://mtgjson.com/api/v5';
const OUT = path.join(__dirname, '..', 'simulator', 'js', 'precons.js');

(async () => {
  const list = (await (await fetch(`${API}/DeckList.json`)).json()).data.filter(d => d.type === 'Commander Deck' && d.fileName);
  const map = {};
  let done = 0;
  // A few at a time, to be gentle with MTGJSON.
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async d => {
      try {
        const deck = (await (await fetch(`${API}/decks/${encodeURIComponent(d.fileName)}.json`)).json()).data;
        const names = [...new Set((deck.commander || []).map(c => c.name))];
        if (names.length) map[d.fileName] = names;
      } catch (e) {
        console.error(`${d.fileName}: ${e.message}`);
      }
      done++;
    }));
    process.stdout.write(`\r${done}/${list.length}`);
  }
  const body = Object.keys(map).sort().map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`).join('\n');
  fs.writeFileSync(OUT, `// The commanders of Commander precons on MTGJSON, by deck file name. Made by tools/precon-commanders.js
// (run it again to add newer precons).
const PRECON_COMMANDERS = {
${body}
};
if (typeof module !== 'undefined') module.exports = PRECON_COMMANDERS;
`);
  console.log(`\nWrote ${Object.keys(map).length} precons to ${OUT}`);
})();
