# MegaDemo.ai — Design Overview

Internal Canonical AI Hackathon platform.
Source: [canonical/megademo.ai](https://github.com/canonical/megademo.ai) · License: GPL-3.0

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20 |
| Framework | Express 5 |
| Database | MongoDB via Mongoose (Atlas M0 in production; maxPoolSize 15) |
| Templates | Pug + Bootstrap 5 + custom SCSS |
| Auth | Passport.js — **OIDC** (Canonical Identity Platform / Ory Hydra, drop-in ready) **or** GitHub OAuth 2.0 (org-restricted to `canonical`) |
| Sessions | express-session stored in MongoDB (connect-mongo; `touchAfter: 3600`) |
| Security | Helmet (CSP with per-request nonces + SRI), lusca (CSRF), express-rate-limit, sanitize-html, URL-scheme allowlist |
| File uploads | multer (project logos / asciinema casts) |
| Notifications | Mattermost webhook + daily summary cron (node-cron) |
| Deployment | Render.com Starter (render.yaml) |
| Tests | Jest + Supertest + mongodb-memory-server |
| CI/CD | GitHub Actions (lint-check + Jest); husky pre-commit hook mirrors CI locally |
| Load testing | Artillery (`scripts/load-test.yml`) |

---

## Directory layout

```
app.js              Express entry point — routes, middleware, DB connection, async startup
config/
  passport.js       GitHub OAuth strategy; org membership check
  oidc.js           OIDC client init (openid-client v5, PKCE); activated by OIDC_ISSUER_URL
  defaults.yml      Seed data: teams, AI tools, tech-stack tags
  flash.js          Lightweight flash message helper
controllers/
  auth.js           Login/logout, OIDC callback, dev bypass, token-gated test login
  home.js           Homepage: newest projects, leaderboard, category chart
  project.js        CRUD, voting, media, team join/leave; isSafeUrl() URL validation
  admin.js          Settings, user roles, tag/team management, CSV export, reset
  kiosk.js          Read-only kiosk display (no auth)
models/
  User.js           GitHub/OIDC identity, role (participant | admin)
  Project.js        Project data; embedded media; avgRating + totalStars virtuals/fields
  Vote.js           One vote per user/project pair (unique index)
  Settings.js       Key-value store for deadlines, webhook URL, custom lists
services/
  github.js         GitHub API — org membership verification, repo stats
  mattermost.js     Webhook POST for new projects and daily summary
scripts/
  seed-defaults.js  Idempotently seeds teams/tags from defaults.yml on startup
  seed-admin.js     CLI to promote a user to admin by email
  daily-summary.js  Builds and posts daily project summary to Mattermost
  load-test.yml     Artillery load test (anonymous browse, leaderboard, kiosk scenarios)
content/
  get-started.md    End-user help page (Markdown, re-read from disk on request)
views/
  layout.pug        Base layout (navbar, footer, CSRF meta, CSP nonce injection)
  partials/         header.pug, footer.pug, flash.pug, project-card.pug
  home.pug          Homepage
  projects/         list.pug, detail.pug, form.pug, mine.pug
  admin/            dashboard.pug, projects.pug, users.pug, teams.pug, tags.pug
  kiosk/            index.pug, project.pug
  get-started.pug   Renders content/get-started.md
public/
  css/main.scss     Custom theme (compiled to main.css at deploy / npm run scss)
  js/main.js        Countdown, dirty-form guard, join/leave AJAX, star rating
  js/kiosk.js       Kiosk keyboard navigation and auto-advance
  images/           Static assets
tests/              Jest test suites (auth, home, projects, admin, voting)
.husky/pre-commit   Runs lint-check + tests before every commit
```

---

## Authentication

Two modes; selected by the presence of `OIDC_ISSUER_URL`:

### Mode A — OIDC via Canonical Identity Platform (recommended for production)

When `OIDC_ISSUER_URL` is set:
- The **entire site** is gated — all routes except `/auth/*` and `/kiosk*` redirect to OIDC login
- Login flow: MegaDemo.ai → Hydra → Kratos → GitHub (upstream IdP) → back
- `@canonical.com` domain filtering is handled by Kratos (configured by IS)
- Uses Authorization Code + PKCE flow
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are not used

Redirect URI to register with IS: `https://megademo.ai/auth/oidc/callback`
Scopes: `openid profile email`

### Mode B — Direct GitHub OAuth (default until OIDC is ready)

When `OIDC_ISSUER_URL` is absent:
- Per-route `isAuthenticated` guards (existing behaviour)
- Canonical membership verified via GitHub API on every login
- Three verification methods (in order): org membership API → org list → `@canonical.com` email domain fallback

---

## Key design decisions

**Trust-based team access.** Any authenticated user can join a submitted project; joining grants edit rights. No approval flow — designed for a short hackathon window where trust is assumed. Draft projects are only visible to their team and admins.

**Flat role model.** Two roles: `participant` (default) and `admin`. Admins are promoted via CLI or the admin UI; they can promote/demote others.

**totalStars voting.** Leaderboard sorts by `totalStars` (sum of all stars cast) with `avgRating` as tiebreaker. This rewards both quality *and* engagement: 2×4★ (8 pts) beats 1×5★ (5 pts).

**Settings as key-value.** `submissionDeadline`, `megademoDate`, Mattermost webhook URL, custom lists are stored in the `Settings` collection — not in code or env vars — so admins can change them live.

**Markdown content from disk.** The `/get-started` page reads `content/get-started.md` on every request. Content updates ship with code deploys.

**Seed data from YAML.** `config/defaults.yml` holds canonical teams, AI tools, and tech-stack tags. Seeds on first startup (idempotent). Admins can override via dashboard.

**Countdown state machine.** Homepage JS covers four states: submissions open → submissions closed → megademo countdown → megademo live. Deadlines stored as `"YYYY-MM-DDTHH:mm"` strings (no timezone conversion) to avoid UTC drift.

**Kiosk mode.** `/kiosk` is a separate, auth-free read-only view for projecting the leaderboard. Keyboard-navigable; keyboard nav is guarded against interfering with input focus.

**CSP with nonces.** Helmet CSP is fully active with per-request nonces injected into all inline scripts. External CDN resources include SRI hashes. `unsafe-inline` is absent from `script-src`.

---

## Data flow: project registration

```
User → POST /projects
  → auth middleware (isAuthenticated)
  → projectController.create
      → isSafeUrl() validates repoLinks / demoUrl / slidesUrl (http/https only)
      → sanitize-html cleans description
      → Project.save()
      → mattermost.notifyNewProject()  (non-blocking)
  → redirect /projects/:slug
```

## Data flow: voting

```
User → POST /projects/:id/vote  { rating: 1–5 }
  → isAuthenticated
  → projectController.vote
      → Vote.findOneAndUpdate (upsert, unique user+project)
      → aggregate: totalStars = $sum of stars, avgRating = $avg of stars
      → Project.set({ totalStars, avgRating, voteCount }).save()
  → JSON { totalStars, avgRating, voteCount }  (AJAX)
```

---

## Performance baseline

Tested with Artillery against production (Render Starter + Atlas M0):

| Load | p50 | p95 | Notes |
|---|---|---|---|
| ~20 VUs | < 200ms | < 400ms | Warm-up |
| ~200 VUs | expected < 300ms | expected < 800ms | Estimated ceiling before CPU contention |

Key tunings applied:
- `maxPoolSize: 15` in `mongoose.connect()` (prevents queue buildup)
- `touchAfter: 3600` in `MongoStore` (halves session writes on unchanged sessions)
- `.lean()` on all read-only Mongoose queries (bypasses Mongoose document hydration)

Upgrade thresholds (run `npm run load-test` to measure):
- p95 < 500ms → current stack is sufficient
- p95 > 500ms / CPU saturation → Render Standard ($25/mo)
- p99 > 2s or MongoDB errors → Atlas M2 ($9/mo)

