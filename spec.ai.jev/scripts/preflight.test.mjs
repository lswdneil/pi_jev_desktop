// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The preflight's plan. What it would run, in what order, and that the two modes stay what they say: `--fast` never
 * needs Electron, `--full` builds and launches the app.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { preflightPlan } from "./preflight.mjs";

test("the fast plan runs the checks and unit tests, in an order that fails cheap first", () => {
	const names = preflightPlan("fast").map((step) => step.name);
	assert.equal(names[0], "check");
	assert.ok(names.includes("script tests"));
	assert.ok(names.includes("task benchmark"));
	// Nothing in the fast plan touches the app.
	for (const step of preflightPlan("fast")) assert.ok(!step.cwd.endsWith("desktop-next"), `${step.name} needs the app`);
});

test("the full plan adds the app, after the cheap steps", () => {
	const fast = preflightPlan("fast").map((step) => step.name);
	const full = preflightPlan("full").map((step) => step.name);
	assert.deepEqual(full.slice(0, fast.length), fast);
	const desktop = preflightPlan("full").filter((step) => step.cwd.endsWith("desktop-next"));
	assert.ok(desktop.length >= 5);
	// The build comes before anything that needs its output.
	const order = full.indexOf("desktop build");
	assert.ok(order < full.indexOf("desktop size budget"));
	assert.ok(order < full.indexOf("desktop startup budget"));
	assert.ok(order < full.indexOf("desktop e2e"));
	// The type check is the one thing the shell's own build does not do (esbuild strips types) and the root `check`
	// does not cover (desktop-next is not a workspace member), so the plan has to run it, before the build it describes.
	assert.ok(full.includes("desktop typecheck"));
	assert.ok(full.indexOf("desktop typecheck") < order);
});

test("every step says what it proves, and no two share a name", () => {
	const steps = preflightPlan("full");
	assert.equal(new Set(steps.map((step) => step.name)).size, steps.length);
	for (const step of steps) {
		assert.ok(step.proves.length > 0, `${step.name} does not say what it proves`);
		assert.ok(Array.isArray(step.run) && step.run.length === 2, `${step.name} has no command`);
	}
});

test("an unknown mode is the fast plan, never the slow one by accident", () => {
	assert.deepEqual(preflightPlan("anything-else"), preflightPlan("fast"));
});
