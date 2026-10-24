'use strict';

const express = require('express');
const { db, sectionName, getSetting } = require('../db');
const auth = require('../auth');

const router = express.Router();

function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function buildMessage({ orderId, items, total, note, user, req, businessName }) {
  const origin = baseUrl(req);
  const lines = [];
  lines.push(`*New order from ${businessName}*`);
  if (orderId) lines.push(`Order reference: #${orderId}`);
  lines.push('');
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.title}`);
    lines.push(`   Category: ${item.categoryName} (${sectionName(item.section)})`);
    if (item.price > 0) lines.push(`   Price: INR ${item.price.toFixed(2)}`);
    lines.push(`   Qty: ${item.qty}`);
    lines.push(`   Photo: ${origin}${item.imageUrl}`);
    lines.push('');
  });
  if (total > 0) lines.push(`Estimated total: INR ${total.toFixed(2)}`, '');
  if (note) lines.push(`Notes: ${note}`, '');
  if (user) {
    lines.push('Customer details:');
    lines.push(`   Name: ${user.name || '(not set)'}`);
    lines.push(`   Email: ${user.email}`);
    if (user.phone) lines.push(`   Phone: ${user.phone}`);
  }
  lines.push('');
  lines.push('Please confirm availability and share payment details.');
  return lines.join('\n');
}

function normaliseItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  const getDesign = db.prepare(
    `SELECT d.id, d.title, d.price, d.image_url, c.name AS category_name, c.section
       FROM designs d JOIN categories c ON c.id = d.category_id
      WHERE d.id = ? AND d.active = 1`
  );
  const items = [];
  for (const raw of rawItems.slice(0, 50)) {
    const design = getDesign.get(Number(raw?.id));
    if (!design) continue;
    const qty = Math.min(Math.max(Number(raw?.qty) || 1, 1), 99);
    items.push({
      id: design.id,
      title: design.title,
      price: design.price,
      imageUrl: design.image_url,
      categoryName: design.category_name,
      section: design.section,
      qty,
    });
  }
  return items;
}

// Builds the WhatsApp deep link. Prices and titles are read from the database,
// never from the client, so a tampered cart cannot change the order.
router.post('/checkout', (req, res) => {
  const items = normaliseItems(req.body?.items);
  if (items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  const number = String(getSetting('whatsapp_number') || '').replace(/[^\d]/g, '');
  if (!number) {
    return res.status(503).json({
      error: 'The studio WhatsApp number has not been set yet. Please try again shortly.',
    });
  }

  const note = String(req.body?.note || '').trim().slice(0, 500);
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const businessName = getSetting('business_name');

  const info = db
    .prepare('INSERT INTO orders (user_id, items_json, total, note) VALUES (?, ?, ?, ?)')
    .run(req.user ? req.user.id : null, JSON.stringify(items), total, note);
  const orderId = Number(info.lastInsertRowid);

  const message = buildMessage({
    orderId,
    items,
    total,
    note,
    user: req.user ? { name: req.user.name, email: req.user.email, phone: req.user.phone } : null,
    req,
    businessName,
  });

  res.json({
    orderId,
    total,
    items,
    message,
    whatsappUrl: `https://wa.me/${number}?text=${encodeURIComponent(message)}`,
  });
});

router.get('/mine', auth.requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({
    orders: rows.map((r) => ({
      id: r.id,
      items: JSON.parse(r.items_json),
      total: r.total,
      note: r.note,
      createdAt: r.created_at,
    })),
  });
});

module.exports = router;
