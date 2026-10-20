import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planTestLog, renderTestLog, type TestLogPlan } from "../../kyrn-judge/src/admission/test-log.ts";
import { DecisionEngine } from "../../kyrn-judge/src/decision.ts";
import { Judge } from "../../kyrn-judge/src/judge.ts";
import type { JudgeProvider, JudgeRequest } from "../../kyrn-judge/src/types.ts";
import type { TestLogCase } from "../../kyrn-judge/test/fixtures/test-log-cases.ts";
import type { Arm } from "./arms.ts";

/** How long one judge call may take while replaying. The arms are offline or budgeted; this only bounds a hang. */
const JUDGE_TIMEOUT_MS = 20_000;

export interface ReplayRow {
	readonly arm: string;
	readonly case: string;
	readonly chars: number;
	readonly source: TestLogPlan["source"];
	readonly reason?: string;
	readonly applied: boolean;
	readonly candidates: number;
	readonly asked: number;
	readonly omitted: number;
	readonly requiredKept: number;
	readonly requiredTotal: number;
	/** Required substrings this arm dropped. Non-empty is an error for every arm that claims to protect them. */
	readonly lost: readonly string[];
	readonly optionalOmitted: number;
	readonly optionalTotal: number;
	readonly netSavedChars: number;
	readonly judgeCalls: number;
	readonly latencyMs?: number;
	readonly inputTokens?: number;
	/** Characters the main model must read back if it follows the pointer after a wrong omission. */
	readonly recoveryChars: number;
	readonly archiveIntact: boolean;
}

export interface ArmSummary {
	readonly arm: string;
	readonly cases: number;
	readonly applied: number;
	readonly requiredKept: number;
	readonly requiredTotal: number;
	readonly wrongOmissions: number;
	readonly casesWithLoss: number;
	readonly optionalOmitted: number;
	readonly optionalTotal: number;
	readonly netSavedChars: number;
	/** Net characters saved over the raw log, in percent, one decimal. */
	readonly netSavedPct: number;
	readonly judgeCalls: number;
	readonly inputTokens: number;
	readonly recoveryChars: number;
	readonly fallbacks: number;
	readonly archivesIntact: boolean;
}

export interface ReplayOptions {
	readonly cases: readonly TestLogCase[];
	readonly arms: readonly Arm[];
	/** Where the omitted text is archived: the rendered log carries a pointer to a file here. */
	readonly archiveDir: string;
}

export interface ReplayResult {
	readonly rows: readonly ReplayRow[];
	readonly summary: readonly ArmSummary[];
}

/** One provider per case, so the call count belongs to the row it is reported on. */
function counted(provider: JudgeProvider): JudgeProvider & { calls: number } {
	const wrapper = {
		id: provider.id,
		calls: 0,
		evaluate: async (request: JudgeRequest) => {
			wrapper.calls++;
			return provider.evaluate(request);
		},
	};
	return wrapper;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function summarize(arm: string, rows: readonly ReplayRow[]): ArmSummary {
	const mine = rows.filter((row) => row.arm === arm);
	const sum = (pick: (row: ReplayRow) => number) => mine.reduce((total, row) => total + pick(row), 0);
	const chars = sum((row) => row.chars);
	const saved = sum((row) => row.netSavedChars);
	return {
		arm,
		cases: mine.length,
		applied: mine.filter((row) => row.applied).length,
		requiredKept: sum((row) => row.requiredKept),
		requiredTotal: sum((row) => row.requiredTotal),
		wrongOmissions: sum((row) => row.lost.length),
		casesWithLoss: mine.filter((row) => row.lost.length > 0).length,
		optionalOmitted: sum((row) => row.optionalOmitted),
		optionalTotal: sum((row) => row.optionalTotal),
		netSavedChars: saved,
		netSavedPct: chars === 0 ? 0 : round1((saved / chars) * 100),
		judgeCalls: sum((row) => row.judgeCalls),
		inputTokens: sum((row) => row.inputTokens ?? 0),
		recoveryChars: sum((row) => row.recoveryChars),
		fallbacks: mine.filter((row) => row.source === "fallback").length,
		archivesIntact: mine.every((row) => row.archiveIntact),
	};
}

/**
 * Replays every case through every arm and reports, per arm and per case, the required evidence kept, the
 * optional noise omitted, the net characters saved and what a wrong omission would cost to recover.
 *
 * Offline and deterministic: no provider is contacted unless an arm was built with a live one, and the
 * archive is a directory the caller owns.
 */
export async function replayTestLogs(options: ReplayOptions): Promise<ReplayResult> {
	mkdirSync(options.archiveDir, { recursive: true });
	const rows: ReplayRow[] = [];
	for (const arm of options.arms) {
		for (const testCase of options.cases) {
			const provider = arm.provider ? counted(arm.provider) : undefined;
			const engine = new DecisionEngine({
				judge: new Judge({
					provider: provider ?? { id: "none", evaluate: async () => ({ answers: {}, usage: {} }) },
					timeoutMs: JUDGE_TIMEOUT_MS,
				}),
				defaultMode: "active",
			});
			// The oracle answers from the full candidate text, which the clipped judge state does not carry.
			const preview = await planTestLog(testCase, "full", engine, { anchors: arm.anchors });
			arm.prepare?.(testCase, new Map(preview.units.map((unit) => [unit.id, unit.text])));

			const plan = await planTestLog(testCase, arm.strategy, engine, { wording: arm.wording, anchors: arm.anchors });
			const archivePath = join(options.archiveDir, `${arm.name.replace(/[^\w.-]/g, "_")}-${testCase.id}.txt`);
			writeFileSync(archivePath, testCase.output);
			const rendered = renderTestLog(plan, archivePath);

			const lost = testCase.required.filter((required) => !rendered.text.includes(required));
			const pointer = /full output: (.+?)\]/.exec(rendered.text)?.[1];
			rows.push({
				arm: arm.name,
				case: testCase.id,
				chars: testCase.output.length,
				source: plan.source,
				reason: plan.reason,
				applied: rendered.applied,
				candidates: plan.units.filter((unit) => unit.kind !== "protected").length,
				asked: plan.asked.length,
				omitted: rendered.applied ? plan.omitted.length : 0,
				requiredKept: testCase.required.length - lost.length,
				requiredTotal: testCase.required.length,
				lost,
				optionalOmitted: testCase.optional.filter((optional) => !rendered.text.includes(optional)).length,
				optionalTotal: testCase.optional.length,
				netSavedChars: rendered.netSavedChars,
				judgeCalls: provider?.calls ?? 0,
				latencyMs: plan.latencyMs,
				inputTokens: plan.usage?.inputTokens,
				recoveryChars: lost.length > 0 ? testCase.output.length : 0,
				archiveIntact:
					!rendered.applied || (pointer === archivePath && readFileSync(pointer, "utf8") === testCase.output),
			});
		}
	}
	return { rows, summary: options.arms.map((arm) => summarize(arm.name, rows)) };
}

/** The subset of a row that must be identical between two runs: everything except timings and tokens. */
export function stableProjection(rows: readonly ReplayRow[]): readonly string[] {
	return rows.map((row) =>
		[
			row.arm,
			row.case,
			row.applied,
			row.omitted,
			row.requiredKept,
			row.lost.join("|"),
			row.optionalOmitted,
			row.netSavedChars,
			row.archiveIntact,
		].join(":"),
	);
}
