/**
 * Auth controller — GitHub OAuth + OIDC (Canonical Identity Platform)
 *
 * Auth strategy selection:
 *   - dev (NODE_ENV !== 'production'):  /auth/dev-login  (bypasses OAuth entirely)
 *   - prod + AUTH_MODE=oidc:            /auth/oidc       (Canonical IdP via Hydra)
 *   - prod + anything else:             /auth/github     (direct GitHub OAuth)
 */
const crypto = require('node:crypto');
const passport = require('passport');
const User = require('../models/User');
const { generators } = require('openid-client');
const { getClient } = require('../config/oidc');
const { logActivity } = require('../services/activityLog');

/**
 * Return the effective auth mode: 'oidc' or 'github' (default).
 * AUTH_MODE=oidc activates Canonical IdP; everything else uses GitHub OAuth.
 * OIDC_ISSUER_URL is ignored unless AUTH_MODE=oidc.
 */
function resolveAuthMode() {
  return process.env.AUTH_MODE === 'oidc' ? 'oidc' : 'github';
}
exports.resolveAuthMode = resolveAuthMode;

/** Resolve the appropriate login URL for the current environment. */
function resolveLoginUrl() {
  if (process.env.NODE_ENV !== 'production') return '/auth/dev-login';
  if (resolveAuthMode() === 'oidc')           return '/auth/oidc';
  return '/auth/github';
}
exports.resolveLoginUrl = resolveLoginUrl;

/**
 * Validate a post-login return URL to prevent open redirect.
 * Accepts only same-origin relative paths (starts with '/' but not '//').
 */
function safeReturnTo(url) {
  // Accept '/' or paths like '/foo' — reject // and /\ (open-redirect bypass vectors)
  if (typeof url === 'string' && (url === '/' || /^\/[^/\\]/.test(url))) return url;
  return '/';
}

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
  const loginUrl = resolveLoginUrl();
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
    const loginUrl = resolveLoginUrl();
    return res.redirect(loginUrl);
  }
  if (wantsJson) return res.status(403).json({ error: 'Admin access required.' });
  res.status(403).render('error', { title: 'Access Denied', message: 'Admin access required.' });
};

/**
 * Regenerate the session to prevent session fixation, preserving key data.
 * Must be called before req.logIn() in every authentication callback.
 */
function regenerateSession(req, cb) {
  const returnTo = req.session.returnTo;
  const csrfSecret = req.session._csrfSecret;
  req.session.regenerate((err) => {
    if (err) return cb(err);
    if (returnTo) req.session.returnTo = returnTo;
    if (csrfSecret) req.session._csrfSecret = csrfSecret;
    cb(null);
  });
}

/**
 * GET /auth/github
 */
exports.githubLogin = passport.authenticate('github', { scope: ['user:email', 'read:org'], state: true });

/**
 * GET /auth/github/callback
 */
exports.githubCallback = (req, res, next) => {
  passport.authenticate('github', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/');
    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        logActivity(user.email, 'Logged in (GitHub)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
    });
  })(req, res, next);
};

/**
 * POST /logout
 */
exports.logout = (req, res, next) => {
  const email = req.user?.email;
  req.logout((err) => {
    if (err) return next(err);
    if (email) logActivity(email, 'Logged out').catch(() => {});
    // Redirect to a gate-exempt page so the auth gate doesn't immediately
    // re-trigger GitHub OAuth and log the user back in silently.
    res.redirect('/auth/signed-out');
  });
};

/**
 * GET /auth/signed-out
 */
exports.signedOut = (req, res) => {
  res.render('auth-signed-out', { title: 'Signed out' });
};

/**
 * GET /auth/dev-login — dev-only login form (disabled in production)
 */
exports.devLoginForm = (req, res) => {
  res.render('dev-login', { title: 'Dev Login' });
};

/**
 * POST /auth/test-login — token-gated test user login for production testing.
 * Enabled only when TEST_LOGIN_TOKEN env var is set.
 * Usage: POST /auth/test-login { token: "SECRET", role: "participant"|"admin" }
 */
exports.testLogin = async (req, res, next) => {
  const configuredToken = process.env.TEST_LOGIN_TOKEN;
  if (!configuredToken) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Page not found.', user: null });
  }
  const submittedToken = req.body?.token || req.query?.token;
  if (!submittedToken || (() => {
    try {
      const key  = crypto.createHash('sha256').update(configuredToken).digest();
      const a    = crypto.createHmac('sha256', key).update(submittedToken).digest();
      const b    = crypto.createHmac('sha256', key).update(configuredToken).digest();
      return !crypto.timingSafeEqual(a, b);
    } catch { return true; }
  })()) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Invalid test login token.', user: null });
  }

  const ALLOWED_ROLES = ['participant', 'admin'];
  const role = ALLOWED_ROLES.includes(req.body?.role || req.query?.role) ? (req.body?.role || req.query?.role) : 'participant';
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

    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (err) => {
        if (err) return next(err);
        logActivity(user.email, 'Logged in (test)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
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
  // 'organizer' is intentionally dev-only; testLogin (used in production) is
  // restricted to participant and admin to avoid exposing that role on prod.
  const ALLOWED_ROLES = ['participant', 'admin', 'organizer'];
  try {
    const { handle = 'dev-user', role = 'participant' } = req.body;
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
        profile: { name: handle, picture: '' },
      });
      await user.save();
    } else {
      user.role = role;
      await user.save();
    }
    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (err) => {
        if (err) return next(err);
        logActivity(user.email, 'Logged in (dev)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
    });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// OIDC — Canonical Identity Platform (Ory Hydra)
// Active when OIDC_ISSUER_URL env var is set. Falls back to GitHub OAuth otherwise.
// ---------------------------------------------------------------------------

/**
 * GET /auth/oidc — initiate OIDC Authorization Code flow with PKCE
 */
exports.oidcLogin = (req, res, next) => {
  const client = getClient();
  if (!client) return next(new Error('OIDC not configured — OIDC_ISSUER_URL is not set.'));

  const state         = generators.state();
  const nonce         = generators.nonce();
  const codeVerifier  = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  // Persist PKCE params in session for the callback
  req.session.oidcParams = { state, nonce, codeVerifier };

  const url = client.authorizationUrl({
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });

  res.redirect(url);
};

/**
 * GET /auth/oidc/callback — exchange code for tokens, upsert user, establish session
 */
exports.oidcCallback = async (req, res, next) => {
  const client = getClient();
  if (!client) return next(new Error('OIDC not configured.'));

  const oidcParams = req.session.oidcParams;
  delete req.session.oidcParams;
  if (!oidcParams?.state || !oidcParams?.codeVerifier) {
    req.flash('errors', { msg: 'Login session expired or invalid. Please try again.' });
    return res.redirect(resolveLoginUrl());
  }
  const { state, nonce, codeVerifier } = oidcParams;

  try {
    const params   = client.callbackParams(req);
    const tokenSet = await client.callback(
      `${(process.env.BASE_URL || '').replace(/\/+$/, '')}/auth/oidc/callback`,
      params,
      { state, nonce, code_verifier: codeVerifier },
    );

    const claims = tokenSet.claims();
    const email  = claims.email;

    if (!email) {
      req.flash('errors', { msg: 'No email address returned by the identity provider.' });
      return res.redirect(resolveLoginUrl());
    }

    // Upsert user — email is the canonical identifier across both auth paths
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ email, role: 'participant' });
    }

    // Sync display name and picture from OIDC claims on every login
    const displayName = claims.name || claims.preferred_username || email.split('@')[0];
    user.profile            = user.profile || {};
    user.profile.name       = displayName;
    user.profile.picture    = user.profile.picture || claims.picture || '';

    await user.save();

    regenerateSession(req, (regenErr) => {
      if (regenErr) return next(regenErr);
      req.logIn(user, (err) => {
        if (err) return next(err);
        logActivity(user.email, 'Logged in (OIDC)').catch(() => {});
        const returnTo = safeReturnTo(req.session.returnTo);
        delete req.session.returnTo;
        res.redirect(returnTo);
      });
    });
  } catch (err) {
    console.error('OIDC callback error:', err.message);
    req.flash('errors', { msg: 'Sign-in failed. Please try again.' });
    res.redirect(resolveLoginUrl());
  }
};
