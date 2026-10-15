/*
 * Talks to the free Scryfall API (https://scryfall.com/docs/api) for card data, images and prices.
 * Scryfall asks for no more than ~10 requests per second, so requests are spaced out.
 * Shared by MTG Tracker and the Simulator, so both save cards in the same shape.
 */
const Scryfall = (() => {
  'use strict';
  const API = 'https://api.scryfall.com';
  const GAP_MS = 120;
  let lastRequest = 0;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function request(path, body) {
    const wait = lastRequest + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();

    const opts = { headers: { Accept: 'application/json' } };
    if (body) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + path, opts);
    if (res.status === 429) {
      await sleep(1000);
      return request(path, body);
    }
    const data = await res.json();
    if (!res.ok && res.status !== 404) throw new Error(data.details || `Scryfall error ${res.status}`);
    return res.ok ? data : null;
  }

  const num = v => (v == null ? null : Number(v));

  function simplify(c) {
    const faces = c.card_faces || [];
    const face = faces[0] || {};
    const img = c.image_uris || face.image_uris || {};
    return {
      id: c.id,
      oracleId: c.oracle_id || face.oracle_id || null,
      name: c.name,
      names: [c.name, ...faces.map(f => f.name)].map(n => n.toLowerCase()),
      set: c.set,
      setName: c.set_name,
      cn: c.collector_number,
      rarity: c.rarity,
      typeLine: c.type_line || face.type_line || '',
      manaCost: c.mana_cost || face.mana_cost || '',
      cmc: c.cmc || 0,
      colorIdentity: c.color_identity || [],
      legalities: c.legalities || {}, // { commander: 'legal' | 'not_legal' | 'banned' | 'restricted', … }
      image: img.normal || img.large || img.small || null,
      imageSmall: img.small || img.normal || null,
      imageLarge: img.large || img.normal || null,
      art: img.art_crop || null,
      backImage: faces[1] && faces[1].image_uris ? faces[1].image_uris.normal : null,
      prices: {
        usd: num(c.prices && c.prices.usd),
        usd_foil: num(c.prices && c.prices.usd_foil),
        usd_etched: num(c.prices && c.prices.usd_etched),
      },
      uri: c.scryfall_uri,
      // For playing in the Simulator.
      oracle: c.oracle_text || faces.map(f => `${f.name}: ${f.oracle_text || ''}`).join('\n\n'),
      power: c.power || face.power || null,
      toughness: c.toughness || face.toughness || null,
      loyalty: c.loyalty || face.loyalty || null,
      producedMana: c.produced_mana || [],
      tokens: (c.all_parts || [])
        .filter(p => p.component === 'token' || (p.component === 'combo_piece' && /token|emblem/i.test(p.type_line || '')))
        .filter(p => p.id !== c.id)
        .map(p => ({ id: p.id, name: p.name })),
      updatedAt: Date.now(),
    };
  }

  // identifiers: [{id}] or [{set, collector_number}] or [{name}] — any number, sent 75 at a time.
  async function collection(identifiers, onProgress) {
    const found = [];
    const notFound = [];
    for (let i = 0; i < identifiers.length; i += 75) {
      const chunk = identifiers.slice(i, i + 75);
      const data = await request('/cards/collection', { identifiers: chunk });
      found.push(...data.data.map(simplify));
      notFound.push(...(data.not_found || []));
      if (onProgress) onProgress(Math.min(i + 75, identifiers.length), identifiers.length);
    }
    return { found, notFound };
  }

  async function named(name, fuzzy) {
    const data = await request(`/cards/named?${fuzzy ? 'fuzzy' : 'exact'}=${encodeURIComponent(name)}`);
    return data ? simplify(data) : null;
  }

  // Finds the card behind something dragged from scryfall.com: a card image
  // (cards.scryfall.io/…/<id>.jpg) or a card page link (scryfall.com/card/<set>/<number>/…).
  async function fromDrop(text) {
    const id = text.match(/(?:cards\.scryfall\.io\/[a-z_]+\/(?:front|back)\/[0-9a-f]\/[0-9a-f]\/|api\.scryfall\.com\/cards\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (id) {
      const data = await request(`/cards/${id[1]}`);
      return data ? simplify(data) : null;
    }
    const page = text.match(/scryfall\.com\/card\/([a-z0-9]+)\/([^/?#"'\s]+)/i);
    if (page) {
      const data = await request(`/cards/${encodeURIComponent(page[1])}/${encodeURIComponent(decodeURIComponent(page[2]))}`);
      return data ? simplify(data) : null;
    }
    return null;
  }

  async function autocomplete(q) {
    const data = await request(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
    return data ? data.data : [];
  }

  async function byId(id) {
    const data = await request(`/cards/${encodeURIComponent(id)}`);
    return data ? simplify(data) : null;
  }

  async function searchTokens(q) {
    const query = `t:token ${q}`.trim();
    const data = await request(`/cards/search?q=${encodeURIComponent(query)}&include_extras=true&unique=cards&order=name`);
    return data ? data.data.slice(0, 60).map(simplify) : [];
  }

  // Every printing of a card, newest first (at most 4 pages of 175).
  async function prints(card) {
    const q = card.oracleId ? `oracleid:${card.oracleId}` : `!"${card.name}"`;
    let path = `/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`;
    const list = [];
    for (let page = 0; path && page < 4; page++) {
      const data = await request(path);
      if (!data) break;
      list.push(...data.data.map(simplify));
      path = data.has_more && data.next_page ? data.next_page.replace(API, '') : null;
    }
    return list;
  }

  return { collection, named, autocomplete, fromDrop, byId, searchTokens, prints };
})();
