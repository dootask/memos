import http from 'node:http';
import httpProxy from 'http-proxy';
import type { AppConfig } from './config.js';
import { DooTaskClient } from './dootaskClient.js';
import type { Logger } from './logger.js';
import { MemosClient } from './memosClient.js';
import { issueSession, verifySession } from './session.js';
import { UserManager } from './userManager.js';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function bootstrapHtml(token: string, expiresAt: string, target: string): string {
  const j = (s: string) => JSON.stringify(s);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signing in…</title></head>
<body style="font-family:system-ui;background:#f7f7f7;color:#666;display:flex;height:100vh;margin:0;align-items:center;justify-content:center">
<div>Signing in…</div>
<script>
(function(){
  try {
    localStorage.setItem('memos_access_token', ${j(token)});
    localStorage.setItem('memos_token_expires_at', ${j(expiresAt)});
  } catch (e) {}
  location.replace(${j(target)});
})();
</script>
</body></html>`;
}

export function createServer(cfg: AppConfig, logger: Logger) {
  const memos = new MemosClient(cfg.memosUpstream, cfg.requestTimeout, logger);
  const dootask = new DooTaskClient(cfg.dootaskUrl, cfg.requestTimeout, logger);
  const users = new UserManager(memos, cfg, logger);

  const proxy = httpProxy.createProxyServer({
    target: cfg.memosUpstream,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    proxyTimeout: 0,
    timeout: 0,
  });

  proxy.on('error', (err, _req, res) => {
    logger.error({ err: err.message }, 'proxy error');
    if (res instanceof http.ServerResponse && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad gateway');
    }
  });

  const send = (res: http.ServerResponse, status: number, body: string, type = 'text/plain') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  };

  const sendJson = (res: http.ServerResponse, status: number, obj: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  async function handleSso(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const token = url.searchParams.get('token') || '';
    const rawTarget = url.searchParams.get('path') || '/';
    // Only allow same-origin relative redirects.
    const target = rawTarget.startsWith('/') && !rawTarget.startsWith('//') ? rawTarget : '/';

    const dtUser = await dootask.resolveUser(token);
    if (!dtUser) {
      send(res, 401, 'Invalid or missing DooTask token.');
      return;
    }

    const signedIn = await users.ensureSignedIn(dtUser);
    const session = issueSession(
      { uid: dtUser.userid, un: users.usernameFor(dtUser.userid), exp: Math.floor(Date.now() / 1000) + cfg.sessionTtl },
      cfg.internalSecret,
    );

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': `${cfg.sessionCookie}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionTtl}`,
    });
    res.end(bootstrapHtml(signedIn.accessToken, signedIn.expiresAt, target));
  }

  async function handleRefresh(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const cookies = parseCookies(req.headers.cookie);
    const session = verifySession(cookies[cfg.sessionCookie], cfg.internalSecret);
    if (!session) {
      sendJson(res, 401, { message: 'session expired' });
      return;
    }
    const result = await memos.signIn(session.un, users.passwordFor(session.uid));
    if (!result) {
      sendJson(res, 401, { message: 'unable to refresh' });
      return;
    }
    sendJson(res, 200, { accessToken: result.accessToken, expiresAt: result.expiresAt });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Health check.
    if (path === '/healthz') return void send(res, 200, 'ok');

    // SSO entry point.
    if (path === cfg.ssoEntryPath) {
      handleSso(req, res, url).catch((err) => {
        logger.error({ err: (err as Error).message }, 'sso failed');
        if (!res.headersSent) send(res, 500, 'SSO error');
      });
      return;
    }

    // Transparent token renewal owned by the proxy.
    if (path === '/api/v1/auth/refresh' && method === 'POST') {
      handleRefresh(req, res).catch((err) => {
        logger.error({ err: (err as Error).message }, 'refresh failed');
        if (!res.headersSent) sendJson(res, 500, { message: 'refresh error' });
      });
      return;
    }

    // Force SSO: block direct sign-in and self-registration through the public port.
    if (method === 'POST' && (path === '/api/v1/auth/signin' || path === '/api/v1/users')) {
      return void sendJson(res, 403, { message: 'Direct sign-in is disabled. Open Memos from DooTask.' });
    }

    // Everything else streams straight to Memos.
    proxy.web(req, res);
  });

  // Proxy WebSocket upgrades (used by some Memos features) to the upstream.
  server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head);
  });

  return { server, users };
}
