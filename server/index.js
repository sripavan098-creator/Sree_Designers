'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const auth = require('./auth');
const { UPLOAD_DIR } = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 12000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Uploads are served from a dedicated path with a strict, non-executable
// content type so a mislabelled file can never be interpreted as script.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

app.use(auth.attachUser);

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/catalog'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/orders', require('./routes/orders'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

const PAGES = ['/', '/embroidery', '/maggam', '/cart', '/design', '/account', '/admin'];

app.get(PAGES, (req, res, next) => {
  const page = req.path === '/' ? 'index.html' : `${req.path.slice(1)}.html`;
  const file = path.join(PUBLIC_DIR, page);
  if (!fs.existsSync(file)) return next();
  res.sendFile(file);
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
    if (err) res.type('text').send('Not found');
  });
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

if (require.main === module) {
  auth.purgeExpiredSessions();
  setInterval(auth.purgeExpiredSessions, 6 * 60 * 60 * 1000).unref();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sree Designers running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
