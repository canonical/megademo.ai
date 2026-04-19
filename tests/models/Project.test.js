const db = require('../setup/db');
const { Project } = require('../../models/Project');
const User = require('../../models/User');

let ownerId;

beforeAll(() => db.connect());
afterAll(() => db.disconnect());

beforeEach(async () => {
  await db.clearAll();
  const user = await User.create({ email: 'test@canonical.com', github: 'gh-123' });
  ownerId = user._id;
});

// ─── descriptionHtml virtual ───────────────────────────────────────────────

describe('descriptionHtml virtual', () => {
  it('converts markdown to HTML', () => {
    const p = new Project({ title: 'T', category: 'Other', owner: ownerId, description: '**bold** text' });
    expect(p.descriptionHtml).toContain('<strong>bold</strong>');
  });

  it('strips disallowed HTML tags (XSS)', () => {
    const p = new Project({
      title: 'T', category: 'Other', owner: ownerId,
      description: '<script>alert(1)</script> hello',
    });
    expect(p.descriptionHtml).not.toContain('<script>');
    expect(p.descriptionHtml).toContain('hello');
  });

  it('returns empty string for empty description', () => {
    const p = new Project({ title: 'T', category: 'Other', owner: ownerId, description: '' });
    expect(p.descriptionHtml).toBe('');
  });
});

// ─── liveliness virtual ────────────────────────────────────────────────────

describe('liveliness virtual', () => {
  it('returns 0 when no githubStats', () => {
    const p = new Project({ title: 'T', category: 'Other', owner: ownerId });
    expect(p.liveliness).toBe(0);
  });

  it('returns 0 when githubStats has no lastCommit', () => {
    const p = new Project({ title: 'T', category: 'Other', owner: ownerId, githubStats: [{ repoUrl: 'x' }] });
    expect(p.liveliness).toBe(0);
  });

  it('returns ~1 for a commit made today', () => {
    const p = new Project({
      title: 'T', category: 'Other', owner: ownerId,
      githubStats: [{ repoUrl: 'x', lastCommit: new Date() }],
    });
    expect(p.liveliness).toBeCloseTo(1, 1);
  });

  it('returns 0 for a commit made 7+ days ago', () => {
    const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 + 1));
    const p = new Project({
      title: 'T', category: 'Other', owner: ownerId,
      githubStats: [{ repoUrl: 'x', lastCommit: sevenDaysAgo }],
    });
    expect(p.liveliness).toBe(0);
  });
});

// ─── slug generation ───────────────────────────────────────────────────────

describe('slug generation', () => {
  it('generates a lowercase hyphenated slug from title', async () => {
    const p = await Project.create({ title: 'Hello World', category: 'Other', owner: ownerId });
    expect(p.slug).toBe('hello-world');
  });

  it('strips special characters from slug', async () => {
    const p = await Project.create({ title: 'AI + ML: The Future!', category: 'Other', owner: ownerId });
    expect(p.slug).toMatch(/^ai-ml-the-future$/);
  });

  it('truncates slug to max 60 characters', async () => {
    const longTitle = 'A'.repeat(80);
    const p = await Project.create({ title: longTitle, category: 'Other', owner: ownerId });
    expect(p.slug.length).toBeLessThanOrEqual(60);
  });

  it('appends counter on slug collision', async () => {
    await Project.create({ title: 'My Project', category: 'Other', owner: ownerId });
    const p2 = await Project.create({ title: 'My Project', category: 'Other', owner: ownerId });
    expect(p2.slug).toBe('my-project-1');
  });

  it('falls back to project-<timestamp> for title with no alphanumeric chars', async () => {
    const p = await Project.create({ title: '!!!', category: 'Other', owner: ownerId });
    expect(p.slug).toMatch(/^project-\d+$/);
  });

  it('does not regenerate slug when title is unchanged', async () => {
    const p = await Project.create({ title: 'Stable Title', category: 'Other', owner: ownerId });
    const originalSlug = p.slug;
    p.description = 'updated';
    await p.save();
    expect(p.slug).toBe(originalSlug);
  });
});

// ─── required field validation ─────────────────────────────────────────────

describe('required field validation', () => {
  it('rejects a project without a title', async () => {
    await expect(
      Project.create({ category: 'Other', owner: ownerId })
    ).rejects.toThrow(/title/i);
  });

  it('rejects a project without a category', async () => {
    await expect(
      Project.create({ title: 'No Category', owner: ownerId })
    ).rejects.toThrow(/category/i);
  });

  it('rejects an invalid category', async () => {
    await expect(
      Project.create({ title: 'Bad Cat', category: 'Not A Category', owner: ownerId })
    ).rejects.toThrow();
  });

  it('rejects a project without an owner', async () => {
    await expect(
      Project.create({ title: 'No Owner', category: 'Other' })
    ).rejects.toThrow(/owner/i);
  });
});
