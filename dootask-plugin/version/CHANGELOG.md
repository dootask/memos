### Added
- Memos note-taking service with DooTask single sign-on.
- DooTask users are auto-registered and signed in without a password.
- Choose administrators during installation; they get Memos admin privileges automatically, and changing them later (even a full swap) applies reliably.
- Served same-origin under /apps/memos/ via a sub-path patched Memos build.
- Added a "Close app" entry in the Memos sidebar and hid the overlapping DooTask capsule.
- Synced theme, language, nickname and avatar from DooTask on each entry.
- Removed the sign-in redirect: the app now loads authenticated in a single, flash-free step.
- Hid account-management controls that don't fit SSO (edit, change password, delete account, sign out).
