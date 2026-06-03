# DooTask Memos Plugin

A DooTask plugin that runs [Memos](https://www.usememos.com) — a privacy-first, lightweight note-taking service — with DooTask single sign-on. DooTask users are automatically registered and signed in, and administrators are chosen at install time.

## Architecture

```
DooTask iframe ( :PORT/dootask-sso?token={user_token} )
        │
   memos-proxy  ──►  1. verify token via DooTask API (http://nginx)
   (this repo)       2. provision the Memos account on demand
        │            3. sign in with a deterministic password
        │            4. inject the access token + reverse-proxy the rest
        ▼
   memos-server  (neosmemo/memos, internal only, :5230, SQLite)
```

The proxy also blocks Memos' native sign-in and self-registration endpoints so that every login goes through DooTask SSO, and it transparently renews Memos access tokens via a signed, proxy-issued session cookie.

## Repository layout

```
.
├── server/                       # Node/TypeScript auth proxy
│   └── src/
│       ├── index.ts              # entrypoint + admin seeding
│       ├── server.ts             # HTTP server: SSO entry, refresh, reverse proxy
│       ├── config.ts             # environment configuration
│       ├── dootaskClient.ts      # DooTask token validation
│       ├── memosClient.ts        # Memos REST API client
│       ├── userManager.ts        # account provisioning + admin reconciliation
│       └── session.ts            # signed sessions + deterministic passwords
├── Dockerfile                    # builds the dootask/memos proxy image
├── dootask-plugin/               # DooTask plugin package (config, compose, docs)
│   ├── config.yml
│   ├── logo.svg
│   ├── README.md / README_zh.md
│   └── version/                  # renamed to the tag at release time
│       ├── config.yml
│       ├── docker-compose.yml
│       └── CHANGELOG*.md
├── .github/workflows/release.yml # tag push → build image + publish to AppStore
└── .claude/skills/release-plugin # project release skill
```

## Development

```bash
cd server
npm install
npm run build
# Run locally against a Memos container and a DooTask API:
MEMOS_UPSTREAM=http://localhost:5230 DOOTASK_URL=http://localhost:8080 \
  MEMOS_ADMIN_USER_IDS=1 INTERNAL_SECRET=dev-secret PROXY_PORT=7070 \
  node dist/index.js
```

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PROXY_PORT` | `7070` | Port the proxy listens on inside the container. |
| `MEMOS_UPSTREAM` | `http://memos-server:5230` | Internal Memos service. |
| `DOOTASK_URL` | `http://nginx` | DooTask main API base. |
| `MEMOS_ADMIN_USER_IDS` | _(empty)_ | Comma-separated DooTask user ids granted admin. |
| `INTERNAL_SECRET` | _(derived)_ | Secret for passwords and session signing. |

## Releasing

Push a tag without a `v` prefix (e.g. `0.1.1`) to trigger the release workflow, or use the `release-plugin` skill. See `.claude/skills/release-plugin/SKILL.md`.
