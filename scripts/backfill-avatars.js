/**
 * One-off script: backfill missing OIDC avatars via SCIM 2.0
 * ----------------------------------------------------------------
 * Canonical IAM (iam.red.canonical.com) exposes a SCIM endpoint that the
 * OIDC client can query using a client-credentials token.
 *
 * This script:
 *  1. Discovers the OIDC issuer's SCIM endpoint
 *  2. Obtains a client-credentials access token
 *  3. Looks up each user with a missing picture by email via SCIM
 *  4. Writes the returned photo URL back to MongoDB
 *
 * If the provider does not support client-credentials or SCIM, it will print
 * a clear error — run scripts/clear-sessions.js instead (see that file).
 *
 * Usage (run once from the repo root, with prod env vars set):
 *   node scripts/backfill-avatars.js
 *
 * Dry-run (prints what would change, writes nothing):
 *   DRY_RUN=1 node scripts/backfill-avatars.js
 */
'use strict';

const https   = require('node:https');
const http    = require('node:http');
const qs      = require('node:querystring');
const mongoose = require('mongoose');
const User    = require('../models/User');

try { process.loadEnvFile('.env'); } catch { /* prod env vars set directly */ }

const ISSUER        = process.env.OIDC_ISSUER_URL;
const CLIENT_ID     = process.env.OIDC_CLIENT_ID;
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const DRY_RUN       = !!process.env.DRY_RUN;
const MONGO_URI     = process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo';

if (!ISSUER || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('OIDC_ISSUER_URL, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET must be set.');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    }).on('error', reject);
  });
}

function post(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof payload === 'string' ? payload : qs.stringify(payload);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getWithToken(url, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    mod.get({
      hostname: parsed.hostname, port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    }).on('error', reject);
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function run() {
  // 1. OIDC discovery
  console.log(`Fetching OIDC discovery document from ${ISSUER} …`);
  const discovery = await get(`${ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (discovery.status !== 200 || !discovery.body.token_endpoint) {
    console.error('Failed to fetch OIDC discovery document:', discovery.status, discovery.body);
    process.exit(1);
  }
  const tokenEndpoint = discovery.body.token_endpoint;
  console.log(`  token_endpoint: ${tokenEndpoint}`);

  // SCIM endpoint: try common locations (not in discovery, but standardised paths)
  const scimBase = `${ISSUER.replace(/\/$/, '')}/scim/v2`;

  // 2. Client-credentials token (client_secret_basic: credentials in Authorization header)
  console.log('Requesting client-credentials token …');
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const tokenRes = await post(tokenEndpoint, {
    grant_type: 'client_credentials',
    scope: 'openid profile',
  }, { Authorization: `Basic ${basicAuth}` });
  if (tokenRes.status !== 200 || !tokenRes.body.access_token) {
    console.error(`client_credentials grant failed (HTTP ${tokenRes.status}).`);
    console.error('The OIDC client may not have client_credentials permission.');
    console.error('→ Use scripts/clear-sessions.js as the fallback approach.');
    console.error(tokenRes.body);
    process.exit(1);
  }
  const token = tokenRes.body.access_token;
  console.log('  Got access token.');

  // 3. Find users with missing picture in MongoDB
  await mongoose.connect(MONGO_URI);
  const users = await User.find({ $or: [{ 'profile.picture': { $exists: false } }, { 'profile.picture': '' }] });
  console.log(`\nFound ${users.length} user(s) with missing picture.`);
  if (users.length === 0) { await mongoose.disconnect(); return; }

  // 4. Look up each user via SCIM (filter by email)
  let updated = 0;
  let notFound = 0;
  for (const user of users) {
    const safeEmail = user.email.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const filter = encodeURIComponent(`userName eq "${safeEmail}" or emails.value eq "${safeEmail}"`);
    const scimRes = await getWithToken(`${scimBase}/Users?filter=${filter}`, token);

    if (scimRes.status !== 200) {
      console.warn(`  SCIM lookup failed for ${user.email} (HTTP ${scimRes.status}) — skipping.`);
      if (scimRes.status === 404 || scimRes.status === 403) {
        console.error('  SCIM endpoint not available or not authorised.');
        console.error('  → Use scripts/clear-sessions.js as the fallback approach.');
        await mongoose.disconnect();
        process.exit(1);
      }
      notFound++;
      continue;
    }

    const resources = scimRes.body.Resources || scimRes.body.resources || [];
    const scimUser  = resources[0];
    if (!scimUser) { console.log(`  ${user.email}: not found in SCIM`); notFound++; continue; }

    // SCIM photo attribute: photos[type=photo].value
    const photos = scimUser.photos || [];
    const photo  = (photos.find((p) => p.type === 'photo') || photos[0] || {}).value;
    if (!photo) { console.log(`  ${user.email}: no photo in SCIM`); notFound++; continue; }

    console.log(`  ${user.email}: ${photo}${DRY_RUN ? ' [dry run]' : ''}`);
    if (!DRY_RUN) {
      user.profile         = user.profile || {};
      user.profile.picture = photo;
      await user.save();
      updated++;
    }
  }

  await mongoose.disconnect();

  console.log(`\nDone. Updated: ${updated}  Not found / no photo: ${notFound}`);
  if (DRY_RUN) console.log('(dry run — no changes written)');
}

run().catch((err) => { console.error(err); process.exit(1); });
