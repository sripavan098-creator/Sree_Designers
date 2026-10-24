'use strict';

const express = require('express');
const { db, SECTIONS } = require('../db');
const auth = require('../auth');

const router = express.Router();

function publicUser(u) {
  return u ? { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role } : null;
}

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const row = auth.login(email, password);
  if (!row) return res.status(401).json({ error: 'Those details did not match our records.' });

  auth.createSession(res, req, row.id);
  const user = db.prepare('SELECT id, email, name, phone, role FROM users WHERE id = ?').get(row.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
  auth.destroySession(res, req, token);
  res.json({ ok: true });
});

router.post('/profile', auth.requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const phone = String(req.body?.phone || '').trim().slice(0, 30);
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
  const user = db.prepare('SELECT id, email, name, phone, role FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/password', auth.requireAuth, (req, res) => {
  const next = String(req.body?.newPassword || '');
  if (next.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
  auth.changePassword(req.user.id, next);
  auth.createSession(res, req, req.user.id);
  res.json({ ok: true });
});

// Section metadata so the client tabs stay in sync with the database.
router.get('/sections', (req, res) => {
  res.json({
    sections: SECTIONS.map((section) => ({
      slug: section.slug,
      name: section.name,
      categories: db.prepare('SELECT COUNT(*) AS n FROM categories WHERE section = ?').get(section.slug).n,
    })),
  });
});

module.exports = router;
