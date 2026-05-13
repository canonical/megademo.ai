/**
 * Project controller — CRUD, voting, media
 */
const multer = require('multer');
const path = require('node:path');
const { verifyImageMagicBytes } = require('../services/imageTypeCheck');
const { Project, CATEGORIES, AI_TOOLS, CANONICAL_TEAMS, TECH_STACK_DEFAULTS, COMPLETION_STAGES, computeLiveliness } = require('../models/Project');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../public/uploads');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Reject javascript:, data:, vbscript: etc. — only http/https are safe in user-facing links. */
function isSafeUrl(url) {
  if (!url || !url.trim()) return true;
  try {
    const { protocol } = new URL(url.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch { return false; }
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
const { logActivity } = require('../services/activityLog');

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
 * Take a lightweight snapshot of fields we want to diff for activity logging.
 * Called before mutations are applied to `project`.
 */
function snapshotProject(project) {
  return {
    title:         project.title,
    category:      project.category,
    canonicalTeam: project.canonicalTeam,
    status:        project.status,
    hasLogo:       !!project.logo,
    aiTools:       [...(project.aiTools || [])].sort(),
    techStack:     [...(project.techStack || [])].sort(),
    teamIds:       (project.team || []).map((m) => (m._id || m).toString()),
    asciinemaCount: (project.asciinema || []).length,
    videoCount:    (project.videos || []).length,
  };
}

/**
 * Compute human-readable change descriptions by comparing a snapshot to the
 * saved project. Returns an array of strings.
 */
function diffProject(old, project) {
  const changes = [];
  if (project.title !== old.title)
    changes.push(`title changed to '${project.title}'`);
  if (project.category !== old.category)
    changes.push(`category changed to '${project.category}'`);
  if (project.canonicalTeam !== old.canonicalTeam)
    changes.push(`canonical team changed to '${project.canonicalTeam}'`);
  if (project.status !== old.status)
    changes.push(`status changed to '${project.status}'`);
  if (!old.hasLogo && project.logo)
    changes.push('uploaded logo');
  const newAiTools = [...(project.aiTools || [])].sort();
  for (const t of newAiTools) { if (!old.aiTools.includes(t)) changes.push(`added AI tool '${t}'`); }
  for (const t of old.aiTools)  { if (!newAiTools.includes(t)) changes.push(`removed AI tool '${t}'`); }
  const newTech = [...(project.techStack || [])].sort();
  for (const t of newTech)       { if (!old.techStack.includes(t)) changes.push(`added tech '${t}'`); }
  for (const t of old.techStack) { if (!newTech.includes(t)) changes.push(`removed tech '${t}'`); }
  const newTeamIds = (project.team || []).map((m) => (m._id || m).toString());
  for (const id of newTeamIds) { if (!old.teamIds.includes(id)) changes.push('added team member'); }
  for (const id of old.teamIds) { if (!newTeamIds.includes(id)) changes.push('removed team member'); }
  if ((project.asciinema || []).length > old.asciinemaCount)
    changes.push('added asciinema recording');
  if ((project.asciinema || []).length < old.asciinemaCount)
    changes.push('removed asciinema recording');
  if ((project.videos || []).length > old.videoCount)
    changes.push('added video');
  if ((project.videos || []).length < old.videoCount)
    changes.push('removed video');
  return changes;
}

/**
 * Validate a YouTube, Vimeo, or Google Drive video URL.
 * YouTube: watch?v=..., youtu.be/..., youtube.com/embed/..., youtube-nocookie.com/embed/...
 * Vimeo:   vimeo.com/NUMERIC_ID
 * Drive:   drive.google.com/file/d/FILE_ID/...
 */
function isValidVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' && u.searchParams.get('v')) return true;
    if (host === 'youtube.com' && /^\/embed\/[A-Za-z0-9_-]{11}/.test(u.pathname)) return true;
    if (host === 'youtube-nocookie.com' && /^\/embed\/[A-Za-z0-9_-]{11}/.test(u.pathname)) return true;
    if (host === 'youtu.be' && u.pathname.length > 1) return true;
    if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return true;
    if (host === 'drive.google.com' && /^\/file\/d\/[A-Za-z0-9_-]+/.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function detectVideoType(url) {
  try {
    const host = new URL((url || '').trim()).hostname.replace(/^www\./, '');
    if (host === 'vimeo.com') return 'vimeo';
    if (host === 'drive.google.com') return 'gdrive';
  } catch { /* fall through */ }
  return 'youtube';
}

// Multer config for logo uploads
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = req.params.id || req.user._id;
    cb(null, `logo-${id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (.jpg, .jpeg, .png, .gif, .webp) are allowed.'));
    }
  },
}).single('logo');

const PROJECT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const PROJECT_IMAGE_ERROR = 'Only image files (.jpg, .jpeg, .png, .gif, .webp) are allowed.';

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
  // Allowlist category and team to prevent NoSQL operator injection via qs
  const ALLOWED_SORTS = ['newest', 'rating', 'votes'];
  const sort     = ALLOWED_SORTS.includes(req.query.sort) ? req.query.sort : 'newest';
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : undefined;
  const team     = typeof req.query.team === 'string' && req.query.team.trim() ? req.query.team.trim() : undefined;
  const filter = { status: { $in: ['submitted', 'finalist'] } };
  if (category) filter.category = category;
  if (team) filter.canonicalTeam = team;

  const sortMap = {
    newest:  { createdAt: -1 },
    rating:  { totalStars: -1, avgRating: -1 },
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
  const hackathonStart = await Settings.get('hackathonStart');
  if (hackathonStart && Date.now() < new Date(hackathonStart).getTime()) {
    req.flash('errors', { msg: 'Project registration is not open yet — it opens when the hackathon starts.' });
    return res.redirect('/');
  }
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
  const hackathonStart = await Settings.get('hackathonStart');
  if (hackathonStart && Date.now() < new Date(hackathonStart).getTime()) {
    req.flash('errors', { msg: 'Project registration is not open yet — it opens when the hackathon starts.' });
    return res.redirect('/');
  }

  // Parse multipart body (handles logo file upload); must run before reading req.body
  try {
    await new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())));
    await verifyImageMagicBytes(req.file, PROJECT_IMAGE_MIMES, PROJECT_IMAGE_ERROR);
  } catch (err) {
    return res.status(400).json({ errors: [{ msg: err.message }] });
  }

  const { title, description, category, canonicalTeam, customTeam, aiTools, aiToolOther, techStack, completionStage, repoLinks, demoUrl, slidesUrl, teamEmails, asciinemaId, asciinemaTitle, videoUrl, videoTitle } = req.body;
  const errors = [];

  if (!title || title.trim().length < 3) errors.push({ msg: 'Title must be at least 3 characters.' });
  if (!category || !CATEGORIES.includes(category)) errors.push({ msg: 'Please select a valid category.' });
  if (videoUrl && videoUrl.trim() && !isValidVideoUrl(videoUrl)) {
    errors.push({ msg: 'Invalid video URL. Please use a YouTube, Vimeo, or Google Drive link.' });
  }
  const repoLinksArr = Array.isArray(repoLinks) ? repoLinks.filter(Boolean) : repoLinks ? [repoLinks] : [];
  if (repoLinksArr.some((l) => !isSafeUrl(l)) || !isSafeUrl(demoUrl) || !isSafeUrl(slidesUrl)) {
    errors.push({ msg: 'Links must use http:// or https://.' });
  }
  if (title && title.trim().length >= 3) {
    const existing = await Project.findOne({ title: new RegExp(`^${escapeRegex(title.trim())}$`, 'i') });
    if (existing) errors.push({ msg: `A project named "${title.trim()}" is already registered. Please choose a different name.` });
  }

  if (errors.length) {
    return res.status(422).json({ errors });
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
    techStack: techStack ? (Array.isArray(techStack) ? techStack : techStack.split(',')).map((t) => t.trim()).filter(Boolean) : [],
    completionStage: completionStage || 'prototype',
    repoLinks: Array.isArray(repoLinks) ? repoLinks.filter(Boolean) : repoLinks ? [repoLinks] : [],
    demoUrl: demoUrl || '',
    slidesUrl: slidesUrl || '',
    owner: req.user._id,
    team: [req.user._id],
    logo: req.file ? `/uploads/${req.file.filename}` : undefined,
  });

  // Optional: add asciinema cast from registration form
  if (asciinemaId && asciinemaId.trim()) {
    project.asciinema.push({ castId: parseCastId(asciinemaId), title: (asciinemaTitle || '').trim() });
  }

  // Optional: add video from registration form
  if (videoUrl && videoUrl.trim()) {
    project.videos.push({ url: videoUrl.trim(), title: (videoTitle || '').trim(), type: detectVideoType(videoUrl) });
  }

  const isDraft = req.body.submitAction === 'draft';
  project.status = isDraft ? 'draft' : 'submitted';
  await project.save();

  // Optional: add team members by email (best-effort; skip unrecognised)
  if (teamEmails && teamEmails.trim()) {
    const emails = teamEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    for (const email of emails) {
      const member = await User.findOne({ email }).collation({ locale: 'en', strength: 2 });
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
  logActivity(req.user.email, `${isDraft ? 'Saved draft project' : 'Submitted project'} '${project.title}'`).catch(() => {});
  const redirectUrl = isDraft ? '/projects/mine' : `/projects/${project.slug}`;
  return res.json({ redirect: redirectUrl });
};

/**
 * GET /projects/:slug
 */
exports.detail = async (req, res) => {
  const project = await Project.findOne({ slug: req.params.slug })
    .populate('owner', 'profile.name profile.picture email')
    .populate('team', 'profile.name profile.picture email');

  if (!project) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user || null });
  }

  // Draft projects are only visible to their team members and admins
  if (project.status === 'draft') {
    const isTeamMember = req.user && (
      project.owner._id.toString() === req.user._id.toString() ||
      project.team.some((m) => m._id.toString() === req.user._id.toString())
    );
    if (!isTeamMember && req.user?.role !== 'admin') {
      return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.', user: req.user || null });
    }
  }
  let userVote = 0;
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

  // Parse multipart body (file upload) only after auth check to prevent
  // unauthorized users from writing files to disk.
  try {
    await new Promise((resolve, reject) => upload(req, res, (err) => (err ? reject(err) : resolve())));
    await verifyImageMagicBytes(req.file, PROJECT_IMAGE_MIMES, PROJECT_IMAGE_ERROR);
  } catch (err) {
    req.flash('errors', { msg: err.message });
    return res.redirect(`/projects/${project._id}/edit`);
  }

  const { title, description, category, canonicalTeam, customTeam, aiTools, aiToolOther, techStack, completionStage, repoLinks, demoUrl, slidesUrl, status, castId, castTitle, videoUrl, videoTitle, teamEmails } = req.body;

  if (title !== undefined && title.trim().length < 3) {
    req.flash('errors', { msg: 'Title must be at least 3 characters.' });
    return res.redirect(`/projects/${project._id}/edit`);
  }

  // Validate URL fields (reject javascript:, data: etc.)
  const newRepoLinks = repoLinks !== undefined
    ? (Array.isArray(repoLinks) ? repoLinks.filter(Boolean) : repoLinks ? [repoLinks] : [])
    : null;
  const urlsToCheck = [...(newRepoLinks || []), demoUrl, slidesUrl].filter(Boolean);
  if (urlsToCheck.some((l) => !isSafeUrl(l))) {
    req.flash('errors', { msg: 'Links must use http:// or https://.' });
    return res.redirect(`/projects/${project._id}/edit`);
  }

  // Duplicate title check (excluding this project)
  if (title && title.trim() !== project.title) {
    const dup = await Project.findOne({
      title: new RegExp(`^${escapeRegex(title.trim())}$`, 'i'),
      _id: { $ne: project._id },
    });
    if (dup) {
      req.flash('errors', { msg: `A project named "${title.trim()}" is already registered.` });
      return res.redirect(`/projects/${project._id}/edit`);
    }
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

  // Snapshot before mutations for activity logging
  const oldSnap = snapshotProject(project);

  project.title = title ? title.trim() : project.title;
  project.description = description !== undefined ? description : project.description;
  project.category = CATEGORIES.includes(category) ? category : project.category;
  project.canonicalTeam = resolvedTeam || project.canonicalTeam;
  project.aiTools = parsedAiTools;
  project.techStack = techStack ? (Array.isArray(techStack) ? techStack : techStack.split(',')).map((t) => t.trim()).filter(Boolean) : project.techStack;
  project.completionStage = completionStage || project.completionStage;
  project.repoLinks = newRepoLinks !== null ? newRepoLinks : project.repoLinks;
  project.demoUrl = demoUrl !== undefined ? demoUrl : project.demoUrl;
  project.slidesUrl = slidesUrl !== undefined ? slidesUrl : project.slidesUrl;

  // Handle logo upload
  if (req.file) {
    project.logo = `/uploads/${req.file.filename}`;
  }

  // Handle new asciinema cast
  if (castId && castId.trim()) {
    if (project.asciinema.length >= 3) {
      req.flash('errors', { msg: 'Maximum 3 asciinema recordings allowed. Remove one before adding another.' });
      return res.redirect(`/projects/${project._id}/edit`);
    }
    project.asciinema.push({ castId: parseCastId(castId), title: castTitle || '' });
  }

  // Handle new video
  if (videoUrl && videoUrl.trim()) {
    if (!isValidVideoUrl(videoUrl)) {
      req.flash('errors', { msg: 'Invalid video URL. Please use a YouTube (youtube.com/watch?v=... or youtu.be/...) or Vimeo (vimeo.com/...) link.' });
      return res.redirect(`/projects/${project._id}/edit`);
    }
    if (project.videos.length >= 3) {
      req.flash('errors', { msg: 'Maximum 3 videos allowed. Remove one before adding another.' });
      return res.redirect(`/projects/${project._id}/edit`);
    }
    project.videos.push({ url: videoUrl.trim(), title: videoTitle || '', type: detectVideoType(videoUrl) });
  }

  // Handle new team members added by email
  const skippedEmails = [];
  const alreadyInTeamEmails = [];
  if (teamEmails && teamEmails.trim()) {
    const emails = teamEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    for (const email of emails) {
      // Case-insensitive lookup — IdPs may store emails with mixed case
      const member = await User.findOne({ email }).collation({ locale: 'en', strength: 2 });
      if (!member) {
        skippedEmails.push(email);
      } else if (!project.team.some((m) => (m._id || m).toString() === member._id.toString())) {
        project.team.push(member._id);
      } else {
        alreadyInTeamEmails.push(email);
      }
    }
  }

  // Only change status to submitted (not finalist — that's admin-only)
  if (status === 'submitted' && project.status === 'draft') {
    project.status = 'submitted';
    await project.save();
    notifyProjectSubmitted(project, process.env.BASE_URL || 'http://localhost:8080').catch(() => {});
    const changes = diffProject(oldSnap, project);
    const detail = changes.length ? `: ${changes.join(', ')}` : '';
    logActivity(req.user.email, `Submitted project '${project.title}'${detail}`).catch(() => {});
    req.flash('success', { msg: 'Project submitted! Good luck!' });
    if (skippedEmails.length) req.flash('errors', { msg: `These emails were not added (not registered on the site): ${skippedEmails.join(', ')}` });
    if (alreadyInTeamEmails.length) req.flash('info', { msg: `Already in team: ${alreadyInTeamEmails.join(', ')}` });
    return res.json({ redirect: `/projects/${project.slug}` });
  }
  if (status === 'draft' && project.status === 'submitted' && req.user.role === 'admin') project.status = 'draft';

  await project.save();
  const changes = diffProject(oldSnap, project);
  const detail = changes.length ? `: ${changes.join(', ')}` : ' (no changes)';
  logActivity(req.user.email, `Updated project '${project.title}'${detail}`).catch(() => {});
  req.flash('success', { msg: 'Project updated.' });
  if (skippedEmails.length) req.flash('errors', { msg: `These emails were not added (not registered on the site): ${skippedEmails.join(', ')}` });
  if (alreadyInTeamEmails.length) req.flash('info', { msg: `Already in team: ${alreadyInTeamEmails.join(', ')}` });
  return res.json({ redirect: `/projects/${project.slug}` });
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
  logActivity(req.user.email, `Deleted project '${project.title}'`).catch(() => {});
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
      { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 }, total: { $sum: '$stars' } } },
    ]);

    project.avgRating  = agg[0]?.avg   || 0;
    project.voteCount  = agg[0]?.count || 0;
    project.totalStars = agg[0]?.total || 0;
    await project.save();

    logActivity(req.user.email, `Voted ${stars}★ on project '${project.title}'`).catch(() => {});

    const MILESTONES = [5, 10, 25, 50];
    const hit = MILESTONES.find((m) => prevCount < m && project.voteCount >= m);
    if (hit) {
      notifyVotingMilestone(project, hit, process.env.BASE_URL || 'http://localhost:8080').catch(() => {});
    }

    res.json({ avgRating: project.avgRating, voteCount: project.voteCount, totalStars: project.totalStars, userStars: stars });
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

    try {
      await verifyImageMagicBytes(req.file, PROJECT_IMAGE_MIMES, PROJECT_IMAGE_ERROR);
    } catch (magicErr) {
      req.flash('errors', { msg: magicErr.message });
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
    const user = await User.findOne({ email }).collation({ locale: 'en', strength: 2 });
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
 * GET /api/users/search?q=<term>
 * Returns up to 10 canonical.com users matching name or email substring (for autocomplete).
 */
exports.searchUsers = async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const re = new RegExp(escapeRegex(q), 'i');
  const users = await User.find({
    $or: [{ email: re }, { 'profile.name': re }],
  }).select('email profile.name').limit(10).lean();
  res.json(users.map((u) => ({ email: u.email, name: u.profile?.name || u.email })));
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

    // Only allow joining submitted or finalist projects — drafts are not publicly listed
    if (project.status === 'draft') {
      return res.status(403).json({ error: 'Cannot join a draft project.' });
    }

    const userId = req.user._id.toString();
    if (!project.team.some((id) => id.toString() === userId)) {
      project.team.push(req.user._id);
      await project.save();
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
