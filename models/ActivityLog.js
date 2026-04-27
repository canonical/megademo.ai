/**
 * ActivityLog model — records all DB-mutating user actions.
 */
const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  userEmail: { type: String, required: true },
  action:    { type: String, required: true },
});

// TTL index: auto-expire entries after 180 days to keep the collection bounded
activityLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
module.exports = ActivityLog;
