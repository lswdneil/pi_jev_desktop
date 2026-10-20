# judge-evals

Offline replay of the judgment kernel's test-log admission arms, and the thresholds a change to them has to
pass. Every number here can be reproduced with no API key and no network.

```bash
# what each arm does to the committed corpus
node packages/judge-evals/src/cli.ts

# the same, machine-readable
node packages/judge-evals/src/cli.ts --json

# only the arm that must never get worse
node packages/judge-evals/src/cli.ts --arm rules,oracle

# with the real judge, when a key is configured
AI_GATEWAY_API_KEY=… node packages/judge-evals/src/cli.ts --judge jev --max-requests 150
```

## The arms

| Arm | What it is | What it proves |
| --- | --- | --- |
| `full` | the whole log | the baseline the others are measured against |
| `rules` | deterministic selection, no judge | what every user gets with `SPEC_AI_JEV_JUDGE=off` |
| `ceiling` | a judge that omits everything | what the protections alone guarantee — it loses evidence on purpose |
| `oracle` | a judge that reads the labels | the labels are satisfiable: a correct judge loses nothing |
| `jev:…` | the real model | only with a key; skipped, not failed, without one |

A run prints, per arm: required substrings kept, required substrings lost, optional noise omitted, net
characters saved (markers and pointer paid), judge calls and tokens. `--json` adds the same rows the table is
built from.

## Thresholds

`baseline.json` records the numbers a change may not regress. Two rules are hard:

1. A protecting arm (`full`, `rules`, `oracle`) may not lose a required line. Losing one means the agent was
   shown less than it needs to answer, which is the failure this whole mechanism exists to prevent.
2. A saving arm (`rules`, `oracle`) may not save more than one percentage point less than the baseline.

Everything else — judge calls, tokens, latency, what a wrong omission would cost to recover — is printed and
never gates, because it moves with batching and wording rather than with correctness.

```bash
node packages/judge-evals/src/cli.ts --update-baseline   # after a deliberate change, and say so in the PR
```

## What is in the corpus, and what is not

The corpus is `packages/kyrn-judge/test/fixtures/test-log-cases.ts`: 38 cases over the ten logs in
`test/fixtures/test-logs/`, each pairing one runner log with one or more goals. The logs were produced by
running vitest, `node:test` and pytest over a synthetic project, with paths sanitised to `/tmp/synthetic/…`.
`test/corpus-integrity.test.ts` fails if a case carries a home directory, a drive letter, an internal hostname,
a credential shape, or a label that is not a literal substring of its log.

Two things the plan for this package asked for are **not** here, because they are data rather than code:

- **The authors' seven real logs.** They were never committed, so they cannot be recovered from this tree.
  When they are available, sanitise them (home directories, hostnames, package and user names, absolute
  paths), drop them in `packages/kyrn-judge/test/fixtures/test-logs/` with a header stating the collection
  conditions, add cases, and re-run `--update-baseline`: the old numbers do not survive new corpus.
- **Golden verdicts for high-traffic decision points** (`input.preflight`, `tool.admission`, `tool.injection`,
  `turn.completion`, …): a set of `(state, expected answer)` pairs per point, labelled by a person. The
  format is described in `docs/plans/production-readiness/cards/U12.md` §2 step 3; it needs the labels, not
  more code.

Until both exist, the honest claim is the one this package measures: the protections lose nothing, and a
correct judge would save about half the log on this corpus. The `rules` arm saving nothing on the synthetic
corpus is itself a finding — those logs have no large duplicate blocks to collapse — and it is why the seat
belt is the protections and not the judge.
