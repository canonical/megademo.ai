/**
 * Magic-bytes image type verification.
 * Shared by controllers/project.js and controllers/admin.js.
 */
const fs = require('node:fs');

/**
 * Verify an uploaded file's actual content type using magic bytes.
 * Deletes the file and throws if the content is not in the allowedMimes list.
 * Calling with no file is a safe no-op.
 *
 * @param {object|null} file   - multer file object (must have .path)
 * @param {string[]}    allowedMimes - MIME types to accept, e.g. ['image/jpeg', 'image/png']
 * @param {string}      errorMsg     - Human-readable error message on rejection
 */
async function verifyImageMagicBytes(file, allowedMimes, errorMsg) {
  if (!file) return;
  // file-type is ESM-only from v17+; dynamic import is resolved and cached by
  // Node.js after the first call, so there is no per-request overhead.
  const { fileTypeFromFile } = await import('file-type');
  let type;
  try {
    type = await fileTypeFromFile(file.path);
  } catch {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new Error(errorMsg);
  }
  if (!type || !allowedMimes.includes(type.mime)) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new Error(errorMsg);
  }
}

module.exports = { verifyImageMagicBytes };
