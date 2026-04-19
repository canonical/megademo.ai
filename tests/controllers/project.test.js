/**
 * Unit tests for controllers/project.js
 * Uses in-memory MongoDB; mocks Express req/res and external services.
 */
jest.mock('../../services/mattermost', () => ({ notifyProjectSubmitted: jest.fn() }));
jest.mock('../../services/github',     () => ({ refreshProjectStats: jest.fn() }));

const mongoose = require('mongoose');
const db = require('../setup/db');
const { Project } = require('../../models/Project');
const Vote = require('../../models/Vote');
const User = require('../../models/User');
const ctrl = require('../../controllers/project');

// ─── helpers ──────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    user:   { _id: new mongoose.Types.ObjectId(), role: 'participant' },
    params: {},
    body:   {},
    query:  {},
    flash:  jest.fn(),
    ...overrides,
  };
}

function makeRes() {
  const res = {};
  res.status   = jest.fn().mockReturnValue(res);
  res.json     = jest.fn().mockReturnValue(res);
  res.render   = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  res.send     = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
}

// ─── setup ────────────────────────────────────────────────────────────────

let owner, stranger, project;

beforeAll(() => db.connect());
afterAll(() => db.disconnect());

beforeEach(async () => {
  await db.clearAll();
  owner    = await User.create({ email: 'owner@canonical.com',    github: 'owner-gh' });
  stranger = await User.create({ email: 'stranger@canonical.com', github: 'stranger-gh' });
  project  = await Project.create({
    title: 'Test Project', category: 'Other', owner: owner._id, team: [owner._id],
  });
});

// ─── vote ─────────────────────────────────────────────────────────────────

describe('vote()', () => {
  it('returns 400 for stars = 0', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { stars: '0' }, user: { _id: stranger._id } });
    const res = makeRes();
    await ctrl.vote(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('returns 400 for stars = 6', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { stars: '6' }, user: { _id: stranger._id } });
    const res = makeRes();
    await ctrl.vote(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for non-numeric stars', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { stars: 'abc' }, user: { _id: stranger._id } });
    const res = makeRes();
    await ctrl.vote(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('creates a vote and updates project avgRating/voteCount', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { stars: '4' }, user: { _id: stranger._id } });
    const res = makeRes();
    await ctrl.vote(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ avgRating: 4, voteCount: 1, userStars: 4 }));
    const updated = await Project.findById(project._id);
    expect(updated.avgRating).toBe(4);
    expect(updated.voteCount).toBe(1);
  });

  it('updates an existing vote and recalculates rating', async () => {
    // First vote by stranger (4 stars)
    await Vote.create({ user: stranger._id, project: project._id, stars: 4 });
    // owner votes 2 stars
    await Vote.create({ user: owner._id, project: project._id, stars: 2 });
    // stranger changes vote to 5 stars
    const req = makeReq({ params: { id: project._id.toString() }, body: { stars: '5' }, user: { _id: stranger._id } });
    const res = makeRes();
    await ctrl.vote(req, res);
    const result = res.json.mock.calls[0][0];
    // (5 + 2) / 2 = 3.5
    expect(result.avgRating).toBeCloseTo(3.5, 1);
    expect(result.voteCount).toBe(2);
  });

  it('returns 404 for unknown project', async () => {
    const req = makeReq({ params: { id: new mongoose.Types.ObjectId().toString() }, body: { stars: '3' }, user: { _id: stranger._id } });
    const res = makeRes();
    await ctrl.vote(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── updateTeam ───────────────────────────────────────────────────────────

describe('updateTeam()', () => {
  it('rejects a non-canonical email', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { addEmail: 'hacker@gmail.com' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.updateTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('canonical.com') }));
  });

  it('returns 404 when the added user has no account', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { addEmail: 'unknown@canonical.com' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.updateTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('adds a canonical user to the team', async () => {
    const newMember = await User.create({ email: 'member@canonical.com', github: 'mem-gh' });
    const req = makeReq({ params: { id: project._id.toString() }, body: { addEmail: 'member@canonical.com' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.updateTeam(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updated = await Project.findById(project._id);
    expect(updated.team.some((id) => id.toString() === newMember._id.toString())).toBe(true);
  });

  it('does not add a duplicate team member', async () => {
    // stranger already in team? No — owner is in team. Let's add stranger first.
    const req1 = makeReq({ params: { id: project._id.toString() }, body: { addEmail: 'stranger@canonical.com' }, user: { _id: owner._id, role: 'participant' } });
    await ctrl.updateTeam(req1, makeRes());
    // add again
    const req2 = makeReq({ params: { id: project._id.toString() }, body: { addEmail: 'stranger@canonical.com' }, user: { _id: owner._id, role: 'participant' } });
    const res2 = makeRes();
    await ctrl.updateTeam(req2, res2);
    const updated = await Project.findById(project._id);
    const matches = updated.team.filter((id) => id.toString() === stranger._id.toString());
    expect(matches.length).toBe(1);
  });

  it('removes a team member by id', async () => {
    project.team.push(stranger._id);
    await project.save();
    const req = makeReq({ params: { id: project._id.toString() }, body: { removeUserId: stranger._id.toString() }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.updateTeam(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updated = await Project.findById(project._id);
    expect(updated.team.some((id) => id.toString() === stranger._id.toString())).toBe(false);
  });

  it('cannot remove the project owner from the team', async () => {
    project.team.push(stranger._id);
    await project.save();
    const req = makeReq({ params: { id: project._id.toString() }, body: { removeUserId: owner._id.toString() }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.updateTeam(req, res);
    // should be a no-op (400 or team unchanged)
    const updated = await Project.findById(project._id);
    expect(updated.team.some((id) => id.toString() === owner._id.toString())).toBe(true);
  });
});

// ─── remove ───────────────────────────────────────────────────────────────

describe('remove()', () => {
  it('returns 403 for a non-owner, non-admin user', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, user: { _id: stranger._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.remove(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when trying to delete a submitted project', async () => {
    project.status = 'submitted';
    await project.save();
    const req = makeReq({ params: { id: project._id.toString() }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.remove(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('deletes a draft project and returns JSON success', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.remove(req, res);
    const found = await Project.findById(project._id);
    expect(found).toBeNull();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('also deletes associated votes when project is removed', async () => {
    await Vote.create({ user: stranger._id, project: project._id, stars: 5 });
    const req = makeReq({ params: { id: project._id.toString() }, user: { _id: owner._id, role: 'participant' } });
    await ctrl.remove(req, makeRes());
    const votes = await Vote.find({ project: project._id });
    expect(votes.length).toBe(0);
  });
});

// ─── create ───────────────────────────────────────────────────────────────

describe('create()', () => {
  it('re-renders form when title is too short', async () => {
    const req = makeReq({ body: { title: 'ab', category: 'Other' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    expect(res.render).toHaveBeenCalledWith('projects/new', expect.objectContaining({ errors: expect.arrayContaining([expect.objectContaining({ msg: expect.stringContaining('3') })]) }));
  });

  it('normalises aiTools to array on re-render (single checkbox value is a string)', async () => {
    // When only one AI tool checkbox is ticked, req.body.aiTools is a string.
    // The template calls .some() on it — must receive an array or crash.
    const req = makeReq({ body: { title: 'ab', category: 'Other', aiTools: 'ChatGPT' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    const call = res.render.mock.calls[0];
    expect(Array.isArray(call[1].project.aiTools)).toBe(true);
  });

  it('re-renders form for an invalid category', async () => {
    const req = makeReq({ body: { title: 'Valid Title', category: 'Fake Category' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    expect(res.render).toHaveBeenCalledWith('projects/new', expect.objectContaining({
      errors: expect.arrayContaining([expect.objectContaining({ msg: expect.any(String) })]),
    }));
  });

  it('re-renders form when videoUrl is not a valid YouTube/Vimeo URL', async () => {
    const req = makeReq({ body: { title: 'Video Test', category: 'Other', videoUrl: 'https://example.com/video' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    expect(res.render).toHaveBeenCalledWith('projects/new', expect.objectContaining({
      errors: expect.arrayContaining([expect.objectContaining({ msg: expect.stringContaining('video') })]),
    }));
  });

  it('re-renders form when a project with the same name already exists (case-insensitive)', async () => {
    await Project.create({ title: 'Existing Project', slug: 'existing-project', owner: owner._id, team: [owner._id], category: 'Other' });
    const req = makeReq({ body: { title: 'existing project', category: 'Other' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    expect(res.render).toHaveBeenCalledWith('projects/new', expect.objectContaining({
      errors: expect.arrayContaining([expect.objectContaining({ msg: expect.stringContaining('already registered') })]),
    }));
  });

  it('accepts a valid YouTube URL', async () => {
    const req = makeReq({ body: { title: 'YT Project', category: 'Other', action: 'draft', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/projects/mine');
  });

  it('redirects to /projects/mine when action=draft', async () => {
    const req = makeReq({ body: { title: 'Draft Project', category: 'Other', action: 'draft' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/projects/mine');
    const p = await Project.findOne({ title: 'Draft Project' });
    expect(p.status).toBe('draft');
  });

  it('sets status=submitted and redirects to project view when action=continue', async () => {
    const req = makeReq({ body: { title: 'Continue Project', category: 'Other', action: 'continue' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.create(req, res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/\/projects\/[^/]+$/));
    const p = await Project.findOne({ title: 'Continue Project' });
    expect(p.status).toBe('submitted');
  });

  it('stores the owner as a team member', async () => {
    const req = makeReq({ body: { title: 'Owned Project', category: 'Other', action: 'draft' }, user: { _id: owner._id, role: 'participant' } });
    await ctrl.create(req, makeRes());
    const p = await Project.findOne({ title: 'Owned Project' });
    expect(p.team.some((id) => id.toString() === owner._id.toString())).toBe(true);
  });
});

// ─── update ───────────────────────────────────────────────────────────────

describe('update()', () => {
  it('returns 403 for a non-owner', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { title: 'New Title' }, user: { _id: stranger._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when title is updated to < 3 chars', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { title: 'ab' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('saves updated title and redirects', async () => {
    const req = makeReq({ params: { id: project._id.toString() }, body: { title: 'Updated Title' }, user: { _id: owner._id, role: 'participant' } });
    const res = makeRes();
    await ctrl.update(req, res);
    const updated = await Project.findById(project._id);
    expect(updated.title).toBe('Updated Title');
    expect(res.redirect).toHaveBeenCalled();
  });
});
