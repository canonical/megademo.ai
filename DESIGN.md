# MegaDemo.ai — Design Overview

Internal Canonical AI Hackathon platform.
Source: [canonical/megademo.ai](https://github.com/canonical/megademo.ai) · License: GPL-3.0

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20 |
| Framework | Express 5 |
| Database | MongoDB via Mongoose |
| Templates | Pug + Bootstrap 5 + custom SCSS |
| Auth | Passport.js + GitHub OAuth 2.0 (org-restricted to `canonical`) |
| Sessions | express-session stored in MongoDB (connect-mongo) |
| Security | lusca (CSRF), express-rate-limit, sanitize-html |
| File uploads | multer (project logos / asciinema casts) |
| Notifications | Mattermost webhook + daily summary cron (node-cron) |
| Deployment | Render.com (render.yaml) |
| Tests | Jest + Supertest + mongodb-memory-server |

---

## Directory layout

```
app.js              Express entry point — routes, middleware, DB connection
config/
  passport.js       GitHub OAuth strategy; org membership check
  defaults.yml      Seed data: teams, AI tools, tech-stack tags
  flash.js          Lightweight flash message helper
controllers/
  auth.js           Login/logout, dev bypass, token-gated test login
  home.js           Homepage: newest projects, leaderboard, category chart
  project.js        CRUD, voting, media, team join/leave
  admin.js          Settings, user roles, tag/team management, CSV export, reset
  kiosk.js          Read-only kiosk display (no auth)
models/
  User.js           GitHub identity, role (participant | admin)
  Project.js        Project data; embedded media array; avgRating virtual
  Vote.js           One vote per user/project pair (unique index)
  Settings.js       Key-value store for submissionDeadline, megademoDate, etc.
services/
  github.js         GitHub API — org membership verification
  mattermost.js     Webhook POST for new projects and daily summary
scripts/
  seed-defaults.js  Idempotently seeds teams/tags from defaults.yml on startup
  seed-admin.js     CLI to promote a user to admin by email
  daily-summary.js  Builds and posts daily project summary to Mattermost
content/
  get-started.md    End-user help page (Markdown, re-read from disk on request)
views/
  layout.pug        Base layout (navbar, footer, CSRF meta)
  partials/         header.pug, footer.pug, flash.pug, project-card.pug
  home.pug          Homepage
  projects/         list.pug, detail.pug, form.pug, mine.pug
  admin/            dashboard.pug, projects.pug, users.pug, teams.pug, tags.pug
  kiosk/            index.pug, project.pug
  get-started.pug   Renders content/get-started.md
public/
  css/main.scss     Custom theme (compiled to main.css at deploy / npm run scss)
  js/main.js        Countdown, dirty-form guard, join/leave AJAX, star rating
  images/           Static assets
tests/              Jest test suites (auth, home, projects, admin, voting)
```

---

## Key design decisions

**GitHub OAuth only.** No passwords. Access is gated on `canonical` GitHub org membership, verified via GitHub API on every login.

**Trust-based team access.** Any authenticated user can join a project; joining grants edit rights. No approval flow — designed for a short hackathon window where trust is assumed.

**Flat role model.** Two roles: `participant` (default) and `admin`. The first login creates a participant; admins are promoted out-of-band (CLI script or direct DB).

**Settings as key-value.** `submissionDeadline`, `megademoDate`, Mattermost webhook URL, etc. are stored in the `Settings` collection — not in code or env vars — so admins can change them live via the dashboard.

**Markdown content from disk.** The `/get-started` page reads `content/get-started.md` on every request. Content updates ship with code deploys, not DB resets.

**Seed data from YAML.** `config/defaults.yml` holds canonical teams, AI tools, and tech-stack tags. It seeds the DB on first startup (idempotent). Admins can override lists via the dashboard; after that the DB is authoritative.

**Countdown state machine.** The homepage JS covers four states: submissions open → submissions closed → megademo countdown → megademo live. Deadlines are stored as raw `"YYYY-MM-DDTHH:mm"` strings (no timezone conversion) to avoid UTC drift between server and browser.

**Kiosk mode.** `/kiosk` is a separate, auth-free read-only view for projecting the leaderboard on a screen during the event.

---

## Data flow: project registration

```
User → POST /projects
  → auth middleware (isAuthenticated)
  → projectController.create
      → validates + sanitises input
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
      → Project.avgRating recalculated from Vote aggregation
  → JSON { avgRating, voteCount }  (AJAX)
```
