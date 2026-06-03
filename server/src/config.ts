import { createHash } from 'node:crypto';

export interface AppConfig {
  /** Port the proxy listens on (exposed to the browser via the plugin PORT field). */
  port: number;
  /** Internal Memos upstream, e.g. http://memos:5230 */
  memosUpstream: string;
  /** DooTask main API base, reachable as http://nginx on the shared network. */
  dootaskUrl: string;
  /** DooTask user ids that should become Memos admins. */
  adminUserIds: number[];
  /** Secret used to derive deterministic Memos passwords and sign session cookies. */
  internalSecret: string;
  /** Entry path the DooTask iframe points at to start an SSO session. */
  ssoEntryPath: string;
  /** Public sub-path the plugin is served under (for redirects/cookies), e.g. /apps/memos. */
  publicBase: string;
  /** Prefix for generated Memos usernames: `${prefix}${dootaskUserId}`. */
  usernamePrefix: string;
  /** Name of the proxy-issued session cookie. */
  sessionCookie: string;
  /** Session lifetime in seconds. */
  sessionTtl: number;
  requestTimeout: number;
}

function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function loadConfig(): AppConfig {
  const internalSecret =
    process.env.INTERNAL_SECRET && process.env.INTERNAL_SECRET.length >= 8
      ? process.env.INTERNAL_SECRET
      : // Fall back to a stable per-deployment secret so restarts keep the same
        // derived passwords even if the operator forgot to set one.
        createHash('sha256')
          .update(`memos-fallback:${process.env.MEMOS_UPSTREAM || ''}:${process.env.DOOTASK_URL || ''}`)
          .digest('hex');

  return {
    port: Number.parseInt(process.env.PROXY_PORT || '7070', 10),
    memosUpstream: (process.env.MEMOS_UPSTREAM || 'http://memos:5230').replace(/\/+$/, ''),
    dootaskUrl: (process.env.DOOTASK_URL || 'http://nginx').replace(/\/+$/, ''),
    adminUserIds: parseIds(process.env.MEMOS_ADMIN_USER_IDS),
    internalSecret,
    ssoEntryPath: process.env.SSO_ENTRY_PATH || '/dootask-sso',
    publicBase: (process.env.PUBLIC_BASE || '/apps/memos').replace(/\/+$/, ''),
    usernamePrefix: process.env.MEMOS_USERNAME_PREFIX || 'dootask-',
    sessionCookie: process.env.SESSION_COOKIE || 'dootask_memos_sess',
    sessionTtl: Number.parseInt(process.env.SESSION_TTL || '2592000', 10), // 30 days
    requestTimeout: Number.parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
  };
}
