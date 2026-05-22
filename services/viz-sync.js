/**
 * Visualization sync service — fetches pre-built Plotly HTML from
 * canonical/megademo-projects, extracts body content, and caches
 * fragments in memory for serving via the /visualize route.
 */
import axios from 'axios';

const REPO_OWNER = 'canonical';
const REPO_NAME  = 'megademo-projects';
const BRANCH     = 'main';
const GRANULARITIES = ['fine', 'medium', 'coarse', 'broad'];

// In-memory cache: granularity → { html, syncedAt }
const cache = new Map();
let lastSyncError = null;

/**
 * Build auth headers for GitHub API requests.
 */
function buildAuthHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github.raw',
    'User-Agent': 'megademo-ai-viz-sync',
  };
  if (token) {
    const prefix = token.startsWith('github_pat_') ? 'Bearer' : 'token';
    headers.Authorization = `${prefix} ${token}`;
  }
  return headers;
}

/**
 * Test whether the GITHUB_TOKEN can access the viz source repo.
 * Logs a clear diagnostic at startup.
 */
async function checkTokenAccess() {
  const token = process.env.GITHUB_TOKEN;
  const tokenHint = token
    ? `${token.slice(0, 6)}...${token.slice(-4)} (${token.startsWith('github_pat_') ? 'fine-grained' : 'classic'})`
    : '(not set)';

  if (!token) {
    console.error(`Viz sync: GITHUB_TOKEN is not set. Cannot access private repo ${REPO_OWNER}/${REPO_NAME}.`);
    return false;
  }

  try {
    // Light check: just get repo metadata (no file download)
    await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
      headers: buildAuthHeaders(token),
      timeout: 10000,
    });
    console.log(`Viz sync: token ${tokenHint} has access to ${REPO_OWNER}/${REPO_NAME}`);
    return true;
  } catch (err) {
    const status = err.response ? err.response.status : 'network error';
    console.error(
      `Viz sync: token ${tokenHint} CANNOT access ${REPO_OWNER}/${REPO_NAME} (HTTP ${status}). ` +
      'Ensure the token has "repo" scope and belongs to a user with access to the canonical org.'
    );
    return false;
  }
}

/**
 * Build the raw-content URL for a given granularity HTML file.
 * Uses the GitHub Contents API with the raw media type so we get the
 * file content directly (requires auth for private/org repos).
 */
function buildUrl(granularity) {
  return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/out/index_${granularity}.html`;
}

/**
 * Extract body content from the self-contained viz HTML.
 * Strips <head> (including inline <style> and Plotly CDN script)
 * and the <body>/<html> wrappers, returning only the inner content.
 *
 * Also replaces bare <script> tags with <script nonce="{{VIZ_NONCE}}">
 * so the controller can inject the real CSP nonce at render time.
 *
 * TRUST BOUNDARY: This HTML comes from the canonical/megademo-projects private
 * org repository (fetched via GITHUB_TOKEN). It is NOT sanitized with
 * sanitize-html because Plotly's generated output contains complex attributes
 * and inline data that sanitization would break. Script injection is mitigated
 * by the CSP nonce requirement (scriptSrc in app.js uses per-request nonces;
 * 'unsafe-inline' is NOT present). Inline event-handler attributes (onclick,
 * onerror, etc.) are blocked by the same CSP. Changes to this trust model
 * require re-evaluating the unsanitized rendering in visualize.pug.
 */
function extractBodyContent(html) {
  // Find <body> tag — content starts right after it
  const bodyStart = html.indexOf('<body>');
  const bodyEnd   = html.lastIndexOf('</body>');
  if (bodyStart === -1 || bodyEnd === -1) {
    throw new Error('Could not locate <body> tags in viz HTML');
  }
  let content = html.slice(bodyStart + 6, bodyEnd).trim();

  // Strip the upstream granularity nav (we render our own in the Pug template)
  content = content.replace(/<div class="g-nav">[\s\S]*?<\/div>\n?/, '');

  // Strip the upstream <h1> (we render our own in the Pug template)
  content = content.replace(/<h1>[\s\S]*?<\/h1>\n?/, '');

  // Strip the upstream subtitle (we render our own)
  content = content.replace(/<div class=sub>[\s\S]*?<\/div>\n?/, '');

  // Strip the bottom nav with links to standalone HTML/MD/CSV files (not applicable)
  content = content.replace(/<nav style="margin-top: 1\.5em;">[\s\S]*?<\/nav>\n?/, '');

  // Inject CSP nonce placeholder into <script> tags that don't already have one
  content = content.replace(/<script(?![^>]*\snonce=)(?=[>\s])/g, '<script nonce="{{VIZ_NONCE}}"');

  return content;
}

/**
 * Fetch and cache all granularity levels from GitHub.
 * Uses GITHUB_TOKEN env var for authenticated access to org repos.
 */
async function syncVizContent() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('Viz sync: GITHUB_TOKEN not set — skipping');
    return { synced: [], failed: GRANULARITIES.map((g) => ({ granularity: g, status: 'no-token', error: 'GITHUB_TOKEN not set' })) };
  }
  const headers = buildAuthHeaders(token);

  const results = { synced: [], failed: [] };

  for (const g of GRANULARITIES) {
    try {
      const resp = await axios.get(buildUrl(g), {
        headers,
        params: { ref: BRANCH },
        timeout: 30000,
        // Response can be large (up to ~250 KB); keep as string
        responseType: 'text',
        transformResponse: [(data) => data],
      });
      const bodyHtml = extractBodyContent(resp.data);
      cache.set(g, { html: bodyHtml, syncedAt: new Date() });
      results.synced.push(g);
    } catch (err) {
      const status = err.response ? err.response.status : 'network';
      const detail = err.response && err.response.data
        ? (typeof err.response.data === 'string' ? err.response.data.slice(0, 200) : JSON.stringify(err.response.data).slice(0, 200))
        : err.message;
      results.failed.push({ granularity: g, status, error: detail });
    }
  }

  if (results.failed.length > 0) {
    lastSyncError = {
      at: new Date(),
      failures: results.failed,
    };
    console.error('Viz sync partial failure:', JSON.stringify(results.failed));
  } else {
    lastSyncError = null;
  }

  const syncCount = results.synced.length;
  if (syncCount > 0) {
    console.log(`Viz sync: ${syncCount}/${GRANULARITIES.length} granularities updated`);
  }

  return results;
}

/**
 * Return cached HTML fragment for the given granularity.
 * Returns null if not yet synced.
 */
function getVizFragment(granularity) {
  return cache.get(granularity) || null;
}

/**
 * Return sync status for admin display.
 */
function getSyncStatus() {
  const entries = {};
  for (const g of GRANULARITIES) {
    const cached = cache.get(g);
    entries[g] = cached ? { syncedAt: cached.syncedAt, size: cached.html.length } : null;
  }
  return {
    granularities: entries,
    lastError: lastSyncError,
    available: cache.size > 0,
  };
}

export {
  syncVizContent,
  getVizFragment,
  getSyncStatus,
  checkTokenAccess,
  GRANULARITIES,
};
