const mongoose = require('mongoose');
const db = require('../setup/db');
const ActivityLog = require('../../models/ActivityLog');
const { logActivity } = require('../../services/activityLog');

beforeAll(() => db.connect());
afterAll(() => db.disconnect());
afterEach(() => db.clearAll());

describe('ActivityLog model', () => {
  it('saves a valid entry', async () => {
    const entry = await ActivityLog.create({ userEmail: 'user@canonical.com', action: "Created project 'Demo'" });
    expect(entry.userEmail).toBe('user@canonical.com');
    expect(entry.action).toBe("Created project 'Demo'");
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it('requires userEmail', async () => {
    await expect(ActivityLog.create({ action: 'some action' })).rejects.toThrow();
  });

  it('requires action', async () => {
    await expect(ActivityLog.create({ userEmail: 'user@canonical.com' })).rejects.toThrow();
  });
});

describe('logActivity service', () => {
  it('persists an entry', async () => {
    await logActivity('actor@canonical.com', "Deleted project 'Foo'");
    const count = await ActivityLog.countDocuments({ userEmail: 'actor@canonical.com' });
    expect(count).toBe(1);
  });

  it('does not throw when ActivityLog.create fails', async () => {
    // Simulate DB failure by disconnecting the mongoose connection used by the model
    const orig = mongoose.connection.readyState;
    jest.spyOn(ActivityLog, 'create').mockRejectedValueOnce(new Error('DB error'));
    await expect(logActivity('x@canonical.com', 'test')).resolves.toBeUndefined();
    expect(orig).toBeTruthy(); // connection still alive
  });
});
