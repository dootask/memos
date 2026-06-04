import http from 'node:http';
import httpProxy from 'http-proxy';
import type { AppConfig } from './config.js';
import { DooTaskClient, DooTaskUser } from './dootaskClient.js';
import type { Logger } from './logger.js';
import { MemosClient, SignInResult } from './memosClient.js';
import { issueSession } from './session.js';
import { UserManager } from './userManager.js';

/** Auth-bypass endpoints blocked so every login goes through DooTask SSO. */
const BLOCKED_PATHS = new Set([
  '/api/v1/auth/signin',
  '/api/v1/users',
  '/memos.api.v1.AuthService/SignIn',
  '/memos.api.v1.UserService/CreateUser',
]);

interface Prefs {
  theme?: string;
  locale?: string;
  bg: string;
}

/** Browser bootstrap values produced by a successful SSO sign-in. */
interface SsoBootstrap {
  signedIn: SignInResult;
  prefs: Prefs;
  cookies: string[];
}

/** Inline script + splash injected into Memos' index.html for a flash-free load. */
function buildInjection(token: string, expiresAt: string, prefs: Prefs): { head: string; body: string } {
  const j = (s: string) => JSON.stringify(s);
  const head =
    `<script>(function(){try{` +
    `localStorage.setItem('memos_access_token',${j(token)});` +
    `localStorage.setItem('memos_token_expires_at',${j(expiresAt)});` +
    (prefs.theme ? `localStorage.setItem('memos-theme',${j(prefs.theme)});` : '') +
    (prefs.locale ? `localStorage.setItem('memos-locale',${j(prefs.locale)});` : '') +
    `document.documentElement.style.background=${j(prefs.bg)};` +
    `if(history.replaceState)history.replaceState({},'',location.pathname);` +
    `}catch(e){}})();</script>` +
    `<style>#dootask-splash{position:fixed;inset:0;z-index:2147483647;background:${prefs.bg};` +
    `display:flex;align-items:center;justify-content:center;transition:opacity .25s}` +
    `#dootask-splash .s{width:28px;height:28px;border:3px solid rgba(127,127,127,.25);` +
    `border-top-color:rgba(127,127,127,.85);border-radius:50%;animation:dtspin .8s linear infinite}` +
    `@keyframes dtspin{to{transform:rotate(360deg)}}</style>` +
    `<script>(function(){function rm(){var s=document.getElementById('dootask-splash');` +
    `if(s){s.style.opacity='0';setTimeout(function(){s.parentNode&&s.parentNode.removeChild(s);},250);}}` +
    `function chk(){var r=document.getElementById('root');if(r&&r.childElementCount>0){rm();return true;}return false;}` +
    `function start(){if(chk())return;var r=document.getElementById('root');` +
    `if(r){var o=new MutationObserver(function(){if(chk())o.disconnect();});o.observe(r,{childList:true,subtree:true});}` +
    `setTimeout(rm,8000);}` +
    `if(document.readyState!=='loading')start();else document.addEventListener('DOMContentLoaded',start);})();</script>`;
  const body = `<div id="dootask-splash"><div class="s"></div></div>`;
  return { head, body };
}

function injectIndexHtml(html: string, token: string, expiresAt: string, prefs: Prefs): string {
  const { head, body } = buildInjection(token, expiresAt, prefs);
  return html
    .replace(/<head[^>]*>/i, (m) => `${m}${head}`)
    .replace(/<\/body>/i, `${body}</body>`);
}

/** Minimal redirect bootstrap, kept as a fallback for the /dootask-sso entry. */
function bootstrapHtml(token: string, expiresAt: string, prefs: Prefs, target: string): string {
  const j = (s: string) => JSON.stringify(s);
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Memos</title></head>
<body style="margin:0;height:100vh;background:${prefs.bg}">
<script>(function(){try{
localStorage.setItem('memos_access_token',${j(token)});
localStorage.setItem('memos_token_expires_at',${j(expiresAt)});
${prefs.theme ? `localStorage.setItem('memos-theme',${j(prefs.theme)});` : ''}
${prefs.locale ? `localStorage.setItem('memos-locale',${j(prefs.locale)});` : ''}
}catch(e){}location.replace(${j(target)});})();</script>
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

  /**
   * Resolve the DooTask token, provision/sign in the Memos user, sync prefs and
   * avatar, and produce the browser bootstrap (tokens + cookies). Returns null
   * when the token is missing/invalid.
   */
  async function runSso(url: URL): Promise<SsoBootstrap | null> {
    const dtUser: DooTaskUser | null = await dootask.resolveUser(url.searchParams.get('token') || '');
    if (!dtUser) return null;

    const signedIn = await users.ensureSignedIn(dtUser);
    const username = users.usernameFor(dtUser.userid);
    const themeRaw = url.searchParams.get('theme') || undefined;
    const langRaw = url.searchParams.get('lang') || undefined;
    const prefs = users.mapPreferences(themeRaw, langRaw);

    await users
      .applyPreferences(username, signedIn.accessToken, themeRaw, langRaw)
      .catch((err) => logger.warn({ err: (err as Error).message }, 'applyPreferences failed'));

    if (dtUser.avatar && !signedIn.user.avatarUrl) {
      const dataUri = await dootask.fetchAvatarDataUri(dtUser.avatar);
      if (dataUri) {
        await users
          .setAvatar(username, dataUri)
          .catch((err) => logger.warn({ err: (err as Error).message }, 'avatar sync failed'));
      }
    }

    const session = issueSession(
      { uid: dtUser.userid, un: username, exp: Math.floor(Date.now() / 1000) + cfg.sessionTtl },
      cfg.internalSecret,
    );
    const cookies = [`${cfg.sessionCookie}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionTtl}`];
    if (signedIn.refreshToken) {
      cookies.push(`memos_refresh=${signedIn.refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionTtl}`);
    }
    return { signedIn, prefs, cookies };
  }

  /**
   * Primary entry: serve the SPA's index.html with the access token + theme
   * injected, so it boots authenticated in a single load (no redirect, no flash).
   * Falls back to a plain proxy when the token is invalid or index.html is
   * unavailable.
   */
  async function handleEntryInject(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const sso = await runSso(url);
    if (!sso) return void proxy.web(req, res);

    const html = await memos.fetchIndexHtml();
    if (!html) {
      // Fall back to the redirect bootstrap if we couldn't read index.html.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': sso.cookies });
      res.end(bootstrapHtml(sso.signedIn.accessToken, sso.signedIn.expiresAt, sso.prefs, `${cfg.publicBase}/`));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': sso.cookies });
    res.end(injectIndexHtml(html, sso.signedIn.accessToken, sso.signedIn.expiresAt, sso.prefs));
  }

  /** Legacy redirect entry (kept for compatibility). */
  async function handleSso(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const sso = await runSso(url);
    if (!sso) return void send(res, 401, 'Invalid or missing DooTask token.');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': sso.cookies });
    res.end(bootstrapHtml(sso.signedIn.accessToken, sso.signedIn.expiresAt, sso.prefs, `${cfg.publicBase}/`));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/healthz') return void send(res, 200, 'ok');

    // Primary SSO entry: the SPA document request carrying a DooTask token.
    const accept = String(req.headers['accept'] || '');
    if (method === 'GET' && (path === '/' || path === '') && url.searchParams.has('token') && accept.includes('text/html')) {
      handleEntryInject(req, res, url).catch((err) => {
        logger.error({ err: (err as Error).message }, 'entry inject failed');
        if (!res.headersSent) send(res, 500, 'Entry error');
      });
      return;
    }

    // Legacy redirect entry.
    if (path === cfg.ssoEntryPath) {
      handleSso(req, res, url).catch((err) => {
        logger.error({ err: (err as Error).message }, 'sso failed');
        if (!res.headersSent) send(res, 500, 'SSO error');
      });
      return;
    }

    // Force SSO: block direct sign-in / self-registration (REST + connect-RPC).
    // Token renewal (RefreshToken) is allowed — it uses the memos_refresh cookie.
    if (method === 'POST' && BLOCKED_PATHS.has(path)) {
      return void sendJson(res, 403, { message: 'Direct sign-in is disabled. Open Memos from DooTask.' });
    }

    proxy.web(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head);
  });

  return { server, users };
}
