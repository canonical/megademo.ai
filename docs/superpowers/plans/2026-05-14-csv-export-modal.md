# CSV Export Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the admin CSV export to support all project metadata, with a modal dialog for column selection using themed checkboxes.

**Architecture:** Replace the hardcoded CSV export with a field-registry pattern. A static `CSV_FIELD_REGISTRY` array defines all exportable fields with extraction functions. The dashboard link becomes a modal trigger; JavaScript collects checked fields and redirects to `GET /admin/export?fields=...`. The server filters the registry by requested keys and generates the CSV.

**Tech Stack:** Node.js/Express (server), Pug (templates), Bootstrap 5 modals, SCSS (themed checkboxes), Jest (tests)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `controllers/admin.js` | Modify (lines 267–313) | Add `CSV_FIELD_REGISTRY`, `sanitizeCsvCell()`, refactor `exportCsv` |
| `views/admin/dashboard.pug` | Modify (line 94 + after line 162) | Replace export link, add modal markup + JS |
| `public/css/main.scss` | Modify (after line 1100) | Add `.export-group-header` style |
| `public/css/main.css` | Regenerate | SCSS recompile |
| `tests/controllers/admin.test.js` | Modify (after line 131) | New test suites for field registry, extraction, filtering |
| `DESIGN.md` | Modify (line 41) | Document enhanced CSV export |

---

## Task 1: Create Feature Branch

**Files:** None (git operation only)

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feature/csv-export-modal main
```

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feature/csv-export-modal`

---

## Task 2: Field Registry and CSV Export Refactor — Tests

**Files:**
- Modify: `tests/controllers/admin.test.js` (insert after line 131, before the `seed-defaults` section)

- [ ] **Step 1: Write tests for the field registry and extraction functions**

Insert the following after line 131 (after the `avgRating CSV formatting` describe block closes, before the `seed-defaults idempotency` comment):

```javascript
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

  // Edge cases: empty/missing fields
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
    // Must be wrapped in quotes, no raw newlines
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
    expect(result).not.toMatch(/[^\\]\n/);
  });
});

describe('CSV field filtering logic', () => {
  const validKeys = CSV_FIELD_REGISTRY.map((f) => f.key);

  // Mirror the filtering logic from exportCsv
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=admin.test 2>&1 | tail -20
```

Expected: FAIL — `CSV_FIELD_REGISTRY` and `sanitizeCsvCell` are not exported from `controllers/admin.js`.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/controllers/admin.test.js
git commit -m "test: add failing tests for CSV field registry, extraction, and filtering

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Field Registry and CSV Export Refactor — Implementation

**Files:**
- Modify: `controllers/admin.js` (lines 267–313)

- [ ] **Step 1: Add the field registry constant and sanitizeCsvCell function**

Insert after line 20 (`const { notifyFinalistPromoted } = require('../services/mattermost');`) in `controllers/admin.js`:

```javascript

/**
 * CSV field registry — defines every exportable column.
 * Each entry: { key, header, group, extract(project) → cell value }
 */
const CSV_FIELD_REGISTRY = [
  // Basic Info
  { key: 'title', header: 'Title', group: 'Basic Info', extract: (p) => p.title || '' },
  { key: 'slug', header: 'Slug', group: 'Basic Info', extract: (p) => p.slug || '' },
  { key: 'description', header: 'Description', group: 'Basic Info', extract: (p) => p.description || '' },
  { key: 'category', header: 'Category', group: 'Basic Info', extract: (p) => p.category || '' },
  { key: 'status', header: 'Status', group: 'Basic Info', extract: (p) => p.status || '' },
  { key: 'completionStage', header: 'Completion Stage', group: 'Basic Info', extract: (p) => p.completionStage || '' },
  // People & Teams
  { key: 'ownerName', header: 'Owner Name', group: 'People & Teams', extract: (p) => p.owner?.profile?.name || '' },
  { key: 'ownerEmail', header: 'Owner Email', group: 'People & Teams', extract: (p) => p.owner?.email || '' },
  { key: 'team', header: 'Team', group: 'People & Teams', extract: (p) => p.team?.map((u) => u.email).join('; ') || '' },
  { key: 'canonicalTeam', header: 'Canonical Team', group: 'People & Teams', extract: (p) => p.canonicalTeam || '' },
  // Media & Links
  { key: 'logo', header: 'Logo', group: 'Media & Links', extract: (p) => p.logo || '' },
  { key: 'repoLinks', header: 'Repo Links', group: 'Media & Links', extract: (p) => p.repoLinks?.join('; ') || '' },
  { key: 'demoUrl', header: 'Demo URL', group: 'Media & Links', extract: (p) => p.demoUrl || '' },
  { key: 'slidesUrl', header: 'Slides URL', group: 'Media & Links', extract: (p) => p.slidesUrl || '' },
  { key: 'externalLinks', header: 'External Links', group: 'Media & Links', extract: (p) => p.externalLinks?.map((l) => `${l.label}: ${l.url}`).join('; ') || '' },
  { key: 'asciinema', header: 'Asciinema Casts', group: 'Media & Links', extract: (p) => p.asciinema?.map((a) => `${a.title}: ${a.castId}`).join('; ') || '' },
  { key: 'videos', header: 'Videos', group: 'Media & Links', extract: (p) => p.videos?.map((v) => `${v.title} (${v.type}): ${v.url}`).join('; ') || '' },
  // Stats & Dates
  { key: 'avgRating', header: 'Avg Rating', group: 'Stats & Dates', extract: (p) => Number.isFinite(p.avgRating) ? p.avgRating.toFixed(2) : '0' },
  { key: 'voteCount', header: 'Vote Count', group: 'Stats & Dates', extract: (p) => p.voteCount ?? 0 },
  { key: 'totalStars', header: 'Total Stars', group: 'Stats & Dates', extract: (p) => p.totalStars ?? 0 },
  { key: 'createdAt', header: 'Created At', group: 'Stats & Dates', extract: (p) => p.createdAt?.toISOString() || '' },
  { key: 'updatedAt', header: 'Updated At', group: 'Stats & Dates', extract: (p) => p.updatedAt?.toISOString() || '' },
];
exports.CSV_FIELD_REGISTRY = CSV_FIELD_REGISTRY;

/** Sanitize a single CSV cell: quote-wrap, escape quotes/newlines, prevent formula injection. */
function sanitizeCsvCell(c) {
  const s = String(c).replace(/"/g, '""').replace(/[\r\n]/g, '\\n');
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return `"${safe}"`;
}
exports.sanitizeCsvCell = sanitizeCsvCell;
```

- [ ] **Step 2: Replace the existing `exportCsv` handler**

Replace lines 267–313 (the entire `exportCsv` function including its JSDoc comment) with:

```javascript
/**
 * GET /admin/export
 * Optional query: ?fields=title,category,... (comma-separated field keys).
 * When omitted, all fields are exported (backward compatible).
 */
exports.exportCsv = async (req, res, next) => {
  try {
    const projects = await Project.find()
      .populate('owner', 'email profile.name')
      .populate('team', 'email profile.name')
      .lean();

    const validKeys = CSV_FIELD_REGISTRY.map((f) => f.key);
    const requestedKeys = req.query.fields
      ? req.query.fields.split(',').filter((k) => validKeys.includes(k))
      : null;
    const fields = requestedKeys && requestedKeys.length
      ? CSV_FIELD_REGISTRY.filter((f) => requestedKeys.includes(f.key))
      : CSV_FIELD_REGISTRY;

    const rows = [fields.map((f) => f.header)];
    for (const p of projects) {
      rows.push(fields.map((f) => f.extract(p)));
    }

    const csv = rows.map((r) => r.map(sanitizeCsvCell).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="megademo-projects.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
};
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern=admin.test 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 4: Run lint**

```bash
npm run lint-check 2>&1 | tail -10
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add controllers/admin.js tests/controllers/admin.test.js
git commit -m "feat: add CSV field registry with all project metadata and field filtering

Refactor exportCsv to use a static field registry. All 21 project fields
are exportable. Optional ?fields= query param allows column selection.
Backward compatible: no param exports all fields.

Export sanitizeCsvCell and CSV_FIELD_REGISTRY for direct testing.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Export Modal SCSS

**Files:**
- Modify: `public/css/main.scss` (insert after line 1100, after `.md-modal` block)

- [ ] **Step 1: Add the export modal group header style**

Insert after line 1100 (after the `.md-modal` closing brace) in `public/css/main.scss`:

```scss
.export-group-header {
  font-size: 0.7rem; letter-spacing: 1px; text-transform: uppercase;
  color: $color-muted; margin: 0.75rem 0 0.35rem;
  padding-bottom: 0.25rem; border-bottom: 1px solid rgba($color-border, 0.5);
  display: flex; align-items: center; justify-content: space-between;
  .group-toggle { font-size: 0.65rem; text-transform: none; letter-spacing: 0; cursor: pointer; color: $color-primary; background: none; border: none; padding: 0; &:hover { text-decoration: underline; } }
}
.export-global-toggle { margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid $color-border; }
```

- [ ] **Step 2: Recompile SCSS**

```bash
npm run scss
```

Expected: exits 0, `public/css/main.css` is regenerated.

- [ ] **Step 3: Commit**

```bash
git add public/css/main.scss public/css/main.css
git commit -m "style: add SCSS for CSV export modal group headers

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Export Modal UI — Dashboard Template

**Files:**
- Modify: `views/admin/dashboard.pug` (line 94, after line 162, inside `block scripts`)

- [ ] **Step 1: Replace the export link with a modal trigger**

In `views/admin/dashboard.pug`, replace line 94:

```pug
        a.btn.btn-neon-outline(href='/admin/export') Export CSV
```

with:

```pug
        button.btn.btn-neon-outline(type='button', data-bs-toggle='modal', data-bs-target='#exportModal') Export CSV
```

- [ ] **Step 2: Add the export modal markup**

Insert after line 162 (after the `#resetModal` closing — before `block scripts`) in `views/admin/dashboard.pug`:

```pug

  // Export CSV modal
  #exportModal.modal.fade(tabindex='-1', aria-labelledby='exportModalLabel', aria-hidden='true')
    .modal-dialog.modal-dialog-centered.modal-dialog-scrollable
      .modal-content.md-modal
        .modal-header
          h5.modal-title#exportModalLabel Export Projects to CSV
          button.btn-close(type='button', data-bs-dismiss='modal', aria-label='Close')
        .modal-body
          .export-global-toggle
            label.checkbox-item
              input#exportSelectAll(type='checkbox', checked)
              span Select All
          //- Basic Info
          .export-group-header
            span Basic Info
            button.group-toggle(type='button', data-group='basic') Deselect
          .checkbox-grid
            label.checkbox-item
              input.export-field(type='checkbox', data-key='title', data-group='basic', checked)
              span Title
            label.checkbox-item
              input.export-field(type='checkbox', data-key='slug', data-group='basic', checked)
              span Slug
            label.checkbox-item
              input.export-field(type='checkbox', data-key='description', data-group='basic', checked)
              span Description
            label.checkbox-item
              input.export-field(type='checkbox', data-key='category', data-group='basic', checked)
              span Category
            label.checkbox-item
              input.export-field(type='checkbox', data-key='status', data-group='basic', checked)
              span Status
            label.checkbox-item
              input.export-field(type='checkbox', data-key='completionStage', data-group='basic', checked)
              span Completion Stage
          //- People & Teams
          .export-group-header
            span People &amp; Teams
            button.group-toggle(type='button', data-group='people') Deselect
          .checkbox-grid
            label.checkbox-item
              input.export-field(type='checkbox', data-key='ownerName', data-group='people', checked)
              span Owner Name
            label.checkbox-item
              input.export-field(type='checkbox', data-key='ownerEmail', data-group='people', checked)
              span Owner Email
            label.checkbox-item
              input.export-field(type='checkbox', data-key='team', data-group='people', checked)
              span Team Members
            label.checkbox-item
              input.export-field(type='checkbox', data-key='canonicalTeam', data-group='people', checked)
              span Canonical Team
          //- Media & Links
          .export-group-header
            span Media &amp; Links
            button.group-toggle(type='button', data-group='media') Deselect
          .checkbox-grid
            label.checkbox-item
              input.export-field(type='checkbox', data-key='logo', data-group='media', checked)
              span Logo
            label.checkbox-item
              input.export-field(type='checkbox', data-key='repoLinks', data-group='media', checked)
              span Repo Links
            label.checkbox-item
              input.export-field(type='checkbox', data-key='demoUrl', data-group='media', checked)
              span Demo URL
            label.checkbox-item
              input.export-field(type='checkbox', data-key='slidesUrl', data-group='media', checked)
              span Slides URL
            label.checkbox-item
              input.export-field(type='checkbox', data-key='externalLinks', data-group='media', checked)
              span External Links
            label.checkbox-item
              input.export-field(type='checkbox', data-key='asciinema', data-group='media', checked)
              span Asciinema Casts
            label.checkbox-item
              input.export-field(type='checkbox', data-key='videos', data-group='media', checked)
              span Videos
          //- Stats & Dates
          .export-group-header
            span Stats &amp; Dates
            button.group-toggle(type='button', data-group='stats') Deselect
          .checkbox-grid
            label.checkbox-item
              input.export-field(type='checkbox', data-key='avgRating', data-group='stats', checked)
              span Avg Rating
            label.checkbox-item
              input.export-field(type='checkbox', data-key='voteCount', data-group='stats', checked)
              span Vote Count
            label.checkbox-item
              input.export-field(type='checkbox', data-key='totalStars', data-group='stats', checked)
              span Total Stars
            label.checkbox-item
              input.export-field(type='checkbox', data-key='createdAt', data-group='stats', checked)
              span Created At
            label.checkbox-item
              input.export-field(type='checkbox', data-key='updatedAt', data-group='stats', checked)
              span Updated At
        .modal-footer
          button.btn.btn-neon-outline(type='button', data-bs-dismiss='modal') Cancel
          button#exportSubmitBtn.btn.btn-neon-cyan(type='button') Export
```

- [ ] **Step 3: Commit the modal markup**

```bash
git add views/admin/dashboard.pug
git commit -m "feat: add CSV export modal with grouped field checkboxes

Replace the direct export link with a Bootstrap modal trigger.
Modal has 4 groups (Basic Info, People & Teams, Media & Links,
Stats & Dates) with themed checkboxes, all pre-checked.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Export Modal JavaScript

**Files:**
- Modify: `views/admin/dashboard.pug` (inside `block scripts`, at the end of the existing `script(nonce=cspNonce).` block, before the closing of that block)

- [ ] **Step 1: Add the export modal JavaScript**

Append the following to the end of the inline script block in `views/admin/dashboard.pug` (inside the `script(nonce=cspNonce).` block, after the banner char counter IIFE):

```javascript
    // ── Export CSV modal logic ─────────────────────────────────────────────
    (function () {
      var selectAll = document.getElementById('exportSelectAll');
      var exportBtn = document.getElementById('exportSubmitBtn');
      var allFields = document.querySelectorAll('.export-field');
      var groupToggles = document.querySelectorAll('.group-toggle');

      function updateGroupToggle(group) {
        var fields = document.querySelectorAll('.export-field[data-group="' + group + '"]');
        var btn = document.querySelector('.group-toggle[data-group="' + group + '"]');
        if (!btn) return;
        var checked = 0;
        fields.forEach(function (f) { if (f.checked) checked++; });
        btn.textContent = checked === fields.length ? 'Deselect' : 'Select';
      }

      function updateSelectAll() {
        var checked = 0;
        allFields.forEach(function (f) { if (f.checked) checked++; });
        selectAll.checked = checked === allFields.length;
        selectAll.indeterminate = checked > 0 && checked < allFields.length;
      }

      selectAll.addEventListener('change', function () {
        var state = selectAll.checked;
        allFields.forEach(function (f) { f.checked = state; });
        groupToggles.forEach(function (btn) {
          btn.textContent = state ? 'Deselect' : 'Select';
        });
      });

      groupToggles.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var group = btn.dataset.group;
          var fields = document.querySelectorAll('.export-field[data-group="' + group + '"]');
          var allChecked = true;
          fields.forEach(function (f) { if (!f.checked) allChecked = false; });
          var newState = !allChecked;
          fields.forEach(function (f) { f.checked = newState; });
          btn.textContent = newState ? 'Deselect' : 'Select';
          updateSelectAll();
        });
      });

      allFields.forEach(function (f) {
        f.addEventListener('change', function () {
          updateGroupToggle(f.dataset.group);
          updateSelectAll();
        });
      });

      exportBtn.addEventListener('click', function () {
        var keys = [];
        allFields.forEach(function (f) { if (f.checked) keys.push(f.dataset.key); });
        if (keys.length === 0) {
          alert('Select at least one field to export.');
          return;
        }
        // If all fields are selected, omit the param for a cleaner URL
        var url = keys.length === allFields.length
          ? '/admin/export'
          : '/admin/export?fields=' + keys.join(',');
        window.location = url;
      });
    })();
```

- [ ] **Step 2: Run lint**

```bash
npm run lint-check 2>&1 | tail -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add views/admin/dashboard.pug
git commit -m "feat: add export modal JavaScript for field selection and download

Select All / Deselect All global toggle, per-group toggles, and
export button that constructs the download URL with selected field keys.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Update DESIGN.md

**Files:**
- Modify: `DESIGN.md` (line 41)

- [ ] **Step 1: Update the admin.js description**

Replace line 41 in `DESIGN.md`:

```
  admin.js          Settings, user roles, tag/team management, CSV export, activity log, reset
```

with:

```
  admin.js          Settings, user roles, tag/team management, CSV export (modal with field selection), activity log, reset
```

- [ ] **Step 2: Add a design decision entry**

Add the following after the existing "Seed data from YAML" design decision paragraph (after the line that says `Seeds on first startup (idempotent). Admins can override via dashboard.`):

```markdown

**CSV export with field selection.** `GET /admin/export` uses a `CSV_FIELD_REGISTRY` array to define all 21 exportable project fields. Each entry has a key, header, group, and extraction function. An optional `?fields=` query parameter (comma-separated keys) controls which columns appear — omitting it exports everything. The admin dashboard presents a modal with themed checkboxes grouped into four sections (Basic Info, People & Teams, Media & Links, Stats & Dates), all pre-checked, with per-group and global Select All/Deselect All toggles. Cells are double-quoted with `"` escaping, newlines replaced by literal `\n`, and formula-starting characters prefixed with `'` to prevent CSV injection. Raw Markdown descriptions are exported as-is.
```

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "docs: document CSV export modal and field registry in DESIGN.md

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full lint check**

```bash
npm run lint-check
```

Expected: 0 errors.

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: All tests pass (existing + new).

- [ ] **Step 3: Verify SCSS is compiled**

```bash
git diff --name-only
```

Expected: No unstaged changes. All files committed.

- [ ] **Step 4: Verify git log**

```bash
git --no-pager log --oneline main..HEAD
```

Expected: 5–6 commits on `feature/csv-export-modal` branch.
