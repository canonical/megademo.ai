/**
 * Passport configuration — GitHub OAuth, restricted to github.com/canonical org members
 */
const passport = require('passport');
const { Strategy: GitHubStrategy } = require('passport-github2');
const axios = require('axios');
const User = require('../models/User');

const CANONICAL_ORG = 'canonical';
const CANONICAL_EMAIL_DOMAIN = '@canonical.com';

const GH_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
});

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    return done(null, await User.findById(id));
  } catch (err) {
    return done(err);
  }
});

/**
 * Resolve the user's primary verified email via profile or GitHub API.
 */
async function resolveEmail(profile, accessToken) {
  const fromProfile = profile.emails?.find((e) => e.verified !== false)?.value
    || profile.emails?.[0]?.value
    || null;
  if (fromProfile) return fromProfile;

  try {
    const resp = await axios.get('https://api.github.com/user/emails', {
      headers: GH_HEADERS(accessToken), timeout: 5000,
    });
    const primary = resp.data.find((e) => e.primary && e.verified);
    return primary?.email || resp.data[0]?.email || null;
  } catch (e) {
    console.error('GitHub email fetch failed:', e.message);
    return null;
  }
}

/**
 * Verify canonical org membership using three approaches, in order:
 *  1. /user/memberships/orgs/canonical  — most precise, fails if org restricts OAuth apps
 *  2. /user/orgs                         — list-based, also subject to org restrictions
 *  3. @canonical.com email domain        — opt-in fallback when org API access is blocked
 *
 * Set ALLOW_CANONICAL_EMAIL_FALLBACK=false to disable approach 3.
 */
async function verifyCanonicalMembership(accessToken, email) {
  // Approach 1: membership API
  try {
    const resp = await axios.get(
      `https://api.github.com/user/memberships/orgs/${CANONICAL_ORG}`,
      {
        headers: GH_HEADERS(accessToken),
        validateStatus: (s) => s < 500,
        timeout: 5000,
      },
    );
    if (resp.status === 200 && resp.data?.state === 'active') {
      return { member: true, method: 'membership-api' };
    }
    console.warn(`Org membership API returned ${resp.status} (org may have OAuth App restrictions).`);
  } catch (e) {
    console.error('GitHub org membership check failed:', e.message);
  }

  // Approach 2: org list
  try {
    const resp = await axios.get('https://api.github.com/user/orgs', {
      headers: GH_HEADERS(accessToken), timeout: 5000,
    });
    if (resp.data?.some((o) => o.login?.toLowerCase() === CANONICAL_ORG)) {
      return { member: true, method: 'orgs-list' };
    }
  } catch (e) {
    console.error('GitHub orgs list check failed:', e.message);
  }

  // Approach 3: @canonical.com email domain
  // Handles the common case where the canonical org has OAuth App restrictions
  // preventing the token from reading org data.
  // Must be explicitly enabled via ALLOW_CANONICAL_EMAIL_FALLBACK=true.
  if (process.env.ALLOW_CANONICAL_EMAIL_FALLBACK === 'true') {
    if (email?.toLowerCase().endsWith(CANONICAL_EMAIL_DOMAIN)) {
      return { member: true, method: 'email-domain' };
    }
  }

  return { member: false, method: null };
}

passport.use(
  'github',
  new GitHubStrategy(
    {
      clientID:        process.env.GITHUB_CLIENT_ID,
      clientSecret:    process.env.GITHUB_CLIENT_SECRET,
      callbackURL:     `${(process.env.BASE_URL || '').replace(/\/+$/, '')}/auth/github/callback`,
      scope:           ['user:email', 'read:org'],
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = await resolveEmail(profile, accessToken);

        if (!email) {
          req.flash('errors', { msg: 'No email address returned by GitHub. Please ensure your email is visible.' });
          return done(null, false);
        }

        const { member, method } = await verifyCanonicalMembership(accessToken, email);

        if (!member) {
          req.flash('errors', {
            msg: `Access is restricted to members of the github.com/${CANONICAL_ORG} organisation.`,
          });
          return done(null, false);
        }

        console.log(`Auth: ${profile.username} admitted via ${method}`);

        let user = await User.findOne({ github: { $eq: String(profile.id) } });
        if (!user) user = await User.findOne({ email: { $eq: email } });
        if (!user) {
          user = new User();
          user.email = email;
        }

        user.github        = String(profile.id);
        user.githubLogin   = profile.username;
        user.profile.name  = user.profile.name  || profile.displayName || profile.username;
        user.profile.picture = user.profile.picture || profile._json?.avatar_url;
        user.tokens = user.tokens.filter((t) => t.kind !== 'github');
        user.tokens.push({ kind: 'github', accessToken });

        await user.save();
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);
