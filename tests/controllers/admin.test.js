/**
 * Tests for admin controller business logic.
 * Focuses on the CSV cell sanitisation function and Settings helpers.
 */
const db = require('../setup/db');
// eslint-disable-next-line no-unused-vars -- imported to initialise models used by db.js
const { Project } = require('../../models/Project');
// eslint-disable-next-line no-unused-vars -- imported to initialise models used by db.js
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
    expect(ALLOWED_STATUSES.includes('draft')).toBe(true);
    expect(ALLOWED_STATUSES.includes('submitted')).toBe(true);
    expect(ALLOWED_STATUSES.includes('finalist')).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(ALLOWED_STATUSES.includes('hacked')).toBe(false);
  });

  it('accepts all defined categories', () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    expect(CATEGORIES.includes('Coding Assistant')).toBe(true);
    expect(CATEGORIES.includes('Other')).toBe(true);
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

// ─── CSV field registry and extraction ────────────────────────────────────

const { CSV_FIELD_REGISTRY, sanitizeCsvCell: actualSanitize } = require('../../controllers/admin');

describe('CSV_FIELD_REGISTRY', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(CSV_FIELD_REGISTRY)).toBe(true);
    expect(CSV_FIELD_REGISTRY.length).toBeGreaterThan(0);
  });

  it('every entry has key, header, group, and extract', () => {
    for (const field of CSV_FIELD_REGISTRY) {
      expect(field).toHaveProperty('key');
      expect(field).toHaveProperty('header');
      expect(field).toHaveProperty('group');
      expect(typeof field.extract).toBe('function');
    }
  });

  it('has unique keys', () => {
    const keys = CSV_FIELD_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers all four groups', () => {
    const groups = [...new Set(CSV_FIELD_REGISTRY.map((f) => f.group))];
    expect(groups).toEqual(expect.arrayContaining([
      'Basic Info', 'People & Teams', 'Media & Links', 'Stats & Dates',
    ]));
  });

  it('contains at least 21 fields', () => {
    expect(CSV_FIELD_REGISTRY.length).toBeGreaterThanOrEqual(21);
  });
});

describe('CSV field extraction', () => {
  const fullProject = {
    title: 'Test Project',
    slug: 'test-project',
    description: '# Heading\n\nSome **bold** text with "quotes" and a, comma.',
    category: 'Coding Assistant',
    status: 'submitted',
    completionStage: 'mvp',
    owner: { email: 'alice@example.com', profile: { name: 'Alice' } },
    team: [
      { email: 'bob@example.com', profile: { name: 'Bob' } },
      { email: 'carol@example.com', profile: { name: 'Carol' } },
    ],
    canonicalTeam: 'Ubuntu',
    logo: '/uploads/logo.png',
    repoLinks: ['https://github.com/org/repo1', 'https://github.com/org/repo2'],
    demoUrl: 'https://demo.example.com',
    slidesUrl: 'https://slides.example.com',
    externalLinks: [
      { label: 'Blog', url: 'https://blog.example.com' },
      { label: 'Docs', url: 'https://docs.example.com' },
    ],
    asciinema: [{ castId: 'abc123', title: 'Demo Cast' }],
    videos: [{ url: 'https://youtube.com/watch?v=x', title: 'Demo Video', type: 'youtube' }],
    avgRating: 4.5,
    voteCount: 10,
    totalStars: 45,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-02-20T15:30:00Z'),
  };

  const findField = (key) => CSV_FIELD_REGISTRY.find((f) => f.key === key);

  it('extracts title', () => {
    expect(findField('title').extract(fullProject)).toBe('Test Project');
  });

  it('extracts slug', () => {
    expect(findField('slug').extract(fullProject)).toBe('test-project');
  });

  it('extracts raw markdown description', () => {
    expect(findField('description').extract(fullProject)).toContain('# Heading');
    expect(findField('description').extract(fullProject)).toContain('**bold**');
  });

  it('extracts owner name', () => {
    expect(findField('ownerName').extract(fullProject)).toBe('Alice');
  });

  it('extracts owner email', () => {
    expect(findField('ownerEmail').extract(fullProject)).toBe('alice@example.com');
  });

  it('extracts team as semicolon-delimited emails', () => {
    expect(findField('team').extract(fullProject)).toBe('bob@example.com; carol@example.com');
  });

  it('extracts repoLinks as semicolon-delimited URLs', () => {
    expect(findField('repoLinks').extract(fullProject)).toBe(
      'https://github.com/org/repo1; https://github.com/org/repo2'
    );
  });

  it('extracts externalLinks in label: url format', () => {
    expect(findField('externalLinks').extract(fullProject)).toBe(
      'Blog: https://blog.example.com; Docs: https://docs.example.com'
    );
  });

  it('extracts asciinema in title: castId format', () => {
    expect(findField('asciinema').extract(fullProject)).toBe('Demo Cast: abc123');
  });

  it('extracts videos in title (type): url format', () => {
    expect(findField('videos').extract(fullProject)).toBe(
      'Demo Video (youtube): https://youtube.com/watch?v=x'
    );
  });

  it('extracts avgRating to 2 decimal places', () => {
    expect(findField('avgRating').extract(fullProject)).toBe('4.50');
  });

  it('extracts totalStars', () => {
    expect(findField('totalStars').extract(fullProject)).toBe(45);
  });

  it('extracts createdAt as ISO string', () => {
    expect(findField('createdAt').extract(fullProject)).toBe('2026-01-15T10:00:00.000Z');
  });

  it('extracts updatedAt as ISO string', () => {
    expect(findField('updatedAt').extract(fullProject)).toBe('2026-02-20T15:30:00.000Z');
  });

  const emptyProject = {};

  it('returns empty string for missing title', () => {
    expect(findField('title').extract(emptyProject)).toBe('');
  });

  it('returns empty string for missing owner', () => {
    expect(findField('ownerName').extract(emptyProject)).toBe('');
    expect(findField('ownerEmail').extract(emptyProject)).toBe('');
  });

  it('returns empty string for missing team', () => {
    expect(findField('team').extract(emptyProject)).toBe('');
  });

  it('returns empty string for missing arrays', () => {
    expect(findField('repoLinks').extract(emptyProject)).toBe('');
    expect(findField('externalLinks').extract(emptyProject)).toBe('');
    expect(findField('asciinema').extract(emptyProject)).toBe('');
    expect(findField('videos').extract(emptyProject)).toBe('');
  });

  it('returns "0" for missing avgRating', () => {
    expect(findField('avgRating').extract(emptyProject)).toBe('0');
  });

  it('returns 0 for missing voteCount and totalStars', () => {
    expect(findField('voteCount').extract(emptyProject)).toBe(0);
    expect(findField('totalStars').extract(emptyProject)).toBe(0);
  });

  it('returns empty string for missing dates', () => {
    expect(findField('createdAt').extract(emptyProject)).toBe('');
    expect(findField('updatedAt').extract(emptyProject)).toBe('');
  });
});

describe('sanitizeCsvCell (exported)', () => {
  it('is a function export', () => {
    expect(typeof actualSanitize).toBe('function');
  });

  it('wraps cells in double quotes', () => {
    expect(actualSanitize('hello')).toBe('"hello"');
  });

  it('escapes internal double quotes', () => {
    expect(actualSanitize('say "hello"')).toBe('"say ""hello"""');
  });

  it('replaces newlines with literal \\n', () => {
    expect(actualSanitize('line1\nline2')).toBe('"line1\\nline2"');
  });

  it('prefixes formula-starting characters', () => {
    expect(actualSanitize('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(actualSanitize('+cmd')).toBe('"\'+cmd"');
    expect(actualSanitize('@import')).toBe('"\'@import"');
  });

  it('handles markdown with mixed special chars', () => {
    const md = '## Title\n\n- item "one"\n- item `two`\n\n| col | col |\n|---|---|\n=formula';
    const result = actualSanitize(md);
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
    expect(result).not.toMatch(/[^\\]\n/);
  });
});

describe('CSV field filtering logic', () => {
  const validKeys = CSV_FIELD_REGISTRY.map((f) => f.key);

  const filterFields = (fieldsParam) => {
    if (!fieldsParam) return CSV_FIELD_REGISTRY;
    const requestedKeys = fieldsParam.split(',').filter((k) => validKeys.includes(k));
    return requestedKeys.length
      ? CSV_FIELD_REGISTRY.filter((f) => requestedKeys.includes(f.key))
      : CSV_FIELD_REGISTRY;
  };

  it('returns all fields when no param is provided', () => {
    expect(filterFields(undefined)).toEqual(CSV_FIELD_REGISTRY);
    expect(filterFields(null)).toEqual(CSV_FIELD_REGISTRY);
  });

  it('filters to requested fields only', () => {
    const result = filterFields('title,category');
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.key)).toEqual(['title', 'category']);
  });

  it('ignores invalid field keys', () => {
    const result = filterFields('title,bogus,category');
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.key)).toEqual(['title', 'category']);
  });

  it('falls back to all fields if all keys are invalid', () => {
    const result = filterFields('bogus,nope');
    expect(result).toEqual(CSV_FIELD_REGISTRY);
  });

  it('preserves registry order regardless of param order', () => {
    const result = filterFields('category,title');
    expect(result.map((f) => f.key)).toEqual(['title', 'category']);
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
