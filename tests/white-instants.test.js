// White instants (mono and multicolor).
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./white-instants-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every white instant here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler spells they amount to', () => {
  assert.equal(plain('Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle.'), 'Exile target attacking creature.'); // Settle the Wreckage (one, no lands)
  assert.equal(plain("Target player can't cast spells this turn. If this spell was kicked, creatures can't attack this turn."), 'Tap all creatures your opponents control.'); // Orim's Chant
  assert.equal(plain('Prevent all combat damage that would be dealt by target attacking creature this turn.'), 'Tap target creature.'); // Restrain
  assert.equal(plain("Put target artifact or enchantment on top of its owner's library."), "Return target artifact or enchantment to its owner's hand."); // Disempower
  assert.equal(plain('Kabira Takedown deals damage equal to the number of creatures you control to target creature or planeswalker.'), 'This spell deals 3 damage to target creature.');
  assert.equal(plain('Metalcraft — That player sacrifices two attacking creatures of their choice instead if you control three or more artifacts.'), ''); // Dispense Justice (one creature)
  assert.equal(plain('Prevent the next 3 damage that would be dealt to any target this turn.'), 'Nothing happens here.'); // (prevention like this isn't applied)
  assert.equal(plain('Draw a card.'), 'Draw a card.'); // (shared lines that work elsewhere stay as they are)
});

test('these timings and costs are only about casting the spell', () => {
  for (const l of ['Cast this spell only during combat after blockers are declared.', 'Cast this spell only during combat before blockers are declared.', 'Cast this spell only after combat.',
    'Cast this spell only during the declare blockers step.', "Cast this spell only during an opponent's upkeep.",
    "If you control a Plains, you may tap an untapped creature you control rather than pay this spell's mana cost.", 'As an additional cost to cast this spell, discard X cards.']) {
    assert.ok(Bot.parts.CAST_ONLY.test(l), l);
  }
});
