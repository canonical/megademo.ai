# Project Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add filter-as-you-type project search to `/projects` and `/admin/projects` via server-side API endpoints.

**Architecture:** Two new JSON API endpoints (`GET /api/projects/search` and `GET /admin/projects/search`) perform case-insensitive regex search on title and description, capped at 50 results. Each page gets a search `<input>` whose `input` event is debounced (250 ms) and calls the API. Results replace the existing grid/table; clearing the input restores the original server-rendered content.

**Tech Stack:** Node.js/Express, MongoDB `$regex`, Pug templates, vanilla JS

**Spec:** `docs/superpowers/specs/2026-05-15-project-search-design.md`

---

### Task 1: Public search API — tests

**Files:**
- Modify: `tests/controllers/project.test.js` (append new describe block)

- [ ] **Step 1: Add `searchProjects()` tests**

Append this `describe` block at the end of the file, after the last existing `describe`:

```javascript
// ─── searchProjects ───────────────────────────────────────────────────────

describe('searchProjects()', () => {
  beforeEach(async () => {
    project.status = 'submitted';
    project.description = 'An AI helper for automated testing';
    await project.save();
  });

  it('returns matching projects by title substring', async () => {
    const req = makeReq({ query: { q: 'Test' } });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: expect.arrayContaining([
          expect.objectContaining({ title: 'Test Project' }),
        ]),
      }),
    );
  });

  it('returns matching projects by description substring', async () => {
    const req = makeReq({ query: { q: 'automated testing' } });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: expect.arrayContaining([
          expect.objectContaining({ title: 'Test Project' }),
        ]),
      }),
    );
  });

  it('is case-insensitive', async () => {
    const req = makeReq({ query: { q: 'test project' } });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: [expect.objectContaining({ title: 'Test Project' })],
      }),
    );
  });

  it('excludes draft projects', async () => {
    project.status = 'draft';
    await project.save();
    const req = makeReq({ query: { q: 'Test' } });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith({ projects: [] });
  });

  it('returns empty array when q is missing', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith({ projects: [] });
  });

  it('returns empty array when q is empty string', async () => {
    const req = makeReq({ query: { q: '' } });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith({ projects: [] });
  });

  it('respects category filter', async () => {
    const req = makeReq({ query: { q: 'Test', category: 'Coding Assistant' } });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith({ projects: [] });
  });

  it('includes liveliness in results', async () => {
    const req = makeReq({ query: { q: 'Test' } });
    const res = makeRes();
    await ctrl.searchProjects(req, res);
    const { projects } = res.json.mock.calls[0][0];
    expect(projects[0]).toHaveProperty('liveliness');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npx jest tests/controllers/project.test.js --forceExit --silent 2>&1 | tail -5`

Expected: FAIL — `ctrl.searchProjects is not a function`

---

### Task 2: Public search API — implementation + route

**Files:**
- Modify: `controllers/project.js` (add `searchProjects` handler)
- Modify: `app.js` (add route)

- [ ] **Step 1: Add `searchProjects` handler to `controllers/project.js`**

Insert this handler after the existing `exports.list` function (after the `};` that closes it, before the `GET /projects/new` comment):

```javascript
/**
 * GET /api/projects/search?q=<term>
 * Returns up to 50 submitted/finalist projects matching title or description.
 */
exports.searchProjects = async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ projects: [] });

  const ALLOWED_SORTS = ['newest', 'stars', 'rating', 'votes'];
  const sort     = ALLOWED_SORTS.includes(req.query.sort) ? req.query.sort : 'newest';
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : undefined;
  const team     = typeof req.query.team === 'string' && req.query.team.trim() ? req.query.team.trim() : undefined;

  const re = new RegExp(escapeRegex(q), 'i');
  const filter = {
    status: { $in: ['submitted', 'finalist'] },
    $or: [{ title: re }, { description: re }],
  };
  if (category) filter.category = category;
  if (team) filter.canonicalTeam = team;

  const sortMap = {
    newest: { createdAt: -1 },
    rating: { avgRating: -1, voteCount: -1 },
    stars:  { totalStars: -1, avgRating: -1 },
    votes:  { voteCount: -1 },
  };

  const projects = await Project.find(filter)
    .sort(sortMap[sort] || sortMap.newest)
    .limit(50)
    .select('title slug category canonicalTeam avgRating voteCount status logo aiTools githubStats updatedAt')
    .lean();

  projects.forEach((p) => { p.liveliness = computeLiveliness(p); });

  res.json({ projects });
};
```

- [ ] **Step 2: Add route in `app.js`**

In `app.js`, add this line immediately **before** `app.get('/projects', projectController.list);`:

```javascript
app.get('/api/projects/search', projectController.searchProjects);
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npx jest tests/controllers/project.test.js --forceExit --silent 2>&1 | tail -5`

Expected: all tests PASS

- [ ] **Step 4: Run full test suite + lint**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npm run lint-check && npm test`

Expected: 0 lint errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add controllers/project.js app.js tests/controllers/project.test.js
git commit -m "Add public project search API endpoint (GET /api/projects/search)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Admin search API — tests

**Files:**
- Modify: `tests/controllers/admin.test.js` (append new describe block)

- [ ] **Step 1: Add `searchProjects()` tests**

At the top of the file, add a mock for mattermost (required because the admin controller imports it) — check if it already has one. If not, add above the existing `require` lines:

```javascript
jest.mock('../../services/mattermost', () => ({ notifyFinalistPromoted: jest.fn() }));
```

Then append this describe block at the end of the file:

```javascript
// ─── admin searchProjects ─────────────────────────────────────────────────

describe('admin searchProjects()', () => {
  const adminCtrl = require('../../controllers/admin');

  function makeReq(overrides = {}) {
    return { user: { _id: new (require('mongoose').Types.ObjectId)(), role: 'admin' }, params: {}, body: {}, query: {}, headers: {}, flash: jest.fn(), ...overrides };
  }
  function makeRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
  }

  beforeEach(async () => {
    await db.clearAll();
    const User = require('../../models/User');
    const owner = await User.create({ email: 'admin@canonical.com', github: 'admin-gh' });
    await Project.create({ title: 'Alpha Bot', description: 'Robot assistant', category: 'Other', owner: owner._id, team: [owner._id], status: 'submitted' });
    await Project.create({ title: 'Beta Tool', description: 'Dev tooling', category: 'Developer Tooling', owner: owner._id, team: [owner._id], status: 'draft' });
  });

  it('returns matching projects by title', async () => {
    const req = makeReq({ query: { q: 'Alpha' } });
    const res = makeRes();
    await adminCtrl.searchProjects(req, res);
    const { projects } = res.json.mock.calls[0][0];
    expect(projects).toHaveLength(1);
    expect(projects[0].title).toBe('Alpha Bot');
  });

  it('includes draft projects (admin can see all)', async () => {
    const req = makeReq({ query: { q: 'Beta' } });
    const res = makeRes();
    await adminCtrl.searchProjects(req, res);
    const { projects } = res.json.mock.calls[0][0];
    expect(projects).toHaveLength(1);
    expect(projects[0].status).toBe('draft');
  });

  it('respects status filter', async () => {
    const req = makeReq({ query: { q: 'Bot', status: 'draft' } });
    const res = makeRes();
    await adminCtrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith({ projects: [] });
  });

  it('returns empty array when q is missing', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();
    await adminCtrl.searchProjects(req, res);
    expect(res.json).toHaveBeenCalledWith({ projects: [] });
  });

  it('populates owner profile name', async () => {
    const req = makeReq({ query: { q: 'Alpha' } });
    const res = makeRes();
    await adminCtrl.searchProjects(req, res);
    const { projects } = res.json.mock.calls[0][0];
    expect(projects[0]).toHaveProperty('owner');
  });

  it('includes liveliness in results', async () => {
    const req = makeReq({ query: { q: 'Alpha' } });
    const res = makeRes();
    await adminCtrl.searchProjects(req, res);
    const { projects } = res.json.mock.calls[0][0];
    expect(projects[0]).toHaveProperty('liveliness');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npx jest tests/controllers/admin.test.js --forceExit --silent 2>&1 | tail -5`

Expected: FAIL — `adminCtrl.searchProjects is not a function`

---

### Task 4: Admin search API — implementation + route

**Files:**
- Modify: `controllers/admin.js` (add escapeRegex helper + searchProjects handler)
- Modify: `app.js` (add route)

- [ ] **Step 1: Add `escapeRegex` helper to `controllers/admin.js`**

Add this function near the top of the file, after the existing constant declarations (after `const ALLOWED_STATUSES = ...` line):

```javascript
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 2: Add `searchProjects` handler to `controllers/admin.js`**

Insert immediately after the existing `exports.projects` function:

```javascript
/**
 * GET /admin/projects/search?q=<term>
 * Returns up to 50 projects matching title or description (admin — all statuses).
 */
exports.searchProjects = async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ projects: [] });

  const status   = ALLOWED_STATUSES.includes(req.query.status) ? req.query.status : undefined;
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : undefined;

  const re = new RegExp(escapeRegex(q), 'i');
  const filter = { $or: [{ title: re }, { description: re }] };
  if (status)   filter.status   = status;
  if (category) filter.category = category;

  const projects = await Project.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('owner', 'profile.name')
    .lean();

  projects.forEach((p) => { p.liveliness = computeLiveliness(p); });

  res.json({ projects });
};
```

- [ ] **Step 3: Add route in `app.js`**

In `app.js`, add this line immediately **before** `app.get('/admin/projects', authController.isAdmin, adminController.projects);`:

```javascript
app.get('/admin/projects/search', authController.isAdmin, adminController.searchProjects);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npx jest tests/controllers/admin.test.js --forceExit --silent 2>&1 | tail -5`

Expected: all tests PASS

- [ ] **Step 5: Run full test suite + lint**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npm run lint-check && npm test`

Expected: 0 lint errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add controllers/admin.js app.js tests/controllers/admin.test.js
git commit -m "Add admin project search API endpoint (GET /admin/projects/search)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Public `/projects` page — search UI

**Files:**
- Modify: `views/projects/list.pug`

- [ ] **Step 1: Add search input and content wrappers**

Replace the entire `views/projects/list.pug` with the following. Key changes: search input added to filters bar, original content wrapped in `#original-content`, search results container added, JS block rewritten.

```pug
extends ../layout

block content
  .page-header
    h1.pixel-text PROJECTS
    p.lead Browse all #{pagination.totalProjects} submitted AI experiments
    a.btn.btn-neon-outline.btn-sm.mt-2(href='/visualize') Topic Map

  // Filters
  form#filters-form.filters-bar(method='GET', action='/projects')
    input#project-search.md-input(type='search', placeholder='Search projects\u2026', autocomplete='off', style='flex:1;min-width:200px')
    select.md-select.js-autosubmit(name='category')
      option(value='') All Categories
      each cat in CATEGORIES
        option(value=cat, selected=(filters.category === cat)) #{cat}
    select.md-select.js-autosubmit(name='team')
      option(value='') All Teams
      each team in CANONICAL_TEAMS
        option(value=team, selected=(filters.team === team)) #{team}
    select.md-select.js-autosubmit(name='sort')
      option(value='random', selected=(filters.sort === 'random')) Random
      option(value='newest', selected=(filters.sort === 'newest')) Newest First
      option(value='stars', selected=(filters.sort === 'stars')) Most Stars
      option(value='rating', selected=(filters.sort === 'rating')) Top Rated
      option(value='votes', selected=(filters.sort === 'votes')) Most Voted

  #original-content
    if projects.length
      .projects-grid-full
        each project in projects
          include ../partials/project-card

      if pagination.totalPages > 1
        nav.pagination-nav(aria-label='Project pages')
          ul.pagination.justify-content-center
            li.page-item(class=(pagination.page <= 1 ? 'disabled' : ''))
              - var prevParams = new URLSearchParams()
              - if (filters.category) prevParams.set('category', filters.category)
              - if (filters.team) prevParams.set('team', filters.team)
              - if (filters.sort && filters.sort !== 'random') prevParams.set('sort', filters.sort)
              - prevParams.set('page', pagination.page - 1)
              a.page-link(href=`/projects?${prevParams}`, aria-label='Previous') &laquo; Prev
            //- Windowed pagination: 1 ... [neighbors] ... last
            - var WINDOW = 2
            - var pages = []
            - for (var i = 1; i <= pagination.totalPages; i++)
              - if (i === 1 || i === pagination.totalPages || (i >= pagination.page - WINDOW && i <= pagination.page + WINDOW))
                - pages.push(i)
            - var prev = 0
            each pg in pages
              - if (pg - prev > 1)
                li.page-item.disabled
                  span.page-link &hellip;
              li.page-item(class=(pg === pagination.page ? 'active' : ''))
                - var pgParams = new URLSearchParams()
                - if (filters.category) pgParams.set('category', filters.category)
                - if (filters.team) pgParams.set('team', filters.team)
                - if (filters.sort && filters.sort !== 'random') pgParams.set('sort', filters.sort)
                - pgParams.set('page', pg)
                a.page-link(href=`/projects?${pgParams}`)= pg
              - prev = pg
            li.page-item(class=(pagination.page >= pagination.totalPages ? 'disabled' : ''))
              - var nextParams = new URLSearchParams()
              - if (filters.category) nextParams.set('category', filters.category)
              - if (filters.team) nextParams.set('team', filters.team)
              - if (filters.sort && filters.sort !== 'random') nextParams.set('sort', filters.sort)
              - nextParams.set('page', pagination.page + 1)
              a.page-link(href=`/projects?${nextParams}`, aria-label='Next') Next &raquo;
    else
      .empty-state.text-center.py-5
        p.text-muted No projects match your filters.
        a.btn.btn-neon-outline(href='/projects') Clear Filters

  #search-results(style='display:none')
    .projects-grid-full#search-grid
    #search-empty.empty-state.text-center.py-5(style='display:none')
      p.text-muted No projects match your search.

block scripts
  script(nonce=cspNonce).
    (function () {
      var searchInput   = document.getElementById('project-search');
      var form          = document.getElementById('filters-form');
      var originalBlock = document.getElementById('original-content');
      var searchBlock   = document.getElementById('search-results');
      var searchGrid    = document.getElementById('search-grid');
      var searchEmpty   = document.getElementById('search-empty');

      function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function renderCard(p) {
        var cls = p.status === 'finalist' ? 'project-card finalist' : 'project-card';
        var lv = p.liveliness || 0;
        var html = '<div class="' + cls + '" style="--liveliness: ' + lv + '">';
        if (p.status === 'finalist') html += '<div class="finalist-badge">FINALIST</div>';
        html += '<div class="card-inner"><div class="card-header-row">';
        if (p.logo) html += '<img class="project-logo" src="' + esc(p.logo) + '" alt="' + esc(p.title) + ' logo">';
        html += '<div class="card-titles">';
        html += '<a class="project-title" href="/projects/' + esc(p.slug) + '">' + esc(p.title) + '</a>';
        html += '<div class="project-meta">';
        html += '<span class="category-tag">' + esc(p.category) + '</span>';
        html += '<span class="team-tag">' + esc(p.canonicalTeam) + '</span>';
        html += '</div></div></div>';
        html += '<div class="card-rating">';
        var avg = (typeof p.avgRating === 'number' && isFinite(p.avgRating)) ? p.avgRating.toFixed(1) : '\u2014';
        var vc = p.voteCount || 0;
        html += '<span class="avg-rating">' + avg + '</span>';
        html += '<span class="star-icon">\u2605</span>';
        html += '<span class="vote-count">(' + vc + ' ' + (vc === 1 ? 'vote' : 'votes') + ')</span>';
        html += '</div>';
        if (p.aiTools && p.aiTools.length) {
          html += '<div class="ai-tools-row">';
          p.aiTools.slice(0, 3).forEach(function (tool) {
            html += '<span class="ai-tool-tag">' + esc(tool) + '</span>';
          });
          html += '</div>';
        }
        html += '</div></div>';
        return html;
      }

      function doSearch() {
        var q = searchInput.value.trim();
        if (!q) {
          searchBlock.style.display = 'none';
          originalBlock.style.display = '';
          return;
        }
        var params = new URLSearchParams();
        params.set('q', q);
        var cat = form.querySelector('[name="category"]').value;
        var team = form.querySelector('[name="team"]').value;
        var sort = form.querySelector('[name="sort"]').value;
        if (cat) params.set('category', cat);
        if (team) params.set('team', team);
        if (sort && sort !== 'random') params.set('sort', sort);

        fetch('/api/projects/search?' + params)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            originalBlock.style.display = 'none';
            searchBlock.style.display = '';
            if (data.projects && data.projects.length) {
              searchGrid.innerHTML = data.projects.map(renderCard).join('');
              searchGrid.style.display = '';
              searchEmpty.style.display = 'none';
            } else {
              searchGrid.style.display = 'none';
              searchEmpty.style.display = '';
            }
          })
          .catch(function () {
            searchGrid.innerHTML = '';
            searchGrid.style.display = 'none';
            searchEmpty.style.display = '';
          });
      }

      // Debounced search on input
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(doSearch, 250);
      });

      // Prevent form submission when pressing Enter in search box
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.preventDefault();
      });

      // When dropdowns change: if search is active, re-search instead of form submit
      document.querySelectorAll('.js-autosubmit').forEach(function (sel) {
        sel.addEventListener('change', function (e) {
          if (searchInput.value.trim()) {
            e.preventDefault();
            e.stopPropagation();
            doSearch();
          } else {
            sel.form.submit();
          }
        });
      });
    })();
```

- [ ] **Step 2: Run lint + tests**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npm run lint-check && npm test`

Expected: 0 lint errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add views/projects/list.pug
git commit -m "Add filter-as-you-type search to public /projects page

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Admin `/admin/projects` page — search UI

**Files:**
- Modify: `views/admin/projects.pug`

- [ ] **Step 1: Rewrite `views/admin/projects.pug` with search support**

Replace the entire file. Key changes: search input added to filters bar, the inline JS is refactored to extract handler-attachment functions so they can be re-called after rendering search results, search logic added.

```pug
extends ../layout

block content
  .page-header
    h1.pixel-text MANAGE PROJECTS
    a.btn.btn-neon-outline.me-2(href='/admin/guide') Admin Guide
    a.btn.btn-neon-outline(href='/admin') <- Admin Dashboard

  .filters-bar.d-flex.flex-wrap.gap-2.mb-3
    input#admin-project-search.md-input(type='search', placeholder='Search projects\u2026', autocomplete='off', style='flex:1;min-width:200px')
    form#admin-filters-form.d-contents(method='GET', action='/admin/projects')
      select.md-select.js-admin-autosubmit(name='status')
        option(value='', selected=(!filters.status)) All Statuses
        option(value='draft', selected=(filters.status==='draft')) Draft
        option(value='submitted', selected=(filters.status==='submitted')) Submitted
        option(value='finalist', selected=(filters.status==='finalist')) Finalist
      select.md-select.js-admin-autosubmit(name='category')
        option(value='', selected=(!filters.category)) All Categories
        each cat in CATEGORIES
          option(value=cat, selected=(filters.category===cat)) #{cat}

  .table-responsive.mt-4
    table.md-table
      thead
        tr
          th Title
          th Category
          th Owner
          th Rating
          th Status
          th Actions
      tbody#admin-project-tbody
        each p in projects
          tr
            td
              a(href='/projects/' + p.slug)= p.title
            td= p.category
            td= p.owner && p.owner.profile ? p.owner.profile.name : '\u2014'
            td #{p.avgRating ? p.avgRating.toFixed(1) : '\u2014'} (#{p.voteCount || 0})
            td
              span(class='status-badge status-' + p.status)= p.status
            td
              .status-controls(data-project-id=p._id, data-csrf=_csrf)
                if p.status !== 'draft'
                  button.btn.btn-xs.btn-neon-outline.js-set-status(type='button', data-status='draft') Draft
                if p.status !== 'submitted'
                  button.btn.btn-xs.btn-neon-outline.ms-1.js-set-status(type='button', data-status='submitted') Submit
                if p.status !== 'finalist'
                  button.btn.btn-xs.btn-neon-outline.ms-1.js-set-status(type='button', data-status='finalist') 🏆
                button.btn.btn-xs.btn-danger-outline.ms-2.js-delete-project(type='button',
                  data-project-id=p._id, data-csrf=_csrf, data-title=p.title) x

  #admin-search-empty.empty-state.text-center.py-5(style='display:none')
    p.text-muted No projects match your search.

block scripts
  script(nonce=cspNonce).
    (function () {
      var csrf = document.querySelector('meta[name="csrf-token"]').content;
      var searchInput  = document.getElementById('admin-project-search');
      var filtersForm  = document.getElementById('admin-filters-form');
      var tbody        = document.getElementById('admin-project-tbody');
      var searchEmpty  = document.getElementById('admin-search-empty');
      var tableWrapper = tbody.closest('.table-responsive');
      var originalHtml = tbody.innerHTML;
      var isSearching  = false;

      function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function renderRow(p) {
        var owner = (p.owner && p.owner.profile) ? esc(p.owner.profile.name) : '\u2014';
        var rating = p.avgRating ? p.avgRating.toFixed(1) : '\u2014';
        var vc = p.voteCount || 0;
        var id = esc(String(p._id));
        var title = esc(p.title);

        var statusBtns = '';
        if (p.status !== 'draft')
          statusBtns += '<button class="btn btn-xs btn-neon-outline js-set-status" type="button" data-status="draft">Draft</button>';
        if (p.status !== 'submitted')
          statusBtns += '<button class="btn btn-xs btn-neon-outline ms-1 js-set-status" type="button" data-status="submitted">Submit</button>';
        if (p.status !== 'finalist')
          statusBtns += '<button class="btn btn-xs btn-neon-outline ms-1 js-set-status" type="button" data-status="finalist">\uD83C\uDFC6</button>';
        statusBtns += '<button class="btn btn-xs btn-danger-outline ms-2 js-delete-project" type="button"'
          + ' data-project-id="' + id + '" data-csrf="' + esc(csrf) + '" data-title="' + title + '">x</button>';

        return '<tr>'
          + '<td><a href="/projects/' + esc(p.slug) + '">' + title + '</a></td>'
          + '<td>' + esc(p.category) + '</td>'
          + '<td>' + owner + '</td>'
          + '<td>' + rating + ' (' + vc + ')</td>'
          + '<td><span class="status-badge status-' + esc(p.status) + '">' + esc(p.status) + '</span></td>'
          + '<td><div class="status-controls" data-project-id="' + id + '" data-csrf="' + esc(csrf) + '">'
          + statusBtns + '</div></td>'
          + '</tr>';
      }

      function attachStatusHandlers() {
        tbody.querySelectorAll('.js-set-status').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var row = btn.closest('.status-controls');
            var id = row.dataset.projectId;
            var btnCsrf = row.dataset.csrf;
            var status = btn.dataset.status;
            try {
              var res = await fetch('/admin/projects/' + id + '/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': btnCsrf },
                body: JSON.stringify({ status: status })
              });
              if (res.ok) {
                if (isSearching) doSearch();
                else location.reload();
              } else {
                alert('Failed to update status. Please try again.');
              }
            } catch (e) {
              alert('Network error. Please try again.');
            }
          });
        });
      }

      function attachDeleteHandlers() {
        tbody.querySelectorAll('.js-delete-project').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var id = btn.dataset.projectId;
            var btnCsrf = btn.dataset.csrf;
            var title = btn.dataset.title;
            if (!confirm('Permanently delete "' + title.replace(/[\\"`]/g, '') + '" and all its votes? This cannot be undone.')) return;
            try {
              var res = await fetch('/admin/projects/' + id + '/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': btnCsrf },
              });
              if (res.ok) btn.closest('tr').remove();
              else alert('Failed to delete project. Please try again.');
            } catch (e) {
              alert('Network error. Please try again.');
            }
          });
        });
      }

      function attachAllHandlers() {
        attachStatusHandlers();
        attachDeleteHandlers();
      }

      function doSearch() {
        var q = searchInput.value.trim();
        if (!q) {
          isSearching = false;
          tbody.innerHTML = originalHtml;
          tableWrapper.style.display = '';
          searchEmpty.style.display = 'none';
          attachAllHandlers();
          return;
        }
        isSearching = true;
        var params = new URLSearchParams();
        params.set('q', q);
        var st = filtersForm.querySelector('[name="status"]').value;
        var cat = filtersForm.querySelector('[name="category"]').value;
        if (st) params.set('status', st);
        if (cat) params.set('category', cat);

        fetch('/admin/projects/search?' + params)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.projects && data.projects.length) {
              tbody.innerHTML = data.projects.map(renderRow).join('');
              tableWrapper.style.display = '';
              searchEmpty.style.display = 'none';
              attachAllHandlers();
            } else {
              tbody.innerHTML = '';
              tableWrapper.style.display = 'none';
              searchEmpty.style.display = '';
            }
          })
          .catch(function () {
            tbody.innerHTML = '';
            tableWrapper.style.display = 'none';
            searchEmpty.style.display = '';
          });
      }

      // Debounced search
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(doSearch, 250);
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.preventDefault();
      });

      // Dropdown filter changes: re-search or form submit
      document.querySelectorAll('.js-admin-autosubmit').forEach(function (sel) {
        sel.addEventListener('change', function () {
          if (searchInput.value.trim()) {
            doSearch();
          } else {
            filtersForm.submit();
          }
        });
      });

      // Attach handlers on initial page load
      attachAllHandlers();
    })();
```

Note: the liveliness column is intentionally removed from search results to keep the admin search rows clean and fast. The liveliness mock controls are a debugging/admin tool that is available on the full (non-search) page view. If the admin needs liveliness info, they can clear the search to see the full table.

- [ ] **Step 2: Run lint + tests**

Run: `cd /home/rkratky/git/gh/rkratky/megademo.ai && npm run lint-check && npm test`

Expected: 0 lint errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add views/admin/projects.pug
git commit -m "Add filter-as-you-type search to admin manage projects page

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Documentation update

**Files:**
- Modify: `DESIGN.md` (add note about search endpoints)

- [ ] **Step 1: Update DESIGN.md**

Add a subsection under the appropriate section describing the new API endpoints:

- `GET /api/projects/search?q=&category=&team=&sort=` — public, returns up to 50 submitted/finalist projects matching title or description
- `GET /admin/projects/search?q=&status=&category=` — admin-only, returns up to 50 projects of any status

- [ ] **Step 2: Commit**

```bash
git add DESIGN.md
git commit -m "Document project search API endpoints in DESIGN.md

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
