const db = require('../setup/db');
const Settings = require('../../models/Settings');

beforeAll(() => db.connect());
afterAll(() => db.disconnect());
afterEach(() => db.clearAll());

describe('Settings model', () => {
  it('returns null for unknown key', async () => {
    const val = await Settings.get('nonexistent');
    expect(val).toBeNull();
  });

  it('returns provided default for unknown key', async () => {
    const val = await Settings.get('nonexistent', 'fallback');
    expect(val).toBe('fallback');
  });

  it('set() then get() round-trips a string value', async () => {
    await Settings.set('webhookUrl', 'https://example.com/hook');
    const val = await Settings.get('webhookUrl');
    expect(val).toBe('https://example.com/hook');
  });

  it('set() then get() round-trips an ISO date string', async () => {
    const iso = '2025-06-06T09:00:00.000Z';
    await Settings.set('megademoDate', iso);
    const val = await Settings.get('megademoDate');
    expect(val).toBe(iso);
  });

  it('set() upserts an existing key', async () => {
    await Settings.set('deadline', 'first');
    await Settings.set('deadline', 'second');
    const val = await Settings.get('deadline');
    expect(val).toBe('second');
  });

  it('independent keys do not interfere', async () => {
    await Settings.set('a', 1);
    await Settings.set('b', 2);
    expect(await Settings.get('a')).toBe(1);
    expect(await Settings.get('b')).toBe(2);
  });
});
