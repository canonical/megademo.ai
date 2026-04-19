/**
 * seed-defaults.js — populate configurable lists from config/defaults.yml
 * if they have not yet been set in the database.
 *
 * Idempotent: skips any list that already has entries so admin edits are
 * never overwritten. Safe to call on every startup.
 *
 * Can also be run standalone:
 *   node scripts/seed-defaults.js
 */
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const Settings = require('../models/Settings');

const DEFAULTS_PATH = path.join(__dirname, '../config/defaults.yml');

function loadDefaults() {
  const raw = fs.readFileSync(DEFAULTS_PATH, 'utf8');
  return yaml.load(raw);
}

/**
 * Seed a single Settings key from YAML if the DB value is empty/missing.
 * @param {string} key    - Settings key (e.g. 'customTeams')
 * @param {string[]} values - default array from YAML
 */
async function seedIfEmpty(key, values) {
  const existing = await Settings.get(key);
  if (Array.isArray(existing) && existing.length > 0) return; // already set — skip
  await Settings.set(key, values);
}

async function seedDefaults() {
  const defaults = loadDefaults();
  await Promise.all([
    seedIfEmpty('customTeams',    defaults.teams     || []),
    seedIfEmpty('customAiTools',  defaults.ai_tools  || []),
    seedIfEmpty('customTechStack', defaults.tech_stack || []),
  ]);
}

module.exports = { seedDefaults, loadDefaults };

// Allow standalone execution
if (require.main === module) {
  const mongoose = require('mongoose');
  try { process.loadEnvFile('.env'); } catch { /* .env optional */ }

  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo')
    .then(() => seedDefaults())
    .then(() => { console.log('Defaults seeded.'); process.exit(0); })
    .catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
}
