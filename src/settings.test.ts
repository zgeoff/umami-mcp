import { describe, expect, it } from 'vitest';
import { loadSettings } from './settings.js';

describe('loadSettings', () => {
  it('resolves api-key auth with the cloud default base', () => {
    const settings = loadSettings({ UMAMI_API_KEY: 'key-1' });

    expect(settings).toStrictEqual({
      apiBase: 'https://api.umami.is/v1',
      auth: { mode: 'api_key', apiKey: 'key-1' },
    });
  });

  it('resolves login auth against a self-hosted base and strips trailing slashes', () => {
    const settings = loadSettings({
      UMAMI_API_BASE: 'https://umami.example.com/api/',
      UMAMI_USERNAME: 'admin',
      UMAMI_PASSWORD: 'pw',
    });

    expect(settings).toStrictEqual({
      apiBase: 'https://umami.example.com/api',
      auth: { mode: 'login', username: 'admin', password: 'pw' },
    });
  });

  it('prefers the api key when both auth modes are present', () => {
    const settings = loadSettings({
      UMAMI_API_KEY: 'key-1',
      UMAMI_USERNAME: 'admin',
      UMAMI_PASSWORD: 'pw',
    });

    expect(settings.auth.mode).toBe('api_key');
  });

  it('rejects a username without a password', () => {
    expect(() => loadSettings({ UMAMI_USERNAME: 'admin' })).toThrow(
      /both UMAMI_USERNAME and UMAMI_PASSWORD/,
    );
  });

  it('rejects missing credentials entirely', () => {
    expect(() => loadSettings({})).toThrow(/Missing Umami credentials/);
  });

  it('rejects login auth pointed at umami cloud', () => {
    expect(() =>
      loadSettings({
        UMAMI_USERNAME: 'admin',
        UMAMI_PASSWORD: 'pw',
      }),
    ).toThrow(/self-hosted/);
  });

  it('rejects an invalid base url', () => {
    expect(() =>
      loadSettings({
        UMAMI_API_BASE: 'not a url',
        UMAMI_USERNAME: 'admin',
        UMAMI_PASSWORD: 'pw',
      }),
    ).toThrow(/not a valid URL/);
  });
});
