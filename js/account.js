/*
 * Talks to the account part of the relay (worker/archidekt-relay.js), so the same profiles,
 * collections and decks show up on every device you log in on. The app decides when to
 * upload and download; this file only sends the requests.
 * acc is the saved sign-in: { server, email, token, rev }.
 */
const Account = (() => {
  'use strict';

  async function call(server, method, path, token, body) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(server.replace(/\/+$/, '') + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      const err = new Error("Couldn't reach your account. Check your internet connection.");
      err.status = 0;
      throw err;
    }
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(data.error || `The account server answered ${res.status}.`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    register: (server, email, password) => call(server, 'POST', '/account/register', null, { email, password }),
    login: (server, email, password) => call(server, 'POST', '/account/login', null, { email, password }),
    logout: acc => call(acc.server, 'POST', '/account/logout', acc.token, {}),
    changePassword: (acc, password, newPassword) => call(acc.server, 'POST', '/account/password', acc.token, { password, newPassword }),
    // -> { rev, updatedAt, data } where data is the text saved by push (null for a new account)
    pull: acc => call(acc.server, 'GET', '/account/data', acc.token),
    // -> { rev, updatedAt }; fails with status 409 if another device saved since baseRev
    push: (acc, baseRev, data) => call(acc.server, 'PUT', '/account/data', acc.token, { baseRev, data }),
    // A deck's share link. deck is the deck's text, only sent when it's public.
    share: (acc, id, deckId, isPublic, deck) => call(acc.server, 'PUT', '/account/share/' + id, acc.token, { deckId, public: isPublic, deck: isPublic ? deck : undefined }),
    unshare: (acc, id) => call(acc.server, 'DELETE', '/account/share/' + id, acc.token),
    // Opening a link: -> { public: true, deck, updatedAt } or, for your own private deck, { public: false, deckId }.
    // token is optional; without it a private deck fails with status 403.
    viewShare: (server, id, token) => call(server, 'GET', '/share/' + encodeURIComponent(id), token),
  };
})();

if (typeof module !== 'undefined') module.exports = Account;
