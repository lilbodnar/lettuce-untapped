/*
 * Exact draw odds (hypergeometric math), so there's no randomness in the numbers.
 *   N = cards in the library at the start, K = how many of them you care about,
 *   n = how many cards you've seen, k = how many hits you want.
 */
const Odds = (() => {
  'use strict';

  const logFact = [0];
  function lf(n) {
    for (let i = logFact.length; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
    return logFact[n];
  }
  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return lf(n) - lf(k) - lf(n - k);
  }

  // P(exactly k hits)
  function exactly(N, K, n, k) {
    n = Math.min(n, N);
    return Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n));
  }

  // P(at least k hits)
  function atLeast(N, K, n, k) {
    let p = 0;
    for (let i = k; i <= Math.min(K, n); i++) p += exactly(N, K, n, i);
    return Math.min(1, p);
  }

  // Cards seen by the start of your turn t (after that turn's draw).
  const seenBy = (turn, onDraw, hand = 7) => Math.max(0, hand + turn - (onDraw ? 0 : 1));

  function handDistribution(N, K, hand = 7) {
    const out = [];
    for (let k = 0; k <= hand; k++) out.push(exactly(N, K, hand, k));
    return out;
  }

  // For each turn: chance you have hit every land drop so far (at least t lands seen).
  function landDrops(N, lands, turns, onDraw) {
    const out = [];
    for (let t = 1; t <= turns; t++) {
      const n = seenBy(t, onDraw);
      out.push({ turn: t, seen: n, p: atLeast(N, lands, n, t), expected: (n * lands) / N });
    }
    return out;
  }

  // For each turn: chance you've seen at least one of K cards.
  function anyBy(N, K, turns, onDraw) {
    const out = [];
    for (let t = 1; t <= turns; t++) out.push({ turn: t, p: atLeast(N, K, seenBy(t, onDraw), 1) });
    return out;
  }

  // Chance that by your turn t you've seen at least t of the L lands AND at least one of the
  // K spells that cost t (the other cards make up the rest of what you've seen).
  function onCurve(N, L, K, turn, onDraw) {
    const n = Math.min(seenBy(turn, onDraw), N);
    const rest = N - L - K;
    const total = logChoose(N, n);
    let p = 0;
    for (let a = turn; a <= Math.min(L, n); a++) {
      for (let b = 1; b <= Math.min(K, n - a); b++) {
        p += Math.exp(logChoose(L, a) + logChoose(K, b) + logChoose(rest, n - a - b) - total);
      }
    }
    return Math.min(1, p);
  }

  return { exactly, atLeast, seenBy, handDistribution, landDrops, anyBy, onCurve };
})();

if (typeof module !== 'undefined') module.exports = Odds;
