const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const loadWorker = async () => (await import(pathToFileURL(path.join(__dirname, '../worker/archidekt-relay.js')))).default;

// Just enough of Cloudflare KV for the worker.
function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.has(k) ? m.get(k) : null; return v != null && type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
  };
}

function setup() {
  const env = { ACCOUNTS: fakeKV() };
  const call = async (method, p, body, token) => {
    const worker = await loadWorker();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await worker.fetch(new Request('https://relay.test' + p, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, body: await res.json() };
  };
  return { env, call };
}

test('register, save on one device, read on another', async () => {
  const { env, call } = setup();
  const reg = await call('POST', '/account/register', { email: ' Me@Example.com ', password: 'hunter22!' });
  assert.equal(reg.status, 200);
  assert.match(reg.body.token, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify([...env.ACCOUNTS.m]).includes('hunter22!'), 'password is never stored');

  const put = await call('PUT', '/account/data', { baseRev: 0, data: '{"decks":1}' }, reg.body.token);
  assert.deepEqual(put.body.rev, 1);

  const login = await call('POST', '/account/login', { email: 'me@example.com', password: 'hunter22!' });
  assert.equal(login.status, 200);
  assert.equal(login.body.rev, 1);
  const got = await call('GET', '/account/data', null, login.body.token);
  assert.equal(got.body.data, '{"decks":1}');
});

test('a save based on old data is refused', async () => {
  const { call } = setup();
  const { body: { token } } = await call('POST', '/account/register', { email: 'a@b.co', password: 'password1' });
  await call('PUT', '/account/data', { baseRev: 0, data: 'one' }, token);
  const stale = await call('PUT', '/account/data', { baseRev: 0, data: 'two' }, token);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, 1);
  assert.equal((await call('GET', '/account/data', null, token)).body.data, 'one');
});

test('wrong passwords, duplicates and bad input are refused', async () => {
  const { call } = setup();
  await call('POST', '/account/register', { email: 'a@b.co', password: 'password1' });
  assert.equal((await call('POST', '/account/register', { email: 'A@b.co', password: 'password2' })).status, 409);
  assert.equal((await call('POST', '/account/register', { email: 'nope', password: 'password2' })).status, 400);
  assert.equal((await call('POST', '/account/register', { email: 'c@d.co', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/account/login', { email: 'a@b.co', password: 'wrong-one' })).status, 401);
  assert.equal((await call('POST', '/account/login', { email: 'x@y.co', password: 'password1' })).status, 401);
  assert.equal((await call('GET', '/account/data', null, 'f'.repeat(64))).status, 401);
  assert.equal((await call('GET', '/account/data')).status, 401);
});

test('too many wrong passwords locks the email for a while', async () => {
  const { call } = setup();
  await call('POST', '/account/register', { email: 'a@b.co', password: 'password1' });
  for (let i = 0; i < 10; i++) await call('POST', '/account/login', { email: 'a@b.co', password: 'nope-nope' });
  assert.equal((await call('POST', '/account/login', { email: 'a@b.co', password: 'password1' })).status, 429);
});

test('logging out ends only that sign-in; changing the password ends the others', async () => {
  const { call } = setup();
  const a = (await call('POST', '/account/register', { email: 'a@b.co', password: 'password1' })).body.token;
  const b = (await call('POST', '/account/login', { email: 'a@b.co', password: 'password1' })).body.token;
  const c = (await call('POST', '/account/login', { email: 'a@b.co', password: 'password1' })).body.token;
  await call('POST', '/account/logout', {}, b);
  assert.equal((await call('GET', '/account/data', null, b)).status, 401);
  assert.equal((await call('GET', '/account/data', null, a)).status, 200);

  assert.equal((await call('POST', '/account/password', { password: 'wrong-pw', newPassword: 'password2' }, a)).status, 401);
  assert.equal((await call('POST', '/account/password', { password: 'password1', newPassword: 'password2' }, a)).status, 200);
  assert.equal((await call('GET', '/account/data', null, a)).status, 200);
  assert.equal((await call('GET', '/account/data', null, c)).status, 401);
  assert.equal((await call('POST', '/account/login', { email: 'a@b.co', password: 'password1' })).status, 401);
  assert.equal((await call('POST', '/account/login', { email: 'a@b.co', password: 'password2' })).status, 200);
});

test('a public deck opens for anyone; a private one only for its owner', async () => {
  const { call } = setup();
  const owner = (await call('POST', '/account/register', { email: 'a@b.co', password: 'password1' })).body.token;
  const other = (await call('POST', '/account/register', { email: 'c@d.co', password: 'password1' })).body.token;
  const id = 'ab'.repeat(12);

  assert.equal((await call('PUT', `/account/share/${id}`, { deckId: 'd1', public: true, deck: '{"name":"Elves"}' }, owner)).status, 200);
  const open = await call('GET', `/share/${id}`);
  assert.equal(open.status, 200);
  assert.equal(open.body.deck, '{"name":"Elves"}');

  await call('PUT', `/account/share/${id}`, { deckId: 'd1', public: false, deck: '{"name":"Elves"}' }, owner);
  assert.equal((await call('GET', `/share/${id}`)).status, 403);
  assert.equal((await call('GET', `/share/${id}`, null, other)).status, 403);
  const mine = await call('GET', `/share/${id}`, null, owner);
  assert.deepEqual(mine.body, { public: false, deckId: 'd1' });

  assert.equal((await call('PUT', `/account/share/${id}`, { deckId: 'x', public: true, deck: '{}' }, other)).status, 403, "can't take over someone else's link");
  assert.equal((await call('DELETE', `/account/share/${id}`, null, other)).status, 403);
  await call('DELETE', `/account/share/${id}`, null, owner);
  assert.equal((await call('GET', `/share/${id}`, null, owner)).status, 404);
  assert.equal((await call('PUT', '/account/share/nope', { deckId: 'd1', public: false }, owner)).status, 400);
});

test('says so when the relay has no account storage', async () => {
  const worker = await loadWorker();
  const res = await worker.fetch(new Request('https://relay.test/account/login', { method: 'POST', body: '{}' }), {});
  assert.equal(res.status, 503);
});
