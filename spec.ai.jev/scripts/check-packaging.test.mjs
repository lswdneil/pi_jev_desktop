// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The packaging check, on the repository and on the ways it can drift.
 *
 * Each test changes one line of the configuration and expects the rule that guards it to say so by name, because a
 * packaging mistake has no other symptom until a release is built.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { packagingProblems } from "./check-packaging.mjs";

const ROOT = join(import.meta.dirname, "..");
const PATHS = [
	"desktop-next/electron-builder.yml",
	"desktop-next/package.json",
	"desktop-next/src/main/harness.ts",
	"desktop-next/src/main/update.ts",
	".github/workflows/desktop-package.yml",
];

/** A reader over the real files, with the overrides a test asks for. */
function files(overrides = {}) {
	const content = {};
	for (const path of PATHS) content[path] = readFileSync(join(ROOT, path), "utf8");
	return (path) => (path in overrides ? overrides[path] : content[path]);
}

function replaced(path, from, to) {
	const original = readFileSync(join(ROOT, path), "utf8");
	assert.ok(original.includes(from), `${path} no longer contains ${JSON.stringify(from)}`);
	return files({ [path]: original.replace(from, to) });
}

test("the repository's packaging configuration agrees with its code", () => {
	assert.deepEqual(packagingProblems(files()), []);
});

test("a harness folder in the wrong place inside the app is caught", () => {
	const problems = packagingProblems(replaced("desktop-next/electron-builder.yml", "to: harness", "to: harness-elsewhere"));
	assert.match(problems.join("\n"), /no extraResources entry copies into harness\//);
});

test("a mismatch between what the workflow stages and what is copied in is caught", () => {
	const problems = packagingProblems(replaced("desktop-next/electron-builder.yml", "from: ../.artifacts/desktop-harness", "from: ../.artifacts/harness"));
	assert.match(problems.join("\n"), /the workflow stages \.\.\/\.artifacts\/desktop-harness\/spec-ai-agent/);
});

test("a workflow that stops installing the harness's dependencies is caught", () => {
	const problems = packagingProblems(replaced(".github/workflows/desktop-package.yml", "npm install --omit=dev --ignore-scripts", "npm install --ignore-scripts"));
	assert.match(problems.join("\n"), /the harness's own dependencies are not installed into the staged folder/);
});

test("a workflow that stops staging the harness is caught", () => {
	const problems = packagingProblems(
		replaced(".github/workflows/desktop-package.yml", "mv .artifacts/npm/spec-ai-agent .artifacts/desktop-harness/spec-ai-agent", "mv .artifacts/npm/spec-ai-agent .artifacts/harness"),
	);
	assert.match(problems.join("\n"), /nothing stages \.artifacts\/desktop-harness\/spec-ai-agent/);
});

test("an update feed pointing at another repository than the publish settings is caught", () => {
	const problems = packagingProblems(
		replaced(
			"desktop-next/src/main/update.ts",
			"https://github.com/lswdneil/pi_jev_desktop/releases",
			"https://github.com/someone/mu/releases",
		),
	);
	assert.match(problems.join("\n"), /publish is lswdneil\/pi_jev_desktop, but the app reads its feed from someone\/mu/);
});

test("shipping the sources in the archive is caught", () => {
	const problems = packagingProblems(
		replaced("desktop-next/electron-builder.yml", "  - out/**/*", "  - out/**/*\n  - src/**/*"),
	);
	assert.match(problems.join("\n"), /files ships src\/\*\*\/\*, and the sources are not what a user installs/);
});

test("a target that is built but not uploaded is caught, and so is one that is no longer built", () => {
	const problems = packagingProblems(
		replaced(".github/workflows/desktop-package.yml", "            desktop-next/dist/*.zip\n", ""),
	);
	assert.match(problems.join("\n"), /a zip installer is built but desktop-next\/dist\/\*\.zip is not uploaded/);
});

test("signatures that are made but not uploaded are caught", () => {
	const problems = packagingProblems(replaced(".github/workflows/desktop-package.yml", "            desktop-next/dist/*.sig\n", ""));
	assert.match(problems.join("\n"), /the installers are signed but desktop-next\/dist\/\*\.sig is not uploaded/);
});

test("a target that declares its architectures is caught", () => {
	const problems = packagingProblems(
		replaced("desktop-next/electron-builder.yml", "    - target: nsis", "    - target: nsis\n      arch: [x64, arm64]"),
	);
	assert.match(problems.join("\n"), /declares arch \["x64","arm64"\], which builds one combined installer/);
});

test("a packager that npx would download is caught", () => {
	const pinned = readFileSync(join(ROOT, "desktop-next/package.json"), "utf8");
	const problems = packagingProblems(files({ "desktop-next/package.json": pinned.replace(/"electron-builder": "[^"]+"/, '"electron-builder": "^26.15.3"') }));
	assert.match(problems.join("\n"), /not an exact version/);

	const missing = packagingProblems(files({ "desktop-next/package.json": pinned.replace(/,\n\t\t"electron-builder": "[^"]+"/, "") }));
	assert.match(missing.join("\n"), /electron-builder is not a devDependency/);
});

test("an install that is not from the lockfile, and a packager that npx would download, are both caught", () => {
	const ci = packagingProblems(replaced(".github/workflows/desktop-package.yml", "npm ci --ignore-scripts", "npm install --ignore-scripts"));
	assert.match(ci.join("\n"), /not installed from the lockfile/);

	const bare = packagingProblems(replaced(".github/workflows/desktop-package.yml", "npm run package -- --${{ matrix.platform }}", "npx electron-builder --${{ matrix.platform }}"));
	assert.match(bare.join("\n"), /bare npx/);
});

test("a runtime dependency that would be packed into the archive is caught", () => {
	const packageJson = readFileSync(join(ROOT, "desktop-next/package.json"), "utf8");
	const withDependency = JSON.parse(packageJson);
	withDependency.dependencies = { "@earendil-works/pi-coding-agent": "file:../packages/coding-agent" };
	const problems = packagingProblems(files({ "desktop-next/package.json": JSON.stringify(withDependency, null, "\t") }));
	assert.match(problems.join("\n"), /is a runtime dependency, so it would be packed into the app archive/);
});

test("a file that is not YAML is one problem, not a crash", () => {
	const problems = packagingProblems(files({ "desktop-next/electron-builder.yml": "win: [\n" }));
	assert.equal(problems.length, 1);
	assert.match(problems[0], /electron-builder\.yml/);
});

test("a configuration electron-builder itself rejects is reported with its reason", () => {
	const rejection = new Error("Invalid configuration object.\n - configuration.mac should be one of these: null");
	const problems = packagingProblems(files(), {
		validator: {
			validate: () => {
				throw rejection;
			},
		},
	});
	assert.match(problems.join("\n"), /electron-builder rejects this configuration/);
	assert.match(problems.join("\n"), /configuration\.mac should be one of these/);
});

test("the validator is given the configuration that was parsed, and a valid one adds nothing", () => {
	const seen = [];
	const problems = packagingProblems(files(), {
		validator: {
			validate: (configuration) => {
				seen.push(configuration);
			},
		},
	});
	assert.deepEqual(problems, []);
	assert.equal(seen.length, 1);
	assert.equal(seen[0].appId, "ai.spec.jev");
	assert.equal(seen[0].mac.entitlementsInherit, "build/entitlements.mac.plist");
});
