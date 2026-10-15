const test = require('node:test');
const assert = require('node:assert/strict');
const Odds = require('../simulator/js/odds.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} should be about ${b}`);

test('opening hand distribution adds up to 1', () => {
  close(Odds.handDistribution(99, 37).reduce((s, p) => s + p, 0), 1);
});

test('matches hand-worked hypergeometric values', () => {
  // 4 copies in 60 cards, 7-card hand: chance of none = C(56,7)/C(60,7)
  close(Odds.exactly(60, 4, 7, 0), 0.6005, 1e-4);
  close(Odds.atLeast(60, 4, 7, 1), 0.3995, 1e-4);
});

test('cards seen depends on play/draw', () => {
  assert.equal(Odds.seenBy(1, false), 7);
  assert.equal(Odds.seenBy(1, true), 8);
  assert.equal(Odds.seenBy(3, false), 9);
});

test('impossible draws are 0, certain ones are 1', () => {
  assert.equal(Odds.atLeast(60, 0, 7, 1), 0);
  close(Odds.atLeast(60, 60, 7, 7), 1);
});
