import http from 'node:http';
import httpProxy from 'http-proxy';
import type { AppConfig } from './config.js';
import { DooTaskClient, DooTaskUser } from './dootaskClient.js';
import type { Logger } from './logger.js';
import { MemosClient, SignInResult } from './memosClient.js';
import { issueSession, verifySession } from './session.js';
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
}

/** Browser bootstrap produced by a successful sign-in. */
interface Bootstrap {
  signedIn: SignInResult;
  prefs: Prefs;
  cookies: string[];
}

const j = (s: string) => JSON.stringify(s);

/** JS that resolves the themed background from a known theme or localStorage. */
const BG_RESOLVER =
  `var __t=THEME_EXPR||(function(){try{return localStorage.getItem('memos-theme')}catch(e){return null}})();` +
  `var __bg=({"default":"#faf9f5","default-dark":"#1d1f23","paper":"#f5ede4"})[__t]||"#faf9f5";`;

/**
 * Inline script + splash injected into Memos' index.html for a flash-free,
 * single-load sign-in. `theme`/`locale` are known on a token entry and omitted on
 * a session re-mint (the page reads them from localStorage instead).
 */
function injectIndexHtml(html: string, token: string, expiresAt: string, prefs: Prefs): string {
  const themeExpr = prefs.theme ? j(prefs.theme) : 'null';
  const head =
    `<script>(function(){try{` +
    `localStorage.setItem('memos_access_token',${j(token)});` +
    `localStorage.setItem('memos_token_expires_at',${j(expiresAt)});` +
    (prefs.theme ? `localStorage.setItem('memos-theme',${j(prefs.theme)});` : '') +
    (prefs.locale ? `localStorage.setItem('memos-locale',${j(prefs.locale)});` : '') +
    BG_RESOLVER.replace('THEME_EXPR', themeExpr) +
    `document.documentElement.style.background=__bg;` +
    `document.documentElement.style.setProperty('--dtbg',__bg);` +
    `if(history.replaceState)history.replaceState({},'',location.pathname);` +
    `}catch(e){}})();</script>` +
    `<style>#dootask-splash{position:fixed;inset:0;z-index:2147483647;background:var(--dtbg,#faf9f5);` +
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
  return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`).replace(/<\/body>/i, `${body}</body>`);
}

/** Shown when the session is gone and we have no token — breaks any reload loop. */
function sessionExpiredHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Memos</title>
<script>try{var t=localStorage.getItem('memos-theme');document.documentElement.style.background=({"default":"#faf9f5","default-dark":"#1d1f23","paper":"#f5ede4"})[t]||"#faf9f5";}catch(e){}</script>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui;color:#888}</style>
</head><body>
<div id="m"></div>
<script>
var zh=/^zh/i.test(navigator.language||'');
document.getElementById('m').textContent = zh ? '会话已过期，请从 DooTask 重新打开 Memos。' : 'Session expired. Please reopen Memos from DooTask.';
</script>
</body></html>`;
}

function readCookie(req: http.IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
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
  const sendHtml = (res: http.ServerResponse, body: string, cookies?: string[]) => {
    const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
    if (cookies) headers['Set-Cookie'] = cookies;
    res.writeHead(200, headers);
    res.end(body);
  };

  function buildCookies(uid: number, un: string, refreshToken?: string): string[] {
    const session = issueSession(
      { uid, un, exp: Math.floor(Date.now() / 1000) + cfg.sessionTtl },
      cfg.internalSecret,
    );
    const cookies = [`${cfg.sessionCookie}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionTtl}`];
    if (refreshToken) {
      cookies.push(`memos_refresh=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionTtl}`);
    }
    return cookies;
  }

  /** Full SSO from a DooTask token: provision, sync prefs + avatar, build bootstrap. */
  async function bootstrapFromToken(url: URL): Promise<Bootstrap | null> {
    const dtUser: DooTaskUser | null = await dootask.resolveUser(url.searchParams.get('token') || '');
    if (!dtUser) return null;

    const signedIn = await users.ensureSignedIn(dtUser);
    const username = users.usernameFor(dtUser.userid);
    const themeRaw = url.searchParams.get('theme') || undefined;
    const langRaw = url.searchParams.get('lang') || undefined;
    const { theme, locale } = users.mapPreferences(themeRaw, langRaw);

    await users
      .applyPreferences(username, signedIn.accessToken, themeRaw, langRaw)
      .catch((err) => logger.warn({ err: (err as Error).message }, 'applyPreferences failed'));

    if (dtUser.avatar && !signedIn.user.avatarUrl) {
      const dataUri = await dootask.fetchAvatarDataUri(dtUser.avatar);
      if (dataUri) {
        await users.setAvatar(username, dataUri).catch((err) => logger.warn({ err: (err as Error).message }, 'avatar sync failed'));
      }
    }

    return { signedIn, prefs: { theme, locale }, cookies: buildCookies(dtUser.userid, username, signedIn.refreshToken) };
  }

  /** Re-establish a session from the proxy's own signed cookie (no DooTask call). */
  async function bootstrapFromSession(req: http.IncomingMessage): Promise<Bootstrap | null> {
    const session = verifySession(readCookie(req, cfg.sessionCookie), cfg.internalSecret);
    if (!session) return null;
    const signedIn = await users.signInExisting(session.uid);
    if (!signedIn) return null;
    return { signedIn, prefs: {}, cookies: buildCookies(session.uid, session.un, signedIn.refreshToken) };
  }

  /**
   * SPA entry. Establishes auth and serves index.html with the token injected, so
   * the app boots authenticated in a single, flash-free load. Order: a DooTask
   * token (menu open) → the proxy session cookie (re-auth after timeout) → a
   * "reopen from DooTask" page (genuinely expired; also breaks any reload loop).
   */
  async function handleEntry(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const boot = url.searchParams.has('token') ? await bootstrapFromToken(url) : await bootstrapFromSession(req);
    if (!boot) {
      sendHtml(res, sessionExpiredHtml());
      return;
    }
    const html = await memos.fetchIndexHtml();
    if (!html) {
      sendHtml(res, sessionExpiredHtml(), boot.cookies);
      return;
    }
    sendHtml(res, injectIndexHtml(html, boot.signedIn.accessToken, boot.signedIn.expiresAt, boot.prefs), boot.cookies);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/healthz') return void send(res, 200, 'ok');

    // SPA document load (root) — (re)establish the SSO session and inject.
    const accept = String(req.headers['accept'] || '');
    if (method === 'GET' && (path === '/' || path === '') && accept.includes('text/html')) {
      handleEntry(req, res, url).catch((err) => {
        logger.error({ err: (err as Error).message }, 'entry failed');
        if (!res.headersSent) send(res, 500, 'Entry error');
      });
      return;
    }

    // Force SSO: block direct sign-in / self-registration (REST + connect-RPC).
    // Token renewal is handled by the entry re-auth above, not a login page.
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
