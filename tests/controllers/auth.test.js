/**
 * Unit tests for auth helpers: resolveAuthMode and resolveLoginUrl.
 */
import { resolveAuthMode, resolveLoginUrl } from '../../controllers/auth.js';

describe('resolveAuthMode', () => {
  let savedAuthMode;

  beforeEach(() => { savedAuthMode = process.env.AUTH_MODE; });
  afterEach(() => {
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
  });

  it('returns "github" when AUTH_MODE is unset', () => {
    delete process.env.AUTH_MODE;
    expect(resolveAuthMode()).toBe('github');
  });

  it('returns "github" when AUTH_MODE=github', () => {
    process.env.AUTH_MODE = 'github';
    expect(resolveAuthMode()).toBe('github');
  });

  it('returns "oidc" when AUTH_MODE=oidc', () => {
    process.env.AUTH_MODE = 'oidc';
    expect(resolveAuthMode()).toBe('oidc');
  });

  it('returns "github" for any unrecognised value', () => {
    process.env.AUTH_MODE = 'saml';
    expect(resolveAuthMode()).toBe('github');
  });
});

describe('resolveLoginUrl', () => {
  let savedAuthMode, savedNodeEnv;

  beforeEach(() => {
    savedAuthMode = process.env.AUTH_MODE;
    savedNodeEnv  = process.env.NODE_ENV;
  });
  afterEach(() => {
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
    process.env.NODE_ENV = savedNodeEnv;
  });

  it('returns /auth/dev-login in non-production regardless of AUTH_MODE', () => {
    process.env.NODE_ENV  = 'development';
    process.env.AUTH_MODE = 'oidc';
    expect(resolveLoginUrl()).toBe('/auth/dev-login');
  });

  it('returns /auth/github in production when AUTH_MODE is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_MODE;
    expect(resolveLoginUrl()).toBe('/auth/github');
  });

  it('returns /auth/github in production when AUTH_MODE=github', () => {
    process.env.NODE_ENV  = 'production';
    process.env.AUTH_MODE = 'github';
    expect(resolveLoginUrl()).toBe('/auth/github');
  });

  it('returns /auth/oidc in production when AUTH_MODE=oidc', () => {
    process.env.NODE_ENV  = 'production';
    process.env.AUTH_MODE = 'oidc';
    expect(resolveLoginUrl()).toBe('/auth/oidc');
  });
});
