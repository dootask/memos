# DooTask Memos Plugin

A DooTask plugin that runs [Memos](https://www.usememos.com) — a privacy-first, lightweight note-taking service — with DooTask single sign-on. DooTask users are automatically registered and signed in, administrators are chosen at install time, and the whole thing is served same-origin under `/apps/memos/`.

## Architecture

```
Browser ── /apps/memos/... ──► DooTask nginx (main origin + TLS)
                                   │  (nginx.conf strips the /apps/memos/ prefix)
                                   ▼
                              memos-proxy  ──►  1. /dootask-sso: verify DooTask token
                              (this repo,        2. provision the Memos account on demand
                               Node/TS)          3. sign in (deterministic password)
                                   │             4. inject access token + memos_refresh cookie
                                   ▼             5. block direct sign-in/sign-up (force SSO)
                              memos-server  (self-built Memos image, sub-path patched, :5230, SQLite)
```

Because Memos assumes root-path hosting, `memos-server` is a **self-built image**: it clones the pinned upstream Memos tag and applies small frontend patches (Vite `base`, React Router `basename`, Connect-RPC base URL, attachment/SSE URLs, logo/manifest) so every browser-facing URL honors the `/apps/memos/` prefix. The Go backend is unchanged — the proxy/nginx strip the prefix, so the backend keeps serving at root.

Token renewal uses Memos' native `RefreshToken` via the `memos_refresh` cookie the proxy sets during SSO bootstrap (sessions last up to 30 days); the proxy does not need to intercept refresh.

## Repository layout

```
.
├── server/                       # Node/TypeScript auth proxy (image: dootask/memos)
│   └── src/
│       ├── index.ts              # entrypoint + admin seeding
│       ├── server.ts             # SSO entry, auth-bypass blocks, reverse proxy
│       ├── config.ts             # environment configuration
│       ├── dootaskClient.ts      # DooTask token validation
│       ├── memosClient.ts        # Memos REST API client (+ refresh-cookie capture)
│       ├── userManager.ts        # account provisioning + admin reconciliation
│       └── session.ts            # signed sessions + deterministic passwords
├── Dockerfile                    # builds the dootask/memos proxy image
├── memos-server/                 # self-built Memos image (image: dootask/memos-server)
│   ├── Dockerfile                # clone pinned Memos + patch + build (web + go embed)
│   └── patch.sh                  # sub-path frontend patches
├── dootask-plugin/               # DooTask plugin package
│   ├── config.yml
│   ├── logo.svg
│   ├── README.md / README_zh.md
│   └── version/                  # renamed to the tag at release time
│       ├── config.yml            # admin user_select + iframe menu (/apps/memos/)
│       ├── docker-compose.yml    # memos-server + memos-proxy (no exposed ports)
│       ├── nginx.conf            # /apps/memos/ → memos-proxy (prefix-stripping)
│       └── CHANGELOG*.md
├── .github/workflows/release.yml # tag push → build both images + publish to AppStore
└── .claude/skills/release-plugin # project release skill
```

## Development

```bash
# proxy
cd server && npm install && npm run build

# self-built Memos image
cd memos-server && docker build -t dootask/memos-server:0.29.0 --build-arg BASE_PATH=/apps/memos/ .
```

### Proxy environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PROXY_PORT` | `7070` | Port the proxy listens on inside the container. |
| `MEMOS_UPSTREAM` | `http://memos-server:5230` | Internal Memos service. |
| `DOOTASK_URL` | `http://nginx` | DooTask main API base. |
| `PUBLIC_BASE` | `/apps/memos` | Public sub-path (used for redirects/cookies). |
| `MEMOS_ADMIN_USER_IDS` | _(empty)_ | Comma-separated DooTask user ids granted admin. |
| `INTERNAL_SECRET` | _(derived)_ | Secret for passwords and session signing. |

## Releasing

Push a tag without a `v` prefix (e.g. `0.1.1`) to trigger the release workflow, or use the `release-plugin` skill. The workflow builds and pushes both `dootask/memos` and `dootask/memos-server`. To bump the embedded Memos version, change the tag in `memos-server/Dockerfile`, `dootask-plugin/version/docker-compose.yml`, and the workflow.
