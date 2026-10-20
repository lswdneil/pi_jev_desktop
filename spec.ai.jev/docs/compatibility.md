# Compatibility

What mu promises about files it writes and files it reads, so an upgrade — or a downgrade — does not silently
change behaviour or lose work.

## Configuration schema

`~/.mu/agent/mu.json` carries a `schemaVersion`. It is the version of the **file format**, not of mu: the npm
package and the desktop app are released separately, and a newer app can run with an older package.

| Situation | What mu does |
| --- | --- |
| No `schemaVersion` (a file from before the field existed) | migrates it, writes the current file, and keeps the previous contents as `mu.json.bak` |
| Current `schemaVersion` | reads it; writes nothing |
| Newer `schemaVersion` than this build knows | refuses the file, says to upgrade mu, and writes nothing at all |
| Not valid JSON | reports the parse error, copies the original to `mu.json.bak`, and starts on defaults |
| Valid JSON with a mistyped or unknown setting | reads everything it can and **names** what it could not: unknown keys, a judge type that does not exist, a mode that is not `off`/`shadow`/`active`, a `tiers` that is not a list |

The current format version is **1**, declared as `CONFIG_SCHEMA_VERSION` in
`packages/kyrn-judge/src/config/migrations/index.ts`. A migration is a function from one version to the next,
idempotent, applied in order, and listed in `CONFIG_MIGRATIONS`; adding a version without adding its step fails
the build.

The point of reporting instead of silently ignoring: before this, a user who typed `"judegs"` or `"modes":
{"tool.admission": "sometimes"}` saw no error and believed the setting applied.

## Sessions

- Conversation history is pi's session format, and mu does not fork it. The desktop app reads the same files
  the command line writes.
- A change that makes an older session unreadable needs a migration and at least one minor release in which
  the old format is still read before the new one becomes the only writer.
- Names stored **inside** sessions and desktop event logs — `kyrn.decision`, `kyrn.verdict`,
  `kyrn.presentation.v1`, `kyrn.hive`, `kyrn.swarm` — are frozen. Renaming one orphans history, so
  `packages/kyrn-judge/test/naming.test.ts` pins them.
- The ledger is append-only JSONL. Readers skip lines they cannot parse rather than failing the file, so a
  newer mu's records do not make an older mu unable to read its own.

## Version sources

Three versions move independently, on purpose:

| What | Where the version lives | Bumped by |
| --- | --- | --- |
| Desktop app | git tag `vX.Y.Z` (the app has no version field of its own; the tag is the release) | tagging a commit |
| `mu-agent` npm package | `kyrn/npm/package.template.json` | `npm run version:mu-agent -- <version>`, checked against `kyrn/npm/CHANGELOG.md` |
| The monorepo itself | root `package.json` (`private`, `0.0.3`) | nothing that ships; it is not published |

`npm run check:release-versions` refuses a `mu-agent` version the changelog does not list, and CI checks the
same thing. The monorepo version is deliberately not tied to either release: a change to the harness must not
force a desktop release.

## Rollback

Every release stays downloadable, so rolling back is installing the previous one:

- **Desktop app**: the previous installers remain on its release page. Install the older one over the newer
  one; the update feed only moves forward, so an install picks up newer releases from then on.
- **`mu-agent`**: `npm install -g mu-agent@<previous-version>`.
- **`mu.json`**: a migration keeps the file it replaced at `mu.json.bak`. Restoring it returns the settings
  to what they were; a file with an older `schemaVersion` is migrated again on the next start.
- **A verdict that turned out wrong**: set that decision to `"shadow"` in `mu.json` (or every decision with
  `"modes": { "default": "shadow" }`) — the judge still records what it would have done, and mu acts as it did
  before judging existed. `MU_JUDGE=off` turns the layer off entirely without touching the file.

## The 1.0 gate

mu stays 0.x until a release has all of these:

1. Thirty days without a P0 (data loss, a security hole, a build users cannot start).
2. The end-to-end suite green on the three platforms for two consecutive releases.
3. The task benchmark shows mu at least as good as pi on the measured tasks (see the plan in
   `docs/plans/production-readiness/`), not only faster.
4. `mu.json` migrations exist for every released format, and the previous one is still read.
