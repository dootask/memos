import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  /** DooTask user id. */
  uid: number;
  /** Memos username. */
  un: string;
  /** Expiry (unix seconds). */
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Issue a compact, signed session token: `<payload>.<sig>`. */
export function issueSession(payload: SessionPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/** Verify and decode a session token, returning null if invalid or expired. */
export function verifySession(token: string | undefined, secret: string): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Deterministic Memos password for a DooTask user. Derived from the shared
 * secret so the proxy can always sign the user back in without storing it.
 */
export function derivePassword(dootaskUserId: number, secret: string): string {
  return createHmac('sha256', secret).update(`memos-pw:${dootaskUserId}`).digest('hex').slice(0, 32);
}
