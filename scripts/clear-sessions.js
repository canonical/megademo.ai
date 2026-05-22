/**
 * One-off fallback: force re-login by clearing all sessions
 * ----------------------------------------------------------
 * Use this if scripts/backfill-avatars.js fails because the OIDC provider
 * does not support client-credentials / SCIM.
 *
 * Effect: all currently logged-in users are signed out immediately.
 * On their next visit they go through the OIDC flow, and the callback
 * stores their picture URL automatically (fix deployed in c41ce3e).
 *
 * Usage (run once from the repo root, with prod env vars set):
 *   node scripts/clear-sessions.js
 */

import mongoose from 'mongoose';

try { process.loadEnvFile('.env'); } catch { /* prod env vars set directly */ }

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo';

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    const db      = mongoose.connection.db;
    const result  = await db.collection('sessions').deleteMany({});
    console.log(`Cleared ${result.deletedCount} session(s). All users will be asked to log in again.`);
    await mongoose.disconnect();
  })
  .catch((err) => { console.error(err); process.exit(1); });
