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

# 6) Default logo fallback ("/full-logo.webp") -> base-aware.
perl -0pi -e 's/"\/full-logo\.webp"/`\${import.meta.env.BASE_URL.replace(\/\\\/\$\/, "")}\/full-logo.webp`/g' \
  web/src/components/MemosLogo.tsx web/src/components/NavigationDrawer.tsx web/src/components/UserAvatar.tsx

# 7) PWA manifest icons -> relative so they resolve under the sub-path.
perl -0pi -e 's/"src": "\/(android-chrome[^"]+)"/"src": "\1"/g' web/public/site.webmanifest

# 8) DooTask: add a "Close app" entry to the left sidebar, just below Inbox
#    (the DooTask capsule is hidden via plugin config, so this replaces its
#    close action). The component lives in /overlay so the edit here is tiny.
cp /overlay/DooTaskClose.tsx web/src/components/DooTaskClose.tsx
perl -0pi -e 's/import UserMenu from "\.\/UserMenu";/import UserMenu from ".\/UserMenu";\nimport DooTaskClose from ".\/DooTaskClose";/' web/src/components/Navigation.tsx
perl -0pi -e 's/\n(\s*)<\/TooltipProvider>/\n$1  <DooTaskClose collapsed={collapsed} \/>\n$1<\/TooltipProvider>/' web/src/components/Navigation.tsx

echo "Applied Memos sub-path patches:"
grep -n "base:" web/vite.config.mts | head -1
grep -n "basename" web/src/router/index.tsx
grep -c "import.meta.env.BASE_URL" web/src/connect.ts web/src/utils/attachment.ts web/src/hooks/useLiveMemoRefresh.ts
