# Lumina Forum

A small German-language community forum that runs as a Cloudflare Worker. Pages are rendered on the server, there is no client-side JavaScript, there is no build step, and data lives in KV.

## Layout
```
wrangler.toml        Worker config (account, assets, KV binding STORE)
package.json         scripts: dev, check (dry-run bundle)
src/index.js         router: HTML pages + JSON API
src/store.js         KV data layer, seeding, rate limit
src/views.js         server-rendered HTML (German UI), everything escaped
src/util.js          escaping, validation, limits, responses, security headers
src/categories.js    fixed category list
src/static-assets.js GENERATED: public/ files inlined (fallback without Assets binding)
scripts/inline-assets.mjs  regenerates src/static-assets.js
public/styles.css    dark theme with violet "Lumina" glow, responsive
public/favicon.svg
```

## Run locally
```
/home/box/.npm/_npx/0eedb5afd4158ff3/node_modules/.bin/wrangler dev --local --port 8799
```
Local KV data is stored in `.wrangler/state`. Delete that folder to reset. The welcome thread is added again when the forum is empty.

## Routes
HTML: `/`, `/k/:category`, `POST /k/:category/neu`, `/t/:id`, `POST /t/:id/antworten`

JSON API:
- `GET  /api/health`: ok, categories, threads, replies
- `GET  /api/categories`: categories with thread/reply counts and the latest thread
- `GET  /api/threads?category=<slug>`: thread summaries, newest first
- `GET  /api/threads/:id`: the full thread with its replies
- `POST /api/threads`: `{category, title, author, body}` (JSON or form) → 201
- `POST /api/threads/:id/replies`: `{author, body}` → 201

The API returns raw user text. Anyone who uses the API must escape it before inserting it into HTML. The HTML pages already escape everything.

Categories: `allgemein`, `technik-nexus`, `musik` (Musik (OUR BAND)), `marktplatz`, `off-topic`.

## KV key layout
| key | value |
|---|---|
| `thread:<id>` | full thread JSON, replies inline (max 500) |
| `index:<category>` | array of summaries, newest first (max 1000) |
| `meta:counts` | `{threads, replies}` |
| `meta:seeded` | `"1"` once the welcome thread (id `willkommen`) has been handled |
| `rl:<ip>` | write counter, TTL 60 s (max 5 writes/min per IP) |

## Limits and safety
Titles are 3–120 characters, names 2–40 and posts 2–8000. Request bodies are capped at 32 KB. Control and bidi characters are stripped. A honeypot field catches simple bots. A strict CSP blocks all scripts (`default-src 'none'`), and the `nosniff`, `DENY` and `same-origin` headers are set.

## Deployment
Live at **https://lumina-forum.helpful-mojoceratops.workers.dev**. It runs on the Cloudflare account "Helpful Mojoceratops" (`0713fcac60cfa3d2dc57c93d1e6a3186`) with the KV namespace `lumina-forum-STORE` (`c00f81cdccd4410a8c26eef1897b3306`).

The worker was uploaded through the Cloudflare API as a single bundled ES module (built with `wrangler deploy --dry-run --outdir`), without the Workers Assets binding. To make that work, `src/static-assets.js` inlines the files from `public/`, and the worker serves them itself with Assets-style headers (`Cache-Control: public, max-age=0, must-revalidate`, `ETag`, `304`). Run `npm run inline-assets` after changing anything in `public/`.

A regular `wrangler deploy` (with `[assets]` in `wrangler.toml`) also works. In that mode, Assets serves `public/` before the worker runs, so the inlined fallback is never reached. Wrangler must be logged in to the account above.

## Follow-ups
- Moderation and admin tools: delete or edit posts, lock or pin threads, ban IPs, report button. There is no admin yet.
- KV is eventually consistent and has no transactions. Two posts made at exactly the same moment can overwrite each other's index or count update. Move to D1 or a Durable Object if activity grows.
- The KV rate limit is best-effort. Cloudflare's Rate Limiting binding or Turnstile would be stronger.
- Pagination for large categories or threads, search, Markdown formatting, and user accounts.
