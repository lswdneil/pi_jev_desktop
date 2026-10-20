import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	BASELINE_PATH,
	exampleExact,
	lockfileProblems,
	pinnedDependencyProblems,
} from "./check-pinned-deps.mjs";

const dirs = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root, path, value) {
	const full = join(root, path);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, typeof value === "string" ? value : `${JSON.stringify(value, null, "\t")}\n`);
}

function fixture(files) {
	const root = mkdtempSync(join(tmpdir(), "mu-pinned-"));
	dirs.push(root);
	write(root, "package.json", { name: "root", version: "0.0.1", workspaces: ["packages/*"], dependencies: {} });
	for (const [path, value] of Object.entries(files)) write(root, path, value);
	return root;
}

describe("pinned dependencies", () => {
	it("fails a new caret range and says what the fix looks like", () => {
		const root = fixture({ "packages/one/package.json": { name: "one", dependencies: { left: "^1.2.3" } } });
		const { failures } = pinnedDependencyProblems({ root });
		assert.equal(failures.length, 1);
		assert.match(failures[0], /left is \^1\.2\.3/);
		assert.match(failures[0], /Use the exact version \(1\.2\.3\)/);
		assert.equal(exampleExact("~2.0.0"), "2.0.0");
		assert.equal(exampleExact("*"), "<the resolved version>");
	});

	it("lets the frozen desktop shell keep the ranges it had, and refuses a new one", () => {
		const root = fixture({
			[".pinned-baseline.json"]: { ranges: ["desktop:dependencies.react"] },
			"desktop/package.json": { name: "desktop", dependencies: { react: "^18.3.1" } },
		});
		// The baseline is passed in, the way the check loads its own file.
		const baseline = new Set(["desktop:dependencies.react"]);
		const allowed = pinnedDependencyProblems({ root, baseline });
		assert.deepEqual(allowed.failures, []);

		write(root, "desktop/package.json", { name: "desktop", dependencies: { react: "^18.3.1", lodash: "^4.17.21" } });
		const withNewRange = pinnedDependencyProblems({ root, baseline });
		assert.equal(withNewRange.failures.length, 1);
		assert.match(withNewRange.failures[0], /lodash/);
		assert.ok(BASELINE_PATH.endsWith("pinned-deps-desktop-baseline.json"));
	});

	it("holds a nested desktop package to the same whitelist, and reports entries that can be removed", () => {
		const root = fixture({
			"desktop/package.json": { name: "desktop", dependencies: { react: "18.3.1" } },
			"desktop/packages/web/package.json": { name: "web", devDependencies: { vite: "^5.0.0" } },
		});
		const staleBaseline = new Set(["desktop:dependencies.react", "desktop/packages/web:devDependencies.vite"]);
		const { failures, stale } = pinnedDependencyProblems({ root, baseline: staleBaseline });
		assert.deepEqual(failures, []);
		// `react` is pinned now, so its whitelist entry is dead weight and is reported.
		assert.deepEqual(stale, ["desktop:dependencies.react"]);
	});

	it("holds desktop-next to the strict rule once it exists", () => {
		const root = fixture({ "desktop-next/package.json": { name: "mu-desktop", dependencies: { electron: "^33.0.0" } } });
		const { failures } = pinnedDependencyProblems({ root });
		assert.equal(failures.length, 1);
		assert.match(failures[0], /desktop-next\/package\.json/);
	});

	it("ignores internal workspace dependencies and non-registry specifiers", () => {
		const root = fixture({
			"packages/one/package.json": {
				name: "one",
				dependencies: {
					"@earendil-works/pi-ai": "^1.0.2",
					"@earendil-works/chord": "^1.0.2",
					local: "file:../two",
					forked: "github:owner/repo",
				},
			},
		});
		assert.deepEqual(pinnedDependencyProblems({ root }).failures, []);
	});
});

describe("lockfile consistency", () => {
	it("fails a manifest that the lockfile does not describe", () => {
		const root = fixture({ "packages/one/package.json": { name: "one", version: "1.0.0", dependencies: {} } });
		write(root, "package-lock.json", {
			name: "root",
			lockfileVersion: 3,
			packages: { "": { name: "root", version: "0.0.1", dependencies: {} } },
		});
		const problems = lockfileProblems({ root });
		assert.equal(problems.length, 1);
		assert.match(problems[0], /no entry for packages\/one/);
	});

	it("fails a version or specifier the lockfile does not match", () => {
		const root = fixture({ "packages/one/package.json": { name: "one", version: "1.0.1", dependencies: { left: "1.2.3" } } });
		write(root, "package-lock.json", {
			name: "root",
			lockfileVersion: 3,
			packages: {
				"": { name: "root", version: "0.0.1", dependencies: {} },
				"packages/one": { name: "one", version: "1.0.0", dependencies: { left: "1.2.0" } },
				"node_modules/left": { version: "1.2.0" },
			},
		});
		const problems = lockfileProblems({ root });
		assert.equal(problems.length, 2);
		assert.ok(problems.some((problem) => /manifest version 1\.0\.1, lockfile 1\.0\.0/.test(problem)));
		assert.ok(problems.some((problem) => /1\.2\.3 in the manifest, 1\.2\.0 in the lockfile/.test(problem)));
	});

	it("fails a dependency a locked package declares but the lockfile has no entry for", () => {
		// `npm ci` refuses this tree, and every CI job starts with `npm ci`: the failure is at the first step, not in a
		// test. It is how a lockfile written with `omit=optional` from a user-level npmrc reaches a release.
		const root = fixture({ "packages/one/package.json": { name: "one", version: "1.0.0", dependencies: {} } });
		write(root, "package-lock.json", {
			name: "root",
			lockfileVersion: 3,
			packages: {
				"": { name: "root", version: "0.0.1", dependencies: {} },
				"packages/one": { name: "one", version: "1.0.0", dependencies: {} },
				"node_modules/wrapper": { version: "1.0.0", dependencies: { "@scope/missing": "^2.0.0" } },
			},
		});
		const problems = lockfileProblems({ root });
		assert.equal(problems.length, 1);
		assert.match(problems[0], /node_modules\/wrapper declares dependencies\.@scope\/missing, and package-lock.json has no entry/);
	});

	it("accepts a dependency nested beside the package that declares it, as npm resolves it", () => {
		const root = fixture({ "packages/one/package.json": { name: "one", version: "1.0.0", dependencies: {} } });
		write(root, "package-lock.json", {
			name: "root",
			lockfileVersion: 3,
			packages: {
				"": { name: "root", version: "0.0.1", dependencies: {} },
				"packages/one": { name: "one", version: "1.0.0", dependencies: {} },
				"node_modules/wrapper": { version: "1.0.0", optionalDependencies: { helper: "1.0.0" } },
				"node_modules/wrapper/node_modules/helper": { version: "1.0.0" },
			},
		});
		assert.deepEqual(lockfileProblems({ root }), []);
	});

	it("leaves spikes and examples alone: they are not npm workspaces", () => {
		const root = fixture({
			"packages/one/package.json": { name: "one", version: "1.0.0", dependencies: {} },
			"kyrn/spikes/smoke/package.json": { name: "spike", dependencies: {} },
		});
		write(root, "package-lock.json", {
			name: "root",
			lockfileVersion: 3,
			packages: {
				"": { name: "root", version: "0.0.1", dependencies: {} },
				"packages/one": { name: "one", version: "1.0.0", dependencies: {} },
			},
		});
		assert.deepEqual(lockfileProblems({ root }), []);
	});
});
