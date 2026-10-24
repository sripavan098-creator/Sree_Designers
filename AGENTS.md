# Working notes for this repository

## Standing preferences (apply to every session, not just the current one)

### Always use the `frontend-design` skill for frontend work
For any frontend task — new page, component, layout, restyle, or visual polish —
invoke the `frontend-design` skill first, before writing code.

The skill requires committing to a bold, intentional aesthetic direction rather
than defaulting to generic output. Concretely, for this project that means:

- No generic fonts (Inter, Roboto, Arial, system stacks). This site uses
  **Bodoni Moda** for display and **Jost** for body text — keep that pairing, or
  choose an equally distinctive replacement.
- No cliched palettes (purple gradients on white). The brand palette is sampled
  from the studio logo and is non-negotiable — see "Brand" below.
- Backgrounds get texture and depth, not flat fills.
- Motion is deliberate: one well-orchestrated page load beats scattered
  micro-interactions.
- Every design decision should be traceable to the business context
  (a textile/embroidery studio), not to a template.

### Current aesthetic direction — "The Loom Room"
An editorial fashion lookbook: didone display type, numbered plates, gold
hairline rules, generous margins. The reference is a couture catalogue, not a
product grid. Signature devices, all defined in `public/css/app.css`:

- `.ticker` — a marquee of craft terms (patchwork, cutwork, aari, zardosi)
- `.rule` — gold hairline divider with a centred diamond
- Numbered eyebrows: `01 — Featured plates`, `02 — Our work`, `03 — How ordering works`
- Gold corner ticks that draw in on card hover
- Woven-linen ground plus a fixed SVG grain overlay

Extend this language rather than replacing it, unless asked to redesign.

### Preserve the CSS class vocabulary
`admin.html`, `admin.js` and the page scripts generate markup from the class
names in `public/css/app.css`. Restyle freely, but **never rename or delete a
selector** — the admin console will break silently. Before finishing a CSS
change, diff the class list against the previous version and confirm nothing was
dropped.

### Always plan before building
For any non-trivial task, use the `task_tracker` tool to lay out the work before
implementing, and keep it updated as work progresses. Break the work into
discrete, verifiable items.

### Verify before claiming done
Do not report success from assumption. Hit the running site and check:
routes return the expected status, assets load, and the flow actually works.
Run `node --check` on changed JS. Confirm no secrets are staged before committing.

## Brand

**Sree Designers** — a computer embroidery and maggam work studio.
Maggam work is done on blouses.

The palette is sampled directly from the studio logo, which is a gold ornamental
emblem on a deep maroon field:

| Token | Hex | Role |
| --- | --- | --- |
| `--wine` | `#4f0516` | Logo background; used for dark plates and footer accents |
| `--thread` | `#8a0f2c` | Primary brand colour — buttons, links, prices |
| `--gold` | `#b8862c` | Accent — rules, focus, emblem |
| `--gold-soft` | `#e9cd8a` | Highlights |
| `--paper` | `#f7efe2` | Page ground (warm ivory) |

Teal (`--teal`) is reserved for **success states only** (added-to-cart, success
alerts) so a confirmation never reads as decoration. Do not use it decoratively.

Logo assets live in `public/img/`:

- `logo.png` — full lockup, used as the hero brand plate
- `logo-mark.png` — the emblem alone, used as the header brand mark
- `favicon.png` — browser tab icon

The admin can override the logo at runtime via Settings → Brand logo. When a
`logoUrl` is set, it takes precedence over the bundled files.

## Architecture

Node 22.5+ with Express 5 and the built-in `node:sqlite` module. No native
modules, no build step. Frontend is plain HTML, CSS and JavaScript.

```
server/index.js          Express app, route mounting, static serving
server/db.js             Schema, seeds, settings helpers
server/auth.js           Session handling, guards
server/passwords.js      scrypt hashing
server/routes/           auth, catalog, admin, orders
public/*.html            One file per page
public/js/               app.js is shared (header, footer, cart); others are per-page
public/css/app.css       Single design-system stylesheet
data/                    SQLite database, uploads, admin credentials — GIT-IGNORED
scripts/build-static.js  Builds dist/ for static hosts (Vercel)
public/js/static-api.js  Snapshot API for static builds — injected at build time only
```

### Key routes

| Path | Page |
| --- | --- |
| `/` | Home — featured designs and section tiles |
| `/embroidery` | Computer Embroidery — 6 categories |
| `/maggam` | Maggam Work — 4 categories |
| `/cart` | Cart and WhatsApp checkout |
| `/design?id=N` | Single design, full-size photo |
| `/account` | Customer sign-in |
| `/admin` | Admin console — deliberately not linked from the public site |

### Security invariants — do not weaken these

- Titles and prices are resolved from the database during checkout, **never**
  from the request body, so a tampered cart cannot alter what the studio receives.
- `data/` must stay in `.gitignore`. It holds the database, uploaded customer
  photos, and the admin password. Verify with
  `git check-ignore -v data/app.db` before any commit that touches storage.
- There is no public sign-up. The admin creates customer logins.
- Uploads are served with `nosniff` and a restrictive content policy.

## Configuration

- **WhatsApp number**: `+917396038366`, stored in settings
  (`whatsapp_number` in `data/app.db`). The checkout normalises it to digits
  only and builds `https://wa.me/917396038366`. Change it in the admin console,
  not in code.
- **Admin login**: `admin@studio.local`. The generated password is written to
  `data/ADMIN-CREDENTIALS.txt`. Override with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- **Port**: 12000 by default, or `PORT`.

## Deployment

### Two ways to run this, and they are not equivalent

**1. Full app (Node server)** — the real thing. SQLite, sessions, photo uploads,
the orders table, the admin console. Needs a host with a persistent volume:
Render, Railway or Fly. Start with `npm start`.

**2. Static shop front (Vercel)** — `npm run build:static` writes `dist/`, which
deploys to Vercel (or any static host) with no server at all.

The static build is a **deliberate subset**, not a second implementation:

- `scripts/build-static.js` reads `data/app.db` and writes `catalogue.json`,
  copying the photos out of the git-ignored `data/uploads/` into `dist/uploads/`.
- `public/js/static-api.js` is injected into the shop pages **at build time
  only**. It replaces `window.fetch` so reads are answered from the snapshot.
  It must never ship in `public/`, or it would shadow the real API when the
  Node server runs.
- Checkout is rebuilt in the browser from the snapshot, so `wa.me` links still
  carry every design, price and photo.

Unsupported on the static build, by design: sign-in, the admin console, uploads
and order history. The build omits `account.html` and `admin.html` entirely, and
the shim returns a clear 501 rather than pretending to work.

**Vercel config gotcha:** do not use `cleanUrls: true`. It rewrites `index.html`
to `/index`, leaving `/` with nothing to serve, so the site root 404s. The build
writes explicit `rewrites` instead. Verify `/` returns 200 after any change here.

To deploy: `npm run deploy:vercel`. Without a `VERCEL_TOKEN` this makes an
anonymous **temporary** deployment that expires after 60 minutes — fine for
review, not for customers. For a permanent URL, either authenticate the CLI
(`npx vercel login`) or set `VERCEL_TOKEN`, then deploy without `--temporary`.

### The constraint that actually matters

Vercel functions have a read-only filesystem, and this app writes to disk at
runtime: `data/app.db` and `data/uploads/`. So the **admin console cannot be
hosted on Vercel as-is** — uploads and orders would fail. That is why the admin
side stays on the Node host. If the whole app must move to Vercel, storage has
to be rewritten first: Postgres for data, Vercel Blob (or similar) for photos.

## Gotchas

- Checkout payload field is `id`, not `designId`:
  `POST /api/orders/checkout` with `{"items":[{"id":1,"qty":1}],"note":"..."}`.
- `/api/settings` returns `whatsappConfigured` (a boolean), not the number itself.
- The logo could not be viewed directly during initial development; it was
  analysed programmatically (pixel sampling plus ASCII rendering). If asked to
  match the logo again, that approach works — extract the file, then sample
  colours and render character maps to read the wordmark.
