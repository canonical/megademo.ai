# ESM Migration Design

**Date:** 2026-05-22  
**Status:** Approved  
**Scope:** Convert the entire megademo.ai codebase from CommonJS (CJS) to ES Modules (ESM)

---

## Background

The Renovate bot has been blocked from upgrading three dependencies because they have dropped CJS support:

- `openid-client` v6 — ESM-only, with a completely rewritten API
- `marked` v18 — ESM-only (v12 ships a CJS shim, v18 does not)
- `file-type` v22 — ESM-only (v21 is also ESM-only but its `exports` field provides a CJS fallback that currently works)

PR #28 (Renovate: bump `openid-client` to v6) was reverted because the codebase cannot consume ESM-only packages. This migration unblocks all three packages and eliminates the revert/downgrade pattern going forward.

---

## Approach

Full ESM conversion: add `"type": "module"` to `package.json`, convert all source files from `require`/`module.exports` to `import`/`export`, upgrade the three blocked packages, and rewrite the `openid-client` integration for the v6 API.

No dual-mode wrapper or intermediate CJS shim layer is introduced. The codebase becomes pure ESM.

---

## Module System Change

Add `"type": "module"` to `package.json`. This makes every `.js` file an ES module by default.

One file cannot be `.js` under `"type": "module"`: `jest.config.js`. Jest's config loader requires a CJS file when the package declares `"type": "module"`. It is renamed to `jest.config.cjs`. No content changes are needed — the rename alone fixes Jest's config discovery.

---

## Source File Conversion

### Scope

26 files across the project use `require()` or `module.exports`/`exports.*`:

- `app.js`
- `config/oidc.js`, `config/passport.js`
- `controllers/admin.js`, `controllers/auth.js`, `controllers/home.js`, `controllers/project.js`
- `models/Project.js`, `models/Settings.js`, `models/Vote.js` (and any other models)
- `services/github.js`, `services/imageTypeCheck.js`, `services/mattermost.js`, `services/viz-sync.js`
- `scripts/backfill-avatars.js`, `scripts/daily-summary.js`, `scripts/seed-defaults.js`
- `middleware/` files
- `routes/` files
- `tests/` helpers and setup files

### Mechanical transformation

- `const x = require('y')` → `import x from 'y'`
- `const { a, b } = require('y')` → `import { a, b } from 'y'`
- `module.exports = x` → `export default x`
- `exports.foo = ...` → `export function foo ...` or `export const foo = ...`
- Node built-in imports (`path`, `fs`, `crypto`, `child_process`) gain the `node:` prefix if not already present (already used in `app.js`)

### Lazy `require()` calls in `app.js`

`app.js` contains approximately 10 `require()` calls inside middleware functions or conditional blocks. These are hoisted to top-level `import` statements with one exception:

- `node-cron` and `scripts/daily-summary.js` are loaded inside a block guarded by an environment variable (`ENABLE_CRON` or similar). These two become `await import()` calls to preserve the conditional side-effect behaviour and avoid the cron scheduler starting during tests.
- All other lazy requires (Settings, Project, Vote, seed-defaults, mongoose, child_process) are hoisted to top-level imports.

### Relative import paths

ESM requires explicit file extensions on relative imports. Every `./foo` or `../foo` relative import gains a `.js` extension: `import x from './foo.js'`.

---

## openid-client v6 Rewrite

### `config/oidc.js`

The module currently exports `initOidcClient()` (which calls `Issuer.discover()` and constructs a `Client`) and `getClient()` (which returns the cached client).

In v6, `Issuer` and `Client` are replaced by a `Configuration` object returned by `discovery()`. The module is rewritten to:

1. Call `discovery(serverUrl, clientId, clientSecret)` once at startup to obtain a `Configuration`
2. Export `getOidcConfig()` returning the cached `Configuration`
3. No `initOidcClient` concept — `discovery()` is called directly during app startup in `app.js`

### `controllers/auth.js`

OIDC handlers are rewritten using the v6 named-function API:

| v5 usage | v6 replacement |
|---|---|
| `generators.state()` | `randomState()` |
| `generators.nonce()` | `randomNonce()` |
| `generators.codeVerifier()` | `randomPKCECodeVerifier()` |
| `generators.codeChallenge(v)` | `calculatePKCECodeChallenge(v)` |
| `client.authorizationUrl({...})` | `buildAuthorizationUrl(config, params)` |
| `client.callbackParams(req)` + `client.callback(...)` | `authorizationCodeGrant(config, currentUrl, checks)` |
| `tokenSet.claims()` | `grant.claims()` |

Session storage of state/nonce/code_verifier keys is unchanged. The PKCE flow remains intact.

---

## Package Upgrades

The following packages are upgraded as part of this migration:

| Package | Current | Target | Reason |
|---|---|---|---|
| `openid-client` | `^5.7.1` | `^6.x` (latest) | ESM-only; API rewrite required |
| `marked` | `^12.0.0` | `^18.x` (latest) | ESM-only in v18; no API changes affecting this codebase |
| `file-type` | `^21.x` | `^22.x` (latest) | ESM-only; no API changes |

`renovate.json` requires no changes. Once the codebase is ESM, Renovate will auto-update all three packages normally.

---

## Testing

Jest v29 with `--experimental-vm-modules` already supports ESM test execution (the flag is set in `package.json`'s `test` script). The rename of `jest.config.js` → `jest.config.cjs` is the only Jest configuration change needed.

**Verification gate:** all 184 existing tests must pass before the migration is considered complete. No tests are modified to accommodate the migration; if a test fails, the source code is fixed.

`npm run lint-check` must also pass with zero ESLint errors.

---

## Execution Order

1. Create worktree on branch `feat/esm-migration`
2. Upgrade `openid-client`, `marked`, and `file-type` in `package.json`; run `npm install`
3. Add `"type": "module"` to `package.json`
4. Rename `jest.config.js` → `jest.config.cjs`
5. Convert all 26 source files (mechanical: require→import, module.exports→export, add `.js` extensions to relative imports)
6. Rewrite `config/oidc.js` for openid-client v6 `discovery()` / `Configuration` API
7. Rewrite `controllers/auth.js` OIDC handlers for v6 named-function API
8. Handle lazy requires in `app.js` (hoist to top-level; keep `node-cron` and daily-summary as `await import()`)
9. Run `npm run lint-check && npm test`; iterate until both pass with no errors
10. Update `DESIGN.md` (new dependencies, module system, file listing)
11. Commit and merge to `main`

---

## Out of Scope

- Splitting `controllers/admin.js` or `controllers/project.js` into smaller files (both are ~970 lines; a separate refactoring effort)
- Adding new tests or changing test coverage
- Changing any user-facing behaviour
- Modifying `renovate.json`
