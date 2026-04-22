const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema(
  {
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    stars:   { type: Number, min: 1, max: 5, required: true },
  },
  { timestamps: true },
);

voteSchema.index({ user: 1, project: 1 }, { unique: true });

const Vote = mongoose.model('Vote', voteSchema);
module.exports = Vote;
