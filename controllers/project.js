/**
 * Project controller — CRUD, voting, media
 */
const multer = require('multer');
const path = require('node:path');
const { Project, CATEGORIES, AI_TOOLS, CANONICAL_TEAMS, TECH_STACK_DEFAULTS, COMPLETION_STAGES, computeLiveliness } = require('../models/Project');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract just the cast ID from a full asciinema URL or bare ID.
 *  "https://asciinema.org/a/293849" → "293849"
 *  "asciinema.org/a/293849"         → "293849"
 *  "293849"                         → "293849"
 */
function parseCastId(input) {
  const s = (input || '').trim();
  const m = s.match(/(?:asciinema\.org\/a\/)([A-Za-z0-9]+)/);
  return m ? m[1] : s;
}
const Vote = require('../models/Vote');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { notifyProjectSubmitted, notifyVotingMilestone } = require('../services/mattermost');
const { refreshProjectStats } = require('../services/github');

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

/** Returns true if user may edit the project (owner, team member, or admin). */
function canEdit(project, user) {
  if (user.role === 'admin') return true;
  if (project.owner.toString() === user._id.toString()) return true;
  return project.team.some((m) => (m._id || m).toString() === user._id.toString());
}

/**
 * Validate a YouTube or Vimeo URL.
 * Accepts: youtube.com/watch?v=..., youtu.be/..., vimeo.com/...
 */
function isValidVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' && u.searchParams.get('v')) return true;
    if (host === 'youtu.be' && u.pathname.length > 1) return true;
    if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function detectVideoType(url) {
  try {
    const host = new URL((url || '').trim()).hostname.replace(/^www\./, '');
    if (host === 'vimeo.com') return 'vimeo';
  } catch { /* fall through */ }
  return 'youtube';
}

// Multer config for logo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${req.params.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files (.jpg, .jpeg, .png, .gif, .webp) are allowed.'));
  },
}).single('logo');

/** Category starter descriptions */
const CATEGORY_TEMPLATES = {
  'Coding Assistant': 'An AI-powered coding assistant that helps engineers write, review, and refactor code faster. Describe what problem it solves, how it integrates with your workflow, and what makes it special.',
  'CI/CD Automation': 'An AI-driven CI/CD pipeline tool that automates testing, deployment decisions, or build optimisation. Explain the trigger, the AI decision layer, and the outcome.',
  'Documentation AI': 'A tool that automatically generates or improves documentation — READMEs, changelogs, API docs, or wiki entries — using AI. Describe the input, the output, and the time saved.',
  'Testing & QA': 'An AI system that generates, prioritises, or analyses tests. Describe the testing gap it closes and how it integrates with your codebase.',
  'Security & Compliance': 'An AI tool for scanning vulnerabilities, enforcing policies, detecting secrets, or auditing compliance. Describe the threat model and how AI improves on existing tooling.',
  'Infrastructure & Ops': 'An AI assistant for infrastructure management — config generation, incident response, cost analysis, or capacity planning. Describe the operational pain point it addresses.',
  'Data & Analytics': 'An AI-powered data tool — dashboards, query generation, anomaly detection, or data pipeline automation. Describe the data source and the insight it surfaces.',
  'Developer Tooling': 'A new developer tool — IDE extension, CLI utility, workflow automation, or productivity booster — powered by AI. Describe the daily friction it removes.',
  'Product Innovation': 'An AI feature or product enhancement applied directly to a Canonical product or service. Describe the user-facing impact and how AI enables something previously impossible.',
  'Other': 'Describe your AI project and how it relates to your team\'s domain or product area.',
};

/**
 * GET /projects
 */
exports.list = async (req, res) => {
  const { category, team, sort = 'newest' } = req.query;
  const filter = { status: { $in: ['submitted', 'finalist'] } };
  if (category) filter.category = category;
  if (team) filter.canonicalTeam = team;

  const sortMap = {
    newest:  { createdAt: -1 },
    rating:  { avgRating: -1, voteCount: -1 },
    votes:   { voteCount: -1 },
  };

  const projects = await Project.find(filter)
    .sort(sortMap[sort] || sortMap.newest)
    .populate('owner', 'profile.name profile.picture')
    .lean();

  projects.forEach((p) => { p.liveliness = computeLiveliness(p); });

  // Attach user's vote if logged in
  let userVotes = {};
  if (req.user) {
    const votes = await Vote.find({ user: req.user._id, project: { $in: projects.map((p) => p._id) } });
    votes.forEach((v) => { userVotes[v.project.toString()] = v.stars; });
  }

  res.render('projects/list', {
    title: 'Browse Projects',
    projects,
    userVotes,
    CATEGORIES,
    CANONICAL_TEAMS,
    filters: { category, team, sort },
  });
};

/**
 * GET /projects/new
 */
exports.newForm = async (req, res) => {
  const [teamList, aiToolsList, techStackList] = await Promise.all([getTeamList(), getAiToolsList(), getTechStackList()]);
  res.render('projects/new', {
    title: 'Register Project',
    CATEGORIES,
    CATEGORY_TEMPLATES,
    AI_TOOLS: aiToolsList,
    CANONICAL_TEAMS: teamList,
    TECH_STACK_DEFAULTS: techStackList,
    COMPLETION_STAGES,
    project: {},
    errors: [],
  });
};

/**
 * POST /projects
 */
exports.create = async (req, res) => {
  const { title, description, category, canonicalTeam, customTeam, aiTools, aiToolOther, techStack, completionStage, repoLinks, demoUrl, slidesUrl, teamEmails, asciinemaId, asciinemaTitle, videoUrl, videoTitle } = req.body;
  const errors = [];
  const [teamList, aiToolsList, techStackList] = await Promise.all([getTeamList(), getAiToolsList(), getTechStackList()]);

  if (!title || title.trim().length < 3) errors.push({ msg: 'Title must be at least 3 characters.' });
  if (!category || !CATEGORIES.includes(category)) errors.push({ msg: 'Please select a valid category.' });
  if (videoUrl && videoUrl.trim() && !isValidVideoUrl(videoUrl)) {
    errors.push({ msg: 'Invalid video URL. Please use a YouTube or Vimeo link.' });
  }
  if (title && title.trim().length >= 3) {
    const existing = await Project.findOne({ title: new RegExp(`^${escapeRegex(title.trim())}$`, 'i') });
    if (existing) errors.push({ msg: `A project named "${title.trim()}" is already registered. Please choose a different name.` });
  }

  if (errors.length) {
    // Normalize body fields that the template expects as arrays so re-render doesn't crash.
    // aiTools/repoLinks: may be a string (single value) or array (multiple values).
    // techStack: arrives as a comma-separated string from the hidden text input.
    const rawTechStack = req.body.techStack;
    const formData = {
      ...req.body,
      aiTools: Array.isArray(req.body.aiTools) ? req.body.aiTools : req.body.aiTools ? [req.body.aiTools] : [],
      repoLinks: Array.isArray(req.body.repoLinks) ? req.body.repoLinks : req.body.repoLinks ? [req.body.repoLinks] : [],
      techStack: Array.isArray(rawTechStack)
        ? rawTechStack
        : rawTechStack ? rawTechStack.split(',').map((t) => t.trim()).filter(Boolean) : [],
    };
    return res.render('projects/new', {
      title: 'Register Project',
      CATEGORIES, CATEGORY_TEMPLATES, AI_TOOLS: aiToolsList, CANONICAL_TEAMS: teamList, TECH_STACK_DEFAULTS: techStackList, COMPLETION_STAGES,
      project: formData,
      errors,
    });
  }

  const resolvedTeam = (canonicalTeam === 'Other' && customTeam && customTeam.trim())
    ? customTeam.trim()
    : (canonicalTeam || null);

  let parsedAiTools = Array.isArray(aiTools) ? aiTools : aiTools ? [aiTools] : [];
  if (parsedAiTools.includes('Other') && aiToolOther && aiToolOther.trim()) {
    parsedAiTools = parsedAiTools.filter((t) => t !== 'Other');
    parsedAiTools.push(aiToolOther.trim());
  }

  const project = new Project({
    title: title.trim(),
    description: description || '',
    category,
    canonicalTeam: resolvedTeam,
    aiTools: parsedAiTools,
    techStack: techStack ? techStack.split(',').map((t) => t.trim()).filter(Boolean) : [],
    completionStage: completionStage || 'prototype',
    repoLinks: Array.isArray(repoLinks) ? repoLinks.filter(Boolean) : repoLinks ? [repoLinks] : [],
    demoUrl: demoUrl || '',
    slidesUrl: slidesUrl || '',
    owner: req.user._id,
    team: [req.user._id],
  });

  // Optional: add asciinema cast from registration form
  if (asciinemaId && asciinemaId.trim()) {
    project.asciinema.push({ castId: parseCastId(asciinemaId), title: (asciinemaTitle || '').trim() });
  }

  // Optional: add video from registration form
  if (videoUrl && videoUrl.trim()) {
    project.videos.push({ url: videoUrl.trim(), title: (videoTitle || '').trim(), type: detectVideoType(videoUrl) });
  }

  const isDraft = req.body.action === 'draft';
  project.status = isDraft ? 'draft' : 'submitted';
  await project.save();

  // Optional: add team members by email (best-effort; skip unrecognised)
  if (teamEmails && teamEmails.trim()) {
    const emails = teamEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    for (const email of emails) {
      const member = await User.findOne({ email });
      if (member && !project.team.some((id) => id.toString() === member._id.toString())) {
        project.team.push(member._id);
      }
    }
    await project.save();
  }

  const msg = isDraft
    ? `Project "${project.title}" saved as draft.`
    : `Project "${project.title}" submitted! Add media and team members any time.`;
  req.flash('success', { msg });
  if (isDraft) return res.redirect('/projects/mine');
  res.redirect(`/projects/${project.slug}`);
};

/**
 * GET /projects/:slug
 */
exports.detail = async (req, res) => {
  const project = await Project.findOne({ slug: req.params.slug })
    .populate('owner', 'profile.name profile.picture email')
    .populate('team', 'profile.name profile.picture email canonicalTeam');

  if (!project) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user || null });
  }

  let userVote = null;
  if (req.user) {
    const vote = await Vote.findOne({ user: req.user._id, project: project._id });
    if (vote) userVote = vote.stars;
  }

  const isOwner = req.user && project.owner._id.toString() === req.user._id.toString();
  const isMember = req.user && project.team.some((m) => m._id.toString() === req.user._id.toString());

  // Refresh GitHub stats in the background (non-blocking)
  if (project.repoLinks?.length) {
    refreshProjectStats(project._id).catch(() => {});
  }

  res.render('projects/detail', {
    title: project.title,
    project: project.toObject({ virtuals: true }),
    userVote,
    isOwner,
    isMember,
  });
};

/**
 * GET /projects/:id/edit
 */
exports.editForm = async (req, res) => {
  const [project, teamList, aiToolsList, techStackList] = await Promise.all([
    Project.findById(req.params.id).populate('team', 'profile.name profile.picture email'),
    getTeamList(),
    getAiToolsList(),
    getTechStackList(),
  ]);
  if (!project) return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user || null });
  if (!canEdit(project, req.user)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'You cannot edit this project.', user: req.user || null });
  }

  res.render('projects/edit', {
    title: `Edit — ${project.title}`,
    project: project.toObject({ virtuals: true }),
    CATEGORIES, CATEGORY_TEMPLATES, AI_TOOLS: aiToolsList, CANONICAL_TEAMS: teamList, TECH_STACK_DEFAULTS: techStackList, COMPLETION_STAGES,
    errors: [],
  });
};

/**
 * POST /projects/:id
 */
exports.update = async (req, res) => {
  const project = await Project.findById(req.params.id)
    .populate('team', 'profile.name profile.picture email');
  if (!project) return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user || null });
  if (!canEdit(project, req.user)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'You cannot edit this project.', user: req.user || null });
  }
  const { title, description, category, canonicalTeam, customTeam, aiTools, aiToolOther, techStack, completionStage, repoLinks, demoUrl, slidesUrl, status } = req.body;
  const [teamList, aiToolsList, techStackList] = await Promise.all([getTeamList(), getAiToolsList(), getTechStackList()]);

  if (title !== undefined && title.trim().length < 3) {
    return res.status(400).render('projects/edit', {
      title: 'Edit Project', project, errors: [{ msg: 'Title must be at least 3 characters.' }],
      CATEGORIES, CATEGORY_TEMPLATES, AI_TOOLS: aiToolsList, CANONICAL_TEAMS: teamList, TECH_STACK_DEFAULTS: techStackList, COMPLETION_STAGES,
    });
  }

  const resolvedTeam = canonicalTeam === 'Other' && customTeam && customTeam.trim()
    ? customTeam.trim()
    : canonicalTeam;

  let parsedAiTools = aiTools !== undefined
    ? (Array.isArray(aiTools) ? aiTools : aiTools ? [aiTools] : [])
    : project.aiTools;
  if (Array.isArray(parsedAiTools) && parsedAiTools.includes('Other') && aiToolOther && aiToolOther.trim()) {
    parsedAiTools = parsedAiTools.filter((t) => t !== 'Other');
    parsedAiTools.push(aiToolOther.trim());
  }

  project.title = title ? title.trim() : project.title;
  project.description = description !== undefined ? description : project.description;
  project.category = CATEGORIES.includes(category) ? category : project.category;
  project.canonicalTeam = resolvedTeam || project.canonicalTeam;
  project.aiTools = parsedAiTools;
  project.techStack = techStack ? techStack.split(',').map((t) => t.trim()).filter(Boolean) : project.techStack;
  project.completionStage = completionStage || project.completionStage;
  project.repoLinks = Array.isArray(repoLinks) ? repoLinks.filter(Boolean) : repoLinks ? [repoLinks] : project.repoLinks;
  project.demoUrl = demoUrl !== undefined ? demoUrl : project.demoUrl;
  project.slidesUrl = slidesUrl !== undefined ? slidesUrl : project.slidesUrl;

  // Only change status to submitted (not finalist — that's admin-only)
  if (status === 'submitted' && project.status === 'draft') {
    project.status = 'submitted';
    await project.save();
    notifyProjectSubmitted(project, process.env.BASE_URL || 'http://localhost:8080').catch(() => {});
    req.flash('success', { msg: 'Project submitted! Good luck!' });
    return res.redirect(`/projects/${project.slug}`);
  }
  if (status === 'draft' && project.status === 'submitted' && req.user.role === 'admin') project.status = 'draft';

  await project.save();
  req.flash('success', { msg: 'Project updated.' });
  res.redirect(`/projects/${project.slug}`);
};

/**
 * DELETE /projects/:id
 */
exports.remove = async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (project.status === 'submitted' || project.status === 'finalist') {
    return res.status(400).json({ error: 'Cannot delete a submitted project. Ask an admin.' });
  }
  await Project.deleteOne({ _id: project._id });
  await Vote.deleteMany({ project: project._id });
  res.json({ success: true, message: `Project "${project.title}" deleted.` });
};

/**
 * POST /projects/:id/vote
 */
exports.vote = async (req, res) => {
  try {
    const stars = parseInt(req.body.stars, 10);
    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Stars must be 1-5.' });
    }

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const prevCount = project.voteCount;

    await Vote.findOneAndUpdate(
      { user: req.user._id, project: project._id },
      { $set: { stars } },
      { upsert: true },
    );

    const agg = await Vote.aggregate([
      { $match: { project: project._id } },
      { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
    ]);

    project.avgRating = agg[0]?.avg || 0;
    project.voteCount = agg[0]?.count || 0;
    await project.save();

    const MILESTONES = [5, 10, 25, 50];
    const hit = MILESTONES.find((m) => prevCount < m && project.voteCount >= m);
    if (hit) {
      notifyVotingMilestone(project, hit, process.env.BASE_URL || 'http://localhost:8080').catch(() => {});
    }

    res.json({ avgRating: project.avgRating, voteCount: project.voteCount, userStars: stars });
  } catch (err) {
    console.error('Vote error:', err);
    res.status(500).json({ error: 'Vote failed. Please try again.' });
  }
};

/**
 * POST /projects/:id/media
 */
exports.addMedia = async (req, res, _next) => {
  // Auth check BEFORE multer processes any uploaded file
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user || null });
  if (!canEdit(project, req.user)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Forbidden.', user: req.user || null });
  }

  upload(req, res, async (err) => {
    if (err) {
      req.flash('errors', { msg: err.message });
      return res.redirect(`/projects/${req.params.id}/edit`);
    }

    if (req.file) {
      project.logo = `/uploads/${req.file.filename}`;
    }

    const { castId, castTitle, videoUrl, videoTitle, removeAsciinemaId, removeVideoId } = req.body;

    if (videoUrl && videoUrl.trim() && !isValidVideoUrl(videoUrl)) {
      req.flash('errors', { msg: 'Invalid video URL. Please use a YouTube (youtube.com/watch?v=... or youtu.be/...) or Vimeo (vimeo.com/...) link.' });
      return res.redirect(`/projects/${req.params.id}/edit`);
    }
    if (castId) {
      if (project.asciinema.length >= 3) {
        req.flash('errors', { msg: 'Maximum 3 asciinema recordings allowed. Remove one before adding another.' });
        return res.redirect(`/projects/${req.params.id}/edit`);
      }
      project.asciinema.push({ castId: parseCastId(castId), title: castTitle || '' });
    }
    if (videoUrl && videoUrl.trim()) {
      if (project.videos.length >= 3) {
        req.flash('errors', { msg: 'Maximum 3 videos allowed. Remove one before adding another.' });
        return res.redirect(`/projects/${req.params.id}/edit`);
      }
      project.videos.push({ url: videoUrl.trim(), title: videoTitle || '', type: detectVideoType(videoUrl) });
    }
    if (removeAsciinemaId) {
      project.asciinema = project.asciinema.filter((c) => c.castId !== removeAsciinemaId);
    }
    if (removeVideoId) {
      project.videos = project.videos.filter((v) => v._id.toString() !== removeVideoId);
    }

    await project.save();
    req.flash('success', { msg: 'Media updated.' });
    res.redirect(`/projects/${req.params.id}/edit`);
  });
};

/**
 * POST /projects/:id/team
 */
exports.updateTeam = async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { addEmail, removeUserId } = req.body;

  if (addEmail) {
    const email = addEmail.toLowerCase().trim();
    if (!email.endsWith('@canonical.com')) {
      return res.status(400).json({ error: 'Only @canonical.com members can be added.' });
    }
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: `No account found for ${email}. They must log in first.` });
    if (!project.team.some((id) => id.toString() === user._id.toString())) {
      project.team.push(user._id);
      await project.save();
    }
    return res.json({ success: true, name: user.profile.name, id: user._id });
  }

  if (removeUserId && removeUserId !== project.owner.toString()) {
    project.team = project.team.filter((id) => id.toString() !== removeUserId);
    await project.save();
    return res.json({ success: true });
  }

  res.status(400).json({ error: 'Nothing to do.' });
};

/**
 * GET /projects/mine
 */
exports.mine = async (req, res) => {
  const projects = await Project.find({ team: req.user._id })
    .sort({ updatedAt: -1 })
    .populate('owner', 'profile.name')
    .lean();
  projects.forEach((p) => { p.liveliness = computeLiveliness(p); });
  res.render('projects/mine', { title: 'My Projects', projects });
};

/**
 * POST /projects/:id/join
 */
exports.joinProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const userId = req.user._id.toString();
    if (!project.team.some((id) => id.toString() === userId)) {
      project.team.push(req.user._id);
      await project.save();
    }

    // Auto-update user's canonicalTeam if unset and project has one
    if (!req.user.canonicalTeam && project.canonicalTeam) {
      await User.findByIdAndUpdate(req.user._id, { canonicalTeam: project.canonicalTeam });
    }

    res.json({ success: true, memberCount: project.team.length });
  } catch (err) {
    console.error('Join error:', err);
    res.status(500).json({ error: 'Could not join project.' });
  }
};

/**
 * POST /projects/:id/leave
 */
exports.leaveProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    // Owner cannot leave their own project
    if (project.owner.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Project owner cannot leave. Delete the project instead.' });
    }

    project.team = project.team.filter((id) => id.toString() !== req.user._id.toString());
    await project.save();
    res.json({ success: true, memberCount: project.team.length });
  } catch (err) {
    console.error('Leave error:', err);
    res.status(500).json({ error: 'Could not leave project.' });
  }
};
