# CSV Export Modal — Design Spec

**Date**: 2026-05-14
**Status**: Approved
**Branch**: Feature branch (TBD name, off `main`)

---

## Problem

The current CSV export (`GET /admin/export`) dumps a fixed set of 14 columns with no user control. It omits several project fields (description, slug, logo, slidesUrl, externalLinks, asciinema, videos, totalStars, updatedAt). Admins need the ability to export all project metadata and choose which columns to include.

## Solution

Replace the direct-download link on the admin dashboard with a modal dialog. The modal presents all exportable fields as themed checkboxes (pre-checked by default), grouped into logical sections with per-group and global select/deselect toggles. Clicking "Export" constructs a GET URL with the selected field keys as a query parameter, triggering the CSV download.

---

## Field Registry

A static array defines all exportable fields. Each entry has a `key` (query param value), `header` (CSV column name), `group` (UI section), and `extract` function (maps a project document to a cell value).

### Groups and Fields

| Group | Key | CSV Header | Format |
|---|---|---|---|
| **Basic Info** | `title` | Title | Plain string |
| | `slug` | Slug | Plain string |
| | `description` | Description | Raw Markdown, escaped |
| | `category` | Category | Plain string |
| | `status` | Status | Plain string (draft/submitted/finalist) |
| | `completionStage` | Completion Stage | Plain string |
| **People & Teams** | `ownerName` | Owner Name | `profile.name` or empty |
| | `ownerEmail` | Owner Email | `email` |
| | `team` | Team | Semicolon-delimited emails |
| | `canonicalTeam` | Canonical Team | Plain string |
| **Media & Links** | `logo` | Logo | URL string |
| | `repoLinks` | Repo Links | Semicolon-delimited URLs |
| | `demoUrl` | Demo URL | URL string |
| | `slidesUrl` | Slides URL | URL string |
| | `externalLinks` | External Links | `Label: url; Label2: url2` |
| | `asciinema` | Asciinema Casts | `title: castId; ...` |
| | `videos` | Videos | `title (type): url; ...` |
| **Stats & Dates** | `avgRating` | Avg Rating | 2 decimal places |
| | `voteCount` | Vote Count | Integer |
| | `totalStars` | Total Stars | Integer |
| | `createdAt` | Created At | ISO 8601 |
| | `updatedAt` | Updated At | ISO 8601 |

**Excluded**: `githubStats` (nested cache data, not useful in CSV), `_id` (internal).

---

## UI Design

### Dashboard Change

The existing link:
```pug
a.btn.btn-neon-outline(href='/admin/export') Export CSV
```
Becomes a modal trigger:
```pug
button.btn.btn-neon-outline(type='button', data-bs-toggle='modal', data-bs-target='#exportModal') Export CSV
```

### Modal Structure

- **Theme**: `.md-modal` (existing dark synthwave modal style)
- **Header**: "Export Projects to CSV" + close button
- **Body**:
  - Global toggle: `.checkbox-item` — "Select All"
  - Section headers (small, muted labels like `.section-label`)
  - Per-section toggle: `.checkbox-item` — group name (toggles all fields in group)
  - Field checkboxes: `.checkbox-item` — one per field, all checked by default
  - Layout: `.checkbox-grid` within each group for responsive columns
- **Footer**: "Export" button (`.btn-neon-cyan`), "Cancel" button (`.btn-neon-outline`, `data-bs-dismiss='modal'`)

### Checkbox Behavior

- **Global "Select All"**: Toggles every field checkbox. Indeterminate state when some but not all are checked.
- **Group toggles**: Toggle all fields within the group. Indeterminate when partial.
- **Individual checkboxes**: Update parent group toggle and global toggle states on change.
- **Export button**: Collects keys of all checked field checkboxes, constructs URL `/admin/export?fields=key1,key2,...`, assigns to `window.location`. If nothing checked, shows a brief alert ("Select at least one field").

---

## Server-Side Changes

### Controller: `exports.exportCsv`

1. Parse `req.query.fields` — split by comma, filter against valid keys from the field registry.
2. If `fields` param is absent or empty, use all fields (backward compatible with bookmarked `/admin/export` URLs).
3. Build header row from selected fields' `header` values.
4. Build data rows by calling each selected field's `extract(project)` function.
5. Apply existing cell sanitization:
   - `String(c).replace(/"/g, '""')` — escape double quotes
   - `.replace(/[\r\n]/g, '\\n')` — escape newlines as literal `\n`
   - Prefix `'` on cells starting with `=`, `+`, `-`, `@`, or TAB (CSV injection prevention)
   - Wrap every cell in double quotes
6. Join cells with commas, rows with newlines. Send as `text/csv` with `Content-Disposition: attachment`.

### Escaping Feasibility

Markdown descriptions can contain any character combination. The double-quote-and-escape approach handles all cases:
- `"` → `""` (RFC 4180 compliant)
- Newlines → literal `\n` (prevents row splitting)
- Commas → safe inside quoted cells
- Backticks, pipes, brackets, asterisks → pass through unchanged
- Formula-starting chars → prefixed with `'` to prevent spreadsheet injection

No character in valid Markdown can break the CSV structure when properly double-quoted and escaped.

---

## Testing Strategy

### New Tests (in `admin.test.js`)

1. **Field registry completeness**: Verify the registry covers all intended project schema fields.
2. **Field filtering**: Given `?fields=title,category`, output contains exactly 2 columns.
3. **Backward compat**: No `?fields` param → output contains all columns.
4. **Markdown escaping**: Description with quotes, newlines, commas, markdown syntax → valid CSV cell.
5. **Structured array formatting**: externalLinks, videos, asciinema → semicolon-delimited `label: value` format.
6. **Empty/null fields**: Missing optional fields → empty string cell, not "null" or "undefined".
7. **CSV injection**: Cells starting with `=`, `+`, `-`, `@` → prefixed with `'`.

### Existing Tests

All existing CSV sanitizer and avgRating formatting tests remain unchanged and passing.

---

## Files Changed

| File | Change |
|---|---|
| `controllers/admin.js` | Refactor `exportCsv` — add field registry, query param parsing, new extractors |
| `views/admin/dashboard.pug` | Replace export link with modal trigger + modal markup |
| `public/css/main.scss` | Add `.export-group-header` style for section labels inside the modal (small muted label reusing `$color-muted`) |
| `public/css/main.css` | Recompiled from SCSS |
| `tests/controllers/admin.test.js` | New test cases for field filtering, formatting, escaping |
| `DESIGN.md` | Document the enhanced CSV export feature |

---

## Non-Goals

- No client-side CSV generation (keeps logic server-side)
- No JSON/Excel/PDF export formats (CSV only)
- No GitHub stats export (excluded by decision)
- No per-project export (always exports all projects)
- No saved export presets (checkboxes reset to all-checked on each open)
