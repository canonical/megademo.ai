import { initOidcClient } from '../../config/oidc.js';

describe('initOidcClient misconfiguration', () => {
  let savedAuthMode, savedIssuerUrl;

  beforeEach(() => {
    savedAuthMode  = process.env.AUTH_MODE;
    savedIssuerUrl = process.env.OIDC_ISSUER_URL;
  });
  afterEach(() => {
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
    if (savedIssuerUrl === undefined) delete process.env.OIDC_ISSUER_URL;
    else process.env.OIDC_ISSUER_URL = savedIssuerUrl;
  });

  it('throws when AUTH_MODE=oidc but OIDC_ISSUER_URL is not set', async () => {
    process.env.AUTH_MODE = 'oidc';
    delete process.env.OIDC_ISSUER_URL;
    await expect(initOidcClient()).rejects.toThrow(/OIDC_ISSUER_URL/);
  });

  it('returns early without throwing when AUTH_MODE is not oidc', async () => {
    process.env.AUTH_MODE = 'github';
    await expect(initOidcClient()).resolves.toBeUndefined();
  });
});
