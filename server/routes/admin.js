'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const { db, UPLOAD_DIR, SECTION_SLUGS, sectionName, uniqueSlug, getSetting, setSetting } = require('../db');
const auth = require('../auth');

const router = express.Router();
router.use(auth.requireAdmin);

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) || path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP, GIF or AVIF images are allowed.'));
    cb(null, true);
  },
});

const uploadImages = upload.array('images', 12);

// multer errors must not leak stack traces to the browser.
function handleUpload(req, res, next) {
  uploadImages(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

router.get('/overview', (req, res) => {
  const counts = {
    designs: db.prepare('SELECT COUNT(*) AS n FROM designs').get().n,
    featured: db.prepare('SELECT COUNT(*) AS n FROM designs WHERE featured = 1').get().n,
    categories: db.prepare('SELECT COUNT(*) AS n FROM categories').get().n,
    users: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get().n,
    orders: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
  };
  res.json({
    counts,
    businessName: getSetting('business_name'),
    tagline: getSetting('business_tagline'),
    whatsappNumber: getSetting('whatsapp_number'),
    logoUrl: getSetting('logo_url'),
  });
});

// Brand logo shown in the header and footer of every page.
router.post('/logo', (req, res) => {
  upload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a logo image.' });

    const previous = getSetting('logo_url');
    if (previous) removeUpload(previous);
    const logoUrl = `/uploads/${req.file.filename}`;
    setSetting('logo_url', logoUrl);
    res.json({ ok: true, logoUrl });
  });
});

router.delete('/logo', (req, res) => {
  const previous = getSetting('logo_url');
  if (previous) removeUpload(previous);
  setSetting('logo_url', '');
  res.json({ ok: true });
});

router.post('/settings', (req, res) => {
  const businessName = String(req.body?.businessName || '').trim().slice(0, 80);
  const tagline = String(req.body?.tagline || '').trim().slice(0, 240);
  const whatsappNumber = String(req.body?.whatsappNumber || '').replace(/[^\d+]/g, '').slice(0, 20);

  if (businessName) setSetting('business_name', businessName);
  setSetting('business_tagline', tagline);
  if (whatsappNumber) setSetting('whatsapp_number', whatsappNumber);

  res.json({
    ok: true,
    businessName: getSetting('business_name'),
    tagline: getSetting('business_tagline'),
    whatsappNumber: getSetting('whatsapp_number'),
  });
});

router.get('/categories', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM designs d WHERE d.category_id = c.id) AS design_count
         FROM categories c ORDER BY c.section, c.sort_order, c.name`
    )
    .all();
  res.json({
    categories: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      section: r.section,
      blurb: r.blurb,
      sortOrder: r.sort_order,
      designCount: r.design_count,
    })),
  });
});

router.post('/categories', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const section = String(req.body?.section || '').trim();
  const blurb = String(req.body?.blurb || '').trim().slice(0, 240);
  if (!name) return res.status(400).json({ error: 'Category name is required.' });
  if (!SECTION_SLUGS.includes(section)) return res.status(400).json({ error: 'Pick a section: ' + SECTION_SLUGS.map((s) => sectionName(s)).join(' or ') + '.' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM categories').get().n;
  const info = db
    .prepare('INSERT INTO categories (slug, name, section, blurb, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(uniqueSlug(name), name, section, blurb, maxOrder + 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.post('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });

  const name = String(req.body?.name || existing.name).trim().slice(0, 60);
  const section = SECTION_SLUGS.includes(req.body?.section) ? req.body.section : existing.section;
  const blurb = String(req.body?.blurb ?? existing.blurb).trim().slice(0, 240);
  const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : existing.sort_order;

  db.prepare('UPDATE categories SET name = ?, section = ?, blurb = ?, sort_order = ? WHERE id = ?').run(
    name,
    section,
    blurb,
    sortOrder,
    id
  );
  res.json({ ok: true });
});

router.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const images = db.prepare('SELECT image_url FROM designs WHERE category_id = ?').all(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  for (const row of images) removeUpload(row.image_url);
  res.json({ ok: true });
});

function removeUpload(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(imageUrl));
  fs.rm(file, { force: true }, () => {});
}

router.get('/designs', (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.section && SECTION_SLUGS.includes(String(req.query.section))) {
    clauses.push('c.section = ?');
    params.push(String(req.query.section));
  }
  if (req.query.category) {
    clauses.push('c.id = ?');
    params.push(Number(req.query.category));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT d.*, c.name AS category_name, c.section AS section
         FROM designs d JOIN categories c ON c.id = d.category_id
         ${where}
        ORDER BY c.section, c.sort_order, d.sort_order, d.id DESC`
    )
    .all(...params);
  res.json({
    designs: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      price: r.price,
      imageUrl: r.image_url,
      featured: Boolean(r.featured),
      active: Boolean(r.active),
      categoryId: r.category_id,
      categoryName: r.category_name,
      section: r.section,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    })),
  });
});

// Bulk upload: many photos at once, all landing in one chosen category.
router.post('/designs', handleUpload, (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'Choose at least one image to upload.' });

  const categoryId = Number(req.body?.categoryId);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) {
    for (const f of files) fs.rm(f.path, { force: true }, () => {});
    return res.status(400).json({ error: 'Pick a category for these photos.' });
  }

  const baseTitle = String(req.body?.title || '').trim().slice(0, 90);
  const description = String(req.body?.description || '').trim().slice(0, 600);
  const price = Math.max(0, num(req.body?.price, 0));
  const featured = String(req.body?.featured || '') === '1' || req.body?.featured === true ? 1 : 0;

  const insert = db.prepare(
    `INSERT INTO designs (category_id, title, description, price, image_url, featured, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM designs').get().n;

  const created = [];
  files.forEach((file, i) => {
    const title = baseTitle || `${category.name} design ${maxOrder + i + 1}`;
    const info = insert.run(
      category.id,
      files.length > 1 && baseTitle ? `${title} ${i + 1}` : title,
      description,
      price,
      `/uploads/${file.filename}`,
      featured,
      maxOrder + i + 1
    );
    created.push(Number(info.lastInsertRowid));
  });

  res.json({ ok: true, created, count: created.length });
});

router.post('/designs/:id', handleUpload, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM designs WHERE id = ?').get(id);
  if (!existing) {
    for (const f of req.files || []) fs.rm(f.path, { force: true }, () => {});
    return res.status(404).json({ error: 'Design not found.' });
  }

  const body = req.body || {};
  const categoryId = Number.isFinite(Number(body.categoryId)) ? Number(body.categoryId) : existing.category_id;
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(400).json({ error: 'Pick a valid category.' });

  const replacement = (req.files || [])[0];
  const imageUrl = replacement ? `/uploads/${replacement.filename}` : existing.image_url;
  if (replacement) removeUpload(existing.image_url);

  db.prepare(
    `UPDATE designs
        SET category_id = ?, title = ?, description = ?, price = ?, image_url = ?, featured = ?, active = ?, sort_order = ?
      WHERE id = ?`
  ).run(
    category.id,
    String(body.title ?? existing.title).trim().slice(0, 90) || existing.title,
    String(body.description ?? existing.description).trim().slice(0, 600),
    Math.max(0, num(body.price, existing.price)),
    imageUrl,
    body.featured === undefined ? existing.featured : String(body.featured) === '1' || body.featured === true ? 1 : 0,
    body.active === undefined ? existing.active : String(body.active) === '1' || body.active === true ? 1 : 0,
    Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : existing.sort_order,
    id
  );
  res.json({ ok: true, imageUrl });
});

router.delete('/designs/:id', (req, res) => {
  const row = db.prepare('SELECT image_url FROM designs WHERE id = ?').get(Number(req.params.id));
  db.prepare('DELETE FROM designs WHERE id = ?').run(Number(req.params.id));
  if (row) removeUpload(row.image_url);
  res.json({ ok: true });
});

router.get('/users', (req, res) => {
  const rows = db
    .prepare("SELECT id, email, name, phone, active, created_at FROM users WHERE role = 'user' ORDER BY id DESC")
    .all();
  res.json({
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      phone: r.phone,
      active: Boolean(r.active),
      createdAt: r.created_at,
    })),
  });
});

router.post('/users', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const phone = String(req.body?.phone || '').trim().slice(0, 30);
  const password = String(req.body?.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
    return res.status(409).json({ error: 'That email already has an account.' });
  }
  const { hashPassword } = require('../passwords');
  const info = db
    .prepare("INSERT INTO users (email, name, phone, password_hash, role) VALUES (?, ?, ?, ?, 'user')")
    .run(email, name, phone, hashPassword(password));
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.post('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(id);
  if (!row) return res.status(404).json({ error: 'User not found.' });

  const body = req.body || {};
  const active = body.active === undefined ? row.active : String(body.active) === '1' || body.active === true ? 1 : 0;
  db.prepare('UPDATE users SET name = ?, phone = ?, active = ? WHERE id = ?').run(
    String(body.name ?? row.name).trim().slice(0, 80),
    String(body.phone ?? row.phone).trim().slice(0, 30),
    active,
    id
  );

  if (String(body.password || '').length >= 8) {
    const { hashPassword } = require('../passwords');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.password)), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  } else if (!active) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'user'").run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/orders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, u.email AS user_email FROM orders o
         LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 200`
    )
    .all();
  res.json({
    orders: rows.map((r) => ({
      id: r.id,
      userEmail: r.user_email || 'guest',
      items: JSON.parse(r.items_json),
      total: r.total,
      note: r.note,
      createdAt: r.created_at,
    })),
  });
});

module.exports = router;
