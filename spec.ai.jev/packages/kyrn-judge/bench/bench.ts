import { runBenchmarks } from "./cases.ts";
import type { BenchMetric } from "./run.ts";

/**
 * The benchmark entry point: runs the three cases and prints them, either for a human or as the repository's
 * baseline format (C6 in `docs/plans/production-readiness/04-CONVENTIONS.md`), which
 * `scripts/bench-gate.mjs` compares against `baseline.json`.
 *
 * Run from the repository root:
 *   node --experimental-strip-types packages/kyrn-judge/bench/bench.ts
 *   node --experimental-strip-types packages/kyrn-judge/bench/bench.ts --json
 *
 * Offline and deterministic: the input log is generated, the judge is a mock, nothing is fetched.
 */

export interface BenchRun {
	readonly schemaVersion: 1;
	readonly generatedAt: string;
	readonly node: string;
	readonly platform: string;
	readonly metrics: Record<string, Omit<BenchMetric, "name">>;
}

export async function runBenchmarksAsBaseline(now = new Date()): Promise<BenchRun> {
	const metrics: Record<string, Omit<BenchMetric, "name">> = {};
	for (const metric of await runBenchmarks()) {
		metrics[metric.name] = { unit: metric.unit, p50: metric.p50, p95: metric.p95, samples: metric.samples };
	}
	return {
		schemaVersion: 1,
		generatedAt: now.toISOString(),
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		metrics,
	};
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("bench/bench.ts")) {
	const run = await runBenchmarksAsBaseline();
	if (process.argv.includes("--json")) console.log(JSON.stringify(run, null, "\t"));
	else {
		for (const [name, metric] of Object.entries(run.metrics)) {
			console.log(`${name}: p50 ${metric.p50} ms, p95 ${metric.p95} ms (${metric.samples} samples)`);
		}
		console.log(`node ${run.node} on ${run.platform}`);
	}
}
