import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BenchMetric } from "../../packages/kyrn-judge/bench/run.ts";
import { runDesktopProbes, transcriptBytes } from "./probes.ts";

/**
 * The desktop-independent half of the performance baseline: transcript codecs, one message's render cost and
 * streaming batching. It answers whether a different shell could move these numbers at all, before anyone
 * spends months rewriting the UI.
 *
 *   node --experimental-strip-types bench/desktop/run.ts
 *   node --experimental-strip-types bench/desktop/run.ts --json
 *   node --experimental-strip-types bench/desktop/run.ts --write-baseline
 *
 * `--json` prints the same envelope the other benchmarks use (C6 in
 * docs/plans/production-readiness/04-CONVENTIONS.md), so `scripts/perf-budget.mjs` compares it with
 * `bench/desktop/baseline.json` without a second parser.
 */

export interface DesktopBenchRun {
	readonly schemaVersion: 1;
	readonly generatedAt: string;
	readonly node: string;
	readonly platform: string;
	readonly metrics: Record<string, Omit<BenchMetric, "name">>;
}

/** Adds the byte sizes, which are not timings but decide how much a shell has to move. */
export async function runDesktopBaseline(now = new Date()): Promise<DesktopBenchRun> {
	const metrics: Record<string, Omit<BenchMetric, "name">> = {};
	for (const metric of await runDesktopProbes()) {
		metrics[metric.name] = { unit: metric.unit, p50: metric.p50, p95: metric.p95, samples: metric.samples };
	}
	// The sizes are fixed for a fixed transcript, so they carry one sample and no spread.
	const bytes = transcriptBytes();
	metrics["transcript.jsonl.bytes"] = { unit: "bytes", p50: bytes.jsonl, p95: bytes.jsonl, samples: 1 };
	metrics["transcript.cbor.bytes"] = { unit: "bytes", p50: bytes.cbor, p95: bytes.cbor, samples: 1 };
	return {
		schemaVersion: 1,
		generatedAt: now.toISOString(),
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		metrics,
	};
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("bench/desktop/run.ts")) {
	const run = await runDesktopBaseline();
	const json = JSON.stringify(run, null, "\t");
	if (process.argv.includes("--json")) console.log(json);
	else {
		for (const [name, metric] of Object.entries(run.metrics)) {
			console.log(
				`${name.padEnd(28)} p50 ${String(metric.p50).padStart(8)} ${metric.unit}   p95 ${metric.p95} ${metric.unit}`,
			);
		}
		console.log(`node ${run.node} on ${run.platform}`);
	}
	if (process.argv.includes("--write-baseline")) {
		writeFileSync(fileURLToPath(new URL("./baseline.json", import.meta.url)), `${json}\n`);
		console.log("baseline written to bench/desktop/baseline.json");
	}
}
