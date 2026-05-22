/**
 * Daily stats summary — gathers stats from MongoDB and posts to Mattermost.
 * Called by the node-cron scheduler in app.js, or run standalone:
 *   node scripts/daily-summary.js
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import Vote from '../models/Vote.js';
import { postHourlySummary } from '../services/mattermost.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runSummary(baseUrl) {
  const [
    finalists,
    totalVotes,
    teamAgg,
    topProjects,
    perfectFives,
  ] = await Promise.all([
    Project.countDocuments({ status: 'finalist' }),
    Vote.countDocuments(),
    Project.aggregate([
      { $match: { canonicalTeam: { $exists: true, $ne: null } } },
      { $group: { _id: '$canonicalTeam' } },
      { $count: 'total' },
    ]),
    Project.find({ status: { $in: ['submitted', 'finalist'] }, voteCount: { $gt: 0 } })
      .sort({ totalStars: -1 })
      .limit(3)
      .lean(),
    Project.find({ status: { $in: ['submitted', 'finalist'] }, avgRating: 5, voteCount: { $gt: 0 } })
      .sort({ voteCount: -1 })
      .limit(3)
      .lean(),
  ]);

  const url = (baseUrl || process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');

  const mapProject = (p) => ({
    title:      p.title,
    url:        `${url}/projects/${p.slug}`,
    avgRating:  p.avgRating,
    voteCount:  p.voteCount,
    totalStars: p.totalStars,
  });

  await postHourlySummary({
    finalists,
    teams:        teamAgg[0]?.total ?? 0,
    votes:        totalVotes,
    topProjects:  topProjects.filter((p) => p.slug).map(mapProject),
    perfectFives: perfectFives.filter((p) => p.slug).map(mapProject),
  });
}

// Allow standalone execution
if (process.argv[1] === __filename) {
  try { process.loadEnvFile('.env'); } catch { /* .env optional */ }

  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo')
    .then(() => runSummary())
    .then(() => { console.log('Daily summary posted.'); process.exit(0); })
    .catch((err) => { console.error('Daily summary failed:', err.message); process.exit(1); });
}

export { runSummary };
