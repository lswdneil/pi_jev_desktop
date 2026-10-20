# mu-desktop

mu's new desktop shell: a small Electron app that starts the mu harness and draws the conversation it streams.

This replaces `desktop/` (the frozen AionUi fork, 159,294 lines of `.ts`/`.tsx`). It is a separate application with
its own dependency tree, not a workspace member, so nothing here reaches the root `package-lock.json`. It is
Apache-2.0 (`LICENSE`), because it started as a fork of AionUi; the rest of mu stays MIT. `NOTICE` says which parts
came from where.

## Running it

```bash
npm install --ignore-scripts   # once; the .npmrc in this folder is needed, see below
npm run typecheck
npm run test                   # unit tests, no Electron needed
npm run build                  # out/main, out/preload, out/renderer
npm run test:e2e               # drives the built app; needs the Electron binary
```

`npm run dev` runs the same app against Vite's dev server with HMR.

`npm run typecheck` is the only type check this folder gets: the build bundles with esbuild, which strips types instead
of checking them, and the repository's `npm run check` does not look here (not a workspace member). The packaging
workflow runs it before it builds installers, and `node scripts/preflight.mjs --full` runs it before the shell's build;
run it by hand when working on the shell alone.

### The Electron binary

`npm install --ignore-scripts` does not download Electron itself. Do it once, on purpose:

```bash
npm rebuild electron
# Behind a proxy, Node's fetch needs to be told about it:
#   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 node node_modules/electron/install.js
```

Without it `npm run build` still works (bundling needs no browser) but `npm run test:e2e` cannot start anything.

### Why npm and not bun

The old shell is a bun project; this one is installed with npm, for two reasons that cost an afternoon to find:

- **The toolchain needs its platform binaries.** vite 8 bundles with rolldown, and rolldown, lightningcss and electron
  all ship those binaries as *optional* dependencies. The user-level `~/.npmrc` on this machine sets
  `omit=optional`, so the first install produced a JS-only rolldown that failed with a native-binding error — and,
  because Node then resolved a neighbouring checkout's older `@rolldown/binding-win32-x64-msvc`, the error looked like
  a bundler bug rather than a missing package. `.npmrc` here sets `include=optional` for this folder only.
- **bun cannot load these configs.** bun's `bunx vitest run` fails while loading `vitest.config.*` with the same
  native-binding error; running the same command under Node works. bun also silently skipped the two Electron-related
  postinstalls it decided not to trust, which is the right default but means the binary step has to be explicit anyway.

## What it needs from mu

`@earendil-works/pi-coding-agent` is a `file:` dependency, used for **types only**: `RpcCommand`, `RpcResponse`, and
`RpcSessionState` come from pi, so a protocol change upstream fails `npm run typecheck` here instead of failing at
runtime. That means `packages/coding-agent/dist/index.d.ts` must exist — build the workspace before type-checking this
one.

The shell does **not** use pi's `RpcClient`, although it speaks the same protocol:

- `rpc-client.ts:94` spawns the literal command `node`, which a packaged app does not have on its PATH; the shell has to
  name the executable so that it can run the launcher on `process.execPath` with `ELECTRON_RUN_AS_NODE=1`.
- `rpc-client.ts:104` forwards the agent's stderr to the parent's stderr, which in Electron is the app's own log; the
  shell keeps the tail instead, because that is what the failure screen shows.

So `src/main/rpc.ts` is the protocol and `src/main/supervisor.ts` is the lifetime, both driven by injected dependencies
and covered by unit tests (`test/main/`).

## Layout

| Path | What it is |
| --- | --- |
| `src/main/harness.ts` | Where mu is: `MU_ROOT`/`KYRN_ROOT`, the packaged copy, a checkout beside this one, `mu` on PATH, a global install. Ported from the old shell's resolver; the five sources each have a test. |
| `src/main/security.ts` | The baseline, written down: the production and development policies, the window preferences, the preview session's rules. |
| `src/main/app-protocol.ts` | `app://mu/...` → a file in the build. Pure, and tested for traversal. |
| `src/main/index.ts` | The main process: scheme, policy, window, bridge, supervisor. |
| `src/main/ipc.ts` | The allow-list of channels and the payload checks. |
| `src/main/rpc.ts` | The JSONL protocol: numbered requests, routed responses, events. |
| `src/main/supervisor.ts` | Start, watch, restart three times with 0.5/1/2 s backoff, then fail with the stderr tail. |
| `src/main/agent-process.ts` | The only place a real child process is spawned. |
| `src/main/preview.ts` | The preview: a `WebContentsView` in its own partition, with nothing allowed. |
| `src/main/settings.ts` | Where the manifest and `mu.json` are, how strictly the manifest is parsed, and the atomic owner-only write. `applyChange` lives in `shared/` because the screen applies it too. |
| `src/main/consent.ts` | Reads `~/.mu/agent/consent.json`; granting runs `mu judge consent accept` in the harness, so the file is written by the code that reads it. Also the one place a harness subcommand (`mu ledger --json`) is run for a panel. |
| `src/preload/main.ts` | The typed bridge. No generic `invoke`. |
| `src/renderer/pages/Conversation` | Messages, streamed text, the composer and the stop button; an approval is a card that blocks the run. It opens into the session's existing messages, so a new window is not a blank chat. |
| `src/renderer/lib/conversation-store.ts` | Keeps React out of the token path: events are folded once per animation frame, `useSyncExternalStore` reads the result. |
| `src/renderer/panels/{Board,Judgments,Files}` | Three panels, three sources: the conversation's events twice, `mu ledger --json` once. No shared context. |
| `src/shared/conversation.ts` | The reducer: event in, state out. Pure, and where the conversation's behaviour is tested. |
| `src/shared/presentation.ts` | Presentation codes → the reader's language, with the harness's English as the fallback. |
| `src/renderer/` | React UI: state, composer, event log, and the failure screen. |
| `src/renderer/pages/Settings` | The settings screen, drawn from the harness's manifest. |
| `src/renderer/pages/FirstRun` | Language, consent, model, done. |
| `src/renderer/lib/manifest-renderer.tsx` | One control per manifest option kind; an unknown kind is shown read-only. |
| `src/shared/api.ts` | The one definition of the bridge, shared by main, preload and renderer. |
| `src/shared/settings.ts` | The manifest's shape, language lookup with fallbacks, and the rule a change has to pass. |

## Security baseline

Every item is explicit and has a test, because the old shell had none of them (it set `{preload, webviewTag: true}`
and no policy at all):

- The window loads from `app://mu` — a privileged, standard scheme — never `file://`.
- The Content-Security-Policy is a header on every response the scheme handler returns: `default-src 'none'`, no inline
  script, no remote anything, `frame-ancestors 'none'`. Development has its own policy that allows Vite's HMR.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`.
- `setWindowOpenHandler` denies every window; `will-navigate` only allows the app's own origin.
- The bridge is a fixed list of channels; frames that are not ours are refused, and payloads are validated
  (`harness:prompt` needs a message, `preview:open` needs http(s)).
- The preview runs in a separate session that grants no permission, starts no download, and follows only http(s).

`test/main/` covers the pure parts (119 tests, no Electron), including the conversation reducer and the presentation
table. The e2e suite (22 tests) covers what only a running app can show: the harness really starts, a missing harness
shows the error screen with `MU_ROOT` in it, the renderer has no `require`/`process`/`module`, the bridge has no generic
sender, the production policy is delivered *and* enforced (a violation is counted, and an injected inline script does not
run), an answer streams in and stops, an approval blocks and the answer reaches the harness, and the panels follow the
conversation.

The settings and first-run tests use `test/e2e/fixtures/harness/`: a stub that answers the JSONL protocol and
implements `judge consent accept|revoke` the way `kyrn/bin/mu.mjs` does, with a manifest this repository has never seen
(a feature with four option kinds, one of them from a "newer kernel"). If that renders, then a real kernel's new option
renders too. Each launch gets its own `HOME`/`USERPROFILE` and its own `--user-data-dir`, so no test reads this
machine's `~/.mu` or a previous window's language.

## Settings and the first run

- The screen is the **harness's** manifest, not this build's: a checkout carries `packages/kyrn-judge/manifest.json`, an
  npm install carries `judge/manifest.json`. Options, bounds, choices, defaults and the thirteen languages all come
  from it; the shell adds only its own chrome, in English, Chinese and Traditional Chinese, falling back to English.
- A change is checked against that manifest and written to `~/.mu/agent/mu.json` atomically and owner-only, keeping
  every key the shell does not understand. The harness picks it up on its next start, which is what the screen says.
- Consent is **read** here and **granted through the harness** (`mu judge consent accept`): the four-field record with
  its version belongs to the kernel, and a second copy in this repository would be wrong the first time that version
  changes. Refusing is a normal path — local judges keep working.
- The first run is language → consent → model → done. No key is required to get there; the wizard says where a key goes
  (`mu auth`) instead of blocking.

## Packaging and updates

`electron-builder.yml` builds the installable app for Windows (nsis), macOS (dmg + zip) and Linux (AppImage + deb);
`npm run build` output goes into the asar, and the harness ships beside it in `resources/harness/mu-agent`. The release
workflow (`.github/workflows/desktop-package.yml`) stages the npm package there with `kyrn/npm/build.mjs`, packages on
each platform, scans the artifacts for secrets, and keeps them; signing and notarization are the release credentials'
job (U10 wires the Windows certificate).

The updater **reports, and installs only what it can prove**. `src/shared/update.ts` parses the feed electron-builder
writes (`latest.yml`), compares versions properly (`1.10.0 > 1.9.9`, prereleases before their release), and refuses
anything it cannot verify: no `sha512`, no signature when one is required, a version that is not newer, a feed that is
not https on a release host. `src/main/update.ts` does the one network request, on demand, from the settings screen; a
build that cannot reach the feed says so with a sentence instead of pretending it is current. `MU_UPDATE_FEED` points a
build at another feed (a staging release, or the local server the end-to-end test uses).

Installing goes through `src/main/update-install.ts`: download to a temporary folder, check the file's SHA-512 against
the feed, check the detached Ed25519 signature against `UPDATE_PUBLIC_KEY`, and only then hand the file to
`src/main/update-launcher.ts`. Every refusal is a sentence on the screen and the running build stays usable. **This
build's `UPDATE_PUBLIC_KEY` is empty** — the release key is the owner's to add (U10) — so it refuses to install anything
it cannot verify, which is the test named "will not install what it cannot prove" in `test/e2e/update.spec.ts`.

The version shown in the window and compared against is this package's — not Electron's. `app.getVersion()` returns
Electron's own version when the app is started as `electron out/main/index.js` (which is exactly how the tests start
it), so `src/main/version.ts` reads `package.json` beside the build and falls back to Electron's answer only when there
is no package (a packaged app).

## Performance

Two numbers are products of the build, not test trivia, and both have a gate in `desktop-next`:

- **Size.** `npm run budget` measures `out/renderer`'s bundle and stylesheet, `out/main` and the whole build against
  `bundle-budget.json`: the renderer bundle may grow 2%, the rest 5%. Recorded: 629.7 KiB renderer, 6.3 KiB stylesheet,
  78.6 KiB main, 719.5 KiB total. The main bundle grew 4.3 KiB (74.4 → 78.6) when the window's permission handlers and
  the `web-contents-created` guard landed; the renderer bundle and the stylesheet came out byte-identical, so the budget
  was raised on purpose for that change rather than to hide a regression. A main-process change must end with
  `npm run build && npm run budget` — the budget reads `out/`, so a stale build measures the wrong code.
- **Startup.** `npm run startup` launches the built app three times against the fixture harness and measures spawn →
  window and spawn → the agent reporting it is running (the point the composer unlocks); it compares the p50 against
  `startup-budget.json` with a 40% tolerance *and* an absolute floor, because startup is the noisiest number here.
  Recorded: 212 ms to the window, 535 ms to usable. The measurement includes the first-run wizard's three clicks on a
  fresh profile — that is what a first launch costs a person.

## Not here yet

Packaging and the updater exist (`electron-builder.yml`, `src/main/update*.ts`, six-entry `desktop-package.yml`); the
gap is a code-signing certificate, so installers ship unsigned and the build's `UPDATE_PUBLIC_KEY` stays empty (U10).
Window chrome is the app menu removed (`Menu.setApplicationMenu(null)`) and nothing else: no tray, no custom title bar.
The renderer still has no unit tests — it is covered by `test/e2e` only. `desktop/` is untouched: it is the shipping app
until this one replaces it, and that replacement needs the profile-migration decision (B4).
