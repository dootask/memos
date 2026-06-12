#!/bin/sh
# Patch the Memos frontend so it can be served under a sub-path (BASE_PATH).
#
# Memos officially assumes root-path hosting: assets, the React Router and the
# Connect-RPC transport are all built against "/". These five edits make every
# browser-facing absolute URL honor Vite's BASE_URL, so a reverse proxy can host
# Memos at e.g. /apps/memos/ . The Go backend is unchanged (the proxy strips the
# prefix before forwarding, so the backend keeps serving at root).
#
# Usage: sh patch.sh <memos-source-dir>
set -e
SRC="${1:-.}"
cd "$SRC"

# 1) Vite base path, driven by the BASE_PATH build env (default "/").
perl -0pi -e 's/export default defineConfig\(\{\n/export default defineConfig({\n  base: process.env.BASE_PATH || "\/",\n/' web/vite.config.mts

# 2) React Router basename = BASE_URL (without trailing slash).
perl -0pi -e 's/const router = createBrowserRouter\(routeConfig\);/const router = createBrowserRouter(routeConfig, { basename: import.meta.env.BASE_URL.replace(\/\\\/\$\/, "") || "\/" });/' web/src/router/index.tsx

# 3) Connect-RPC transport baseUrl (two transports) -> origin + base.
perl -0pi -e 's/baseUrl: window\.location\.origin,/baseUrl: window.location.origin + import.meta.env.BASE_URL.replace(\/\\\/\$\/, ""),/g' web/src/connect.ts

# 4) Browser-facing absolute links built from `${window.location.origin}/...`
#    -> insert the base so copied/shared links carry the sub-path. Covers memo
#    attachment URLs, the attachment library, share links and profile links.
#    (Idempotent within a run: once rewritten, `origin}/` no longer matches.)
perl -0pi -e 's/\$\{window\.location\.origin\}\//\${window.location.origin}\${import.meta.env.BASE_URL.replace(\/\\\/\$\/, "")}\//g' \
  web/src/utils/attachment.ts \
  web/src/hooks/useAttachmentLibrary.ts \
  web/src/hooks/useMemoShareQueries.ts \
  web/src/pages/UserProfile.tsx
# Memo "copy link" uses a host variable that falls back to origin.
perl -0pi -e 's/host = window\.location\.origin;/host = window.location.origin + import.meta.env.BASE_URL.replace(\/\\\/\$\/, "");/' web/src/components/MemoActionMenu/hooks.ts

# 5) SSE endpoint -> base + /api/v1/sse
perl -0pi -e 's/fetch\("\/api\/v1\/sse"/fetch(`\${import.meta.env.BASE_URL.replace(\/\\\/\$\/, "")}\/api\/v1\/sse`/' web/src/hooks/useLiveMemoRefresh.ts

# 6) Avatars/logos are all rendered through UserAvatar, so prefix the base in
#    that single place: a synced avatar stored as a root-relative "/file/..."
#    path (and the "/full-logo.webp" fallback) get the base; data-URI and
#    absolute (http) avatars are left as-is. MemosLogo / NavigationDrawer pass
#    their "/full-logo.webp" fallback through UserAvatar, so they need no edit
#    (prefixing them here too would double the prefix).
perl -0pi -e 's/src=\{avatarUrl \|\| "\/full-logo\.webp"\}/src={(avatarUrl \&\& avatarUrl.startsWith("\/") ? `\${import.meta.env.BASE_URL.replace(\/\\\/\$\/, "")}\${avatarUrl}` : avatarUrl) || `\${import.meta.env.BASE_URL.replace(\/\\\/\$\/, "")}\/full-logo.webp`}/' web/src/components/UserAvatar.tsx

# 7) PWA manifest icons -> relative so they resolve under the sub-path.
perl -0pi -e 's/"src": "\/(android-chrome[^"]+)"/"src": "\1"/g' web/public/site.webmanifest
# The About page renders a root-absolute "/logo.webp" directly (not via UserAvatar).
perl -0pi -e 's/src="\/logo\.webp"/src={`\${import.meta.env.BASE_URL.replace(\/\\\/\$\/, "")}\/logo.webp`}/' web/src/pages/About.tsx

# 8) DooTask: add "Open in new window" (desktop) + "Close app" entries to the
#    left sidebar, just below Inbox (the DooTask capsule is hidden via plugin
#    config, so these replace its actions). Component lives in /overlay.
cp /overlay/DooTaskActions.tsx web/src/components/DooTaskActions.tsx
perl -0pi -e 's/import UserMenu from "\.\/UserMenu";/import UserMenu from ".\/UserMenu";\nimport DooTaskActions from ".\/DooTaskActions";/' web/src/components/Navigation.tsx
perl -0pi -e 's/\n(\s*)<\/TooltipProvider>/\n$1  <DooTaskActions collapsed={collapsed} \/>\n$1<\/TooltipProvider>/' web/src/components/Navigation.tsx

# 9) DooTask SSO context: hide account-management UI that would break the managed
#    account model. Accounts are provisioned/owned by DooTask, theme & language
#    follow DooTask, so these controls are removed:
#    - My Account: "Edit" + "Change password" buttons and the danger zone.
perl -0pi -e 's#\s*<div className="flex items-center gap-2 shrink-0">.*?</div>##s' web/src/components/Settings/MyAccountSection.tsx
perl -0pi -e 's#\s*<SettingGroup showSeparator title=\{t\("setting\.account\.danger-area"\).*?</SettingGroup>##s' web/src/components/Settings/MyAccountSection.tsx
#    - User menu: "Sign out", plus the Language and Theme submenus (DooTask drives them).
perl -0pi -e 's#\s*<DropdownMenuItem onClick=\{handleSignOut\}>.*?</DropdownMenuItem>##s' web/src/components/UserMenu.tsx
perl -0pi -e 's#\s*<DropdownMenuSub>\s*<DropdownMenuSubTrigger>\s*<GlobeIcon.*?</DropdownMenuSub>##s' web/src/components/UserMenu.tsx
perl -0pi -e 's#\s*<DropdownMenuSub>\s*<DropdownMenuSubTrigger>\s*<PaletteIcon.*?</DropdownMenuSub>##s' web/src/components/UserMenu.tsx

# 10) On auth failure the SPA does window.location.replace("/auth?...") — a root
#     path that 404s under the sub-path. Reload the plugin entry instead, so the
#     proxy can re-establish the session from its cookie (or show a reopen page).
perl -0pi -e 's/window\.location\.replace\(\s*buildAuthRoute\(\{.*?\}\),?\s*\);/window.location.replace(import.meta.env.BASE_URL);/s' web/src/utils/auth-redirect.ts

echo "Applied Memos sub-path patches:"
grep -n "base:" web/vite.config.mts | head -1
grep -n "basename" web/src/router/index.tsx
grep -c "import.meta.env.BASE_URL" web/src/connect.ts web/src/utils/attachment.ts web/src/hooks/useLiveMemoRefresh.ts
