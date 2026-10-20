# Releasing spec.ai.jev

The product ships as a Windows x64 NSIS installer plus the update feed (`latest.yml`) the app reads. This page is the
runbook: what a build needs, what CI does, and which secrets only a person can supply.

## Locally

```powershell
npm ci
npm run verify          # typecheck, tests, build, size budget
npm run package         # build + stage the runtime + installer in dist/
node scripts/install-rehearsal.mjs
```

`scripts/stage-harness.mjs` accepts `--from <folder>` and `MU_HARNESS_ROOT` when the runtime lives somewhere other than
`mu/.artifacts/desktop-harness` (the repository's own build of the vendored `mu/` source). The staged copy is git-ignored;
~34 MB of built package does not belong in history.

The rehearsal installs the `.exe` silently into a temporary folder, starts the installed app with a temporary home and
profile, walks the first run, answers a turn through a local stub provider, checks a write approval reaches the model,
finds the session under the temporary home, checks the real home was not touched, then uninstalls and checks every trace
is gone. It needs a desktop session and Windows; it is not part of CI.

## CI

`.github/workflows/desktop-package.yml` runs on `workflow_dispatch` and on tags matching `v*`:

1. `npm ci`, then the same verify gate as a developer.
2. `npm pack mu-agent@0.1.8`, unpack it, install its production dependencies, and stage it. CI uses the published package
   today; the vendored `mu/` source is where the runtime is maintained, and building it in CI is the next step when the
   runtime is patched beyond a published version.
3. `npm run package` produces `dist/spec.ai.jev-<version>-x64.exe`, its block map, and `latest.yml`.
4. The artifact is uploaded; on a tag it is also attached to a **draft** GitHub release.

The tag must match `version` in `package.json` (`0.1.0` today). Change both together.

## Secrets only a person can supply

| Secret | What it is | What it changes |
| --- | --- | --- |
| `CSC_LINK` | A base64 `.pfx`, or a URL to one, with the code-signing certificate | The installer and the app binary carry a signature; Windows SmartScreen stops calling the publisher unknown |
| `CSC_KEY_PASSWORD` | That certificate's password | — |

Without them the build is unsigned and still works. Nothing in this repository invents or stores a private key.

## Updates

The app reads `https://github.com/lswdneil/pi_jev_desktop/releases/latest/download/latest.yml`. A published release with
`latest.yml` and the installer is what makes "an update is available" true for an installed copy.

Installing one is refused today, on purpose: `src/main/update-verify.ts` holds the public key an update artifact must be
signed with, and it is empty. The key is compiled into the main process at build time from the
`SPEC_UPDATE_PUBLIC_KEY` build variable (`electron.vite.config.mts`) — not a setting and not a run-time environment
variable, so neither the settings screen nor the environment of the person running the app can move the trust anchor.

To turn the feature on:

1. Generate an Ed25519 key pair offline.
2. Put the public key (PEM) in the repository secret `SPEC_UPDATE_PUBLIC_KEY`; the private key belongs in the release
   job's secret store, never in this repository.
3. Sign each installer with that private key in the release job, and upload the base64 signature beside the artifact as
   `<installer>.sig` — that is where `installUpdate` looks for it.

Until then the app says so instead of installing something it cannot prove.

The settings screen reads a check's `canInstall`, so a build with the key says nothing about being unable to install,
and a build without it says exactly that instead of offering a button that will refuse.

## Publishing

1. Run the workflow on the tag.
2. Download the artifact and run `node scripts/install-rehearsal.mjs <installer>` on a Windows machine.
3. Publish the draft release. The updater's `latest` URL only resolves once a release is published.
