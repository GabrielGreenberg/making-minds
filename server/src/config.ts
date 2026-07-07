// Server configuration, all via environment variables so the same code runs
// locally, in the smoke test, and on the Lightsail box (systemd sets the env).

export interface ServerConfig {
  port: number;
  /** SQLite database file path; ':memory:' for tests. */
  dbPath: string;
  /**
   * Allowed CORS origins (comma-separated), e.g. the Cloudflare Pages URL:
   * "https://making-minds.pages.dev,https://phil133.example.edu".
   * Empty = same-origin only (no CORS headers emitted).
   */
  corsOrigins: string[];
  /**
   * Auth mode. 'dev' = passwordless login by known email (mirrors the app's
   * mockup login; for development and the pre-SSO pilot only). 'sso' is the
   * placeholder for UCLA SSO — the seam is src/auth.ts.
   */
  authMode: 'dev' | 'sso';
  /** Session lifetime in seconds (default 30 days). */
  sessionTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const authMode = env.MM_AUTH_MODE === 'sso' ? 'sso' : 'dev';
  return {
    port: Number(env.PORT) || 8133,
    dbPath: env.MM_DB_PATH || 'making-minds.sqlite',
    corsOrigins: (env.MM_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    authMode,
    sessionTtlSeconds: Number(env.MM_SESSION_TTL_SECONDS) || 30 * 24 * 60 * 60,
  };
}
