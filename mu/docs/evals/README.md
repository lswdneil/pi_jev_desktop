# Task benchmark

The other evals in this package compare *prompts*: two documentation variants, scored by a model. This one compares
**tasks**: a small repository where the tests fail, a prompt, and four ways of running the agent. The judge is the
repository's own test command — never a model's opinion of its own work.

```bash
# Is every task honest (judge red before the fix, green after)?
node --experimental-strip-types packages/evals/src/tasks/cli.ts --self-check

# The machinery, offline: the faux executor applies each task's reference fix.
node --experimental-strip-types packages/evals/src/tasks/cli.ts --executor faux --arm all

# A real measurement, one arm at a time (needs a key and a budget).
node --experimental-strip-types packages/evals/src/tasks/cli.ts --executor agent --arm mu-active \
  --model anthropic/claude-sonnet-4 --budget 5
```

Reports go to `docs/evals/reports/<date>.md` and `.json` (override with `--out`).

## A task

```
evals/tasks/<id>/
  task.json      { "id", "title", "prompt", "judge": { "command", "args", "timeoutMs?" } }
  repo/          the repository in the state where the judge fails
  fixed/         an overlay of corrected files, copied over repo/ for the self-check
```

The fixtures live beside `src/`, not inside it: each is another repository — plain `.js`, its own `package.json` — and
this repository's lint and type checks must not read them as this package's sources.

A task is admitted only if `--self-check` says the judge fails on `repo/` and passes with `fixed/`. A task that passes
before the fix measures nothing, and the self-check fails the build on it.

## The four arms

The judgment layer is the only thing that changes between them: same binary, same task, same model.

| Arm | What it changes | The number a reader compares |
| --- | --- | --- |
| `pi-baseline` | the judgment layer off | what the agent does without mu's kernel |
| `mu-active` | judgments act on the run | what mu does today |
| `mu-shadow` | judgments recorded, not acted on | what a careful rollout would cost |
| `mu-off` | judgments not consulted at all | the floor |

`pi-baseline` runs the same coding agent with the kernel switched off. This repository ships one agent, so a true
second checkout of upstream pi is not available here; the arm is the closest executable baseline, and the report names
it that way.

## What each executor means

- **`faux`** applies every task's reference fix. It measures discovery, judging, the report and the CI wiring — and
  **nothing about a model**. Its 100% completion is true by construction; read it as a smoke test, never as quality.
- **`agent`** runs `<cli> --mode json "<prompt>"` in a copy of the task's repository, with the arm's settings written to
  a temporary `mu.json`, then judges the copy. It needs a model and a key, and a run that fails to start is recorded as
  `action: "error"` with the command's own output — not as a zero.

## Budget

`--budget <usd>` stops the run as soon as the spend reported by the agent's `usage` lines passes it; the report says
`stoppedForBudget` and the CLI exits 1. A nightly run without a budget is a run that can surprise someone.

## Adding a task

1. Copy an existing task directory; keep `repo/` as small as the failure needs.
2. Write the prompt as the thing a person would say, not as a pointer to the bug.
3. Make the judge the repository's own test command (`node --test`, `npm test`, …).
4. Add `fixed/` with the corrected files, then run `--self-check` and make it pass.

## Known limits

- Six seed tasks. The corpus is meant to grow to the 12–20 the plan calls for; each is data entry, not code.
- No wall-clock or cost isolation: the arms run on the same machine, and the numbers in a report are from one run.
- `mu-shadow` and `mu-active` differ only in what `mu.json` says; a task that never reaches a decision point cannot tell
  them apart, and the report does not pretend otherwise.
- An agent arm starts the real command line, so it inherits the machine's configuration. A broken extension in the
  user's config fails the arm before the task begins — the report shows it as `action: "error"` with the CLI's own
  message, which is what happened on the machine this was built on. A benchmark run wants a clean extension config
  (`pi -ne`, or a fresh home).
