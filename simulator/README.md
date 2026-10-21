# MTG Simulator

Playtest your Magic: The Gathering decks on a virtual table, and see the odds of drawing what you need. You don't need to own the cards.

The Simulator comes with MTG Tracker. It lives in the Tracker's `simulator` folder.

- **Decks**: uses the decks you already imported into MTG Tracker, or any list you paste in
- **Play**: draw, play, tap, attack, make tokens, track life and mana, mulligan, scry, search, undo
- **Online**: play against up to 3 friends over the internet, each with their own deck
- **Odds**: chance of lands in your opening hand, hitting land drops, your mana curve, and the chance to draw a type of card (like Ramp) by each turn

Card data and images come from [Scryfall](https://scryfall.com) (free, no account needed).

## Getting started

1. Open MTG Tracker. The Simulator's pages are tabs at the right of its tab bar: **Playtest**, **Play**, **Odds**, **Auto-test** and **Help**. Your game keeps going while you use the other tabs. (The Simulator's own address, [lilbodnar.github.io/lettuce-untapped/simulator](https://lilbodnar.github.io/lettuce-untapped/simulator/), opens MTG Tracker on its Playtest tab. Add `?standalone` to it for the Simulator on its own page.)
2. Your MTG Tracker decks show up on the **Playtest** tab (called **Decks** below, which is its name on its own page). Click **Play**. Or, on a deck's page in MTG Tracker, click **▶ Play**, **Play vs computer** or **Odds** to open that deck straight away.

Use Chrome or Edge, and the same browser for both.

You need internet so it can load card pictures.

## Getting decks from MTG Tracker

The Simulator reads MTG Tracker's saved data directly, as long as both are opened in the same browser on the same computer, and both online or both from the same downloaded folder. The dot in the top right turns green when it's linked.

- Changed a deck in the Tracker? Click **Refresh** on the Decks tab.
- The Simulator only reads from the Tracker. It never changes your collection or decks.
- Maybeboard and sideboard cards are left out. Cards in the **Commander** category start in the command zone.

If your decks don't appear (for example in Firefox, or on a different computer): in MTG Tracker go to **Account & backup → Download backup**, then click **Load backup file…** on the Simulator's Decks tab.

## Playing decks you don't own

**Precons:** on the Decks tab, click **Show precons** under **Precon decks**, search by name, set or year, and click **Add**. Every Commander precon Wizards has printed is there (the lists come from [MTGJSON](https://mtgjson.com)). It joins Your Simulator decks, ready to play or to pick as Opp's deck.

**Any list:** on the Decks tab, paste a list into **Paste a deck list**, give it a name, and click **Import deck**. Lists from Archidekt, Moxfield, MTG Arena, or plain text like `1 Sol Ring` all work. To mark the commander, use a `[Commander]` category, a `*CMDR*` tag, or put it under a `Commander` heading. Sideboard sections are skipped.

## Playing

| To do this | Do this |
|---|---|
| Play a card from your hand | Click it (lands go to the bottom of the table) |
| Tap or untap | Click the card on the table |
| Make mana | Tap a land: its mana goes into the **Mana pool** automatically (a land that makes several colors asks which). Untapping takes it back out. **Free mana** shows what your untapped lands can still make |
| Mana from rocks and creatures | Click a mana rock (Sol Ring, Arcane Signet, Talismans) to tap it for mana, like a land. Creatures like Llanowar Elves just tap when clicked, since that's usually attacking: right-click → **Tap for … mana**. For anything else, click a color in the mana pool to add, right-click to remove |
| Move a card | Drag it: around the table, to your hand, graveyard, exile, or library (hold **Shift** for the bottom) |
| Counters, flip, face down | Right-click the card |
| Copy a card | Right-click → **Make a copy**, or **Make copies…** for several (tick **Copy its counters too** if you want them). Works on tokens too. Cards in your hand, graveyard or exile have **Make a token copy…** (for embalm and similar); the card stays where it is |
| Add or remove a counter | Click the counter on the card to add one, right-click to remove one |
| Any other counter (shield, stun, oil, +2/+2, anything) | Right-click the card → **Add any counter…**, or hover it and press **C**. Pick a common one or type your own name. Counters you type (like +1/+0) are saved: they show as buttons next time, and your 3 latest are right in the right-click menu |
| Draw | Click your library |
| Scry, search, mill | Right-click your library, or **More ▾**. When you scry, a card you send to the bottom leaves the view; you don't see the next one |
| Look through graveyard or exile | Click it |
| Make tokens | **Token…** — search Scryfall, click a common one, see the tokens your deck makes, or make your own |
| Cast your commander | Click it in the command zone. Commander tax is counted for you |
| Mulligan | **Mulligan** draws a new 7. Then right-click cards → **Bottom of library** |
| Next turn | **Next turn** untaps everything, empties the mana pool and draws. Online it's **Pass to … ▸** instead (see below) |
| Undo | **↶ Undo** or Ctrl+Z |

Some things happen automatically, and **Undo** reverses them if they're wrong:

- A card that says "When this enters, you gain / you lose / each opponent loses N life" changes life when it enters. Amounts like "X life" or "for each…" you do yourself.
- Lands that always enter tapped (like Scoured Barrens) come in tapped. "Enters tapped unless…" lands come in untapped, so tap them if needed.
- A card that says "When this enters, draw a card" (or "draw two cards") draws for you. Draws that say "you may", "if…" or "for each…" you do yourself.
- You can't end your turn (**Next turn**, or **Pass turn** online) with more than 7 cards in hand. You're asked to pick which ones to discard. Controlling a card with "You have no maximum hand size" (like Reliquary Tower) turns this off.

**Auto-tap lands:** tick it in the top bar and playing a spell taps what it needs. It spends floating mana in the pool first, then lands (single-color before dual lands where it can), then mana rocks, then mana creatures, and last Treasures and Lotus Petals, which are sacrificed. Creatures that arrived this turn can't tap for mana. Sol Ring is only used when the spell can use both mana; otherwise the extra goes into the pool. Commander tax is added. Rocks with an extra cost (like Signets' {1}) and "any one color" sources (like Gilded Lotus) aren't auto-tapped. Phyrexian symbols ({G/P}) are paid with 2 life only when you don't have the mana. If your untapped lands can't pay, the card is still played but nothing is tapped. Undo reverses it all in one step. Lands, and cards played face down, never auto-tap.

**Upkeep reminders:** at the start of your turn, cards that say "At the beginning of your upkeep" (or each upkeep, or have cumulative upkeep) flash and are listed under your stats until you click **Done**. The game doesn't do the trigger for you, it just makes sure you don't forget.

**Commander damage:** tracked under your stats. Online, there's a row for each friend's commander showing the damage it has dealt you; your friends see it on your panel too. Playing alone, it tracks what your commander has dealt to Opp. **+** also takes the life off, and you're warned at 21.

Keyboard: **N** next turn, **D** draw, **U** untap all, **S** shuffle, **T** tap the card under the mouse, **F** flip it, **Ctrl+Z** undo.

Your game is saved automatically, so you can close the page and come back later. A new game starts on turn 1 with that turn's card already drawn (8 cards in hand). **↺ Reset** starts the deck over with a fresh shuffle and hand (it asks first). **More ▾ → Restart** lets you choose on the play or on the draw. **✕ End game** clears the table, deletes the saved game and takes you back to the deck list.

**More than one game at a time:** every game you start is saved on its own and keeps going until you end it, even after you close the app. They're listed under **Your games** at the top of the **Decks** tab. Click **Continue** to pick one back up, or **Delete** to throw it away. Starting a new game with **Play** never replaces another one, so you can keep a game with one group of friends going while you play another. **More ▾ → Save and switch games** takes you to the list.

## Playing against the computer

On the **Decks** tab, under **Play against the computer**, pick your deck, Opp's deck (any of your decks) and who goes first, then click **Play**. Opp's table shows across the top, like a friend's would online.

Opp plays with simple rules:

- It keeps a hand with 2 to 5 lands, otherwise it mulligans once.
- Each turn it plays a land (one that adds a color it needs) and casts the biggest creatures, artifacts and enchantments it can afford. Its commander too, with tax.
- It casts simple removal ("Destroy target creature", "Exile target creature", "Return target creature to its owner's hand") on your best creature, burn ("deals 3 damage to any target") on a creature it can kill or at you, and simple card draw ("Draw two cards"). Its "When this enters, destroy target creature an opponent controls" (Ravenous Chupacabra) and similar triggers pick their own targets.
- **On your turn** (with **Responses** ticked in the top bar): it holds instant removal for when you attack (on your attacker, before blocks) or your end step, and it counters your spells that cost 3 or more (or your commander) with "Counter target spell" cards. For "unless its controller pays {3}", Auto-tap pays for you if it can.
- **Answering Opp:** when Opp casts a spell and you have an instant (or a flash card) you can pay for, the spell waits. **Answer it** closes the message so you can cast your instant (a counterspell counters Opp's spell); **Let it resolve** (or **End turn ▸**) lets it go on. If its target is gone by then, it does nothing.
- It attacks when none of your untapped creatures could block and kill an attacker without dying, or when attacking with everything would be lethal. It keeps creatures home if you could swing back for lethal.
- It blocks when it can kill your attacker and survive, trade for something at least as good, or stop the damage. It chump blocks only to stay alive.
- Everything else (activated abilities, auras, planeswalkers, X spells, other text) is ignored. "When this enters" effects work the same as for you, with Opp picking its own targets and choices.

**Targets:** your cards that say "destroy / exile target …", "return target … to its owner's hand", "deals N damage to any target", "tap target …", "target creature gets +3/+3 until end of turn" or "put a +1/+1 counter on target creature" ask you to pick the target, on any table (or a player, for damage), and then do it. That covers instants and sorceries, "When this enters" triggers and activated abilities. Online, a friend's card you target is changed on their side. Hexproof and shroud are respected.

**Your record:** when a game ends (someone at 0 life, 10 poison or 21 commander damage), closing the message saves a win or loss for your deck. **More ▾ → Record a win / loss** saves one by hand (a concession, a game the Simulator couldn't call). Decks show their record on the Decks tab, and MTG Tracker shows it on the deck's page with the latest games.

| To do this | Do this |
|---|---|
| Attack Opp | **Attack…** (or **A**): tick your attackers. Opp blocks, and the damage is done for you |
| End your turn | **End turn ▸** (or **N**): Opp takes its turn, then you untap and draw |
| Block | When Opp attacks, pick a blocker for each attacker and click **Done blocking**. **Later** closes it so you can look at the table first; **End turn ▸** brings it back |
| Fix anything | − and + on Opp's life, or **Undo**, which takes back Opp's turn one step at a time |

Combat counts power and toughness (with +1/+1 and -1/-1 counters), flying, reach, first strike, double strike, deathtouch, trample, lifelink, menace (also the older "can't be blocked except by two or more creatures"), vigilance and indestructible.

Some cards that change the rules of combat work too, for you, for Opp and online:

- **Arboria**: nobody can attack a player who didn't cast a spell or put a nontoken permanent onto the battlefield during their last turn (their planeswalkers can still be attacked). Only what a player did on their own turn counts.
- **Mirri, Weatherlight Duelist**: while she's tapped, only one creature can attack her controller. When she attacks, each opponent can block with only one creature. **Silent Arbiter**'s "no more than one creature can attack / block each combat" works the same way.
- **Brave the Sands** ("each creature you control can block an additional creature"): tick the same creature under two attackers. Its damage goes to each attacker in turn, enough to kill it, the rest to the last, and the damage it takes adds up.
- Creatures whose power and toughness are \*/\* "equal to the number of creatures (or Elves…) you control", like **Silverwing Squadron**, show their size on the card and fight with it.
- "Create a number of 2/2 … tokens equal to the number of opponents you have" (Silverwing Squadron's attack) makes the right number.
- **Ghostly Prison / Propaganda**: attacking that player costs {2} per creature. The Attack screen pays it with Auto-tap (or tells you that you can't), and Opp only attacks with what it can pay for.

More abilities that are done for you, on your cards and Opp's (Undo if one goes wrong):

| Kind | What happens |
|---|---|
| Combat keywords | **Exalted** (+1/+1 for each exalted when a creature attacks alone), **battle cry**, **infect** (poison counters to players, -1/-1 counters to creatures), **wither**, **toxic N**, **annihilator N** (Opp sacrifices its least useful permanents; you're asked to pick yours), **bushido N**, **flanking**, **rampage N**, **decayed** (can't block, sacrificed after it attacks), and "can't be blocked" |
| Dying | **Undying** and **persist** bring the creature back with its counter. **Afterlife N** makes 1/1 flying Spirits. "Whenever Blood Artist or another creature dies…", "Whenever a creature you control dies…" (Zulaport Cutthroat) drain on either table |
| Casting spells | **Prowess**. "Whenever you cast a noncreature / instant or sorcery / creature spell…" (Young Pyromancer, magecraft): tokens, pumps, life, cards. **Cascade** reveals until a cheaper nonland card and casts it free. **Storm** tells you how many copies to make (or makes them, if the spell is simple) |
| Simple spells | An instant or sorcery made only of things the Simulator knows ("Draw two cards.", "Each opponent loses 3 life.", "Proliferate.", Relentless Assault) resolves by itself and goes to the graveyard. Opp casts them too |
| Life | "Whenever you gain life, …" (Ajani's Pridemate, "that many"). "Players can't gain life" (Sulfuric Vortex) and "Your opponents can't gain life" (Erebos) take the gain back |
| Costs | "Noncreature spells cost {1} more" (Thalia) and "Spells your opponents cast cost {1} more" are added to Auto-tap, for you and Opp |
| Counters | **Proliferate** (also in **More ▾**): one more of each counter on your permanents (not -1/-1), and one more poison and -1/-1 on Opp's. "Enters with a +1/+1 counter for each other creature you control" |
| The monarch | "You become the monarch" (Palace Jailer). The monarch draws at the end of their turn, and loses it to a player whose creature deals them combat damage. 👑 shows who has it. **More ▾ → Become the monarch** to set it by hand |
| Extra combat | "Untap all creatures you control", "After this main phase, there is an additional combat phase". **More ▾ → Extra combat** lets creatures that attacked attack again |
| Planeswalkers | Right-click yours → **Activate: +1: …**. Loyalty is paid and checked, once a turn; for **−X** you're asked for X. At 0 loyalty it goes to the graveyard. The Immortal Sun stops them |
| Choices | "Choose one —" on a trigger (Retreat to Hagra, Junji) asks which. Cards from graveyards to your hand or the battlefield (Liliana, Junji, Archenemy's Charm, The Darkness Crystal) ask which cards; ones from Opp's graveyard come under your control and go back to Opp when they leave. **Recover** asks whether you pay. **Madness**: a discarded card goes to exile and you're asked whether to cast it. "As this land enters, you may pay 3 life" (Boggart Bog) asks too |
| Ways to cast | **Offspring**, **freerunning** (after an Assassin or your commander dealt combat damage this turn) and "you may pay {1}{B} rather than pay this spell's mana cost" ask how you cast it. Ebondeath has **Cast from graveyard** in your graveyard; cards Reno and Rude or Ugin let you play have **Play it** in your exile. Two-faced cards with a land back (Boggart Trawler) have **Play Boggart Bog (land)** in hand |
| Whenever… | Heroic and "whenever you cast a spell that targets …" (Danitha), "whenever an opponent loses life" (Bloodthirsty Conqueror), "is dealt noncombat damage" (Massacre Girl, Most Wanted), Syr Konrad, "whenever a permanent you control is turned face up" (Roshan), "during an opponent's turn" (Nightmare Sower), and Interceptor returning from your graveyard when a legendary creature attacks (you're asked to pay). Sanguine Bond with Bloodthirsty Conqueror goes on until someone is at 0 |
| Board-wide | Massacre Girl's chain of -1/-1, The Darkness Crystal exiling Opp's dying creatures, Bleed Dry's "exile it instead", stun counters (it stays tapped once per counter), Roshan's "are Assassins", Desmond Miles counting your graveyard, Coat of Arms, "All Rats have fear", threshold, Wave of Reckoning, Slaughter the Strong (each side keeps its best creatures under the power limit), Fell the Mighty, Kindred Dominance and Patriarch's Bidding (the best type is picked) |
| From your hand | **Cycling** and **transmute** in a card's right-click menu. **Ninjutsu**: after Opp blocks, you're offered the swap for an unblocked attacker. **Flashback** and **aftermath** (Dusk // Dawn) in your graveyard's menu |
| Paying taxes | Rhystic Study and Smothering Tithe ask you whether to pay when they're Opp's (Opp pays for Rhystic Study when it can, never for Smothering Tithe). Counterspell extras: An Offer You Can't Refuse's Treasures, Arcane Denial's draws next upkeep |
| Choices | Wall of Stolen Identity asks what to copy (the copy stays tapped while it lasts), Eerie Interlude which creatures to blink, Karumonix which Rats to keep, Lord Skitter's Butcher what to sacrifice. Abilities that sacrifice other permanents ("Sacrifice three Rats") or have {X} ask for those |
| Protection | "You have hexproof" (Opp won't target you), Teferi's Protection (your permanents phase out and your life can't change until your next turn), Crystal Barricade's damage prevention |
| Mana | A mana for each defender (Overgrown Battlement, Axebane Guardian), Cabal Coffers and Stronghold, Heraldic Banner's color (the one most of your creatures are), filter lands like Flooded Grove |
| Revealing until | "Reveal cards from the top of your library until you reveal a creature card…" (Jace, Nissa, Atla Palani, Bag of Tricks, Mass Polymorph, Kindred Summons, Heirloom Blade, Proteus Staff, Jhoira from Opp's library, Dack Fayden giving them to Opp goaded), Coiling Oracle, Selvala's parley, Illuna's "exile until" |
| Dice | "Roll a d20" with the card's result table (Earth-Cult Elemental, Component Pouch, Berserker's Frenzy), Bag of Tricks and Underdark Rift using the result, Chaos Dragon's roll-off, Wild Endeavor (you pick which die is which), Neverwinter Hydra's X d6. Barbarian Class rolls an extra die and drops the lowest; "Whenever you roll one or more dice" (Vrondiss, Barbarian Class) |
| X spells | Casting a spell with {X} asks for X and pays it (Martial Coup, White Sun's Twilight, Magmaquake, Lavalanche, Klauth's Will, Occult Epiphany, Neverwinter Hydra; Shark Typhoon's cycling). **Converge** counts the colors of mana Auto-tap spent (Radiant Flames, Painful Truths) |
| "If …" | "If you're the monarch", "if you control six or more lands", "if you control a creature with power 4 or greater", "if you gained life this turn", "if that player attacked you during their last turn", "if X is 5 or more", "the first time this ability has resolved this turn" |
| More choices | Brainstorm's cards to put back, Time Wipe's creature to save, Duneblast's one to keep, Fact or Fiction's piles (Opp splits them), a free spell from Rishkar's Expertise, Maelstrom Archangel, Primeval Spawn or The Ur-Sphinx, discarding for Occult Epiphany or Sultai Charm, Mosswort Bridge's hideaway, a Siege's mode, Serra's Emissary's card type, Unite the Coalition's five modes (repeats allowed), "you may pay {R}" (Spit Flame) and "you may pay 3 life" (Niv-Mizzet) |
| Ways to cast (precons) | **Impending**, **bestow**, **mutate** (pick the non-Human creature it goes on), **morph** (face down for {3}; turning it up pays its morph cost), **suspend** (time counters come off each upkeep), Flawless Maneuver free with your commander out, **convoke** from Fallaji Wayfarer, **basic landcycling** |
| Colors | "Is all colors" (Transguild Courier), Knight of New Alara, Jared's Kavu and −3, Jenson's "if that spell was all colors", Mana Cannons, Faeburrow Elder, Iridian Maelstrom |
| Combat (precons) | **Melee**, **goad** (goaded creatures must attack; Opp's attack you), "attacks each combat if able", Wulfgar and Windcrag Siege doubling attack triggers, Gratuitous Violence's double damage, Indomitable Might, Sword of Hours, Tamiyo's stun, Dragonborn Champion, Desert at the end of combat, Serra's Emissary's protection from creatures |
| Sagas | A lore counter as a Saga enters and at the start of each of your turns, each one doing its chapter; it's sacrificed after the last. **Read ahead** (The Elder Dragon War) asks which chapter to start on |
| Entering (Foundations Commander) | **Living weapon** (Nettlecyst, Tangleweave Armor: a 0/0 Germ with it attached), Metallic Mimic's and Dragonstorm Globe's extra +1/+1 counter, Shivan Devastator's X counters, Diregraf Colossus counting Zombies in your graveyard, Witch's Cottage entering tapped, Duplicant taking on the creature it exiled |
| Casting (Foundations Commander) | **Improvise** (Kappa Cannoneer: your untapped artifacts pay generic mana when your lands can't), **kicker**, **gift**, Thundermane Dragon (right-click your library: see the top card, and **Cast … from the top** for a creature with power 4 or greater; it gains haste; Opp does it too), Orb of Dragonkind's mana only for Dragons, Sephara's tap-four-fliers cost, affinity, typecycling |
| More (Foundations Commander) | Emeria Shepherd's Plains landfall to the battlefield, Parapet Thrasher's "one that hasn't been chosen this turn", Hellkite Charger's extra combat (yours only: Opp doesn't attack twice), Arachnogenesis counting attackers, Scrawling Crawler, Gray Merchant's devotion |
| {X} (2026 precons) | Opp casts {X} spells too, for the biggest X it can pay. Unbound Flourishing doubles X and copies {X} instants and sorceries, Zimone's discount, Troyan's and Elementalist's Palette's mana for {X} spells, Mana Bloom, Channel's 1 life for {C} |
| Auras (Silverquill Influence) | Your auras on Opp's creatures goad them (Ghoulish, Martial and Parasitic Impetus) and work from your side, Scriv's Contract tokens, Animate Dead (no attach prompt: it brings back the best creature card from any graveyard), Darksteel Mutation, Flickering Ward's color, auras found by Songbirds' Blessing, Armored Skyhunter and Herald of Amity, Pearl-Ear's affinity, Raffine's Guidance from your graveyard |
| Turtle Power | Mutagen tokens, Donatello's extra Mutagen, **squad** (pick how many copies when you cast it), **fuse** (cast both halves from the cast menu), **evolve**, Coin of Mastery, Krang, "at the beginning of your second main phase" (done as the end step begins), Raphael's double damage, Vigor |
| Odds and Ends | Clash (Marvo), Dazzling Sphinx and Chaos Wand, Thief of Sanity, Fatespinner (the player skips combat), Void Winnower against Opp, Oubliette, Aminatou's −6 (with two players you trade), Approach of the Second Sun, Esper Sentinel's tax, Inniaz, Aboleth Spawn copying Opp's enter abilities |
| Not done | Replicate (Changing Loyalty is cast once), Space Beleren's sectors, Psychic Battle, Exchange of Words, Shared Fate |
| Stax and control (NO! Just Birds!) | Tutors that put a card on top (Enlightened and Mystical Tutor), Swan Song's Bird, Mana Drain's {C} at your next main phase, **buyback** (Capsize), Silence, Grand Abolisher and Drannith Magistrate stopping Opp's spells, Opp's creatures entering tapped (Blind Obedience, Authority of the Consuls, Thalia, Heretic Cathar), **extort**, Narset's one card a turn, Soulless Jailer, Aven Mindcensor, Archivist of Oghma, Spelltithe Enforcer, Dovescape, Archetype of Imagination, Stormtide Leviathan, Absolute Virtue and The One Ring's protection, **vanishing**, **energy** (Aetherstorm Roc), Boseiju and Mistrise Village (your next spell can't be countered), Emrakul, the Exigent Doom's land, Alrund (it picks the card type most of your library is). Emrakul, the Promised End: the turn you'd control is wasted for the other player (they untap and draw, nothing else), then they take their extra turn |
| Copies and free spells (Is Your Turn Over Yet?) | Etali, Primal Conqueror's free spells from the top of each library (you're asked about each one), its transform into an 11/11 that gives poison, token copies that keep their "When this enters" (Heat Shimmer, Twinflame, Electroduplicate, Molten Duplication, Kindle the Inner Flame, Devastating Onslaught, Orthion, Jaxis), Panharmonicon, Lithoform Engine (it copies your latest trigger, or your next permanent spell this turn), **blitz** and **dash** from the cast menu, **riot** (Rhythm of the Wild: haste on your turn, a +1/+1 counter otherwise), **prowl** for Dinosaurs (Hunting Velociraptor), Exploration's second land, Wild Growth and Utopia Sprawl, Chrome Mox's imprint, Spirit Guides (right-click them in your hand), Food Chain, Orcish Lumberjack, Treasonous Ogre, Braid of Fire, Sylvan Library (pick the two to put back; 4 life for each you keep), Eldritch Evolution, Tibalt's Trickery, Pyroblast, Squee from the graveyard or exile, Ragavan's stolen card, Deflecting Swat sending Opp's spell back at its side, Hexing Squelcher's ward |
| Rules | Darksteel Angel (you can't lose; no -1/-1 counters), Archelos (other permanents enter tapped or untapped), Turbulent lands, Game Trail and Murmuring Bosk, Omnath's mana turning colorless, Surrak, Maelstrom Nexus's cascade, Elspeth's emblem, Class levels, amass, incubate, empower Jace |

Online these work the same for everyone's cards: poison and -1/-1 counters from combat, the monarch, taxes and "can't gain life" are passed along. Annihilator against a friend only goes in the log: they pick their own sacrifices. Creatures that die go to the graveyard, and commanders go back to the command zone. Commander damage is tracked both ways.

## Playing online with friends

Play against up to 3 friends. The easiest way is for everyone to open the online version at **[lilbodnar.github.io/lettuce-untapped/simulator](https://lilbodnar.github.io/lettuce-untapped/simulator/)**. There's nothing to download, and everyone automatically has the same version. Use Chrome or Edge.

Each person's decks come from their own MTG Tracker, so friends should import their decks at [lilbodnar.github.io/lettuce-untapped](https://lilbodnar.github.io/lettuce-untapped/) first, in the same browser. Pasting a deck list on the Decks tab works too.

1. **Host:** on the **Decks** tab, under **Play online**, type your name and click **Host a game**. You land in the **lobby** with a game code like `K7QX2M`. Send it to your friends.
2. **Everyone else:** type your name and the code, then click **Join**. You land in the same lobby.
3. The lobby shows who has joined and which deck each person picked. Pick yours under **Your deck**.
4. When everyone is there, the host clicks **🎲 Roll for first & start**. Everyone rolls a d20 (ties roll again), the rolls go in the log, and the highest roll goes first. Everyone's game starts at once.
5. To play again, use **More ▾ → Back to the lobby**. To switch decks mid-game, use **More ▾ → Change deck…**.

Someone who joins after the game started can click **Join in with this deck** in the lobby.

What you see:

- Your friends' tables are across the top. Their lands are at the far edge, like sitting across a real table. Hover any of their cards to read it. Click **Graveyard** or **Exile** in their panel to look through it.
- Nobody can see your hand or library, only how many cards are in them.
- Use the **−** and **+** on a friend's life to deal damage or give them life. Cards that say "each opponent loses N life" do this automatically. Undo sends it back.
- There's one turn button. On your turn it says **Pass to Bob ▸**: click it when you're done (you discard down to 7 first if needed). The next player's turn starts on its own: they untap, their mana pool empties and they draw. On someone else's turn the button says **Bob's turn** and is greyed out.
- The log shows what everyone does. Type in the box under it to chat.

The game doesn't enforce the rules. It's like playing at a kitchen table: everyone runs their own cards and you sort things out together.

**How it connects:** the browsers talk to each other directly (WebRTC, using the free [PeerJS](https://peerjs.com) library). PeerJS's free public server is only used to find each other by code. The host's browser passes everyone's moves along, so if the host closes the page, the connection ends for everyone. Each person's own table is saved, so nobody loses their game. To pick it back up (later the same day or another day), everyone opens that game from **Your games** and clicks **Reconnect** (top right of the table). The host should reconnect first, since that reopens the same game code; then the others reconnect into it. If the code is still in use, the host gets a new one to send around, and the others type it under **Join**.

**If it won't connect:** some work and school networks block this kind of connection. Try home Wi-Fi or a phone hotspot. If some people use a downloaded copy instead of the online version, make sure everyone has the same version, or just have everyone use the online one.

## Auto-test

The computer plays your decks by itself, many games in a row, with Opp's rules. It takes a few seconds for 100 games.

- **Play a deck by itself**: the deck plays alone against an empty table that never blocks. You see, by turn, how many lands and creatures it has, how often it made its land drop, how much damage it has dealt, and how often it would already have won. Also the usual kill turn (40 damage in Commander, 20 otherwise) with a chart of how many games were won on each turn, when the commander comes out, and how often it stalled (under 3 lands on turn 4) or flooded (2 or more lands stuck in hand on turn 6).
  - **Opening hands**: the same games grouped by lands in the hand it kept (0–1, 2, 3, 4, 5+), with the kill turn and how often each stalled or flooded. A data-backed mulligan guide.
  - **Card impact**: for every nonland card, how often it was drawn and cast, the kill turn in games where it was cast against games where it wasn't, and how often it sat in hand uncast. The top and bottom cards are called out as "pulling their weight" and "could be cut".
- **Matchup**: two decks play each other, taking turns going first. You see how often each won, how long games take, how they ended (life, poison, commander damage, an empty library), each deck's win rate when it went first and when it didn't, and card impact for the first deck (win rate with each card cast, and without).
- **Gauntlet**: one deck against each of your other decks, or every deck against every other. A table of win rates (green is good for the row's deck, red is bad), an overall win rate per deck, and a ranking (or the hardest matchup for the one deck). The ranking also shows each Commander deck's estimated bracket.
- **Bracket estimate**: where each Commander deck likely sits in the Commander Brackets (1 Exhibition to 5 cEDH), from its list: Game Changers (Scryfall marks them), mass land denial, extra turns, tutors and well-known two-card combos (early ones push a deck to Bracket 4, late ones to 3). No games are played. A list can't show intent, so 2 means "2, or 1 for a theme deck" and 4 means "4, or 5 for a tournament deck".
- **Try a change**: write cards to take out and put in (one per line, like `2 Shock`), and the old and new versions play side by side: kill turn, land drops, stalls and floods, and optionally the win rate against one of your other decks. Cards you put in are looked up on Scryfall. Your deck isn't changed.
- **How many lands?**: the deck plays alone with 4 and 2 fewer lands, as it is, and with 2 and 4 more (basic lands are added or taken out). The table compares kill turns, missed land drops, stalls and floods, and highlights the count that did best.

It's the same simple Opp as above playing both sides, so it's good for comparing versions of a deck or seeing which deck is faster, not for predicting a game against a real player. Auto-test games aren't saved and don't count toward a deck's record.

## Odds

Pick a deck and **On the play** or **On the draw**. The numbers are exact math, not random trials. Mulligans aren't counted.

- **Lands in your opening hand**: the chance of each number of lands in your first 7
- **Hitting every land drop**: the chance you have at least one land per turn so far
- **Mana curve**: how many non-land cards cost 0, 1, 2…
- **Chance to draw a type of card**: choose a category from your Tracker deck (like Ramp or Removal) or pick cards, and see the chance of having drawn at least one by each turn
- **Lands by your turn 4**: the chance of each land count by turn 4, with the odds of being short on lands (0–2) or flooding (6+)
- **Casting on curve**: for each turn, the chance you have enough lands *and* a spell that costs exactly that much (a 2-drop on turn 2, a 3-drop on turn 3…)
- **Card types**: how many creatures, instants, artifacts and so on (a card with two types counts under both)
- **Colored mana symbols**: how many of each color's symbols appear in your costs (hybrid counts for both colors)
- **Lands that make each color**: compare with the symbols chart to spot a color your lands don't support. Hover a bar for the chance of having that color by turn 3
- **Sample hand**: deal a random 7 and keep drawing

## Your data

Decks you paste, card info and your game in progress are saved in your browser on this computer. Clearing your browser's site data deletes them. Tracker decks stay safe in MTG Tracker.

## Files

All inside the Tracker's `simulator` folder:

```
index.html           the app (open this)
css/styles.css       look and layout
js/app.js            screens, drag and drop, menus, odds charts
js/game.js           the game: zones, moving cards, turns, tokens
js/odds.js           draw-odds math
js/bot.js            the computer opponent: what it casts, attacks and blocks with
js/autoplay.js       the Auto-test tab's games: a deck alone, or two decks against each other
js/online.js         playing online: connecting to friends, what they see of your table
js/tracker-link.js   reads decks from MTG Tracker (read-only)
```

It also uses these files from the Tracker's `js` folder, so the two apps always work the same way:

```
../js/parser.js      reads deck lists
../js/scryfall.js    card lookups
../js/store.js       saves data in the browser (the Simulator keeps its own separate database)
../js/backup.js      checks Tracker backup files before loading them
```
