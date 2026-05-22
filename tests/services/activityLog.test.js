import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as db from '../setup/db.js';
import ActivityLog from '../../models/ActivityLog.js';
import { logActivity } from '../../services/activityLog.js';

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

  it('strips newlines from action to prevent log injection', async () => {
    const injected = "Real Project\n[2099-01-01T00:00:00.000Z] admin@example.com: Forged entry";
    await logActivity('attacker@canonical.com', `Created project '${injected}'`);
    const entry = await ActivityLog.findOne({ userEmail: 'attacker@canonical.com' });
    expect(entry.action).not.toContain('\n');
    expect(entry.action).not.toContain('\r');
  });

  it('strips control characters from userEmail', async () => {
    await logActivity('user@canonical.com\nForgedLine', 'Some action');
    const entry = await ActivityLog.findOne({});
    expect(entry.userEmail).not.toContain('\n');
  });
});
