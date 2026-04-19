/**
 * Home controller
 */
const { Project, computeLiveliness } = require('../models/Project');
const Settings = require('../models/Settings');

/**
 * GET /
 */
exports.index = async (req, res) => {
  try {
    const [newest, leaderboard, submissionDeadline, megademoDate, rawCategoryStats] = await Promise.all([
      Project.find({ status: { $in: ['submitted', 'finalist'] } })
        .sort({ createdAt: -1 })
        .limit(6)
        .populate('owner', 'profile.name profile.picture')
        .lean(),
      Project.find({ status: { $in: ['submitted', 'finalist'] }, voteCount: { $gte: 1 } })
        .sort({ avgRating: -1, voteCount: -1 })
        .limit(5)
        .populate('owner', 'profile.name')
        .lean(),
      Settings.get('submissionDeadline'),
      Settings.get('megademoDate'),
      Project.aggregate([
        { $match: { status: { $in: ['submitted', 'finalist'] } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const categoryStats = rawCategoryStats.map((s) => ({ category: s._id, count: s.count }));

    newest.forEach((p) => { p.liveliness = computeLiveliness(p); });
    leaderboard.forEach((p) => { p.liveliness = computeLiveliness(p); });

    res.render('home', {
      title: 'MegaDemo.ai',
      newest,
      leaderboard,
      submissionDeadline: submissionDeadline || null,
      megademoDate: megademoDate || null,
      categoryStats,
    });
  } catch (err) {
    console.error('Home controller error:', err);
    res.render('home', {
      title: 'MegaDemo.ai',
      newest: [],
      leaderboard: [],
      submissionDeadline: null,
      megademoDate: null,
      categoryStats: [],
    });
  }
};
