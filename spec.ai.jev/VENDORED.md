# Vendored runtime (mu/pi)

This directory is the mu/pi runtime source, copied from the local checkout on 2026-10-20 and maintained here from then on.

- Source: `mu-work` at commit `9f397360` ("chore: spec-ai-agent 0.1.9 and the app 0.1.8").
- Contents: `packages/`, `kyrn/`, `scripts/`, `docs/`, `bench/`, `nix/`. The two desktop trees that came with the
  checkout (`desktop/`, AionUi; and `desktop-next/`, the shell this product was derived from) were removed: they are
  products of their own, not runtime dependencies, and they duplicated neither the build nor the design.
- Not copied, and ignored by the repository: `node_modules/`, `dist/`, `out/`, `.artifacts/`, `.tmp/`, coverage and test
  reports. Rebuild them locally.
- License: MIT (`spec.ai.jev/LICENSE`). Upstream headers and notices are kept.

## Identity (2026-10-20)

The runtime uses the product's name everywhere:

- package `spec-ai-agent`, command `spec`, launcher `kyrn/bin/agent.mjs`;
- config file `agent.json` in `~/.spec.ai.jev/agent`;
- one environment prefix, `SPEC_AI_JEV_*`, for the runtime's settings.

No earlier name is read: a machine that still has an older home or environment keeps it untouched and starts this
product with defaults. The app surface follows the same rule: `app://spec`, `window.spec`, `SpecApi`, and
`SPEC_AI_JEV_ROOT` / `_WORKSPACE` / `_AGENT_DIR` / `_HARNESS`.

Names already written into sessions (`kyrn.decision`, `kyrn.verdict`, and the other `kyrn.*` entry types) are not
renamed, because doing so would orphan existing history.

## One deliberate change

`packages/kyrn-judge/src/google-login/oauth.ts` carried two Google OAuth **desktop client id/secret pairs** for the
Gemini CLI and Antigravity logins, base64-encoded. GitHub push protection refuses to accept them, and a fork has no
business shipping another product's OAuth client. They are now read from the environment:

| Variable | Login |
| --- | --- |
| `PI_GOOGLE_GEMINI_CLIENT_ID` / `PI_GOOGLE_GEMINI_CLIENT_SECRET` | Google Gemini CLI |
| `PI_GOOGLE_ANTIGRAVITY_CLIENT_ID` / `PI_GOOGLE_ANTIGRAVITY_CLIENT_SECRET` | Google Antigravity |

Without them those two logins fail with Google's own error instead of starting with an empty client id. Everything else
is the upstream tree unchanged.

## Building the runtime

```powershell
cd spec.ai.jev
npm ci
npm run build          # produces packages/*/dist and the artifact under .artifacts
```

The desktop stages the result from `spec.ai.jev/.artifacts/desktop-harness` (`npm run stage:harness` at the repository root).
