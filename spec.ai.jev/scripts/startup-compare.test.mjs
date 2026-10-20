// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

import assert from "node:assert/strict";
import { test } from "node:test";

import { STARTUP_METRICS, formatStartup, startupProblems } from "./startup-compare.mjs";

/**
 * The startup rule. The cases that matter are the two sides of the noise boundary: a slow run just over the budget but
 * not over the floor is not a regression, and a run over both is.
 */

const BUDGET = { generatedAt: "2026-10-18", note: "", metrics: { windowMs: 1000, readyMs: 2000 } };

test("a measurement within the tolerance passes", () => {
	assert.deepEqual(startupProblems({ windowMs: 1000, readyMs: 2000 }, BUDGET), []);
	// 40% over is the ceiling: 1400 and 2800.
	assert.deepEqual(startupProblems({ windowMs: 1400, readyMs: 2800 }, BUDGET), []);
});

test("a run over the percentage but not over the floor is noise, not a regression", () => {
	// 250 ms against a 200 ms budget: +25% is over the percentage, but only 50 ms over, under the 200 ms floor.
	assert.deepEqual(startupProblems({ windowMs: 250, readyMs: 2000 }, BUDGET, [{ ...STARTUP_METRICS[0], tolerance: 0.1 }]), []);
});

test("a run over both the percentage and the floor fails, and says by how much", () => {
	const problems = startupProblems({ windowMs: 1500, readyMs: 2000 }, BUDGET);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /windowMs is 1500 ms, over the 1400 ms budget/);
	assert.match(problems[0], /\+500 ms/);
});

test("a missing budget or a missing measurement is reported, not skipped", () => {
	assert.match(startupProblems({ windowMs: 1, readyMs: 1 }, { metrics: { windowMs: 10 } }).join("\n"), /readyMs has no budget/);
	assert.match(startupProblems({ windowMs: 1 }, BUDGET).join("\n"), /readyMs was not measured/);
});

test("the log line names the measurement and what it was allowed", () => {
	assert.deepEqual(formatStartup({ windowMs: 900, readyMs: 1800 }, BUDGET), ["windowMs 900 ms (budget 1400 ms)", "readyMs 1800 ms (budget 2800 ms)"]);
});
