# ESM Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the entire megademo.ai codebase from CommonJS to ES Modules, enabling upgrades to openid-client v6, marked v18, and file-type v22.

**Architecture:** Add `"type": "module"` to `package.json`; convert all 26 source files and 11 test files from `require`/`module.exports` to `import`/`export`; rewrite `config/oidc.js` and the OIDC section of `controllers/auth.js` for the openid-client v6 API. One file rename: `jest.config.js` → `jest.config.cjs`.

**Tech Stack:** Node.js ≥20.12, Express 5, Jest 29 (--experimental-vm-modules), openid-client v6, marked v18, file-type v22.

---

## Mechanical transformation rules (apply everywhere)

| CJS pattern | ESM replacement |
|---|---|
| `const x = require('y')` | `import x from 'y'` |
| `const { a, b } = require('y')` | `import { a, b } from 'y'` |
| `module.exports = X` | `export default X` |
| `exports.foo = bar` | `export const foo = bar` |
| Relative path `'./foo'` | `'./foo.js'` (add extension) |
| `require.main === module` | `process.argv[1] === __filename` (with `__filename` shim below) |

**`__dirname` / `__filename` shim** — add near top of any file that uses `__dirname` or needs the main-check:
```js
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

Files needing the shim: `app.js`, `controllers/admin.js`, `controllers/project.js`, `scripts/seed-defaults.js`

---

## Task 1: Set up worktree

**Files:**
- Create worktree at `.worktrees/esm-migration` on branch `feat/esm-migration`

- [ ] **Step 1: Create worktree**

```bash
cd /path/to/megademo.ai
git worktree add .worktrees/esm-migration -b feat/esm-migration
cd .worktrees/esm-migration
npm install --ignore-scripts
```

Expected: 184 tests pass baseline

- [ ] **Step 2: Confirm baseline**

```bash
npm test
```

Expected: `Tests: 184 passed, 184 total`

---

## Task 2: Upgrade packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version pins in package.json**

In `package.json` `"dependencies"`, change:
```json
"file-type": "^22.0.1",
"marked": "^18.0.4",
"openid-client": "^6.8.4",
```

- [ ] **Step 2: Install**

```bash
npm install --ignore-scripts
```

Expected: `package-lock.json` updated, no errors.

- [ ] **Step 3: Confirm tests still pass (still CJS at this point)**

```bash
npm test
```

Expected: `Tests: 184 passed, 184 total`

> Note: Tests will pass because `openid-client` v6 is ESM-only and none of the source files have been converted yet — Node will fail to load it if required, but the tests mock the oidc module, so this actually needs verification. If tests fail at this step, it confirms we need to do the full ESM conversion before upgrading openid-client. In that case, skip the openid-client upgrade for now and re-add it in Task 10 after the ESM conversion.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade openid-client v6, marked v18, file-type v22"
```

---

## Task 3: Module system flip + jest rename

**Files:**
- Modify: `package.json` (add `"type": "module"`)
- Rename: `jest.config.js` → `jest.config.cjs`

> ⚠️ After this step, all `.js` files are ESM. The app and tests will be broken until all files are converted (Tasks 4–13). Do not run `npm test` until Task 13 is complete.

- [ ] **Step 1: Add `"type": "module"` to package.json**

In `package.json`, after `"description"`:
```json
"type": "module",
```

- [ ] **Step 2: Rename jest.config.js**

```bash
git mv jest.config.js jest.config.cjs
```

- [ ] **Step 3: Commit (app is temporarily broken — do not run tests yet)**

```bash
git add package.json jest.config.cjs
git rm jest.config.js 2>/dev/null || true
git commit -m "chore: add type=module, rename jest.config.js to jest.config.cjs"
```

---

## Task 4: Convert models/

**Files:**
- Modify: `models/ActivityLog.js`, `models/User.js`, `models/Vote.js`, `models/Settings.js`, `models/Project.js`

### models/ActivityLog.js

- [ ] **Step 1: Replace require/exports**

```js
import mongoose from 'mongoose';

// ... (schema unchanged) ...

export default ActivityLog;
```

Full file after conversion:
```js
/**
 * ActivityLog model — records all DB-mutating user actions.
 */
import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  userEmail: { type: String, required: true },
  action:    { type: String, required: true },
});

activityLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
export default ActivityLog;
```

### models/User.js

Full file after conversion:
```js
import crypto from 'node:crypto';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, required: true },
    github: String,
    githubLogin: String,
    role: {
      type: String,
      enum: ['viewer', 'participant', 'admin'],
      default: 'participant',
    },
    profile: {
      name: String,
      picture: String,
    },
  },
  { timestamps: true },
);

userSchema.statics.generateToken = function generateToken() {
  return crypto.randomBytes(32).toString('hex');
};

const User = mongoose.model('User', userSchema);
export default User;
```

### models/Vote.js

Full file after conversion:
```js
import mongoose from 'mongoose';

const voteSchema = new mongoose.Schema(
  {
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    stars:   { type: Number, min: 1, max: 5, required: true },
  },
  { timestamps: true },
);

voteSchema.index({ user: 1, project: 1 }, { unique: true });

const Vote = mongoose.model('Vote', voteSchema);
export default Vote;
```

### models/Settings.js

Full file after conversion:
```js
import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema(
  {
    key:   { type: String, unique: true, required: true },
    value: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

settingsSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaultValue;
};

settingsSchema.statics.set = async function (key, value) {
  return this.findOneAndUpdate({ key }, { value }, { upsert: true, returnDocument: 'after' });
};

settingsSchema.statics.arrayAdd = async function (key, item) {
  return this.findOneAndUpdate(
    { key },
    [{ $set: { value: { $cond: [{ $isArray: '$value' }, { $setUnion: ['$value', [item]] }, [item]] } } }],
    { upsert: true, returnDocument: 'after', updatePipeline: true },
  );
};

settingsSchema.statics.arrayRemove = async function (key, item) {
  return this.findOneAndUpdate(
    { key, value: { $type: 'array' } },
    { $pull: { value: item } },
    { returnDocument: 'after' },
  );
};

settingsSchema.statics.arrayRename = async function (key, oldItem, newItem) {
  return this.findOneAndUpdate(
    { key },
    { $set: { 'value.$[el]': newItem } },
    { arrayFilters: [{ el: oldItem }], returnDocument: 'after' },
  );
};

const Settings = mongoose.model('Settings', settingsSchema);
export default Settings;
```

### models/Project.js

Key changes:
- `require` → `import`
- `module.exports = { Project, ... }` → named `export`s
- `marked(this.description)` → `marked.parse(this.description)` (v18 compatibility)

Full header (first ~10 lines):
```js
import mongoose from 'mongoose';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
```

In the `descriptionHtml` virtual (around line 88):
```js
return sanitizeHtml(marked.parse(this.description || ''), SANITIZE_OPTIONS);
```

Last two lines:
```js
export { Project, CATEGORIES, AI_TOOLS, CANONICAL_TEAMS, TECH_STACK_DEFAULTS, COMPLETION_STAGES, computeLiveliness };
```
(remove `module.exports = { ... }`)

- [ ] **Step 2: Apply all model changes**

- [ ] **Step 3: Commit**

```bash
git add models/
git commit -m "refactor: convert models to ESM"
```

---

## Task 5: Convert services/

**Files:**
- Modify: `services/activityLog.js`, `services/imageTypeCheck.js`, `services/mattermost.js`, `services/viz-sync.js`, `services/github.js`

### services/activityLog.js

```js
import ActivityLog from '../models/ActivityLog.js';

function sanitizeLogString(s) {
  // eslint-disable-next-line no-control-regex
  return typeof s === 'string' ? s.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').trim() : String(s);
}

async function logActivity(userEmail, action) {
  try {
    await ActivityLog.create({
      userEmail: sanitizeLogString(userEmail),
      action: sanitizeLogString(action),
    });
  } catch {
    // Intentionally swallowed
  }
}

export { logActivity };
```

### services/imageTypeCheck.js

```js
import fs from 'node:fs';

async function verifyImageMagicBytes(file, allowedMimes, errorMsg) {
  if (!file) return;
  const { fileTypeFromFile } = await import('file-type');
  let type;
  try {
    type = await fileTypeFromFile(file.path);
  } catch {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new Error(errorMsg);
  }
  if (!type || !allowedMimes.includes(type.mime)) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new Error(errorMsg);
  }
}

export { verifyImageMagicBytes };
```

### services/mattermost.js

```js
import axios from 'axios';
import Settings from '../models/Settings.js';

// ... (all internal code unchanged) ...

export {
  notifyProjectSubmitted,
  notifyFinalistPromoted,
  recordVotingMilestone,
  postHourlySummary,
};
```

Replace `const axios = require('axios')` and `const Settings = require('../models/Settings')` at top.
Remove `module.exports = { ... }` at bottom; add named exports as above.

### services/viz-sync.js

```js
import axios from 'axios';

// ... (all internal code unchanged) ...

export {
  syncVizContent,
  getVizFragment,
  getSyncStatus,
  checkTokenAccess,
  GRANULARITIES,
};
```

Replace `const axios = require('axios')` at top.
Remove `module.exports = { ... }` at bottom; add named exports.

### services/github.js

```js
import axios from 'axios';
import { Project } from '../models/Project.js';

// ... (all internal code unchanged) ...

export { refreshProjectStats, parseVideoId };
```

Replace `const axios = require('axios')` and `const { Project } = require('../models/Project')` at top.
Remove `module.exports = { ... }` at bottom; add named exports.

- [ ] **Step 1: Apply all service changes**

- [ ] **Step 2: Commit**

```bash
git add services/
git commit -m "refactor: convert services to ESM"
```

---

## Task 6: Convert config/flash.js and config/passport.js

### config/flash.js

Replace `exports.flash = () =>` with `export const flash = () =>`. No other changes.

Full file:
```js
/**
 * Flash message middleware — attaches req.flash() and res.locals.messages
 */
export const flash = () => (req, res, next) => {
  if (!req.session) return next();

  if (!req.session.flash) req.session.flash = {};

  req.flash = (type, msg) => {
    if (!req.session.flash[type]) req.session.flash[type] = [];
    if (Array.isArray(msg)) {
      req.session.flash[type].push(
        ...msg.map((item) => (item !== null && typeof item === 'object' ? item : { msg: item })),
      );
    } else {
      req.session.flash[type].push(msg !== null && typeof msg === 'object' ? msg : { msg });
    }
  };

  res.locals.messages = req.session.flash;
  req.session.flash = {};
  next();
};
```

### config/passport.js

```js
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import axios from 'axios';
import User from '../models/User.js';

// ... (all strategy logic unchanged) ...
// No module.exports — passport.use() registers the strategy as a side effect
```

Remove `const passport = require('passport')`, `const { Strategy: GitHubStrategy } = require('passport-github2')`, `const axios = require('axios')`, `const User = require('../models/User')` from top.
Add equivalent `import` statements as shown.
There is no `module.exports` in passport.js — nothing to replace.

- [ ] **Step 1: Apply config/flash.js and config/passport.js changes**

- [ ] **Step 2: Commit**

```bash
git add config/flash.js config/passport.js
git commit -m "refactor: convert config/flash and config/passport to ESM"
```

---

## Task 7: Rewrite config/oidc.js for openid-client v6

**Files:**
- Modify: `config/oidc.js`

The openid-client v6 API replaces `Issuer.discover()` + `new issuer.Client()` with a single `discovery()` call that returns a `Configuration` object. All subsequent operations use this `Configuration`.

Full replacement for `config/oidc.js`:

```js
/**
 * OIDC client — Canonical Identity Platform (Ory Hydra)
 *
 * Activated when AUTH_MODE=oidc env var is set. Uses openid-client v6 with
 * PKCE (S256) for the Authorization Code flow.
 *
 * Required env vars:
 *   OIDC_ISSUER_URL     — Hydra public URL (OIDC discovery endpoint root)
 *   OIDC_CLIENT_ID      — Client ID issued by Hydra for this app
 *   OIDC_CLIENT_SECRET  — Client secret issued by Hydra for this app
 */
import { discovery } from 'openid-client';

let oidcConfig = null;

/**
 * Discover the OIDC issuer and initialise the client configuration.
 * Called once at app startup if AUTH_MODE=oidc.
 */
async function initOidcClient() {
  if (process.env.AUTH_MODE !== 'oidc') return;

  const issuerUrl    = process.env.OIDC_ISSUER_URL;
  if (!issuerUrl) {
    throw new Error('AUTH_MODE=oidc but OIDC_ISSUER_URL is not set');
  }

  const clientId     = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const baseUrl      = process.env.BASE_URL;

  if (!clientId || !clientSecret) {
    throw new Error('OIDC_ISSUER_URL is set but OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is missing');
  }
  if (!baseUrl) {
    throw new Error('OIDC_ISSUER_URL is set but BASE_URL is missing (required for redirect_uri)');
  }

  try {
    oidcConfig = await discovery(new URL(issuerUrl), clientId, clientSecret);
  } catch (err) {
    throw new Error(`OIDC discovery failed for ${issuerUrl}: ${err.message}`, { cause: err });
  }

  console.log(`OIDC client initialised (issuer: ${issuerUrl})`);
  return oidcConfig;
}

/** Returns the initialised OIDC Configuration, or null if OIDC is not configured. */
function getOidcConfig() {
  return oidcConfig;
}

export { initOidcClient, getOidcConfig };
```

- [ ] **Step 1: Replace config/oidc.js with the content above**

- [ ] **Step 2: Commit**

```bash
git add config/oidc.js
git commit -m "refactor: rewrite config/oidc.js for openid-client v6 + ESM"
```

---

## Task 8: Convert simple controllers (home, kiosk, visualize)

### controllers/home.js

```js
import { Project, computeLiveliness } from '../models/Project.js';
import Settings from '../models/Settings.js';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// ... (renderHeroDescription and all other functions unchanged) ...

export { renderHeroDescription, index };
```

Replace the 4 `require()` lines at top with 4 `import` lines as shown.
Replace `exports.renderHeroDescription = renderHeroDescription` and `exports.index = index` (and any other `exports.*`) with a named `export { ... }` block at the bottom, OR convert inline:
```js
export async function index(req, res, next) { ... }
export function renderHeroDescription(raw) { ... }
```
(Either form works; the `export function` form is cleanest.)

### controllers/kiosk.js

```js
import { Project, computeLiveliness } from '../models/Project.js';
import { parseVideoId } from '../services/github.js';

export const index = async (req, res, next) => { ... };
export const project = async (req, res, next) => { ... };
```

### controllers/visualize.js

```js
import { getVizFragment, GRANULARITIES } from '../services/viz-sync.js';

export const show = (req, res) => { ... };
```

- [ ] **Step 1: Apply all three controller changes**

- [ ] **Step 2: Commit**

```bash
git add controllers/home.js controllers/kiosk.js controllers/visualize.js
git commit -m "refactor: convert home/kiosk/visualize controllers to ESM"
```

---

## Task 9: Rewrite controllers/auth.js (ESM + openid-client v6)

**Files:**
- Modify: `controllers/auth.js`

Key changes:
1. `require()` → `import`
2. `exports.foo = bar` → `export const foo = bar` (or `export function foo`)
3. `{ generators } from 'openid-client'` → named v6 functions: `randomState`, `randomNonce`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `buildAuthorizationUrl`, `authorizationCodeGrant`
4. `getClient()` → `getOidcConfig()` (renamed in Task 7)
5. `oidcLogin` becomes `async` (needed for `calculatePKCECodeChallenge`)
6. `client.authorizationUrl({...})` → `buildAuthorizationUrl(config, new URLSearchParams({...}))`
7. `client.callbackParams(req)` + `client.callback(...)` → `authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier, expectedState, expectedNonce })`
8. `tokenSet.claims()` → `tokenSet.claims()` (unchanged in v6)

Full replacement for `controllers/auth.js`:

```js
/**
 * Auth controller — GitHub OAuth + OIDC (Canonical Identity Platform)
 *
 * Auth strategy selection:
 *   - dev (NODE_ENV !== 'production'):  /auth/dev-login  (bypasses OAuth entirely)
 *   - prod + AUTH_MODE=oidc:            /auth/oidc       (Canonical IdP via Hydra)
 *   - prod + anything else:             /auth/github     (direct GitHub OAuth)
 */
import crypto from 'node:crypto';
import passport from 'passport';
import User from '../models/User.js';
import {
  randomState,
  randomNonce,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  buildAuthorizationUrl,
  authorizationCodeGrant,
} from 'openid-client';
import { getOidcConfig } from '../config/oidc.js';
import { logActivity } from '../services/activityLog.js';

export function resolveAuthMode() {
  return process.env.AUTH_MODE === 'oidc' ? 'oidc' : 'github';
}

export function resolveLoginUrl() {
  if (process.env.NODE_ENV !== 'production') return '/auth/dev-login';
  if (resolveAuthMode() === 'oidc')           return '/auth/oidc';
  return '/auth/github';
}

function safeReturnTo(url) {
  if (typeof url === 'string' && (url === '/' || /^\/[^/\\]/.test(url))) return url;
  return '/';
}

export const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  const wantsJson = req.headers['content-type']?.includes('application/json')
    || req.headers.accept?.includes('application/json');
  if (wantsJson) return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  req.session.returnTo = req.originalUrl;
  const loginUrl = resolveLoginUrl();
  res.redirect(loginUrl);
};

export const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  const wantsJson = req.headers['content-type']?.includes('application/json')
    || req.headers.accept?.includes('application/json');
  if (!req.isAuthenticated()) {
    if (wantsJson) return res.status(401).json({ error: 'Authentication required.' });
    req.session.returnTo = req.originalUrl;
    const loginUrl = resolveLoginUrl();
    return res.redirect(loginUrl);
  }
  if (wantsJson) return res.status(403).json({ error: 'Admin access required.' });
  res.status(403).render('error', { title: 'Access Denied', message: 'Admin access required.' });
};

function regenerateSession(req, cb) {
  const returnTo = req.session.returnTo;
  const csrfSecret = req.session._csrfSecret;
  req.session.regenerate((err) => {
    if (err) return cb(err);
    if (returnTo) req.session.returnTo = returnTo;
    if (csrfSecret) req.session._csrfSecret = csrfSecret;
    cb(null);
  });
}

export const githubLogin = passport.authenticate('github', { scope: ['user:email', 'read:org'], state: true });

export const githubCallback = (req, res, next) => {
  passport.authenticate('github', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/');
    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        logActivity(user.email, 'Logged in (GitHub)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
    });
  })(req, res, next);
};

export const logout = (req, res, next) => {
  const email = req.user?.email;
  req.logout((err) => {
    if (err) return next(err);
    if (email) logActivity(email, 'Logged out').catch(() => {});
    res.redirect('/auth/signed-out');
  });
};

export const signedOut = (req, res) => {
  res.render('auth-signed-out', { title: 'Signed out' });
};

export const devLoginForm = (req, res) => {
  res.render('dev-login', { title: 'Dev Login' });
};

export const testLogin = async (req, res, next) => {
  const configuredToken = process.env.TEST_LOGIN_TOKEN;
  if (!configuredToken) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Page not found.', user: null });
  }
  const submittedToken = req.body?.token || req.query?.token;
  if (!submittedToken || (() => {
    try {
      const key  = crypto.createHash('sha256').update(configuredToken).digest();
      const a    = crypto.createHmac('sha256', key).update(submittedToken).digest();
      const b    = crypto.createHmac('sha256', key).update(configuredToken).digest();
      return !crypto.timingSafeEqual(a, b);
    } catch { return true; }
  })()) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid test login token.', user: null });
  }

  const ALLOWED_ROLES = ['participant', 'admin'];
  const role = ALLOWED_ROLES.includes(req.body?.role || req.query?.role) ? (req.body?.role || req.query?.role) : 'participant';
  const email = `test-${role}@megademo-test.local`;

  try {
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        email,
        github: `test-synthetic-${role}`,
        githubLogin: `test-${role}`,
        role,
        profile: { name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`, picture: '' },
      });
    } else {
      user.role = role;
    }
    await user.save();

    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (err) => {
        if (err) return next(err);
        logActivity(user.email, 'Logged in (test)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
    });
  } catch (err) { next(err); }
};

export const devLogin = async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
  }
  const ALLOWED_ROLES = ['participant', 'admin', 'organizer'];
  try {
    const { handle = 'dev-user', role = 'participant' } = req.body;
    if (!handle || typeof handle !== 'string' || handle.length > 50 || !/^[\w-]+$/.test(handle)) {
      return res.status(400).render('error', { title: 'Invalid Input', message: 'Invalid handle.' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).render('error', { title: 'Invalid Input', message: 'Invalid role.' });
    }
    const email = `${handle}@canonical.com`;
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        email,
        github: `dev-${handle}`,
        githubLogin: handle,
        role,
        profile: { name: handle, picture: '' },
      });
      await user.save();
    } else {
      user.role = role;
      await user.save();
    }
    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (err) => {
        if (err) return next(err);
        logActivity(user.email, 'Logged in (dev)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
    });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// OIDC — Canonical Identity Platform (Ory Hydra)
// ---------------------------------------------------------------------------

/**
 * GET /auth/oidc — initiate OIDC Authorization Code flow with PKCE
 */
export const oidcLogin = async (req, res, next) => {
  const config = getOidcConfig();
  if (!config) return next(new Error('OIDC not configured — OIDC_ISSUER_URL is not set.'));

  const state         = randomState();
  const nonce         = randomNonce();
  const codeVerifier  = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

  req.session.oidcParams = { state, nonce, codeVerifier };

  const url = buildAuthorizationUrl(config, new URLSearchParams({
    scope:                  'openid profile email',
    state,
    nonce,
    code_challenge:         codeChallenge,
    code_challenge_method:  'S256',
  }));

  res.redirect(url.href);
};

/**
 * GET /auth/oidc/callback — exchange code for tokens, upsert user, establish session
 */
export const oidcCallback = async (req, res, next) => {
  const config = getOidcConfig();
  if (!config) return next(new Error('OIDC not configured.'));

  const oidcParams = req.session.oidcParams;
  delete req.session.oidcParams;
  if (!oidcParams?.state || !oidcParams?.codeVerifier) {
    req.flash('errors', { msg: 'Login session expired or invalid. Please try again.' });
    return res.redirect(resolveLoginUrl());
  }
  const { state, nonce, codeVerifier } = oidcParams;

  try {
    const currentUrl = new URL(
      req.originalUrl,
      process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
    );
    const tokenSet = await authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState:    state,
      expectedNonce:    nonce,
    });

    const claims = tokenSet.claims();
    const email  = claims.email;

    if (!email) {
      req.flash('errors', { msg: 'No email address returned by the identity provider.' });
      return res.redirect(resolveLoginUrl());
    }

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ email, role: 'participant' });
    }

    const displayName = claims.name || claims.preferred_username || email.split('@')[0];
    user.profile            = user.profile || {};
    user.profile.name       = displayName;
    user.profile.picture    = user.profile.picture || claims.picture || '';

    await user.save();

    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (err) => {
        if (err) return next(err);
        logActivity(user.email, 'Logged in (OIDC)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
    });
  } catch (err) {
    console.error('OIDC callback error:', err.message);
    req.flash('errors', { msg: 'Sign-in failed. Please try again.' });
    res.redirect(resolveLoginUrl());
  }
};
```

- [ ] **Step 1: Replace controllers/auth.js with the full content above**

- [ ] **Step 2: Commit**

```bash
git add controllers/auth.js
git commit -m "refactor: convert controllers/auth.js to ESM + openid-client v6"
```

---

## Task 10: Convert controllers/project.js and controllers/admin.js

### controllers/project.js

Top-level imports — replace all `require()` at lines 4–64 with:
```js
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImageMagicBytes } from '../services/imageTypeCheck.js';
import { Project, CATEGORIES, AI_TOOLS, CANONICAL_TEAMS, TECH_STACK_DEFAULTS, COMPLETION_STAGES, computeLiveliness } from '../models/Project.js';
import Vote from '../models/Vote.js';
import User from '../models/User.js';
import Settings from '../models/Settings.js';
import { notifyProjectSubmitted, recordVotingMilestone } from '../services/mattermost.js';
import { refreshProjectStats } from '../services/github.js';
import { logActivity } from '../services/activityLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

All `exports.foo = ...` → `export const foo = ...`

### controllers/admin.js

Top-level imports — replace all `require()` at lines 4–25 with:
```js
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import lusca from 'lusca';
import mongoose from 'mongoose';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImageMagicBytes } from '../services/imageTypeCheck.js';
import { Project, CATEGORIES, CANONICAL_TEAMS, AI_TOOLS, TECH_STACK_DEFAULTS, computeLiveliness } from '../models/Project.js';
import Vote from '../models/Vote.js';
import User from '../models/User.js';
import Settings from '../models/Settings.js';
import ActivityLog from '../models/ActivityLog.js';
import { notifyFinalistPromoted } from '../services/mattermost.js';
import { logActivity } from '../services/activityLog.js';
import { loadDefaults } from '../scripts/seed-defaults.js';
import { runSummary } from '../scripts/daily-summary.js';
import { syncVizContent } from '../services/viz-sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

Replace the 4 lazy `require()` calls inside functions:
- Line 391: `try { require('../app').bustBannerCache(); } catch { /* non-fatal */ }`
  → `try { const { bustBannerCache } = await import('../app.js'); bustBannerCache(); } catch { /* non-fatal */ }`
- Line 746: `const { loadDefaults } = require('../scripts/seed-defaults');` → remove (already top-level import)
- Line 786: `const mongoose = require('mongoose');` → remove (already top-level import)
- Line 862: `const { runSummary } = require('../scripts/daily-summary');` → remove (already top-level import)
- Line 951: `const { syncVizContent } = require('../services/viz-sync');` → remove (already top-level import)

All `exports.foo = ...` → `export const foo = ...`

`exports.ALLOWED_STATUSES = ALLOWED_STATUSES` → `export { ALLOWED_STATUSES }` (or change to `export const ALLOWED_STATUSES = ...` in the original declaration)

- [ ] **Step 1: Apply controllers/project.js changes**
- [ ] **Step 2: Apply controllers/admin.js changes**

- [ ] **Step 3: Commit**

```bash
git add controllers/project.js controllers/admin.js
git commit -m "refactor: convert project and admin controllers to ESM"
```

---

## Task 11: Convert app.js

**Files:**
- Modify: `app.js`

app.js has the most complex conversion. Changes:

**1. Replace all top-level `require()` with `import`:**

```js
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import session from 'express-session';
import errorHandler from 'errorhandler';
import lusca from 'lusca';
import helmet from 'helmet';
import { MongoStore } from 'connect-mongo';
import mongoose from 'mongoose';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { flash } from './config/flash.js';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import * as homeController from './controllers/home.js';
import * as authController from './controllers/auth.js';
import { resolveAuthMode, resolveLoginUrl } from './controllers/auth.js';
import * as projectController from './controllers/project.js';
import * as visualizeController from './controllers/visualize.js';
import * as adminController from './controllers/admin.js';
import * as kioskController from './controllers/kiosk.js';
import './config/passport.js';
import { initOidcClient } from './config/oidc.js';
import { syncVizContent, checkTokenAccess } from './services/viz-sync.js';
import { seedDefaults } from './scripts/seed-defaults.js';
import { Project } from './models/Project.js';
import Vote from './models/Vote.js';
import Settings from './models/Settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

**2. Replace `ASSET_VERSION` inline `require('node:child_process')`:**

```js
const ASSET_VERSION = (() => {
  try {
    return execSync('git rev-parse --short=8 HEAD', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return Date.now().toString(36);
  }
})();
```

**3. Replace `require('./config/passport')` (side-effect import — already handled as `import './config/passport.js'` above)**

**4. Replace cron blocks with `await import()` (using top-level await):**

```js
if (process.env.SUMMARY_CRON !== 'disabled') {
  const { default: cron } = await import('node-cron');
  const { runSummary } = await import('./scripts/daily-summary.js');
  const cronExpr = process.env.SUMMARY_CRON || '0 * * * *';
  cron.schedule(cronExpr, () => {
    runSummary(process.env.BASE_URL || 'http://localhost:8080').catch((err) => {
      console.error('Daily summary cron failed:', err.message);
    });
  });
  console.log(`Daily summary scheduled: ${cronExpr} (UTC)`);
}

// (unchanged: checkTokenAccess / syncVizContent calls using top-level imports)

if (process.env.VIZ_SYNC_CRON !== 'disabled') {
  const { default: vizCron } = await import('node-cron');
  const vizCronExpr = process.env.VIZ_SYNC_CRON || '5 * * * *';
  vizCron.schedule(vizCronExpr, () => {
    syncVizContent().catch((err) => {
      console.error('Viz sync cron failed:', err.message);
    });
  });
  console.log(`Viz sync scheduled: ${vizCronExpr} (UTC)`);
}
```

**5. Replace lazy `require()` in `backfillTotalStars()`:**

Remove lines `const { Project } = require('./models/Project')` and `const Vote = require('./models/Vote')` — both are now top-level imports.

**6. Replace lazy `require('./scripts/seed-defaults').seedDefaults()` in `.then()`:**

```js
.then(async () => {
  await seedDefaults();          // top-level import; no require() needed
  await backfillTotalStars();
})
```

**7. Replace `require('mongoose')` inside `app.param`:**

```js
app.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {   // use top-level import — no require() needed
    ...
  }
  next();
});
```

**8. Replace lazy `require('./controllers/admin')` and `require('./controllers/kiosk')`:**

Both are top-level imports above. Remove the inline `require()` calls and use the imported `adminController` and `kioskController` directly.

**9. Replace `module.exports` at bottom:**

```js
export default app;
export const bustBannerCache = () => { _bannerCache.expiresAt = 0; };
```

**10. Replace `require.main === module` check:**

```js
if (process.argv[1] === __filename) {
  (async () => {
    if (resolveAuthMode() === 'oidc') {
      await initOidcClient();
    }
    app.listen(app.get('port'), app.get('host'), () => {
      console.log(`MegaDemo.ai running on http://${app.get('host')}:${app.get('port')}`);
      console.log(`Uploads directory: ${UPLOADS_DIR}${process.env.UPLOADS_DIR ? '' : ' (fallback — UPLOADS_DIR not set)'}`);
    });
  })().catch((err) => {
    console.error('FATAL: Server startup failed:', err.message);
    process.exit(1);
  });
}
```

- [ ] **Step 1: Apply all app.js changes described above**

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "refactor: convert app.js to ESM (top-level await for cron, __dirname shim)"
```

---

## Task 12: Convert scripts/

**Files:**
- Modify: `scripts/seed-defaults.js`, `scripts/daily-summary.js`, `scripts/dev-start.js`, `scripts/seed-admin.js`, `scripts/clear-sessions.js`, `scripts/backfill-avatars.js`

### scripts/seed-defaults.js

```js
import path from 'node:path';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Settings from '../models/Settings.js';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULTS_PATH = path.join(__dirname, '../config/defaults.yml');

// ... (loadDefaults, seedIfEmpty, seedDefaults unchanged) ...

export { seedDefaults, loadDefaults };

if (process.argv[1] === __filename) {
  try { process.loadEnvFile('.env'); } catch { /* .env optional */ }
  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo')
    .then(() => seedDefaults())
    .then(() => { console.log('Defaults seeded.'); process.exit(0); })
    .catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
}
```

### scripts/daily-summary.js

```js
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import Vote from '../models/Vote.js';
import { postHourlySummary } from '../services/mattermost.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// ... (runSummary function unchanged) ...

export { runSummary };

if (process.argv[1] === __filename) {
  try { process.loadEnvFile('.env'); } catch { /* .env optional */ }
  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo')
    .then(() => runSummary())
    .then(() => { console.log('Daily summary posted.'); process.exit(0); })
    .catch((err) => { console.error('Daily summary failed:', err.message); process.exit(1); });
}
```

### scripts/dev-start.js

```js
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';

// ... (all async logic unchanged) ...
```

Replace `const { MongoMemoryServer } = require('mongodb-memory-server')` and `const { spawn } = require('child_process')` with imports above.

### scripts/seed-admin.js

```js
import mongoose from 'mongoose';
import User from '../models/User.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// ... (env loading and user update logic unchanged) ...
```

Replace `const mongoose = require('mongoose')` and `const User = require('../models/User')` with imports.
Note: `seed-admin.js` doesn't have a `require.main === module` check — it runs unconditionally. Keep that pattern (it's standalone only).

### scripts/clear-sessions.js

```js
import mongoose from 'mongoose';

// Remove 'use strict'; — it's a no-op in ESM
// ... (all other logic unchanged) ...
```

Replace `const mongoose = require('mongoose')` with import. Remove `'use strict'`.

### scripts/backfill-avatars.js

```js
import https from 'node:https';
import http from 'node:http';
import qs from 'node:querystring';
import mongoose from 'mongoose';
import User from '../models/User.js';

// Remove 'use strict'; — it's a no-op in ESM
// ... (all helper functions and run() unchanged) ...
```

Replace the 5 `require()` calls at top with imports. Remove `'use strict'`.

- [ ] **Step 1: Apply all scripts/ changes**

- [ ] **Step 2: Commit**

```bash
git add scripts/
git commit -m "refactor: convert scripts to ESM"
```

---

## Task 13: Convert test files

**Files:**
- Modify: `tests/setup/db.js`
- Modify: `tests/config/oidc.test.js`
- Modify: `tests/controllers/auth.test.js`
- Modify: `tests/controllers/home.test.js`
- Modify: `tests/controllers/project.test.js` ← requires jest.unstable_mockModule
- Modify: `tests/controllers/admin.test.js` ← requires jest.unstable_mockModule
- Modify: `tests/models/Project.test.js`
- Modify: `tests/models/Settings.test.js`
- Modify: `tests/models/Vote.test.js`
- Modify: `tests/services/activityLog.test.js`
- Modify: `tests/services/imageTypeCheck.test.js`

### tests/setup/db.js

```js
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod;

export async function connect() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

export async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (!mongod) return;
  await mongod.stop();
}

export async function clearAll() {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
```

### tests/config/oidc.test.js

```js
import { initOidcClient } from '../../config/oidc.js';

describe('initOidcClient misconfiguration', () => {
  let savedAuthMode, savedIssuerUrl;

  beforeEach(() => {
    savedAuthMode  = process.env.AUTH_MODE;
    savedIssuerUrl = process.env.OIDC_ISSUER_URL;
  });
  afterEach(() => {
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
    if (savedIssuerUrl === undefined) delete process.env.OIDC_ISSUER_URL;
    else process.env.OIDC_ISSUER_URL = savedIssuerUrl;
  });

  it('throws when AUTH_MODE=oidc but OIDC_ISSUER_URL is not set', async () => {
    process.env.AUTH_MODE = 'oidc';
    delete process.env.OIDC_ISSUER_URL;
    await expect(initOidcClient()).rejects.toThrow(/OIDC_ISSUER_URL/);
  });

  it('returns early without throwing when AUTH_MODE is not oidc', async () => {
    process.env.AUTH_MODE = 'github';
    await expect(initOidcClient()).resolves.toBeUndefined();
  });
});
```

### tests/controllers/auth.test.js

```js
import { resolveAuthMode, resolveLoginUrl } from '../../controllers/auth.js';

describe('resolveAuthMode', () => {
  // ... (all test bodies unchanged) ...
});

describe('resolveLoginUrl', () => {
  // ... (all test bodies unchanged) ...
});
```

Replace `const { resolveAuthMode, resolveLoginUrl } = require('../../controllers/auth')` with the import above. No other changes.

### tests/controllers/home.test.js

```js
import { renderHeroDescription } from '../../controllers/home.js';

describe('renderHeroDescription', () => {
  // ... (all test bodies unchanged) ...
});
```

### tests/models/Project.test.js

```js
import db from '../setup/db.js';
import { Project } from '../../models/Project.js';
import User from '../../models/User.js';

// ... (all test bodies unchanged — beforeAll/afterAll/beforeEach/it) ...
```

### tests/models/Settings.test.js

```js
import db from '../setup/db.js';
import Settings from '../../models/Settings.js';

// ... (all test bodies unchanged) ...
```

### tests/models/Vote.test.js

```js
import mongoose from 'mongoose';
import db from '../setup/db.js';
import Vote from '../../models/Vote.js';

// ... (all test bodies unchanged) ...
```

### tests/services/activityLog.test.js

```js
import mongoose from 'mongoose';
import db from '../setup/db.js';
import ActivityLog from '../../models/ActivityLog.js';
import { logActivity } from '../../services/activityLog.js';

// ... (all test bodies unchanged) ...
```

### tests/services/imageTypeCheck.test.js

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyImageMagicBytes } from '../../services/imageTypeCheck.js';

// ... (all test bodies, helper functions, and Buffer constants unchanged) ...
```

### tests/controllers/project.test.js

This file uses `jest.mock()` for two modules. In Jest ESM, replace with `jest.unstable_mockModule()` and use top-level `await import()` after setting up mocks.

```js
// jest.unstable_mockModule must come before any import of modules that depend on the mocked ones
await jest.unstable_mockModule('../../services/mattermost.js', () => ({
  notifyProjectSubmitted: jest.fn(),
  recordVotingMilestone: jest.fn(),
}));
await jest.unstable_mockModule('../../services/github.js', () => ({
  refreshProjectStats: jest.fn(),
}));

// Dynamic imports — resolved AFTER mocks are registered
const { default: mongoose } = await import('mongoose');
const db = await import('../setup/db.js');
const { Project } = await import('../../models/Project.js');
const { default: Vote } = await import('../../models/Vote.js');
const { default: User } = await import('../../models/User.js');
const ctrl = await import('../../controllers/project.js');

// ─── helpers (unchanged) ─────────────────────────────────────────────────────
// ... (all helper functions and describe/it blocks unchanged,
//      except: `ctrl.functionName` is still valid since we imported the namespace) ...
```

Note: `ctrl` is now the module namespace object. If tests call `ctrl.create(...)`, `ctrl.update(...)` etc., they will work unchanged. If tests destructure exports, update accordingly.

Also update `db.*` calls from `db.connect()` to `db.connect()` — since db is now an ES module namespace with named exports, the call is `db.connect()` which is the same. No change needed in test bodies.

### tests/controllers/admin.test.js

Same pattern as project.test.js:

```js
await jest.unstable_mockModule('../../services/mattermost.js', () => ({
  notifyFinalistPromoted: jest.fn(),
}));

const { default: mongoose } = await import('mongoose');
const db = await import('../setup/db.js');
const { Project } = await import('../../models/Project.js');
const { default: User } = await import('../../models/User.js');
const { default: Settings } = await import('../../models/Settings.js');
const { seedDefaults, loadDefaults } = await import('../../scripts/seed-defaults.js');
const admin = await import('../../controllers/admin.js');

// Destructure what tests use:
const { ALLOWED_STATUSES, CSV_FIELD_REGISTRY, sanitizeCsvCell } = admin;
const adminCtrl = admin;

// ... (all describe/it blocks unchanged, using the aliases above) ...
```

- [ ] **Step 1: Apply tests/setup/db.js changes**

- [ ] **Step 2: Apply all simple test file changes (oidc, auth, home, models, services)**

- [ ] **Step 3: Apply tests/controllers/project.test.js changes (jest.unstable_mockModule pattern)**

- [ ] **Step 4: Apply tests/controllers/admin.test.js changes (jest.unstable_mockModule pattern)**

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "refactor: convert test files to ESM (jest.unstable_mockModule for mocked controllers)"
```

---

## Task 14: Run tests and fix failures

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: `Tests: 184 passed, 184 total`

If tests fail:
- Syntax errors → check all `.js` extensions on relative imports
- `Cannot find module` → check file exists + relative path + `.js` extension
- `is not a function` / `undefined` → check named vs default export mismatch
- OIDC test failures → check `getOidcConfig` is exported from `config/oidc.js`
- Admin test failures → check `ALLOWED_STATUSES`, `CSV_FIELD_REGISTRY`, `sanitizeCsvCell` are all named exports

- [ ] **Step 2: Fix any failures, re-run until all 184 pass**

- [ ] **Step 3: Commit fixes (if any)**

```bash
git add -A
git commit -m "fix: correct ESM import/export issues found during test run"
```

---

## Task 15: Fix lint errors

- [ ] **Step 1: Run lint**

```bash
npm run lint-check
```

- [ ] **Step 2: Fix any ESLint errors**

Common ESLint issues after ESM conversion:
- `no-undef` for `__dirname` / `__filename` if shim was missed → add shim
- `no-unused-vars` → remove any dead imports left over from conversion
- Any `require()` calls remaining → convert to `import`

- [ ] **Step 3: Re-run lint to confirm zero errors**

```bash
npm run lint-check
```

Expected: no output (zero errors)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: resolve ESLint errors after ESM conversion"
```

---

## Task 16: Update DESIGN.md

**Files:**
- Modify: `DESIGN.md`

Update the following sections:
- **Module system**: Change "CommonJS (require/module.exports)" to "ES Modules (import/export)"
- **Dependencies**: Update openid-client to v6, marked to v18, file-type to v22
- **jest.config**: Note rename to `jest.config.cjs`

- [ ] **Step 1: Update DESIGN.md with the module system and dependency changes**

- [ ] **Step 2: Commit**

```bash
git add DESIGN.md
git commit -m "docs: update DESIGN.md for ESM migration and dependency upgrades"
```

---

## Task 17: Final verification and merge

- [ ] **Step 1: Final clean run**

```bash
npm run lint-check && npm test
```

Expected: lint clean, `Tests: 184 passed, 184 total`

- [ ] **Step 2: Merge to main**

```bash
cd /path/to/megademo.ai  # back to the main worktree
git merge feat/esm-migration --no-ff -m "feat: migrate codebase to ESM, upgrade openid-client v6 / marked v18 / file-type v22

- Add \"type\": \"module\" to package.json
- Convert all 26 source files and 11 test files from CJS to ESM
- Rename jest.config.js → jest.config.cjs
- Rewrite config/oidc.js for openid-client v6 discovery() API
- Rewrite controllers/auth.js OIDC handlers for v6 named-function API
- Upgrade marked ^12 → ^18, openid-client ^5 → ^6, file-type ^21 → ^22
- Use top-level await in app.js for conditional cron imports

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 3: Clean up worktree**

```bash
git worktree remove .worktrees/esm-migration
```
