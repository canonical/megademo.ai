const mongoose = require('mongoose');
const db = require('../setup/db');
const Vote = require('../../models/Vote');

const uid1 = new mongoose.Types.ObjectId();
const pid1 = new mongoose.Types.ObjectId();
const pid2 = new mongoose.Types.ObjectId();

beforeAll(() => db.connect());
afterAll(() => db.disconnect());
afterEach(() => db.clearAll());

describe('Vote model', () => {
  it('saves a valid vote', async () => {
    const v = await Vote.create({ user: uid1, project: pid1, stars: 4 });
    expect(v.stars).toBe(4);
  });

  it('rejects stars = 0 (below min)', async () => {
    await expect(
      Vote.create({ user: uid1, project: pid1, stars: 0 })
    ).rejects.toThrow();
  });

  it('rejects stars = 6 (above max)', async () => {
    await expect(
      Vote.create({ user: uid1, project: pid1, stars: 6 })
    ).rejects.toThrow();
  });

  it('accepts stars at both boundaries (1 and 5)', async () => {
    const v1 = await Vote.create({ user: uid1, project: pid1, stars: 1 });
    const v5 = await Vote.create({ user: uid1, project: pid2, stars: 5 });
    expect(v1.stars).toBe(1);
    expect(v5.stars).toBe(5);
  });

  it('rejects a duplicate (user + project) vote', async () => {
    await Vote.create({ user: uid1, project: pid1, stars: 3 });
    await expect(
      Vote.create({ user: uid1, project: pid1, stars: 5 })
    ).rejects.toThrow();
  });

  it('requires user field', async () => {
    await expect(
      Vote.create({ project: pid1, stars: 3 })
    ).rejects.toThrow(/user/i);
  });

  it('requires project field', async () => {
    await expect(
      Vote.create({ user: uid1, stars: 3 })
    ).rejects.toThrow(/project/i);
  });

  it('requires stars field', async () => {
    await expect(
      Vote.create({ user: uid1, project: pid1 })
    ).rejects.toThrow(/stars/i);
  });
});
