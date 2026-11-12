// Shared by tests/smoke-games.test.js and a long run from the command line:
//   node tests/smoke-games.js [games] [first seed]
// Random 40-card decks made of the cards in the tests' card fixtures (tests/*-cards.json) play each other
// with Opp's rules on both sides (autoplay.js). A game fails when anything throws, or the game ends up in
// a state that can't be right (a card in no zone, a life total that isn't a number). Every game has its
// own seed, so a failure can be played again exactly: node tests/smoke-games.js 1 <seed>.
const fs = require('fs');
const path = require('path');
global.Game = global.Game || require('../simulator/js/game.js');
global.Bot = global.Bot || require('../simulator/js/bot.js');
const Autoplay = require('../simulator/js/autoplay.js');

const BASICS = {
  W: { id: 'b-plains', name: 'Plains', typeLine: 'Basic Land — Plains', producedMana: ['W'], oracle: '', colors: [] },
  U: { id: 'b-island', name: 'Island', typeLine: 'Basic Land — Island', producedMana: ['U'], oracle: '', colors: [] },
  B: { id: 'b-swamp', name: 'Swamp', typeLine: 'Basic Land — Swamp', producedMana: ['B'], oracle: '', colors: [] },
  R: { id: 'b-mountain', name: 'Mountain', typeLine: 'Basic Land — Mountain', producedMana: ['R'], oracle: '', colors: [] },
  G: { id: 'b-forest', name: 'Forest', typeLine: 'Basic Land — Forest', producedMana: ['G'], oracle: '', colors: [] },
};

let pool = null;
// Every card in the fixtures, once, keyed by id (the fixtures key cards by name).
function cardPool() {
  if (pool) return pool;
  pool = {};
  for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('-cards.json')).sort()) {
    let cards; try { cards = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch (e) { continue; }
    if (!cards || typeof cards !== 'object' || Array.isArray(cards)) continue;
    for (const [k, c] of Object.entries(cards)) {
      if (!c || typeof c !== 'object' || !c.typeLine || !c.name || /\bLand\b/.test(c.typeLine)) continue;
      const id = c.id || k;
      if (!pool[id]) pool[id] = { ...c, id, colors: c.colors || [], oracle: c.oracle || '' };
    }
  }
  return pool;
}

// A seeded game: a random color for each deck, 17 of its basic land and 23 random cards of that color (or colorless).
function playOne(seed) {
  Game.setSeed(seed);
  const all = cardPool();
  const ids = Object.keys(all);
  const pick = n => ids[Game.randomInt(n)];
  const deckOf = (label) => {
    const color = 'WUBRG'[Game.randomInt(5)];
    const fits = c => (c.colors || []).every(x => x === color);
    const rows = [{ id: BASICS[color].id, qty: 17 }];
    const used = new Set();
    for (let tries = 0; rows.length < 24 && tries < 5000; tries++) {
      const id = pick(ids.length);
      if (used.has(id) || !fits(all[id])) continue;
      used.add(id); rows.push({ id, qty: 1 });
    }
    return { key: label, name: `${label} (${color})`, rows };
  };
  const A = deckOf('A'), B = deckOf('B');
  const defs = { ...all };
  for (const b of Object.values(BASICS)) defs[b.id] = b;
  const cardsIn = d => d.rows.filter(r => !/^b-/.test(r.id)).map(r => r.id);
  try {
    const r = Autoplay.match(A, B, defs, { aFirst: Game.randomInt(2) === 0, maxTurns: 12, check: checkTables });
    if (!['A', 'B', null].includes(r.winner)) throw new Error(`odd winner ${r.winner}`);
    if (!(r.turns >= 1 && r.turns <= 12)) throw new Error(`odd turn count ${r.turns}`);
    return null;
  } catch (e) {
    return { seed, error: String(e && e.stack || e).split('\n').slice(0, 4).join('\n'), deckA: cardsIn(A), deckB: cardsIn(B) };
  }
}

// After every turn (autoplay's match calls it): every card listed in a zone is there, and life is a number.
function checkTables(players, turn) {
  for (const { s, life } of players) {
    if (typeof life !== 'number' || Number.isNaN(life)) throw new Error(`turn ${turn}: life is ${life}`);
    for (const z of Game.ZONES) for (const iid of s.zones[z]) {
      const c = s.cards[iid];
      if (!c) throw new Error(`a card id in ${z} has no card (${iid})`);
      if (c.zone !== z) throw new Error(`${c.name} is listed in ${z} but says it's in ${c.zone}`);
    }
  }
}

function run(games, firstSeed = 1) {
  const fails = [];
  for (let i = 0; i < games; i++) { const f = playOne(firstSeed + i); if (f) fails.push(f); }
  Game.setSeed(null);
  return fails;
}

module.exports = { run, playOne, cardPool, checkTables };

if (require.main === module) {
  const n = Number(process.argv[2]) || 200, seed = Number(process.argv[3]) || 1;
  const t0 = Date.now();
  const fails = run(n, seed);
  for (const f of fails) console.log(`\nseed ${f.seed}\n${f.error}\nA: ${f.deckA.join(' | ')}\nB: ${f.deckB.join(' | ')}`);
  console.log(`\n${n} games from seed ${seed}: ${fails.length} failed (${((Date.now() - t0) / 1000).toFixed(1)}s, ${Object.keys(cardPool()).length} cards in the pool)`);
}
