import axios, { AxiosInstance, isAxiosError } from 'axios';
import type { Logger } from './logger.js';

export type MemosRole = 'HOST' | 'ADMIN' | 'USER';

export interface MemosUser {
  name: string; // e.g. "users/dootask-1"
  username: string;
  role: MemosRole;
  email: string;
  displayName: string;
}

export interface SignInResult {
  user: MemosUser;
  accessToken: string;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
  /** The `memos_refresh` token value, so the browser can renew natively. */
  refreshToken?: string;
}

export interface InstanceProfile {
  version: string;
  /** The instance admin, or null when the instance is still uninitialized. */
  admin: MemosUser | null;
}

/**
 * Client for the Memos v0.2x REST API (verified against 0.29.0). All calls go to
 * the internal upstream, never through the public proxy listener.
 */
export class MemosClient {
  private readonly http: AxiosInstance;

  constructor(upstream: string, timeout: number, private readonly logger: Logger) {
    this.http = axios.create({
      baseURL: upstream,
      timeout,
      // Resolve regardless of status so callers can branch on the body.
      validateStatus: () => true,
    });
  }

  async getInstanceProfile(): Promise<InstanceProfile> {
    const res = await this.http.get('/api/v1/instance/profile');
    if (res.status !== 200) {
      throw new Error(`instance/profile failed: ${res.status}`);
    }
    return res.data as InstanceProfile;
  }

  async signIn(username: string, password: string): Promise<SignInResult | null> {
    const res = await this.http.post('/api/v1/auth/signin', {
      passwordCredentials: { username, password },
    });
    if (res.status !== 200 || !res.data?.accessToken) {
      this.logger.debug({ username, status: res.status }, 'signin rejected');
      return null;
    }
    return {
      user: res.data.user as MemosUser,
      accessToken: res.data.accessToken as string,
      expiresAt: (res.data.accessTokenExpiresAt as string) || '',
      refreshToken: this.extractRefreshToken(res.headers),
    };
  }

  /**
   * The REST gateway emits the refresh cookie as `Grpc-Metadata-Set-Cookie`
   * (and occasionally a plain `set-cookie`). Pull the `memos_refresh` value out.
   */
  private extractRefreshToken(headers: Record<string, unknown>): string | undefined {
    const candidates: string[] = [];
    for (const key of ['grpc-metadata-set-cookie', 'set-cookie']) {
      const v = headers[key];
      if (Array.isArray(v)) candidates.push(...(v as string[]));
      else if (typeof v === 'string') candidates.push(v);
    }
    for (const c of candidates) {
      const m = /memos_refresh=([^;]+)/.exec(c);
      if (m) return m[1];
    }
    return undefined;
  }

  /** Create a user. Publicly only USER role is honored; first ever user becomes ADMIN. */
  async createUser(input: {
    username: string;
    password: string;
    displayName?: string;
    email?: string;
  }): Promise<MemosUser | null> {
    const res = await this.http.post('/api/v1/users', {
      username: input.username,
      password: input.password,
      displayName: input.displayName || '',
      email: input.email || '',
    });
    if (res.status === 200 && res.data?.username) {
      return res.data as MemosUser;
    }
    // Already exists is an expected, non-fatal outcome for callers.
    const msg = res.data?.message || '';
    if (res.status === 409 || /exist/i.test(msg)) {
      return null;
    }
    this.logger.warn({ status: res.status, msg, username: input.username }, 'createUser failed');
    return null;
  }

  async getUser(username: string, adminToken: string): Promise<MemosUser | null> {
    const res = await this.http.get(`/api/v1/users/${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (res.status === 200 && res.data?.username) {
      return res.data as MemosUser;
    }
    return null;
  }

  /** Patch selected fields of a user. Requires an admin bearer token. */
  async updateUser(
    username: string,
    fields: Partial<Pick<MemosUser, 'role' | 'displayName' | 'email'>> & { password?: string },
    adminToken: string,
  ): Promise<boolean> {
    // The JSON body stays camelCase, but updateMask paths must be snake_case.
    const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    const mask = Object.keys(fields).map(toSnake).join(',');
    if (!mask) return true;
    const res = await this.http.patch(
      `/api/v1/users/${encodeURIComponent(username)}?updateMask=${encodeURIComponent(mask)}`,
      fields,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    if (res.status === 200) return true;
    this.logger.warn(
      { status: res.status, msg: res.data?.message, username, mask },
      'updateUser failed',
    );
    return false;
  }

  /** Stream-proxy helper: expose the raw upstream base for the reverse proxy. */
  static isConnError(error: unknown): boolean {
    return isAxiosError(error) && !error.response;
  }
}
