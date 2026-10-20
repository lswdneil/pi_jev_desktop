# Releasing

For maintainers. mu ships two things that are versioned separately:

- **The desktop app**, `vX.Y.Z` tags on this repository, published as GitHub pre-releases with installers for six platforms.
- **The `mu-agent` npm package**, the command line, which the app also carries inside it. Its version is in `kyrn/npm/package.template.json` and its changelog in [kyrn/npm/CHANGELOG.md](../kyrn/npm/CHANGELOG.md).

## What CI does

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | every push to `main` and every pull request | `npm run check` and the tests; the app's lint, format, i18n, types and unit tests; MCP conformance |
| `windows-tests.yml`, `windows-permission.yml` | pushes and pull requests | the kernel's and the app's unit tests on Windows; the start chain and a permission round trip |
| `npm.yml` | pushes to `main` that touch the harness | builds and packs `mu-agent`, installs the tarball and runs it on Linux (Node 22.19), macOS and Windows; the tarball is kept as an artifact |
| `desktop.yml` | pushes to `main` that touch `desktop/`, and `v*` tags | packs this commit's mu, builds the app for macOS, Windows and Linux (x64 and arm64), signs and notarizes the macOS builds, holds a real conversation in each built app; on a tag, publishes the release |
| `npm-audit.yml` | daily | audits the dependencies |

## Releasing the npm package

1. Add the release's section to `kyrn/npm/CHANGELOG.md` (move `[Unreleased]` under a version and date) and set the same version everywhere: `npm run version:mu-agent -- 0.1.9`. The check refuses a version the changelog does not list, and notes with no version.
2. Push to `main` and wait for `npm.yml` to pass on all three systems.
3. Tag that commit: `git tag mu-agent-v0.1.9 && git push origin mu-agent-v0.1.9`. The tag run reuses the tarball the three systems installed and ran, and publishes **that** file — never a fresh build.
4. Publishing goes through npm trusted publishing (OIDC): the job holds `id-token: write` and no token is stored in this repository, so there is no long-lived secret to leak or rotate. `--provenance` makes the registry publish an attestation naming the commit and the workflow; the job then reads that attestation back and fails if it is missing.
5. What gets published is `mu-agent` only. The harness packages carry pi's scope (`@earendil-works/pi-*`) and are `private: true`: `npm publish` refuses them, and `scripts/publish.mjs` refuses them again with a reason before it would even try. `MU_ALLOW_FOREIGN_SCOPE=1` exists for the maintainers of that scope and for nobody else.

CI needs no `NPM_TOKEN`. If trusted publishing is not configured for the package yet, add this repository and workflow on npm's package settings page once; after that the tag job publishes unattended.

## Releasing the desktop app

1. Make sure the app carries the intended `mu-agent` (the build packs the mu of the same commit) and that `desktop.yml` passed on `main`, including the conversations held in the built apps.
2. Update [CHANGELOG.md](../CHANGELOG.md): move `[Unreleased]` under the new version.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag run builds every platform again, writes the SBOM, `SHA256SUMS`, the signature and the build attestations, verifies them, and creates the pre-release.
4. Read the release page: every installer, `sbom.cdx.json`, `SHA256SUMS`, `SHA256SUMS.sigstore.json`, the four `latest*.yml` update feeds. Edit the notes so they say what changed for users.
5. An installed earlier version offers the update after the user agrees; check that it does.

## What a release carries, and how to verify it

| Asset | What it proves |
| --- | --- |
| `SHA256SUMS` | every file it lists is byte-for-byte what was built |
| `sbom.cdx.json` | what is inside the build (CycloneDX 1.5, from `package-lock.json`, `scripts/sbom.mjs`) |
| `SHA256SUMS.sigstore.json` | a keyless Sigstore certificate issued to this repository's workflow signed the checksums |
| the attestation (not a file: GitHub stores it) | GitHub attests the files were built by this workflow from this commit |
| `latest*.yml` and their blockmaps | nothing: attached unsigned, they are how electron-updater finds its next installer |

```bash
# everything at once: checksums, signature identity, build attestations
node scripts/verify-release.mjs <the folder you downloaded> --repo lswdneil/pi_jev_desktop --require-proof

# without cosign or gh installed the two proof layers are reported as skipped, not passed
node scripts/verify-release.mjs <folder>
```

`--require-proof` fails a release that has no signature or no attestation, which is what the release job runs
before publishing: a tag run that cannot prove what it built does not publish. Verifying does not need an npm
account, a key or this repository's secrets — only `cosign` and `gh` (with any GitHub account) for the proof
layers.

Run it **without** `--strict` on the folder you downloaded: it holds the update feed files too, which the
checksums do not cover (see below), and `--strict` reports each of them as unlisted. The release job uses
`--strict` on `dist`, where every file is attached, so a file the checksums miss stops the release instead of
appearing as a note in a log.

### Release rehearsal, offline

The part of a release that needs neither a certificate, nor a tag, nor GitHub — the SBOM, the checksums and the
verifier — can be rehearsed locally. It was, on Windows with Node 24.13, from a checkout into an empty folder:

```bash
node scripts/sbom.mjs --lock package-lock.json --out dist/sbom.cdx.json \
  --name mu --version 0.1.8 --commit 0123456789abcdef0123456789abcdef01234567
# 403 components written to dist/sbom.cdx.json

tar -czf dist/mu-0.1.8-source.tar.gz --exclude=node_modules --exclude=.git .   # git archive needs a clone
cd dist && sha256sum -- * > SHA256SUMS                                          # or Get-FileHash on Windows
node ../scripts/verify-release.mjs . --repo lswdneil/pi_jev_desktop
```

What came back: both files `pass checksum`, one note that no Sigstore bundle covers the checksums (nothing has
signed them), `the release verifies`, exit 0. With `--require-proof --repo lswdneil/pi_jev_desktop` the same folder fails on
three counts — no signature, and no attestation for either file, each answered by GitHub with
`HTTP 404 … /attestations/sha256:…`. That 404 is the useful part: `gh` is installed and authenticated, the
request reached the API, and the only thing missing is a tag run that created the attestations.

The negative cases behave the same way by hand: appending one byte to a payload makes the verifier name the file
and exit 1, and adding a file that `SHA256SUMS` does not list is a note without `--strict` and a failure with
it. The SBOM is reproducible except for `metadata.timestamp` (CycloneDX fixes the field, `scripts/sbom.mjs`
writes the wall clock), so two runs differ in bytes while the 403 components are identical.

What a rehearsal on a developer machine cannot cover: the installers (they need the Windows certificate and the
macOS notarization credentials), the Sigstore layer (`cosign` is installed by the release job, not by a
checkout) and the attestations (they exist only for a tag run). Those three need the first real tag; until then
the honest statement is that the SBOM, checksum and verifier plumbing is proven, and the signing chain is
written but unexercised.

Releases stay pre-releases while mu is 0.x.

## Releasing the new shell (`desktop-next`)

The new shell is packaged by `.github/workflows/desktop-package.yml` and updated by the app itself. Its release has one
extra asset per installer that the old app did not need:

1. **Package.** A `v*` tag (or a manual run) builds nsis, dmg/zip and AppImage/deb on their own runners. The job
   installs the shell's dependencies from the lockfile (`npm ci --ignore-scripts`; the packager is a pinned
   devDependency, so the release is built by the version that was reviewed), checks `electron-builder.yml` against
   electron-builder's own schema, stages the harness, runs `scripts/check-package.mjs` on the output, and on Windows
   launches the packaged app to see the agent running before anything is uploaded.
2. **The harness inside the app.** `node kyrn/npm/build.mjs` writes `.artifacts/npm/mu-agent`; it is moved to
   `.artifacts/desktop-harness/mu-agent` and its own production dependencies are installed **into that folder**
   (`npm install --omit=dev --ignore-scripts`), because the app carries a folder and does not run npm. Two details that
   fail silently otherwise: `extraResources` copies `.artifacts/desktop-harness` (the folder that *holds* the package),
   because electron-builder never copies the root `node_modules` of a source folder; and a harness without `jiti`
   starts and then dies with `Cannot find module 'jiti'` when the agent loads the judge extension. Both are what
   `scripts/check-package.mjs --require-harness` checks in the built artifact.
3. **Carry the update feed.** Every release must carry `latest.yml`, `latest-mac.yml` and `latest-linux.yml` beside the
   installers — the app reads the feed for its platform. The feed names each artifact's `sha512`, and the app compares
   the download against it before it looks at any signature. **The URL matters while mu is 0.x:** the shell's
   `DEFAULT_FEED` is `https://github.com/lswdneil/pi_jev_desktop/releases/latest/download/latest.yml`, and GitHub's `latest` only
   resolves to a release that is *not* a pre-release. Every release so far is a pre-release, so that URL answers 404 and
   the update check cannot succeed (it reports the 404 rather than offering anything, which is the safe outcome). Until
   the feed URL is settled — publish a full release, keep a rolling `latest` tag, or have the app resolve the newest
   release through the GitHub API — adding `UPDATE_PUBLIC_KEY` alone does not make the update path work.
4. **Publish a detached signature per installer.** For each installer there must be `<artifact>.sig`: the base64
   Ed25519 signature over the installer's bytes. The app downloads that file next to the installer
   (`src/main/update-install.ts`), checks the digest and the signature, and only then starts the installer. One
   command makes all of them, and checks what it wrote against the public half of the same key; the packaging
   workflow runs it when the `UPDATE_SIGNING_KEY` secret is set, and uploads the `.sig` files with the installers.
   ```bash
   # one key for the project, kept wherever the release secrets live; never commit the private half
   openssl genpkey -algorithm ed25519 -out mu-update-private.pem
   openssl pkey -in mu-update-private.pem -pubout -out mu-update-public.pem

   # sign every installer in the folder, then verify the signatures it just wrote
   node scripts/sign-installers.mjs desktop-next/dist --key mu-update-private.pem
   # verify the ones that are already there (no key file, no writing)
   node scripts/sign-installers.mjs desktop-next/dist --key mu-update-private.pem --check
   ```
   A signature made with a key the build does not carry is correct and useless, so the public half has to be the one
   in `desktop-next/src/main/update-verify.ts` (next step). `scripts/sign-installers.test.mjs` hands a signature the
   script made to the app's own `verifyArtifact`, so the two halves cannot drift apart unnoticed.
5. **Put the public half in the build.** `UPDATE_PUBLIC_KEY` in `desktop-next/src/main/update-verify.ts` is intentionally
   empty today: a build without a key refuses to install any update, which is the safe default. Filling it in is a
   code change, so that the trust anchor is a reviewed constant rather than a file the app can rewrite.
6. **Check the upgrade path** on a machine with the previous version installed: the app says the new version is
   available, and installing it verifies digest and signature before starting the installer.

To build one locally: `cd desktop-next && npm run package -- --win --x64` (one architecture; the arch is a command-line
choice because a target that lists two builds one combined installer). `--dir` instead of the platform flag produces an
unpacked folder and no installer. A local `--dir` build without a staged harness produces an app that reports "mu was not
found" — that is the error screen working, not a packaging bug.

**What the first real installer measured** (Windows x64, unsigned): `mu-0.1.8-x64.exe` **116.7 MiB**
(122,392,598 bytes), installing to **402 MB** on disk in 494 files; installing silently, launching the installed app,
walking the first run and reaching `running · package`, then uninstalling left the folder gone. `app.asar` inside it is
729 KB and the harness folder 419 files with its `node_modules`. The `latest.yml` the build wrote parses through the
app's own `parseFeed`, its `sha512` matches the installer byte for byte, and `decideUpdate` answers `up-to-date` for
0.1.8 and `available` for 0.1.7 — with a signature the release side made by `scripts/sign-installers.mjs`, which the
app's own `verifyArtifact` accepts, and which it rejects after one changed byte or under another key. That build was
also how four defects surfaced, none of them visible until an artifact existed: a misspelled `entitlementInherit` made
electron-builder reject the whole configuration on every platform; the shell's type-only dependency was a production
dependency, which packed 243 MB of toolchain into the archive; the harness was copied without the `node_modules` it
declares; and `arch: [x64, arm64]` in the target produced a 237 MB combined installer that the feed then pointed
everyone at. The checks above exist because of those four, and `scripts/check-package.mjs --require-installer` now
fails an installer over the 180 MB budget the shell decision rests on.

**Upgrading over an installed version** was rehearsed, because "the next version installs over the previous one and the
user keeps their work" is the property every release depends on and nothing in the test suite touches it. Two installers
were built (0.1.8, then the package version bumped to 0.1.9 and built again) and installed into one folder in sequence:

| Step | Result |
| --- | --- |
| install 0.1.8, first launch | first-run wizard, header `v0.1.8`, agent `running · package`, a session created under `~/.mu/agent` |
| install 0.1.9 over it (same folder) | exit 0, `mu.exe` `FileVersion` 0.1.8 → **0.1.9**, one uninstaller (`Uninstall mu.exe`), no second install folder |
| launch the upgraded app | header `v0.1.9`, **no first-run wizard** (the profile was kept), agent `running · package`, the same session still there |
| uninstall | exit 0, the folder is gone, no `mu` processes left |

Two things that rehearsal made concrete: the installer carries the version in the executable (`FileVersion`), so
"which build is installed" is answerable without launching it; and a `.sig` is bound to the exact bytes of the installer
it was made for, so it has to be made after the last rebuild — which is the order the packaging workflow uses (package,
then sign, then upload).

**Signing state.** The installers are unsigned until the owner provides a Windows certificate (Azure Trusted Signing or
an OV certificate) and the macOS notarization credentials. Until then Windows shows "unknown publisher" and SmartScreen
reputation has to build up after the certificate is in place; the release notes of every unsigned build say so.
`Get-AuthenticodeSignature` on the packaged executable reports `NotSigned` today, which is the expected state and the
evidence that the certificate is the missing piece rather than a broken signing step. The macOS entitlements the
signed build would carry are in `desktop-next/build/entitlements.mac.plist`; the application icons are the product's
own, in `desktop-next/build/`.


## Release trains

Releases go out in two-week trains, so a fix does not wait for the next feature and a feature does not ride in
unnoticed:

- **A train is one or two releases**: a patch when only fixes are waiting, a minor when features are. Both
  are cut from `main` after CI, the Windows suites and `desktop.yml` are green on the same commit.
- **A release that breaks a file format is not a patch.** It needs its migration (see
  [compatibility.md](compatibility.md)), a `mu-agent` minor, and the note "upgrade to this or later" in the
  release notes.
- **What waits for the next train**: anything that needs a migration written after the tag, or a change to
  the release pipeline itself. Both go in right after the tag, not just before it.
- **The 1.0 gate** is in [compatibility.md](compatibility.md#the-10-gate); no release is called 1.0 until every
  item there holds.

## Rolling back

The previous release stays on its release page and its version stays installed on npm, so rolling back is
installing the previous one — no rebuild, no hotfix tag:

1. Desktop app: install the previous release from its page. The update feed only moves forward, so the next
   check offers the newer release again; that is intended, and a user who wants to stay put can turn updates
   off.
2. `mu-agent`: `npm install -g mu-agent@<previous-version>`.
3. Settings: a migration keeps the file it replaced at `mu.json.bak`; restoring it returns the settings, and
   the older schema is migrated again on the next start.
4. Say what happened in the release notes of the next release, including which commit introduced the fault.
   A rollback nobody writes down is a rollback that happens twice.

## Secrets

macOS signing and notarization use the repository secrets `BUILD_CERTIFICATE_BASE64`, `P12_PASSWORD` and `KEYCHAIN_PASSWORD` and the notarization credentials. Workflows from forks never see them: pull requests from forks build and test, they do not sign or publish.
