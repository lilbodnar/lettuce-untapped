# MTG Tracker

Track your Magic: The Gathering collection and decks, see which cards you already own for each deck, and watch card prices over time.

- **Wishlist**: cards you want to buy, with prices and a total
- **Collection**: every card you own, shown as card images or a list, with prices and total value. Filter by color, type, mana value and rarity
- **Decks**: save as many decks as you like and see what % of each deck you already own, plus what's missing and what it costs to finish. Each deck is checked against its format's rules (Commander, Modern, Standard and more)
- **Prices**: collection value over time, your most valuable cards, and the biggest price changes
- **Accounts**: log in to have the same collection and decks on your phone and computer, and share your collection file with friends
- **Simulator**: playtest any of your decks on a virtual table and see your draw odds, even decks you don't own the cards for. Let the computer play a deck hundreds of times to see how fast it is, or two decks against each other. Games you finish there show up on the deck's page as its win/loss record
- **Works offline**: install it on your phone or computer like an app, and browse your cards without internet
- **Export**: download your collection, wishlist or any deck as a spreadsheet (CSV)

**Use it online: [lilbodnar.github.io/lettuce-untapped](https://lilbodnar.github.io/lettuce-untapped/)**. There's nothing to download, and it works on phones too.

Card data, images and prices come from [Scryfall](https://scryfall.com) (free, no account needed).

## Getting started

The easiest way is to open **[lilbodnar.github.io/lettuce-untapped](https://lilbodnar.github.io/lettuce-untapped/)** and bookmark it, or install it (see [Using it offline](#using-it-offline-and-installing-it)). Your cards are saved in that browser, so log in to an account on **Account & backup** to use them on another device.

To run it from your own computer instead:

1. Download this project: on GitHub click **Code → Download ZIP**, then unzip it. (Or `git clone` it.)
2. Open the folder and **double-click `index.html`**. It opens in your web browser. Chrome or Edge work best.
3. That's it. There's nothing to install. You need internet so it can look up cards and prices. (Offline use and installing as an app only work from the web address, not from the downloaded file.)


## Adding your cards (from Archidekt)

1. Go to [archidekt.com](https://archidekt.com), open your deck (or make a new one) and add your cards.
2. Click **More**, then **Export deck**.
3. Use these settings:

   | Setting | Choose |
   |---|---|
   | Select cards by | **All cards** |
   | Include out of deck cards (eg: maybeboard) | ✅ **Checked** |
   | Export type | **Text** |
   | Export options | **`1x Example Card (set) 123 *F* [Example category] ^Buy,#0066ff^`** |
   | Sort by | **Alphabet** |
   | Section header | **No section header** |
   | Use front name only for MDFC cards | ☐ **Unchecked** |

4. Click **Download** (saves a `.txt` file) or **Copy**.
5. In MTG Tracker, go to the **Import** tab. Drag the `.txt` file onto the page, or paste the copied text.
6. Choose where the cards go:
   - **My collection**: add them to the cards you already have, or replace your whole collection with this list
   - **A new deck**: saves it as a deck (tick "Also add the deck's cards to my collection" if you own them)
   - **Update an existing deck**: replaces that deck's card list with the new export
7. Click **Import**.

Any lines that couldn't be matched to a card are listed after the import so you can fix them.

Lists copied from **Moxfield**, **MTG Arena** or **MTGO** work too. Paste them the same way. Headings like "Commander", "Sideboard" or "Maybeboard" in the list put those cards in the right place.

You can also add single cards by name at the top of the **Collection** tab.

## Loading decks straight from Archidekt or Moxfield

Instead of exporting a file, you can paste a deck link from Archidekt or Moxfield (or your Archidekt username to pick from your decks) into **Load from Archidekt or Moxfield** at the top of the **Import** tab. Click **Load** and it's saved as a new deck straight away, named after the deck. If you already have a deck with that name, it gets updated instead, so loading the same link again brings in your latest changes. Only **public** decks work, and the app never asks for your password.

Moxfield decks keep their commander, sideboard and maybeboard. Main-deck cards are grouped by the deck's own Moxfield tags, or by card type if it has none.

Archidekt and Moxfield only let their own websites read their decks, so the app needs a small relay. The online version already has one built in ([archidekt-relay.liliazbodnar.workers.dev](https://archidekt-relay.liliazbodnar.workers.dev/api/decks/5280254/)), so this works with no setup. If you run your own copy and want your own relay, it's free and takes about five minutes:

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. Go to **Workers & Pages**, click **Create**, then choose **Start with Hello World**.
3. Name it `archidekt-relay` and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, paste in the contents of `worker/archidekt-relay.js`, then click **Deploy**.
5. Copy the relay's address. It looks like `https://archidekt-relay.yourname.workers.dev`.
6. In MTG Tracker, open **Import**, then **Relay setup**, and paste the address.

To give everyone who uses the app the relay without step 6, put the address in `DEFAULT_RELAY` at the top of `js/archidekt.js`.

**Updating the relay:** Moxfield links need the relay code from this version. If Moxfield links say the deck wasn't found, open the relay on Cloudflare, click **Edit code**, paste in the new `worker/archidekt-relay.js` and click **Deploy**. Archidekt keeps working either way.

## Adding cards by dragging from Scryfall

Open [scryfall.com](https://scryfall.com) in another tab or window and find a card. Drag its picture onto MTG Tracker:

- On a deck's page: 1 copy of that exact printing goes into that deck.
- Anywhere else: 1 copy goes into your collection.

A banner at the bottom tells you where the card will go before you let go.

## Official cards, proxies and missing cards

Every card in your collection has two counters: **Official** (real copies) and **Proxy**. Use **−** and **+** under a card to change them. A card you only have as a proxy gets a purple **PROXY** tag. Proxies don't count toward your collection's value. Use **All / Official / Proxies** on the Collection tab to filter.

In a deck, each card shows the same Official and Proxy counters plus a red ✗ for any still missing. Changing them there updates your collection:

- **+** next to Official or Proxy adds a copy to your collection. **−** takes one out.
- To update lots of cards at once, tick their checkboxes (or **Select all**), then click **Official**, **Proxy** or **Neither**:
  - **Official** adds enough official copies to your collection to cover the deck.
  - **Proxy** adds enough proxies to fill whatever you don't already own.
  - **Neither** removes all copies of those cards from your collection. It asks first.
- **Copy proxy list** gives you the list of cards you're proxying, handy when you're ready to buy the real ones.

Use **Images / List** on a deck's page to switch between card pictures and a list with the counters.

## Managing decks

- **Add a card by name** with the box on a deck's page, or drag a card in from Scryfall.
- **Remove cards from a deck:** tick their checkboxes, then click **Remove from deck**. Your collection isn't changed, and **Undo** in the message at the top puts them back.
- **Maybeboard and Sideboard:** these cards show in their own sections and don't count toward the deck's total. Click **Move to deck** on one to add it to the deck, or drag it onto a section (for example "Ramp") to put it in that category. You can drag deck cards between categories too, or onto the Maybeboard to take them out of the deck.
- Deck names must be different from your other decks. If you import a file whose name matches a deck you already have, the app switches to **Update an existing deck** for you.
- To delete a deck, hover over it on the **Decks** page and click the 🗑 button, or open it and click **Delete deck**. Your collection isn't changed.

## Deck checks

Each deck's page shows a **Format** menu and whether the deck follows that format's rules. Decks with a "Commander" category start as Commander; pick **No format** to turn the check off. It checks:

- **Deck size**: exactly 100 for Commander and Brawl, at least 60 for the others, and at most 15 in the sideboard
- **Copies**: one of each card in Commander, at most four in the others (sideboard included). Basic lands and cards like Relentless Rats are allowed in any number
- **Banned, restricted and not-legal cards**, using Scryfall's up-to-date lists
- **Commander**: that it's a legendary creature (or says it can be your commander), and that every card fits its colors

The commander is whatever is in the "Commander" category. The first time you open a deck, the app gets legality info from Scryfall, so it needs internet once.

## Finding cards in your collection

Under the search box on the **Collection** tab:

- **Colors**: click one or more mana symbols. Picking green and white shows cards that are at least green and white; the ◇ symbol shows colorless cards. This uses color identity, the same rule as Commander.
- **Type**, **Mana value** and **Rarity** narrow it down further.
- **Clear filters** shows everything again. Search, sorting, filters and **Select all** all work together.

## Exporting to a spreadsheet (CSV)

**Export CSV** on the Collection tab, the Wishlist tab or a deck's page downloads a file that opens in Excel or Google Sheets. It lists count, name, set code, collector number, foil, price and Scryfall ID (plus proxies and rarity for the collection, and category and board for a deck). The column names match what Moxfield's collection import expects.

## Simulator (playtesting)

The **Simulator** tab at the top right playtests your decks right here in MTG Tracker. Your decks show up there automatically, and a game you start keeps going while you use the other tabs. On a deck's page, **▶ Play**, **Play vs computer** and **Odds** open that deck in the Simulator. You can also add any Commander precon from a list, or paste any deck list, even one you own none of the cards for. Then:

- **Play** it on a virtual table: draw, play, tap, make tokens, track life and mana, mulligan, scry, undo
- Play it **against the computer**, which plays another of your decks
- See its **Odds**: lands in your opening hand, hitting land drops, mana curve, and the chance to draw a Ramp or Removal card by each turn

The Simulator only reads your Tracker data. It never changes your collection or decks. See [simulator/README.md](simulator/README.md) for the full guide.

## Wishlist

The **Wishlist** tab holds cards you want to buy, with each one's price and the total cost.

- **Add cards:** type a name, drag one in from Scryfall while on the Wishlist tab, click **♥ Add to wishlist** in a card's popup, or click **♥ Add missing to wishlist** on a deck's page. That last one only adds what isn't already on your list.
- **Want − n +** changes how many you want. **Remove** takes a card off the list.
- **Change wishlist printing:** click a card on the wishlist, then this button in its popup. Each printing has **Replace** (the wishlist entry becomes that printing) and **+ Add to wishlist** (adds 1 of that printing as well, and keeps the one you had).
- **✓ Got it** when you buy a card: it moves into your collection as official copies.
- **Copy list** copies the whole list, ready to paste into TCGplayer's Mass Entry or a message.

## Removing cards

On the **Collection** tab, tick the checkbox on each card you want to remove. In image view the checkbox shows when you hover over a card. Then click **Remove selected**.

- **Select all** ticks every card, or every card matching your search if you've typed one.
- **Shift-click** a second checkbox to tick everything in between.
- Removed something by mistake? Click **Undo** in the message at the top.

To change how many copies of one card you have, click the card and use the − and + buttons.

## Using it offline and installing it

Open the app from its web address once, and after that it opens without internet: your collection, decks, wishlist and the Simulator all work. Prices, adding new cards and loading decks still need internet. A message at the top tells you when you're offline.

- **Install it:** on iPhone, tap **Share → Add to Home Screen**. On Android or a computer (Chrome or Edge), use the browser menu → **Install app**. It then opens in its own window with its own icon.
- **Card pictures:** pictures are saved the first time you see them. To save all of them before a trip, go to **Account & backup → Save card images for offline**.

Opening the downloaded `index.html` by double-clicking still works, but only online.

## Your data and backups

Unless you log in to an account, your collection is saved **inside your browser on your computer**. It isn't uploaded anywhere.

- It stays there between visits, but **clearing your browser's history/site data deletes it**.
- Go to **Account & backup → Download backup** now and then to keep a copy.
- On a new computer or browser, use **Restore backup** to load it back.

## Accounts (the same decks on your phone and computer)

On **Account & backup**, choose **Create account** (email + password) on the device that has your decks. Everything on it is saved to the account. On your other devices, choose **Log in** with the same email and password. If that device already has data of its own, you pick one:

- **Use my account's data**: replaces what's on this device with the account's.
- **Keep this device's data**: replaces what's in the account with this device's.

After that, every change uploads a few seconds later, and each device picks up the others' changes when you open or return to the app. A copy stays on each device, so the app still works offline and uploads once you're back online. You stay logged in until you click **Log out**. After logging out, the data stays on that device, but changes there no longer reach the account. If two devices both change things before syncing, the app asks which version to keep.

There's no "forgot password" (the app can't send emails), so keep your password somewhere safe. Changing the password logs out your other devices.

**Setting up accounts on the relay (one time).** Accounts are saved by the same Cloudflare relay that loads Archidekt and Moxfield decks:

1. In the Cloudflare dashboard, open **Storage & Databases → KV** (Workers KV) and click **Create**. Name it `mtg-accounts`.
2. Open **Workers & Pages → archidekt-relay → Settings → Bindings**, click **Add → KV namespace**. Set **Variable name** to `ACCOUNTS`, pick `mtg-accounts`, and save.
3. Click **Edit code**, replace everything with the contents of `worker/archidekt-relay.js`, and click **Deploy**.

Until then, logging in says "Accounts are not set up on this relay yet." The free plan is plenty for a few people.

## Sharing with friends

Each person downloads the app on their own PC. To compare one of your decks against a friend's cards:

1. Your friend goes to **Account & backup → Share my collection** and sends you the file.
2. You go to **Account & backup → Add a friend's collection** and pick that file.
3. Open one of your decks and change **Check against** to your friend's collection.

### Sharing a deck with a link

When you're logged in to an account, each deck's page has **Who can view it**:

- **Private** (the default): the deck's link only opens for you, on a device where you're logged in to your account.
- **Public**: anyone with the link can view the deck (not your collection). They see which cards they already have, and can click **Save a copy to my decks**.

Click **Copy link** to get the deck's link. Changes to a public deck show up for others a few seconds after they're saved. Switching it back to Private stops the link from showing the deck. Deleting the deck makes the link stop working.

Under **New decks start as** on **Account & backup**, pick whether decks you import, load from Archidekt or Moxfield, or save from someone's link start out Private or Public. It's Private unless you change it.

Share links are saved by the relay, so after updating the app, deploy `worker/archidekt-relay.js` again (step 3 under [Accounts](#accounts-the-same-decks-on-your-phone-and-computer)).

You can also use **Copy missing list** on a deck, or just send the Archidekt link.

## Prices

Prices are USD market prices from TCGplayer, provided by Scryfall, and update once a day. The app saves that day's prices each time you open it, so the price charts fill in the more often you use it. **Update prices now** on the Prices tab refreshes them by hand.

## Files

```
index.html        the app (open this)
css/styles.css    look and layout
js/app.js         screens and features
js/parser.js      reads Archidekt text exports (also used by the Simulator)
js/archidekt.js   loads public decks from Archidekt (via the relay)
js/scryfall.js    card lookups and prices (also used by the Simulator)
js/store.js       saves data in the browser (also used by the Simulator)
js/backup.js      checks backup and shared-collection files before loading them
js/account.js     logging in and syncing with an account (via the relay)
js/moxfield.js    loads public decks from Moxfield (via the relay)
js/deckcheck.js   deck-building rules for each format
sw.js             lets the app work offline (a "service worker")
manifest.webmanifest, icons/   the app's name and icons for installing it
js/charts.js      price charts
simulator/        the deck Simulator (see simulator/README.md)
tests/            automatic checks for the parts that don't need a browser
worker/           the Archidekt relay and accounts (runs on Cloudflare, not in the browser)
.github/          publishes the site to GitHub Pages after every push
```

## Making changes

- **Tests:** with [Node.js](https://nodejs.org) installed, run `npm test` in this folder. Nothing to install first. They also run on GitHub for every push, and the site isn't published if one fails.
- **Publishing:** pushing to `main` publishes the site. GitHub adds a version number to every script and stylesheet link as it publishes, so visitors always get the new files without a hard refresh. You don't need to change anything in `index.html` for this.
- **One-time setup** (already done if the Actions tab shows green runs): on GitHub go to **Settings → Pages** and set **Source** to **GitHub Actions**.
