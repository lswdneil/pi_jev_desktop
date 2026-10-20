// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * `node --experimental-strip-types packages/evals/src/tasks/cli.ts`
 *
 *   --self-check                 every task's judge must fail before the fix and pass after it
 *   --arm <name|all>             which arm(s) to run (default: all)
 *   --executor faux|agent        faux applies the reference fix; agent runs the real command line
 *   --limit <n>                  at most n tasks, for a smoke run
 *   --budget <usd>               stop when the reported spend passes this
 *   --model <provider/model>     the model an agent run uses
 *   --cli <path>                 the command line to run (default: the workspace's coding agent)
 *   --out <dir>                  where the report goes (default: docs/evals/reports)
 *
 * The exit code is 0 when everything that ran passed its judge, 1 when some run failed, and 2 when the arguments
 * (or the environment) cannot produce a measurement — an agent run without a model says so instead of pretending.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { discoverTasks, selfCheck } from "./judge.ts";
import { commandExecutor, renderReport, runArm, summarize, writeReport } from "./runner.ts";
import { ARMS, type ArmName, type BenchmarkReport, type Executor, type TaskRun } from "./types.ts";

/** `packages/evals/src/tasks` → the repository root. */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
/**
 * The fixtures live at the repository root (`evals/tasks/`), not inside `packages/`: each is another repository — plain
 * `.js`, its own `package.json` — and the scripts that walk `packages/*` would read them as this package's sources.
 */
const TASKS_ROOT = join(REPO_ROOT, "evals", "tasks");
/** pi's own entry point, as its `bin` names it: `dist/bundle/cli.js`, not `dist/cli.js`. */
const DEFAULT_CLI = join(REPO_ROOT, "packages", "coding-agent", "dist", "bundle", "cli.js");

interface Args {
	readonly selfCheckOnly: boolean;
	readonly arms: readonly ArmName[];
	readonly executor: Executor;
	readonly limit: number | undefined;
	readonly budgetUsd: number | undefined;
	readonly model: string | undefined;
	readonly cliPath: string;
	readonly out: string;
}

function parse(argv: readonly string[]): Args | { error: string } {
	const arms: ArmName[] = [];
	let executor: Executor = "faux";
	let limit: number | undefined;
	let budgetUsd: number | undefined;
	let model: string | undefined;
	let cliPath = DEFAULT_CLI;
	let out = join(REPO_ROOT, "docs", "evals", "reports");
	let selfCheckOnly = false;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const next = (): string | undefined => argv[++index];
		if (arg === "--self-check") selfCheckOnly = true;
		else if (arg === "--arm") {
			const value = next();
			if (value === undefined) return { error: "--arm needs a value" };
			if (value === "all") arms.push(...ARMS);
			else if ((ARMS as readonly string[]).includes(value)) arms.push(value as ArmName);
			else return { error: `unknown arm ${value}; the arms are ${ARMS.join(", ")}` };
		} else if (arg === "--executor") {
			const value = next();
			if (value !== "faux" && value !== "agent") return { error: "--executor is faux or agent" };
			executor = value;
		} else if (arg === "--limit") {
			const value = Number(next());
			if (!Number.isInteger(value) || value <= 0) return { error: "--limit needs a positive integer" };
			limit = value;
		} else if (arg === "--budget") {
			const value = Number(next());
			if (!Number.isFinite(value) || value <= 0) return { error: "--budget needs a positive number of dollars" };
			budgetUsd = value;
		} else if (arg === "--model") model = next();
		else if (arg === "--cli") {
			const value = next();
			if (value === undefined) return { error: "--cli needs a path" };
			cliPath = value;
		} else if (arg === "--out") {
			const value = next();
			if (value === undefined) return { error: "--out needs a directory" };
			out = value;
		} else {
			return { error: `unknown argument ${arg}` };
		}
	}

	if (arms.length === 0) arms.push(...ARMS);
	if (executor === "agent" && model === undefined)
		return { error: "an agent run needs --model: without one there is nothing to measure" };
	return { selfCheckOnly, arms, executor, limit, budgetUsd, model, cliPath, out };
}

async function main(): Promise<number> {
	const parsed = parse(process.argv.slice(2));
	if ("error" in parsed) {
		console.error(`tasks: ${parsed.error}`);
		return 2;
	}

	const all = discoverTasks(TASKS_ROOT);
	if (all.length === 0) {
		console.error(`tasks: no fixtures under ${TASKS_ROOT}`);
		return 2;
	}

	let failed = 0;
	if (parsed.selfCheckOnly) {
		for (const task of all) {
			const check = selfCheck(task);
			console.log(
				`${check.ok ? "ok  " : "FAIL"} ${task.id}: judge ${check.red.passed ? "PASSES" : "fails"} before, ${check.green.passed ? "passes" : "FAILS"} after`,
			);
			if (!check.ok) failed++;
		}
		console.log(`${all.length - failed}/${all.length} tasks are honest (red before, green after)`);
		return failed === 0 ? 0 : 1;
	}

	const tasks = parsed.limit === undefined ? all : all.slice(0, parsed.limit);
	const runs: TaskRun[] = [];
	let stoppedForBudget = false;
	for (const arm of parsed.arms) {
		const out = await runArm({
			tasks,
			arm,
			executor: parsed.executor,
			...(parsed.budgetUsd === undefined ? {} : { budgetUsd: parsed.budgetUsd }),
			...(parsed.model === undefined ? {} : { model: parsed.model }),
			cliPath: parsed.cliPath,
			execute: parsed.executor === "agent" ? commandExecutor(parsed.cliPath) : undefined,
			onRun: (run) =>
				console.log(`${run.judge.passed ? "pass" : "fail"} ${run.arm} / ${run.task} (${run.action}, ${run.ms} ms)`),
		});
		runs.push(...out.runs);
		if (out.stoppedForBudget) {
			stoppedForBudget = true;
			break;
		}
	}

	const report: BenchmarkReport = {
		generatedAt: new Date().toISOString(),
		executor: parsed.executor,
		...(parsed.model === undefined ? {} : { model: parsed.model }),
		arms: summarize(runs),
		runs,
		...(stoppedForBudget ? { stoppedForBudget, budgetUsd: parsed.budgetUsd ?? 0 } : {}),
	};
	const written = writeReport(parsed.out, report);
	process.stdout.write(`${renderReport(report)}\n`);
	console.log(`report: ${written.markdown} (+ ${written.json})`);

	failed = runs.filter((run) => !run.judge.passed).length;
	if (stoppedForBudget) console.log("stopped early: the budget ran out");
	return stoppedForBudget || failed > 0 ? 1 : 0;
}

if (!existsSync(TASKS_ROOT)) {
	console.error(`tasks: ${TASKS_ROOT} is missing`);
	process.exitCode = 2;
} else {
	process.exitCode = await main();
}
