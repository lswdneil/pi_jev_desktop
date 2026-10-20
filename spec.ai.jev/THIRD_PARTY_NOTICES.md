# Third-party notices

This file lists the npm packages mu ships and the licence each is distributed under. It is generated from the
lockfiles by `node scripts/third-party-notices.mjs --write` and checked by `node scripts/license-check.mjs`.
Do not edit it by hand: change the dependency and let the file follow.

- The root tree is mu's JavaScript packages. Its development dependencies are not listed, because they do not
  ship.
- `desktop-next/` is a separate application with its own lockfile. Its dependencies are bundled into the app, so
  they are all listed, development ones included.
- mu's own packages are covered by the repository's `LICENSE`; they appear here for completeness.
- A dependency the lockfile records no licence for appears as `unrecorded`. That is a question for the
  dependency's own package, not a licence mu chose.

553 components.

## This repository's own packages

| Package | Version | Licence |
| --- | --- | --- |
| `@earendil-works/chord` | 1.0.2 | MIT |
| `@earendil-works/pi-agent-core` | 1.0.2 | MIT |
| `@earendil-works/pi-ai` | 1.0.2 | MIT |
| `@earendil-works/pi-client` | 1.0.2 | MIT |
| `@earendil-works/pi-codemode` | 1.0.2 | MIT |
| `@earendil-works/pi-coding-agent` | 1.0.2 | MIT |
| `@earendil-works/pi-durable` | 1.0.2 | MIT |
| `@earendil-works/pi-evals` | 1.0.2 | MIT |
| `@earendil-works/pi-mcp` | 1.0.2 | MIT |
| `@earendil-works/pi-protocol` | 1.0.2 | MIT |
| `@earendil-works/pi-server` | 1.0.2 | MIT |
| `@earendil-works/pi-telemetry` | 1.0.2 | MIT |
| `@earendil-works/pi-tui` | 1.0.2 | MIT |
| `@kyrn/judge` | 0.1.0 | MIT |
| `@kyrn/judge-evals` | 0.1.0 | MIT |
| `pi-extension-custom-provider-anthropic` | 1.0.2 | MIT |
| `pi-extension-custom-provider-gitlab-duo` | 1.0.2 | MIT |
| `pi-extension-gondolin` | 1.0.2 | MIT |
| `pi-extension-sandbox` | 1.0.2 | MIT |
| `pi-extension-with-deps` | 1.0.2 | MIT |

## Shipped dependencies

### (BSD-3-Clause OR GPL-2.0) (1)

| Package | Version | Licence |
| --- | --- | --- |
| `node-forge` | 1.4.0 | (BSD-3-Clause OR GPL-2.0) |

### (MIT OR CC0-1.0) (1)

| Package | Version | Licence |
| --- | --- | --- |
| `type-fest` | 0.13.1 | (MIT OR CC0-1.0) |

### (WTFPL OR MIT) (1)

| Package | Version | Licence |
| --- | --- | --- |
| `utf8-byte-length` | 1.0.5 | (WTFPL OR MIT) |

### 0BSD (1)

| Package | Version | Licence |
| --- | --- | --- |
| `tslib` | 2.8.1 | 0BSD |

### Apache-2.0 (73)

| Package | Version | Licence |
| --- | --- | --- |
| `@anthropic-ai/sandbox-runtime` | 0.0.26 | Apache-2.0 |
| `@aws-sdk/client-bedrock-runtime` | 3.1127.0 | Apache-2.0 |
| `@aws-sdk/core` | 3.977.9 | Apache-2.0 |
| `@aws-sdk/credential-provider-env` | 3.972.70 | Apache-2.0 |
| `@aws-sdk/credential-provider-http` | 3.972.72 | Apache-2.0 |
| `@aws-sdk/credential-provider-ini` | 3.973.15 | Apache-2.0 |
| `@aws-sdk/credential-provider-login` | 3.972.77 | Apache-2.0 |
| `@aws-sdk/credential-provider-node` | 3.972.82 | Apache-2.0 |
| `@aws-sdk/credential-provider-process` | 3.972.70 | Apache-2.0 |
| `@aws-sdk/credential-provider-sso` | 3.973.14 | Apache-2.0 |
| `@aws-sdk/credential-provider-web-identity` | 3.972.76 | Apache-2.0 |
| `@aws-sdk/eventstream-handler-node` | 3.972.34 | Apache-2.0 |
| `@aws-sdk/middleware-eventstream` | 3.972.29 | Apache-2.0 |
| `@aws-sdk/middleware-websocket` | 3.972.52 | Apache-2.0 |
| `@aws-sdk/nested-clients` | 3.997.44 | Apache-2.0 |
| `@aws-sdk/signature-v4-multi-region` | 3.996.46 | Apache-2.0 |
| `@aws-sdk/token-providers` | 3.1116.0 | Apache-2.0 |
| `@aws-sdk/token-providers` | 3.1127.0 | Apache-2.0 |
| `@aws-sdk/types` | 3.974.5 | Apache-2.0 |
| `@aws-sdk/xml-builder` | 3.972.40 | Apache-2.0 |
| `@aws/lambda-invoke-store` | 0.3.0 | Apache-2.0 |
| `@earendil-works/gondolin` | 0.12.0 | Apache-2.0 |
| `@earendil-works/gondolin-krun-runner-darwin-arm64` | 0.12.0 | Apache-2.0 |
| `@earendil-works/gondolin-krun-runner-linux-x64` | 0.12.0 | Apache-2.0 |
| `@google/genai` | 2.21.0 | Apache-2.0 |
| `@malept/cross-spawn-promise` | 2.0.0 | Apache-2.0 |
| `@playwright/test` | 1.64.1 | Apache-2.0 |
| `@silvia-odwyer/photon-node` | 0.3.4 | Apache-2.0 |
| `@smithy/core` | 3.33.3 | Apache-2.0 |
| `@smithy/credential-provider-imds` | 4.5.2 | Apache-2.0 |
| `@smithy/fetch-http-handler` | 5.8.0 | Apache-2.0 |
| `@smithy/node-http-handler` | 4.12.1 | Apache-2.0 |
| `@smithy/signature-v4` | 5.7.3 | Apache-2.0 |
| `@smithy/types` | 4.18.0 | Apache-2.0 |
| `@typescript/typescript-aix-ppc64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-darwin-x64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-freebsd-arm64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-freebsd-x64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-arm` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-arm64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-loong64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-mips64el` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-ppc64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-riscv64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-s390x` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-linux-x64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-netbsd-arm64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-netbsd-x64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-openbsd-arm64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-openbsd-x64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-sunos-x64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-win32-arm64` | 7.0.2 | Apache-2.0 |
| `@typescript/typescript-win32-x64` | 7.0.2 | Apache-2.0 |
| `baseline-browser-mapping` | 2.11.29 | Apache-2.0 |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `ecdsa-sig-formatter` | 1.0.11 | Apache-2.0 |
| `ejs` | 3.1.10 | Apache-2.0 |
| `expect-type` | 1.4.0 | Apache-2.0 |
| `exponential-backoff` | 3.1.3 | Apache-2.0 |
| `filelist` | 1.0.6 | Apache-2.0 |
| `gaxios` | 7.1.4 | Apache-2.0 |
| `gcp-metadata` | 8.1.2 | Apache-2.0 |
| `google-auth-library` | 10.6.2 | Apache-2.0 |
| `google-logging-utils` | 1.1.3 | Apache-2.0 |
| `grok-mermaid` | 0.2.3 | Apache-2.0 |
| `jake` | 10.9.4 | Apache-2.0 |
| `long` | 5.3.2 | Apache-2.0 |
| `openai` | 7.19.0 | Apache-2.0 |
| `playwright` | 1.64.1 | Apache-2.0 |
| `playwright-core` | 1.64.1 | Apache-2.0 |
| `sumchecker` | 3.0.1 | Apache-2.0 |
| `typescript` | 7.0.2 | Apache-2.0 |

### BlueOak-1.0.0 (9)

| Package | Version | Licence |
| --- | --- | --- |
| `chownr` | 3.0.0 | BlueOak-1.0.0 |
| `isexe` | 3.1.5 | BlueOak-1.0.0 |
| `isexe` | 4.0.0 | BlueOak-1.0.0 |
| `lru-cache` | 11.4.0 | BlueOak-1.0.0 |
| `minimatch` | 10.2.6 | BlueOak-1.0.0 |
| `minipass` | 7.1.3 | BlueOak-1.0.0 |
| `sax` | 1.6.1 | BlueOak-1.0.0 |
| `tar` | 7.5.22 | BlueOak-1.0.0 |
| `yallist` | 5.0.0 | BlueOak-1.0.0 |

### BSD-2-Clause (6)

| Package | Version | Licence |
| --- | --- | --- |
| `@electron-internal/extract-zip` | 1.0.5 | BSD-2-Clause |
| `@electron/osx-sign` | 1.3.3 | BSD-2-Clause |
| `@electron/windows-sign` | 1.2.2 | BSD-2-Clause |
| `dotenv` | 16.6.1 | BSD-2-Clause |
| `dotenv-expand` | 11.0.7 | BSD-2-Clause |
| `http-cache-semantics` | 4.3.0 | BSD-2-Clause |

### BSD-3-Clause (24)

| Package | Version | Licence |
| --- | --- | --- |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/utf8` | 1.1.1 | BSD-3-Clause |
| `asn1js` | 3.1.0 | BSD-3-Clause |
| `bcrypt-pbkdf` | 1.0.2 | BSD-3-Clause |
| `buffer-equal-constant-time` | 1.0.1 | BSD-3-Clause |
| `bytestreamjs` | 2.0.1 | BSD-3-Clause |
| `diff` | 8.0.4 | BSD-3-Clause |
| `duplexer2` | 0.1.4 | BSD-3-Clause |
| `fast-uri` | 3.1.8 | BSD-3-Clause |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `highlight.js` | 10.7.3 | BSD-3-Clause |
| `pkijs` | 3.4.1 | BSD-3-Clause |
| `protobufjs` | 7.6.6 | BSD-3-Clause |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `source-map` | 0.6.1 | BSD-3-Clause |
| `source-map-js` | 1.2.2 | BSD-3-Clause |
| `sprintf-js` | 1.1.3 | BSD-3-Clause |

### CC-BY-4.0 (1)

| Package | Version | Licence |
| --- | --- | --- |
| `caniuse-lite` | 1.0.30001816 | CC-BY-4.0 |

### ISC (39)

| Package | Version | Licence |
| --- | --- | --- |
| `@isaacs/fs-minipass` | 4.0.1 | ISC |
| `abbrev` | 4.0.0 | ISC |
| `at-least-node` | 1.0.0 | ISC |
| `cliui` | 8.0.1 | ISC |
| `electron-to-chromium` | 1.5.459 | ISC |
| `fs.realpath` | 1.0.0 | ISC |
| `get-caller-file` | 2.0.5 | ISC |
| `glob` | 7.2.3 | ISC |
| `graceful-fs` | 4.2.11 | ISC |
| `hosted-git-info` | 4.1.0 | ISC |
| `hosted-git-info` | 9.0.3 | ISC |
| `inflight` | 1.0.6 | ISC |
| `inherits` | 2.0.4 | ISC |
| `isexe` | 2.0.0 | ISC |
| `json-stringify-safe` | 5.0.1 | ISC |
| `lru-cache` | 5.1.1 | ISC |
| `lru-cache` | 6.0.0 | ISC |
| `minimatch` | 3.1.5 | ISC |
| `minimatch` | 5.1.9 | ISC |
| `minimatch` | 9.0.9 | ISC |
| `nopt` | 9.0.0 | ISC |
| `once` | 1.4.0 | ISC |
| `picocolors` | 1.1.1 | ISC |
| `proc-log` | 6.1.0 | ISC |
| `rimraf` | 2.6.3 | ISC |
| `semver` | 5.7.2 | ISC |
| `semver` | 6.3.1 | ISC |
| `semver` | 7.7.4 | ISC |
| `semver` | 7.8.5 | ISC |
| `signal-exit` | 3.0.7 | ISC |
| `which` | 2.0.2 | ISC |
| `which` | 5.0.0 | ISC |
| `which` | 6.0.1 | ISC |
| `wrappy` | 1.0.2 | ISC |
| `y18n` | 5.0.8 | ISC |
| `yallist` | 3.1.1 | ISC |
| `yallist` | 4.0.0 | ISC |
| `yaml` | 2.9.0 | ISC |
| `yargs-parser` | 21.1.1 | ISC |

### MIT (357)

| Package | Version | Licence |
| --- | --- | --- |
| `@anthropic-ai/sdk` | 0.129.0 | MIT |
| `@anthropic-ai/sdk` | 0.52.0 | MIT |
| `@anthropic-ai/sdk` | 0.91.1 | MIT |
| `@babel/code-frame` | 7.29.7 | MIT |
| `@babel/compat-data` | 7.29.7 | MIT |
| `@babel/core` | 7.29.7 | MIT |
| `@babel/generator` | 7.29.8 | MIT |
| `@babel/helper-compilation-targets` | 7.29.7 | MIT |
| `@babel/helper-globals` | 7.29.7 | MIT |
| `@babel/helper-module-imports` | 7.29.7 | MIT |
| `@babel/helper-module-transforms` | 7.29.7 | MIT |
| `@babel/helper-plugin-utils` | 7.29.7 | MIT |
| `@babel/helper-string-parser` | 7.29.7 | MIT |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT |
| `@babel/helper-validator-option` | 7.29.7 | MIT |
| `@babel/helpers` | 7.29.10 | MIT |
| `@babel/parser` | 7.29.9 | MIT |
| `@babel/plugin-transform-arrow-functions` | 7.29.7 | MIT |
| `@babel/runtime` | 7.29.2 | MIT |
| `@babel/template` | 7.29.7 | MIT |
| `@babel/traverse` | 7.29.10 | MIT |
| `@babel/types` | 7.29.8 | MIT |
| `@cto.af/wtf8` | 0.0.5 | MIT |
| `@electron/asar` | 3.4.1 | MIT |
| `@electron/fuses` | 1.8.0 | MIT |
| `@electron/get` | 3.1.0 | MIT |
| `@electron/get` | 5.1.0 | MIT |
| `@electron/notarize` | 2.5.0 | MIT |
| `@electron/rebuild` | 4.2.1 | MIT |
| `@electron/universal` | 2.0.3 | MIT |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT |
| `@esbuild/android-arm` | 0.28.2 | MIT |
| `@esbuild/android-arm64` | 0.28.2 | MIT |
| `@esbuild/android-x64` | 0.28.2 | MIT |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT |
| `@esbuild/darwin-x64` | 0.28.2 | MIT |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT |
| `@esbuild/linux-arm` | 0.28.2 | MIT |
| `@esbuild/linux-arm64` | 0.28.2 | MIT |
| `@esbuild/linux-ia32` | 0.28.2 | MIT |
| `@esbuild/linux-loong64` | 0.28.2 | MIT |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT |
| `@esbuild/linux-s390x` | 0.28.2 | MIT |
| `@esbuild/linux-x64` | 0.28.2 | MIT |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT |
| `@esbuild/sunos-x64` | 0.28.2 | MIT |
| `@esbuild/win32-arm64` | 0.28.2 | MIT |
| `@esbuild/win32-ia32` | 0.28.2 | MIT |
| `@esbuild/win32-x64` | 0.28.2 | MIT |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT |
| `@jridgewell/remapping` | 2.3.5 | MIT |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT |
| `@malept/flatpak-bundler` | 0.4.0 | MIT |
| `@noble/hashes` | 1.8.0 | MIT |
| `@noble/hashes` | 2.4.0 | MIT |
| `@oxc-project/types` | 0.154.0 | MIT |
| `@peculiar/asn1-schema` | 2.11.0 | MIT |
| `@peculiar/json-schema` | 1.1.12 | MIT |
| `@peculiar/utils` | 2.0.3 | MIT |
| `@peculiar/webcrypto` | 1.7.1 | MIT |
| `@pondwader/socks5-server` | 1.0.10 | MIT |
| `@rolldown/binding-android-arm-eabi` | 1.2.14 | MIT |
| `@rolldown/binding-android-arm64` | 1.2.14 | MIT |
| `@rolldown/binding-darwin-arm64` | 1.2.14 | MIT |
| `@rolldown/binding-darwin-x64` | 1.2.14 | MIT |
| `@rolldown/binding-freebsd-x64` | 1.2.14 | MIT |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.14 | MIT |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.14 | MIT |
| `@rolldown/binding-linux-arm64-musl` | 1.2.14 | MIT |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.14 | MIT |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.14 | MIT |
| `@rolldown/binding-linux-x64-gnu` | 1.2.14 | MIT |
| `@rolldown/binding-linux-x64-musl` | 1.2.14 | MIT |
| `@rolldown/binding-openharmony-arm64` | 1.2.14 | MIT |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.14 | MIT |
| `@rolldown/binding-win32-x64-msvc` | 1.2.14 | MIT |
| `@rolldown/pluginutils` | 1.0.1 | MIT |
| `@sindresorhus/is` | 4.6.0 | MIT |
| `@stablelib/base64` | 1.0.1 | MIT |
| `@szmarczak/http-timer` | 4.0.6 | MIT |
| `@types/cacheable-request` | 6.0.3 | MIT |
| `@types/chai` | 5.2.3 | MIT |
| `@types/debug` | 4.1.13 | MIT |
| `@types/deep-eql` | 4.0.2 | MIT |
| `@types/estree` | 1.0.9 | MIT |
| `@types/fs-extra` | 9.0.13 | MIT |
| `@types/http-cache-semantics` | 4.2.0 | MIT |
| `@types/keyv` | 3.1.4 | MIT |
| `@types/lodash` | 4.17.24 | MIT |
| `@types/lodash-es` | 4.17.12 | MIT |
| `@types/ms` | 2.1.0 | MIT |
| `@types/node` | 22.19.19 | MIT |
| `@types/node` | 24.19.2 | MIT |
| `@types/react` | 19.3.0 | MIT |
| `@types/react-dom` | 19.3.0 | MIT |
| `@types/responselike` | 1.0.3 | MIT |
| `@types/retry` | 0.12.0 | MIT |
| `@vitejs/plugin-react` | 6.1.2 | MIT |
| `@vitest/mocker` | 5.0.5 | MIT |
| `@vitest/spy` | 5.0.5 | MIT |
| `@xmldom/xmldom` | 0.8.15 | MIT |
| `agent-base` | 7.1.4 | MIT |
| `agent-base` | 9.0.0 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ansi-regex` | 5.0.1 | MIT |
| `ansi-styles` | 4.3.0 | MIT |
| `app-builder-lib` | 26.15.3 | MIT |
| `asn1` | 0.2.6 | MIT |
| `assertion-error` | 2.0.1 | MIT |
| `async` | 3.2.6 | MIT |
| `async-exit-hook` | 2.0.1 | MIT |
| `asynckit` | 0.4.0 | MIT |
| `aws4` | 1.13.2 | MIT |
| `balanced-match` | 1.0.2 | MIT |
| `balanced-match` | 4.0.4 | MIT |
| `base64-js` | 1.5.1 | MIT |
| `bignumber.js` | 9.3.1 | MIT |
| `bluebird` | 3.7.2 | MIT |
| `boolean` | 3.2.0 | MIT |
| `bowser` | 2.14.1 | MIT |
| `brace-expansion` | 1.1.21 | MIT |
| `brace-expansion` | 2.1.7 | MIT |
| `brace-expansion` | 5.0.12 | MIT |
| `browserslist` | 4.29.3 | MIT |
| `buffer-from` | 1.1.2 | MIT |
| `builder-util` | 26.15.3 | MIT |
| `builder-util-runtime` | 9.7.0 | MIT |
| `cac` | 7.1.0 | MIT |
| `cacheable-lookup` | 5.0.4 | MIT |
| `cacheable-request` | 7.0.4 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `cbor2` | 2.3.0 | MIT |
| `chai` | 6.3.0 | MIT |
| `chalk` | 4.1.2 | MIT |
| `chalk` | 6.0.0 | MIT |
| `chromium-pickle-js` | 0.2.0 | MIT |
| `ci-info` | 4.3.1 | MIT |
| `ci-info` | 4.4.0 | MIT |
| `clone-response` | 1.0.3 | MIT |
| `color-convert` | 2.0.1 | MIT |
| `color-name` | 1.1.4 | MIT |
| `combined-stream` | 1.0.8 | MIT |
| `commander` | 12.1.0 | MIT |
| `commander` | 5.1.0 | MIT |
| `commander` | 9.5.0 | MIT |
| `compare-version` | 0.1.2 | MIT |
| `concat-map` | 0.0.1 | MIT |
| `convert-source-map` | 2.0.0 | MIT |
| `core-util-is` | 1.0.3 | MIT |
| `cross-dirname` | 0.1.0 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `csstype` | 3.2.3 | MIT |
| `data-uri-to-buffer` | 4.0.1 | MIT |
| `debug` | 4.4.3 | MIT |
| `decompress-response` | 6.0.0 | MIT |
| `defer-to-connect` | 2.0.1 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `delayed-stream` | 1.0.0 | MIT |
| `detect-node` | 2.1.0 | MIT |
| `dir-compare` | 4.2.0 | MIT |
| `dmg-builder` | 26.15.3 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `electron` | 44.9.0 | MIT |
| `electron-builder` | 26.15.3 | MIT |
| `electron-builder-squirrel-windows` | 26.15.3 | MIT |
| `electron-publish` | 26.15.3 | MIT |
| `electron-vite` | 6.0.0 | MIT |
| `electron-winstaller` | 5.4.0 | MIT |
| `emoji-regex` | 8.0.0 | MIT |
| `end-of-stream` | 1.4.5 | MIT |
| `env-paths` | 2.2.1 | MIT |
| `env-paths` | 3.0.0 | MIT |
| `err-code` | 2.0.3 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-module-lexer` | 2.3.2 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `es-set-tostringtag` | 2.1.0 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `escalade` | 3.2.0 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `estree-walker` | 3.0.3 | MIT |
| `extend` | 3.0.2 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fdir` | 6.5.0 | MIT |
| `fetch-blob` | 3.2.0 | MIT |
| `form-data` | 4.0.6 | MIT |
| `formdata-polyfill` | 4.0.10 | MIT |
| `fs-extra` | 10.1.0 | MIT |
| `fs-extra` | 11.3.1 | MIT |
| `fs-extra` | 11.4.1 | MIT |
| `fs-extra` | 7.0.1 | MIT |
| `fs-extra` | 8.1.0 | MIT |
| `fs-extra` | 9.1.0 | MIT |
| `fsevents` | 2.3.3 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `gensync` | 1.0.0-beta.2 | MIT |
| `get-east-asian-width` | 1.6.0 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `get-stream` | 5.2.0 | MIT |
| `globalthis` | 1.0.4 | MIT |
| `gopd` | 1.2.0 | MIT |
| `got` | 11.8.6 | MIT |
| `has-flag` | 4.0.0 | MIT |
| `has-property-descriptors` | 1.0.2 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `has-tostringtag` | 1.0.2 | MIT |
| `hasown` | 2.0.4 | MIT |
| `http-proxy-agent` | 7.0.2 | MIT |
| `http-proxy-agent` | 9.1.0 | MIT |
| `http2-wrapper` | 1.0.3 | MIT |
| `https-proxy-agent` | 7.0.6 | MIT |
| `https-proxy-agent` | 9.1.0 | MIT |
| `ignore` | 7.0.8 | MIT |
| `is-fullwidth-code-point` | 3.0.0 | MIT |
| `isarray` | 1.0.0 | MIT |
| `isbinaryfile` | 4.0.10 | MIT |
| `isbinaryfile` | 5.0.7 | MIT |
| `jiti` | 2.7.0 | MIT |
| `js-tokens` | 4.0.0 | MIT |
| `js-yaml` | 4.3.2 | MIT |
| `jsesc` | 3.1.0 | MIT |
| `json-bigint` | 1.0.0 | MIT |
| `json-buffer` | 3.0.1 | MIT |
| `json-schema-to-ts` | 3.1.1 | MIT |
| `json-schema-traverse` | 1.0.0 | MIT |
| `json5` | 2.2.3 | MIT |
| `jsonfile` | 4.0.0 | MIT |
| `jsonfile` | 6.2.1 | MIT |
| `jwa` | 2.0.1 | MIT |
| `jws` | 4.0.1 | MIT |
| `keyv` | 4.5.4 | MIT |
| `lazy-val` | 1.0.5 | MIT |
| `lodash` | 4.18.1 | MIT |
| `lodash-es` | 4.18.1 | MIT |
| `lowercase-keys` | 2.0.0 | MIT |
| `magic-string` | 1.4.3 | MIT |
| `marked` | 18.0.11 | MIT |
| `matcher` | 3.0.0 | MIT |
| `math-intrinsics` | 1.1.0 | MIT |
| `mime` | 2.6.0 | MIT |
| `mime-db` | 1.52.0 | MIT |
| `mime-types` | 2.1.35 | MIT |
| `mimic-response` | 1.0.1 | MIT |
| `mimic-response` | 3.1.0 | MIT |
| `minimist` | 1.2.8 | MIT |
| `minizlib` | 3.1.0 | MIT |
| `mkdirp` | 0.5.6 | MIT |
| `ms` | 2.1.3 | MIT |
| `nan` | 2.27.0 | MIT |
| `nanoid` | 3.3.20 | MIT |
| `node-abi` | 4.38.0 | MIT |
| `node-api-version` | 0.2.1 | MIT |
| `node-domexception` | 1.0.0 | MIT |
| `node-fetch` | 3.3.2 | MIT |
| `node-gyp` | 12.4.0 | MIT |
| `node-int64` | 0.4.0 | MIT |
| `node-releases` | 2.0.59 | MIT |
| `normalize-url` | 6.1.0 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `obug` | 3.0.0 | MIT |
| `p-cancelable` | 2.1.1 | MIT |
| `p-limit` | 3.1.0 | MIT |
| `p-retry` | 4.6.2 | MIT |
| `partial-json` | 0.1.7 | MIT |
| `path-is-absolute` | 1.0.1 | MIT |
| `path-key` | 3.1.1 | MIT |
| `pe-library` | 0.4.1 | MIT |
| `picomatch` | 4.0.7 | MIT |
| `plist` | 3.1.0 | MIT |
| `postcss` | 8.5.30 | MIT |
| `postject` | 1.0.0-alpha.6 | MIT |
| `process-nextick-args` | 2.0.1 | MIT |
| `progress` | 2.0.3 | MIT |
| `promise-retry` | 2.0.1 | MIT |
| `proper-lockfile` | 4.1.2 | MIT |
| `proxy-agent-negotiate` | 1.1.0 | MIT |
| `pump` | 3.0.4 | MIT |
| `pvtsutils` | 1.3.6 | MIT |
| `pvutils` | 1.2.0 | MIT |
| `quick-lru` | 5.1.1 | MIT |
| `quickjs-wasi` | 3.6.2 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `read-binary-file-arch` | 1.0.6 | MIT |
| `readable-stream` | 2.3.8 | MIT |
| `require-directory` | 2.1.1 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `resedit` | 1.7.2 | MIT |
| `resolve-alpn` | 1.2.1 | MIT |
| `responselike` | 2.0.1 | MIT |
| `retry` | 0.12.0 | MIT |
| `retry` | 0.13.1 | MIT |
| `rolldown` | 1.2.14 | MIT |
| `safe-buffer` | 5.1.2 | MIT |
| `safe-buffer` | 5.2.1 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `scheduler` | 0.28.0 | MIT |
| `semver-compare` | 1.0.0 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `shell-quote` | 1.12.0 | MIT |
| `simple-update-notifier` | 2.0.0 | MIT |
| `source-map-support` | 0.5.21 | MIT |
| `standardwebhooks` | 1.1.1 | MIT |
| `stat-mode` | 1.0.0 | MIT |
| `std-env` | 4.3.0 | MIT |
| `string_decoder` | 1.1.1 | MIT |
| `string-width` | 4.2.3 | MIT |
| `strip-ansi` | 6.0.1 | MIT |
| `supports-color` | 7.2.0 | MIT |
| `temp` | 0.9.4 | MIT |
| `temp-file` | 3.4.0 | MIT |
| `tiny-async-pool` | 1.3.0 | MIT |
| `tinybench` | 6.2.2 | MIT |
| `tinyexec` | 1.3.1 | MIT |
| `tinyglobby` | 0.2.17 | MIT |
| `tmp` | 0.2.7 | MIT |
| `tmp-promise` | 3.0.3 | MIT |
| `ts-algebra` | 2.0.0 | MIT |
| `typebox` | 1.1.38 | MIT |
| `typebox` | 1.3.27 | MIT |
| `undici` | 6.29.0 | MIT |
| `undici` | 6.29.1 | MIT |
| `undici` | 7.30.1 | MIT |
| `undici` | 8.10.2 | MIT |
| `undici-types` | 6.21.0 | MIT |
| `undici-types` | 7.24.6 | MIT |
| `universalify` | 0.1.2 | MIT |
| `universalify` | 2.0.1 | MIT |
| `unzipper` | 0.12.5 | MIT |
| `update-browserslist-db` | 1.3.4 | MIT |
| `util-deprecate` | 1.0.2 | MIT |
| `vite` | 8.3.4 | MIT |
| `vitest` | 5.0.5 | MIT |
| `web-streams-polyfill` | 3.3.3 | MIT |
| `webcrypto-core` | 1.9.2 | MIT |
| `why-is-node-running` | 3.2.1 | MIT |
| `wrap-ansi` | 7.0.0 | MIT |
| `ws` | 8.21.0 | MIT |
| `xmlbuilder` | 15.1.1 | MIT |
| `yargs` | 17.7.3 | MIT |
| `yocto-queue` | 0.1.0 | MIT |
| `zod` | 3.25.76 | MIT |

### MPL-2.0 (12)

| Package | Version | Licence |
| --- | --- | --- |
| `lightningcss` | 1.33.0 | MPL-2.0 |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 |

### Python-2.0 (1)

| Package | Version | Licence |
| --- | --- | --- |
| `argparse` | 2.0.1 | Python-2.0 |

### Unlicense (2)

| Package | Version | Licence |
| --- | --- | --- |
| `fast-sha256` | 1.3.0 | Unlicense |
| `tweetnacl` | 0.14.5 | Unlicense |

### WTFPL (1)

| Package | Version | Licence |
| --- | --- | --- |
| `truncate-utf8-bytes` | 1.0.2 | WTFPL |

### WTFPL OR ISC (1)

| Package | Version | Licence |
| --- | --- | --- |
| `sanitize-filename` | 1.6.4 | WTFPL OR ISC |

### unrecorded (3)

| Package | Version | Licence |
| --- | --- | --- |
| `buildcheck` | 0.0.7 | unrecorded |
| `cpu-features` | 0.0.10 | unrecorded |
| `ssh2` | 1.17.0 | unrecorded |
