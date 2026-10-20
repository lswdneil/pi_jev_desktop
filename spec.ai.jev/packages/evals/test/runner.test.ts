// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverTasks } from "../src/tasks/judge.ts";
import { costOf, prepareAgentDir, renderReport, runArm, summarize } from "../src/tasks/runner.ts";
import type { BenchmarkReport, TaskFixture, TaskRun } from "../src/tasks/types.ts";

/**
 * The runner: the four arms, the budget, and the report.
 *
 * The faux executor is deterministic by construction — it applies each task's reference fix — so the assertions here
 * are about the machinery, not about a model. The agent path is driven with an injected executor, which is what makes
 * a budget stop and a failed run testable without a key.
 */

const TASKS_ROOT = join(import.meta.dirname, "..", "..", "..", "evals", "tasks");
const created: string[] = [];

function temporary(): string {
	const directory = mkdtempSync(join(tmpdir(), "mu-runner-test-"));
	created.push(directory);
	return directory;
}

function minimalTask(): TaskFixture {
	const directory = join(temporary(), "task");
	mkdirSync(join(directory, "repo"), { recursive: true });
	writeFileSync(join(directory, "repo", "package.json"), JSON.stringify({ type: "module" }));
	// A judge that fails until something is fixed: the point of the fixture, and what makes a failed run meaningful.
	writeFileSync(
		join(directory, "repo", "a.test.js"),
		'import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("a", () => {\n\tassert.equal(1, 2);\n});\n',
	);
	mkdirSync(join(directory, "fixed"), { recursive: true });
	writeFileSync(join(directory, "fixed", "package.json"), JSON.stringify({ type: "module" }));
	return {
		id: "minimal",
		title: "minimal",
		prompt: "p",
		judge: { command: "node", args: ["--test"] },
		directory,
	};
}

afterEach(() => {
	for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("the fake arm", () => {
	it("passes every task, and does it the same way twice", async () => {
		const tasks = discoverTasks(TASKS_ROOT).slice(0, 2);
		const first = await runArm({ tasks, arm: "mu-active", executor: "faux" });
		const second = await runArm({ tasks, arm: "mu-active", executor: "faux" });
		expect(first.runs.map((run) => [run.task, run.judge.passed])).toEqual(
			second.runs.map((run) => [run.task, run.judge.passed]),
		);
		expect(first.runs.every((run) => run.judge.passed)).toBe(true);
		expect(first.runs.every((run) => run.costUsd === 0)).toBe(true);
	}, 120_000);
});

describe("the agent path", () => {
	it("records a failed run instead of throwing", async () => {
		const { runs } = await runArm({
			tasks: [minimalTask()],
			arm: "mu-off",
			executor: "agent",
			execute: async () => ({ changed: false, costUsd: 0.02, error: "no API key" }),
		});
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ action: "error", costUsd: 0.02, error: "no API key" });
		expect(runs[0]?.judge.passed).toBe(false);
	}, 60_000);

	it("stops when the budget is passed, and says so", async () => {
		const tasks = [minimalTask(), { ...minimalTask(), id: "second" }, { ...minimalTask(), id: "third" }];
		const { runs, stoppedForBudget } = await runArm({
			tasks,
			arm: "mu-active",
			executor: "agent",
			budgetUsd: 0.05,
			execute: async () => ({ changed: false, costUsd: 0.04, error: "spent" }),
		});
		// Two runs at 0.04 pass the 0.05 budget after the second; the third never starts.
		expect(runs).toHaveLength(2);
		expect(stoppedForBudget).toBe(true);
	}, 60_000);

	it("refuses to run without an executor", async () => {
		await expect(runArm({ tasks: [minimalTask()], arm: "mu-active", executor: "agent" })).rejects.toThrow(
			/needs an executor/,
		);
	}, 60_000);
});

describe("the arms", () => {
	it("writes the mode where the harness reads it", () => {
		const root = temporary();
		const shadow = prepareAgentDir(root, "mu-shadow");
		const active = prepareAgentDir(join(root, "other"), "mu-active");
		expect(require("node:fs").readFileSync(join(shadow, "agent.json"), "utf8")).toContain("shadow");
		expect(require("node:fs").readFileSync(join(active, "agent.json"), "utf8")).not.toContain("shadow");
	});

	it("costs are summed from the agent's own usage lines", () => {
		const output = [
			JSON.stringify({ type: "message_end", usage: { cost: { total: 0.012 } } }),
			"not json",
			JSON.stringify({ type: "message_end", usage: { cost: { total: 0.008 } } }),
			JSON.stringify({ type: "message_end", usage: {} }),
		].join("\n");
		expect(costOf(output)).toBeCloseTo(0.02, 6);
	});
});

describe("the report", () => {
	it("lists every arm that ran, and says the faux one measures the harness", async () => {
		const tasks = discoverTasks(TASKS_ROOT).slice(0, 2);
		const runs: TaskRun[] = [];
		for (const arm of ["pi-baseline", "mu-active", "mu-shadow", "mu-off"] as const) {
			const out = await runArm({ tasks, arm, executor: "faux" });
			runs.push(...out.runs);
		}
		const report: BenchmarkReport = {
			generatedAt: new Date().toISOString(),
			executor: "faux",
			arms: summarize(runs),
			runs,
		};
		const markdown = renderReport(report);
		expect(report.arms.map((arm) => arm.arm)).toEqual(["pi-baseline", "mu-active", "mu-shadow", "mu-off"]);
		expect(markdown).toContain("| pi-baseline | 2 | 2 | 100% |");
		expect(markdown).toContain("**not** a model");
	}, 120_000);

	it("names the runs that did not pass", () => {
		const failed: TaskRun = {
			task: "sum-range",
			arm: "mu-active",
			executor: "agent",
			action: "nothing",
			judge: { passed: false, exitCode: 1, output: "", ms: 10 },
			ms: 20,
			costUsd: 0.01,
			error: "the model ran out of turns",
		};
		const markdown = renderReport({
			generatedAt: new Date().toISOString(),
			executor: "agent",
			model: "anthropic/claude-sonnet-4",
			arms: summarize([failed]),
			runs: [failed],
		});
		expect(markdown).toContain("## Runs that did not pass");
		expect(markdown).toContain("`mu-active` / `sum-range` (nothing): the model ran out of turns");
		expect(markdown).toContain("model: `anthropic/claude-sonnet-4`");
	});
});
