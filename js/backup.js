/*
 * Checks MTG Tracker backup files. A backup may come from someone else (a shared profile),
 * so it's rebuilt from the fields the app knows, with every value forced to the right type.
 * Anything unexpected is dropped. Used by both the Tracker and the Simulator.
 */
const Backup = (() => {
  'use strict';
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const NOT_BACKUP = "That file isn't an MTG Tracker backup.";

  // Takes parsed JSON and returns { profiles, cards, history }, or throws if it isn't a backup.
  function clean(data) {
    if (!data || data.app !== 'mtg-tracker' || !Array.isArray(data.profiles)) throw new Error(NOT_BACKUP);
    const text = v => (v == null ? '' : String(v));
    const count = v => Math.max(0, Math.floor(Number(v)) || 0);
    const time = v => (Number.isFinite(Number(v)) ? Number(v) : Date.now());
    const price = v => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const id = v => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null);
    const url = v => (typeof v === 'string' && v.startsWith('https://') ? v : null);
    const list = v => (Array.isArray(v) ? v.map(text) : []);
    const finish = v => (['nonfoil', 'foil', 'etched'].includes(v) ? v : 'nonfoil');
    const word = v => (typeof v === 'string' && /^[a-z_]{1,30}$/.test(v) ? v : '');
    const words = v => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([k, x]) => word(k) && word(x)));
    const rows = (v, fn) => (Array.isArray(v) ? v.filter(r => r && id(r.scryfallId)).map(fn) : []);
    const base = r => ({ scryfallId: r.scryfallId, name: text(r.name), finish: finish(r.finish), qty: count(r.qty) });

    const profiles = data.profiles.filter(p => p && typeof p === 'object').map(p => ({
      id: id(p.id) || newId(),
      name: text(p.name).trim() || 'Profile',
      collection: rows(p.collection, r => ({ ...base(r), proxyQty: count(r.proxyQty), addedAt: time(r.addedAt), ...(r.proxy ? { proxy: true } : {}) })),
      decks: (Array.isArray(p.decks) ? p.decks : []).filter(d => d && typeof d === 'object').map(d => ({
        id: id(d.id) || newId(),
        name: text(d.name).trim() || 'Deck',
        createdAt: time(d.createdAt),
        updatedAt: time(d.updatedAt),
        format: word(d.format),
        cards: rows(d.cards, r => ({ ...base(r), categories: list(r.categories), inDeck: !!r.inDeck, tags: list(r.tags) })),
        // The deck's share link and whether it's public (see "share links" in app.js).
        ...(d.share && typeof d.share.id === 'string' && /^[0-9a-f]{24}$/.test(d.share.id)
          ? { share: { id: d.share.id, public: d.share.public === true } } : {}),
      })),
      wishlist: rows(p.wishlist, r => ({ ...base(r), addedAt: time(r.addedAt) })),
    }));

    const cleanCards = {};
    for (const [key, c] of Object.entries(data.cards || {})) {
      if (!id(key) || !c || typeof c !== 'object') continue;
      const prices = c.prices || {};
      cleanCards[key] = {
        id: key, name: text(c.name), names: list(c.names).map(n => n.toLowerCase()),
        set: text(c.set), setName: text(c.setName), cn: text(c.cn), rarity: text(c.rarity),
        typeLine: text(c.typeLine), manaCost: text(c.manaCost), cmc: Number(c.cmc) || 0, colorIdentity: list(c.colorIdentity),
        legalities: words(c.legalities), oracle: text(c.oracle),
        image: url(c.image), imageSmall: url(c.imageSmall), imageLarge: url(c.imageLarge), art: url(c.art), backImage: url(c.backImage),
        prices: { usd: price(prices.usd), usd_foil: price(prices.usd_foil), usd_etched: price(prices.usd_etched) },
        uri: url(c.uri), updatedAt: time(c.updatedAt),
      };
    }

    const cleanHistory = {};
    for (const [key, h] of Object.entries(data.history || {})) {
      if (!id(key) || !Array.isArray(h)) continue;
      cleanHistory[key] = h.filter(s => s && /^\d{4}-\d{2}-\d{2}$/.test(s.d))
        .map(s => ({ d: s.d, usd: price(s.usd), usd_foil: price(s.usd_foil), usd_etched: price(s.usd_etched) }));
    }

    if (!profiles.length) throw new Error(NOT_BACKUP);
    return { profiles, cards: cleanCards, history: cleanHistory };
  }

  // Reads a backup file's text. Throws a friendly error if it isn't a backup.
  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(NOT_BACKUP);
    }
    return clean(data);
  }

  return { parse, clean };
})();

if (typeof module !== 'undefined') module.exports = Backup;
