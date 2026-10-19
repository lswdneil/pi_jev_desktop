# Working in this repository

## Source control is part of the work

Work is not finished while it is uncommitted. Every stage that can be verified ends with a commit and a push to
`origin/main`; do not leave a working tree dirty between stages, and do not let unrelated changes accumulate in one
commit.

```powershell
npm run verify                                            # typecheck, tests, build, size budget
git add -A
git commit -m "feat: <what changed>"                      # conventional commit, imperative, lower case
git push origin main
```

- One commit per verifiable stage: a screen, a data path, a fix. Not one commit per file, not one commit per day.
- Subjects use `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. The body says why, not what the diff shows.
- Check `git status --porcelain` before committing; if a change is not yours and not part of the stage, leave it.
- Never commit `out/`, `dist/`, `resources/harness/mu-agent/`, or anything carrying a user's keys or paths. They are
  in `.gitignore` for that reason.
- A stage that only touches visuals still runs `npm run typecheck`, `npm test`, `npm run build`, `npm run budget`.
  End-to-end tests are deferred until the desktop UI port is complete; see "Testing" below.

## Testing

`npm run verify` is the gate. The Playwright suite (`npm run test:e2e`) needs a real mu harness and is run per
milestone rather than per commit while the UI is being rebuilt.

## Packaging

`npm run package` builds, stages the mu runtime into `resources/harness/mu-agent`, then runs electron-builder.
The runtime is a built package, not source:

```powershell
$env:MU_ROOT = "C:\Users\wd_al\Downloads\DSH-Beta\mu-work"   # the script reads $env:MU_ROOT\.artifacts\desktop-harness
npm run package:dir                                          # unpacked build, fastest smoke
npm run smoke:package                                        # starts the packaged app and waits for "running ·"
```

## Conventions

- Language: user-facing copy is localised in `src/renderer` for `en`, `zh`, and `zh-TW`; add all three.
- Brand: the palette is the Freebuff dark mapping in the renderer theme, and the logo is `src/renderer/assets/logo.png`.
- Files derived from mu's `desktop-next` keep their Apache-2.0 SPDX header; new files are MIT.
