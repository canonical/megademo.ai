/**
 * Daily stats summary — gathers stats from MongoDB and posts to Mattermost.
 * Called by the node-cron scheduler in app.js, or run standalone:
 *   node scripts/daily-summary.js
 */
const mongoose = require('mongoose');
const { Project } = require('../models/Project');
const Vote = require('../models/Vote');
const { postDailySummary } = require('../services/mattermost');

async function runSummary(baseUrl) {
  const [
    totalProjects,
    activeProjects,
    finalists,
    totalVotes,
    teamAgg,
    topProjects,
  ] = await Promise.all([
    Project.countDocuments(),
    Project.countDocuments({ status: { $in: ['submitted', 'finalist'] } }),
    Project.countDocuments({ status: 'finalist' }),
    Vote.countDocuments(),
    Project.aggregate([
      { $match: { canonicalTeam: { $exists: true, $ne: null } } },
      { $group: { _id: '$canonicalTeam' } },
      { $count: 'total' },
    ]),
    Project.find({ status: { $in: ['submitted', 'finalist'] }, voteCount: { $gt: 0 } })
      .sort({ avgRating: -1, voteCount: -1 })
      .limit(3)
      .lean(),
  ]);

  const url = (baseUrl || process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');

  await postDailySummary({
    projects:    totalProjects,
    submitted:   activeProjects,
    finalists,
    teams:       teamAgg[0]?.total ?? 0,
    votes:       totalVotes,
    topProjects: topProjects.filter((p) => p.slug).map((p) => ({
      title:     p.title,
      url:       `${url}/projects/${p.slug}`,
      avgRating: p.avgRating,
      voteCount: p.voteCount,
    })),
  });
}

// Allow standalone execution
if (require.main === module) {
  try { process.loadEnvFile('.env'); } catch { /* .env optional */ }

  mongoose
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo')
    .then(() => runSummary())
    .then(() => { console.log('Daily summary posted.'); process.exit(0); })
    .catch((err) => { console.error('Daily summary failed:', err.message); process.exit(1); });
}

module.exports = { runSummary };
