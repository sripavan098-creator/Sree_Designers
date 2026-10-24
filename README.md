# Sree Designers

A catalogue website for a computer embroidery and maggam work studio. Customers
browse design photos, add them to a cart, and send the cart to the studio's
WhatsApp with every photo and note attached. The studio manages everything from
a separate admin console.

## Running it

```bash
npm install
npm start
```

The site listens on port `12000` by default. Override with `PORT`.

## The four tabs

| Tab | URL | What it does |
| --- | --- | --- |
| Home | `/` | Featured designs and section tiles. Tapping a design opens its full photo. |
| Computer Embroidery | `/embroidery` | Categories: Patchwork, Cutwork, Booti Work, Round Neck, Flat Neck, Heavy Work. |
| Maggam Work | `/maggam` | Categories: Bridal Blouse, Blouse Neck, Sleeve Work, Aari & Zardosi. |
| Cart | `/cart` | Quantity controls, a note field, and the buy button that opens WhatsApp. |

Every design card and every design page has an add to cart button. The cart is
kept in the browser, so it survives page changes without a login.

## Design

The look is an editorial fashion lookbook — didone display type, numbered
plates, gold hairline rules and generous margins, closer to a couture catalogue
than a product grid. The palette is sampled from the studio logo: gold ornament
on deep maroon. Type is **Bodoni Moda** for display and **Jost** for body.

Everything is in `public/css/app.css`. A few signature devices worth knowing
about before editing:

- A running ticker of craft terms (patchwork, cutwork, aari, zardosi)
- Gold hairline dividers with a centred diamond
- Numbered section eyebrows: `01 — Featured plates`, `02 — Our work`, `03 — How ordering works`
- Gold corner ticks that draw in when a design card is hovered
- A woven-linen background texture with a fine grain overlay

Teal is reserved for success states only (added to cart, success alerts), so a
confirmation never reads as decoration.

## Deploying

There are two ways to run this, and they are not equivalent.

### The full app, on a host with a disk

This is the complete product: SQLite, logins, photo uploads, the orders table and
the admin console. It writes to `data/` at runtime, so it needs a host with a
persistent volume — Render, Railway or Fly. Start it with `npm start`.

### The shop front, on Vercel (or any static host)

```bash
npm run build:static      # writes dist/
npm run deploy:vercel     # builds, then deploys
```

`dist/` is a static snapshot of the shop: home, both galleries, design pages and
the cart. It has no server, so the browser reads a `catalogue.json` snapshot and
builds the WhatsApp link itself. Checkout works fully — designs, prices and photo
links all arrive in your WhatsApp exactly as on the server version.

Two things to be aware of:

- **Sign-in and the admin console are not part of the static build.** They need a
  server. Upload designs on the Node host, then rebuild to publish them.
- **Without a Vercel token the deploy is temporary** and expires after 60 minutes.
  That is fine for showing someone the design. For a permanent address, run
  `npx vercel login` or set `VERCEL_TOKEN` first, then deploy without `--temporary`.

Because Vercel has no writable disk, the admin console cannot be hosted there at
all — uploads and orders would fail. Keeping the admin side on the Node host is
the intended setup, not a workaround.

## Ordering flow

1. Customer opens a design and presses add to cart.
2. The cart page lists each design with a quantity control.
3. Pressing buy calls `POST /api/orders/checkout`, which records the order and
   returns a `wa.me` link.
4. WhatsApp opens with the order written out: each design's title, category,
   price, quantity and a public link to its photo, plus the customer's note.

Prices and titles are read from the database during checkout, never from the
browser, so a tampered cart cannot change what the studio receives.

## Logins

**Admin** — at `/admin`. This page is deliberately not linked from the public
site. On first start an admin account is created and the password is written to
`data/ADMIN-CREDENTIALS.txt`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the
first run to choose your own. Change the password in the console, then delete
that file.

**Customers** — created by the admin under "User logins". Customers sign in at
`/account` to save their name and phone and to see orders they have sent. No
public sign-up form exists.

## Admin console

- **Upload designs** — pick a section and category, then drop in many photos at
  once. All optional fields (title, description, price, featured) apply to the
  batch. A price of 0 shows "On request".
- **Manage designs** — edit, hide, show or delete any design, and replace its photo.
- **Categories** — rename, re-describe, add or delete categories per section.
  Deleting a category also deletes its designs and their photos.
- **User logins** — create, disable, re-password or delete customer accounts.
- **Orders** — every order sent to WhatsApp is recorded here.
- **Settings** — business name, tagline, the WhatsApp number, and the brand logo.

The WhatsApp number is set to `+917396038366`. If it is ever cleared, the buy
button reports that ordering is not available yet until it is set again.

## Data

Everything lives in `data/`, which is created on first start:

- `data/app.db` — SQLite database (users, sessions, categories, designs, orders, settings)
- `data/uploads/` — uploaded photos and the logo

The database uses Node's built-in `node:sqlite`, so there is no native module to
build. Requires Node 22.5 or newer.

## Layout

```
server/
  index.js          Express app, static files, uploads, error handling
  db.js             Schema, seed data, settings helpers
  auth.js           Sessions, cookies, route guards
  passwords.js      scrypt hashing
  routes/
    auth.js         login, logout, profile, password
    catalog.js      public designs, categories, settings
    admin.js        admin CRUD and image upload
    orders.js       checkout and the WhatsApp message builder
public/
  css/app.css       design system
  js/app.js         API client, cart, header, footer, toasts
  js/{page}.js      one script per page
  *.html            one file per page
```

## Notes

- Uploaded files are served from `/uploads` with a restrictive content policy
  and `nosniff`, so a mislabelled file cannot be executed.
- Sessions are HTTP-only cookies valid for 14 days. Passwords use scrypt.
- Uploads are capped at 8 MB per image, 12 images per request.
- `data/` and `node_modules/` are git-ignored. Back up `data/` to keep the
  catalogue and orders.
