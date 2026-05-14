# Auth Mode Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit `OIDC_ISSUER_URL`-as-switch with an explicit `AUTH_MODE` env var, and extend the site-wide auth gate to activate for both GitHub OAuth and OIDC modes in production.

**Architecture:** A single `resolveAuthMode()` helper in `controllers/auth.js` reads `AUTH_MODE` and returns `'github'` or `'oidc'`. All auth-mode decisions in `app.js` delegate to this function. The site gate in `app.js` changes its activation condition from `if (OIDC_ISSUER_URL)` to `if (NODE_ENV === 'production')`, covering both modes.

**Tech Stack:** Node.js, Express 5, Passport.js (GitHub OAuth), openid-client (OIDC/PKCE), MongoDB sessions via connect-mongo, Jest for tests.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `tests/controllers/auth.test.js` | Create | Unit tests for `resolveAuthMode` and `resolveLoginUrl` |
| `controllers/auth.js` | Modify | Add `resolveAuthMode()`, update `resolveLoginUrl()`, export both |
| `app.js` | Modify | Import helpers; update site gate condition + redirect; update OIDC init guard; simplify `loginUrl` local |
| `config/oidc.js` | Modify | Defensive early-return if called outside `AUTH_MODE=oidc` |
| `.env.example` | Modify | Rewrite auth section to use `AUTH_MODE` |
| `DESIGN.md` | Modify | Rewrite Authentication section |
| `README.md` | Modify | Rewrite Authentication section + Requirements line |
| `content/get-started.md` | Modify | Remove "projects are public" statement |

---

## Task 1: Add `resolveAuthMode`, update and export `resolveLoginUrl` in `controllers/auth.js` (TDD)

**Files:**
- Create: `tests/controllers/auth.test.js`
- Modify: `controllers/auth.js:17-21`

- [ ] **Step 1: Write the failing tests**

Create `tests/controllers/auth.test.js`:

```js
/**
 * Unit tests for auth helpers: resolveAuthMode and resolveLoginUrl.
 */
const { resolveAuthMode, resolveLoginUrl } = require('../../controllers/auth');

describe('resolveAuthMode', () => {
  let savedAuthMode;

  beforeEach(() => { savedAuthMode = process.env.AUTH_MODE; });
  afterEach(() => {
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
  });

  it('returns "github" when AUTH_MODE is unset', () => {
    delete process.env.AUTH_MODE;
    expect(resolveAuthMode()).toBe('github');
  });

  it('returns "github" when AUTH_MODE=github', () => {
    process.env.AUTH_MODE = 'github';
    expect(resolveAuthMode()).toBe('github');
  });

  it('returns "oidc" when AUTH_MODE=oidc', () => {
    process.env.AUTH_MODE = 'oidc';
    expect(resolveAuthMode()).toBe('oidc');
  });

  it('returns "github" for any unrecognised value', () => {
    process.env.AUTH_MODE = 'saml';
    expect(resolveAuthMode()).toBe('github');
  });
});

describe('resolveLoginUrl', () => {
  let savedAuthMode, savedNodeEnv;

  beforeEach(() => {
    savedAuthMode = process.env.AUTH_MODE;
    savedNodeEnv  = process.env.NODE_ENV;
  });
  afterEach(() => {
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
    process.env.NODE_ENV = savedNodeEnv;
  });

  it('returns /auth/dev-login in non-production regardless of AUTH_MODE', () => {
    process.env.NODE_ENV  = 'development';
    process.env.AUTH_MODE = 'oidc';
    expect(resolveLoginUrl()).toBe('/auth/dev-login');
  });

  it('returns /auth/github in production when AUTH_MODE is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_MODE;
    expect(resolveLoginUrl()).toBe('/auth/github');
  });

  it('returns /auth/github in production when AUTH_MODE=github', () => {
    process.env.NODE_ENV  = 'production';
    process.env.AUTH_MODE = 'github';
    expect(resolveLoginUrl()).toBe('/auth/github');
  });

  it('returns /auth/oidc in production when AUTH_MODE=oidc', () => {
    process.env.NODE_ENV  = 'production';
    process.env.AUTH_MODE = 'oidc';
    expect(resolveLoginUrl()).toBe('/auth/oidc');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=tests/controllers/auth
```

Expected: 8 failures — `resolveAuthMode is not a function` and `resolveLoginUrl is not a function` (neither is currently exported).

- [ ] **Step 3: Implement `resolveAuthMode`, update `resolveLoginUrl`, export both**

In `controllers/auth.js`, replace lines 17–21 (the existing `resolveLoginUrl` function):

```js
/**
 * Return the effective auth mode: 'oidc' or 'github' (default).
 * AUTH_MODE=oidc activates Canonical IdP; everything else uses GitHub OAuth.
 * OIDC_ISSUER_URL is ignored unless AUTH_MODE=oidc.
 */
function resolveAuthMode() {
  return process.env.AUTH_MODE === 'oidc' ? 'oidc' : 'github';
}
exports.resolveAuthMode = resolveAuthMode;

/** Resolve the appropriate login URL for the current environment. */
function resolveLoginUrl() {
  if (process.env.NODE_ENV !== 'production') return '/auth/dev-login';
  if (resolveAuthMode() === 'oidc')           return '/auth/oidc';
  return '/auth/github';
}
exports.resolveLoginUrl = resolveLoginUrl;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=tests/controllers/auth
```

Expected: 8 tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass (the existing `resolveLoginUrl` behaviour is preserved — only the OIDC check changed from `OIDC_ISSUER_URL` to `AUTH_MODE`, which doesn't affect any existing tests since they don't set either).

- [ ] **Step 6: Commit**

```bash
git add tests/controllers/auth.test.js controllers/auth.js
git commit -m "feat: add resolveAuthMode helper and export resolveLoginUrl

AUTH_MODE=oidc selects Canonical IdP; default is GitHub OAuth.
resolveAuthMode() is the single source of truth for mode selection.
Both helpers exported for use in app.js.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Update `app.js` — gate, loginUrl local, OIDC init

**Files:**
- Modify: `app.js:85`, `app.js:265-269`, `app.js:318-337`, `app.js:440-442`

- [ ] **Step 1: Add imports at the top of `app.js`**

Find line 85 (the `authController` require):

```js
const authController    = require('./controllers/auth');
```

Replace with:

```js
const authController                      = require('./controllers/auth');
const { resolveAuthMode, resolveLoginUrl } = authController;
```

- [ ] **Step 2: Simplify the `loginUrl` template local (lines 265-268)**

Find this block:

```js
  // Three-way login URL: dev → dev-login | prod+OIDC → /auth/oidc | prod → /auth/github
  const isOidc = !!process.env.OIDC_ISSUER_URL;
  const isDev  = process.env.NODE_ENV !== 'production';
  res.locals.loginUrl = isDev ? '/auth/dev-login' : (isOidc ? '/auth/oidc' : '/auth/github');
```

Replace with:

```js
  // Login URL follows AUTH_MODE: dev → /auth/dev-login | oidc → /auth/oidc | github → /auth/github
  res.locals.loginUrl = resolveLoginUrl();
```

- [ ] **Step 3: Update the site-wide auth gate (lines 318-337)**

Find this entire block:

```js
/**
 * Global authentication gate — active only when OIDC_ISSUER_URL is set.
 * Gates the entire site: every request (except /auth/*) requires
 * an authenticated session. Unauthenticated users are redirected to the OIDC
 * login flow with their intended URL saved for post-login redirect.
 *
 * When OIDC_ISSUER_URL is NOT set (local dev / GitHub OAuth mode), individual
 * route guards (isAuthenticated) continue to handle access control as before.
 */
if (process.env.OIDC_ISSUER_URL) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health') return next();
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/oidc');
    }
    next();
  });
}
```

Replace with:

```js
/**
 * Global authentication gate — active in production for both auth modes.
 * Every request except /auth/* and /health requires an authenticated session.
 * Unauthenticated users are redirected to the login endpoint for the active
 * AUTH_MODE (resolveLoginUrl), with their intended URL saved for post-login.
 *
 * In development this gate is skipped; /auth/dev-login handles auth.
 * Static assets (/uploads, /public) are served before this middleware.
 */
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health') return next();
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect(resolveLoginUrl());
    }
    next();
  });
}
```

- [ ] **Step 4: Update the OIDC init guard in `startServer()` (lines 440-442)**

Find:

```js
    if (process.env.OIDC_ISSUER_URL) {
      await initOidcClient();
    }
```

Replace with:

```js
    if (resolveAuthMode() === 'oidc') {
      await initOidcClient();
    }
```

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass. The gate condition change only affects `NODE_ENV=production`; tests run with `NODE_ENV=test`.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: extend site auth gate to cover both AUTH_MODE values

The gate previously only activated when OIDC_ISSUER_URL was set.
It now activates for all production deployments regardless of AUTH_MODE,
redirecting to /auth/github or /auth/oidc per resolveLoginUrl().
loginUrl template local now uses resolveLoginUrl() directly.
OIDC client init guarded by resolveAuthMode() === 'oidc'.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Add defensive guard to `config/oidc.js`

**Files:**
- Modify: `config/oidc.js:20` (start of `initOidcClient`)

- [ ] **Step 1: Add early-return guard at the top of `initOidcClient()`**

Find the start of `initOidcClient()` (line ~20):

```js
async function initOidcClient() {
  const issuerUrl    = process.env.OIDC_ISSUER_URL;
  if (!issuerUrl) return null;
```

Replace with:

```js
async function initOidcClient() {
  if (process.env.AUTH_MODE !== 'oidc') {
    console.warn('initOidcClient() called but AUTH_MODE !== "oidc" — skipping OIDC init.');
    return null;
  }
  const issuerUrl    = process.env.OIDC_ISSUER_URL;
  if (!issuerUrl) return null;
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add config/oidc.js
git commit -m "fix: guard initOidcClient() against being called in github auth mode

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Update `.env.example`

**Files:**
- Modify: `.env.example` (the entire Authentication section)

- [ ] **Step 1: Rewrite the Authentication section**

Find the entire auth section in `.env.example` (from `# Authentication` to `ALLOW_CANONICAL_EMAIL_FALLBACK=true`) and replace it with:

```
# ---------------------------------------------------------------------------
# Authentication — set AUTH_MODE to choose the strategy
#
#   AUTH_MODE=github (default): GitHub OAuth, org-restricted to github.com/canonical.
#     - The entire site is gated in production.
#     - Create an OAuth App at:
#         https://github.com/organizations/canonical/settings/applications
#       Set Authorization callback URL: BASE_URL + /auth/github/callback
#     - Required: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
#     - Optional: ALLOW_CANONICAL_EMAIL_FALLBACK=true
#         Enable if the canonical org has OAuth App access restrictions.
#         Falls back to verifying @canonical.com email domain instead of the API.
#
#   AUTH_MODE=oidc: Canonical Identity Platform (Ory Hydra / Kratos).
#     - The entire site is gated in production.
#     - Ask IS to register MegaDemo.ai as a Hydra client.
#         Redirect URI: BASE_URL + /auth/oidc/callback
#         Scopes:       openid profile email
#     - IS provides OIDC_CLIENT_ID + OIDC_CLIENT_SECRET.
#     - Required: OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, BASE_URL
# ---------------------------------------------------------------------------
AUTH_MODE=github

# Required for AUTH_MODE=github:
GITHUB_CLIENT_ID=your-github-oauth-app-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-app-client-secret
ALLOW_CANONICAL_EMAIL_FALLBACK=true

# Required for AUTH_MODE=oidc (ignored when AUTH_MODE=github):
OIDC_ISSUER_URL=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example for AUTH_MODE switch

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Update documentation

**Files:**
- Modify: `DESIGN.md:79-101`
- Modify: `README.md:35-62`
- Modify: `content/get-started.md:12-15`

- [ ] **Step 1: Rewrite the Authentication section in `DESIGN.md`**

Find lines 79-101 (the `## Authentication` section through the first `---`):

```markdown
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
```

Replace with:

```markdown
## Authentication

Two modes; selected by the `AUTH_MODE` environment variable (`github` default, `oidc` for Canonical IdP).
In **both modes**, the entire site is gated in production — all routes except `/auth/*` and `/health`
require an authenticated session.

### Mode A — GitHub OAuth (default)

When `AUTH_MODE=github` (or `AUTH_MODE` is unset):
- The **entire site** is gated in production — unauthenticated requests redirect to `/auth/github`
- Login flow: MegaDemo.ai → GitHub OAuth → canonical org membership check → session established
- Canonical membership verified via three methods (in order): org membership API → org list → `@canonical.com` email domain fallback (opt-in via `ALLOW_CANONICAL_EMAIL_FALLBACK=true`)
- `OIDC_ISSUER_URL` is ignored even if set
- Required env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

GitHub OAuth App setup (canonical org admin required):
1. Navigate to `https://github.com/organizations/canonical/settings/applications` → New OAuth App
2. Authorization callback URL: `https://megademo.ai/auth/github/callback`
3. Copy Client ID and Client Secret → set as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
4. If org has OAuth App access restrictions: approve the app at the org's OAuth policy page,
   or set `ALLOW_CANONICAL_EMAIL_FALLBACK=true` as a fallback.

### Mode B — OIDC via Canonical Identity Platform

When `AUTH_MODE=oidc`:
- The **entire site** is gated in production — unauthenticated requests redirect to `/auth/oidc`
- Login flow: MegaDemo.ai → Hydra → Kratos → GitHub (upstream IdP) → back
- `@canonical.com` domain filtering handled by Kratos (configured by IS)
- Uses Authorization Code + PKCE flow
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are not used

Redirect URI to register with IS: `https://megademo.ai/auth/oidc/callback`
Scopes: `openid profile email`
Required env vars: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `BASE_URL`
```

- [ ] **Step 2: Rewrite the Authentication section in `README.md`**

Find lines 35-62 (from `## Requirements` through the GitHub OAuth app restriction note):

```markdown
## Requirements

- Node.js >= 20
- MongoDB (local or Atlas)
- GitHub OAuth App credentials **or** Canonical Identity Platform OIDC credentials

## Authentication

Two modes are supported. Set `OIDC_ISSUER_URL` to activate OIDC; leave it unset to use GitHub OAuth.

### Option A — OIDC via Canonical Identity Platform (recommended for production)

When `OIDC_ISSUER_URL` is set, the entire site is gated behind OIDC login. GitHub OAuth is bypassed.

1. Ask IS to register MegaDemo.ai as a Hydra client:
   - Redirect URI: `https://megademo.ai/auth/oidc/callback`
   - Scopes: `openid profile email`
   - Grant type: Authorization Code (PKCE)
2. IS provides `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`
3. Set `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in your environment and redeploy

### Option B — Direct GitHub OAuth (default until OIDC is ready)

1. Go to https://github.com/settings/developers and click **New OAuth App**
2. Set **Authorization callback URL** to `https://megademo.ai/auth/github/callback`
   (and `http://localhost:8080/auth/github/callback` for local dev)
3. Scopes required: `user:email`, `read:org`
4. Copy **Client ID** and **Client Secret** to `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`

> **Note:** If the `canonical` org has OAuth App restrictions enabled, an org owner must approve
> the app at `https://github.com/organizations/canonical/settings/oauth_application_policy`.
> Or set `ALLOW_CANONICAL_EMAIL_FALLBACK=true` to verify via `@canonical.com` email domain instead.
```

Replace with:

```markdown
## Requirements

- Node.js >= 20
- MongoDB (local or Atlas)
- GitHub OAuth App credentials (default) **or** Canonical Identity Platform OIDC credentials

## Authentication

Two modes are supported, selected by the `AUTH_MODE` environment variable. In both modes the
entire site is gated in production — sign-in is required to access any page.

### Option A — GitHub OAuth (default, `AUTH_MODE=github`)

1. A `canonical` org admin creates an OAuth App at:
   `https://github.com/organizations/canonical/settings/applications` → **New OAuth App**
2. Set **Authorization callback URL** to `https://megademo.ai/auth/github/callback`
   (use `http://localhost:8080/auth/github/callback` for local dev)
3. Copy **Client ID** and **Client Secret** to Render env vars as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
4. Set `AUTH_MODE=github` (or leave `AUTH_MODE` unset — github is the default)

> **Note:** If the `canonical` org has OAuth App restrictions, a org owner must approve the app
> at `https://github.com/organizations/canonical/settings/oauth_application_policy`.
> Alternatively, set `ALLOW_CANONICAL_EMAIL_FALLBACK=true` to verify via `@canonical.com` email domain.

### Option B — OIDC via Canonical Identity Platform (`AUTH_MODE=oidc`)

1. Ask IS to register MegaDemo.ai as a Hydra client:
   - Redirect URI: `https://megademo.ai/auth/oidc/callback`
   - Scopes: `openid profile email`
   - Grant type: Authorization Code (PKCE)
2. IS provides `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`
3. Set `AUTH_MODE=oidc`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` in Render and redeploy
```

- [ ] **Step 3: Update `content/get-started.md`**

Find the Browse projects section (lines ~12-15):

```markdown
## Browse projects

**[Projects](/projects)** are public — no sign-in needed.
Sort by newest or top-rated. Click any card to see full details, demo videos, and repo links.
```

Replace with:

```markdown
## Browse projects

Sign in, then go to **[Projects](/projects)**.
Sort by newest or top-rated. Click any card to see full details, demo videos, and repo links.
```

- [ ] **Step 4: Run lint and tests**

```bash
npm run lint-check && npm test
```

Expected: zero ESLint errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md README.md content/get-started.md
git commit -m "docs: update auth docs for AUTH_MODE env var switch

DESIGN.md, README.md: document AUTH_MODE=github|oidc and the
site-wide gate that now applies to both modes in production.
get-started.md: remove 'projects are public' — sign-in now required.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Done

After Task 5, verify the full CI gate passes:

```bash
npm run lint-check && npm test
```

**To activate GitHub OAuth in production (Render):**
1. Set `AUTH_MODE=github` (or remove it — github is the default)
2. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
3. Optionally set `ALLOW_CANONICAL_EMAIL_FALLBACK=true`
4. Redeploy — existing sessions remain valid, no one is logged out
