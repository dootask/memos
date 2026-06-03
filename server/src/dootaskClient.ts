import axios, { AxiosInstance } from 'axios';
import type { Logger } from './logger.js';

export interface DooTaskUser {
  userid: number;
  email: string;
  nickname: string;
  /** Avatar URL (root-relative to the DooTask origin), or '' when none. */
  avatar: string;
}

/**
 * Thin client for the DooTask main API. Used only to verify a user token and
 * resolve the caller's identity, mirroring how the official tools authenticate
 * (a `Token` header against `GET /api/users/info`).
 */
export class DooTaskClient {
  private readonly http: AxiosInstance;

  constructor(baseUrl: string, timeout: number, private readonly logger: Logger) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout,
      headers: { 'User-Agent': 'DooTask-Memos-Proxy/0.1.0' },
    });
  }

  /** Validate a DooTask user token and return the resolved identity, or null. */
  async resolveUser(token: string): Promise<DooTaskUser | null> {
    if (!token) return null;
    try {
      const res = await this.http.get('/api/users/info', { headers: { Token: token } });
      const payload = res.data ?? {};
      if (payload.ret !== 1 || !payload.data) {
        this.logger.warn({ ret: payload.ret, msg: payload.msg }, 'token validation rejected');
        return null;
      }
      const data = payload.data;
      const userid = Number.parseInt(String(data.userid), 10);
      if (!Number.isInteger(userid) || userid <= 0) {
        return null;
      }
      return {
        userid,
        email: typeof data.email === 'string' ? data.email : '',
        nickname:
          (typeof data.nickname === 'string' && data.nickname) ||
          (typeof data.nickname_original === 'string' && data.nickname_original) ||
          `User ${userid}`,
        avatar: this.normalizeAvatar(data.userimg),
      };
    } catch (error) {
      this.logger.error({ err: (error as Error).message }, 'token validation request failed');
      return null;
    }
  }

  /**
   * DooTask returns the avatar as a path. Keep it root-relative so we can fetch
   * it via the internal base URL. The default cartoon avatar has no file (empty
   * userimg) and simply isn't synced.
   */
  private normalizeAvatar(userimg: unknown): string {
    if (typeof userimg !== 'string' || userimg.trim() === '') return '';
    const v = userimg.trim();
    if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
    return `/${v}`;
  }

  /**
   * Fetch the avatar image and return it as a data URI — Memos only accepts data
   * URIs for avatars. Returns null on any failure (avatar sync is best-effort).
   */
  async fetchAvatarDataUri(pathOrUrl: string): Promise<string | null> {
    if (!pathOrUrl) return null;
    try {
      const res = await this.http.get(pathOrUrl, { responseType: 'arraybuffer' });
      const contentType = String(res.headers['content-type'] || 'image/png').split(';')[0];
      if (!contentType.startsWith('image/')) return null;
      const base64 = Buffer.from(res.data as ArrayBuffer).toString('base64');
      if (!base64) return null;
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      this.logger.warn({ err: (error as Error).message, pathOrUrl }, 'avatar fetch failed');
      return null;
    }
  }
}
