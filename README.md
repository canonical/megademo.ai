# MegaDemo.ai

[![CI](https://github.com/canonical/megademo.ai/actions/workflows/ci.yml/badge.svg)](https://github.com/canonical/megademo.ai/actions/workflows/ci.yml)

Internal Canonical AI Hackathon showcase platform — register projects, vote, and compete for a spot at the MegaDemo.

## For participants

Sign in with your `@canonical.com` GitHub account, register your project, and let the world judge it.

**[→ Get started guide](content/get-started.md)**

> Live site: **[megademo.ai](https://megademo.ai)**

---

## For developers

```bash
cp .env.example .env
# Edit .env — see Authentication section below for which vars to set
npm install
npm start
```

For local development (in-memory MongoDB, no Atlas needed):
```bash
npm run dev
```

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

## Deployment (Render.com)

1. Connect `canonical/megademo.ai` GitHub repo in Render dashboard
2. `render.yaml` is auto-detected — it sets `plan: starter`, region: frankfurt, build + start commands
3. Add secrets in Render dashboard (not in `render.yaml`): `MONGODB_URI`, `SESSION_SECRET`, auth credentials
4. Custom domain: add `megademo.ai` in Render settings, update DNS CNAME

## Admin Setup

First user to log in gets `participant` role. Promote to admin:
```bash
ADMIN_EMAIL=your@canonical.com node scripts/seed-admin.js
```

Admins can then promote/demote other users via the **Admin → Users** page.

## Development & CI

```bash
npm run lint-check   # ESLint — must be zero errors before committing
npm test             # Jest (84 tests) — must all pass before committing
npm run lint         # ESLint with --fix (auto-fixes what it can)
```

A **husky pre-commit hook** (`.husky/pre-commit`) runs both checks automatically before every `git commit`. The hook mirrors the GitHub Actions CI steps exactly — if it passes locally, CI will pass.

### Load testing

```bash
# Against local dev server
npm run load-test

# Against production
BASE_URL=https://megademo.ai npm run load-test

# Generate HTML report
npx artillery run scripts/load-test.yml --output results.json && npx artillery report results.json
```

See [DESIGN.md § Performance baseline](DESIGN.md) for capacity estimates and upgrade thresholds.

## Environment Variables

See `.env.example` for full reference with explanations.

## Architecture

See [DESIGN.md](DESIGN.md) for a full breakdown of the stack, directory layout, authentication modes, key design decisions, and data flows.

## License

[GPL-3.0](LICENSE) — all dependencies use MIT, Apache 2.0, ISC, or compatible licenses.

