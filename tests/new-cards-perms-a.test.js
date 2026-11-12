// New permanents A (Star Trek and other Nov 2026 cards).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./new-cards-perms-a-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every new permanents a (star trek and other nov 2026 cards) card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("At the beginning of your end step, each player creates two 1/1 white Tribble creature tokens with \"This token can't block.\""), "At the beginning of your end step, create two 1/1 white Tribble creature tokens."); // Koloth, Tribble Hunter
  assert.equal(plain("Whenever you attack while creatures you control have total power 8 or greater, target attacking creature gets +2/+0 and gains first strike until end of turn."), "Whenever you attack, target attacking creature gets +2/+0 and gains first strike until end of turn."); // Una Chin-Riley, Number One
  assert.equal(plain("When Kang enters, choose target creature an opponent controls. Kang and that creature are goaded for as long as you control Kang."), "When this creature enters, goad target creature an opponent controls."); // Kang, Suspicious Captain
  assert.equal(plain("When Deep Space 9 enters and at the beginning of your upkeep, exile the top four cards of your library. Put all permanent cards exiled this way onto the battlefield."), "When this Spacecraft enters and at the beginning of your upkeep, exile the top four cards of your library. You may play them this turn."); // Deep Space 9
  assert.equal(plain("I — This Saga deals 4 damage to target creature an opponent controls. At the beginning of the next combat this turn, gain control of that creature until end of turn. Untap it. It gains haste until end of turn."), "I — This Saga deals 4 damage to target creature an opponent controls."); // The Wrath of Khan
  assert.equal(plain("Whenever you face a dilemma, put a +1/+1 counter on this creature."), "Whenever you cast a noncreature spell, put a +1/+1 counter on this creature."); // Melkotian Adjudicator
  assert.equal(plain("Landfall — Whenever a land you control enters, put a quest counter on this enchantment. Then exile cards from the top of your library until you exile a nonland card. You may play that card this turn. If this enchantment has five or more quest counters on it, add {R}{R}."), "Whenever a land you control enters, put a quest counter on this enchantment. Then exile the top card of your library. You may play that card this turn."); // Exploratory Mission
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Tap seven untapped Officers you control: Search your library for a Spacecraft card, put it onto the battlefield with seven charge counters on it, then shuffle."), "This ability is never activated.");
});
