import axios, { AxiosInstance } from 'axios';
import type { Logger } from './logger.js';

export interface DooTaskUser {
  userid: number;
  email: string;
  nickname: string;
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
      };
    } catch (error) {
      this.logger.error({ err: (error as Error).message }, 'token validation request failed');
      return null;
    }
  }
}
