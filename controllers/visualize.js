/**
 * Visualization controller — serves the interactive project cluster map.
 */
const { getVizFragment, GRANULARITIES } = require('../services/viz-sync');

exports.show = (req, res) => {
  const granularity = req.params.granularity || 'medium';

  if (!GRANULARITIES.includes(granularity)) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: `Unknown granularity "${granularity}". Valid options: ${GRANULARITIES.join(', ')}`,
    });
  }

  const fragment = getVizFragment(granularity);

  if (!fragment) {
    return res.status(503).render('error', {
      title: 'Visualization Unavailable',
      message: 'The project visualization is syncing. Please try again in a few minutes.',
    });
  }

  // Replace CSP nonce placeholder with the real per-request nonce
  const vizHtml = fragment.html.replace(/\{\{VIZ_NONCE\}\}/g, res.locals.cspNonce);

  res.render('visualize', {
    title: 'Topic Map',
    vizContent: vizHtml,
    granularity,
    granularities: GRANULARITIES,
    syncedAt: fragment.syncedAt,
  });
};
