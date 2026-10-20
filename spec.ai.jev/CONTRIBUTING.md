# Contributing to spec.ai.jev

Thank you for helping. Bug reports, fixes, new decision points, measurements of judges, translations and documentation are all welcome, from anyone, in English or Chinese.

> **中文简介**：欢迎用中文提 issue 和 PR。报 bug 请用 Bug 模板，写清版本、系统和复现步骤；想加功能或新判定点，先开 issue 讨论；提交前在本地跑 `npm run check` 和 `./test.sh`（改了桌面端再跑 `desktop/` 里的检查），PR 模板里的清单逐条确认即可。下面是完整说明。

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Ground rules](#ground-rules)
- [The repository](#the-repository)
- [Setting up](#setting-up)
- [Checks and tests](#checks-and-tests)
- [Code style](#code-style)
- [Commits and pull requests](#commits-and-pull-requests)
- [Larger changes](#larger-changes)
- [Dependencies](#dependencies)
- [Upstream: pi and AionUi](#upstream-pi-and-aionui)
- [License of contributions](#license-of-contributions)

## Ways to contribute

- **Report a bug** with the [bug report form](https://github.com/lswdneil/pi_jev_desktop/issues/new?template=bug_report.yml). A short report with the version, the platform and the steps to reproduce it is worth more than a long one.
- **Propose a feature** with the [feature request form](https://github.com/lswdneil/pi_jev_desktop/issues/new?template=feature_request.yml), or a **new decision point** with the [decision point form](https://github.com/lswdneil/pi_jev_desktop/issues/new?template=decision_point.yml).
- **Fix something.** Issues labelled [`good first issue`](https://github.com/lswdneil/pi_jev_desktop/labels/good%20first%20issue) and [`help wanted`](https://github.com/lswdneil/pi_jev_desktop/labels/help%20wanted) are a good start. Say in the issue that you are on it, so two people do not do the same work.
- **Measure a judge.** Run a decision point in `shadow` with another judge and compare the ledgers (`spec ledger --json`). Numbers on real sessions are the most useful thing a judge change can come with.
- **Translate.** The desktop app speaks 13 languages and the README five; see [docs/translations.md](docs/translations.md).
- **Improve the documentation** in [docs/](docs/README.md). Small fixes can go straight to a pull request.
- **Ask and answer** in [Discussions](https://github.com/lswdneil/pi_jev_desktop/discussions).

Security problems are not reported in public issues: see [SECURITY.md](SECURITY.md).

## Ground rules

- **Understand your change.** If you cannot explain what your change does and how it interacts with the rest of spec.ai.jev, it will not be merged. Using AI to write code or text is fine; sending what you have not read and understood is not. When an AI wrote most of an issue or a pull request description, say so in one line.
- **Keep it small and focused.** One fix or one feature per pull request. A refactor that a fix needs goes in its own commit.
- **Behaviour comes with tests.** A fix comes with a test that fails without it; a feature with tests of what it does. Reference the issue next to a regression test (`// https://github.com/lswdneil/pi_jev_desktop/issues/7`).
- **Be kind.** Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## The repository

spec.ai.jev is a fork of [pi](https://github.com/earendil-works/pi)'s monorepo with a judgment kernel added, plus a desktop app built on [AionUi](https://github.com/iOfficeAI/AionUi).

| Path | What is there |
| --- | --- |
| `packages/kyrn-judge/` | The judgment kernel: decision points (`src/decisions/`), the features that ask them (`src/extension/features/`), judges (`src/providers/`), the ledger, the settings manifest (`src/manifest.ts`, `i18n/manifest.json`, generated `manifest.json`) |
| `packages/coding-agent/`, `packages/ai/`, `packages/agent/`, `packages/tui/`, … | pi's packages: the agent, providers and models, the terminal UI. spec.ai.jev keeps changes here small and marked, so pi can be merged in |
| `kyrn/bin/agent.mjs` | The `spec.ai.jev` launcher: `spec setup`, `spec doctor`, `spec import`, and starting pi with the kernel |
| `kyrn/npm/` | The `spec-ai-agent` npm package and its [changelog](kyrn/npm/CHANGELOG.md) |
| `kyrn/local-judge/` | Laya, the local judge's sidecar |
| `kyrn/docs/` | Design notes and measurements, mostly in Chinese |
| `desktop/` | The desktop app (Electron); spec.ai.jev's parts are under `desktop/packages/desktop/src/**/kyrn/` and `KyrnPanel/` |
| `docs/` | User and contributor documentation |

Both "kyrn" and "spec.ai.jev" appear in names: the project was called KYRN until 2026-09-21. New code says spec.ai.jev where a name is visible to users.

## Setting up

You need Node.js 22.19 or newer (CI uses Node 24) and, for the desktop app, [Bun](https://bun.sh). **npm 11 is
required**: `package-lock.json` is written by it, and npm 10 cannot reproduce (or even accept) this repository's
lockfile — it prunes the optional wasm-fallback entries `@rolldown/binding-wasm32-wasi` needs and then refuses the tree.
Node 24 ships npm 11; on Node 22 run `npm install -g npm@11` once.

```bash
git clone https://github.com/lswdneil/pi_jev_desktop.git
cd spec.ai.jev
npm install --ignore-scripts
node kyrn/bin/agent.mjs          # spec.ai.jev from this checkout; Node runs the TypeScript directly
```

To try your build as `spec.ai.jev` everywhere, `node kyrn/bin/agent.mjs link` puts a `spec.ai.jev` command on your PATH that runs this checkout (`spec unlink` removes it).

The desktop app runs against the spec.ai.jev in the same checkout:

```bash
cd desktop
bun install
SPEC_AI_JEV_ROOT="$(cd .. && pwd)" bun run start
```

A first start without a model asks for one (`spec setup`). With no Jev key set, the free Jev on OpenCode Zen answers the judge's questions; see [docs/judges.md](docs/judges.md).

## Checks and tests

Run these before you open a pull request. CI runs the same, on Linux, and the kernel's and the app's unit tests on Windows too.

```bash
npm run check      # formatting, lint and types for everything outside desktop/
./test.sh          # unit tests; tests that need a model or a key are skipped without one
```

One test file, from its package:

```bash
cd packages/kyrn-judge
node ../../node_modules/vitest/dist/cli.js --run test/injection.test.ts
```

If your shell has provider keys set (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and the like), unset them for test runs: some end-to-end tests turn on when a key is present and would call a real model.

Tests of the kernel use the mock judge (`MockJudgeProvider`, which answers what the test scripts and a neutral 0.5 otherwise) and pi's test harness (`packages/coding-agent/test/suite/harness.ts`) with its faux model, so they need no network and no key.

For the desktop app:

```bash
cd desktop
bun run lint
bun run format:check
node scripts/check-i18n.js
bunx tsc --noEmit
bunx vitest run
```

### Coverage

Coverage is a ratchet: `coverage-baseline.json` holds the numbers the repository has reached, and a change may not go
below them.

```bash
npm run coverage          # the kernel and the model layer, with coverage
npm run check:coverage    # what CI runs: compare against the baseline
npm run coverage:update   # raise the baseline (it never lowers it)
```

On a pull request, CI also passes the changed files (`--changed`): every touched source file must be at or above 60% and
must have a coverage entry at all, so a new module without a test fails the job. That gate compares the file's own line
coverage — an approximation of "changed lines" — which is stated here so nobody mistakes it for line-level precision.
`packages/coding-agent` is not covered yet: its suite has unhandled errors on some machines, and vitest writes no report
when a run raises one; the list in `scripts/check-coverage.mjs` says so.

### The shell's end-to-end tests

`desktop-next` has its own tree and its own e2e suite (`.github/workflows/desktop-e2e.yml`, xvfb on Linux, two shards by
file). Before a failed run uploads a trace, `node scripts/check-artifacts.mjs` scans the artifacts for credentials files
and key-shaped strings: a trace that carries a key has already leaked the moment it is uploaded.

## Code style

`npm run check` enforces most of it. Beyond that:

- TypeScript that Node can run by stripping types: no `enum`, `namespace`, parameter properties or `import =`. No `any` unless there is no other way. Imports at the top of the file only.
- Comments say why, not what. Names and messages in plain words.
- Text users see in the kernel comes in Chinese and English (`say({ zh, en })`). Text the desktop app shows is an i18n key, in every one of its 13 languages ([docs/translations.md](docs/translations.md)).
- A key binding is never hard-coded: add it to the defaults, so it stays configurable.
- Decision points never make the model ask the user: a verdict changes what the model does, not whether it asks.

[AGENTS.md](AGENTS.md) holds the full rules for this monorepo; coding agents read it automatically, and it applies to people too.

## Commits and pull requests

Commit messages follow `type(scope): summary`:

- type: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- scope: `coding-agent` (the harness and the kernel), `desktop`, `ai`, `agent`, `tui`, or none
- summary: what changes for a user, in the present tense, without a trailing period

```
fix(coding-agent): sub-agent status before the first snapshot fits a narrow terminal
```

Put `fixes #123` in the body to close an issue when the change is merged.

Pull requests:

1. Fork, branch from `main`, commit.
2. Fill in the template: what changed, why, how you checked it.
3. CI must pass. A first-time contributor's CI runs after a maintainer approves them, usually within a day.
4. A maintainer reviews. Small follow-ups may be pushed by the maintainer, on your branch or right after the merge.
5. Pull requests are squash-merged, so the title becomes the commit message.

Do not edit the changelogs: maintainers write them when they prepare a release.

## Larger changes

Open an issue before you start on anything that adds a feature, a setting, a decision point or a dependency, or that changes how spec.ai.jev talks to models or stores data. A short description of the problem and the approach saves rework on both sides.

A new decision point needs a question a small judge can answer from a small state, a safe fallback for when no judge answers, tests with the mock judge, settings text and desktop labels. [docs/adding-a-decision-point.md](docs/adding-a-decision-point.md) walks through all of it.

## Dependencies

- Direct dependencies are pinned to exact versions, and lockfile changes are reviewed like code.
- Install with `npm install --ignore-scripts`: lifecycle scripts do not run unless a maintainer decides they must.
- A dependency with an install script needs an explicit allowlist entry (`scripts/generate-coding-agent-install-lock.mjs`).

## Upstream: pi and AionUi

spec.ai.jev merges pi's releases regularly. A bug that is also in pi is best fixed in [pi](https://github.com/earendil-works/pi) first (mention it in your spec.ai.jev issue); one in the desktop shell that AionUi shares can go to [AionUi](https://github.com/iOfficeAI/AionUi). Such issues get the `upstream` label.

## License of contributions

By contributing you agree that your contribution is licensed under the license of the part of the repository it changes: MIT for everything outside `desktop/` and `desktop-next/` ([LICENSE](LICENSE)), Apache 2.0 for `desktop/` ([desktop/LICENSE](desktop/LICENSE)) and `desktop-next/` ([desktop-next/LICENSE](desktop-next/LICENSE)).

### What a file has to say

A new source file starts with two lines, and `node scripts/license-check.mjs` fails the build without them:

```ts
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the spec.ai.jev authors
```

In `desktop-next/` the identifier is `Apache-2.0` instead. The directory decides, not the file: a file there that says MIT is a mistake. `node scripts/license-headers.mjs --stamp <file>` writes the right pair.

Files that were already in the repository are left as they are — stamping the whole tree would rewrite code that came from pi and AionUi, and a huge diff is not a licence. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) is what covers them, and it is generated: after changing a dependency, run `node scripts/third-party-notices.mjs --write` and commit the result. Code adapted from another project (rather than installed from npm) is recorded by hand in [packages/kyrn-judge/THIRD_PARTY_NOTICES.md](packages/kyrn-judge/THIRD_PARTY_NOTICES.md).
