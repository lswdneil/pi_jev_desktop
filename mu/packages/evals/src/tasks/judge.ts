// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * Reading the tasks, and judging them.
 *
 * A task is a directory under `tasks/` holding `task.json`, a `repo/` in a state where the judge fails, and a `fixed/`
 * overlay that makes it pass. The self-check is what makes the benchmark worth running: a task whose judge passes
 * before the fix is a task that cannot measure anything, and it fails loudly here.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JudgeResult, JudgeSpec, TaskFixture } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function judgeOf(value: unknown, where: string): JudgeSpec {
	if (!isRecord(value) || typeof value.command !== "string" || value.command === "") {
		throw new Error(`${where}: judge needs a command`);
	}
	const args = value.args ?? [];
	if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
		throw new Error(`${where}: judge.args must be a list of strings`);
	}
	return {
		command: value.command,
		args,
		...(typeof value.timeoutMs === "number" ? { timeoutMs: value.timeoutMs } : {}),
	};
}

/** Read and validate one fixture. The failure names the fixture, because a benchmark that silently skips tasks lies. */
export function readTask(directory: string): TaskFixture {
	const manifest = join(directory, "task.json");
	if (!existsSync(manifest)) throw new Error(`${directory}: no task.json`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(manifest, "utf8"));
	} catch (error) {
		throw new Error(`${manifest}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed)) throw new Error(`${manifest}: not an object`);
	const { id, title, prompt, judge } = parsed;
	if (typeof id !== "string" || id === "") throw new Error(`${manifest}: no id`);
	if (typeof title !== "string" || title === "") throw new Error(`${manifest}: no title`);
	if (typeof prompt !== "string" || prompt === "") throw new Error(`${manifest}: no prompt`);
	if (!existsSync(join(directory, "repo"))) throw new Error(`${directory}: no repo/`);
	return { id, title, prompt, judge: judgeOf(judge, directory), directory };
}

/** Every task under `root`, sorted by id so a report is stable. */
export function discoverTasks(root: string): TaskFixture[] {
	if (!existsSync(root)) return [];
	const tasks = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => readTask(join(root, entry.name)))
		.sort((left, right) => left.id.localeCompare(right.id));
	const ids = new Set<string>();
	for (const task of tasks) {
		if (ids.has(task.id)) throw new Error(`two tasks share the id ${task.id}`);
		ids.add(task.id);
	}
	return tasks;
}

/** Run a task's judge in a directory it already controls. The exit code is the verdict, nothing else. */
export function runJudgeCommand(task: TaskFixture, cwd: string): JudgeResult {
	const started = Date.now();
	const result = spawnSync(task.judge.command, [...task.judge.args], {
		cwd,
		encoding: "utf8",
		timeout: task.judge.timeoutMs ?? 120_000,
		// A judge runs with the same environment the shell has; nothing about the task needs the user's keys.
		env: { ...process.env, MU_JUDGE: "off" },
	});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return {
		passed: result.status === 0,
		exitCode: result.status,
		output: output.length > 4_000 ? output.slice(-4_000) : output,
		ms: Date.now() - started,
	};
}

/**
 * Copy a task's repository into a temporary directory, optionally over the reference fix, and run its judge. The copy
 * is what keeps a run from writing into the repository.
 */
export function judgeTask(task: TaskFixture, options: { readonly fix: boolean } = { fix: false }): JudgeResult {
	const workspace = mkdtempSync(join(tmpdir(), `mu-task-${task.id}-`));
	try {
		cpSync(join(task.directory, "repo"), workspace, { recursive: true });
		if (options.fix) {
			const fixed = join(task.directory, "fixed");
			if (!existsSync(fixed)) throw new Error(`${task.directory}: no fixed/ to apply`);
			cpSync(fixed, workspace, { recursive: true });
		}
		return runJudgeCommand(task, workspace);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}

export interface SelfCheck {
	readonly task: string;
	/** The judge must fail on the repository as it ships. */
	readonly red: JudgeResult;
	/** And pass with the reference fix applied. */
	readonly green: JudgeResult;
	readonly ok: boolean;
}

/** The red-then-green check a task has to pass before it is allowed to measure anything. */
export function selfCheck(task: TaskFixture): SelfCheck {
	const red = judgeTask(task, { fix: false });
	const green = judgeTask(task, { fix: true });
	return { task: task.id, red, green, ok: !red.passed && green.passed };
}
