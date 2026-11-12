// Mono-green 3-drop creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-3drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-green 3-drop creatures card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("When this creature enters, it explores, then it explores again."), "When this creature enters, it explores."); // Jadelight Ranger
  assert.equal(plain("You may exert this creature as it attacks. When you do, it gets +2/+2 until end of turn."), "Whenever this creature attacks, it gets +2/+2 until end of turn."); // Hooded Brawler
  assert.equal(plain("Whenever this creature deals combat damage to a player, that player loses 2 life at the beginning of their next draw step unless they pay {2} before that step."), "Whenever this creature deals combat damage to a player, that player loses 2 life."); // Glass Asp
  assert.equal(plain("When this creature enters, you may discard a card. If you do, search your library for a creature card, reveal it, put it into your hand, then shuffle."), "When this creature enters, discard a card, then search your library for a creature card, reveal it, put it into your hand, then shuffle."); // Formidable Speaker
  assert.equal(plain("Other Elf creatures get +1/+1 and have forestwalk."), "Other Elf creatures you control get +1/+1."); // Elvish Champion
  assert.equal(plain("You may play two additional lands on each of your turns."), "You may play an additional land on each of your turns."); // Azusa, Lost but Seeking
  assert.equal(plain("{1}{G}, Sacrifice this creature: Two target creatures each get +2/+2 until end of turn."), "{1}{G}, Sacrifice this creature: Target creature gets +2/+2 until end of turn."); // Twigwalker
  assert.equal(plain("This creature enters with two +1/+1 counters on it for each other nontoken Human you control."), "This creature enters with two +1/+1 counters on it."); // Hamlet Vanguard
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("Each creature you control can't be blocked as long as defending player controls an artifact land."), "This ability is never activated.");
});
