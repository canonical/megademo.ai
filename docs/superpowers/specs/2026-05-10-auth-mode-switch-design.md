# Auth Mode Switch Design

**Date:** 2026-05-10
**Status:** Approved

---

## Problem

The site currently uses two auth strategies with an implicit switch:

- OIDC (Canonical Identity Platform) — active when `OIDC_ISSUER_URL` is set; gates the entire site.
- GitHub OAuth — active by default (when `OIDC_ISSUER_URL` is absent); only individual routes are protected.

The goals of this change are:

1. Introduce an **explicit `AUTH_MODE` env var** to select the active auth strategy.
2. Make the **site-wide authentication gate active in both modes**, so the entire app (excluding `/auth/*`, `/health`, and static assets) requires login.
3. GitHub OAuth is the **default** (`AUTH_MODE` unset or `AUTH_MODE=github`).
4. **Preserve existing sessions**: no migration or forced re-login.

---

## Auth Mode Selection

A single authoritative helper `resolveAuthMode()` (exported from `controllers/auth.js`) reads `process.env.AUTH_MODE` at call time.

| `AUTH_MODE` value | Effective mode |
|---|---|
| unset or `github` | GitHub OAuth |
| `oidc` | Canonical Identity Platform (Hydra/Ory) |

When `AUTH_MODE=oidc`, the following vars are **required** and validated at startup:
- `OIDC_ISSUER_URL`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `BASE_URL`

When `AUTH_MODE=github` (or unset), `OIDC_ISSUER_URL` is **ignored** even if set. The OIDC client is never initialised.

---

## Site-Wide Authentication Gate

The gate middleware in `app.js` runs in production for **both auth modes** (previously only for OIDC):

```
Condition: process.env.NODE_ENV === 'production'
Exempt paths: /auth/*, /health
Redirect target: resolveLoginUrl() → /auth/github or /auth/oidc
```

In development, the gate does **not** activate. The dev login bypass (`/auth/dev-login`) continues to work unchanged.

Static assets (`/uploads`, `/public`) are served before the gate middleware and remain publicly accessible (CSS, images, JS).

---

## GitHub OAuth App Setup

The `canonical` org must register a GitHub OAuth App:

1. An org admin navigates to `https://github.com/organizations/canonical/settings/applications` → **New OAuth App**
2. Fill in:
   - **Application name**: MegaDemo.ai
   - **Homepage URL**: `https://megademo.ai`
   - **Authorization callback URL**: `https://megademo.ai/auth/github/callback`
3. Copy **Client ID** and generate a **Client Secret**
4. Set in Render: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

**Org membership verification** uses three fallback methods (already implemented in `config/passport.js`):
1. `/user/memberships/orgs/canonical` — most precise
2. `/user/orgs` — list-based
3. `@canonical.com` email domain — enabled via `ALLOW_CANONICAL_EMAIL_FALLBACK=true`

If the `canonical` org has OAuth App access restrictions enabled, an org admin must approve the app at `https://github.com/organizations/canonical/settings/oauth_application_policy`, or `ALLOW_CANONICAL_EMAIL_FALLBACK=true` must be set as a fallback.

---

## Session Continuity

No migration is required. Existing sessions are fully preserved:

- MongoDB sessions store the user's MongoDB `_id` (not auth-provider data).
- `deserializeUser` calls `User.findById(id)` — provider-agnostic.
- When an OIDC-authenticated user's session expires and they re-authenticate via GitHub OAuth, the GitHub strategy matches them by email (`User.findOne({ email })`), links their GitHub ID, and preserves all user data (role, projects, etc.).
- No users are logged out by this change.

---

## Files Changed

| File | Change |
|---|---|
| `controllers/auth.js` | `resolveAuthMode()` helper added and exported; `resolveLoginUrl()` updated to use it; exported for use in `app.js` |
| `app.js` | Site gate condition updated from `if (OIDC_ISSUER_URL)` to `if (production)`; gate redirect uses `resolveLoginUrl()`; OIDC init guarded by `resolveAuthMode() === 'oidc'`; `loginUrl` local updated |
| `config/oidc.js` | `initOidcClient()` logs a warning if called when `AUTH_MODE !== 'oidc'` (defensive; no functional change) |
| `.env.example` | Document `AUTH_MODE` |
| `DESIGN.md` | Update Authentication section to describe `AUTH_MODE` |
| `README.md` | Update Authentication section; update Requirements line |
| `content/get-started.md` | Remove "Projects are public — no sign-in needed" line (no longer true) |

**No changes to:** `config/passport.js`, any model, any view, any other controller.

---

## Environment Variables Summary

```
AUTH_MODE=github           # 'github' (default) or 'oidc'

# Required for AUTH_MODE=github:
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ALLOW_CANONICAL_EMAIL_FALLBACK=true  # optional fallback for orgs with OAuth restrictions

# Required for AUTH_MODE=oidc (ignored when AUTH_MODE=github):
OIDC_ISSUER_URL=...
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
BASE_URL=https://megademo.ai
```
