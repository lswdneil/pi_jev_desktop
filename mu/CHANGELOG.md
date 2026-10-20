# Changelog

What changed in each release of mu: the desktop app and the `mu` command line together. Releases are published under [Releases](https://github.com/qybaihe/mu/releases) with their downloads; the `mu-agent` npm package has its own, more detailed [changelog](kyrn/npm/CHANGELOG.md).

mu is in pre-release (0.1.x): names, settings and formats may still change between releases.

## [Unreleased]

### Fixed

- **A test failure that looked like an app bug was a port choice.** The new preview and navigation tests serve a page from
  a loopback server, and `server.listen(0)` can pick a port Chromium refuses outright (`ERR_UNSAFE_PORT`): one run landed
  on 1719 and failed with a message about the app being unable to load its own preview. `test/e2e/helpers/http.ts` now
  re-picks the port until it is one Chromium accepts, so both specs share the rule instead of each having its own server.
  Separately, the download-cancellation rule was tried end to end and could not be reached: Chromium refuses a download no
  user gesture asked for, `session.downloadURL` produced no `will-download` in this environment, and the probe hung; the
  test was removed rather than left flaky, and the rule stays covered by its unit test plus the fact that the same
  `hardenPreviewSession` call installs the permission handlers the end-to-end test does observe.
- **Every WebContents the app ever creates now gets the window and navigation guards, not just the two that existed.**
  The window and the preview each attached `setWindowOpenHandler` and `will-navigate` themselves; that is one forgotten
  attach away from a hole, which is exactly what the previous round found when a session was created and never hardened.
  `app.on("web-contents-created")` now applies `guardContents` to every WebContents, present and future, and the preview
  keeps its own http(s) navigation rule through a small registry so the app-wide guard does not overrule it. Two
  end-to-end tests hold it: a view created by the main process with no guards of its own stays where it was put when its
  page tries to navigate to `https://example.com`, and a link inside a previewed page still follows (which is what would
  break if the guard treated a preview like the app's page). The first test was checked against the guard's removal: with
  the hook deleted it fails, with it restored it passes.
- **The preview was not actually isolated: its session granted every permission and allowed downloads.** The rules were
  written (`previewPermission`, `previewDownload`, `previewNavigation`) and so was the function that applies them
  (`hardenPreviewSession`), but nothing called it: the view was created with a bare `partition` string, and Electron
  creates a session on demand for that — a session with no handlers grants what it is asked for. A page the agent
  opened in the preview could therefore ask for the camera, the microphone or the location and get it, and could start a
  download. An end-to-end test asking the previewed page what it had been given is what found it (it reported
  `geolocation: "granted"`); the view now takes the hardened session object itself rather than a partition name, so a
  string mismatch cannot put it on an unhardened instance either, and `test/e2e/preview.spec.ts` serves a local page,
  opens it through the app's own bridge, and asserts the page got nothing and lives in a session of its own. The unit
  tests of those pure functions had all been passing the whole time — the rules were right, the wiring was missing.
- **The shell's own page is denied every browser permission, and the type check is green again.** Electron grants a
  permission request when a session has no handler; the preview panel was hardened against that, but the window the app
  itself loads was not, so a page that asked for the camera, the microphone, the location or a notification would have
  been given it. The default session now denies everything (`appPermission`, one place, with a reason string that names
  the permission), on both the request and the check path, and two tests hold it there: a unit test over the permission
  list and an end-to-end test that asks `navigator.permissions` and expects no `granted`. Separately, `npm run
  typecheck` had been failing since the metrics collector was added — a test imports a `.mjs` with no declaration file
  (`TS7016`), which CI's shell job would have caught on its first run; `collect-metrics.d.mts` declares the one function
  the test uses.
- **An npm-installed `mu` can answer "where are my keys", and migrate them.** Two commands hand work to a kernel entry
  by path and only knew the kernel's `tsc` layout (`judge/dist/setup/*.js`); the package ships a flat bundle instead, and
  neither entry was ever bundled. So an installed `mu-agent` answered "this mu does not carry the kernel build that knows
  the store" for `mu doctor` and "needs the kernel build that ships with this mu" for `mu migrate --credentials`: honest
  about a missing file, wrong about the build. Both are now bundled (`judge/dist/secret-cli.js`,
  `judge/dist/credentials-cli.js`) and looked for there, and neither is given the source-url rewrite that would make its
  "am I the program being run?" check false. Verified on a real install of the packed tarball into a temporary prefix:
  `mu doctor --offline` reports `ok credentials file (0 keys)` and `mu migrate --credentials` runs ("nothing to move: no
  key in .env belongs to a judge"). A test (`scripts/npm-package.test.mjs`) compares the entries the package builds with
  every flat `judge/dist/*.js` the launcher and the doctor look for, so the two lists cannot drift apart silently again;
  the other entries (`auth`, `import`, `judge`, `ledger`, `setup`) were smoke-tested from the installed package and all
  print their usage instead of a module error.
- **Two eval tests were saying something nobody wrote, and a check now catches that class of damage.** Wording written
  with an em dash had been re-encoded on its way into `packages/evals/test/{runner,tasks}.test.ts`, so the comments held
  mojibake instead; both are repaired. The cause is a shell round-trip: on Windows, `Get-Content`/`Set-Content`
  re-encode UTF-8 as the console code page, and the result is still valid UTF-8 that still parses — so nothing failed.
  Three files in this repository have now lost text that way. `scripts/check-encoding.mjs` (`npm run check:encoding`,
  part of `npm run check`) fails on the replacement character and on the characters a wrong decode leaves behind, names
  the file, the line and the marker, and skips the two files that are allowed to look damaged: the check itself and the
  GBK fixture it is tested against. `AGENTS.md` gained the rule that produced the damage in the first place.
- **The new shell can be packaged, and the package that comes out runs.** The first real `electron-builder` build of
  `desktop-next/` failed on three things that no test could see, and all three are fixed: `electron-builder.yml`
  spelled `entitlementInherit` (the schema has `entitlementsInherit`), which made electron-builder reject the whole
  configuration on every platform; the shell's type-only dependency on `@earendil-works/pi-coding-agent` was a runtime
  dependency, so 243 MB of toolchain was packed into `app.asar` (729 KB now, and the archive has a budget); and the
  harness was copied into the app without the `node_modules` it declares, so the packaged agent exited with
  `Cannot find module 'jiti'` and never loaded its judge extension. The app now starts, walks its first run and reports
  `running · package`. Three gates keep it that way: `scripts/check-packaging.mjs` (in `npm run check`) compares the
  packaging configuration with the code and the workflow that depend on it and validates it against electron-builder's
  own schema when the packager is installed, `scripts/check-package.mjs --require-harness` inspects the built artifact
  (archive budget, harness present with its dependencies, no credentials files), and `desktop-next/scripts/
  smoke-package.mjs` launches the packaged app on Windows and fails if the agent does not come up. The packager is
  pinned (`electron-builder` 26.15.3, a devDependency) and CI installs from the lockfile, so a release is built by the
  version that was reviewed instead of whatever `npx` resolves that day.
- **The first real installer exists, one per architecture, and the release can sign it.** `mu-0.1.8-x64.exe` is
  116.7 MiB (122,392,598 bytes), installs to 402 MB, starts its agent, and uninstalls cleanly; `latest.yml` from that
  build parses through the app's own feed parser and matches the installer's SHA-512. Two more defects came out of it:
  a target that declared `arch: [x64, arm64]` made electron-builder build one **237 MB** combined installer that the
  feed then pointed every user at (the architecture now comes from the command line, one installer and one feed per
  arch, and the packaging job is a six-entry matrix), and nothing in the repository could produce the `<installer>.sig`
  files the updater demands — that was three `openssl` lines in the docs. `scripts/sign-installers.mjs` signs every
  installer in a folder with the project's Ed25519 key, verifies what it wrote, and has a `--check` mode; the packaging
  workflow runs it when `UPDATE_SIGNING_KEY` is set and uploads the `.sig` files. A test hands a signature the script
  made to the app's own `verifyArtifact`, so the release half and the app half cannot drift apart silently.
- **An installer upgrades over the previous version and keeps the user's work.** Rehearsed with two real builds
  (0.1.8, then the version bumped and built again): 0.1.9 installed into the same folder, `mu.exe`'s `FileVersion` moved
  0.1.8 → 0.1.9, the app came up as `v0.1.9` **without the first-run wizard** and with the session created before the
  upgrade still there, and uninstalling removed the folder and left no processes behind. The rehearsal also settled two
  facts worth writing down: the installer carries its version in the executable, and a detached `.sig` is bound to the
  exact bytes it was made for, so signing has to be the last step after packaging.
- **The release verifier's `--strict` no longer rejects a signed release.** `SHA256SUMS.sigstore.json` cannot be
  listed in the file it signs, so `--strict` reported the signature as an unverified file and failed a release that was
  correct. The checksum file and its signature are now excluded from the "unlisted file" check, the release job runs
  the verifier with `--strict` on `dist` so a payload the checksums miss stops the release, and the release notes no
  longer claim that the update feed files are covered by `SHA256SUMS` (they are not: they are what the app reads to
  find its next installer). A test now refuses a CI verification that carries `--repo` without `--require-proof`.
- **The script tests are green: 156 of 156.** Two of their three long-standing failures were one Windows bug in
  `scripts/coding-agent-consumer.mjs`: `spawnSync` with `shell: true` joins its arguments without quoting, so
  `C:\Program Files\nodejs\node.exe` was cut at the space and the child never ran (`'C:\Program' is not recognized`),
  which left two tests reading an empty error. The helper quotes each argument itself now, and a failed command reports
  its exit status or signal. The third failure was a test comparing a forward-slash path with Windows' own separators.

### Added

- **The documentation a reader follows is checked for links that go nowhere.** `scripts/check-links.mjs` (`npm run
  check:links`, in `npm run check`) resolves every relative link in the root documents, `docs/**` and `kyrn/**` — 60
  documents, about a thousand links — and fails with the file and line of any that has no target: headings and queries
  are stripped before the test, external links and bare fragments are skipped, and a link to a directory counts as long
  as the directory is there. Two scopes are excluded on purpose: `packages/*/CHANGELOG.md`, because a changelog is a
  record of layouts that have since moved (14 such links exist today, all historical), and `desktop/` with
  `evals/tasks/`, which are other projects' trees. The check passes today; it exists so the next edit to a README cannot
  ship a link that only fails after someone clicks it.
- **Every action the CI runs is pinned to a commit, and a gate keeps it that way.** 69 `uses:` references across 12
  workflows pointed at moving tags (`actions/checkout@v4` and so on): the tag can be repointed upstream, and whatever it
  points at runs with this repository's token. Each reference now names the commit the tag resolved to on 2026-10-18
  with the tag kept as a comment (`# v4`), and `scripts/check-workflows.test.mjs` fails a workflow that uses a tag,
  or a bare commit with no tag comment, while leaving local actions (`./…`) and container references alone. The pinned
  commits were spot-checked against the upstream history, and `durable-env.yml`'s two pre-existing SHA pins are
  unchanged.
- **CI can no longer name a script that does not exist, run an npm script nobody defined, or install fresh versions
  where a lockfile exists.** `scripts/check-workflows.test.mjs` now resolves every `node <path>` and `npm run <script>`
  a workflow mentions against the repository, honouring the `working-directory` the job or step declares (most of this
  repository's CI runs in `desktop/`, so `scripts/check-i18n.js` is correct there and missing at the root — the check
  knows the difference), and fails an `npm install` in a directory that has a `package-lock.json` unless it is
  deliberately unlocked. Two real gaps came out of it: `durable-env.yml` declared no token permissions at all (it inherits
  whatever the repository default gives, which is write on an older repository) and now asks for `contents: read`, and
  the shell's end-to-end job installed with `npm install`, so it exercised dependency versions the release would not
  ship; it now uses `npm ci --ignore-scripts`.
- **The shell's performance gates have their first numbers, and one of them fires.** `desktop-next/scripts/collect-metrics.mjs`
  launches the packaged app five times in throwaway home directories and writes the shape `node scripts/perf-budget.mjs
  --judge --result` consumes: cold start (launch to painted text, p50/p95), time to a running agent, idle memory of the
  app's whole process tree after 60 s, and installer size. First run, Windows x64: cold start p50 **248 ms**, p95
  **340 ms** (the 1.5 s gate is not close), agent running p50 **3.45 s**, installer **116.7 MB**, and idle
  **336.3 MB private / 555.4 MB working set** across the app's processes. `--trim disable-gpu` — the only non-radical
  remedy without a product redesign — leaves 257.2 MB, which is 76% of the idle number, so the pre-registered memory
  gate fires: `start-tauri-spike`, because the complaint survives the remedy. That is a decision input, not a decision:
  starting the two-week spike is the owner's call. `--breakdown` prints the split, which corrects an attribution made
  here a day earlier: the harness is the largest *single* process (130 MB of 336) but Chromium's processes together are
  ~200 MB, 60% of the total, so a cheaper harness helps without being able to clear the limit alone. Measured on its
  own, the harness is a 22 MB launcher plus a 98 MB `cli.js`; `-ne` saves 2 MB, and printing `--version` already costs
  83 MB RSS, so the cost is the CLI's import graph (the terminal UI loads in RPC mode too) rather than the session —
  which the repository's no-inline-imports rule rules out fixing with a lazy import. Two measurement mistakes are
  recorded in the script because they would otherwise be repeated: summing every process named `mu.exe` counted
  **four leftovers from an earlier session** (847 MB instead of 336 MB), and `EmptyWorkingSet` makes an idle app report
  6 MB, which is why the gate's trimming means product weight.
- **A preflight job, and a troubleshooting section for the shell.** `.github/workflows/preflight.yml` runs
  `node scripts/preflight.mjs --fast` on a runner that has what the kernel's suite wants (weekly and on demand), which is
  where the consolidated gate is supposed to pass — on a laptop without Chrome or sandbox permissions it stops at the
  kernel step for reasons unrelated to the change. `docs/troubleshooting.md` gained "The desktop shell": what the error
  screen means (including the difference between "mu was not found" and "the agent died"), why a setting needs a
  restart, what an update refusal says, that refusing consent is normal, that sessions survive the window, and how to
  check a failed end-to-end run's artifacts for secrets before attaching them.
- **A release preflight, and a test for a crashing agent.** `node scripts/preflight.mjs --fast` runs the gates a release
  needs that need no credential — the repository check, the script tests, the kernel and model-layer suites, the task
  benchmark's self-check — in an order that fails cheap first, and `--full` adds the shell: its unit tests, build, size
  budget, startup budget and end-to-end suite. It stops at the first failure and prints one summary of what passed, what
  failed and what each step was proving. Separately, an end-to-end test now covers the case the error screen exists for:
  an agent that starts and dies (`MU_FIXTURE_CRASH_ON_START=1`) — the window spends its retries, then says the exit code
  and the child's own last line. The Windows-only failure in `merge-update-info.test.mjs` was fixed on the way (the
  assertion compared a path with forward slashes against the platform's own).
- **Startup is measured, not assumed.** `npm run startup` in `desktop-next` launches the built app three times against
  the fixture harness and records two numbers: spawn → window (212 ms) and spawn → the agent reporting it is running
  (535 ms, the point the composer unlocks). It compares the p50 against `startup-budget.json` with a 40% tolerance and
  an absolute floor, because startup is the noisiest number in the repository and a shared runner answers slowly once
  in a while. The e2e workflow runs it after the build, next to the size budget.
- **The new shell can start a new conversation, and the build has a size budget.** A "New conversation" button asks the
  harness for a fresh session (`new_session`) and clears the window; the session before it stays with the harness. The
  desktop build now measures itself (`scripts/desktop-budget.mjs`, `bundle-budget.json`): the renderer bundle may grow
  2% and the rest 5% before the check fails, because bytes do not jitter and an app that quietly grows is how a download
  reaches 300 MB. Both run in the packaging and e2e workflows after the build.
- **The new shell renders the answer's Markdown.** Fenced code, headings, lists, quotes, inline code, bold and italic
  are rendered as structure instead of shown as backticks; everything else stays text. The parser (`shared/markdown.ts`)
  returns data and the view builds React elements from it, so a model that writes `<script>` gets a paragraph that says
  `<script>` — there is no path from a message's text to markup. The 200-message window moved next to the reducer
  (`visibleMessages`), where a long session's DOM bound is testable.
- **The new shell opens into the conversation it already has.** A window used to start blank even when the harness was
  holding a session; it now asks for the session's messages (`get_messages`) and shows them, with a live turn landing
  after the history instead of replacing it. Rows the harness records without text (a tool call, an empty assistant
  turn) are skipped, and seeding twice is a no-op — the shell can be reloaded without duplicating the conversation.
- **The workflows are checked by a test, and the release runbook covers the new shell.** `scripts/check-workflows.test.mjs`
  parses every file under `.github/workflows/` and asserts the things GitHub only tells you when the job runs: an `on:`
  trigger, `jobs` with `runs-on` and non-empty steps, `needs` pointing at jobs that exist, and no tab indentation. It
  found a real one immediately — a colon inside an unquoted `run:` scalar in `eval-nightly.yml` made GitHub reject the
  whole file, so the nightly task benchmark would never have run. `docs/releasing.md` now documents the new shell's
  release: the three update feeds, a detached Ed25519 signature per installer, where the public key goes, how to check
  the upgrade path, and what the installers' unsigned state means for SmartScreen. The packaging workflow also carries
  the signing gate: `signtool verify` on the Windows installer when the certificate secrets exist, a loud skip when they
  do not, and no upload either way without a verified signature.
- **Updates are only installed when they can be proven.** The shell downloads an update to a temporary folder, checks
  its SHA-512 against the feed, checks a detached Ed25519 signature against the public key it carries, and only then
  starts the installer; a build with no key (this one, until the release key is added) refuses to install and says why.
  A tampered artifact, an unsigned release, a downgrade or a feed that cannot be reached each end in a sentence on the
  settings screen, and the running build stays usable.
- **The new shell can be packaged, and it checks for updates.** `desktop-next/electron-builder.yml` builds nsis, dmg/zip
  and AppImage/deb artifacts with the harness beside them in `resources/harness/mu-agent`, a packaging workflow stages
  and packages on all three platforms and scans the artifacts for secrets, and the shell reads the release feed on
  request: `src/shared/update.ts` parses `latest.yml`, compares versions properly and refuses anything unverifiable (no
  sha512, unsigned when a signature is required, not newer, not https on a release host), while the settings screen
  says what it found. This build reports updates; installing them waits for the release signing. The window's version
  is now the package's — `app.getVersion()` returns Electron's when the app is started by file path, which made every
  build claim to be 44.9.0.
- **A coverage ratchet, and a secret scan for test artifacts.** `coverage-baseline.json` records the line coverage the
  kernel (87.18% over 222 files) and the model layer (85.94% over 194) have reached; `npm run check:coverage` fails a
  change that goes below it and names the files that lost the most, and on a pull request every changed source file must
  be at or above 60% and have a coverage entry at all. The shell's end-to-end tests now run on Linux in two shards
  (`.github/workflows/desktop-e2e.yml`), and before a failed run uploads its trace, `node scripts/check-artifacts.mjs`
  scans the artifacts for credentials files and key-shaped strings — a trace that carries a key has already leaked it.
- **A task benchmark.** `evals/tasks/` holds six small repositories whose own tests fail, and
  `npm run eval:tasks` runs them: `--self-check` proves every judge is red before its reference fix and green after,
  `--executor faux` exercises the machinery offline, and `--executor agent --arm … --model … --budget …` runs the real
  command line against each task in four arms — kernel off, active, shadow, and not consulted. The judge is the
  repository's own test command, never a model's opinion of its own work. Reports land in `docs/evals/reports/` as
  Markdown and JSON; `.github/workflows/eval-nightly.yml` runs the honest check and the faux arms on every push, and the
  real arms nightly when a key is configured (skipped, not failed, without one).
- **The new shell holds a conversation.** `desktop-next/` folds the harness's event stream into a conversation with a
  pure reducer (`shared/conversation.ts`): streamed text appears as it arrives, tool calls become rows of their own, and
  the two thousandth message costs no more than the first because only a window of messages stays mounted. A question
  the harness is blocked on (an approval, a select, an input) becomes a card that cannot be clicked away, and the answer
  travels back as the protocol's own `extension_ui_response`. Three panels sit beside it, each on its own source: the
  board and the files from those events, the judgments from `mu ledger --json`. Lines the harness marks with a
  presentation code are translated by code and shown in English when this build does not know the code.
- **The new shell's settings are the harness's own manifest.** `desktop-next/` draws its settings screen from
  `manifest.json` of the harness it is attached to: every feature, option kind, bound, choice and decision point, in the
  languages the kernel ships. A kernel that adds an option gets it drawn without a change in the shell, and an option
  from a newer kernel is shown read-only instead of disappearing. A change is validated against the same manifest and
  written to `mu.json`; the screen says it takes effect when the agent restarts. The first run is language, consent,
  model, done — with refusing consent and having no key both normal paths, since local judges keep working either way.
- **A licence check and a generated third-party inventory.** `node scripts/license-check.mjs` (in `npm run check` and
  its own CI job) fails when a package manifest declares no licence, when `desktop-next/` carries an MIT header, when a
  new file has no SPDX header, or when [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) no longer matches the
  lockfiles. That file lists the 321 npm components mu ships, generated by `node scripts/third-party-notices.mjs
  --write`, so a dependency cannot be added without its licence being written down.
- **A new desktop shell**, `desktop-next/`: a small Electron app instead of the frozen AionUi fork (159k lines).
  Its window loads from `app://mu` rather than `file://`, so a Content-Security-Policy applies to it; the renderer is
  isolated and sandboxed, and the page can only call named capabilities — there is no generic IPC channel. The agent
  is a supervised child process: its stderr is kept for the failure screen, and a crash is retried three times before
  the window says where mu should have been. Apache-2.0, with AionUi's notice kept in `desktop-next/NOTICE`.

- **`mu migrate --credentials`.** Moves the keys in `.env` into the credential store, which is where `mu` now
  reads them: the file keeps a note and a backup of what it had, and a key only mu reads is removed from it.
  A key pi also uses (`AI_GATEWAY_API_KEY`, `TYPESAFE_API_KEY`, …) is copied but left in the file, because pi
  reads the same variable with its own credentials; `--rewrite-env` drops it for someone whose key is in the
  shell environment. `--dry-run` prints what would happen and writes nothing. `auth.json` is left alone: pi
  cannot read mu's store, so moving a key out of it would sign the user out.
- **`mu doctor` says where the keys are.** One row names the store in use (the system keychain, the encrypted
  file or plaintext), how many keys it holds and whether any of them fell back to plaintext — the answer to
  "did my key go somewhere I can find it".
- **Keys stored by mu reach the judge before the first decision.** The session resolves them once at start into
  the environment the judge is built with, so a key in the store behaves like one in the environment, and an
  explicitly set variable still wins.
- **A `.env` value may reference another variable.** `$VAR` and `${VAR}` are resolved when a session starts,
  from the environment or from an earlier line of the same file; a reference to something unset stays as
  text rather than becoming an empty key. `mu doctor` uses the same rule to decide whether a key is set, so
  a reference that cannot resolve is no longer reported as configured.
- **`mu.json` has a `schemaVersion`.** A file from an earlier mu is migrated on the next start, with the
  file it replaced kept as `mu.json.bak`; a file from a newer mu is refused with a message instead of being
  half-understood. The schema and what each version means are in [compatibility.md](docs/compatibility.md).
- **Releases are verifiable.** Each release now carries a CycloneDX SBOM (`sbom.cdx.json`), a keyless
  signature over `SHA256SUMS` (`SHA256SUMS.sigstore.json`) and a GitHub build attestation. `node
  scripts/verify-release.mjs <folder> --repo qybaihe/mu --require-proof` checks all three, and the release
  job runs it before publishing.
- **A mistyped setting is now reported.** An unknown key, a judge type that does not exist and a mode that
  is not `off`/`shadow`/`active` used to be dropped in silence; `mu` says which line it could not read.
- **Three decision points**, 38 in all:
  - `tool.injection`: results of `web_fetch`, `web_search`, the built-in browser and MCP servers are screened passage by passage; passages carrying instructions aimed at the AI are withheld from the model, with a note where each was. The question's wording comes from [hermes-jev-skills](https://github.com/kerpopule/hermes-jev-skills) (MIT).
  - `turn.continue`: a run that ends on "Let me run the tests next" without doing it, or asks for a go-ahead on work you asked for, is sent back to it; at most twice per message, and never toward a step that is hard to undo. After [oh-my-pi](https://github.com/can1357/oh-my-pi)'s unexpected-stop check (MIT).
  - `judge.items`: a `judge_items` tool the model uses to ask Jev one yes/no question about each of many items (files, log lines, findings), with a probability per item.
- **A judge with no setup.** With no Jev key set, the free Jev on OpenCode Zen answers, and mu says so once a day; set a key and mu uses it from the next question.
- **Classifier models as judges**: `classifier:<provider>/<model>` takes any classifier in pi's model catalog, such as Jev on OpenCode Zen or Cloudflare Workers AI and Cloudflare's Clef. The desktop app's judges page offers them.
- Built on pi 1.0.2.

### Changed

- **Files mu writes are owner-only.** `.env`, `mu.json`, `models.json` and `auth.json` are written with mode
  0600, and a file that was already world-readable (a `.env` created at 0644, which every rewrite kept) is
  tightened on the next write. On Windows the mode bits are not what enforces this; the credentials work in
  progress is what will.
- **Decisions act by default.** Every decision point is `active` unless `mu.json` says otherwise; before, a fresh install only recorded verdicts. To keep recording only, set `"modes": { "default": "shadow" }` in `~/.mu/agent/mu.json`.
- MCP servers run on pi's built-in client. mu keeps what it adds: servers stay hidden until a task needs them, project servers need your approval, their output is screened and credentials are masked.

### Fixed

- `mu install`, `mu list`, `mu config` and pi's other commands run again instead of being sent to the model as a prompt ([#8](https://github.com/qybaihe/mu/issues/8), [#9](https://github.com/qybaihe/mu/pull/9) by [@nyxmoth](https://github.com/nyxmoth)).
- Sub-agent status no longer crashes the terminal UI in a window narrower than the status line ([#7](https://github.com/qybaihe/mu/issues/7)).
- Closing an MCP server that is still starting stops its process.

## [0.1.6] - 2026-09-30

### Changed

- **Conversations run on mu directly.** The desktop app starts mu in a process of its own and talks to it over one typed stream; the conversation list is mu's own session files, so a session started on the command line shows up in the app and the other way round.

### Added

- In the app: fork from any message, rename, pin, mark unread, archive and delete conversations, the goal line and the context ring above the send box, a queue of steering and follow-up messages you can take back, the images you sent shown in your messages, and the source tab.

### Fixed

- A message to a conversation whose folder is gone says so. A title never shows a key pasted into a message. Every thinking level of a model shows in the picker.
- A run you stop ends as stopped, not failed.

## [0.1.5] - 2026-09-27

### Added

- **Start with an API key.** The first-run guide and `mu setup` recognise the service from the key's shape, check the key with one request, and pick a model to start with ([#3](https://github.com/qybaihe/mu/issues/3)).

### Fixed

- Windows: the app installed in `C:\Program Files\mu` can start mu ([#4](https://github.com/qybaihe/mu/issues/4)).
- mu in the app follows the system's proxy when no `HTTPS_PROXY` is set, as do sign-in and the key check.
- macOS: a conversation no longer puts a bouncing icon in the Dock.

## [0.1.4] - 2026-09-25

### Added

- Choose how Jev is reached (TypeSafe, OpenRouter, the Vercel AI Gateway or your own service), each with its own key; CLM as a judge.
- Providers with an `http://` address on your computer or network, and editable thinking levels per model ([#1](https://github.com/qybaihe/mu/pull/1), [#2](https://github.com/qybaihe/mu/pull/2) by [@drunkduckdrown](https://github.com/drunkduckdrown)).
- Light and dark themes that follow the system; more of the app in your language; `/hive <question>`.

### Fixed

- Many permission, conversation, browser and Windows fixes; mu asks before more kinds of risky commands and keeps credentials away from the judge and the board. Built on pi 0.87.1.

## [0.1.3] - 2026-09-23

### Added

- The app updates itself, after you agree to the download.

### Fixed

- Windows: answering a permission request no longer breaks the conversation; a missing Git for Windows is reported with its download link.
- mu starts on small servers (about 50 MB of heap).

## [0.1.2] - 2026-09-23

Preview build.

## [0.1.1] - 2026-09-23

Preview build.

## [0.1.0] - 2026-09-23

The first preview: the desktop app for macOS (signed and notarized), Windows and Linux, x64 and arm64, with mu inside it, and `mu-agent` on npm.

[Unreleased]: https://github.com/qybaihe/mu/compare/v0.1.6...main
[0.1.6]: https://github.com/qybaihe/mu/releases/tag/v0.1.6
[0.1.5]: https://github.com/qybaihe/mu/releases/tag/v0.1.5
[0.1.4]: https://github.com/qybaihe/mu/releases/tag/v0.1.4
[0.1.3]: https://github.com/qybaihe/mu/releases/tag/v0.1.3
[0.1.2]: https://github.com/qybaihe/mu/releases/tag/v0.1.2
[0.1.1]: https://github.com/qybaihe/mu/releases/tag/v0.1.1
[0.1.0]: https://github.com/qybaihe/mu/releases/tag/v0.1.0
