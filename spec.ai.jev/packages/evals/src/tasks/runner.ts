// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The benchmark: one task, four arms, a verdict per run.
 *
 * `faux` applies the reference fix, so it measures the machinery — discovery, judging, the report — and says nothing
 * about a model. `agent` runs the real command line against the task's repository, which is the measurement the
 * report exists for and the one that needs a model and a budget. Both write the same `TaskRun`, so the report is
 * honest about which one it is looking at.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeTask, runJudgeCommand } from "./judge.ts";
import {
	ARMS,
	type ArmName,
	type ArmSummary,
	type BenchmarkReport,
	type Executor,
	type TaskFixture,
	type TaskRun,
} from "./types.ts";

export interface ArmProfile {
	readonly arm: ArmName;
	readonly env: Readonly<Record<string, string>>;
	readonly description: string;
}

/**
 * What each arm changes. The judgment layer is the only difference: the same binary, the same task, the same model.
 * `pi-baseline` runs with the kernel off — the closest thing to pi that this repository can execute without a second
 * checkout, and the number a reader should compare mu against.
 */
export function armProfile(arm: ArmName): ArmProfile {
	switch (arm) {
		case "pi-baseline":
			return { arm, env: { SPEC_AI_JEV_JUDGE: "off" }, description: "the agent with mu's judgment layer off" };
		case "mu-active":
			return { arm, env: { SPEC_AI_JEV_DECISIONS: "active" }, description: "judgments act on the run" };
		case "mu-shadow":
			return { arm, env: { SPEC_AI_JEV_DECISIONS: "shadow" }, description: "judgments are recorded but do not act" };
		case "mu-off":
			return { arm, env: { SPEC_AI_JEV_JUDGE: "off" }, description: "judgments are not consulted at all" };
	}
}

/** Write the arm's settings where the harness reads them, so a mode is chosen the way a person chooses it. */
export function prepareAgentDir(root: string, arm: ArmName): string {
	const agentDir = join(root, ".spec.ai.jev", "agent");
	mkdirSync(agentDir, { recursive: true });
	const modes: Record<string, string> = {};
	if (arm === "mu-shadow") modes.default = "shadow";
	writeFileSync(
		join(agentDir, "agent.json"),
		`${JSON.stringify({ schemaVersion: 1, ...(Object.keys(modes).length === 0 ? {} : { modes }) }, null, 2)}\n`,
	);
	return agentDir;
}

export interface AgentOutcome {
	readonly changed: boolean;
	readonly costUsd: number;
	readonly error?: string;
}

/** Runs the agent on one task in its own copy of the repository. Injected, so the runner is testable without a key. */
export type AgentExecutor = (options: {
	readonly task: TaskFixture;
	readonly arm: ArmName;
	readonly model: string | undefined;
	readonly workspace: string;
}) => Promise<AgentOutcome>;

/** The agent that actually runs: `<command> --mode json <args> <prompt>` in the task's copy. */
export function commandExecutor(cliPath: string, extraArgs: readonly string[] = []): AgentExecutor {
	return async ({ task, arm, model, workspace }) => {
		const profile = armProfile(arm);
		const result = spawnSync(
			process.execPath,
			[cliPath, "--mode", "json", ...(model === undefined ? [] : ["--model", model]), ...extraArgs, task.prompt],
			{
				cwd: workspace,
				encoding: "utf8",
				timeout: 900_000,
				env: { ...process.env, ...profile.env },
			},
		);
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		if (result.error !== undefined) return { changed: false, costUsd: 0, error: result.error.message };
		if (result.status !== 0) {
			return {
				changed: false,
				costUsd: 0,
				error: output.trim().slice(-1_500) || `the agent exited with ${result.status}`,
			};
		}
		return { changed: true, costUsd: costOf(output) };
	};
}

/** The spend the agent reported, summed. The JSON stream carries `usage` per message; an absent usage is zero. */
export function costOf(output: string): number {
	let total = 0;
	for (const line of output.split("\n")) {
		const text = line.trim();
		if (!text.startsWith("{")) continue;
		try {
			const event = JSON.parse(text) as { usage?: { cost?: { total?: unknown } } };
			const cost = event.usage?.cost?.total;
			if (typeof cost === "number" && Number.isFinite(cost)) total += cost;
		} catch {
			// Not a JSON line: the agent's own logging, which is not spend.
		}
	}
	return total;
}

export interface BenchmarkOptions {
	readonly tasks: readonly TaskFixture[];
	readonly arm: ArmName;
	readonly executor: Executor;
	readonly budgetUsd?: number;
	readonly model?: string;
	readonly cliPath?: string;
	/** Injected in tests; required when the executor is `agent`. */
	readonly execute?: AgentExecutor;
	/** Called after each run, which is what the CLI prints and what a test can watch. */
	readonly onRun?: (run: TaskRun) => void;
}

export async function runArm(options: BenchmarkOptions): Promise<{ runs: TaskRun[]; stoppedForBudget: boolean }> {
	const runs: TaskRun[] = [];
	let spent = 0;
	let stoppedForBudget = false;

	for (const task of options.tasks) {
		const started = Date.now();
		let costUsd = 0;
		let action: TaskRun["action"] = "nothing";
		let error: string | undefined;

		if (options.executor === "faux") {
			// The reference fix, applied by hand: this is the machinery's check, not a model's.
			action = "fixed";
		} else {
			const execute =
				options.execute ?? (options.cliPath === undefined ? undefined : commandExecutor(options.cliPath));
			if (execute === undefined) throw new Error("an agent run needs an executor (or a cliPath)");
			const workspace = copyWorkspace(task);
			try {
				const outcome = await execute({ task, arm: options.arm, model: options.model, workspace });
				costUsd = outcome.costUsd;
				error = outcome.error;
				action = outcome.error !== undefined ? "error" : outcome.changed ? "fixed" : "nothing";
				if (action === "fixed") {
					// The agent edited the copy in place; the judged result is that copy.
					const judged = judgeWorkspace(task, workspace);
					runs.push({
						task: task.id,
						arm: options.arm,
						executor: options.executor,
						action,
						judge: judged,
						ms: Date.now() - started,
						costUsd,
						...(error === undefined ? {} : { error }),
					});
					options.onRun?.(runs.at(-1) as TaskRun);
					spent += costUsd;
					if (options.budgetUsd !== undefined && spent > options.budgetUsd) {
						stoppedForBudget = true;
						break;
					}
					continue;
				}
			} finally {
				rmSync(workspace, { recursive: true, force: true });
			}
		}

		const judge = judgeTask(task, { fix: options.executor === "faux" });
		const run: TaskRun = {
			task: task.id,
			arm: options.arm,
			executor: options.executor,
			action,
			judge,
			ms: Date.now() - started,
			costUsd,
			...(error === undefined ? {} : { error }),
		};
		runs.push(run);
		options.onRun?.(run);
		spent += costUsd;
		if (options.budgetUsd !== undefined && spent > options.budgetUsd) {
			stoppedForBudget = true;
			break;
		}
	}

	return { runs, stoppedForBudget };
}

function copyWorkspace(task: TaskFixture): string {
	const workspace = mkdtempSync(join(tmpdir(), `spec-ai-agent-${task.id}-`));
	cpSync(join(task.directory, "repo"), workspace, { recursive: true });
	return workspace;
}

/** Judge the copy the agent worked in, without copying it again. */
function judgeWorkspace(task: TaskFixture, workspace: string): ReturnType<typeof judgeTask> {
	return runJudgeCommand(task, workspace);
}

export function summarize(runs: readonly TaskRun[]): ArmSummary[] {
	return ARMS.map((arm) => {
		const own = runs.filter((run) => run.arm === arm);
		const passed = own.filter((run) => run.judge.passed).length;
		return {
			arm,
			tasks: own.length,
			passed,
			completion: own.length === 0 ? 0 : passed / own.length,
			costUsd: own.reduce((total, run) => total + run.costUsd, 0),
			wallMs: own.reduce((total, run) => total + run.ms, 0),
			// A run that ended without a pass, and without an error to explain it: a person would have had to finish it.
			interventions: own.filter((run) => !run.judge.passed && run.action !== "error").length,
		};
	}).filter((summary) => summary.tasks > 0);
}

/** The report as Markdown: what ran, against what, and how each arm did. */
export function renderReport(report: BenchmarkReport): string {
	const lines = [
		`# Task benchmark — ${report.generatedAt.slice(0, 10)}`,
		"",
		`Executor: \`${report.executor}\`${report.model === undefined ? "" : ` · model: \`${report.model}\``}.`,
		report.executor === "faux"
			? "The faux executor applies each task's reference fix: this report checks the harness and the judges, **not** a model."
			: "The agent executor ran the real command line against each task's repository.",
		"",
		"| Arm | Tasks | Passed | Completion | Cost (USD) | Wall (s) | Would need a person |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...report.arms.map(
			(arm) =>
				`| ${arm.arm} | ${arm.tasks} | ${arm.passed} | ${(arm.completion * 100).toFixed(0)}% | ${arm.costUsd.toFixed(4)} | ${(arm.wallMs / 1000).toFixed(1)} | ${arm.interventions} |`,
		),
		"",
	];
	if (report.stoppedForBudget === true) {
		lines.push(`Stopped early: the budget of ${(report.budgetUsd ?? 0).toFixed(2)} USD ran out.`, "");
	}
	const failed = report.runs.filter((run) => !run.judge.passed);
	if (failed.length > 0) {
		lines.push("## Runs that did not pass", "");
		for (const run of failed) {
			lines.push(
				`- \`${run.arm}\` / \`${run.task}\` (${run.action})${run.error === undefined ? "" : `: ${run.error.split("\n")[0]}`}`,
			);
		}
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

/** Where the machine-readable copy goes, beside the Markdown. */
export function writeReport(directory: string, report: BenchmarkReport): { markdown: string; json: string } {
	mkdirSync(directory, { recursive: true });
	const stamp = report.generatedAt.slice(0, 10);
	const markdown = join(directory, `${stamp}.md`);
	const json = join(directory, `${stamp}.json`);
	writeFileSync(markdown, renderReport(report));
	writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
	return { markdown, json };
}
