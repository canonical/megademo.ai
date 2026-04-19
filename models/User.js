const crypto = require('node:crypto');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, required: true },
    github: String,
    githubLogin: String,
    tokens: Array,

    role: {
      type: String,
      enum: ['viewer', 'participant', 'admin'],
      default: 'participant',
    },

    canonicalTeam: {
      type: String,
      default: null,
    },

    profile: {
      name: String,
      picture: String,
    },
  },
  { timestamps: true },
);

userSchema.statics.generateToken = function generateToken() {
  return crypto.randomBytes(32).toString('hex');
};

const User = mongoose.model('User', userSchema);
module.exports = User;
