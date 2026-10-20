// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The audit gate's only portable part: how to start npm. On Windows `npm` is a `.cmd` shim and a bare
 * `spawnSync("npm", …)` fails with ENOENT, which is how this gate passed on the Linux runner and was unusable on a
 * Windows checkout. These cases pin the fallback chain without running an audit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { npmInvocation } from "./npm-audit.mjs";

test("an npm script's own entry point is run through the current node", () => {
	const invocation = npmInvocation({ npm_execpath: "C:/npm/bin/npm-cli.js" }, "C:/node/node.exe", () => false);
	assert.deepEqual(invocation, { command: "C:/node/node.exe", args: ["C:/npm/bin/npm-cli.js"] });
});

test("without npm_execpath, npm is found beside the running node", () => {
	const seen = [];
	const invocation = npmInvocation({}, "C:/node/node.exe", (path) => {
		seen.push(path);
		return true;
	});
	assert.deepEqual(invocation, { command: "C:/node/node.exe", args: [seen[0]] });
	assert.match(seen[0], /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
});

test("a system npm on PATH is the last resort, and a wrapper npm_execpath is not mistaken for a script", () => {
	assert.deepEqual(npmInvocation({ npm_execpath: "/usr/local/bin/npm" }, "/usr/bin/node", () => false), {
		command: "npm",
		args: [],
	});
	assert.deepEqual(npmInvocation({}, "/usr/bin/node", () => false), { command: "npm", args: [] });
});
