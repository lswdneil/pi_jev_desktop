# Harness staging

Packaging expects a mu harness at `resources/harness/mu-agent`. Stage the runtime package here before
`npm run package`; the launcher looks for `harness/mu-agent/kyrn/bin/mu.mjs` in a packaged build.

Development does not use this folder. Set `MU_ROOT` to a mu checkout instead.
