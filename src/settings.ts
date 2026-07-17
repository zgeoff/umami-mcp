/**
 * Umami connection settings resolved from the environment.
 *
 * Two auth modes exist and are mutually exclusive:
 * - `api_key` — Umami Cloud (or any deployment issuing API keys); `UMAMI_API_KEY`.
 * - `login` — self-hosted username/password; `UMAMI_USERNAME` + `UMAMI_PASSWORD`, with
 *   `UMAMI_API_BASE` pointing at the instance API root (e.g. `https://umami.example.com/api`).
 */
export interface Settings {
  apiBase: string;
  auth: { mode: 'api_key'; apiKey: string } | { mode: 'login'; username: string; password: string };
}

const CLOUD_DEFAULT_API_BASE = 'https://api.umami.is/v1';

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const apiKey = env.UMAMI_API_KEY?.trim() || undefined;
  const username = env.UMAMI_USERNAME?.trim() || undefined;
  const password = env.UMAMI_PASSWORD?.trim() || undefined;
  const apiBase = (env.UMAMI_API_BASE?.trim() || CLOUD_DEFAULT_API_BASE).replace(/\/+$/, '');

  if (apiKey) {
    return { apiBase, auth: { mode: 'api_key', apiKey } };
  }

  if (Boolean(username) !== Boolean(password)) {
    throw new Error(
      'Invalid Umami auth configuration. Provide either UMAMI_API_KEY (Umami Cloud) ' +
        'or both UMAMI_USERNAME and UMAMI_PASSWORD (self-hosted).',
    );
  }

  if (!username || !password) {
    throw new Error(
      'Missing Umami credentials. Provide UMAMI_API_KEY (Umami Cloud) or both ' +
        'UMAMI_USERNAME and UMAMI_PASSWORD (self-hosted). Note: Umami Cloud only ' +
        'supports API keys.',
    );
  }

  const host = safeHostname(apiBase);
  if (host === 'api.umami.is') {
    throw new Error(
      'UMAMI_USERNAME/UMAMI_PASSWORD are only supported for self-hosted Umami. ' +
        'Umami Cloud requires UMAMI_API_KEY. For self-hosted, set UMAMI_API_BASE to ' +
        'your instance API root (e.g. https://your-umami.example/api).',
    );
  }

  return { apiBase, auth: { mode: 'login', username, password } };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`UMAMI_API_BASE is not a valid URL: ${url}`);
  }
}
