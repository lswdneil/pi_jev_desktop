// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The task benchmark's shapes.
 *
 * A task is a directory with a small repository, a prompt and a reference fix. Its judge is the repository's own test
 * command — never a model's opinion of its own work, which is the one thing this benchmark exists to avoid.
 */

/** The four arms the benchmark compares. `pi-baseline` is the same binary with the judgment layer off: this repository ships one coding agent, and the baseline is what it does without mu's kernel. */
export const ARMS = ["pi-baseline", "mu-active", "mu-shadow", "mu-off"] as const;

export type ArmName = (typeof ARMS)[number];

/** How an arm runs the agent. `faux` applies the reference fix, which checks the plumbing and nothing about a model. */
export type Executor = "faux" | "agent";

export interface JudgeSpec {
	/** The command that decides the task, run in the copied repository. Its exit code is the verdict. */
	readonly command: string;
	readonly args: readonly string[];
	readonly timeoutMs?: number;
}

export interface TaskFixture {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	readonly judge: JudgeSpec;
	/** Absolute path of the fixture directory. */
	readonly directory: string;
}

export interface JudgeResult {
	readonly passed: boolean;
	readonly exitCode: number | null;
	readonly output: string;
	/** Wall clock of the judge, in milliseconds. */
	readonly ms: number;
}

export interface TaskRun {
	readonly task: string;
	readonly arm: ArmName;
	readonly executor: Executor;
	/** What the agent did: `fixed` when it produced a change, `nothing` when it did not. */
	readonly action: "fixed" | "nothing" | "error";
	readonly judge: JudgeResult;
	/** Wall clock of the whole task, in milliseconds. */
	readonly ms: number;
	/** Reported spend for this run, in US dollars. Zero for the faux executor. */
	readonly costUsd: number;
	readonly error?: string;
}

export interface ArmSummary {
	readonly arm: ArmName;
	readonly tasks: number;
	readonly passed: number;
	/** `passed / tasks`, or 0 for an arm that ran nothing. */
	readonly completion: number;
	readonly costUsd: number;
	readonly wallMs: number;
	/** Runs that ended in a judge failure because the model changed nothing: the human would have had to step in. */
	readonly interventions: number;
}

export interface BenchmarkReport {
	readonly generatedAt: string;
	readonly executor: Executor;
	/** The model the agent arms used; absent for the faux executor, which has none. */
	readonly model?: string;
	readonly arms: readonly ArmSummary[];
	readonly runs: readonly TaskRun[];
	/** Set when the run stopped early because the budget ran out. */
	readonly stoppedForBudget?: boolean;
	readonly budgetUsd?: number;
}
