# Troubleshooting

Start with `spec doctor` (or `/doctor` in a session): it checks the installation, the model, the judges and the connections, and says what to fix. The desktop app's logs are one click away in Settings → About.

If none of this helps, [open an issue](https://github.com/lswdneil/pi_jev_desktop/issues/new/choose) with the version, the platform and the `spec doctor` output.

## Installing and starting

**`spec.ai.jev needs Node >= 22.19 (found v20…)`.** The command line needs Node.js 22.19 or newer: `nvm install 24`, or your system's package. The desktop app carries its own and needs nothing.

**Windows shows a SmartScreen warning.** The Windows builds are not code-signed yet. Choose "More info" → "Run anyway". The checksums of every download are in `SHA256SUMS` on the release page.

**Windows: the conversation says Git for Windows is missing.** spec.ai.jev runs commands in a POSIX shell on Windows; install [Git for Windows](https://git-scm.com/download/win) and start a new conversation.

**The app installed in `C:\Program Files\spec.ai.jev` cannot start spec.ai.jev.** Fixed in 0.1.5 ([#4](https://github.com/lswdneil/pi_jev_desktop/issues/4)): install the latest release over the old one; your data stays.

**`spec install`, `spec list` or `spec config` starts a session instead.** Fixed after 0.1.7 ([#8](https://github.com/lswdneil/pi_jev_desktop/issues/8)), in the next release; a checkout of `main` has it now.

## Models and networks

**No model is set up.** Run `spec setup`, or the app's first-run guide: paste an API key or sign in with a subscription.

**"User location is not supported", or requests time out, in the app but not in a terminal.** The model's service refuses your network's region, or the app does not see your proxy. Since 0.1.5 the app follows the system proxy when `HTTPS_PROXY` is not set; check that the proxy is on, or set `HTTPS_PROXY` for spec.ai.jev.

## The judge

**The judge seems to do nothing.** A point in shadow records its verdicts and changes nothing, and one that is off is not asked. `/status` shows each point's mode; look for `"default": "shadow"` or `"off"` in `~/.spec.ai.jev/agent/agent.json`, or a `SPEC_AI_JEV_JUDGE_MODE` in your environment. See [Getting started](getting-started.md#decisions-and-their-modes).

**"No judge is available yet, so spec.ai.jev asks about each step."** In the *Jev approves* permission mode, spec.ai.jev asks you about every step that needs approval when no judge can answer: no key and the free Jev unavailable, an exhausted account, or only a local judge, which is not trusted with approvals. Set a Jev key (`spec setup`), or switch the permission mode with `/permissions`.

**The free Jev stopped answering.** It is OpenCode Zen's limited-time offer; spec.ai.jev says so when it ends. Set a key for one of the [Jev services](judges.md#hosted-jev), or choose another judge.

**Verdicts are slow.** Every decision point has a wait limit, after which spec.ai.jev carries on without the verdict; nothing blocks for long. `spec ledger --json` shows each verdict's latency. A judge far away on the network, or a busy one, can be replaced per point with `routes`.

**The local judge wants to download a model.** Laya's model is several hundred megabytes; spec.ai.jev downloads it only after you agree, in `spec judge setup` or in the app.

## The terminal UI

**The terminal UI crashes with "Rendered line … exceeds terminal width" when a sub-agent starts.** Fixed after 0.1.7 ([#7](https://github.com/lswdneil/pi_jev_desktop/issues/7)). Until the next release, widen the terminal past the status line.

## When spec.ai.jev exits unexpectedly

**Where the reason is.** `~/.spec.ai.jev/agent/crashes.json` keeps the last five records (seven days are announced on the next start). Each record says what happened, in which mode, on which platform, which session file, and — for a failure that a budget ended — which part ran out: `timeout` (a network or budget question), `aborted` (something cancelled it), `user-data` (a file, a setting or a command spec.ai.jev could not use), `internal` (a bug worth reporting).

**A promise failed and nothing handled it.** spec.ai.jev records it, prints one line to stderr and **keeps going**: the session is still there, one operation was lost. Before, that ended the process in every mode but the interactive one.

**Exit codes.** 0 is a normal end. 1 means the same call may work later, or after the input is fixed (timeout, cancellation, unusable data). 2 means spec.ai.jev itself is wrong. 129 means the terminal went away, not spec.ai.jev.

**Nothing secret is in the record.** Messages and stacks are written through the same redaction the judge uses: keys in a recognizable shape, values under a credential's name, `Authorization` headers and passwords in URLs become `[redacted]`. If you report a crash, the record is safe to attach.

**A shutdown step hangs.** An extension, an MCP server or a hook that does not finish its disposal gets three seconds; after that spec.ai.jev exits with 1 and records `shutdown_timeout`, instead of sitting there with the terminal in raw mode.

**Getting the session back.** The conversation is in the session file the record names; `spec.ai.jev -c` continues the most recent one.

## The desktop shell

The new app (`desktop-next/`) says most things on screen, so the first move is to read the window rather than the log.

**"The agent could not start".** The screen names the folder the app looked in. `SPEC_AI_JEV_ROOT` is authoritative: set it to a
spec.ai.jev checkout and press Retry. A packaged app expects spec.ai.jev inside its own `resources/harness/spec-ai-agent`, so a build that
skips that step shows the same screen. If the agent *started* and then died, the screen keeps the exit code and the last
lines the agent wrote — that tail is the part worth reporting.

**"the agent exited with code 1" with `Cannot find module` in the tail.** The packaged app carries the harness but not
always the harness's own dependencies: a `spec-ai-agent` folder installed by npm gets `jiti`, `chord` and `photon-node` from
npm, while the app carries a plain folder. `jiti` is what loads the judge extension, so the agent starts, cannot load
it, and exits. A release build installs those dependencies into the staged folder (`.github/workflows/
desktop-package.yml`); a local `--dir` build needs `npm install --omit=dev --ignore-scripts` inside
`.artifacts/desktop-harness/spec-ai-agent` before packaging. `node scripts/check-package.mjs desktop-next/dist
--require-harness` reports exactly this before anyone installs anything.

**The app restarts the agent twice before it gives up.** An agent that dies immediately is retried after 0.5 s, 1 s and
2 s; after that the window stays on the error screen with what it captured. "Restart agent" in the header starts the
attempts over, so fixing the cause and pressing it is enough.

**A setting did nothing.** Every change is written to `~/.spec.ai.jev/agent/agent.json` and the harness reads it when it starts, so
the screen says "Restart the agent to apply this". Nothing is written that the running harness's own manifest does not
describe, and an option from a newer kernel is shown read-only rather than hidden.

**Updates.** The settings screen reports a feed's verdict in words: no checksum, no signature, not newer, or unreachable
are all refusals, not failures. This build refuses to *install* anything it cannot prove — an empty `UPDATE_PUBLIC_KEY`
means exactly that. `SPEC_AI_JEV_UPDATE_FEED` points a build at another feed (staging, or a test's local server).

**Consent.** Refusing the keyless remote judge is a normal answer: local judges keep working and nothing is sent
anywhere. Grant or revoke it again from Settings.

**Sessions survive the window.** The app opens into the session the harness already holds; "New conversation" starts a
fresh one and leaves the previous one with the harness (`spec.ai.jev -c` still finds it).

**Collecting evidence from a failed end-to-end run.** `desktop-next/test-results` and `playwright-report` hold the trace
and a page snapshot. Before attaching them, run `node scripts/check-artifacts.mjs desktop-next/test-results
desktop-next/playwright-report`: it fails on a credentials file or a key-shaped string. The app's own traces are
recordings of everything the page did, which is why that check exists.

## Sending a diagnostic bundle

For a crash, a hang, or a verdict that looks wrong, one archive answers most of what a maintainer would ask:

```bash
spec doctor --bundle --dry-run   # list exactly what would go in it, write nothing
spec doctor --bundle             # write bundle-<time>.tar.gz (under ~/.spec.ai.jev/diagnostics by default)
```

What is in it: versions (spec.ai.jev, pi, the kernel), platform and Node version, which settings **exist** (names only,
never values), whether each judge variable is set (true/false, never the value), the recent verdict summaries
(ids, latency, tokens, reason, state digest — not the prompt, the output or the verdict text), the crash
records, and the tail of the telemetry log.

What is never in it: `.env`, `auth.json`, `models-store.json`, session transcripts, and every setting value.
Every text also runs through the same redaction the judge uses. The manifest lists the omissions, so you can
check the claim instead of taking it on faith — open the archive once before attaching it.

## Starting over

`spec setup` copies every file it changes to `~/.spec.ai.jev/backups/<time>/` first. To reset spec.ai.jev's own settings, move `~/.spec.ai.jev/agent/agent.json` away; spec.ai.jev starts with its defaults. Sessions, sign-ins and lessons are separate files (see [Getting started](getting-started.md#where-things-live)) and stay.
