// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The npm package the build produces and the paths the commands look for, checked against each other.
 *
 * `kyrn/bin/kyrn-doctor` runs inside the installed package and asks the kernel what the key store is — by spawning a
 * built entry. It looked for `judge/dist/setup/secret-cli.js`, a path that only the kernel's `tsc` layout has ever had;
 * `kyrn/npm/build.mjs` bundles a flat `judge/dist/*.js` set instead, so in an installed mu the doctor could only say
 * "this mu does not carry the kernel build that knows the store". True of the package, false of the build, and nothing
 * compared the two lists. This test does, without building anything.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const BUILD = join(ROOT, "kyrn", "npm", "build.mjs");
/** The two programs that run *inside* the installed package and reach for the kernel's built entries by path. */
const CONSUMERS = [join(ROOT, "kyrn", "bin", "kyrn-doctor"), join(ROOT, "kyrn", "bin", "agent.mjs")];

/** The entry names the package build writes into `judge/dist/`. */
export function bundledJudgeEntries(buildSource) {
	const found = new Set();
	for (const block of buildSource.matchAll(/entryPoints:\s*\{([^}]*)\}/g)) {
		for (const key of (block[1] ?? "").matchAll(/(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g)) found.add(key[1] ?? key[2]);
	}
	return found;
}

/**
 * The flat `judge/dist/<name>.js` files a launcher or the doctor spawns, ignoring nested legacy layouts — except the one
 * nested layout that is current: `judge/dist/setup/bundle-cli.js`, which `mu doctor --bundle` looks for and which a
 * flat-only parser would miss (the same shape of miss as the flat entries this file was written for).
 */
export function judgeDistPaths(source) {
	const found = new Set();
	for (const match of source.matchAll(/"judge",\s*"dist",\s*(?:"setup",\s*)?"([^"/]+)\.js"/g)) found.add(match[1]);
	return found;
}

test("every built judge entry the package's own programs look for is one the build makes", () => {
	const entries = bundledJudgeEntries(readFileSync(BUILD, "utf8"));
	const wanted = new Set();
	for (const file of CONSUMERS) {
		for (const name of judgeDistPaths(readFileSync(file, "utf8"))) wanted.add(name);
	}
	assert.ok(wanted.size > 1, "the launcher and the doctor together look for several built entries");
	const missing = [...wanted].filter((name) => !entries.has(name));
	assert.deepEqual(missing, [], `the package build does not make judge/dist/${missing.join(".js, judge/dist/")}.js`);
});

test("the package build keeps making the entries a person is sent to by hand", () => {
	// The two regressions this file exists for: neither entry was ever bundled, so `mu doctor` answered "unknown" and
	// `mu migrate --credentials` answered "this one does not have it" in every installed package.
	const entries = bundledJudgeEntries(readFileSync(BUILD, "utf8"));
	for (const name of ["secret-cli", "credentials-cli", "bundle-cli"]) {
		assert.ok(entries.has(name), `kyrn/npm/build.mjs no longer bundles judge/dist/${name}.js`);
	}
});

test("the parser finds the entries and paths it is supposed to", () => {
	const entries = bundledJudgeEntries('entryPoints: { "kyrn-judge": x, chrome: y, setup: z }');
	assert.deepEqual([...entries].sort(), ["chrome", "kyrn-judge", "setup"]);
	const paths = judgeDistPaths('join(root, "judge", "dist", "secret-cli.js"); join(root, "judge", "dist", "setup", "secret-cli.js")');
	assert.deepEqual([...paths], ["secret-cli"], "a nested legacy path is not a flat entry name");
});
