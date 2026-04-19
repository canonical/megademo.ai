/**
 * Auth controller — GitHub OAuth flow
 */
const crypto = require('node:crypto');
const passport = require('passport');
const User = require('../models/User');

/**
 * Middleware: require authenticated user
 */
exports.isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  // AJAX/JSON requests get 401 instead of a redirect (redirect → CORS error in fetch)
  const wantsJson = req.headers['content-type']?.includes('application/json')
    || req.headers.accept?.includes('application/json');
  if (wantsJson) return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  req.session.returnTo = req.originalUrl;
  const loginUrl = process.env.NODE_ENV !== 'production' ? '/auth/dev-login' : '/auth/github';
  res.redirect(loginUrl);
};

/**
 * Middleware: require admin role
 */
exports.isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  const wantsJson = req.headers['content-type']?.includes('application/json')
    || req.headers.accept?.includes('application/json');
  if (!req.isAuthenticated()) {
    if (wantsJson) return res.status(401).json({ error: 'Authentication required.' });
    req.session.returnTo = req.originalUrl;
    const loginUrl = process.env.NODE_ENV !== 'production' ? '/auth/dev-login' : '/auth/github';
    return res.redirect(loginUrl);
  }
  if (wantsJson) return res.status(403).json({ error: 'Admin access required.' });
  res.status(403).render('error', { title: 'Access Denied', message: 'Admin access required.' });
};

/**
 * GET /auth/github
 */
exports.githubLogin = passport.authenticate('github', { scope: ['user:email', 'read:org'] });

/**
 * GET /auth/github/callback
 */
exports.githubCallback = (req, res, next) => {
  passport.authenticate('github', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/');
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  })(req, res, next);
};

/**
 * GET /logout
 */
exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
};

/**
 * GET /auth/dev-login — dev-only login form (disabled in production)
 */
exports.devLoginForm = (req, res) => {
  res.render('dev-login', { title: 'Dev Login' });
};

/**
 * GET /auth/test-login — token-gated test user login for production testing.
 * Enabled only when TEST_LOGIN_TOKEN env var is set.
 * Usage: /auth/test-login?token=SECRET[&role=participant|admin]
 */
exports.testLogin = async (req, res, next) => {
  const configuredToken = process.env.TEST_LOGIN_TOKEN;
  if (!configuredToken) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Page not found.', user: null });
  }
  if (!req.query.token || (() => {
    try {
      const a = Buffer.from(req.query.token);
      const b = Buffer.from(configuredToken);
      return a.length !== b.length || !crypto.timingSafeEqual(a, b);
    } catch { return true; }
  })()) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid test login token.', user: null });
  }

  const ALLOWED_ROLES = ['participant', 'admin'];
  const role = ALLOWED_ROLES.includes(req.query.role) ? req.query.role : 'participant';
  const email = `test-${role}@megademo-test.local`;

  try {
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        email,
        github: `test-synthetic-${role}`,
        githubLogin: `test-${role}`,
        role,
        profile: { name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`, picture: '' },
      });
    } else {
      user.role = role;
    }
    await user.save();

    req.logIn(user, (err) => {
      if (err) return next(err);
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) { next(err); }
};

/**
 * POST /auth/dev-login — process dev login form (disabled in production)
 */
exports.devLogin = async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
  }
  const ALLOWED_ROLES = ['participant', 'admin', 'organizer'];
  try {
    const { handle = 'dev-user', role = 'participant', team = null } = req.body;
    if (!handle || typeof handle !== 'string' || handle.length > 50 || !/^[\w-]+$/.test(handle)) {
      return res.status(400).render('error', { title: 'Invalid Input', message: 'Invalid handle.' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).render('error', { title: 'Invalid Input', message: 'Invalid role.' });
    }
    const email = `${handle}@canonical.com`;
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        email,
        github: `dev-${handle}`,
        githubLogin: handle,
        role,
        canonicalTeam: team || null,
        profile: { name: handle, picture: '' },
      });
      await user.save();
    } else {
      user.role = role;
      if (team) user.canonicalTeam = team;
      await user.save();
    }
    req.logIn(user, (err) => {
      if (err) return next(err);
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) { next(err); }
};
