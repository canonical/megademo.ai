/**
 * MegaDemo.ai — Express application entry point
 */
const path   = require('node:path');
const fs     = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const errorHandler = require('errorhandler');
const lusca = require('lusca');
const helmet = require('helmet');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { flash } = require('./config/flash');

// Ensure uploads directory exists (must be done before static/multer setup)
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Pre-parse get-started guide once at startup (reloaded on each deploy)
const { marked } = require('marked');
let getStartedHtml = (() => {
  try {
    return marked.parse(fs.readFileSync(path.join(__dirname, 'content', 'get-started.md'), 'utf8'));
  } catch { return '<p>Guide not available.</p>'; }
})();

const adminGuideHtml = (() => {
  try {
    return marked.parse(fs.readFileSync(path.join(__dirname, 'content', 'admin-guide.md'), 'utf8'));
  } catch { return '<p>Guide not available.</p>'; }
})();

try {
  process.loadEnvFile('.env');
} catch (err) {
  if (err && err.code !== 'ENOENT') {
    console.error('Error loading .env file:', err);
  }
}

const secureTransfer = (process.env.BASE_URL || '').startsWith('https');

if (secureTransfer && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production.');
  process.exit(1);
}

/** Safely embed arbitrary data as JSON inside a <script> tag */
function safeJson(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\//g, '\\u002f')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const RATE_LIMIT_GLOBAL = parseInt(process.env.RATE_LIMIT_GLOBAL, 10) || 500;
const RATE_LIMIT_AUTH   = parseInt(process.env.RATE_LIMIT_AUTH,   10) || 20;

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_GLOBAL,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: RATE_LIMIT_AUTH,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Controllers
 */
const homeController    = require('./controllers/home');
const authController    = require('./controllers/auth');
const { resolveAuthMode, resolveLoginUrl } = require('./controllers/auth');
const projectController = require('./controllers/project');

/**
 * Passport config
 */
require('./config/passport');

/**
 * OIDC client init — moved into startServer() below so it completes before
 * the HTTP server begins accepting connections (eliminates the race window).
 */
const { initOidcClient } = require('./config/oidc');

/**
 * Mattermost daily summary cron — fires 3× per day at 08:00, 12:00, 17:00 UTC.
 * Override times via SUMMARY_CRON env var (standard cron expression).
 * Set SUMMARY_CRON=disabled to turn it off entirely.
 */
if (process.env.SUMMARY_CRON !== 'disabled') {
  const cron = require('node-cron');
  const { runSummary } = require('./scripts/daily-summary');
  const cronExpr = process.env.SUMMARY_CRON || '0 8,12,17 * * *';
  cron.schedule(cronExpr, () => {
    runSummary(process.env.BASE_URL || 'http://localhost:8080').catch((err) => {
      console.error('Daily summary cron failed:', err.message);
    });
  });
  console.log(`Daily summary scheduled: ${cronExpr} (UTC)`);
}

const app = express();

/**
 * Backfill totalStars on projects that existed before this field was added.
 * Runs once at startup; no-ops if all projects already have correct values.
 */
async function backfillTotalStars() {
  try {
    const { Project } = require('./models/Project');
    const Vote = require('./models/Vote');
    // Find projects with votes but totalStars still 0 (un-migrated)
    const stale = await Project.find({ voteCount: { $gte: 1 }, totalStars: 0 }).select('_id').lean();
    if (!stale.length) return;
    const ids = stale.map((p) => p._id);
    const aggs = await Vote.aggregate([
      { $match: { project: { $in: ids } } },
      { $group: { _id: '$project', total: { $sum: '$stars' } } },
    ]);
    await Promise.all(aggs.map(({ _id, total }) => Project.updateOne({ _id }, { $set: { totalStars: total } })));
    console.log(`Backfilled totalStars for ${aggs.length} project(s).`);
  } catch (err) {
    console.error('totalStars backfill failed (non-fatal):', err.message);
  }
}

/**
 * Database
 */
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo', { maxPoolSize: 15 })
  .then(async () => {
    await require('./scripts/seed-defaults').seedDefaults();
    // Backfill totalStars for any project that has votes but totalStars is still 0
    await backfillTotalStars();
  })
  .catch((err) => {
    console.error('MongoDB initial connection failed:', err.message);
    console.error('Set MONGODB_URI to a valid MongoDB connection string (e.g. MongoDB Atlas).');
    process.exit(1);
  });
mongoose.connection.on('error', (err) => {
  console.error('MongoDB runtime error:', err.message);
});

/**
 * Express configuration
 */
app.set('host', process.env.HOST || '0.0.0.0');
app.set('port', process.env.PORT || 8080);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.use(compression());
app.disable('x-powered-by');

// Generate a fresh nonce per request — must run BEFORE Helmet so CSP can embed it
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'wasm-unsafe-eval'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc:        ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      imgSrc:          ["'self'", 'data:', 'https:'],
      fontSrc:         ["'self'", 'https://fonts.gstatic.com'],
      connectSrc:      ["'self'", 'https://asciinema.org'],
      frameSrc:        ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://drive.google.com'],
      objectSrc:       ["'none'"],
      baseUri:         ["'self'"],
      formAction:      ["'self'"],
      frameAncestors:  ["'none'"],
    },
  },
  hsts: secureTransfer ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Render.com places 2 proxies in front of the app (edge + internal LB).
// Setting trust proxy to 2 ensures express-rate-limit reads the real
// client IP from X-Forwarded-For rather than Render's internal proxy IP
// (which would collapse all users into one rate-limit bucket).
const numberOfProxies = secureTransfer ? 2 : 0;
app.set('trust proxy', numberOfProxies);

app.use(
  session({
    resave: false,
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET || 'megademo-dev-secret-do-not-use-in-prod',
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo',
      collectionName: 'sessions', // must match SESSION_COLLECTION in controllers/admin.js
      touchAfter: 3600, // only re-save session once per hour if unchanged
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      httpOnly: true,
      secure: secureTransfer,
      sameSite: 'lax',
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
// Exclude OAuth paths from CSRF. The media upload route uses multipart/form-data
// which bypasses req.body parsing, so it sends the token in the X-CSRF-Token header
// via a JavaScript fetch (see edit.pug .media-subform submit handler).
const csrfMiddleware = lusca.csrf();
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  // /admin/homepage POST uses multipart/form-data; multer must parse the body
  // before the CSRF token is readable. The controller applies CSRF manually.
  if (req.method === 'POST' && req.path === '/admin/homepage') return next();
  csrfMiddleware(req, res, next);
});
app.use(globalLimiter);

/**
 * Asset version string for cache-busting CSS/JS URLs.
 * Uses the current git commit SHA (first 8 chars) so the query string
 * changes on every deploy, forcing browsers to re-fetch static assets
 * despite the 1-day maxAge set on express.static.
 */
const ASSET_VERSION = (() => {
  try {
    return require('node:child_process')
      .execSync('git rev-parse --short=8 HEAD', { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return Date.now().toString(36);
  }
})();

/**
 * Locals available in all templates
 */
app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.safeJson = safeJson;
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.loginUrl = resolveLoginUrl();
  next();
});

/**
 * registrationOpen — cached with a 60s TTL to avoid a DB lookup on every request.
 * Used by all templates that render add-project controls (header, home, mine).
 */
const _regOpenCache = { value: true, expiresAt: 0 };
app.use(async (req, res, next) => {
  try {
    const now = Date.now();
    if (now >= _regOpenCache.expiresAt) {
      const Settings = require('./models/Settings');
      const hackathonStart = await Settings.get('hackathonStart');
      const startTs        = hackathonStart ? Date.parse(hackathonStart) : NaN;
      // Registration is open when no valid start is set, or when now >= start
      _regOpenCache.value     = isNaN(startTs) || now >= startTs;
      _regOpenCache.expiresAt = now + 60_000;
    }
    res.locals.registrationOpen = _regOpenCache.value;
  } catch {
    res.locals.registrationOpen = true; // fail open
  }
  next();
});

/**
 * announcementBanner — fetches and renders the banner markdown on every request.
 * Cached for 10s so admins see updates quickly without hammering the DB.
 */
const _bannerCache = { html: null, expiresAt: 0 };
app.use(async (req, res, next) => {
  try {
    const now = Date.now();
    if (now >= _bannerCache.expiresAt) {
      const Settings = require('./models/Settings');
      const text = await Settings.get('announcementBanner');
      _bannerCache.html      = text ? marked.parse(String(text)) : null;
      _bannerCache.expiresAt = now + 10_000;
    }
    res.locals.announcementBannerHtml = _bannerCache.html;
  } catch {
    res.locals.announcementBannerHtml = null;
  }
  next();
});

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

/**
 * Global authentication gate — active in production (both GitHub OAuth and OIDC).
 * Gates the entire site: every request (except /auth/*) requires
 * an authenticated session. Unauthenticated users are redirected to the
 * login flow with their intended URL saved for post-login redirect.
 *
 * In local dev, individual route guards (isAuthenticated) handle access control.
 */
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth/') || req.path === '/health') return next();
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect(resolveLoginUrl());
    }
    next();
  });
}

/**
 * Routes
 */
// Health check — must be before auth gate, no rate limiting, no session needed
app.get('/health', (req, res) => res.sendStatus(200));

// Auth
app.get('/auth/github', authLimiter, authController.githubLogin);
app.get('/auth/github/callback', authLimiter, authController.githubCallback);
app.get('/auth/oidc', authLimiter, authController.oidcLogin);
app.get('/auth/oidc/callback', authLimiter, authController.oidcCallback);
app.get('/auth/signed-out', authController.signedOut);
app.post('/logout', authController.logout);

// Dev-only bypass login — disabled in production
if (process.env.NODE_ENV !== 'production') {
  app.get('/auth/dev-login', authController.devLoginForm);
  app.post('/auth/dev-login', authController.devLogin);
}

// Token-gated test login — active on prod when TEST_LOGIN_TOKEN is set
app.get('/auth/test-login', authLimiter, authController.testLogin);

// Home
app.get('/', homeController.index);

// Get Started guide (cached at startup — reloaded on deploy via process restart)
app.get('/get-started', (req, res) => {
  res.render('get-started', { title: 'Get Started', content: getStartedHtml });
});

// Projects
app.get('/api/users/search', authController.isAuthenticated, projectController.searchUsers);
app.get('/projects', projectController.list);
app.get('/projects/mine', authController.isAuthenticated, projectController.mine);
app.get('/projects/new', authController.isAuthenticated, projectController.newForm);
app.post('/projects', authController.isAuthenticated, projectController.create);
app.get('/projects/:slug', projectController.detail);
app.get('/projects/:id/edit', authController.isAuthenticated, projectController.editForm);
app.post('/projects/:id', authController.isAuthenticated, projectController.update);
app.delete('/projects/:id', authController.isAuthenticated, projectController.remove);
app.post('/projects/:id/vote', authController.isAuthenticated, projectController.vote);
app.post('/projects/:id/media', authController.isAuthenticated, projectController.addMedia);
app.post('/projects/:id/team', authController.isAuthenticated, projectController.updateTeam);
app.post('/projects/:id/join', authController.isAuthenticated, projectController.joinProject);
app.post('/projects/:id/leave', authController.isAuthenticated, projectController.leaveProject);

// Admin
const adminController = require('./controllers/admin');
app.get('/admin', authController.isAdmin, adminController.dashboard);
app.get('/admin/guide', authController.isAdmin, (req, res) => {
  res.render('admin/guide', { title: 'Admin Guide', content: adminGuideHtml });
});
app.get('/admin/projects', authController.isAdmin, adminController.projects);
app.post('/admin/projects/:id/status', authController.isAdmin, adminController.setStatus);
app.post('/admin/projects/:id/delete', authController.isAdmin, adminController.deleteProject);
app.post('/admin/projects/:id/mock-github', authController.isAdmin, adminController.mockGithubStats);
app.get('/admin/users', authController.isAdmin, adminController.users);
app.post('/admin/users/clear-sessions', authController.isAdmin, adminController.clearSessions);
app.post('/admin/users/:id/role', authController.isAdmin, adminController.setRole);
app.get('/admin/export', authController.isAdmin, adminController.exportCsv);
app.get('/admin/activity-log', authController.isAdmin, adminController.activityLog);
app.get('/admin/homepage', authController.isAdmin, adminController.homepageSettings);
app.post('/admin/homepage', authController.isAdmin, adminController.saveHomepageSettings);
app.post('/admin/settings', authController.isAdmin, adminController.saveSettings);
app.get('/admin/teams', authController.isAdmin, adminController.teamsPage);
app.post('/admin/teams', authController.isAdmin, adminController.saveTeams);
app.post('/admin/teams/add', authController.isAdmin, adminController.addTeam);
app.post('/admin/teams/:name/rename', authController.isAdmin, adminController.renameTeam);
app.post('/admin/teams/:name/delete', authController.isAdmin, adminController.deleteTeam);
app.get('/admin/tags', authController.isAdmin, adminController.tagsPage);
app.post('/admin/tags/ai-tools', authController.isAdmin, adminController.addAiTool);
app.post('/admin/tags/ai-tools/rename', authController.isAdmin, adminController.renameAiTool);
app.post('/admin/tags/ai-tools/delete', authController.isAdmin, adminController.deleteAiTool);
app.post('/admin/tags/tech-stack', authController.isAdmin, adminController.addTechStack);
app.post('/admin/tags/tech-stack/rename', authController.isAdmin, adminController.renameTechStack);
app.post('/admin/tags/tech-stack/delete', authController.isAdmin, adminController.deleteTechStack);
app.post('/admin/reset', authController.isAdmin, adminController.resetAll);

// Kiosk
const kioskController = require('./controllers/kiosk');
app.get('/kiosk', authController.isAuthenticated, kioskController.index);
app.get('/kiosk/:slug', authController.isAuthenticated, kioskController.project);

/**
 * Error handler
 */
if (process.env.NODE_ENV === 'development') {
  app.use(errorHandler());
} else {
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).render('error', {
      title: 'Server Error',
      message: 'Something went wrong.',
      user: req.user || null,
    });
  });
}

if (require.main === module) {
  (async () => {
    if (resolveAuthMode() === 'oidc') {
      await initOidcClient();
    }
    app.listen(app.get('port'), app.get('host'), () => {
      console.log(`MegaDemo.ai running on http://${app.get('host')}:${app.get('port')}`);
      console.log(`Uploads directory: ${UPLOADS_DIR}${process.env.UPLOADS_DIR ? '' : ' (fallback — UPLOADS_DIR not set)'}`);
    });
  })().catch((err) => {
    console.error('FATAL: Server startup failed:', err.message);
    process.exit(1);
  });
}

module.exports = app;
module.exports.bustBannerCache = () => { _bannerCache.expiresAt = 0; };
