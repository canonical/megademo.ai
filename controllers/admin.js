/**
 * Admin controller
 */
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const lusca = require('lusca');
const { verifyImageMagicBytes } = require('../services/imageTypeCheck');
const { Project, CATEGORIES, CANONICAL_TEAMS, AI_TOOLS, TECH_STACK_DEFAULTS, computeLiveliness } = require('../models/Project');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(__dirname, '../public/uploads');
const UPLOADS_URL_PREFIX = '/uploads/';
const ALLOWED_STATUSES = ['draft', 'submitted', 'finalist'];
exports.ALLOWED_STATUSES = ALLOWED_STATUSES;

const Vote = require('../models/Vote');
const User = require('../models/User');
const Settings = require('../models/Settings');
const ActivityLog = require('../models/ActivityLog');
const { notifyFinalistPromoted } = require('../services/mattermost');
const { logActivity } = require('../services/activityLog');

function safeUnlinkLogo(logoRelPath) {
  if (!logoRelPath || !logoRelPath.startsWith(UPLOADS_URL_PREFIX)) return;
  const filename = logoRelPath.slice(UPLOADS_URL_PREFIX.length);
  // Guard against path traversal: filename must be a plain basename with no separators
  if (!filename || path.basename(filename) !== filename) return;
  fs.unlink(path.join(UPLOADS_DIR, filename), () => {});
}

function safeUnlinkHeroImage(heroRelPath) {
  // Only delete custom uploaded images (those under /uploads/), not the default static asset
  if (!heroRelPath || !heroRelPath.startsWith(UPLOADS_URL_PREFIX)) return;
  const filename = heroRelPath.slice(UPLOADS_URL_PREFIX.length);
  if (!filename || path.basename(filename) !== filename) return;
  if (!filename.startsWith('hero-')) return; // extra safety guard
  fs.unlink(path.join(UPLOADS_DIR, filename), () => {});
}

// Multer config for hero image uploads (max 3 MB, jpg/png/webp only)
const HERO_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const HERO_ALLOWED_MIMETYPES  = ['image/jpeg', 'image/png', 'image/webp'];

// Separate lusca CSRF instance used after multer has parsed the multipart body
const heroFormCsrf = lusca.csrf();

const heroStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `hero-${Date.now()}${ext}`);
  },
});
const heroUpload = multer({
  storage: heroStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (HERO_ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .jpg, .jpeg, .png, or .webp images are allowed.'));
    }
  },
}).single('heroImage');

function safeDecodeURIComponent(str) {
  try { return decodeURIComponent(str); } catch { return null; }
}

async function getTeamList() {
  const custom = await Settings.get('customTeams');
  const teams = (Array.isArray(custom) && custom.length) ? custom : [...CANONICAL_TEAMS];
  return [...teams].sort((a, b) => a.localeCompare(b));
}

async function getAiToolsList() {
  const custom = await Settings.get('customAiTools');
  return (Array.isArray(custom) && custom.length) ? custom : [...AI_TOOLS];
}

async function getTechStackList() {
  const custom = await Settings.get('customTechStack');
  return (Array.isArray(custom) && custom.length) ? custom : [...TECH_STACK_DEFAULTS];
}

/**
 * GET /admin
 */
exports.dashboard = async (req, res, next) => {
  try {
    const [totalProjects, totalVotes, totalUsers, finalists, categoryStats, recentProjects] = await Promise.all([
      Project.countDocuments(),
      Vote.countDocuments(),
      User.countDocuments(),
      Project.countDocuments({ status: 'finalist' }),
      Project.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Project.find().sort({ createdAt: -1 }).limit(5).populate('owner', 'profile.name').lean(),
    ]);

    const [submissionDeadline, megademoDate, mattermostWebhook, hackathonStart, announcementBanner] = await Promise.all([
      Settings.get('submissionDeadline'),
      Settings.get('megademoDate'),
      Settings.get('mattermostWebhook'),
      Settings.get('hackathonStart'),
      Settings.get('announcementBanner'),
    ]);

    const testLoginToken = process.env.TEST_LOGIN_TOKEN || null;
    const baseUrl = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { totalProjects, totalVotes, totalUsers, finalists },
      categoryStats,
      recentProjects,
      settings: { submissionDeadline, megademoDate, mattermostWebhook, hackathonStart, announcementBanner },
      testLoginToken,
      baseUrl,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/projects
 */
exports.projects = async (req, res, next) => {
  try {
    const status   = ALLOWED_STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : undefined;
    const filter   = {};
    if (status)   filter.status   = status;
    if (category) filter.category = category;

    const projects = await Project.find(filter)
      .sort({ createdAt: -1 })
      .populate('owner', 'profile.name email')
      .lean();

    projects.forEach((p) => { p.liveliness = computeLiveliness(p); });

    res.render('admin/projects', {
      title: 'Manage Projects',
      projects,
      CATEGORIES,
      filters: { status, category },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/projects/:id/status
 */
exports.setStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

    const project = await Project.findByIdAndUpdate(req.params.id, { status }, { returnDocument: 'after' });
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    if (status === 'finalist') {
      notifyFinalistPromoted(project, process.env.BASE_URL || 'http://localhost:8080').catch(() => {});
    }

    logActivity(req.user.email, `Set project '${project.title}' status to '${status}'`).catch(() => {});
    res.json({ success: true, status: project.status, title: project.title });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/projects/:id/delete
 */
exports.deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    // Best-effort: remove uploaded logo file (path-traversal-safe)
    if (project.logo) safeUnlinkLogo(project.logo);

    await Promise.all([
      Vote.deleteMany({ project: project._id }),
      Project.deleteOne({ _id: project._id }),
    ]);

    logActivity(req.user.email, `Deleted project '${project.title}' (admin)`).catch(() => {});
    res.json({ success: true, title: project.title });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/projects/:id/mock-github
 * Injects synthetic githubStats so the liveliness glow can be tested visually.
 * Non-numeric daysAgo returns 400. daysAgo < 0 clears stats entirely.
 * Otherwise sets a fake lastCommit that many days ago.
 */
exports.mockGithubStats = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const daysAgo = parseFloat(req.body.daysAgo);
    if (isNaN(daysAgo)) {
      return res.status(400).json({ error: 'daysAgo must be a number.' });
    }
    if (daysAgo < 0) {
      project.githubStats = [];
    } else {
      project.githubStats = [{
        repoUrl: 'https://github.com/mock/repo',
        stars: 42,
        lastCommit: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        openPRs: 2,
        fetchedAt: new Date(),
      }];
    }
    await project.save();
    res.json({ success: true, liveliness: project.liveliness });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/users
 */
exports.users = async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    res.render('admin/users', { title: 'Manage Users', users });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/users/:id/role
 */
exports.setRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const allowed = ['participant', 'admin'];
    if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ error: 'Cannot change your own role.' });

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { returnDocument: 'after' });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    logActivity(req.user.email, `Set role of '${user.email}' to '${role}'`).catch(() => {});
    res.json({ success: true, role: user.role });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/export
 */
exports.exportCsv = async (req, res, next) => {
  try {
    const projects = await Project.find()
      .populate('owner', 'email profile.name')
      .populate('team', 'email profile.name')
      .lean();

    const rows = [
      ['Title', 'Category', 'Status', 'Owner', 'Team', 'CanonicalTeam', 'AvgRating', 'VoteCount', 'RepoLinks', 'DemoUrl', 'AITools', 'TechStack', 'CompletionStage', 'CreatedAt'],
    ];

    for (const p of projects) {
      rows.push([
        p.title,
        p.category,
        p.status,
        p.owner?.email || '',
        p.team?.map((u) => u.email).join('; ') || '',
        p.canonicalTeam,
        Number.isFinite(p.avgRating) ? p.avgRating.toFixed(2) : '0',
        p.voteCount ?? 0,
        p.repoLinks?.join('; ') || '',
        p.demoUrl || '',
        p.aiTools?.join('; ') || '',
        p.techStack?.join('; ') || '',
        p.completionStage || '',
        p.createdAt?.toISOString() || '',
      ]);
    }

    const csv = rows.map((r) => r.map((c) => {
      const s = String(c).replace(/"/g, '""').replace(/[\r\n]/g, '\\n');
      // Prefix formula-starting chars to prevent CSV injection in spreadsheet apps
      const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
      return `"${safe}"`;
    }).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="megademo-projects.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/settings
 */
exports.saveSettings = async (req, res, next) => {
  try {
    const { section, hackStart, subDeadline, megaDatetime, mattermostWebhook, announcementBanner } = req.body;

    // Banner form
    if (section === 'banner') {
      const text = (announcementBanner || '').trim();
      if (text.length > 500) {
        req.flash('errors', { msg: 'Announcement text exceeds 500 characters.' });
        return res.redirect('/admin');
      }
      await Settings.set('announcementBanner', text || null);
      // Bust the in-process banner cache so the change is visible immediately
      try { require('../app').bustBannerCache(); } catch { /* non-fatal */ }
      req.flash('success', { msg: text ? 'Banner saved.' : 'Banner cleared.' });
      return res.redirect('/admin');
    }

    // Mattermost-only form — save webhook and return immediately
    if (section === 'mattermost') {
      await Settings.set('mattermostWebhook', mattermostWebhook || null);
      req.flash('success', { msg: 'Webhook saved.' });
      return res.redirect('/admin');
    }

    // Dates form (section === 'dates' or unspecified)
    const hackathonStart     = hackStart    || null;
    const submissionDeadline = subDeadline  || null;
    const megademoDate       = megaDatetime || null;

    // Reject unparseable date strings before further processing
    if (hackathonStart && isNaN(new Date(hackathonStart))) {
      req.flash('errors', { msg: 'Invalid Hackathon Start — please use the date/time picker.' });
      return res.redirect('/admin');
    }
    if (submissionDeadline && isNaN(new Date(submissionDeadline))) {
      req.flash('errors', { msg: 'Invalid Submission Deadline — please use the date/time picker.' });
      return res.redirect('/admin');
    }
    if (megademoDate && isNaN(new Date(megademoDate))) {
      req.flash('errors', { msg: 'Invalid MegaDemo Date — please use the date/time picker.' });
      return res.redirect('/admin');
    }

    // Validate ordering
    let hackStartRejected = false;
    let megaDateRejected  = false;
    const hackTs = hackathonStart     ? new Date(hackathonStart)     : null;
    const subTs  = submissionDeadline ? new Date(submissionDeadline) : null;
    const megaTs = megademoDate       ? new Date(megademoDate)       : null;

    if (hackTs && subTs && !isNaN(hackTs) && !isNaN(subTs) && hackTs >= subTs) {
      hackStartRejected = true;
      req.flash('errors', { msg: 'Hackathon Start must be earlier than the Submission Deadline.' });
    }
    if (hackTs && megaTs && !isNaN(hackTs) && !isNaN(megaTs) && hackTs >= megaTs) {
      hackStartRejected = true;
      req.flash('errors', { msg: 'Hackathon Start must be earlier than the MegaDemo Date.' });
    }
    if (subTs && megaTs && !isNaN(subTs) && !isNaN(megaTs) && megaTs <= subTs) {
      megaDateRejected = true;
      req.flash('errors', { msg: 'MegaDemo date must be later than the submission deadline.' });
    }

    // Save valid fields; skip rejected ones
    await Promise.all([
      hackStartRejected ? Promise.resolve() : Settings.set('hackathonStart', hackathonStart),
      Settings.set('submissionDeadline', submissionDeadline),
      megaDateRejected  ? Promise.resolve() : Settings.set('megademoDate', megademoDate),
    ]);

    if (hackStartRejected || megaDateRejected) {
      req.flash('success', { msg: 'Other dates saved.' });
      return res.redirect('/admin');
    }

    req.flash('success', { msg: 'Dates saved.' });
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/teams
 */
exports.teamsPage = async (req, res, next) => {
  try {
    const teams = await getTeamList();
    // Get project counts per team for display
    const counts = await Project.aggregate([
      { $match: { canonicalTeam: { $in: teams } } },
      { $group: { _id: '$canonicalTeam', count: { $sum: 1 } } },
    ]);
    const projectCounts = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    res.render('admin/teams', { title: 'Manage Teams', teams, projectCounts });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/teams/add
 */
exports.addTeam = async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      req.flash('errors', { msg: 'Team name cannot be empty.' });
      return res.redirect('/admin/teams');
    }
    // Read for case-insensitive dup check (small TOCTOU window, consequence is cosmetic only)
    const teams = await getTeamList();
    if (teams.some((t) => t.toLowerCase() === name.toLowerCase())) {
      req.flash('errors', { msg: `Team "${name}" already exists.` });
      return res.redirect('/admin/teams');
    }
    await Settings.arrayAdd('customTeams', name);
    req.flash('success', { msg: `Team "${name}" added.` });
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/teams/:name/rename
 */
exports.renameTeam = async (req, res, next) => {
  try {
    const oldName = safeDecodeURIComponent(req.params.name);
    if (oldName === null) {
      req.flash('errors', { msg: 'Invalid team name in URL.' });
      return res.redirect('/admin/teams');
    }
    const newName = (req.body.newName || '').trim();
    if (!newName) {
      req.flash('errors', { msg: 'New name cannot be empty.' });
      return res.redirect('/admin/teams');
    }
    const teams = await getTeamList();
    const idx = teams.indexOf(oldName);
    if (idx === -1) {
      req.flash('errors', { msg: `Team "${oldName}" not found.` });
      return res.redirect('/admin/teams');
    }
    if (teams.some((t) => t.toLowerCase() === newName.toLowerCase() && t !== oldName)) {
      req.flash('errors', { msg: `Team "${newName}" already exists.` });
      return res.redirect('/admin/teams');
    }
    // Settings write is atomic; Project cascade is a separate op (noted: tiny inconsistency
    // window if process crashes between the two, cosmetically fixable by re-running rename)
    await Settings.arrayRename('customTeams', oldName, newName);
    // Propagate rename to all existing projects
    await Project.updateMany({ canonicalTeam: oldName }, { $set: { canonicalTeam: newName } });
    req.flash('success', { msg: `Team renamed from "${oldName}" to "${newName}".` });
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/teams/:name/delete
 */
exports.deleteTeam = async (req, res, next) => {
  try {
    const name = safeDecodeURIComponent(req.params.name);
    if (name === null) {
      req.flash('errors', { msg: 'Invalid team name in URL.' });
      return res.redirect('/admin/teams');
    }
    const count = await Project.countDocuments({ canonicalTeam: name });
    if (count > 0) {
      req.flash('errors', { msg: `Cannot delete "${name}" — ${count} project(s) use this team. Reassign them first.` });
      return res.redirect('/admin/teams');
    }
    // $pull is atomic — no need to read the list first.
    // Residual TOCTOU: a project could be assigned this team between the count check above
    // and the $pull below; consequence is an orphaned canonicalTeam value on that project.
    await Settings.arrayRemove('customTeams', name);
    req.flash('success', { msg: `Team "${name}" deleted.` });
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/teams  (legacy bulk-save, kept for compatibility)
 * Full array replacement — last write wins; do not run concurrently with per-item ops.
 */
exports.saveTeams = async (req, res, next) => {
  try {
    const raw = req.body.teams || '';
    const seen = new Set();
    const teams = raw.split('\n').map((t) => t.trim()).filter((t) => {
      if (!t || seen.has(t.toLowerCase())) return false;
      seen.add(t.toLowerCase());
      return true;
    });
    await Settings.set('customTeams', teams);
    req.flash('success', { msg: 'Team list updated.' });
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/tags
 */
exports.tagsPage = async (req, res, next) => {
  try {
    const [aiTools, techStack] = await Promise.all([getAiToolsList(), getTechStackList()]);

    // Count projects using each AI tool / tech stack tag
    const [aiUsageRaw, techUsageRaw] = await Promise.all([
      Project.aggregate([
        { $unwind: '$aiTools' },
        { $group: { _id: '$aiTools', count: { $sum: 1 } } },
      ]),
      Project.aggregate([
        { $unwind: '$techStack' },
        { $group: { _id: '$techStack', count: { $sum: 1 } } },
      ]),
    ]);

    const aiUsage   = Object.fromEntries(aiUsageRaw.map((r) => [r._id, r.count]));
    const techUsage = Object.fromEntries(techUsageRaw.map((r) => [r._id, r.count]));

    res.render('admin/tags', { title: 'Manage Tags & AI Tools', aiTools, techStack, aiUsage, techUsage });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/tags/ai-tools — add one AI tool
 */
exports.addAiTool = async (req, res, next) => {
  try {
    const item = (req.body.item || '').trim();
    if (!item) { req.flash('errors', { msg: 'Tool name required.' }); return res.redirect('/admin/tags'); }
    // Read for case-insensitive dup check (small TOCTOU window, consequence is cosmetic only)
    const tools = await getAiToolsList();
    if (tools.some((t) => t.toLowerCase() === item.toLowerCase())) {
      req.flash('errors', { msg: `"${item}" already exists.` });
      return res.redirect('/admin/tags');
    }
    await Settings.arrayAdd('customAiTools', item);
    req.flash('success', { msg: `Added "${item}" to AI Tools.` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/tags/ai-tools/rename
 */
exports.renameAiTool = async (req, res, next) => {
  try {
    const { item: rawItem, newName } = req.body;
    const item = String(rawItem || '');
    const name = (newName || '').trim();
    if (!name || name === item) { req.flash('errors', { msg: 'Provide a different name.' }); return res.redirect('/admin/tags'); }
    const tools = await getAiToolsList();
    if (tools.some((t) => t.toLowerCase() === name.toLowerCase())) {
      req.flash('errors', { msg: `"${name}" already exists.` });
      return res.redirect('/admin/tags');
    }
    // Settings write is atomic; Project cascade is a separate op
    await Settings.arrayRename('customAiTools', item, name);
    await Project.updateMany({ aiTools: item }, { $set: { 'aiTools.$[el]': name } }, { arrayFilters: [{ el: item }] });
    req.flash('success', { msg: `Renamed "${item}" → "${name}".` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/tags/ai-tools/delete — remove one AI tool
 */
exports.deleteAiTool = async (req, res, next) => {
  try {
    const item = String(req.body.item || '');
    const usageCount = await Project.countDocuments({ aiTools: item });
    if (usageCount > 0) {
      req.flash('errors', { msg: `Cannot delete "${item}" — used by ${usageCount} project(s). Rename first or remove from those projects.` });
      return res.redirect('/admin/tags');
    }
    // $pull is atomic — no need to read the list first
    await Settings.arrayRemove('customAiTools', item);
    req.flash('success', { msg: `Removed "${item}" from AI Tools.` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/tags/tech-stack — add one tech stack tag
 */
exports.addTechStack = async (req, res, next) => {
  try {
    const item = (req.body.item || '').trim();
    if (!item) { req.flash('errors', { msg: 'Tag name required.' }); return res.redirect('/admin/tags'); }
    // Read for case-insensitive dup check (small TOCTOU window, consequence is cosmetic only)
    const stack = await getTechStackList();
    if (stack.some((t) => t.toLowerCase() === item.toLowerCase())) {
      req.flash('errors', { msg: `"${item}" already exists.` });
      return res.redirect('/admin/tags');
    }
    await Settings.arrayAdd('customTechStack', item);
    req.flash('success', { msg: `Added "${item}" to Tech Stack.` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/tags/tech-stack/rename
 */
exports.renameTechStack = async (req, res, next) => {
  try {
    const { item: rawItem, newName } = req.body;
    const item = String(rawItem || '');
    const name = (newName || '').trim();
    if (!name || name === item) { req.flash('errors', { msg: 'Provide a different name.' }); return res.redirect('/admin/tags'); }
    const stack = await getTechStackList();
    if (stack.some((t) => t.toLowerCase() === name.toLowerCase())) {
      req.flash('errors', { msg: `"${name}" already exists.` });
      return res.redirect('/admin/tags');
    }
    // Settings write is atomic; Project cascade is a separate op
    await Settings.arrayRename('customTechStack', item, name);
    await Project.updateMany({ techStack: item }, { $set: { 'techStack.$[el]': name } }, { arrayFilters: [{ el: item }] });
    req.flash('success', { msg: `Renamed "${item}" → "${name}".` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/tags/tech-stack/delete — remove one tech stack tag
 */
exports.deleteTechStack = async (req, res, next) => {
  try {
    const item = String(req.body.item || '');
    const usageCount = await Project.countDocuments({ techStack: item });
    if (usageCount > 0) {
      req.flash('errors', { msg: `Cannot delete "${item}" — used by ${usageCount} project(s). Rename first or remove from those projects.` });
      return res.redirect('/admin/tags');
    }
    // $pull is atomic — no need to read the list first
    await Settings.arrayRemove('customTechStack', item);
    req.flash('success', { msg: `Removed "${item}" from Tech Stack.` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/reset — wipe all projects & votes, re-seed default lists.
 * Requires confirmation token "RESET" in request body.
 * Does NOT delete users or settings (deadlines, webhooks).
 */
exports.resetAll = async (req, res, next) => {
  try {
    if (req.body.confirm !== 'RESET') {
      req.flash('errors', { msg: 'Reset cancelled — confirmation token did not match.' });
      return res.redirect('/admin');
    }

    const wipeLogs = req.body.wipeLogs === '1';
    const { loadDefaults } = require('../scripts/seed-defaults');
    const defaults = loadDefaults();

    // Remove all uploaded logo/media files (path-traversal-safe, best-effort)
    const projects = await Project.find({}, 'logo').lean();
    for (const p of projects) {
      if (p.logo) safeUnlinkLogo(p.logo);
    }

    const ops = [
      Project.deleteMany({}),
      Vote.deleteMany({}),
      Settings.set('customTeams',    defaults.teams      || []),
      Settings.set('customAiTools',  defaults.ai_tools   || []),
      Settings.set('customTechStack', defaults.tech_stack || []),
    ];
    if (wipeLogs) ops.push(ActivityLog.deleteMany({}));
    await Promise.all(ops);

    const logMsg = wipeLogs
      ? 'Reset all projects and votes (admin); activity log wiped'
      : 'Reset all projects and votes (admin)';
    const flashMsg = wipeLogs
      ? 'All projects, votes and activity log deleted. Lists reset to defaults.'
      : 'All projects and votes deleted. Lists reset to defaults.';
    req.flash('success', { msg: flashMsg });
    logActivity(req.user.email, logMsg).catch(() => {});
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/users/clear-sessions
 * Delete all MongoDB sessions — forces every user to re-login (picture fetched on next OIDC callback).
 */
const SESSION_COLLECTION = 'sessions'; // matches collectionName in MongoStore config (app.js)
exports.clearSessions = async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const result   = await mongoose.connection.db.collection(SESSION_COLLECTION).deleteMany({});
    res.json({
      ok: true,
      message: `Cleared ${result.deletedCount} session(s). All users have been signed out and will re-authenticate on their next visit.`,
      count: result.deletedCount,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /admin/activity-log
 * GET /admin/activity-log?format=text  — plain-text download
 */
exports.activityLog = async (req, res, next) => {
  try {
    const PAGE_SIZE = 200;
    const entries = await ActivityLog.find()
      .sort({ timestamp: -1 })
      .limit(PAGE_SIZE)
      .lean();

    if (req.query.format === 'text') {
      const lines = entries.map((e) =>
        `[${new Date(e.timestamp).toISOString()}] ${e.userEmail}: ${e.action}`
      ).join('\n');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="activity-log.txt"');
      return res.send(lines);
    }

    res.render('admin/activity-log', {
      title: 'Activity Log',
      entries,
    });
  } catch (err) {
    next(err);
  }
};

const HERO_TEXT_LIMITS = {
  heroLine1:       60,
  heroLine2:       60,
  heroSubtitle:    120,
  heroDescription: 600,
};

/**
 * GET /admin/homepage
 */
exports.homepageSettings = async (req, res, next) => {
  try {
    const [heroLine1, heroLine2, heroSubtitle, heroDescription, heroImage] = await Promise.all([
      Settings.get('heroLine1'),
      Settings.get('heroLine2'),
      Settings.get('heroSubtitle'),
      Settings.get('heroDescription'),
      Settings.get('heroImage'),
    ]);
    res.render('admin/homepage', {
      title: 'Homepage Settings',
      settings: { heroLine1, heroLine2, heroSubtitle, heroDescription, heroImage },
      limits: HERO_TEXT_LIMITS,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/homepage
 */
exports.saveHomepageSettings = async (req, res, next) => {
  try {
    // Parse multipart (hero image upload); convert user-facing errors to flash redirects
    await new Promise((resolve, reject) => {
      heroUpload(req, res, (err) => {
        if (!err) return resolve();
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? 'Image exceeds the 3 MB size limit.'
          : err.message || 'Invalid file.';
        const flashErr = Object.assign(new Error(msg), { isUserError: true, msg });
        reject(flashErr);
      });
    });

    // Verify CSRF token now that multer has populated req.body
    await new Promise((resolve, reject) => heroFormCsrf(req, res, (err) => (err ? reject(err) : resolve())));

    // Validate text fields
    const errors = [];
    const fields = {};
    for (const [key, limit] of Object.entries(HERO_TEXT_LIMITS)) {
      const val = (req.body[key] || '').trim();
      if (val.length > limit) {
        errors.push({ msg: `${key} exceeds ${limit} character limit.` });
      } else {
        fields[key] = val;
      }
    }
    if (errors.length) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      req.flash('errors', errors);
      return res.redirect('/admin/homepage');
    }

    // Verify image magic bytes if a file was uploaded
    if (req.file) {
      try {
        await verifyImageMagicBytes(req.file, HERO_ALLOWED_MIMETYPES, 'Only .jpg, .jpeg, .png, or .webp images are allowed.');
      } catch (err) {
        req.flash('errors', { msg: err.message });
        return res.redirect('/admin/homepage');
      }
    }

    // Persist text settings
    await Promise.all(
      Object.entries(fields).map(([key, val]) => Settings.set(key, val || null))
    );

    // Handle image: upload → replace; checkbox → remove
    const currentImage = await Settings.get('heroImage');
    if (req.file) {
      // New upload: delete the old custom image (if any) and save the new path
      safeUnlinkHeroImage(currentImage);
      await Settings.set('heroImage', `/uploads/${req.file.filename}`);
    } else if (req.body.removeHeroImage === '1') {
      safeUnlinkHeroImage(currentImage);
      await Settings.set('heroImage', null);
    }

    logActivity(req.user.email, 'Updated homepage settings').catch(() => {});
    req.flash('success', { msg: 'Homepage settings saved.' });
    res.redirect('/admin/homepage');
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err.isUserError) {
      req.flash('errors', { msg: err.msg });
      return res.redirect('/admin/homepage');
    }
    next(err);
  }
};
