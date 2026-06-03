# Memos

[Memos](https://www.usememos.com) is a privacy-first, lightweight open-source note-taking service. This plugin integrates it into DooTask with single sign-on.

## Features

- **Auto register / password-less login**: DooTask users get a Memos account created and signed in automatically when they open the plugin.
- **Pick admins at install time**: Select DooTask users to become Memos administrators; everyone else signs in as a regular member.
- **Self-hosted data**: Uses SQLite, stored under `data/memos` in the app directory.

## Configuration

| Field | Description |
| --- | --- |
| Port | The Memos service port (default 5230). Make sure it is reachable. |
| Administrators | DooTask users granted Memos admin privileges. |
| Internal Secret | Used to derive account passwords and sign sessions. Do not change after install. |

## How it works

The plugin runs two containers:

- `memos-server`: the official Memos image, listening only on the internal network.
- `memos-proxy`: the auth proxy exposed to users. It verifies the DooTask user token, provisions a Memos account on demand, signs the user in with a deterministic password, and reverse-proxies everything else to Memos.

To enforce single sign-on, the proxy blocks Memos' direct sign-in and self-registration endpoints.

> Note: if DooTask is served over HTTPS, make sure the plugin port is reachable in a way that avoids browser mixed-content blocking.
