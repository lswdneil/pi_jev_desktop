# Harness staging

Packaging expects the spec runtime at `resources/harness/spec-ai-agent`. Stage the runtime package here before
`npm run package`; the launcher looks for `harness/spec-ai-agent/kyrn/bin/agent.mjs` in a packaged build.

Development does not use this folder. Set `SPEC_AI_JEV_ROOT` to a runtime checkout instead.
