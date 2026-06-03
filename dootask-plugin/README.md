# Memos

[Memos](https://www.usememos.com) is a privacy-first, lightweight open-source note-taking service. This plugin integrates it into DooTask with single sign-on.

## Features

- **Auto register / password-less login**: DooTask users get a Memos account created and signed in automatically when they open the plugin.
- **Pick admins at install time**: Select DooTask users to become Memos administrators; everyone else signs in as a regular member.
- **Same-origin sub-path**: Served under `/apps/memos/` through the main DooTask nginx — same origin and TLS as DooTask, no extra port to expose.
- **Self-hosted data**: Uses SQLite, stored under `data/memos` in the app directory.

## Configuration

| Field | Description |
| --- | --- |
| Administrators | DooTask users granted Memos admin privileges. |
| Internal Secret | Used to derive account passwords and sign sessions. Do not change after install. |

## How it works

The plugin runs two containers, neither exposed directly — both sit behind the main DooTask nginx at `/apps/memos/`:

- `memos-server`: a **self-built Memos image** whose frontend is patched to work under the `/apps/memos/` sub-path (assets, router, API, attachments and SSE all carry the prefix).
- `memos-proxy`: the auth proxy. It verifies the DooTask user token, provisions a Memos account on demand, signs the user in with a deterministic password, injects the access token plus a `memos_refresh` renewal cookie, and reverse-proxies everything else to Memos.

To enforce single sign-on, the proxy blocks Memos' direct sign-in and self-registration endpoints (both REST and connect-RPC). When the access token expires, the frontend renews it natively via the `memos_refresh` cookie (Memos' `RefreshToken`), keeping sessions alive for up to 30 days.
