# spec.ai.jev

**A judgment-native desktop workspace for coding agents.**

spec.ai.jev keeps the conversation, the work the agent is doing, and the decisions it made in the same place. The
the agent runtime is vendored beside the desktop shell in `spec.ai.jev/`; this repository owns the product, its
workspace model, its visual system, and its release.

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
- Links in an answer open in the built-in hardened preview; the header shows what is open and closes it.
- `Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom the window; the level is remembered.
- The panels are a keyboard-operable tablist and the agent's state is announced (live region).
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

The runtime source lives in this repository under `spec.ai.jev/` (`packages/`, `kyrn/`, `scripts/`, `docs/`). A build
of it lands in `spec.ai.jev/.artifacts/desktop-harness`, and `npm run stage:harness` copies that into
`resources/harness/mu-agent`, which is what both development and the installer run. `SPEC_AI_JEV_ROOT` names a different
checkout and wins over everything else; the historical `MU_ROOT` is still read for compatibility.

```powershell
npm install --ignore-scripts
npm run typecheck
npm test
npm run build
npm run dev
```

```powershell
npm run stage:harness   # copies the built runtime into resources/harness/mu-agent (git-ignored)
npm run dev             # no environment variable needed once that folder exists
```

`SPEC_AI_JEV_WORKSPACE` selects the initial project folder (`MU_WORKSPACE` still works). Without it, a repository checkout starts in its own root and a
packaged app starts in the user's home folder.

The Electron tests use a local fixture by default. To exercise the real runtime checkout:

```powershell
$env:SPEC_AI_JEV_HARNESS = "spec.ai.jev"
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
developer's real agent state.

## Source control

Changes land in small, verifiable stages: run `npm run verify`, commit with a conventional subject, push to
`origin/main`. `AGENTS.md` states the rule, and `.gitignore` keeps build output and the staged runtime out of history.

## Packaging

```powershell
npm run package:dir         # build + stage the runtime + unpacked app in dist/
npm run smoke:package       # launch it and wait for the agent to report "running ·"
npm run package             # the installer: dist/spec.ai.jev-<version>-x64.exe
node scripts/install-rehearsal.mjs   # silent install, a real turn, uninstall
```

`scripts/stage-harness.mjs` copies the built runtime package into `resources/harness/mu-agent` (~34 MB, git-ignored);
it accepts `--from <folder>` and `MU_HARNESS_ROOT` when the runtime lives somewhere else.

`.github/workflows/desktop-package.yml` builds the same installer on Windows; `docs/release.md` is the runbook (CI,
signing secrets, the update key, and when a draft becomes a release).

Packaging uses the Electron already in `node_modules` (`electronDist` in `electron-builder.yml`) rather than fetching a
second copy, so a package build needs no network.

## License

The product is MIT. The desktop shell is derived from the mu desktop-next work, which is Apache-2.0; the copied files
keep their SPDX headers. See `LICENSES/Apache-2.0.txt`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`.
