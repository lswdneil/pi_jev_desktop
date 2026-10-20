# Vendored mu/pi

This directory is the mu/pi monorepo, copied from the local checkout on 2026-10-20 and maintained here from then on.

- Source: `mu-work` at commit `9f397360` ("chore: mu-agent 0.1.9 and the app 0.1.8").
- Contents: `packages/`, `kyrn/`, `scripts/`, `docs/`, `bench/`, `nix/`, and both desktop trees (`desktop/`, AionUi; and
  `desktop-next/`, the shell `spec.ai.jev` was derived from).
- Not copied, and ignored by the repository: `node_modules/`, `dist/`, `out/`, `.artifacts/`, `.tmp/`, coverage and test
  reports. Rebuild them locally.
- License: MIT (`mu/LICENSE`). Upstream headers and notices are kept.

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
cd mu
npm ci
npm run build          # produces packages/*/dist and the artifact under .artifacts
```

The desktop stages the result from `mu/.artifacts/desktop-harness` (`npm run stage:harness` at the repository root).
