// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The link check, on documents written for the purpose.
 *
 * A broken link in a release's README is invisible until someone clicks it, and the repository has a thousand relative
 * links; these cases are the shapes that appear in them — a page, a heading inside a page, a directory, an image, a
 * reference definition, and the external links that are none of this check's business.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CHECKED_ROOTS, linkProblems, linksIn, targetPath } from "./check-links.mjs";

/** A reader over documents, with the paths that exist. */
function files(documents, existing = []) {
	const paths = new Set(existing);
	return {
		list: () => Object.keys(documents),
		read: (path) => documents[path],
		exists: (absolutePath) => {
			const normalized = absolutePath.replaceAll("\\", "/").replace(/\/+$/, "");
			return [...paths].some((path) => normalized.endsWith(path));
		},
	};
}

test("a document whose links resolve has nothing to report", () => {
	const problems = linkProblems(
		files({ "README.md": "See [the guide](docs/guide.md) and ![a chart](docs/chart.svg)." }, ["docs/guide.md", "docs/chart.svg"]),
	);
	assert.deepEqual(problems, []);
});

test("a link to nothing is reported with its file and line", () => {
	const problems = linkProblems(files({ "docs/a.md": "# a\n\nSee [the other](b.md).\n" }, []));
	assert.equal(problems.length, 1);
	assert.match(problems[0], /^docs\/a\.md:3: b\.md does not exist$/);
});

test("headings, queries, external links and bare fragments are not files", () => {
	const problems = linkProblems(
		files(
			{
				"docs/a.md": [
					"[same page](#section)",
					"[other page with a heading](b.md#part)",
					"[with a query](c.md?plain=1)",
					"[web](https://example.com/x)",
					"[mail](mailto:someone@example.com)",
					"[protocol relative](//example.com/x)",
				].join("\n"),
			},
			["docs/b.md", "docs/c.md"],
		),
	);
	assert.deepEqual(problems, []);
	assert.equal(targetPath("b.md#part"), "b.md");
	assert.equal(targetPath("c.md?plain=1"), "c.md");
});

test("a directory and a reference definition both count as links", () => {
	const problems = linkProblems(
		files({ "README.md": "See [docs](docs/) and the [guide][g].\n\n[g]: docs/guide.md\n" }, ["docs", "docs/guide.md"]),
	);
	assert.deepEqual(problems, []);
});

test("the checked roots are the documentation a reader follows", () => {
	// `packages/*/CHANGELOG.md` is a record of past layouts, and `desktop/` is another project's tree: neither is here.
	assert.ok(CHECKED_ROOTS.includes("docs"));
	assert.ok(CHECKED_ROOTS.includes("README.md"));
	assert.ok(!CHECKED_ROOTS.includes("packages"));
	assert.ok(!CHECKED_ROOTS.includes("desktop"));
});

test("every markdown link shape in one text is found with its line", () => {
	const links = linksIn("one [a](x.md)\n[ref]: y.md\n[b](https://example.com)\n");
	assert.deepEqual(
		links.map((link) => `${link.line}:${link.target}`),
		["1:x.md", "2:y.md"],
	);
});
