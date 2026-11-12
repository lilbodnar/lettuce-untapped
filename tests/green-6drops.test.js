// Mono-green 6-drop creatures.
const test = require('node:test');
const assert = require('node:assert/strict');
global.Game = require('../simulator/js/game.js');
const Bot = require('../simulator/js/bot.js');
global.Bot = Bot;
const Coverage = require('../simulator/js/coverage.js');

const cards = require('./green-6drops-cards.json');
const plain = l => Bot.parts.plainLine(l);

test('every mono-green 6-drop creatures card here is done for you', () => {
  for (const [id, card] of Object.entries(cards)) {
    const r = Coverage.check(card);
    assert.equal(r.you, 'all', `${id}: ${JSON.stringify(r.lines.filter(l => l.gaps.length).map(l => l.gaps))}`);
  }
});

test('lines read as the simpler abilities they amount to', () => {
  assert.equal(plain("Whenever Skanos, Green Dragon Vassal attacks, untap another target attacking creature. It gets +X/+0 until end of turn, where X is Skanos's power."), "Whenever this creature attacks, another target attacking creature gets +6/+0 until end of turn."); // Skanos, Green Dragon Vassal
  assert.equal(plain("When Rhino enters, destroy target artifact or land. Distribute three +1/+1 counters among up to three other target creatures. They gain trample until end of turn."), "When this creature enters, destroy target artifact or land. Put three +1/+1 counters on another target creature."); // Rhino, Terrible Trampler
  assert.equal(plain("Council's dilemma — When this creature enters, starting with you, each player votes for sprout or harvest. Put two +1/+1 counters on this creature for each sprout vote. You gain 3 life for each harvest vote."), "When this creature enters, put two +1/+1 counters on this creature. You gain 3 life."); // Orchard Elemental
  assert.equal(plain("Masumaro's power and toughness are each equal to twice the number of cards in your hand."), "This creature's power and toughness are each equal to the number of cards in your hand."); // Masumaro, First to Live
  assert.equal(plain("When Bumi enters, choose up to X, where X is the number of Lesson cards in your graveyard —"), "When this creature enters, choose one —"); // Bumi, King of Three Trials
  assert.equal(plain("Whenever Quickbeam or another Treefolk you control enters, up to two target creatures each get +2/+2 and gain trample until end of turn."), "Whenever this creature or another Treefolk you control enters, target creature gets +2/+2 and gains trample until end of turn."); // Quickbeam, Upstart Ent
  assert.equal(plain("When this creature enters, each player searches their library for up to two basic land cards, puts them onto the battlefield, then shuffles."), "When this creature enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle."); // Avatar of Growth
  assert.equal(plain("When Iname dies, you may exile it. If you do, return any number of target Spirit cards from your graveyard to your hand."), "When this creature dies, return target Spirit card from your graveyard to your hand."); // Iname, Life Aspect
});

test('lines that are not applied are switched off', () => {
  assert.equal(plain("You may cast this card from your graveyard by removing six counters from among creatures you control in addition to paying its other costs."), "This ability is never activated.");
});
