// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The commands in the documentation. A gate for the docs the same way `check-workflows` is a gate for the workflows: a
 * recipe that names a script nobody has fails here instead of in someone's terminal.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { commandProblems, directoriesWalked, nodePaths, npmRunNames, shellScripts } from "./check-docs-commands.mjs";

function tree(files) {
	const root = mkdtempSync(join(tmpdir(), "mu-docs-commands-"));
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

const read = (path) => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
};

/** Problems for a fake tree: the checked documents are the README and whatever the caller adds. */
function problemsFor(files) {
	const root = tree({ ...BASE, ...files });
	try {
		return commandProblems(["README.md"], read, root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const BASE = {
	"package.json": JSON.stringify({ scripts: { check: "node check.mjs", "test:scripts": "node test.mjs" } }),
	"desktop-next/package.json": JSON.stringify({ scripts: { package: "electron-builder", typecheck: "tsc" } }),
	"scripts/real.mjs": "// a script\n",
	"desktop/scripts/check-i18n.js": "// the old shell's script\n",
	"test.sh": "#!/bin/sh\nexit 0\n",
	"README.md": "",
};

test("finds the scripts, paths and shell scripts, with the line they are on", () => {
	const text = ["Run `npm run check` first.", "Then `node scripts/real.mjs`.", "Finally `./test.sh`."].join("\n");
	assert.deepEqual(npmRunNames(text), [{ name: "check", line: 1 }]);
	assert.deepEqual(nodePaths(text), [{ path: "scripts/real.mjs", line: 2 }]);
	assert.deepEqual(shellScripts(text), [{ path: "test.sh", line: 3 }]);
});

test("a command whose script or file exists is no problem", () => {
	assert.deepEqual(problemsFor({ "README.md": "`npm run check`\n`node scripts/real.mjs`\n" }), []);
});

test("a script from the shell's manifest counts, because the docs send people there", () => {
	assert.deepEqual(problemsFor({ "README.md": "`npm run package`\n" }), []);
});

test("a script nobody has is a problem, with the document and the line", () => {
	const problems = problemsFor({ "README.md": "# Title\n\n`npm run build:everything`\n" });
	assert.equal(problems.length, 1);
	assert.match(problems[0], /README\.md:3: npm run build:everything is not a script/);
});

test("a file nobody has is a problem, and a placeholder is not", () => {
	const problems = problemsFor({
		"README.md": "`node scripts/ghost.mjs`\n`node scripts/<name>.mjs`\n`node scripts/$SCRIPT.mjs`\n",
	});
	assert.equal(problems.length, 1);
	assert.match(problems[0], /node scripts\/ghost\.mjs does not exist/);
});

test("a path after `cd` is resolved from the directory the block walks into", () => {
	assert.deepEqual(problemsFor({ "README.md": "```bash\ncd desktop\nnode scripts/check-i18n.js\n```\n" }), []);
	// The same path without the `cd` is not there, and says so.
	const wrong = problemsFor({ "README.md": "`node scripts/check-i18n.js`\n" });
	assert.equal(wrong.length, 1);
});

test("a second block's `cd` starts from the repository root again when the joined path does not exist", () => {
	const text = ["```bash", "cd packages/real", "```", "```bash", "cd desktop", "node scripts/check-i18n.js", "```"].join("\n");
	const root = tree({ ...BASE, "packages/real/keep.txt": "" });
	try {
		const walked = directoriesWalked(text, root);
		assert.equal(walked[4], "desktop");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a shell script that cannot be executed is a problem on POSIX only", () => {
	if (process.platform === "win32") {
		// The bit is not a property of a file here, so the check does not run.
		assert.deepEqual(problemsFor({ "README.md": "`./test.sh`\n" }), []);
		return;
	}
	const root = tree({ ...BASE, "README.md": "`./test.sh`\n" });
	try {
		chmodSync(join(root, "test.sh"), 0o644);
		const problems = commandProblems(["README.md"], read, root);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /\.\/test\.sh is not executable/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a document that cannot be read is a problem, not a skip", () => {
	const root = tree(BASE);
	try {
		const problems = commandProblems(["missing.md"], read, root);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /missing\.md: cannot be read/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
