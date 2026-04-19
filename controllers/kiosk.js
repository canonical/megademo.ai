/**
 * Kiosk controller — full-screen presentation mode for MegaDemo day
 */
const { Project, computeLiveliness } = require('../models/Project');
const { parseVideoId } = require('../services/github');

/**
 * GET /kiosk
 */
exports.index = async (req, res, next) => {
  try {
    const rawProjects = await Project.find({ status: 'finalist' })
      .sort({ avgRating: -1 })
      .populate('owner', 'profile.name')
      .populate('team', 'profile.name')
      .lean();

    // Pre-process video IDs so templates don't need fragile URL parsing
    const projects = rawProjects.map((p) => ({
      ...p,
      liveliness: computeLiveliness(p),
      videos: (p.videos || []).map((v) => ({ ...v, parsedId: parseVideoId(v.url) })),
    }));

    res.render('kiosk/index', {
      title: 'MegaDemo.ai — MegaDemo',
      layout: 'kiosk-layout',
      projects,
      intervalSecs: (() => { const n = parseInt(process.env.KIOSK_INTERVAL || '30', 10); return Number.isFinite(n) && n > 0 ? n : 30; })(),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /kiosk/:slug
 */
exports.project = async (req, res, next) => {
  try {
    const project = await Project.findOne({ slug: req.params.slug, status: 'finalist' })
      .populate('owner', 'profile.name profile.picture')
      .populate('team', 'profile.name profile.picture canonicalTeam');

    if (!project) return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.' });

    res.render('kiosk/project', {
      title: project.title,
      layout: 'kiosk-layout',
      project: project.toObject({ virtuals: true }),
    });
  } catch (err) {
    next(err);
  }
};
