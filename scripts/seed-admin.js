/**
 * Seed script — promote a user to admin
 * Usage: ADMIN_EMAIL=your@canonical.com node scripts/seed-admin.js
 */
const mongoose = require('mongoose');
const User = require('../models/User');

// Load .env first so ADMIN_EMAIL and MONGODB_URI can come from it
try {
  process.loadEnvFile('.env');
} catch { /* .env file not found — env vars must be set directly */ }

const email = process.env.ADMIN_EMAIL;
if (!email) {
  console.error('Set ADMIN_EMAIL env var');
  process.exit(1);
}

mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo')
  .then(async () => {
    const user = await User.findOneAndUpdate(
      { email },
      { role: 'admin' },
      { returnDocument: 'after', upsert: false }
    );
    if (!user) {
      console.error(`No user found with email ${email}. They must log in first.`);
      process.exit(1);
    }
    console.log(`${user.email} is now an admin.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
