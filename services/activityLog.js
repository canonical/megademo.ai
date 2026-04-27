/**
 * Activity log service — fire-and-forget helper for recording user actions.
 */
const ActivityLog = require('../models/ActivityLog');

/**
 * Record a user action in the activity log.
 * Never throws — failures are swallowed to avoid breaking the main request.
 *
 * @param {string} userEmail  The actor's email address
 * @param {string} action     Human-readable description, e.g. "Created project 'Foo'"
 */
async function logActivity(userEmail, action) {
  try {
    await ActivityLog.create({ userEmail, action });
  } catch {
    // Intentionally swallowed: log failures must never affect the main request
  }
}

module.exports = { logActivity };
