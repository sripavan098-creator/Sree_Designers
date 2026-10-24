'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword, randomPassword } = require('./passwords');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  section    TEXT NOT NULL,
  blurb      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS designs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       REAL NOT NULL DEFAULT 0,
  image_url   TEXT NOT NULL,
  featured    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  items_json TEXT NOT NULL,
  total      REAL NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

// Section slugs are stable identifiers used by the API and URLs. Display names
// live here too so a rename never needs a code change anywhere else.
const SECTIONS = [
  { slug: 'embroidery', name: 'Computer Embroidery' },
  { slug: 'maggam', name: 'Maggam Work' },
];

const SECTION_SLUGS = SECTIONS.map((s) => s.slug);

function sectionName(slug) {
  const found = SECTIONS.find((s) => s.slug === slug);
  return found ? found.name : slug;
}

const DEFAULT_CATEGORIES = [
  { name: 'Patchwork', section: 'embroidery', blurb: 'Appliqué and pieced panels joined stitch by stitch.' },
  { name: 'Cutwork', section: 'embroidery', blurb: 'Openwork lace built from cut fabric and dense satin borders.' },
  { name: 'Booti Work', section: 'embroidery', blurb: 'Small scattered motifs, single or multi-head machine runs.' },
  { name: 'Round Neck', section: 'embroidery', blurb: 'Circular neckline motifs for kurtis, blouses and shirts.' },
  { name: 'Flat Neck', section: 'embroidery', blurb: 'Straight, architectural necklines with clean geometry.' },
  { name: 'Heavy Work', section: 'embroidery', blurb: 'Dense thread, sequin and zari runs for statement pieces.' },
  { name: 'Bridal Blouse', section: 'maggam', blurb: 'Full maggam blouses built for weddings and receptions.' },
  { name: 'Blouse Neck', section: 'maggam', blurb: 'Maggam necklines shaped and stitched to your measurement.' },
  { name: 'Sleeve Work', section: 'maggam', blurb: 'Elbow and cap sleeve maggam panels, worked to match the neck.' },
  { name: 'Aari & Zardosi', section: 'maggam', blurb: 'Aari needle and zardosi metal work, stone and bead settings.' },
];

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

function uniqueSlug(base) {
  let slug = slugify(base);
  let n = 2;
  const exists = db.prepare('SELECT 1 FROM categories WHERE slug = ?');
  while (exists.get(slug)) {
    slug = `${slugify(base)}-${n++}`;
  }
  return slug;
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value ?? ''));
}

function seed() {
  const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (catCount === 0) {
    const insert = db.prepare(
      'INSERT INTO categories (slug, name, section, blurb, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    DEFAULT_CATEGORIES.forEach((c, i) => insert.run(slugify(c.name), c.name, c.section, c.blurb, i + 1));
  }

  if (!getSetting('whatsapp_number')) setSetting('whatsapp_number', '');
  if (!getSetting('business_name')) setSetting('business_name', 'Stitch & Steam Studio');
  if (!getSetting('business_tagline')) {
    setSetting('business_tagline', 'Computer embroidery and maggam work for blouses — designed, digitised and stitched in-house.');
  }
  if (!getSetting('logo_url')) setSetting('logo_url', '');

  const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  if (adminCount === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@studio.local';
    const password = process.env.ADMIN_PASSWORD || randomPassword();
    db.prepare(
      "INSERT INTO users (email, name, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')"
    ).run(email, 'Studio Admin', '', hashPassword(password));
    const credPath = path.join(DATA_DIR, 'ADMIN-CREDENTIALS.txt');
    if (!process.env.ADMIN_PASSWORD) {
      fs.writeFileSync(
        credPath,
        [
          'Admin login created on first start.',
          `Email:    ${email}`,
          `Password: ${password}`,
          '',
          'Sign in at /admin (this URL is deliberately not linked from the public site).',
          'Change this password from the admin panel, then delete this file.',
          '',
        ].join('\n'),
        { mode: 0o600 }
      );
      console.log(`[setup] Admin account created: ${email}`);
      console.log(`[setup] Password written to ${credPath}`);
    }
  }
}

seed();

module.exports = {
  db,
  DATA_DIR,
  UPLOAD_DIR,
  SECTIONS,
  SECTION_SLUGS,
  sectionName,
  slugify,
  uniqueSlug,
  getSetting,
  setSetting,
};
