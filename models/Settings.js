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

/**
 * Atomically add item to an array-valued setting.
 * No-op if the exact value already exists ($setUnion semantics).
 * Creates the document with [item] if it does not exist yet.
 */
settingsSchema.statics.arrayAdd = async function (key, item) {
  return this.findOneAndUpdate(
    { key },
    [{ $set: { value: { $cond: [{ $isArray: '$value' }, { $setUnion: ['$value', [item]] }, [item]] } } }],
    { upsert: true, returnDocument: 'after', updatePipeline: true },
  );
};

/**
 * Atomically remove item from an array-valued setting.
 * No-op (returns null) if the key does not exist or value is not an array.
 */
settingsSchema.statics.arrayRemove = async function (key, item) {
  return this.findOneAndUpdate(
    { key, value: { $type: 'array' } },
    { $pull: { value: item } },
    { returnDocument: 'after' },
  );
};

/**
 * Atomically rename item in an array-valued setting using an array filter.
 * Returns the updated document, or null if the key does not exist.
 */
settingsSchema.statics.arrayRename = async function (key, oldItem, newItem) {
  return this.findOneAndUpdate(
    { key },
    { $set: { 'value.$[el]': newItem } },
    { arrayFilters: [{ el: oldItem }], returnDocument: 'after' },
  );
};

const Settings = mongoose.model('Settings', settingsSchema);
module.exports = Settings;
