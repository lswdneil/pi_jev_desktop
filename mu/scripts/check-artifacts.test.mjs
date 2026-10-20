// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { artifactProblems, FORBIDDEN_NAMES, SECRET_PATTERNS } from "./check-artifacts.mjs";

/**
 * The artifact scan. Each case is a real way a trace or a report carries something it should not, and the one that
 * matters most: a clean artifact must pass, or the job would be turned off within a week.
 */

function directory(files) {
	const root = mkdtempSync(join(tmpdir(), "mu-artifacts-test-"));
	for (const [path, content] of Object.entries(files)) {
		const absolute = join(root, path);
		mkdirSync(join(absolute, ".."), { recursive: true });
		writeFileSync(absolute, content);
	}
	return root;
}

test("a clean artifact directory passes", () => {
	const root = directory({
		"trace.zip": "not really a zip",
		"playwright-report/index.html": "<html>ok</html>",
		"test-results/app-start.spec.ts/error-context.md": "expected true to be false",
	});
	try {
		assert.deepEqual(artifactProblems([root]), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a credentials file by name fails, wherever it is", () => {
	const root = directory({ "trace/env/.env": "ANTHROPIC_API_KEY=whatever\n", "report/auth.json": "{}" });
	try {
		const problems = artifactProblems([root]);
		assert.equal(problems.length, 2);
		assert.match(problems[0] ?? "", /is a credentials file by name/);
		assert.match(problems[1] ?? "", /is a credentials file by name/);
		assert.deepEqual(FORBIDDEN_NAMES.length > 0, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a key pasted into a log or a trace fails", () => {
	const samples = [
		"request headers: {\"x-api-key\":\"sk-ant-api03-abcdefghijklmnop\"}",
		"GOOGLE KEY AIzaSyA123456789012345678901234567890123",
		"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
		"ANTHROPIC_API_KEY=sk-live-0123456789abcdef",
	];
	for (const sample of samples) {
		const root = directory({ "test-results/console.log": sample });
		try {
			const problems = artifactProblems([root]);
			assert.equal(problems.length, 1, `expected a problem for: ${sample}`);
			assert.match(problems[0] ?? "", /contains /);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
	assert.equal(SECRET_PATTERNS.length, samples.length);
});

test("a directory that does not exist is not a failure", () => {
	// The desktop e2e job scans both directories whether or not the run produced them.
	assert.deepEqual(artifactProblems([join(tmpdir(), "mu-artifacts-does-not-exist")]), []);
});
