'use strict';

const express = require('express');
const { db, SECTIONS, SECTION_SLUGS, sectionName, getSetting } = require('../db');

const router = express.Router();

function designRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    imageUrl: row.image_url,
    featured: Boolean(row.featured),
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    section: row.section,
    createdAt: row.created_at,
  };
}

const DESIGN_SELECT = `
  SELECT d.*, c.name AS category_name, c.slug AS category_slug, c.section AS section
    FROM designs d
    JOIN categories c ON c.id = d.category_id
`;

router.get('/settings', (req, res) => {
  res.json({
    businessName: getSetting('business_name'),
    tagline: getSetting('business_tagline'),
    whatsappConfigured: Boolean(getSetting('whatsapp_number')),
    logoUrl: getSetting('logo_url'),
    sections: SECTIONS.map((s) => ({ slug: s.slug, name: s.name })),
  });
});

router.get('/categories', (req, res) => {
  const section = req.query.section ? String(req.query.section) : null;
  if (section && !SECTION_SLUGS.includes(section)) {
    return res.status(400).json({ error: 'Unknown section.' });
  }
  const rows = section
    ? db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM designs d WHERE d.category_id = c.id AND d.active = 1) AS design_count
             FROM categories c WHERE c.section = ? ORDER BY c.sort_order, c.name`
        )
        .all(section)
    : db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM designs d WHERE d.category_id = c.id AND d.active = 1) AS design_count
             FROM categories c ORDER BY c.sort_order, c.name`
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

router.get('/designs', (req, res) => {
  const clauses = ['d.active = 1'];
  const params = [];
  if (req.query.section) {
    if (!SECTION_SLUGS.includes(String(req.query.section))) return res.status(400).json({ error: 'Unknown section.' });
    clauses.push('c.section = ?');
    params.push(String(req.query.section));
  }
  if (req.query.category) {
    clauses.push('c.slug = ?');
    params.push(String(req.query.category));
  }
  if (req.query.featured === '1') clauses.push('d.featured = 1');
  const limit = Math.min(Number(req.query.limit) || 120, 300);

  const rows = db
    .prepare(`${DESIGN_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY d.featured DESC, d.sort_order, d.id DESC LIMIT ?`)
    .all(...params, limit);
  res.json({ designs: rows.map(designRow) });
});

router.get('/designs/:id', (req, res) => {
  const row = db.prepare(`${DESIGN_SELECT} WHERE d.id = ? AND d.active = 1`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'That design is no longer available.' });

  const related = db
    .prepare(
      `${DESIGN_SELECT} WHERE d.active = 1 AND d.category_id = ? AND d.id != ? ORDER BY d.sort_order, d.id DESC LIMIT 6`
    )
    .all(row.category_id, row.id);

  res.json({ design: designRow(row), related: related.map(designRow) });
});

module.exports = router;
