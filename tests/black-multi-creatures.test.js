// Multicolor black creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./black-multi-creatures-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every multicolor black creatures card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever Kroxa enters or attacks, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life."), "Whenever this creature enters or attacks, each opponent discards a card. Each opponent loses 3 life."); // Kroxa, Titan of Death's Hunger
  assert.equal(plain("{2}, Sacrifice a creature: Lyzolda deals 2 damage to any target if the sacrificed creature was red. Draw a card if the sacrificed creature was black."), "{2}, Sacrifice a creature: This creature deals 2 damage to any target. Draw a card."); // Lyzolda, the Blood Witch
  assert.equal(plain("{X}{B/G}, {T}, Sacrifice another creature: Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Activate only as a sorcery."), "{2}{B}, {T}, Sacrifice another creature: Search your library for a creature card, put it onto the battlefield, then shuffle."); // Fiend Artisan
  assert.equal(plain("{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life."), "{B}, {T}: Exile target card from a graveyard. Each opponent loses 2 life."); // Deathrite Shaman
  assert.equal(plain("When Rakdos enters, flip a coin for each creature that isn't a Demon, Devil, or Imp. Destroy each creature whose coin comes up tails."), "When this creature enters, destroy all other creatures."); // Rakdos, the Showstopper
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("At the beginning of each combat, if Gitrog, Horror of Zhava is untapped, any opponent may sacrifice a nontoken creature. If they do, tap Gitrog, Horror of Zhava, then seek a land card and put it onto the battlefield tapped."), 'This ability is never activated.');
});
