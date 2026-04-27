/**
 * Activity log service — fire-and-forget helper for recording user actions.
 */
const ActivityLog = require('../models/ActivityLog');

/**
 * Strip control characters (newlines, tabs, etc.) from a string so that
 * user-supplied values cannot inject fake log entries into plain-text exports.
 */
function sanitizeLogString(s) {
  // eslint-disable-next-line no-control-regex
  return typeof s === 'string' ? s.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').trim() : String(s);
}

/**
 * Record a user action in the activity log.
 * Never throws — failures are swallowed to avoid breaking the main request.
 *
 * @param {string} userEmail  The actor's email address
 * @param {string} action     Human-readable description, e.g. "Created project 'Foo'"
 */
async function logActivity(userEmail, action) {
  try {
    await ActivityLog.create({
      userEmail: sanitizeLogString(userEmail),
      action: sanitizeLogString(action),
    });
  } catch {
    // Intentionally swallowed: log failures must never affect the main request
  }
}

module.exports = { logActivity };
