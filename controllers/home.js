/**
 * Home controller
 */
const { Project, computeLiveliness } = require('../models/Project');
const Settings = require('../models/Settings');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const HERO_DEFAULTS = {
  heroLine1:       'SURF THE WAVE.',
  heroLine2:       'BUILD THE FUTURE.',
  heroSubtitle:    'Canonical Madrid Engineering Sprint — AI Hackathon',
  heroDescription: 'Every engineer suddenly got access to superpowers — and it\'s time to properly exercise our new magical abilities. Register your AI project, show your work, and compete for a spot at the MegaDemo on Friday. [Get started ->](/get-started)',
  heroImage:       null,
};

/**
 * Render admin-supplied Markdown description as safe HTML.
 * Allows inline elements and links; strips everything else.
 * - Adds hero-help-link CSS class to all <a> tags.
 * - External links get rel="noopener noreferrer" and target="_blank".
 */
function renderHeroDescription(raw) {
  const html = sanitizeHtml(marked.parse(raw || ''), {
    allowedTags: ['p', 'strong', 'em', 'a', 'br'],
    allowedAttributes: { 'a': ['href', 'title', 'class', 'rel', 'target'] },
    allowedClasses: { 'a': ['hero-help-link'] },
    allowedSchemes: ['http', 'https'],
    transformTags: {
      'a': (tagName, attribs) => {
        const isExternal = /^https?:\/\//i.test(attribs.href || '');
        return {
          tagName: 'a',
          attribs: {
            ...attribs,
            class: 'hero-help-link',
            ...(isExternal ? { rel: 'noopener noreferrer', target: '_blank' } : {}),
          },
        };
      },
    },
  });
  return html;
}
exports.renderHeroDescription = renderHeroDescription;

/**
 * GET /
 */
exports.index = async (req, res) => {
  try {
    const [newest, leaderboard, submissionDeadline, megademoDate, hackathonStart, rawCategoryStats, heroLine1, heroLine2, heroSubtitle, heroDescription, heroImage] = await Promise.all([
      Project.find({ status: { $in: ['submitted', 'finalist'] } })
        .sort({ createdAt: -1 })
        .limit(6)
        .populate('owner', 'profile.name profile.picture')
        .lean(),
      Project.find({ status: { $in: ['submitted', 'finalist'] }, voteCount: { $gte: 1 } })
        .sort({ totalStars: -1, avgRating: -1 })
        .limit(5)
        .populate('owner', 'profile.name')
        .lean(),
      Settings.get('submissionDeadline'),
      Settings.get('megademoDate'),
      Settings.get('hackathonStart'),
      Project.aggregate([
        { $match: { status: { $in: ['submitted', 'finalist'] } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Settings.get('heroLine1'),
      Settings.get('heroLine2'),
      Settings.get('heroSubtitle'),
      Settings.get('heroDescription'),
      Settings.get('heroImage'),
    ]);

    const categoryStats = rawCategoryStats.map((s) => ({ category: s._id, count: s.count }));

    newest.forEach((p) => { p.liveliness = computeLiveliness(p); });
    leaderboard.forEach((p) => { p.liveliness = computeLiveliness(p); });

    const registrationOpen = !hackathonStart || Date.now() >= new Date(hackathonStart).getTime();

    res.render('home', {
      title: 'MegaDemo.ai',
      newest,
      leaderboard,
      submissionDeadline: submissionDeadline || null,
      megademoDate: megademoDate || null,
      hackathonStart: hackathonStart || null,
      registrationOpen,
      categoryStats,
      heroLine1:           heroLine1       || HERO_DEFAULTS.heroLine1,
      heroLine2:           heroLine2       || HERO_DEFAULTS.heroLine2,
      heroSubtitle:        heroSubtitle    || HERO_DEFAULTS.heroSubtitle,
      heroDescriptionHtml: renderHeroDescription(heroDescription || HERO_DEFAULTS.heroDescription),
      heroImageSrc:        heroImage       || '/images/megademo-wave.jpg',
    });
  } catch (err) {
    console.error('Home controller error:', err);
    res.render('home', {
      title: 'MegaDemo.ai',
      newest: [],
      leaderboard: [],
      submissionDeadline: null,
      megademoDate: null,
      hackathonStart: null,
      registrationOpen: true,
      categoryStats: [],
      heroLine1:           HERO_DEFAULTS.heroLine1,
      heroLine2:           HERO_DEFAULTS.heroLine2,
      heroSubtitle:        HERO_DEFAULTS.heroSubtitle,
      heroDescriptionHtml: renderHeroDescription(HERO_DEFAULTS.heroDescription),
      heroImageSrc:        '/images/megademo-wave.jpg',
    });
  }
};
