# Performance budget

What mu measures, what it refuses to guess, and the numbers that would justify replacing the desktop shell.
The rule this file exists for: **measure before rewriting.** A new shell is a 3–5× UI cost, and it can only
move the parts of the latency that belong to the shell — not the model, not the judge.

```bash
npm run perf            # compare the probes with the committed baseline
npm run perf:update     # after a deliberate change, and say why in the PR
node scripts/perf-budget.mjs --judge   # Phase 2; says what is still missing
```

## Phase 1: the shell-independent costs (measured now)

These run offline, with no desktop app, on the same Node the app bundles. They answer "could a different
toolkit change this at all?".

| Metric | What it is | Baseline (node 24, win32-x64) |
| --- | --- | --- |
| `transcript.jsonl.encode` | one JSON object per line, 10 MB transcript, 20 samples | ~10 ms |
| `transcript.jsonl.decode` | parsing that back | ~10 ms |
| `transcript.cbor.encode` | the same transcript as CBOR (`packages/protocol/src/cbor`) | ~60 ms |
| `transcript.cbor.decode` | decoding it | ~13 ms |
| `message.markdown.render` | one assistant message (heading, list, highlighted code block), ×20 | ~1.2 ms |
| `stream.render.per-byte` | the same message re-rendered once per byte | ~19 ms |
| `stream.render.chunks-of-64` | re-rendered once per 64-byte delta | ~0.3 ms |
| `transcript.jsonl.bytes` / `.cbor.bytes` | size on the wire | 10.49 MB / 10.07 MB |

What this already says:

- **A shell switch would not move the transcript cost.** Both codecs are plain JavaScript, and the current one
  (JSONL) is *faster to write* than the CBOR encoder in this tree by about 6×, for a 4% size win. CBOR buys
  nothing here until its encoder is rewritten; that is a `packages/protocol` task, not a shell task.
- **Batching is worth more than any toolkit.** Rendering per byte costs 19 ms for one message — more than a
  16.7 ms frame — while rendering per 64-byte delta costs 0.3 ms. Any shell that streams per token and
  redraws per fragment will drop frames regardless of what it is written in.
- **Markdown rendering is not the bottleneck.** At ~1.2 ms per message (with code highlighting), a screenful
  of history is a fraction of a frame.

The limits are the kernel benchmarks' limits (`scripts/bench-gate.mjs`): the same-Node-major comparison, the
same noise floor, and 30% instead of 20% because shared CI runners are noisier than a developer's machine. A
metric below the noise floor can only be reported, never gated.

## Phase 2: the numbers that need a shell (after U19/U22)

Three of these are now measured on the packaged app by `desktop-next/scripts/collect-metrics.mjs`, and the renderer's
own costs by `desktop-next/scripts/render-probes.mjs`; together they write the two files `scripts/perf-budget.mjs
--judge` consumes:

```bash
cd desktop-next && npm run package -- --win --x64     # the artifact a user installs
npm run metrics -- --runs 5 --idle-seconds 60 --trim disable-gpu   # writes shell-metrics.json
npm run render-probes                                              # writes render-probes.json
cd .. && node scripts/perf-budget.mjs --judge --result desktop-next/shell-metrics.json --render desktop-next/render-probes.json
```

First token → first frame and true input latency still need a recorded session replay and a real input method, so they
are **not** measured. A number that was never measured is `cannot-judge` (exit 2), never a pass: the judge lists what is
missing rather than quietly having one fewer gate.

| Metric | How | Gate that starts a time-boxed spike (2 weeks) |
| --- | --- | --- |
| Idle RSS, harness included, after 60 s | each shell, same conversation | > 250 MB **and** trimming does not get 30% back |
| Cold start p50/p95, 10 runs | launch to first frame | p95 > 1.5 s |
| Scroll p95, 5 000-conversation session | scripted scroll | p95 > 25 ms |
| First token → first frame | recorded session replay | reported, not gated |
| Input latency p95 | keystroke to glyph | reported, not gated |
| Installer size / update download | the built artifacts | > 180 MB, or > 120 MB after trimming |
| No-install runtime requirement | product question | a concrete requirement (USB, locked-down machines) |

**Measured, 2026-10-18, Windows 11 x64, packaged build, 5 launches (three runs of this measurement: 245–248 ms p50,
333–336 MB private):** cold start **p50 248 ms / p95 340 ms** (window 193 ms), so the 1.5 s gate is four times away and
does not fire. The agent reports running after **p50 3.45 s** — that includes starting the harness, it is reported
rather than gated, and it is the number to watch when the first-run path feels slow.

Idle after 60 s with the harness running and no conversation: **336.3 MB private / 555.4 MB working set** across 6–7
processes, against the 250 MB limit. The trimmed run (`--trim disable-gpu`, the only non-radical remedy available
without a product redesign) leaves **257.2 MB private / 521.6 MB working set**, which is 76% of the idle number — more
than the 70% the gate tolerates. So `--judge` **fires the gate**:

```
start-tauri-spike
  because idle RSS 336.3 MB is over 250 MB and trimming leaves 257.2 MB (more than 70% of it)
```

This is the pre-registered rule doing what it was written to do, and it is a decision **input**, not a decision: the
plan says a fired gate starts a two-week, time-boxed spike whose acceptance is ±10% of Electron on text rendering,
input-method handling, font fallback, CBOR IPC and large-list scrolling (`SHELL_GATES.spikeToleranceRatio`), and
whether to spend those two weeks is the owner's call.

**Measured again, 2026-10-19, same machine, current build, 5 launches:** cold start **p50 263 ms / p95 456 ms**
(window 213 ms — still four times under the gate), agent running **p50 3.451 s**, idle **338.7 MB private / 558.2 MB
working set**, and the trimmed run (`--trim disable-gpu`) **257.3 MB private / 519.2 MB working set** — **76%** of the
idle number, so `--judge` still fires:

```
start-tauri-spike
  because idle RSS 338.7 MB is over 250 MB and trimming leaves 257.3 MB (more than 70% of it)
```

The per-process split changed with the build, and it changes the sentence below: one 60 s idle launch now measures GPU
**106.1 MB**, harness **88.6 MB**, main **72.7 MB**, renderer **35.7 MB**, harness launcher **19.7 MB**, utility
**11.9 MB** and a second main process **4.1 MB** — Chromium's processes together are **153.7 MB, 45% of the total**.
The largest *single* process is now the GPU process, with the harness second; the earlier record (harness 130 MB, GPU
81 MB) had it the other way round. So "make the harness cheaper" is neither sufficient nor the first thing to look at.

**Where the memory is.** The total alone invites the wrong remedy, so the collector prints the split
(`npm run metrics -- --breakdown`), and the answer corrects a claim made earlier in this file: Chromium is the larger
half. One 60 s idle launch, per process (2026-10-18 record): harness **130 MB** (a 110 MB CLI plus a 20 MB launcher),
GPU **81 MB**, main **79 MB**, renderer **28 MB**, network utility **12 MB** — so the harness is the largest *single*
process while Chromium's processes together are about **200 MB, 60% of the total**. Two consequences: making the harness cheaper
helps but cannot get under 250 MB on its own (a harness that cost nothing would still leave ~200 MB), and the trimming
tried above (GPU off, 257 MB) is a rendering trade rather than weight removal.

**What the harness's 130 MB is.** The 2026-10-19 measurement puts harness + launcher at **88.6 MB** (plus the
separate 19.7 MB launcher process), so the absolute number moves with the build; the decomposition below is the
2026-10-18 record of where it went. Measured on its own, outside the app: the launcher (22 MB) starts
`dist/bundle/cli.js` (98 MB) and exits with it when stdin closes, so there are no orphans. `-ne` (no extensions) saves
2 MB, so the judge extension is not the cost. Loading the bundle far enough to print `--version` already costs
**83 MB RSS / 24 MB heap**, and the separate `rpc-entry.js` entry has the same floor (85 MB), so the price is the
import graph — the terminal UI and its dependencies are loaded even in RPC mode — not the session. Cutting it means
splitting that graph so RPC mode has its own entry, which is a build-and-entry change in `packages/coding-agent`; the
repository's rules forbid inline or dynamic imports, so it cannot be done with a lazy `await import()`. That is the
main thing a spike should be compared against: a harness whose RPC entry does not load the UI, measured here, before
any runtime is replaced.

Run-to-run variance is real and worth stating: three 5-launch runs gave 333–336 MB private for the shipped build, and a
single-launch 15 s run gave 370 MB (GPU 106 MB instead of 81 MB), so treat ±10% as noise and never judge a gate on one
number.

The gap between `desktop-next/scripts/startup.mjs` (dev build, fixture harness: window 212 ms, ready 535 ms) and this
one is the subject: the packaged app carries the real harness, a first-run wizard and asar loading, and takes 3.5 s to
a running agent instead of 0.5 s.

**Installer, same build:** the Windows x64 NSIS installer is **116.7 MiB** (122,392,598 bytes), and it installs
to **402 MB** on disk (494 files, Electron runtime included) and uninstalls cleanly. So the installer gate does not
fire. It nearly did for the wrong reason: `win.target` declared `arch: [x64, arm64]`, so electron-builder built one
combined installer of **237 MB** and the feed's `path` sent every user to it. The architecture now comes from the
command line (`--win --x64`), one installer and one feed per architecture, and `scripts/check-package.mjs` fails an
installer over the 180 MB budget so that a change back to a combined installer is a decision, not an accident.

**Spike acceptance, encoded before it starts:** the candidate runtime has to match the Electron baseline
within **±10%** on text rendering, input-method handling, font fallback, CBOR IPC and large-list scrolling —
Linux WebKitGTK included. Missing any of them ends the spike with `stay-on-electron`, written up with the
numbers that ended it.

**The renderer numbers that acceptance compares against (2026-10-19).** Five of those dimensions had no
measurement on this side, so "match Electron within 10%" could only have been argued after the fact. `npm run
render-probes` (in `desktop-next`) starts the built app against the fixture harness with a **5,000-message
session** — the size the scroll line names — and measures the window, writing `desktop-next/render-probes.json`:

| What the spike must match | Measured here |
| --- | --- |
| Large-list scrolling, main-thread work per step | **0.1 ms p95** (0 ms p50; frame delta 16.6/16.8 ms is vsync, not code) |
| Text rendering: re-enter a 200-row conversation in a 5,000-message session | **48 ms p50 / 51 ms p95** to 200 rows on screen |
| Font fallback, first CJK+emoji paint | **80.1 ms** for the first paint, **0.1 ms p95** after the fallback fonts are resolved |
| IPC round trip over the preload bridge (`app.version`) | **0.1 ms p50 / 0.2 ms p95** |
| Input method: synthesized composition then commit (DevTools protocol) | **45 ms p50**, composition visible, committed text kept |

Three things to read out of it. Scrolling costs nothing **because the window mounts a bounded 200 rows and
nothing re-renders while scrolling** — so that gate catches a rewrite that re-renders rows per scroll event,
which is the usual way a port gets slow, and it cannot be beaten by a vsync trick. The 80 ms first CJK paint is
the number most likely to move on another engine (a different font stack, and on Linux a different set of
fallbacks), so it is the first thing the spike should measure rather than the last. And the composition probe
is a **synthesized** composition, not a real IME: it proves the controlled textarea keeps a committed
composition, not that a real input method feels right, and the spike's own IME check needs a person.

**A gate with no number is `cannot-judge`, not a pass.** `--judge` used to compare `undefined > 250`, which is
false: an idle-memory number that was never measured read exactly like a healthy one. It now needs both files
(`--result` for the packaged app, `--render` for the renderer), prints `cannot-judge` with the list of what is
missing, and exits **2** — a decision that was not reached is not a green run. A gate that already fired still
wins, because the spike decision does not wait for the rest.

## Baseline file

`bench/desktop/baseline.json` follows C6 (`docs/plans/production-readiness/04-CONVENTIONS.md`): the same
envelope as the kernel benchmarks, one `metrics` entry per probe with `p50`, `p95`, `samples` and a `budget`
(the measured value plus the tolerance). It records the Node version and platform it was measured on; a run on
another platform compares but says so.
