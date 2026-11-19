'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const { StoreError, username, digest } = require('./store.cjs');
const SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const DUMMY_HASH = 'scrypt$32768$8$3$' + Buffer.alloc(16, 71).toString('base64url') + '$' + Buffer.alloc(64, 83).toString('base64url');

function validPassword(password) {
  return typeof password === 'string' && password.length >= 15 && password.length <= 128 && /\S/.test(password) && !/[\u0000-\u001f\u007f]/.test(password);
}
async function hashPassword(password) {
  if (!validPassword(password)) throw new StoreError(400, 'invalid_password', 'Use a password of 15–128 characters without control characters.');
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return 'scrypt$32768$8$3$' + salt.toString('base64url') + '$' + hash.toString('base64url');
}
async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const usable = parts.length === 6 && parts[0] === 'scrypt' && parts[1] === '32768' && parts[2] === '8' && parts[3] === '3'
    && /^[A-Za-z0-9_-]{22}$/.test(parts[4]) && /^[A-Za-z0-9_-]{86}$/.test(parts[5]);
  const selected = usable ? parts : DUMMY_HASH.split('$');
  const salt = Buffer.from(selected[4], 'base64url'), expected = Buffer.from(selected[5], 'base64url');
  const supplied = typeof password === 'string' && password.length <= 128 ? password : '';
  const actual = await scrypt(supplied, salt, 64, SCRYPT_OPTIONS);
  return usable && validPassword(password) && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function csrfFor(token) { return crypto.createHmac('sha256', token).update('PanelReply-private-workspace-csrf-v1').digest('base64url'); }
function exactSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function cookieToken(header, cookieName) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const matches = header.split(';').map(item => item.trim()).filter(item => item.startsWith(cookieName + '='));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function createAuth(store, { secure = false } = {}) {
  const cookieName = secure ? '__Host-PanelReplySession' : 'PanelReplyLocalSession';
  let concurrentLogins = 0;
  return {
    cookieName,
    cookie(token, expired = false) {
      return cookieName + '=' + (expired ? '' : token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (expired ? '0' : '28800') + (secure ? '; Secure' : '');
    },
    async login(input, remoteAddress = 'local') {
      let name;
      try { name = username(input.username); } catch (_) { name = ''; }
      const userKey = 'user:' + digest(name || 'invalid');
      const ipKey = 'ip:' + digest(String(remoteAddress));
      if (concurrentLogins >= 2 || !store.consumeLoginAttempt(ipKey, 60) || !store.consumeLoginAttempt(userKey, 5)) throw new StoreError(429, 'login_rate_limited', 'Too many sign-in attempts. Try again later.');
      concurrentLogins += 1;
      try {
        const row = name ? store.findUser(name) : null;
        const valid = await verifyPassword(input.password, row ? row.password_hash : DUMMY_HASH);
        if (!row || !valid) throw new StoreError(401, 'invalid_credentials', 'The username or password was not accepted.');
        store.resetLoginAttempts(userKey);
        const token = crypto.randomBytes(32).toString('base64url');
        store.createSession(row.id, digest(token));
        return { user: store.publicUser(row), token, csrfToken: csrfFor(token) };
      } finally { concurrentLogins -= 1; }
    },
    session(req) {
      const token = cookieToken(req.headers.cookie, cookieName);
      const user = token ? store.session(digest(token)) : null;
      return user ? { user, token, csrfToken: csrfFor(token) } : null;
    },
    logout(session) { if (session) store.deleteSession(digest(session.token)); },
    verifyCsrf(session, value) { return !!session && exactSecret(value, session.csrfToken); }
  };
}

module.exports = { hashPassword, verifyPassword, validPassword, createAuth, csrfFor, cookieToken };
