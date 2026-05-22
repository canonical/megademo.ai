import * as db from '../setup/db.js';
import Settings from '../../models/Settings.js';

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

describe('Settings.arrayAdd', () => {
  it('creates the document with [item] when key does not exist', async () => {
    await Settings.arrayAdd('myList', 'alpha');
    expect(await Settings.get('myList')).toEqual(['alpha']);
  });

  it('appends a new item to an existing array', async () => {
    await Settings.set('myList', ['alpha', 'beta']);
    await Settings.arrayAdd('myList', 'gamma');
    const val = await Settings.get('myList');
    expect(val).toContain('gamma');
    expect(val).toContain('alpha');
    expect(val).toContain('beta');
  });

  it('is idempotent — exact duplicate is not added twice', async () => {
    await Settings.set('myList', ['alpha', 'beta']);
    await Settings.arrayAdd('myList', 'beta');
    const val = await Settings.get('myList');
    expect(val.filter((x) => x === 'beta')).toHaveLength(1);
  });

  it('does not affect other keys', async () => {
    await Settings.set('other', 'untouched');
    await Settings.arrayAdd('myList', 'alpha');
    expect(await Settings.get('other')).toBe('untouched');
  });
});

describe('Settings.arrayRemove', () => {
  it('removes the specified item from the array', async () => {
    await Settings.set('myList', ['alpha', 'beta', 'gamma']);
    await Settings.arrayRemove('myList', 'beta');
    const val = await Settings.get('myList');
    expect(val).not.toContain('beta');
    expect(val).toContain('alpha');
    expect(val).toContain('gamma');
  });

  it('is a no-op when item is not present', async () => {
    await Settings.set('myList', ['alpha', 'beta']);
    await Settings.arrayRemove('myList', 'ghost');
    expect(await Settings.get('myList')).toEqual(['alpha', 'beta']);
  });

  it('is a no-op when key does not exist', async () => {
    await expect(Settings.arrayRemove('noKey', 'x')).resolves.toBeNull();
  });
});

describe('Settings.arrayRename', () => {
  it('renames the matching item in the array', async () => {
    await Settings.set('myList', ['alpha', 'beta', 'gamma']);
    await Settings.arrayRename('myList', 'beta', 'BETA');
    const val = await Settings.get('myList');
    expect(val).not.toContain('beta');
    expect(val).toContain('BETA');
    expect(val).toContain('alpha');
    expect(val).toContain('gamma');
  });

  it('is a no-op when old item is not in the array', async () => {
    await Settings.set('myList', ['alpha', 'beta']);
    await Settings.arrayRename('myList', 'ghost', 'phantom');
    expect(await Settings.get('myList')).toEqual(['alpha', 'beta']);
  });

  it('returns null when key does not exist', async () => {
    const result = await Settings.arrayRename('noKey', 'x', 'y');
    expect(result).toBeNull();
  });
});
