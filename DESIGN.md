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
| Security | Helmet (CSP with per-request nonces + SRI), lusca (CSRF), express-rate-limit (global + per-endpoint), sanitize-html, URL-scheme allowlist, session regeneration, optimistic concurrency |
| File uploads | multer (project logos / asciinema casts) — stored on a Render persistent disk (`/data/uploads`, 1 GB), served at `/uploads` |
| Notifications | Mattermost webhook + daily summary cron (node-cron) |
| Deployment | Render.com Starter (render.yaml); persistent disk for uploads (`/data/uploads`, 1 GB) |
| Tests | Jest + Supertest + mongodb-memory-server |
| CI/CD | GitHub Actions (npm audit + lint-check + Jest); husky pre-commit hook mirrors CI locally |
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
  admin.js          Settings, user roles, tag/team management, CSV export (modal with field selection), activity log, reset
  kiosk.js          Read-only kiosk display (no auth)
models/
  User.js           GitHub/OIDC identity, role (participant | admin)
  Project.js        Project data; embedded media; avgRating + totalStars virtuals/fields
  Vote.js           One vote per user/project pair (unique index)
  Settings.js       Key-value store for deadlines, webhook URL, custom lists
  ActivityLog.js    Immutable audit log; 180-day TTL; indexed on timestamp
services/
  github.js         GitHub API — org membership verification, repo stats
  mattermost.js     Webhook POST for new projects and daily summary
  activityLog.js    logActivity(email, action) fire-and-forget helper
  viz-sync.js       Fetches project cluster HTML from canonical/megademo-projects; hourly auto-sync
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
  admin/            dashboard.pug, projects.pug, users.pug, teams.pug, tags.pug, activity-log.pug
  kiosk/            index.pug, project.pug
  visualize.pug     Interactive project cluster map (extends layout, injects Plotly charts)
  get-started.pug   Renders content/get-started.md
public/
  css/main.scss     Custom theme (compiled to main.css at deploy / npm run scss)
  js/main.js        Countdown, dirty-form guard, join/leave AJAX, star rating
  js/kiosk.js       Kiosk keyboard navigation and auto-advance
  js/vendor/        Third-party JS (plotly-2.35.2.min.js)
  images/           Static assets
tests/              Jest test suites (auth, home, projects, admin, voting)
.husky/pre-commit   Runs lint-check + tests before every commit
```

---

## Authentication

Three modes; selected by the `AUTH_MODE` environment variable and deployment context:

### Mode 1 — GitHub OAuth (`AUTH_MODE=github` or default)

When `AUTH_MODE=github` (or unset):
- The **entire site** is gated — all routes except `/auth/*` and `/health` require authentication
- Login uses GitHub OAuth 2.0; the OAuth App must be registered under the `canonical` GitHub org
- Canonical membership verified via GitHub API: three verification methods (in order): org membership API → org list → `@canonical.com` email domain fallback
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` required
- `OIDC_*` variables are ignored

### Mode 2 — OIDC via Canonical Identity Platform (`AUTH_MODE=oidc`)

When `AUTH_MODE=oidc`:
- The **entire site** is gated — all routes except `/auth/*` and `/health` redirect to OIDC login
- Login flow: MegaDemo.ai → Canonical Identity Platform (Hydra) → Kratos → upstream IdP → back
- Uses Authorization Code + PKCE flow
- Requires `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are not used

Redirect URI to register: `https://megademo.ai/auth/oidc/callback`
Scopes: `openid profile email`

### Development Mode

When running in non-production environments (detected via `NODE_ENV !== 'production'`):
- `AUTH_MODE` is ignored
- A dev login bypass is available at `/auth/dev-login`
- The global site gate is inactive, but per-route guards (`isAuthenticated`) remain active and redirect unauthenticated requests to `/auth/dev-login`
- Developers must still log in via `/auth/dev-login` to access protected routes
- Useful for testing without external OAuth/OIDC setup

### Session Continuity Across Auth Modes

Users authenticated in one mode can seamlessly switch to another:
- User identity is matched by email address
- When an OIDC user logs out and re-authenticates via GitHub OAuth, they are matched by email and their data (projects, votes, roles) is preserved
- No user action required; session data persists across the switch

---

## Key design decisions

**Trust-based team access.** Any authenticated user can join a submitted project; joining grants edit rights. No approval flow — designed for a short hackathon window where trust is assumed. Draft projects are only visible to their team and admins.

**Flat role model.** Two roles: `participant` (default) and `admin`. Admins are promoted via CLI or the admin UI; they can promote/demote others.

**Dual-sort voting.** The `stars` sort ranks by `totalStars` (sum of all stars cast) with `avgRating` as tiebreaker — rewarding both quality *and* engagement (2×4★ = 8 pts beats 1×5★ = 5 pts). The `rating` sort ranks purely by `avgRating` with `voteCount` as tiebreaker. The home-page leaderboard and "Full board" link use the `rating` sort, so "new" high rated projects also have a chance to show at top.

**Settings as key-value.** `hackathonStart`, `submissionDeadline`, `megademoDate`, Mattermost webhook URL, custom lists are stored in the `Settings` collection — not in code or env vars — so admins can change them live.

**Markdown content from disk.** The `/get-started` page reads `content/get-started.md` on every request. Content updates ship with code deploys.

**Activity log.** All DB-mutating actions (login/logout, project create/update/delete/vote, admin status/role changes) are written to the `ActivityLog` collection via a fire-and-forget `logActivity()` helper that never throws. Project update entries include a granular diff (title, category, team, AI tools, tech stack, media, status). The log is accessible at `/admin/activity-log` with Refresh and plain-text Download. Entries auto-expire after 180 days via a MongoDB TTL index.

**Seed data from YAML.** `config/defaults.yml` holds canonical teams, AI tools, and tech-stack tags. Seeds on first startup (idempotent). Admins can override via dashboard.

**CSV export with field selection.** `GET /admin/export` uses a `CSV_FIELD_REGISTRY` array to define all 21 exportable project fields. Each entry has a key, header, group, and extraction function. An optional `?fields=` query parameter (comma-separated keys) controls which columns appear — omitting it exports everything. The admin dashboard presents a modal with themed checkboxes grouped into four sections (Basic Info, People & Teams, Media & Links, Stats & Dates), all pre-checked, with per-group and global Select All/Deselect All toggles. Cells are double-quoted with `"` escaping, newlines replaced by literal `\n`, and formula-starting characters prefixed with `'` to prevent CSV injection. Raw Markdown descriptions are exported as-is.

**Countdown state machine.** Homepage JS covers five states: pre-start (hackathon not yet begun) → submissions open → submissions closed → megademo countdown → megademo live. All deadlines stored as `"YYYY-MM-DDTHH:mm"` strings (no timezone conversion) to avoid UTC drift. The `hackathonStart` setting gates project registration: when set and in the future, all add-project buttons are disabled and `/projects/new` redirects with a flash message.

**registrationOpen middleware.** A lightweight in-memory cache (60s TTL) in `app.js` checks `hackathonStart` and sets `res.locals.registrationOpen` for every request, making it available in all templates including the site-wide header partial.

**Kiosk mode.** `/kiosk` is a separate, auth-free read-only view for projecting the leaderboard. Keyboard-navigable; keyboard nav is guarded against interfering with input focus.

**CSP with nonces.** Helmet CSP is fully active with per-request nonces injected into all inline scripts. External CDN resources include SRI hashes. `unsafe-inline` is absent from `script-src`.

**Visualization sync.** The `/visualize` page displays an interactive Plotly-based project cluster map generated by the `canonical/megademo-projects` ML pipeline. The `viz-sync` service fetches the four pre-built HTML files (fine, medium, coarse, broad granularity) from the GitHub Contents API every hour, extracts the body content (Plotly chart divs, filter controls, cluster list, interactivity JS), injects CSP nonce placeholders, and caches fragments in memory. The controller substitutes the real per-request nonce at render time. Plotly.js is self-hosted in `public/js/vendor/` to avoid CDN CSP additions. The sync schedule is configurable via `VIZ_SYNC_CRON` env var; admins can also trigger a manual sync from the dashboard. Requires `GITHUB_TOKEN` for authenticated access to the org-restricted repo.

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

---

## Security hardening

Applied via [security audit remediation](https://github.com/lengau/megademo-security-audit):

- **Session fixation**: All auth callbacks regenerate the session before `req.logIn()`, preserving CSRF and returnTo
- **OAuth state**: GitHub OAuth uses `state: true` (Passport-managed CSRF token)
- **Test login**: POST-only to keep token out of URL/logs
- **SSRF**: `extractRepoPath()` uses strict `new URL()` parsing (hostname must be `github.com`)
- **Submission deadline**: Server-side enforcement on create/submit; admins bypass
- **Draft voting blocked**: Vote handler rejects votes on draft-status projects
- **Uploads auth**: `/uploads` served after production auth gate
- **Markdown**: `<img>` removed from `sanitize-html` allowedTags (prevents external beacons)
- **Mattermost injection**: User content escaped in webhook messages
- **ObjectId validation**: `app.param('id')` rejects malformed IDs with 400
- **Vote rate limiting**: Dedicated per-user limiter (10/min) on vote endpoint
- **Creation limits**: Max 5 projects/user, max 10 team members/project
- **Milestone dedup**: Atomic `$addToSet` on `milestonesFired` field
- **Optimistic concurrency**: `optimisticConcurrency: true` on Project schema
- **Cache-Control**: `no-store, private` on authenticated dynamic pages
- **Orphan cleanup**: Old logo files deleted on replacement/project deletion
- **Static before session**: Public assets served before session middleware
- **CI audit**: `npm audit --audit-level=high` in CI pipeline