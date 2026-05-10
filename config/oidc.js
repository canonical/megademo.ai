/**
 * OIDC client — Canonical Identity Platform (Ory Hydra)
 *
 * Activated when OIDC_ISSUER_URL env var is set. Uses openid-client v5 with
 * PKCE (S256) for the Authorization Code flow.
 *
 * Required env vars:
 *   OIDC_ISSUER_URL     — Hydra public URL (OIDC discovery endpoint root)
 *   OIDC_CLIENT_ID      — Client ID issued by Hydra for this app
 *   OIDC_CLIENT_SECRET  — Client secret issued by Hydra for this app
 */
const { Issuer } = require('openid-client');

let oidcClient = null;

/**
 * Discover the OIDC issuer and initialise the client.
 * Called once at app startup if OIDC_ISSUER_URL is set.
 */
async function initOidcClient() {
  if (process.env.AUTH_MODE !== 'oidc') return;

  const issuerUrl    = process.env.OIDC_ISSUER_URL;
  if (!issuerUrl) return null;

  const clientId     = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const baseUrl      = process.env.BASE_URL;

  if (!clientId || !clientSecret) {
    throw new Error('OIDC_ISSUER_URL is set but OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is missing');
  }
  if (!baseUrl) {
    throw new Error('OIDC_ISSUER_URL is set but BASE_URL is missing (required for redirect_uri)');
  }

  let issuer;
  try {
    issuer = await Issuer.discover(issuerUrl);
  } catch (err) {
    throw new Error(`OIDC discovery failed for ${issuerUrl}: ${err.message}`, { cause: err });
  }

  oidcClient = new issuer.Client({
    client_id:      clientId,
    client_secret:  clientSecret,
    redirect_uris:  [`${baseUrl.replace(/\/+$/, '')}/auth/oidc/callback`],
    response_types: ['code'],
  });

  console.log(`OIDC client initialised (issuer: ${issuer.issuer})`);
  return oidcClient;
}

/** Returns the initialised OIDC client, or null if OIDC is not configured. */
function getClient() {
  return oidcClient;
}

module.exports = { initOidcClient, getClient };
