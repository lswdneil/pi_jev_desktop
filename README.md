# spec.ai.jev

**A judgment-native desktop workspace for coding agents.**

spec.ai.jev keeps the conversation, the work the agent is doing, and the decisions it made in the same place. The
runtime remains a mu/pi harness; this repository owns the desktop product, its workspace model, and its visual system.

## Status

This is the first vertical slice. It adds:

- A project workspace picker; the chosen folder becomes the agent's working directory.
- Recent-project shortcuts for returning to a workspace without reopening the folder dialog.
- A session rail with the current session, saved sessions, search, rename, and model; selecting a saved session switches the live agent.
- Sessions from other projects in the same rail; opening one moves the agent to that project first.
- Deleting a saved session (two clicks; the agent leaves it first if it is the open one).
- Quick open with `Ctrl+P`: type part of a name, press Enter, and the file opens in the Files panel.
- The window reopens at the size and place it was closed at, as long as a display still reaches it.
- Tool rows keep the tool's own answer, one click away, clipped to 4 000 characters.
- Recent-project rows with their folder, and a way to forget a shortcut.
- A model picker that changes the running session.
- The conversation, tool runs, approval cards, file history, and judgment ledger.
- A log of the questions answered in the window, since the harness keeps only the effect of an answer.
- Images on a prompt: attach, drop or paste up to six (PNG, JPEG, WebP, GIF) and they travel with the message.
- A file preview with an editor and a line diff; saves are hash-checked, so an edit is never written over what the
  agent changed in between.
- The Freebuff dark palette, with the spec.ai.jev logo as the global brand mark.

The product specification and clickable design prototype live in `docs/`.

## Run

The app expects a mu checkout that contains `kyrn/bin/mu.mjs`.

```powershell
$env:MU_ROOT = "C:\Users\wd_al\Downloads\DSH-Beta\mu-work"
npm install --ignore-scripts
npm run typecheck
npm test
npm run build
npm run dev
```

`MU_WORKSPACE` selects the initial project folder. Without it, a repository checkout starts in its own root and a
packaged app starts in the user's home folder.

The Electron tests use a local fixture by default. To exercise the real mu checkout:

```powershell
$env:PI_JEV_HARNESS = "C:\Users\wd_al\Downloads\DSH-Beta\mu-work"
npm run test:e2e
```

## Branding

- Global UI mark: `src/renderer/assets/logo.png`
- Installer/window icon: `build/icon.png`
- Product name: `spec.ai.jev`
- Application id: `ai.spec.jev`
- Update feed: `lswdneil/pi_jev_desktop`

The palette is the Freebuff dark theme mapped to semantic roles: lime primary `#9EFC62`, foreground `#f1f5f9`,
surface `#202327`, hover surface `#334155`, border `#536175`, code background `#374151`, inline code `#FF8534`, and
headings `#facc15`.

## Verification

```powershell
npm run verify          # typecheck, tests, build, size budget
npm run test:e2e
```

The integration tests use temporary `HOME`, `USERPROFILE`, browser profile, and harness data; they do not touch a
developer's real mu state.

## Source control

Changes land in small, verifiable stages: run `npm run verify`, commit with a conventional subject, push to
`origin/main`. `AGENTS.md` states the rule, and `.gitignore` keeps build output and the staged runtime out of history.

## Packaging

```powershell
$env:MU_ROOT = "C:\Users\wd_al\Downloads\DSH-Beta\mu-work"
npm run package:dir         # build + stage the mu runtime + unpacked app in dist/
npm run smoke:package       # launch it and wait for the agent to report "running ·"
npm run package             # the installer: dist/spec.ai.jev-<version>-x64.exe
node scripts/install-rehearsal.mjs   # silent install, a real turn, uninstall
```

`scripts/stage-harness.mjs` copies the built `mu-agent` package into `resources/harness/mu-agent` (~34 MB, git-ignored);
it accepts `--from <folder>` and `MU_HARNESS_ROOT` when the runtime lives elsewhere.

Packaging uses the Electron already in `node_modules` (`electronDist` in `electron-builder.yml`) rather than fetching a
second copy, so a package build needs no network.

## License

The product is MIT. The desktop shell is derived from the mu desktop-next work, which is Apache-2.0; the copied files
keep their SPDX headers. See `LICENSES/Apache-2.0.txt`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`.
