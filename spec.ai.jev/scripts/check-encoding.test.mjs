// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The encoding check, on text built for the purpose.
 *
 * It has one job and a long history behind it: three files in this repository were silently re-encoded and kept saying
 * something nobody wrote. The cases below are the shapes that actually occurred — an em dash, a full-width punctuation
 * mark, the classic double-decoded artifact, and the replacement character a decoder writes when it gives up — plus the
 * two files that are allowed to look wrong because they are about the problem.
 *
 * The markers are taken from the module under test rather than written out here. A test file that contains the markers
 * would have to be allow-listed, and an allow-listed test is exactly where a real corruption would go unnoticed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ALLOWED_PATHS, CORRUPTION_MARKERS, corruptionIn, encodingProblems, SKIP_PREFIXES } from "./check-encoding.mjs";

/** A reader over the files a test names. */
function files(entries) {
	const paths = Object.keys(entries);
	return {
		list: () => paths,
		read: (path) => entries[path],
	};
}

const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const ALL_MARKERS = CORRUPTION_MARKERS.map((marker) => marker.text).join("");

test("a clean file has nothing to report", () => {
	assert.deepEqual(encodingProblems(files({ "docs/readme.md": "# mu\n\nAn em dash — and a comma ，are fine.\n" })), []);
	assert.deepEqual(corruptionIn("plain ascii\n"), []);
});

test("the replacement character is always a failure", () => {
	const problems = encodingProblems(files({ "docs/a.md": `one\ntwo${REPLACEMENT_CHARACTER}three\n` }));
	assert.equal(problems.length, 1);
	assert.match(problems[0], /docs\/a\.md:2: the replacement character/);
});

test("every marker is found where it is, and says what it probably was", () => {
	assert.ok(CORRUPTION_MARKERS.length >= 5, "the marker list should cover the damage this repository has seen");
	for (const marker of CORRUPTION_MARKERS) {
		const problems = encodingProblems(files({ "src/x.ts": `// line one\n// ${marker.text}\n` }));
		assert.equal(problems.length, 1, `expected one problem for ${JSON.stringify(marker.text)}`);
		assert.match(problems[0], /src\/x\.ts:2/);
		assert.ok(problems[0].includes(marker.reason), `the problem should carry the reason: ${problems[0]}`);
	}
});

test("only text files are read", () => {
	assert.deepEqual(encodingProblems(files({ "assets/logo.png": REPLACEMENT_CHARACTER, "docs/notes.markdown.md": "fine" })), []);
});

test("build output, vendored code and other projects' fixtures are left alone", () => {
	for (const prefix of SKIP_PREFIXES) {
		assert.deepEqual(encodingProblems(files({ [`${prefix}/file.md`]: ALL_MARKERS })), [], `${prefix} should be skipped`);
	}
});

test("the files that are allowed to look wrong are the ones it needs to", () => {
	for (const path of ALLOWED_PATHS) {
		assert.deepEqual(encodingProblems(files({ [path]: ALL_MARKERS })), [], `${path} should be allowed`);
	}
	// The allow-list stays honest by being small: adding an ordinary file to it would silently disable the check there.
	assert.ok(ALLOWED_PATHS.length <= 3, "the allow-list should stay a short, explained list");
});
