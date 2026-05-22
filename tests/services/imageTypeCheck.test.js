/**
 * Unit tests for services/imageTypeCheck.js
 *
 * Tests the magic-bytes verification that guards image uploads in both
 * controllers/project.js and controllers/admin.js. No DB or Express needed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyImageMagicBytes } from '../../services/imageTypeCheck.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const ERR_MSG = 'Only image files are allowed.';

// Minimal valid PNG: 8-byte signature + IHDR chunk
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d,                           // IHDR length
  0x49, 0x48, 0x44, 0x52,                           // 'IHDR'
  0x00, 0x00, 0x00, 0x01,                           // width = 1
  0x00, 0x00, 0x00, 0x01,                           // height = 1
  0x08, 0x02, 0x00, 0x00, 0x00,                     // bit depth, color type, etc.
  0x90, 0x77, 0x53, 0xde,                           // CRC
]);

// Minimal valid JPEG: SOI marker
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function writeTmp(name, content) {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

describe('verifyImageMagicBytes', () => {
  it('is a no-op when file is null', async () => {
    await expect(verifyImageMagicBytes(null, ALLOWED, ERR_MSG)).resolves.toBeUndefined();
  });

  it('is a no-op when file is undefined', async () => {
    await expect(verifyImageMagicBytes(undefined, ALLOWED, ERR_MSG)).resolves.toBeUndefined();
  });

  it('accepts a valid PNG by magic bytes', async () => {
    const p = writeTmp('test-valid.png', PNG_HEADER);
    await expect(verifyImageMagicBytes({ path: p }, ALLOWED, ERR_MSG)).resolves.toBeUndefined();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('accepts a valid JPEG by magic bytes', async () => {
    const p = writeTmp('test-valid.jpg', JPEG_HEADER);
    await expect(verifyImageMagicBytes({ path: p }, ALLOWED, ERR_MSG)).resolves.toBeUndefined();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('rejects a file with non-image magic bytes and throws the supplied error message', async () => {
    const p = writeTmp('test-bad.jpg', Buffer.from('this is not an image file at all'));
    await expect(verifyImageMagicBytes({ path: p }, ALLOWED, ERR_MSG)).rejects.toThrow(ERR_MSG);
  });

  it('deletes the file when rejecting due to bad magic bytes', async () => {
    const p = writeTmp('test-delete.jpg', Buffer.from('not an image'));
    try { await verifyImageMagicBytes({ path: p }, ALLOWED, ERR_MSG); } catch { /* expected */ }
    expect(fs.existsSync(p)).toBe(false);
  });

  it('deletes the file and throws when fileTypeFromFile encounters an I/O error', async () => {
    // Point at a path that does not exist so fileTypeFromFile throws ENOENT
    const missing = path.join(os.tmpdir(), `nonexistent-${Date.now()}.jpg`);
    await expect(verifyImageMagicBytes({ path: missing }, ALLOWED, ERR_MSG)).rejects.toThrow(ERR_MSG);
    // File never existed, but unlink should not throw (swallowed)
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('rejects a GIF when GIF is not in the allowedMimes list', async () => {
    // GIF89a header
    const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const p = writeTmp('test-gif.gif', gifHeader);
    await expect(verifyImageMagicBytes({ path: p }, ALLOWED, ERR_MSG)).rejects.toThrow(ERR_MSG);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('accepts a GIF when GIF is in the allowedMimes list', async () => {
    const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const p = writeTmp('test-gif-ok.gif', gifHeader);
    const allowedWithGif = [...ALLOWED, 'image/gif'];
    await expect(verifyImageMagicBytes({ path: p }, allowedWithGif, ERR_MSG)).resolves.toBeUndefined();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
});
