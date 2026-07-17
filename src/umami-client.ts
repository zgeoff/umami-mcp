import type { Settings } from './settings.js';

export class UmamiError extends Error {}

const MAX_RETRIES = 3;

/**
 * Thin fetch client over the Umami HTTP API.
 *
 * Auth: `api_key` mode sends `x-umami-api-key` on every request; `login` mode lazily exchanges
 * username/password for a bearer token at `/auth/login` and caches it for the process. Transport
 * failures and 429s retry up to three times with exponential backoff; auth failures and other
 * HTTP errors surface as `UmamiError` with a message that points at the misconfigured setting.
 */
export class UmamiClient {
  private readonly settings: Settings;
  private token: string | undefined;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  async getWebsites(params: {
    includeTeams: boolean;
    search?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<unknown> {
    return this.request('/websites', {
      includeTeams: String(params.includeTeams),
      page: String(params.page),
      pageSize: String(params.pageSize),
      ...(params.search ? { search: params.search } : {}),
    });
  }

  async getStats(websiteID: string, query: Record<string, string>): Promise<unknown> {
    return this.request(`/websites/${encodeURIComponent(websiteID)}/stats`, query);
  }

  async getPageviews(websiteID: string, query: Record<string, string>): Promise<unknown> {
    return this.request(`/websites/${encodeURIComponent(websiteID)}/pageviews`, query);
  }

  async getMetrics(
    websiteID: string,
    expanded: boolean,
    query: Record<string, string>,
  ): Promise<unknown> {
    const path = expanded
      ? `/websites/${encodeURIComponent(websiteID)}/metrics/expanded`
      : `/websites/${encodeURIComponent(websiteID)}/metrics`;
    return this.request(path, query);
  }

  async getActive(websiteID: string): Promise<unknown> {
    return this.request(`/websites/${encodeURIComponent(websiteID)}/active`, {});
  }

  private async ensureToken(): Promise<string> {
    if (this.token !== undefined) {
      return this.token;
    }

    if (this.settings.auth.mode !== 'login') {
      throw new UmamiError('ensureToken called outside login auth mode');
    }

    let response: Response;
    try {
      response = await fetch(`${this.settings.apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          username: this.settings.auth.username,
          password: this.settings.auth.password,
        }),
      });
    } catch (error) {
      throw new UmamiError(`Login request failed: ${String(error)}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new UmamiError(
        'Authentication failed (check UMAMI_USERNAME/UMAMI_PASSWORD). Note: Umami Cloud only supports UMAMI_API_KEY.',
      );
    }

    if (!response.ok) {
      throw new UmamiError(`Login failed (${response.status}): ${await response.text()}`);
    }

    const data: unknown = await response.json();
    const token =
      typeof data === 'object' && data !== null && 'token' in data ? data.token : undefined;

    if (typeof token !== 'string' || token.length === 0) {
      throw new UmamiError('Login succeeded but no token was returned by Umami');
    }

    this.token = token;
    return token;
  }

  private async request(path: string, query: Record<string, string>): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const headers: Record<string, string> = { Accept: 'application/json' };

      if (this.settings.auth.mode === 'api_key') {
        headers['x-umami-api-key'] = this.settings.auth.apiKey;
      } else {
        headers.Authorization = `Bearer ${await this.ensureToken()}`;
      }

      const url = new URL(`${this.settings.apiBase}${path}`);
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }

      let response: Response;
      try {
        response = await fetch(url, { headers });
      } catch (error) {
        lastError = error;
        await sleep(250 * 2 ** attempt);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new UmamiError(
          this.settings.auth.mode === 'api_key'
            ? 'Authentication failed (check UMAMI_API_KEY)'
            : 'Authentication failed (check UMAMI_USERNAME/UMAMI_PASSWORD). Note: Umami Cloud only supports UMAMI_API_KEY.',
        );
      }

      if (response.status === 429) {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      if (!response.ok) {
        throw new UmamiError(`Umami API error ${response.status}: ${await response.text()}`);
      }

      if (response.status === 204) {
        return null;
      }

      return response.json();
    }

    if (lastError !== undefined) {
      throw new UmamiError(`Request failed after retries: ${String(lastError)}`);
    }
    throw new UmamiError('Request rate-limited (429) after retries');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
