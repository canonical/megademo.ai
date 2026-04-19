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
# Edit .env with your GitHub OAuth credentials and MongoDB URI
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
- GitHub OAuth App credentials (org restricted to `canonical`)

## GitHub OAuth Setup

1. Go to https://github.com/settings/developers and click **New OAuth App**
2. Set **Authorization callback URL** to `https://megademo.ai/auth/github/callback`
   (and `http://localhost:8080/auth/github/callback` for local dev)
3. Scopes required: `user:email`, `read:org`
4. Copy **Client ID** and **Client Secret** to `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`

> **Note:** If the `canonical` org has OAuth App restrictions enabled, an org owner must approve
> the app at `https://github.com/organizations/canonical/settings/oauth_application_policy`.

## Deployment (Render.com)

1. Connect `canonical/megademo.ai` GitHub repo in Render dashboard
2. Create a Web Service: Build Command `npm ci && npm run scss`, Start Command `node app.js`
3. Add MongoDB Atlas connection string as `MONGODB_URI` env var
4. Set all other env vars from `.env.example`
5. Custom domain: add `megademo.ai` in Render settings, update DNS CNAME

## Admin Setup

First user to log in gets `participant` role. Promote to admin:
```bash
ADMIN_EMAIL=your@canonical.com node scripts/seed-admin.js
```

Or directly in MongoDB:
```
db.users.updateOne({ email: 'your@canonical.com' }, { $set: { role: 'admin' } })
```

## Environment Variables

See `.env.example` for full reference.

## Architecture

See [DESIGN.md](DESIGN.md) for a full breakdown of the stack, directory layout, and key design decisions.

## License

[GPL-3.0](LICENSE) — all dependencies use MIT, Apache 2.0, ISC, or compatible licenses.
