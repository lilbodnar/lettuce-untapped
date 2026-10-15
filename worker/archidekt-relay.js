/*
 * Archidekt and Moxfield relay for MTG Tracker — a Cloudflare Worker (free plan is plenty).
 * Archidekt's and Moxfield's APIs only answer requests from their own websites, so the app asks
 * this relay instead, and the relay asks them. It only passes through read-only public deck requests:
 *   /api/decks/…          -> https://archidekt.com/api/decks/…
 *   /moxfield/decks/<id>  -> https://api2.moxfield.com/v3/decks/all/<id>
 *
 * It also keeps MTG Tracker accounts (email + password), so the same decks show up on every device.
 * That part needs a KV namespace bound to the worker as ACCOUNTS; without it, only the relay works.
 *   POST   /account/register  { email, password }      -> { token, rev }
 *   POST   /account/login     { email, password }      -> { token, rev }
 *   POST   /account/logout                              (signs out this device only)
 *   POST   /account/password  { password, newPassword } (signs out every other device)
 *   GET    /account/data                                -> { rev, updatedAt, data }
 *   PUT    /account/data      { baseRev, data }         -> { rev }, or 409 if another device saved first
 *   PUT    /account/share/<id> { deckId, public, deck }  (saves a deck's share link; deck is left out when private)
 *   DELETE /account/share/<id>                          (the link stops working)
 *   GET    /share/<id>        -> { public: true, deck, updatedAt } for anyone, or for a private deck
 *                                { public: false, deckId } only when signed in as its owner (403 otherwise)
 * Everything but register, login and GET /share needs "Authorization: Bearer <token>".
 * Passwords are stored only as salted PBKDF2 hashes. Sign-ins never expire; logging out ends one.
 * Setup steps are in README.md under "Loading decks straight from Archidekt or Moxfield" and "Accounts".
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
};

function upstreamUrl(url) {
  if (url.pathname.startsWith('/api/decks/')) return 'https://archidekt.com' + url.pathname + url.search;
  const mox = url.pathname.match(/^\/moxfield\/decks\/([\w-]+)$/);
  if (mox) return `https://api2.moxfield.com/v3/decks/all/${mox[1]}`;
  return null;
}

async function relay(request) {
  const target = request.method === 'GET' ? upstreamUrl(new URL(request.url)) : null;
  if (!target) return new Response('Not found', { status: 404, headers: CORS });
  const upstream = await fetch(target, {
    headers: { Accept: 'application/json', 'User-Agent': 'mtg-tracker-relay' },
    cf: { cacheTtl: 60 },
  });
  const headers = new Headers(CORS);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  return new Response(upstream.body, { status: upstream.status, headers });
}

// ---------- accounts ----------

const ITERATIONS = 100000; // the most PBKDF2 rounds Cloudflare Workers allow
const MAX_DATA = 20 * 1024 * 1024; // KV values can be up to 25 MB
const MAX_DECK = 2 * 1024 * 1024; // one shared deck, with its card info
const MAX_FAILS = 10; // wrong passwords in a row before an email is locked for 15 minutes
const LOCK_SECONDS = 15 * 60;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status, error) => json({ error }, status);

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

async function hashPassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256);
  return hex(bits);
}

// Compares two hex strings without stopping at the first difference.
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const cleanEmail = v => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const validEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 200;

// KV keys: user:<email> (password hash), session:<sha256 of token> (email),
// sessions:<email> (list of that email's session hashes), data:<email> (the saved app data),
// rev:<email> ({ rev, updatedAt }), fails:<email> (wrong-password count),
// share:<id> ({ email, deckId, public, deck, updatedAt }: a deck's share link; deck is null when private).
const validShareId = id => /^[0-9a-f]{24}$/.test(id);
async function newSession(kv, email) {
  const token = randomHex(32);
  const id = await sha256(token);
  await kv.put('session:' + id, email);
  const list = (await kv.get('sessions:' + email, 'json')) || [];
  await kv.put('sessions:' + email, JSON.stringify([...list, id].slice(-50)));
  return token;
}

async function sessionEmail(kv, request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return { id: null, email: null };
  const id = await sha256(m[1]);
  return { id, email: await kv.get('session:' + id) };
}

async function readRev(kv, email) {
  return (await kv.get('rev:' + email, 'json')) || { rev: 0, updatedAt: 0 };
}

async function checkPassword(kv, email, password) {
  const fails = Number(await kv.get('fails:' + email)) || 0;
  if (fails >= MAX_FAILS) return 'locked';
  const user = await kv.get('user:' + email, 'json');
  const ok = user && validPassword(password) && sameHex(await hashPassword(password, user.salt, user.iterations), user.hash);
  if (ok) {
    if (fails) await kv.delete('fails:' + email);
    return 'ok';
  }
  await kv.put('fails:' + email, String(fails + 1), { expirationTtl: LOCK_SECONDS });
  return 'wrong';
}

async function account(request, env, path) {
  const kv = env.ACCOUNTS;
  if (!kv) return fail(503, 'Accounts are not set up on this relay yet.');
  let body = {};
  if (request.method === 'POST' || request.method === 'PUT') {
    const len = Number(request.headers.get('Content-Length')) || 0;
    if (len > MAX_DATA + 1024) return fail(413, 'That is too much data to save.');
    try {
      body = await request.json();
    } catch (e) {
      return fail(400, 'Bad request.');
    }
    if (!body || typeof body !== 'object') return fail(400, 'Bad request.');
  }

  if (path === '/account/register' && request.method === 'POST') {
    const email = cleanEmail(body.email);
    if (!validEmail(email)) return fail(400, 'Please enter a valid email address.');
    if (!validPassword(body.password)) return fail(400, 'Passwords need at least 8 characters.');
    if (await kv.get('user:' + email)) return fail(409, 'There is already an account with that email. Log in instead.');
    const salt = randomHex(16);
    const hash = await hashPassword(body.password, salt, ITERATIONS);
    await kv.put('user:' + email, JSON.stringify({ salt, hash, iterations: ITERATIONS, createdAt: Date.now() }));
    return json({ token: await newSession(kv, email), rev: 0 });
  }

  if (path === '/account/login' && request.method === 'POST') {
    const email = cleanEmail(body.email);
    const result = await checkPassword(kv, email, body.password);
    if (result === 'locked') return fail(429, 'Too many wrong passwords. Try again in 15 minutes.');
    if (result !== 'ok') return fail(401, 'Wrong email or password.');
    return json({ token: await newSession(kv, email), rev: (await readRev(kv, email)).rev });
  }

  const { id, email } = await sessionEmail(kv, request);
  if (!email) return fail(401, 'You have been logged out. Please log in again.');

  if (path === '/account/logout' && request.method === 'POST') {
    await kv.delete('session:' + id);
    const list = (await kv.get('sessions:' + email, 'json')) || [];
    await kv.put('sessions:' + email, JSON.stringify(list.filter(x => x !== id)));
    return json({ ok: true });
  }

  if (path === '/account/password' && request.method === 'POST') {
    const result = await checkPassword(kv, email, body.password);
    if (result === 'locked') return fail(429, 'Too many wrong passwords. Try again in 15 minutes.');
    if (result !== 'ok') return fail(401, 'Your current password is wrong.');
    if (!validPassword(body.newPassword)) return fail(400, 'Passwords need at least 8 characters.');
    const salt = randomHex(16);
    const hash = await hashPassword(body.newPassword, salt, ITERATIONS);
    const user = await kv.get('user:' + email, 'json');
    await kv.put('user:' + email, JSON.stringify({ ...user, salt, hash, iterations: ITERATIONS }));
    // Everyone else who knew the old password is signed out; this device stays in.
    const list = (await kv.get('sessions:' + email, 'json')) || [];
    await Promise.all(list.filter(x => x !== id).map(x => kv.delete('session:' + x)));
    await kv.put('sessions:' + email, JSON.stringify([id]));
    return json({ ok: true });
  }

  if (path === '/account/data' && request.method === 'GET') {
    const { rev, updatedAt } = await readRev(kv, email);
    return json({ rev, updatedAt, data: rev ? await kv.get('data:' + email) : null });
  }

  if (path === '/account/data' && request.method === 'PUT') {
    if (typeof body.data !== 'string' || body.data.length > MAX_DATA) return fail(400, 'Bad request.');
    const current = await readRev(kv, email);
    if (Number(body.baseRev) !== current.rev) return json({ error: 'Another device saved newer changes.', rev: current.rev }, 409);
    const next = { rev: current.rev + 1, updatedAt: Date.now() };
    await kv.put('data:' + email, body.data);
    await kv.put('rev:' + email, JSON.stringify(next));
    return json(next);
  }

  const share = path.match(/^\/account\/share\/([^/]+)$/);
  if (share && (request.method === 'PUT' || request.method === 'DELETE')) {
    const shareId = share[1];
    if (!validShareId(shareId)) return fail(400, 'Bad request.');
    const existing = await kv.get('share:' + shareId, 'json');
    if (existing && existing.email !== email) return fail(403, 'That link belongs to someone else.');
    if (request.method === 'DELETE') {
      await kv.delete('share:' + shareId);
      return json({ ok: true });
    }
    const isPublic = body.public === true;
    if (typeof body.deckId !== 'string' || body.deckId.length > 100) return fail(400, 'Bad request.');
    if (isPublic && (typeof body.deck !== 'string' || body.deck.length > MAX_DECK)) return fail(400, 'Bad request.');
    const updatedAt = Date.now();
    await kv.put('share:' + shareId, JSON.stringify({ email, deckId: body.deckId, public: isPublic, deck: isPublic ? body.deck : null, updatedAt }));
    return json({ ok: true, updatedAt });
  }

  return fail(404, 'Not found.');
}

// Opening a deck's link. A public deck is sent to anyone; a private one only tells its owner
// (signed in on that device) which of their decks it is.
async function viewShare(request, env, shareId) {
  const kv = env.ACCOUNTS;
  if (!kv) return fail(503, 'Accounts are not set up on this relay yet.');
  const entry = validShareId(shareId) ? await kv.get('share:' + shareId, 'json') : null;
  if (!entry) return fail(404, "This deck link doesn't work anymore. Its owner may have deleted the deck.");
  if (entry.public) return json({ public: true, deck: entry.deck, updatedAt: entry.updatedAt });
  const { email } = await sessionEmail(kv, request);
  if (email !== entry.email) return fail(403, 'This deck is private. Only its owner can open it, while logged in to their account.');
  return json({ public: false, deckId: entry.deckId });
}

export default {
  async fetch(request, env = {}) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(request.url).pathname;
    const shareView = request.method === 'GET' && path.match(/^\/share\/([^/]+)$/);
    if (path.startsWith('/account/') || shareView) {
      try {
        return await (shareView ? viewShare(request, env, shareView[1]) : account(request, env, path));
      } catch (e) {
        return fail(500, 'The account server had a problem. Try again.');
      }
    }
    return relay(request);
  },
};
