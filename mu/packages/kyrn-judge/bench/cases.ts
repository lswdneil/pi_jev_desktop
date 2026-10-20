import { chunkLines } from "../src/admission/chunk.ts";
import { planTestLog, segmentTestLog } from "../src/admission/test-log.ts";
import { DecisionEngine } from "../src/decision.ts";
import { Judge } from "../src/judge.ts";
import { MockJudgeProvider } from "../src/providers/mock.ts";
import { type BenchMetric, measure } from "./run.ts";

/**
 * Three hot spots that were only ever numbers in a comment: log segmentation, the rules-only plan for a
 * test log, and the chunking that feeds a batched admission request.
 *
 * Fixed inputs, no network, no judge: a benchmark that can fail because a provider was slow is not a
 * benchmark. `bench/bench.ts` turns the results into the repository's baseline format and the CLI output.
 */

/** A vitest-like log big enough that segmentation is the work, deterministic so runs compare. */
export function sampleLog(lines = 4000): string {
	const parts: string[] = [" RUN  v4.1.11 /repo/packages/kyrn-judge", ""];
	for (let index = 0; index < lines; index++) {
		if (index % 97 === 0) parts.push(` ✓ test/case-${index}.test.ts (3 tests) ${index % 200}ms`);
		else if (index % 101 === 0)
			parts.push(` × test/failing-${index}.test.ts > case ${index}`, "   AssertionError: expected 1 to be 2");
		else parts.push(`   ✓ handles case ${index} (${index % 40}ms)`);
	}
	parts.push("", ` Test Files  ${Math.floor(lines / 50)} passed`, "      Tests  4000 passed (4000)");
	return parts.join("\n");
}

export async function runBenchmarks(): Promise<BenchMetric[]> {
	const log = sampleLog();
	// Chunking a 4000-line log is a fraction of a millisecond, which measures the timer rather than the code.
	// Ten times the input keeps it in the range where a regression is visible.
	const bigLog = sampleLog(40_000);
	const engine = new DecisionEngine({
		judge: new Judge({ provider: new MockJudgeProvider(() => ({})) }),
		defaultMode: "off",
	});
	const input = { call: "bash: npm test", output: log, goal: "", intent: "" };

	const segment = await measure("segmentTestLog", () => {
		if (segmentTestLog(log, ["admission"]).length === 0) throw new Error("segmentation produced nothing");
	});
	const plan = await measure("planTestLogRules", async () => {
		// `rules` never asks the judge; the promise resolves without a provider request.
		await planTestLog(input, "rules", engine);
	});
	const chunk = await measure("chunkLines", () => {
		if (chunkLines(bigLog, 1200).length === 0) throw new Error("chunking produced nothing");
	});
	return [segment, plan, chunk];
}
