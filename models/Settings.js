const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    key:   { type: String, unique: true, required: true },
    value: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

settingsSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaultValue;
};

settingsSchema.statics.set = async function (key, value) {
  return this.findOneAndUpdate({ key }, { value }, { upsert: true, returnDocument: 'after' });
};

const Settings = mongoose.model('Settings', settingsSchema);
module.exports = Settings;
