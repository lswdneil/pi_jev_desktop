// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The packaged-artifact gate, on layouts built in a temporary folder.
 *
 * The first real package this repository built carried 243 MB of toolchain inside `app.asar`: nothing in the build
 * complains, so the gate has to. Boring sizes here would be a checked-in 243 MB fixture, so the archive is a declared
 * size and the layout is the part under test.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { ASAR_BUDGET_BYTES, describePackage, INSTALLER_BUDGET_BYTES, packageProblems } from "./check-package.mjs";

const dirs = [];
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** A `dist` folder with one Windows layout; `files` are written beside the archive under `resources/`. */
function dist({ archive = 1024, extra = {}, harness = false, harnessManifest, harnessModules = [] } = {}) {
	const directory = mkdtempSync(join(tmpdir(), "mu-dist-"));
	dirs.push(directory);
	const resources = join(directory, "win-unpacked", "resources");
	mkdirSync(resources, { recursive: true });
	writeFileSync(join(directory, "win-unpacked", "spec.ai.jev.exe"), "MZ");
	writeFileSync(join(resources, "app.asar"), Buffer.alloc(archive, 0));
	for (const [name, content] of Object.entries(extra)) writeFileSync(join(resources, name), content);
	if (harness) {
		const root = join(resources, "harness", "mu-agent");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "package.json"), JSON.stringify(harnessManifest ?? {}));
		for (const module of harnessModules) {
			mkdirSync(join(root, "node_modules", module), { recursive: true });
			writeFileSync(join(root, "node_modules", module, "package.json"), "{}");
		}
	}
	return directory;
}

test("a small package with its executable passes", () => {
	assert.deepEqual(packageProblems(dist()), []);
});

test("an archive that carries a toolchain is over budget and named", () => {
	const problems = packageProblems(dist({ archive: ASAR_BUDGET_BYTES + 1 }));
	assert.match(problems.join("\n"), /app\.asar is 8\.0 MB, over its 8 MB budget/);
});

test("a package without an executable or without an archive is not a package", () => {
	const directory = mkdtempSync(join(tmpdir(), "mu-dist-"));
	dirs.push(directory);
	mkdirSync(join(directory, "dist"), { recursive: true });
	assert.match(packageProblems(directory).join("\n"), /no packaged layout/);

	const noArchive = dist();
	rmSync(join(noArchive, "win-unpacked", "spec.ai.jev.exe"));
	assert.match(packageProblems(noArchive).join("\n"), /no spec\.ai\.jev\.exe/);

	const emptyArchive = dist();
	rmSync(join(emptyArchive, "win-unpacked", "resources", "app.asar"));
	assert.match(packageProblems(emptyArchive).join("\n"), /no resources\/app\.asar/);
});

test("a credentials file inside the package is refused by name", () => {
	const problems = packageProblems(dist({ extra: { ".env": "MU_JUDGE_API_KEY=x" } }));
	assert.match(problems.join("\n"), /\.env is a credentials file by name/);
});

test("a harness without the dependencies it declares is caught", () => {
	const manifest = { dependencies: { jiti: "2.7.0" } };
	const missing = packageProblems(dist({ harness: true, harnessManifest: manifest }), { requireHarness: true });
	assert.match(missing.join("\n"), /the harness needs jiti in its node_modules and the package does not carry it/);

	const complete = packageProblems(dist({ harness: true, harnessManifest: manifest, harnessModules: ["jiti"] }), { requireHarness: true });
	assert.deepEqual(complete, []);
});

test("a missing harness fails where the release asks for one, and is a note elsewhere", () => {
	const directory = dist();
	assert.deepEqual(packageProblems(directory), []);
	assert.match(packageProblems(directory, { requireHarness: true }).join("\n"), /no resources\/harness\/mu-agent/);
	assert.match(describePackage(directory)[0], /no harness \(a local --dir build does not stage one\)/);

	const staged = dist({ harness: true });
	assert.deepEqual(packageProblems(staged, { requireHarness: true }), []);
	assert.match(describePackage(staged, { requireHarness: true })[0], /harness staged/);
});

// The installer is what a user downloads, and its size is the shell decision's own threshold: a target that declared
// two architectures built a 237 MB combined installer, over the line, without anyone deciding to cross it.
test("an installer over the budget is named, and a release without one is a failure when asked", () => {
	const withInstaller = dist();
	writeFileSync(join(withInstaller, "mu-0.1.8-x64.exe"), Buffer.alloc(2048, 0));
	assert.deepEqual(packageProblems(withInstaller, { requireInstaller: true }), []);
	assert.match(describePackage(withInstaller, { requireInstaller: true }).join("\n"), /mu-0\.1\.8-x64\.exe: 0\.0 MB installer/);

	const noInstaller = dist();
	assert.match(packageProblems(noInstaller, { requireInstaller: true }).join("\n"), /no installer \(\.exe, \.dmg, \.zip, \.AppImage, \.deb\)/);
	assert.deepEqual(packageProblems(noInstaller), [], "a --dir build has no installer and is not wrong for it");

	const tooBig = dist();
	writeFileSync(join(tooBig, "mu-0.1.8.exe"), Buffer.alloc(INSTALLER_BUDGET_BYTES + 1, 0));
	assert.match(packageProblems(tooBig).join("\n"), /over the 180 MB installer budget that keeps the shell decision valid/);
});

// The harness inside the package is built from the workspace sources. A staged harness older than the sources would
// put old kernel code inside a freshly packed installer, and no size or dependency check notices.
test("a staged harness older than the workspace sources is refused, and a current one passes", () => {
	const root = mkdtempSync(join(tmpdir(), "mu-harness-"));
	dirs.push(root);
	const shell = join(root, "desktop-next");
	const directory = join(shell, "dist");
	const source = join(root, "packages", "kyrn-judge", "src", "later.ts");
	const manifest = join(root, "packages", "kyrn-judge", "manifest.json");
	mkdirSync(join(source, ".."), { recursive: true });
	writeFileSync(source, "// newer than the staged harness");
	writeFileSync(manifest, "{}");
	const harness = join(root, ".artifacts", "desktop-harness", "mu-agent");
	mkdirSync(harness, { recursive: true });
	writeFileSync(join(harness, "package.json"), "{}");
	// The package itself is written last, so only the harness check is what this test exercises.
	const resources = join(directory, "win-unpacked", "resources");
	mkdirSync(resources, { recursive: true });
	writeFileSync(join(directory, "win-unpacked", "spec.ai.jev.exe"), "MZ");
	writeFileSync(join(resources, "app.asar"), Buffer.alloc(1024, 0));

	const later = new Date(Date.now() + 60_000);
	utimesSync(source, later, later);
	assert.match(
		packageProblems(directory).join("\n"),
		/desktop-harness[\\/]mu-agent is older than .*later\.ts: the package would bundle a harness built before the sources/,
	);
	assert.deepEqual(packageProblems(directory, { allowStale: true }), []);

	const earlier = new Date("2026-10-01T00:00:00Z");
	utimesSync(source, earlier, earlier);
	assert.deepEqual(packageProblems(directory), []);
});

// A package is a claim about the code it contains. When the build it should hold is newer than the artifact, the
// numbers describe a program nobody has any more — the same reason the coverage and size gates refuse stale inputs.
test("a package older than its build inputs is refused, and --allow-stale inspects it anyway", () => {
	const root = mkdtempSync(join(tmpdir(), "mu-shell-"));
	dirs.push(root);
	const shell = join(root, "desktop-next");
	const directory = join(shell, "dist");
	const resources = join(directory, "win-unpacked", "resources");
	mkdirSync(resources, { recursive: true });
	writeFileSync(join(directory, "win-unpacked", "spec.ai.jev.exe"), "MZ");
	writeFileSync(join(resources, "app.asar"), Buffer.alloc(1024, 0));

	const built = join(shell, "out", "main", "index.js");
	mkdirSync(join(built, ".."), { recursive: true });
	writeFileSync(built, "// the current build");
	const later = new Date(Date.now() + 60_000);
	utimesSync(built, later, later);
	assert.match(packageProblems(directory).join("\n"), /older than .*out[\\/]main[\\/]index\.js: it does not contain the current build/);
	assert.deepEqual(packageProblems(directory, { allowStale: true }), []);

	// The same package with an older build is what a package built after the build looks like.
	const earlier = new Date("2026-10-01T00:00:00Z");
	utimesSync(built, earlier, earlier);
	assert.deepEqual(packageProblems(directory), []);
});
