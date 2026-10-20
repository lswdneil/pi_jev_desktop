import type { LedgerRecord } from "../ledger.ts";

/**
 * What the judge cost and how it behaved, in one pass over the ledger.
 *
 * The questions this answers are the ones a bill raises: how many calls, how many tokens, how much
 * money, which decision point is the expensive one, and how often a verdict never came. A record whose
 * model has no price is counted and listed rather than guessed at: a made-up number in a cost report is
 * worse than a gap, because it looks like an answer.
 *
 * The input is an iterable, so a caller streams the ledger (the session files are read line by line)
 * instead of loading it whole.
 */

/** USD per one million tokens, the unit every provider publishes. */
export interface ModelPrice {
	readonly inputPerMillion: number;
	readonly outputPerMillion: number;
}

/** Resolves a model's price, or null when the catalog has none. */
export type PriceLookup = (model: { providerId: string; modelId?: string }) => ModelPrice | null;

export interface AggregateBucket {
	/** Local day of the record: a person's day, not UTC's. */
	readonly day: string;
	readonly specId: string;
	/** `provider/model`, or the provider alone when the record names no model. */
	readonly model: string;
	readonly calls: number;
	/** Calls whose verdict was used (`source === "judge"`). */
	readonly judgeCalls: number;
	readonly fallbacks: number;
	/** Share of calls that fell back; 0 for an empty bucket. */
	readonly fallbackRate: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	/** Null when any model in the bucket has no price. */
	readonly costUsd: number | null;
	readonly latencyP50: number | null;
	readonly latencyP95: number | null;
}

export interface AggregateTotals {
	readonly calls: number;
	readonly judgeCalls: number;
	readonly fallbacks: number;
	readonly fallbackRate: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly costUsd: number | null;
	readonly latencyP50: number | null;
	readonly latencyP95: number | null;
}

export interface LedgerAggregate {
	readonly buckets: readonly AggregateBucket[];
	readonly totals: AggregateTotals;
	/** Models with no price, so a null cost explains itself. */
	readonly unpricedModels: readonly string[];
	/** Days the ledger covers, oldest first. */
	readonly days: readonly string[];
}

export interface AggregateOptions {
	/** Clock for tests; defaults to the record's own timestamp. */
	readonly dayOf?: (record: LedgerRecord) => string;
	readonly price?: PriceLookup;
	/** Latency samples kept per bucket before they are sampled down. Default 500. */
	readonly maxLatencySamples?: number;
}

/** `YYYY-MM-DD` in local time. */
export function localDayOf(isoTimestamp: string): string {
	const date = new Date(isoTimestamp);
	if (Number.isNaN(date.getTime())) return "unknown";
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** How many calls a record counts as: a batch of 30 chunks is 30 calls, not one. */
function callsOf(record: LedgerRecord): number {
	return Math.max(1, record.batch?.size ?? 1);
}

function percentile(sorted: readonly number[], fraction: number): number | null {
	if (sorted.length === 0) return null;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
	return sorted[index] ?? null;
}

interface MutableBucket {
	day: string;
	specId: string;
	model: string;
	calls: number;
	judgeCalls: number;
	fallbacks: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number | null;
	latencies: number[];
	priced: boolean;
}

const LATENCY_SAMPLE_DEFAULT = 500;

/**
 * One streaming pass. Buckets are small objects and latency samples are capped, so memory follows the
 * number of (day, decision, model) combinations rather than the size of the ledger.
 */
export function aggregateLedger(records: Iterable<LedgerRecord>, options: AggregateOptions = {}): LedgerAggregate {
	const dayOf = options.dayOf ?? ((record: LedgerRecord) => localDayOf(record.timestamp));
	const price = options.price ?? (() => null);
	const cap = options.maxLatencySamples ?? LATENCY_SAMPLE_DEFAULT;
	const buckets = new Map<string, MutableBucket>();
	const unpriced = new Set<string>();
	const days = new Set<string>();
	const allLatencies: number[] = [];

	for (const record of records) {
		const day = dayOf(record);
		const model = record.modelId ? `${record.providerId}/${record.modelId}` : record.providerId;
		days.add(day);
		const key = `${day}\u0000${record.specId}\u0000${model}`;
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = {
				day,
				specId: record.specId,
				model,
				calls: 0,
				judgeCalls: 0,
				fallbacks: 0,
				inputTokens: 0,
				outputTokens: 0,
				costUsd: null,
				latencies: [],
				priced: true,
			};
			buckets.set(key, bucket);
		}

		const calls = callsOf(record);
		bucket.calls += calls;
		if (record.source === "judge") bucket.judgeCalls += calls;
		else bucket.fallbacks += calls;
		bucket.inputTokens += record.usage?.inputTokens ?? 0;
		bucket.outputTokens += record.usage?.outputTokens ?? 0;

		const prices = price({ providerId: record.providerId, modelId: record.modelId });
		if (prices && bucket.priced) {
			const cost =
				((record.usage?.inputTokens ?? 0) * prices.inputPerMillion +
					(record.usage?.outputTokens ?? 0) * prices.outputPerMillion) /
				1_000_000;
			bucket.costUsd = (bucket.costUsd ?? 0) + cost;
		} else if (!prices) {
			// A bucket with one unpriced model cannot claim a number: the total would be too low.
			bucket.priced = false;
			bucket.costUsd = null;
			unpriced.add(model);
		}

		if (typeof record.latencyMs === "number") {
			if (bucket.latencies.length < cap) bucket.latencies.push(record.latencyMs);
			allLatencies.push(record.latencyMs);
			if (allLatencies.length > cap * 20) allLatencies.splice(0, allLatencies.length - cap * 20);
		}
	}

	const sorted = [...buckets.values()].sort(
		(left, right) =>
			left.day.localeCompare(right.day) ||
			left.specId.localeCompare(right.specId) ||
			left.model.localeCompare(right.model),
	);
	const resultBuckets: AggregateBucket[] = sorted.map((bucket) => {
		const latencies = [...bucket.latencies].sort((left, right) => left - right);
		return {
			day: bucket.day,
			specId: bucket.specId,
			model: bucket.model,
			calls: bucket.calls,
			judgeCalls: bucket.judgeCalls,
			fallbacks: bucket.fallbacks,
			fallbackRate: bucket.calls === 0 ? 0 : bucket.fallbacks / bucket.calls,
			inputTokens: bucket.inputTokens,
			outputTokens: bucket.outputTokens,
			costUsd: bucket.priced ? Number((bucket.costUsd ?? 0).toFixed(6)) : null,
			latencyP50: percentile(latencies, 0.5),
			latencyP95: percentile(latencies, 0.95),
		};
	});

	const totals = totalsOf(resultBuckets, allLatencies);
	return {
		buckets: resultBuckets,
		totals,
		unpricedModels: [...unpriced].sort(),
		days: [...days].sort(),
	};
}

function totalsOf(buckets: readonly AggregateBucket[], latencies: readonly number[]): AggregateTotals {
	const calls = buckets.reduce((sum, bucket) => sum + bucket.calls, 0);
	const judgeCalls = buckets.reduce((sum, bucket) => sum + bucket.judgeCalls, 0);
	const fallbacks = buckets.reduce((sum, bucket) => sum + bucket.fallbacks, 0);
	const inputTokens = buckets.reduce((sum, bucket) => sum + bucket.inputTokens, 0);
	const outputTokens = buckets.reduce((sum, bucket) => sum + bucket.outputTokens, 0);
	const everyBucketPriced = buckets.every((bucket) => bucket.costUsd !== null);
	const costUsd = everyBucketPriced
		? Number(buckets.reduce((sum, bucket) => sum + (bucket.costUsd ?? 0), 0).toFixed(6))
		: null;
	const sorted = [...latencies].sort((left, right) => left - right);
	return {
		calls,
		judgeCalls,
		fallbacks,
		fallbackRate: calls === 0 ? 0 : fallbacks / calls,
		inputTokens,
		outputTokens,
		costUsd,
		latencyP50: percentile(sorted, 0.5),
		latencyP95: percentile(sorted, 0.95),
	};
}

/** The same aggregate as keyed rows, for a `--by decision|model|day` view. */
export function groupBy(
	aggregate: LedgerAggregate,
	by: "decision" | "model" | "day",
): { key: string; calls: number; fallbacks: number; costUsd: number | null; latencyP50: number | null }[] {
	const groups = new Map<string, { calls: number; fallbacks: number; costUsd: number | null; latencies: number[] }>();
	for (const bucket of aggregate.buckets) {
		const key = by === "decision" ? bucket.specId : by === "model" ? bucket.model : bucket.day;
		const group = groups.get(key) ?? { calls: 0, fallbacks: 0, costUsd: 0, latencies: [] };
		group.calls += bucket.calls;
		group.fallbacks += bucket.fallbacks;
		group.costUsd = bucket.costUsd === null ? null : (group.costUsd ?? 0) + bucket.costUsd;
		if (bucket.latencyP50 !== null) group.latencies.push(bucket.latencyP50);
		groups.set(key, group);
	}
	return [...groups.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, group]) => ({
			key,
			calls: group.calls,
			fallbacks: group.fallbacks,
			costUsd: group.costUsd === null ? null : Number(group.costUsd.toFixed(6)),
			latencyP50: percentile(
				[...group.latencies].sort((left, right) => left - right),
				0.5,
			),
		}));
}
