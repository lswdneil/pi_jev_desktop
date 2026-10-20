# Attic

Design documents that describe work which is **not** implemented and **not** planned.

They are kept so the reasoning behind a rejected or abandoned direction is not lost, and so
nobody re-derives it from scratch. Nothing here is a source of truth: no code, test, script,
or workflow reads these files, and `scripts/check-repo-hygiene.mjs` does not treat them as
live paths.

Rules for this directory:

- A document moves here only when it is dead: either superseded by an implemented design, or
  explicitly dropped.
- Every file carries an `Archived` banner at the top saying what replaced it or why it stopped.
- Do not add an implementation plan here to "park" it. Parked plans belong in the issue
  tracker, not in the tree.

## Contents

| File | What it proposed | Status |
| --- | --- | --- |
| `tui-plan.md` | Constrained layout system for `TuiAltScreen` with a fixed bottom region | Never implemented; superseded by the current `packages/tui` rendering |
