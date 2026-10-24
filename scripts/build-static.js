#!/usr/bin/env node
'use strict';

/*
 * Builds a static, deploy-anywhere copy of the shop front for hosts without a
 * server — Vercel in particular. The Node app stays the source of truth; this
 * script reads its SQLite database and writes a snapshot the browser can use.
 *
 *   node scripts/build-static.js [outDir]
 *
 * Output layout (ready for `vercel deploy`):
 *   <out>/index.html, embroidery.html, ...   the pages
 *   <out>/css, <out>/js, <out>/img           assets
 *   <out>/uploads/*                          design photos, copied out of data/
 *   <out>/catalogue.json                     the catalogue snapshot
 *
 * Design photos live in a git-ignored folder and so are NOT in the repository.
 * They are read from the local database and copied into the build here.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'data', 'uploads');

/* Pages served by the Express app; each becomes a .html file on a static host.
   account and admin are omitted on purpose: both are server-backed (sessions,
   uploads, the orders table) and would only render broken on a static host. */
const PAGES = ['index', 'embroidery', 'maggam', 'cart', 'design', '404'];

/* The shim replaces window.fetch with snapshot-backed reads. It must load
   BEFORE app.js and must exist only in this build — the Node server serves the
   real API and would be shadowed if the shim shipped in public/. */
const SHIM_TAG = '<script src="/js/static-api.js"></script>';

function injectShim(html) {
  if (html.includes('/js/static-api.js')) return html;
  let out = html.replace(
    '<script src="/js/app.js"></script>',
    `${SHIM_TAG}\n<script src="/js/app.js"></script>`
  );
  // Mark the document so the static build can suppress server-only affordances.
  out = out.replace('<body', '<body data-static="1"');
  return out;
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      n += copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
      n += 1;
    }
  }
  return n;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    console.error('Start the server once so it seeds the sample catalogue, then run this again.');
    process.exit(1);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  /* ---- pages and assets ---- */
  const shopPages = ['index', 'embroidery', 'maggam', 'cart', 'design'];
  for (const page of PAGES) {
    const src = path.join(ROOT, 'public', `${page}.html`);
    if (!fs.existsSync(src)) continue;
    let html = fs.readFileSync(src, 'utf8');
    // The shim is only meaningful on the pages the shim can actually serve.
    if (shopPages.includes(page)) html = injectShim(html);
    fs.writeFileSync(path.join(OUT, `${page}.html`), html);
  }
  const assetCount = copyDir(path.join(ROOT, 'public', 'css'), path.join(OUT, 'css'))
    + copyDir(path.join(ROOT, 'public', 'js'), path.join(OUT, 'js'))
    + copyDir(path.join(ROOT, 'public', 'img'), path.join(OUT, 'img'));

  /* ---- photos ---- */
  const photoCount = copyDir(UPLOAD_DIR, path.join(OUT, 'uploads'));

  /* ---- catalogue snapshot ---- */
  const db = new DatabaseSync(DB_PATH);
  const readSetting = (key, fallback = '') => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  };

  const categories = db.prepare('SELECT id, name, slug, section, blurb FROM categories ORDER BY id').all();
  const designs = db
    .prepare(`SELECT id, title, description, price, image_url, category_id, featured, created_at
                FROM designs WHERE active = 1 ORDER BY id`)
    .all()
    .map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description || '',
      price: d.price || 0,
      imageUrl: d.image_url,
      categoryId: d.category_id,
      featured: !!d.featured,
      createdAt: d.created_at || null,
    }));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    settings: {
      businessName: readSetting('business_name', 'Sree Designers'),
      tagline: readSetting('business_tagline', ''),
      logoUrl: readSetting('logo_url', ''),
      // Needed so the browser can build the wa.me link without a server.
      whatsappNumber: readSetting('whatsapp_number', ''),
    },
    sections: [
      { slug: 'embroidery', name: 'Computer Embroidery' },
      { slug: 'maggam', name: 'Maggam Work' },
    ],
    categories,
    designs,
  };

  fs.writeFileSync(path.join(OUT, 'catalogue.json'), JSON.stringify(snapshot, null, 2));
  db.close();

  /* ---- host config ----
     cleanUrls is deliberately off. With it on, Vercel rewrites index.html to
     /index and the root path then has nothing to serve, so "/" 404s. Explicit
     rewrites are predictable and keep "/" working. */
  fs.writeFileSync(
    path.join(OUT, 'vercel.json'),
    JSON.stringify(
      {
        cleanUrls: false,
        trailingSlash: false,
        rewrites: PAGES.filter((p) => p !== 'index').map((p) => ({
          source: `/${p}`,
          destination: `/${p}.html`,
        })),
      },
      null,
      2
    ) + '\n'
  );

  const digits = String(snapshot.settings.whatsappNumber).replace(/[^\d]/g, '');
  console.log(`Built static site -> ${OUT}`);
  console.log(`  pages:      ${PAGES.length}`);
  console.log(`  assets:     ${assetCount}`);
  console.log(`  photos:     ${photoCount}`);
  console.log(`  categories: ${categories.length}`);
  console.log(`  designs:    ${designs.length}`);
  console.log(`  whatsapp:   ${digits ? '+' + digits : 'NOT SET — checkout will refuse'}`);
}

main();
