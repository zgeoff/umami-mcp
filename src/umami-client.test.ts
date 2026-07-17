import { afterEach, describe, expect, it, vi } from 'vitest';
import { UmamiClient, UmamiError } from './umami-client.js';

const SELF_HOSTED = {
  apiBase: 'https://umami.example.com/api',
  auth: { mode: 'login', username: 'admin', password: 'pw' },
} as const;

const CLOUD = {
  apiBase: 'https://api.umami.is/v1',
  auth: { mode: 'api_key', apiKey: 'key-1' },
} as const;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UmamiClient', () => {
  it('logs in once and reuses the bearer token across requests', async () => {
    const calls: Array<{ url: string; headers: Headers; body?: string }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, headers: new Headers(init?.headers), body: init?.body as string });

        if (url.endsWith('/auth/login')) {
          return jsonResponse({ token: 'token-1' });
        }

        return jsonResponse({ ok: true });
      }),
    );

    const client = new UmamiClient(SELF_HOSTED);

    await client.getActive('site-1');
    await client.getActive('site-1');

    const loginCalls = calls.filter((call) => call.url.endsWith('/auth/login'));
    expect(loginCalls).toHaveLength(1);
    expect(JSON.parse(loginCalls[0]!.body!)).toStrictEqual({ username: 'admin', password: 'pw' });

    const apiCalls = calls.filter((call) => call.url.includes('/websites/site-1/active'));
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls[0]!.headers.get('authorization')).toBe('Bearer token-1');
  });

  it('sends the api key header in api-key mode without logging in', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return jsonResponse([{ x: 3 }]);
      }),
    );

    const client = new UmamiClient(CLOUD);
    await client.getActive('site-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get('x-umami-api-key')).toBe('key-1');
    expect(calls[0]!.headers.get('authorization')).toBeNull();
  });

  it('builds the websites query from the paging params', async () => {
    const urls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | RequestInfo) => {
        urls.push(String(input));
        return jsonResponse({ data: [] });
      }),
    );

    const client = new UmamiClient(CLOUD);
    await client.getWebsites({ includeTeams: true, search: 'vers', page: 2, pageSize: 25 });

    const url = new URL(urls[0]!);
    expect(url.pathname).toBe('/v1/websites');
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      includeTeams: 'true',
      page: '2',
      pageSize: '25',
      search: 'vers',
    });
  });

  it('retries a 429 with backoff and then succeeds', async () => {
    vi.useFakeTimers();

    let attempt = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempt += 1;
        return attempt < 3 ? new Response('slow down', { status: 429 }) : jsonResponse({ x: 1 });
      }),
    );

    const client = new UmamiClient(CLOUD);
    const pending = client.getActive('site-1');

    await vi.runAllTimersAsync();
    await expect(pending).resolves.toStrictEqual({ x: 1 });
    expect(attempt).toBe(3);

    vi.useRealTimers();
  });

  it('reports an auth failure with the setting to check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const client = new UmamiClient(CLOUD);

    await expect(client.getActive('site-1')).rejects.toThrow(UmamiError);
    await expect(client.getActive('site-1')).rejects.toThrow(/UMAMI_API_KEY/);
  });

  it('surfaces non-2xx responses with status and body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));

    const client = new UmamiClient(CLOUD);

    await expect(client.getActive('site-1')).rejects.toThrow(/Umami API error 500: boom/);
  });

  it('rejects a login response without a token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ nope: true })));

    const client = new UmamiClient(SELF_HOSTED);

    await expect(client.getActive('site-1')).rejects.toThrow(/no token was returned/);
  });
});
