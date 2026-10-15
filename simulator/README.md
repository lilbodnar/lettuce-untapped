# MTG Simulator

Playtest your Magic: The Gathering decks on a virtual table, and see the odds of drawing what you need. You don't need to own the cards.

The Simulator comes with MTG Tracker. It lives in the Tracker's `simulator` folder.

- **Decks**: uses the decks you already imported into MTG Tracker, or any list you paste in
- **Play**: draw, play, tap, attack, make tokens, track life and mana, mulligan, scry, search, undo
- **Online**: play against up to 3 friends over the internet, each with their own deck
- **Odds**: chance of lands in your opening hand, hitting land drops, your mana curve, and the chance to draw a type of card (like Ramp) by each turn

Card data and images come from [Scryfall](https://scryfall.com) (free, no account needed).

## Getting started

1. Open MTG Tracker and click **Simulator ▸** at the top right. Online, that's [lilbodnar.github.io/mtg-tracker/simulator](https://lilbodnar.github.io/mtg-tracker/simulator/). (Or double-click `simulator/index.html` in a downloaded copy.)
2. Your MTG Tracker decks show up on the **Decks** tab. Click **Play**.
3. **◂ MTG Tracker** at the top right takes you back.

Use Chrome or Edge, and the same browser for both.

You need internet so it can load card pictures.

## Getting decks from MTG Tracker

The Simulator reads MTG Tracker's saved data directly, as long as both are opened in the same browser on the same computer, and both online or both from the same downloaded folder. The dot in the top right turns green when it's linked.

- Changed a deck in the Tracker? Click **Refresh** on the Decks tab.
- The Simulator only reads from the Tracker. It never changes your collection or decks.
- Maybeboard and sideboard cards are left out. Cards in the **Commander** category start in the command zone.

If your decks don't appear (for example in Firefox, or on a different computer): in MTG Tracker go to **Account & backup → Download backup**, then click **Load backup file…** on the Simulator's Decks tab.

## Playing decks you don't own

On the Decks tab, paste a list into **Paste a deck list**, give it a name, and click **Import deck**. Lists from Archidekt, Moxfield, MTG Arena, or plain text like `1 Sol Ring` all work. To mark the commander, use a `[Commander]` category, a `*CMDR*` tag, or put it under a `Commander` heading. Sideboard sections are skipped.

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
- It casts simple removal ("Destroy target creature", "Exile target creature") on your best creature, burn ("deals 3 damage to any target") on a creature it can kill or at you, and simple card draw ("Draw two cards").
- It attacks when none of your untapped creatures could block and kill an attacker without dying, or when attacking with everything would be lethal. It keeps creatures home if you could swing back for lethal.
- It blocks when it can kill your attacker and survive, trade for something at least as good, or stop the damage. It chump blocks only to stay alive.
- Everything else (activated abilities, auras, planeswalkers, X spells, other text) is ignored. "When this enters" life and card draw work the same as for you.

| To do this | Do this |
|---|---|
| Attack Opp | **Attack…** (or **A**): tick your attackers. Opp blocks, and the damage is done for you |
| End your turn | **End turn ▸** (or **N**): Opp takes its turn, then you untap and draw |
| Block | When Opp attacks, pick a blocker for each attacker and click **Done blocking**. **Later** closes it so you can look at the table first; **End turn ▸** brings it back |
| Fix anything | − and + on Opp's life, or **Undo**, which takes back Opp's turn one step at a time |

Combat counts power and toughness (with +1/+1 and -1/-1 counters), flying, reach, first strike, double strike, deathtouch, trample, lifelink, menace, vigilance and indestructible. Creatures that die go to the graveyard, and commanders go back to the command zone. Commander damage is tracked both ways.

## Playing online with friends

Play against up to 3 friends. The easiest way is for everyone to open the online version at **[lilbodnar.github.io/mtg-tracker/simulator](https://lilbodnar.github.io/mtg-tracker/simulator/)**. There's nothing to download, and everyone automatically has the same version. Use Chrome or Edge.

Each person's decks come from their own MTG Tracker, so friends should import their decks at [lilbodnar.github.io/mtg-tracker](https://lilbodnar.github.io/mtg-tracker/) first, in the same browser. Pasting a deck list on the Decks tab works too.

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
