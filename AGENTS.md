# Working notes for this repository

## Standing preferences (apply to every session, not just the current one)

### Always use the `frontend-design` skill for frontend work
For any frontend task — new page, component, layout, restyle, or visual polish —
invoke the `frontend-design` skill first, before writing code.

The skill requires committing to a bold, intentional aesthetic direction rather
than defaulting to generic output. Concretely, for this project that means:

- No generic fonts (Inter, Roboto, Arial, system stacks). This site uses
  **Fraunces** for display and **Karla** for body text — keep that pairing, or
  choose an equally distinctive replacement.
- No cliched palettes (purple gradients on white). The brand palette is sampled
  from the studio logo and is non-negotiable — see "Brand" below.
- Backgrounds get texture and depth, not flat fills.
- Motion is deliberate: one well-orchestrated page load beats scattered
  micro-interactions.
- Every design decision should be traceable to the business context
  (a textile/embroidery studio), not to a template.

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
| `--wine` | `#560618` | Logo background; used for dark plates and footer accents |
| `--thread` | `#8e0f2b` | Primary brand colour — buttons, links, prices |
| `--gold` | `#b8862c` | Accent — rules, focus, emblem |
| `--gold-soft` | `#e7c884` | Highlights |
| `--paper` | `#faf4e8` | Page ground (warm ivory) |

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

## Deployment constraint — important

This app **cannot run correctly on Vercel**. Vercel functions have a read-only
filesystem, but this app writes to disk at runtime: `data/app.db` (SQLite) and
`data/uploads/` (every uploaded photo). On Vercel those writes fail or vanish, so
uploads and orders would be silently lost.

Deploy it on a host with a persistent volume instead — Render, Railway or Fly.
A Vercel move would require rewriting storage to Postgres plus Vercel Blob first.

## Gotchas

- Checkout payload field is `id`, not `designId`:
  `POST /api/orders/checkout` with `{"items":[{"id":1,"qty":1}],"note":"..."}`.
- `/api/settings` returns `whatsappConfigured` (a boolean), not the number itself.
- The logo could not be viewed directly during initial development; it was
  analysed programmatically (pixel sampling plus ASCII rendering). If asked to
  match the logo again, that approach works — extract the file, then sample
  colours and render character maps to read the wordmark.
