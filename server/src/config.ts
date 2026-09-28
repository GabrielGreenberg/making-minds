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
   * Auth mode — which AuthProvider src/auth.ts constructs. THE DEFAULT IS
   * 'password': the real system (roster + student-chosen passwords), so a box
   * that forgets to set MM_AUTH_MODE is safe rather than open.
   *
   *   'password' — email + password against the CSV roster (launch default)
   *   'dev'      — passwordless login by known roster email (dev + harnesses)
   *   'sso'      — UCLA SSO; unimplemented, see SsoAuthProvider
   */
  authMode: 'password' | 'dev' | 'sso';
  /** Where the browser goes to start SSO. Only meaningful when authMode is 'sso'. */
  ssoLoginUrl?: string;
  /** Session lifetime in seconds (default 30 days). */
  sessionTtlSeconds: number;
  /**
   * The provenance watermark's secret (task 034, MM_MINT_SECRET): every
   * student's mint key is derived from it. Optional — unset, the server
   * generates one on first boot and keeps it in the database (server_meta),
   * so restarts never change keys. Never rotate it mid-term: every id minted
   * before would read as nobody's.
   */
  mintSecret?: string;
  /**
   * Where a re-grade's pre-commit database snapshots go (task 069,
   * MM_SNAPSHOT_DIR; server/src/snapshot.ts). Unset: `backups/regrade` beside
   * the database's directory — on the box /srv/making-minds/backups/regrade,
   * next to the daily backups.
   */
  snapshotDir?: string;
  /**
   * The robot's state on the Dashboard (task 083; src/robotStatus.ts). The
   * server's own clone — what the pilot runs (MM_REPO_DIR; unset: the repo
   * this code runs from); a fetch-only mirror of GitHub main (MM_REPO_MIRROR;
   * unset: `repo-mirror.git` beside the database, none for ':memory:'); the
   * daily backups the release gate reads (MM_BACKUP_DIR; unset:
   * `backups/daily` beside the database's directory, like snapshotDir).
   */
  repoDir?: string;
  repoMirror?: string;
  backupDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const authMode =
    env.MM_AUTH_MODE === 'sso' ? 'sso' : env.MM_AUTH_MODE === 'dev' ? 'dev' : 'password';
  return {
    ssoLoginUrl: env.MM_SSO_LOGIN_URL || '/api/auth/sso/start',
    port: Number(env.PORT) || 8133,
    dbPath: env.MM_DB_PATH || 'making-minds.sqlite',
    corsOrigins: (env.MM_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    authMode,
    sessionTtlSeconds: Number(env.MM_SESSION_TTL_SECONDS) || 30 * 24 * 60 * 60,
    mintSecret: env.MM_MINT_SECRET || undefined,
    snapshotDir: env.MM_SNAPSHOT_DIR || undefined,
    repoDir: env.MM_REPO_DIR || undefined,
    repoMirror: env.MM_REPO_MIRROR || undefined,
    backupDir: env.MM_BACKUP_DIR || undefined,
  };
}
