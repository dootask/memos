import http from 'node:http';
import httpProxy from 'http-proxy';
import type { AppConfig } from './config.js';
import { DooTaskClient } from './dootaskClient.js';
import type { Logger } from './logger.js';
import { MemosClient } from './memosClient.js';
import { issueSession } from './session.js';
import { UserManager } from './userManager.js';

/** Auth-bypass endpoints blocked so every login goes through DooTask SSO. */
const BLOCKED_PATHS = new Set([
  '/api/v1/auth/signin',
  '/api/v1/users',
  '/memos.api.v1.AuthService/SignIn',
  '/memos.api.v1.UserService/CreateUser',
]);

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

    const username = users.usernameFor(dtUser.userid);

    // Sync DooTask theme & language onto the Memos account (best-effort).
    await users
      .applyPreferences(
        username,
        signedIn.accessToken,
        url.searchParams.get('theme') || undefined,
        url.searchParams.get('lang') || undefined,
      )
      .catch((err) => logger.warn({ err: (err as Error).message }, 'applyPreferences failed'));

    // Sync the DooTask avatar once (Memos needs a data URI). Skipped for default
    // cartoon avatars (no file) and when the Memos avatar is already set.
    if (dtUser.avatar && !signedIn.user.avatarUrl) {
      const dataUri = await dootask.fetchAvatarDataUri(dtUser.avatar);
      if (dataUri) {
        await users.setAvatar(username, dataUri).catch((err) =>
          logger.warn({ err: (err as Error).message }, 'avatar sync failed'),
        );
      }
    }

    // Redirect the iframe to the SPA root under the public sub-path.
    const dest = `${cfg.publicBase}${target}`.replace(/\/{2,}/g, '/');

    // Forward Memos' own refresh token so the SPA renews natively (connect
    // `RefreshToken` reads the `memos_refresh` cookie). The session cookie keeps
    // the DooTask→Memos mapping in case we need to re-issue server-side.
    const session = issueSession(
      { uid: dtUser.userid, un: users.usernameFor(dtUser.userid), exp: Math.floor(Date.now() / 1000) + cfg.sessionTtl },
      cfg.internalSecret,
    );
    const cookies = [
      `${cfg.sessionCookie}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionTtl}`,
    ];
    if (signedIn.refreshToken) {
      cookies.push(
        `memos_refresh=${signedIn.refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionTtl}`,
      );
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': cookies,
    });
    res.end(bootstrapHtml(signedIn.accessToken, signedIn.expiresAt, dest));
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

    // Force SSO: block direct sign-in and self-registration. Covers both the
    // REST gateway and the connect-RPC paths the web client actually uses.
    // Token renewal (`AuthService/RefreshToken`) is intentionally allowed — it
    // works off the `memos_refresh` cookie we set during SSO bootstrap.
    if (method === 'POST' && BLOCKED_PATHS.has(path)) {
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
