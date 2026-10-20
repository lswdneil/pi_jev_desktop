import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GatewayJudgeProvider } from "../../kyrn-judge/src/providers/gateway.ts";
import { TypeSafeJudgeProvider } from "../../kyrn-judge/src/providers/typesafe.ts";
import type { JudgeProvider } from "../../kyrn-judge/src/types.ts";
import { heldOutCases, type TestLogCase, testLogCases } from "../../kyrn-judge/test/fixtures/test-log-cases.ts";
import { type Arm, counted, liveArms, offlineArms, WORDINGS } from "./arms.ts";
import { type ReplayResult, replayTestLogs } from "./replay.ts";
import { evaluateThresholds, type JudgeEvalBaseline, restrictBaseline, toBaseline } from "./thresholds.ts";

/**
 * Replays the labeled test-log corpus through the admission arms, offline by default.
 *
 *   node packages/judge-evals/src/cli.ts --arm rules --json
 *   node packages/judge-evals/src/cli.ts --set heldout
 *   node packages/judge-evals/src/cli.ts --update-baseline
 *   AI_GATEWAY_API_KEY=… node packages/judge-evals/src/cli.ts --judge jev --max-requests 150
 *
 * The offline arms cost nothing and contact nobody. A live run is skipped, not failed, when no key is set:
 * an evaluation that cannot run offline is an evaluation nobody can reproduce.
 */

const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "baseline.json");
const DEFAULT_MAX_REQUESTS = 150;

export type CorpusSet = "all" | "tuned" | "heldout";

export interface CliOptions {
	readonly arms?: readonly string[];
	readonly set: CorpusSet;
	readonly json: boolean;
	readonly updateBaseline: boolean;
	readonly live: boolean;
	readonly maxRequests: number;
	readonly archive?: string;
}

export function parseArgs(argv: readonly string[]): CliOptions {
	let arms: string[] | undefined;
	let set: CorpusSet = "all";
	let json = false;
	let updateBaseline = false;
	let live = false;
	let maxRequests = DEFAULT_MAX_REQUESTS;
	let archive: string | undefined;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		switch (argument) {
			case "--arm":
				arms = (argv[++index] ?? "").split(",").filter((name) => name !== "");
				break;
			case "--set": {
				const value = argv[++index] ?? "";
				if (value !== "all" && value !== "tuned" && value !== "heldout")
					throw new Error(`--set needs all, tuned or heldout, got "${value}"`);
				set = value;
				break;
			}
			case "--json":
				json = true;
				break;
			case "--update-baseline":
				updateBaseline = true;
				break;
			case "--judge":
				index++;
				live = true;
				break;
			case "--max-requests":
				maxRequests = Number(argv[++index] ?? "");
				if (!Number.isInteger(maxRequests) || maxRequests < 1)
					throw new Error("--max-requests needs a positive integer");
				break;
			case "--archive":
				archive = argv[++index];
				break;
			default:
				throw new Error(`unknown argument "${argument}"`);
		}
	}
	return { arms, set, json, updateBaseline, live, maxRequests, archive };
}

export function corpusFor(set: CorpusSet): readonly TestLogCase[] {
	if (set === "heldout") return heldOutCases;
	if (set === "tuned") return testLogCases.filter((testCase) => !heldOutCases.includes(testCase));
	return testLogCases;
}

/** A live provider, or undefined when no key is configured. */
export function liveProvider(env: NodeJS.ProcessEnv): JudgeProvider | undefined {
	if (env.TYPESAFE_API_KEY) return new TypeSafeJudgeProvider({ apiKey: () => env.TYPESAFE_API_KEY });
	if (env.AI_GATEWAY_API_KEY)
		return new GatewayJudgeProvider({ apiKey: () => env.AI_GATEWAY_API_KEY, model: "typesafe-ai/jev" });
	return undefined;
}

export function readBaseline(path = BASELINE_PATH): JudgeEvalBaseline | undefined {
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8")) as JudgeEvalBaseline;
}

function selectArms(options: CliOptions, env: NodeJS.ProcessEnv): { arms: Arm[]; notes: string[] } {
	const notes: string[] = [];
	let arms = offlineArms();
	if (options.live) {
		const provider = liveProvider(env);
		if (provider) arms = [...arms, ...liveArms(counted(provider, options.maxRequests), WORDINGS, [true, false])];
		else notes.push("no judge key (TYPESAFE_API_KEY or AI_GATEWAY_API_KEY): the live arms are skipped");
	}
	if (options.arms) {
		const wanted = arms.filter((arm) => options.arms?.includes(arm.name));
		const missing = options.arms.filter((name) => !wanted.some((arm) => arm.name === name));
		if (missing.length > 0) notes.push(`no such arm: ${missing.join(", ")}`);
		arms = wanted;
	}
	return { arms, notes };
}

export interface CliReport {
	readonly set: CorpusSet;
	readonly cases: number;
	readonly live: boolean;
	readonly summary: ReplayResult["summary"];
	readonly failures: readonly string[];
	readonly notes: readonly string[];
	readonly baseline: JudgeEvalBaseline | undefined;
}

export async function runReplay(options: CliOptions, env: NodeJS.ProcessEnv = process.env): Promise<CliReport> {
	const cases = corpusFor(options.set);
	const selected = selectArms(options, env);
	if (selected.arms.length === 0) throw new Error("no arm selected: nothing would be replayed");
	const archiveDir = options.archive ?? mkdtempSync(join(tmpdir(), "judge-evals-"));
	const { summary } = await replayTestLogs({ cases, arms: selected.arms, archiveDir });
	const live = selected.arms.some((arm) => arm.name.startsWith("jev:"));

	if (options.updateBaseline && live)
		throw new Error("the baseline is recorded from the offline arms; run --update-baseline without --judge");
	const compared = options.updateBaseline ? undefined : readBaseline();
	// A run that asked for specific arms only answers for those arms; it says nothing about the rest.
	const baseline =
		compared && options.arms
			? restrictBaseline(
					compared,
					selected.arms.map((arm) => arm.name),
				)
			: compared;
	const report = options.updateBaseline
		? toBaseline(summary)
		: evaluateThresholds(
				summary,
				baseline ?? { schemaVersion: 1, generatedAt: "", node: "", platform: "", metrics: {} },
			);
	if (options.updateBaseline) writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, "\t")}\n`);

	const notes = [...selected.notes, ...("notes" in report ? report.notes : [])];
	const failures = "failures" in report ? report.failures : [];
	return {
		set: options.set,
		cases: cases.length,
		live,
		summary,
		failures,
		notes,
		baseline: options.updateBaseline ? (report as JudgeEvalBaseline) : baseline,
	};
}

function renderTable(summary: ReplayResult["summary"]): string {
	const header = ["arm", "cases", "required", "wrong", "optional", "net%", "calls", "tokens", "fallbacks"];
	const lines = [header.join("\t")];
	for (const arm of summary) {
		lines.push(
			[
				arm.arm,
				arm.cases,
				`${arm.requiredKept}/${arm.requiredTotal}`,
				arm.wrongOmissions,
				`${arm.optionalOmitted}/${arm.optionalTotal}`,
				arm.netSavedPct,
				arm.judgeCalls,
				arm.inputTokens,
				arm.fallbacks,
			].join("\t"),
		);
	}
	return lines.join("\n");
}

function invokedDirectly(): boolean {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const options = parseArgs(process.argv.slice(2));
	const report = await runReplay(options);
	if (options.json) console.log(JSON.stringify(report, null, "\t"));
	else {
		console.log(`${report.cases} cases (${report.set}${report.live ? ", live arms" : ""})`);
		console.log(renderTable(report.summary));
		for (const note of report.notes) console.log(`note: ${note}`);
		for (const failure of report.failures) console.log(`FAIL: ${failure}`);
		if (report.failures.length === 0 && !options.updateBaseline) console.log("thresholds met");
	}
	process.exitCode = report.failures.length > 0 ? 1 : 0;
}
