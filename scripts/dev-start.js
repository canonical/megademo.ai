#!/usr/bin/env node
/**
 * Dev start: launches an in-memory MongoDB, sets MONGODB_URI, then starts app.js
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');

// Load .env before setting any fallbacks so user values take precedence.
try {
  process.loadEnvFile('.env');
} catch {
  // .env not present — environment must be set externally (CI, production, etc.)
}

(async () => {
  let mongod;
  try {
    mongod = await MongoMemoryServer.create();
  } catch (err) {
    console.error('[dev-start] Failed to start in-memory MongoDB:', err.message);
    process.exit(1);
  }
  const uri = mongod.getUri();
  console.log('[dev-start] MongoDB in-memory:', uri);

  process.env.MONGODB_URI = uri;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
  process.env.BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
  // GitHub OAuth placeholders — login won't work without real creds,
  // but all non-auth routes will function normally.
  process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'dev-placeholder';
  process.env.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'dev-placeholder';

  const app = spawn('node', ['app.js'], { stdio: 'inherit', env: process.env });

  const shutdown = async () => {
    app.kill();
    try {
      await mongod.stop();
    } catch (err) {
      console.error('[dev-start] Error stopping MongoDB:', err.message);
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error('[dev-start] Startup failed:', err.message);
  process.exit(1);
});
