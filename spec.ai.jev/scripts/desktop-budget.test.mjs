// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The desktop size budget. Bytes do not jitter, so the tolerances are tight: a renderer bundle that grows two percent
 * without anyone deciding to is the start of an app that takes ten seconds to open.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUDGET_FILE, budgetProblems, measure, staleBuildProblems, writeBudget } from "./desktop-budget.mjs";

function build(sizes) {
	const root = mkdtempSync(join(tmpdir(), "mu-budget-test-"));
	for (const [path, bytes] of Object.entries(sizes)) {
		const absolute = join(root, "out", path);
		mkdirSync(join(absolute, ".."), { recursive: true });
		writeFileSync(absolute, "x".repeat(bytes));
	}
	return root;
}

function budgetOf(metrics) {
	return { generatedAt: "2026-10-18", note: "", metrics };
}

test("measures each part of the build", () => {
	const root = build({ "renderer/assets/index.js": 1000, "renderer/assets/index.css": 200, "main/index.js": 500, "preload/main.js": 100 });
	try {
		const { measured } = measure(join(root, "out"));
		assert.equal(measured.rendererJs, 1000);
		assert.equal(measured.rendererCss, 200);
		assert.equal(measured.mainJs, 500);
		assert.equal(measured.total, 1800);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a build that fits passes, including the tolerances", () => {
	const measured = { rendererJs: 1000, rendererCss: 200, mainJs: 500, total: 1800 };
	const budget = budgetOf({ rendererJs: 1000, rendererCss: 200, mainJs: 500, total: 1800 });
	assert.deepEqual(budgetProblems(measured, budget), []);

	// rendererJs may grow 2%, the rest 5%.
	assert.deepEqual(budgetProblems({ ...measured, rendererJs: 1020, total: 1890 }, budget), []);
});

test("a jump over the budget fails, and says which metric and by how much", () => {
	const measured = { rendererJs: 1200, rendererCss: 200, mainJs: 500, total: 1900 };
	const problems = budgetProblems(measured, budgetOf({ rendererJs: 1000, rendererCss: 200, mainJs: 500, total: 1800 }));
	assert.match(problems.join("\n"), /rendererJs is 1\.2 KiB, over the 1\.0 KiB budget/);
	assert.match(problems.join("\n"), /the renderer bundle the window loads first/);
});

test("a metric with no budget is a problem, not a pass", () => {
	const problems = budgetProblems(
		{ rendererJs: 1, rendererCss: 1, mainJs: 1, total: 3 },
		budgetOf({ rendererJs: 10, rendererCss: 10, mainJs: 10 }),
	);
	assert.match(problems.join("\n"), /total has no budget/);
});

test("a part of the build that emitted nothing fails against a nonzero budget", () => {
	const budget = budgetOf({ rendererJs: 1000, rendererCss: 200, mainJs: 500, total: 1800 });
	// The stylesheet is gone but the budget still expects 200 bytes: comparing 0 to it is a vacuous pass.
	const problems = budgetProblems({ rendererJs: 1000, rendererCss: 0, mainJs: 500, total: 1500 }, budget);
	assert.match(problems.join("\n"), /rendererCss measured nothing, while its budget is 0\.2 KiB/);
	// A budget of 0 is how "there is none of this" is written down, and 0 bytes matches it.
	const none = budgetOf({ rendererJs: 10, rendererCss: 0, mainJs: 10, total: 20 });
	assert.deepEqual(budgetProblems({ rendererJs: 10, rendererCss: 0, mainJs: 10, total: 20 }, none), []);
});

test("a build that is not there is an error, not a zero", () => {
	const root = mkdtempSync(join(tmpdir(), "mu-budget-empty-"));
	try {
		assert.throws(() => measure(join(root, "out")), /is not a build/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a build older than its sources is refused, and a fresh one passes", () => {
	const root = build({ "renderer/assets/index.js": 1000, "main/index.js": 500 });
	const sources = join(root, "src");
	mkdirSync(sources, { recursive: true });
	writeFileSync(join(sources, "main.ts"), "export const x = 1;\n");
	try {
		// The source is newer than every file in the build: the measurement is of code nobody has.
		const later = new Date(Date.now() + 3_600_000);
		utimesSync(join(sources, "main.ts"), later, later);
		const stale = staleBuildProblems(join(root, "out"), sources);
		assert.match(stale.join("\n"), /is older than .*main\.ts/);
		assert.match(stale.join("\n"), /run `npm run build` first/);

		// The source is older than the build: it was measured.
		const old = new Date("2026-10-01T00:00:00Z");
		utimesSync(join(sources, "main.ts"), old, old);
		assert.deepEqual(staleBuildProblems(join(root, "out"), sources), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a missing source tree is not a staleness problem", () => {
	const root = build({ "renderer/assets/index.js": 1000, "main/index.js": 500 });
	try {
		assert.deepEqual(staleBuildProblems(join(root, "out"), join(root, "src")), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("updating records the current sizes as the new budget", () => {
	const root = build({ "renderer/assets/index.js": 4096, "renderer/assets/index.css": 512, "main/index.js": 1024, "preload/main.js": 64 });
	try {
		const { measured } = measure(join(root, "out"));
		const budget = writeBudget(root, measured, new Date("2026-10-18T00:00:00Z"));
		assert.equal(budget.metrics.rendererJs, 4096);
		assert.equal(budget.metrics.total, measured.total);
		const written = JSON.parse(readFileSync(join(root, BUDGET_FILE), "utf8"));
		assert.equal(written.generatedAt, "2026-10-18");
		// The ring is closed: the build it was written from passes its own budget.
		assert.deepEqual(budgetProblems(measured, written), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
