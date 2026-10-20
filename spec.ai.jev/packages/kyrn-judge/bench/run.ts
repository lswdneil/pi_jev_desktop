/**
 * The timing harness shared by the three cases in `cases.ts`: warm up, sample, report p50 and p95.
 *
 * A benchmark that runs once measures the JIT, not the code, and a mean lets one slow sample carry the number.
 * So each case warms up first and is then sampled `SAMPLES` times; `p50` is the median, which is what the gate
 * compares, and `p95` shows how spiky a case is.
 */

export interface BenchMetric {
	readonly name: string;
	/** Milliseconds for anything timed; bytes for a size that is reported next to a timing. */
	readonly unit: "ms" | "bytes";
	readonly p50: number;
	readonly p95: number;
	readonly samples: number;
}

export const WARMUP = 3;
export const SAMPLES = 20;

export function median(samples: readonly number[]): number {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
	return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Nearest-rank percentile: what "95% of runs were at least this fast" means for a handful of samples. */
export function percentile(samples: readonly number[], fraction: number): number {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((left, right) => left - right);
	const rank = Math.ceil(fraction * sorted.length);
	return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/** Times one case. The work itself is whatever the caller passes; throwing inside it fails the benchmark. */
export async function measure(name: string, run: () => void | Promise<void>): Promise<BenchMetric> {
	for (let index = 0; index < WARMUP; index++) await run();
	const samples: number[] = [];
	for (let index = 0; index < SAMPLES; index++) {
		const started = performance.now();
		await run();
		samples.push(performance.now() - started);
	}
	return {
		name,
		unit: "ms",
		p50: round3(median(samples)),
		p95: round3(percentile(samples, 0.95)),
		samples: SAMPLES,
	};
}
