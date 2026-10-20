// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverTasks, judgeTask, readTask, runJudgeCommand, selfCheck } from "../src/tasks/judge.ts";

/**
 * The tasks and their judges. A task that cannot fail has no business in a benchmark, so the red-then-green check is
 * the first thing tested — against the repository's own fixtures and against a deliberately dishonest one.
 */

const TASKS_ROOT = join(import.meta.dirname, "..", "..", "..", "evals", "tasks");
const created: string[] = [];

function temporary(): string {
	const directory = mkdtempSync(join(tmpdir(), "mu-tasks-test-"));
	created.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A task whose judge passes whether or not anything was fixed: the case the self-check exists to catch. */
function dishonestTask(): string {
	const directory = join(temporary(), "dishonest");
	mkdirSync(join(directory, "repo"), { recursive: true });
	writeFileSync(join(directory, "repo", "package.json"), JSON.stringify({ type: "module" }));
	writeFileSync(
		join(directory, "repo", "always.test.js"),
		'import { test } from "node:test";\ntest("always", () => {});\n',
	);
	mkdirSync(join(directory, "fixed"), { recursive: true });
	writeFileSync(join(directory, "fixed", "nothing.txt"), "no change\n");
	writeFileSync(
		join(directory, "task.json"),
		JSON.stringify({
			id: "dishonest",
			title: "passes anyway",
			prompt: "do nothing",
			judge: { command: "node", args: ["--test"] },
		}),
	);
	return directory;
}

describe("the seed tasks", () => {
	it("are all present, sorted by id, and unique", () => {
		const tasks = discoverTasks(TASKS_ROOT);
		expect(tasks.length).toBeGreaterThanOrEqual(6);
		expect(tasks.map((task) => task.id)).toEqual([...tasks.map((task) => task.id)].sort());
		expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
	});

	it("each fail their judge before the fix and pass it after", () => {
		// This is the benchmark's only claim to honesty: the judge decides, and it is red then green.
		for (const task of discoverTasks(TASKS_ROOT)) {
			const check = selfCheck(task);
			expect({ task: task.id, red: check.red.passed, green: check.green.passed }).toEqual({
				task: task.id,
				red: false,
				green: true,
			});
		}
	}, 180_000);

	it("run their judge in a copy, so the repository is never written to", () => {
		const task = discoverTasks(TASKS_ROOT)[0];
		if (task === undefined) throw new Error("no tasks");
		const before = judgeTask(task, { fix: false });
		const after = judgeTask(task, { fix: false });
		// Same verdict twice: a judge that wrote into the fixture would drift after the first run.
		expect(after.passed).toBe(before.passed);
		expect(existsSync(join(task.directory, "node_modules"))).toBe(false);
	});
});

describe("a task that cannot fail", () => {
	it("is caught by the self-check", () => {
		const directory = dishonestTask();
		const task = readTask(directory);
		const check = selfCheck(task);
		expect(check.red.passed).toBe(true);
		expect(check.ok).toBe(false);
		expect(judgeTask(task, { fix: true }).passed).toBe(true);
	});
});

describe("validating a fixture", () => {
	it("names what is missing instead of skipping the task", () => {
		const directory = join(temporary(), "broken");
		mkdirSync(directory, { recursive: true });
		expect(() => readTask(directory)).toThrow(/no task\.json/);

		writeFileSync(join(directory, "task.json"), JSON.stringify({ title: "no id" }));
		expect(() => readTask(directory)).toThrow(/no id/);

		mkdirSync(join(directory, "repo"), { recursive: true });
		writeFileSync(join(directory, "task.json"), JSON.stringify({ id: "x", title: "x", prompt: "x", judge: {} }));
		expect(() => readTask(directory)).toThrow(/judge needs a command/);
	});

	it("refuses two tasks with the same id", () => {
		const root = temporary();
		for (const name of ["one", "two"]) {
			const directory = join(root, name);
			mkdirSync(join(directory, "repo"), { recursive: true });
			writeFileSync(
				join(directory, "task.json"),
				JSON.stringify({ id: "same", title: name, prompt: "p", judge: { command: "node", args: [] } }),
			);
		}
		expect(() => discoverTasks(root)).toThrow(/share the id same/);
	});
});

describe("the judge command", () => {
	it("reports failure with the test runner's own output", () => {
		const task = discoverTasks(TASKS_ROOT).find((entry) => entry.id === "sum-range");
		if (task === undefined) throw new Error("sum-range is missing");
		const result = judgeTask(task, { fix: false });
		expect(result.passed).toBe(false);
		expect(result.exitCode).not.toBe(0);
		// The runner's own wording, not a summary: a person reading a failed run needs the test's name.
		expect(result.output).toContain("sums 1..n inclusive");
	});

	it("is a plain command, so a task can judge itself any way its repository does", () => {
		const directory = join(temporary(), "shell-judge");
		mkdirSync(join(directory, "repo"), { recursive: true });
		writeFileSync(join(directory, "repo", "marker"), "x\n");
		writeFileSync(
			join(directory, "task.json"),
			JSON.stringify({
				id: "marker",
				title: "marker",
				prompt: "p",
				judge: { command: "node", args: ["-e", "process.exit(0)"] },
			}),
		);
		const task = readTask(directory);
		expect(runJudgeCommand(task, join(directory, "repo")).passed).toBe(true);
	});
});
