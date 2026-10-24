'use strict';

const { db } = require('./db');
const { verifyPassword, hashPassword, randomToken } = require('./passwords');

const SESSION_DAYS = 14;
const COOKIE_NAME = 'studio_session';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function isSecureRequest(req) {
  return Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

function setSessionCookie(res, req, token, maxAgeSeconds) {
  const bits = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(req)) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

function createSession(res, req, userId) {
  const token = randomToken(32);
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  ).run(token, userId, `+${SESSION_DAYS} days`);
  setSessionCookie(res, req, token, SESSION_DAYS * 24 * 60 * 60);
  return token;
}

function destroySession(res, req, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  setSessionCookie(res, req, '', 0);
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.phone, u.role, s.token
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
    )
    .get(token);
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role, token: row.token };
}

function attachUser(req, res, next) {
  req.user = currentUser(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Admin sign-in required.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  next();
}

function login(email, password) {
  const row = db
    .prepare('SELECT id, email, password_hash, active FROM users WHERE email = ? COLLATE NOCASE')
    .get(String(email || '').trim());
  if (!row || !row.active) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return row;
}

function changePassword(userId, newPassword) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  attachUser,
  requireAuth,
  requireAdmin,
  createSession,
  destroySession,
  currentUser,
  login,
  changePassword,
  purgeExpiredSessions,
};
