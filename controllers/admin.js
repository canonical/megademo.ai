/**
 * Admin controller
 */
const path = require('node:path');
const fs = require('node:fs');
const { Project, CATEGORIES, CANONICAL_TEAMS, AI_TOOLS, TECH_STACK_DEFAULTS, computeLiveliness } = require('../models/Project');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const ALLOWED_STATUSES = ['draft', 'submitted', 'finalist'];
exports.ALLOWED_STATUSES = ALLOWED_STATUSES;


function safeDecodeURIComponent(str) {
  try { return decodeURIComponent(str); } catch { return null; }
}

function safeUnlinkLogo(logoRelPath) {
  if (!logoRelPath) return;
  const resolved = path.resolve(PUBLIC_DIR, logoRelPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return;
  fs.unlink(resolved, () => {});
}
const Vote = require('../models/Vote');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { notifyFinalistPromoted } = require('../services/mattermost');

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

    const [submissionDeadline, megademoDate, mattermostWebhook] = await Promise.all([
      Settings.get('submissionDeadline'),
      Settings.get('megademoDate'),
      Settings.get('mattermostWebhook'),
    ]);

    const testLoginToken = process.env.TEST_LOGIN_TOKEN || null;
    const baseUrl = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { totalProjects, totalVotes, totalUsers, finalists },
      categoryStats,
      recentProjects,
      settings: { submissionDeadline, megademoDate, mattermostWebhook },
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
    const ALLOWED_STATUSES = exports.ALLOWED_STATUSES;
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
    const allowed = ['draft', 'submitted', 'finalist'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

    const project = await Project.findByIdAndUpdate(req.params.id, { status }, { returnDocument: 'after' });
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    if (status === 'finalist') {
      notifyFinalistPromoted(project, process.env.BASE_URL || 'http://localhost:8080').catch(() => {});
    }

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

    res.json({ success: true, title: project.title });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/projects/:id/mock-github
 * Injects synthetic githubStats so the liveliness glow can be tested visually.
 * daysAgo < 0 clears stats entirely; otherwise sets a fake lastCommit that many days ago.
 */
exports.mockGithubStats = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const daysAgo = parseFloat(req.body.daysAgo);
    if (isNaN(daysAgo) || daysAgo < 0) {
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
    const { subDate, subTime, megaDate, megaTime, mattermostWebhook } = req.body;

    // Combine split date+time inputs into "YYYY-MM-DDTHH:mm" (or null when cleared)
    const submissionDeadline = subDate ? `${subDate}T${subTime || '00:00'}` : null;
    const megademoDate       = megaDate ? `${megaDate}T${megaTime || '00:00'}` : null;

    // Validate ordering — megademo must come after submission deadline
    let megaDateRejected = false;
    if (submissionDeadline && megademoDate) {
      const subTs  = new Date(submissionDeadline);
      const megaTs = new Date(megademoDate);
      if (!isNaN(subTs.getTime()) && !isNaN(megaTs.getTime()) && megaTs <= subTs) {
        megaDateRejected = true;
        req.flash('errors', { msg: 'MegaDemo date must be later than the submission deadline.' });
      }
    }

    // Always save valid fields; skip only the rejected megademoDate
    await Promise.all([
      Settings.set('submissionDeadline', submissionDeadline),
      megaDateRejected ? Promise.resolve() : Settings.set('megademoDate', megademoDate),
      mattermostWebhook !== undefined ? Settings.set('mattermostWebhook', mattermostWebhook || null) : Promise.resolve(),
    ]);

    if (megaDateRejected) return res.redirect('/admin');

    req.flash('success', { msg: 'Settings saved.' });
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
    const teams = await getTeamList();
    if (teams.some((t) => t.toLowerCase() === name.toLowerCase())) {
      req.flash('errors', { msg: `Team "${name}" already exists.` });
      return res.redirect('/admin/teams');
    }
    teams.push(name);
    await Settings.set('customTeams', teams);
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
    teams[idx] = newName;
    await Settings.set('customTeams', teams);
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
    const teams = await getTeamList();
    const filtered = teams.filter((t) => t !== name);
    await Settings.set('customTeams', filtered);
    req.flash('success', { msg: `Team "${name}" deleted.` });
    res.redirect('/admin/teams');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /admin/teams  (legacy bulk-save, kept for compatibility)
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
    const tools = await getAiToolsList();
    if (tools.some((t) => t.toLowerCase() === item.toLowerCase())) {
      req.flash('errors', { msg: `"${item}" already exists.` });
      return res.redirect('/admin/tags');
    }
    await Settings.set('customAiTools', [...tools, item]);
    req.flash('success', { msg: `Added "${item}" to AI Tools.` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/tags/ai-tools/rename
 */
exports.renameAiTool = async (req, res, next) => {
  try {
    const { item, newName } = req.body;
    const name = (newName || '').trim();
    if (!name || name === item) { req.flash('errors', { msg: 'Provide a different name.' }); return res.redirect('/admin/tags'); }
    const tools = await getAiToolsList();
    if (tools.some((t) => t.toLowerCase() === name.toLowerCase())) {
      req.flash('errors', { msg: `"${name}" already exists.` });
      return res.redirect('/admin/tags');
    }
    await Settings.set('customAiTools', tools.map((t) => (t === item ? name : t)));
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
    const item = req.body.item || '';
    const usageCount = await Project.countDocuments({ aiTools: item });
    if (usageCount > 0) {
      req.flash('errors', { msg: `Cannot delete "${item}" — used by ${usageCount} project(s). Rename first or remove from those projects.` });
      return res.redirect('/admin/tags');
    }
    const tools = await getAiToolsList();
    await Settings.set('customAiTools', tools.filter((t) => t !== item));
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
    const stack = await getTechStackList();
    if (stack.some((t) => t.toLowerCase() === item.toLowerCase())) {
      req.flash('errors', { msg: `"${item}" already exists.` });
      return res.redirect('/admin/tags');
    }
    await Settings.set('customTechStack', [...stack, item]);
    req.flash('success', { msg: `Added "${item}" to Tech Stack.` });
    res.redirect('/admin/tags');
  } catch (err) { next(err); }
};

/**
 * POST /admin/tags/tech-stack/rename
 */
exports.renameTechStack = async (req, res, next) => {
  try {
    const { item, newName } = req.body;
    const name = (newName || '').trim();
    if (!name || name === item) { req.flash('errors', { msg: 'Provide a different name.' }); return res.redirect('/admin/tags'); }
    const stack = await getTechStackList();
    if (stack.some((t) => t.toLowerCase() === name.toLowerCase())) {
      req.flash('errors', { msg: `"${name}" already exists.` });
      return res.redirect('/admin/tags');
    }
    await Settings.set('customTechStack', stack.map((t) => (t === item ? name : t)));
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
    const item = req.body.item || '';
    const usageCount = await Project.countDocuments({ techStack: item });
    if (usageCount > 0) {
      req.flash('errors', { msg: `Cannot delete "${item}" — used by ${usageCount} project(s). Rename first or remove from those projects.` });
      return res.redirect('/admin/tags');
    }
    const stack = await getTechStackList();
    await Settings.set('customTechStack', stack.filter((t) => t !== item));
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

    const { loadDefaults } = require('../scripts/seed-defaults');
    const defaults = loadDefaults();

    // Remove all uploaded logo/media files (path-traversal-safe, best-effort)
    const projects = await Project.find({}, 'logo').lean();
    for (const p of projects) {
      if (p.logo) safeUnlinkLogo(p.logo);
    }

    await Promise.all([
      Project.deleteMany({}),
      Vote.deleteMany({}),
      Settings.set('customTeams',    defaults.teams      || []),
      Settings.set('customAiTools',  defaults.ai_tools   || []),
      Settings.set('customTechStack', defaults.tech_stack || []),
    ]);

    req.flash('success', { msg: 'All projects and votes deleted. Lists reset to defaults.' });
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
};
