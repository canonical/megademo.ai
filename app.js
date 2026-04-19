/**
 * MegaDemo.ai — Express application entry point
 */
const path = require('node:path');
const fs   = require('node:fs');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const errorHandler = require('errorhandler');
const lusca = require('lusca');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { flash } = require('./config/flash');

// Ensure uploads directory exists (must be done before static/multer setup)
fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });

// Pre-parse get-started guide once at startup (reloaded on each deploy)
const { marked } = require('marked');
let getStartedHtml = (() => {
  try {
    return marked.parse(fs.readFileSync(path.join(__dirname, 'content', 'get-started.md'), 'utf8'));
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
const projectController = require('./controllers/project');

/**
 * Passport config
 */
require('./config/passport');

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
 * Database
 */
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo')
  .then(() => require('./scripts/seed-defaults').seedDefaults())
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
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const numberOfProxies = secureTransfer ? 1 : 0;
app.set('trust proxy', numberOfProxies);

app.use(
  session({
    resave: false,
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET || 'megademo-dev-secret-do-not-use-in-prod',
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/megademo' }),
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
// Exclude OAuth paths and multipart media uploads from CSRF.
// Media uploads use multipart/form-data which req.urlencoded() can't parse, so
// req.body._csrf is unavailable when lusca runs. These routes are auth-protected.
const csrfMiddleware = lusca.csrf();
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (req.method === 'POST' && /^\/projects\/[^/]+\/media$/.test(req.path)) return next();
  csrfMiddleware(req, res, next);
});
app.use(globalLimiter);

/**
 * Locals available in all templates
 */
app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.safeJson = safeJson;
  res.locals.loginUrl = process.env.NODE_ENV !== 'production' ? '/auth/dev-login' : '/auth/github';
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

/**
 * Routes
 */
// Auth
app.get('/auth/github', authLimiter, authController.githubLogin);
app.get('/auth/github/callback', authLimiter, authController.githubCallback);
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
app.get('/admin/projects', authController.isAdmin, adminController.projects);
app.post('/admin/projects/:id/status', authController.isAdmin, adminController.setStatus);
app.post('/admin/projects/:id/delete', authController.isAdmin, adminController.deleteProject);
app.post('/admin/projects/:id/mock-github', authController.isAdmin, adminController.mockGithubStats);
app.get('/admin/users', authController.isAdmin, adminController.users);
app.post('/admin/users/:id/role', authController.isAdmin, adminController.setRole);
app.get('/admin/export', authController.isAdmin, adminController.exportCsv);
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
app.get('/kiosk', kioskController.index);
app.get('/kiosk/:slug', kioskController.project);

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
  app.listen(app.get('port'), app.get('host'), () => {
    console.log(`MegaDemo.ai running on http://${app.get('host')}:${app.get('port')}`);
  });
}

module.exports = app;
