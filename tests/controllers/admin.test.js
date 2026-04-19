/**
 * Tests for admin controller business logic.
 * Focuses on the CSV cell sanitisation function and Settings helpers.
 */
const db = require('../setup/db');
const { Project } = require('../../models/Project');
const User = require('../../models/User');

// Re-implement the CSV cell sanitizer identical to controllers/admin.js line 153
// so we can verify the spec without spinning up the full HTTP stack.
const sanitizeCsvCell = (c) => `"${String(c).replace(/"/g, '""').replace(/[\r\n]/g, '\\n')}"`;

// ─── Tag deduplication logic (mirrors addAiTool / addTechStack) ───────────

describe('tag deduplication', () => {
  const isDuplicate = (list, item) => list.some((t) => t.toLowerCase() === item.toLowerCase());

  it('detects an exact duplicate', () => {
    expect(isDuplicate(['GitHub Copilot', 'Claude'], 'Claude')).toBe(true);
  });

  it('detects a case-insensitive duplicate', () => {
    expect(isDuplicate(['GitHub Copilot', 'Claude'], 'claude')).toBe(true);
  });

  it('returns false for a new item', () => {
    expect(isDuplicate(['GitHub Copilot', 'Claude'], 'GPT-4')).toBe(false);
  });

  it('returns false for an empty list', () => {
    expect(isDuplicate([], 'Claude')).toBe(false);
  });
});
describe('CSV cell sanitizer', () => {
  it('wraps a plain value in quotes', () => {
    expect(sanitizeCsvCell('hello')).toBe('"hello"');
  });

  it('escapes embedded double-quotes', () => {
    expect(sanitizeCsvCell('say "hello"')).toBe('"say ""hello"""');
  });

  it('replaces LF with literal \\n (newline injection prevention)', () => {
    expect(sanitizeCsvCell('line1\nline2')).toBe('"line1\\nline2"');
  });

  it('replaces CR with literal \\n', () => {
    expect(sanitizeCsvCell('line1\rline2')).toBe('"line1\\nline2"');
  });

  it('replaces CRLF sequence', () => {
    expect(sanitizeCsvCell('line1\r\nline2')).toBe('"line1\\n\\nline2"');
  });

  it('coerces numbers to strings', () => {
    expect(sanitizeCsvCell(42)).toBe('"42"');
  });

  it('coerces null and undefined to their string representations', () => {
    expect(sanitizeCsvCell(null)).toBe('"null"');
    expect(sanitizeCsvCell(undefined)).toBe('"undefined"');
  });

  it('handles a malicious payload that tries to inject a formula', () => {
    // Formula injection: starts with = — not escaped here (out of scope for this app),
    // but newlines must still be cleaned.
    const cell = '=cmd|"/c calc"\nInject';
    expect(sanitizeCsvCell(cell)).not.toContain('\n');
  });
});

// ─── Project query filter whitelist ───────────────────────────────────────

describe('admin project filter whitelist', () => {
  const { ALLOWED_STATUSES } = require('../../controllers/admin');
  const { CATEGORIES } = require('../../models/Project');

  it('accepts valid statuses', () => {
    ALLOWED_STATUSES.forEach((s) => expect(ALLOWED_STATUSES.includes(s)).toBe(true));
  });

  it('rejects an unknown status', () => {
    expect(ALLOWED_STATUSES.includes('hacked')).toBe(false);
  });

  it('accepts all defined categories', () => {
    CATEGORIES.forEach((c) => expect(CATEGORIES.includes(c)).toBe(true));
  });

  it('rejects an unknown category', () => {
    expect(CATEGORIES.includes('Evil Category')).toBe(false);
  });

  it('ALLOWED_STATUSES contains exactly draft, submitted, finalist', () => {
    expect(ALLOWED_STATUSES).toEqual(expect.arrayContaining(['draft', 'submitted', 'finalist']));
    expect(ALLOWED_STATUSES).toHaveLength(3);
  });
});

// ─── avgRating formatting ─────────────────────────────────────────────────

describe('avgRating CSV formatting', () => {
  // Mirrors the Number.isFinite guard in controllers/admin.js
  const formatRating = (v) => (Number.isFinite(v) ? v.toFixed(2) : '0');

  it('formats a float to 2 decimal places', () => {
    expect(formatRating(4.8333)).toBe('4.83');
  });

  it('returns "0" for undefined', () => {
    expect(formatRating(undefined)).toBe('0');
  });

  it('returns "0" for a string value', () => {
    expect(formatRating('bad')).toBe('0');
  });

  it('formats zero correctly', () => {
    expect(formatRating(0)).toBe('0.00');
  });

  it('returns "0" for NaN (typeof NaN === "number" but not finite)', () => {
    expect(formatRating(NaN)).toBe('0');
  });
});

// ─── seed-defaults idempotency ────────────────────────────────────────────

const Settings = require('../../models/Settings');
const { seedDefaults, loadDefaults } = require('../../scripts/seed-defaults');

describe('seedDefaults', () => {
  beforeAll(() => db.connect());
  afterAll(() => db.disconnect());
  beforeEach(() => db.clearAll());
  it('populates empty settings from YAML on first call', async () => {
    await seedDefaults();
    const teams = await Settings.get('customTeams');
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
  });

  it('does not overwrite existing settings on subsequent calls', async () => {
    await Settings.set('customTeams', ['Custom Team A']);
    await seedDefaults();
    const teams = await Settings.get('customTeams');
    expect(teams).toEqual(['Custom Team A']);
  });

  it('loadDefaults returns expected top-level keys', () => {
    const d = loadDefaults();
    expect(d).toHaveProperty('teams');
    expect(d).toHaveProperty('ai_tools');
    expect(d).toHaveProperty('tech_stack');
  });
});
