// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

import assert from "node:assert/strict";
import { test } from "node:test";

import { APACHE_LICENSE, declaredLicense, headerLines, licenseFor, MIT_LICENSE, withHeader } from "./license-headers.mjs";
import { licenseProblems } from "./license-check.mjs";
import { collectComponents, NOTICES_FILE, renderNotices } from "./third-party-notices.mjs";

/**
 * The licence rules, described as repositories instead of mutating this one. Each test is one way the rules can be
 * broken, because each of them has a real failure behind it: a scanner that cannot tell what a file is under, a
 * dependency nobody wrote down, and a directory that quietly carries the other licence.
 */

const MEMBERS = ["packages/agent", "packages/judge-evals"];
const DESKTOP_FILES = ["desktop-next/src/main/index.ts", "desktop-next/README.md"];

function headerFor(license) {
	return `${headerLines(license).join("\n")}\n\n`;
}

const ROOT_LOCK = {
	packages: {
		"": { name: "pi-monorepo", version: "0.0.3", license: "MIT" },
		"node_modules/left-pad": { version: "1.3.0", license: "MIT" },
		"node_modules/old-thing": { version: "0.1.0", dev: true, license: "BSD-3-Clause" },
		"packages/agent": { name: "@earendil-works/pi-agent-core", version: "1.0.2" },
	},
};

function repository(overrides = {}) {
	const files = new Map([
		["package.json", JSON.stringify({ name: "pi-monorepo", version: "0.0.3", license: "MIT" })],
		["desktop-next/package.json", JSON.stringify({ name: "mu-desktop", version: "0.1.8", license: APACHE_LICENSE })],
		["packages/agent/package.json", JSON.stringify({ name: "@earendil-works/pi-agent-core", version: "1.0.2", license: "MIT" })],
		["packages/judge-evals/package.json", JSON.stringify({ name: "@kyrn/judge-evals", version: "0.1.0", license: "MIT" })],
		["desktop-next/README.md", "# mu-desktop\n"],
		["package-lock.json", JSON.stringify(ROOT_LOCK)],
	]);
	// The headers: the Apache tree always carries one, nothing else does unless a test adds it.
	for (const path of DESKTOP_FILES.filter((path) => path.endsWith(".ts"))) {
		files.set(path, headerFor(APACHE_LICENSE));
	}
	// The generated notices, from the same lockfile and manifests the check will read.
	const lock = JSON.parse(files.get("package-lock.json"));
	const components = collectComponents([{ lock, includeDev: false }], { read: (path) => files.get(path) });
	files.set(NOTICES_FILE, renderNotices(components));
	for (const [path, value] of Object.entries(overrides)) {
		if (value === undefined) files.delete(path);
		else files.set(path, value);
	}
	return files;
}

function check(overrides, options = {}) {
	const files = repository(overrides);
	const list = (prefix) => [...files.keys()].filter((path) => path.startsWith(`${prefix}/`));
	return licenseProblems({ read: (path) => files.get(path), list }, options);
}

test("a repository that follows the rules has no problems", () => {
	assert.deepEqual(check({}), []);
});

test("a new file without a header is a problem, and it says how to fix it", () => {
	const problems = check({ "packages/agent/src/deadline.ts": "export const ms = 1;\n" }, {
		newPaths: ["packages/agent/src/deadline.ts"],
	});
	assert.match(problems.join("\n"), /src\/deadline\.ts is new and has no SPDX header; run: node scripts\/license-headers\.mjs --stamp/);
});

test("a file that was already here is not required to have one", () => {
	assert.deepEqual(check({ "packages/agent/src/old.ts": "export const ms = 1;\n" }), []);
});

test("a dependency whose licence the list does not mention is a problem that names it", () => {
	const changed = structuredClone(ROOT_LOCK);
	changed.packages["node_modules/new-thing"] = { version: "2.0.0", license: "ISC" };
	const problems = check({ "package-lock.json": JSON.stringify(changed) });
	assert.match(problems.join("\n"), /THIRD_PARTY_NOTICES\.md is out of date \(added: new-thing\)/);
});

test("a dev dependency that stops shipping is not a change to the list", () => {
	// `old-thing` is `dev: true`, so it was never listed; removing it must not ask for an update.
	const changed = structuredClone(ROOT_LOCK);
	delete changed.packages["node_modules/old-thing"];
	assert.deepEqual(check({ "package-lock.json": JSON.stringify(changed) }), []);
});

test("the Apache directory with the other licence in it is a problem", () => {
	const problems = check({ "desktop-next/src/main/ipc.ts": headerFor(MIT_LICENSE) });
	assert.match(problems.join("\n"), /ipc\.ts declares MIT but Apache-2\.0 is what this tree carries/);
});

test("an Apache file with no header at all is a problem even when it is old", () => {
	const problems = check({ "desktop-next/src/main/notices.ts": "export const version = 1;\n" });
	assert.match(problems.join("\n"), /notices\.ts is in an Apache-2\.0 directory but has no SPDX header/);
});

test("a manifest with no license is a problem, and so is one in the wrong tree", () => {
	assert.match(check({ "packages/judge-evals/package.json": JSON.stringify({ name: "@kyrn/judge-evals" }) }).join("\n"), /declares no license; add "MIT"/);
	assert.match(
		check({ "desktop-next/package.json": JSON.stringify({ name: "mu-desktop", license: MIT_LICENSE }) }).join("\n"),
		/declares MIT but this tree is Apache-2\.0/,
	);
});

test("the same licence in both trees is the point: the rule comes from the directory", () => {
	assert.equal(licenseFor("packages/agent/src/index.ts"), MIT_LICENSE);
	assert.equal(licenseFor("desktop-next/src/main/index.ts"), APACHE_LICENSE);
	// The frozen AionUi fork keeps its own headers, and build output is not source.
	assert.equal(licenseFor("desktop/src/main/index.ts"), undefined);
	assert.equal(licenseFor("desktop-next/out/main/index.js"), undefined);
	assert.equal(licenseFor("desktop-next/src/renderer/index.html"), undefined);
	// The task benchmark's fixtures are other repositories, not this one's sources.
	assert.equal(licenseFor("evals/tasks/sum-range/repo/src/range.js"), undefined);
});

test("a Windows path is the same file as a POSIX one", () => {
	assert.equal(licenseFor("desktop-next\\src\\main\\index.ts"), APACHE_LICENSE);
});

test("stamping is idempotent and keeps a shebang first", () => {
	const stamped = withHeader("#!/usr/bin/env node\n\nconsole.log(1);\n", MIT_LICENSE);
	assert.equal(stamped.split("\n")[0], "#!/usr/bin/env node");
	assert.equal(declaredLicense(stamped), MIT_LICENSE);
	assert.equal(withHeader(stamped, MIT_LICENSE), stamped);
});
