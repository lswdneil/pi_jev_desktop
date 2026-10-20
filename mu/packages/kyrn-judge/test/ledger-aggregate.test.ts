import { describe, expect, it } from "vitest";
import { aggregateLedger, groupBy, localDayOf, type ModelPrice } from "../src/ledger/aggregate.ts";
import type { LedgerRecord } from "../src/ledger.ts";

const PRICES: Record<string, ModelPrice> = {
	"jev/typesafe-ai/jev": { inputPerMillion: 1, outputPerMillion: 2 },
	"opencode/jev-1.13-free": { inputPerMillion: 0, outputPerMillion: 0 },
};

function priceFor(model: { providerId: string; modelId?: string }): ModelPrice | null {
	const key = `${model.providerId}/${model.modelId ?? ""}`;
	return PRICES[key] ?? null;
}

let sequence = 0;

function record(overrides: Partial<LedgerRecord> & { providerId: string; modelId?: string }): LedgerRecord {
	sequence++;
	return {
		id: `record-${sequence}`,
		timestamp: "2026-10-18T10:00:00.000Z",
		specId: "tool.admission",
		specVersion: 1,
		mode: "active",
		outcome: "keep",
		source: "judge",
		stateDigest: "digest",
		...overrides,
	} as LedgerRecord;
}

describe("aggregateLedger", () => {
	it("returns a zero structure for an empty ledger instead of failing", () => {
		const aggregate = aggregateLedger([], { price: priceFor });
		expect(aggregate.buckets).toEqual([]);
		expect(aggregate.totals).toEqual({
			calls: 0,
			judgeCalls: 0,
			fallbacks: 0,
			fallbackRate: 0,
			inputTokens: 0,
			outputTokens: 0,
			costUsd: 0,
			latencyP50: null,
			latencyP95: null,
		});
		expect(aggregate.unpricedModels).toEqual([]);
		expect(aggregate.days).toEqual([]);
	});

	it("counts tokens and money per decision point and model", () => {
		const aggregate = aggregateLedger(
			[
				record({
					providerId: "jev",
					modelId: "typesafe-ai/jev",
					usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
					latencyMs: 300,
				}),
				record({
					providerId: "jev",
					modelId: "typesafe-ai/jev",
					usage: { inputTokens: 1_000_000, outputTokens: 0 },
					latencyMs: 500,
					source: "fallback",
					reason: "error:quota",
				}),
			],
			{ price: priceFor },
		);

		expect(aggregate.buckets).toHaveLength(1);
		const [bucket] = aggregate.buckets;
		expect(bucket?.calls).toBe(2);
		expect(bucket?.judgeCalls).toBe(1);
		expect(bucket?.fallbacks).toBe(1);
		expect(bucket?.fallbackRate).toBe(0.5);
		expect(bucket?.inputTokens).toBe(2_000_000);
		expect(bucket?.outputTokens).toBe(500_000);
		// 1M in + 0.5M out at 1/2 per million, plus 1M in on the fallback record.
		expect(bucket?.costUsd).toBe(3);
		expect(aggregate.totals.costUsd).toBe(3);
		expect(aggregate.totals.latencyP50).toBe(300);
	});

	it("says null for a model the price catalog does not know, rather than guessing", () => {
		const aggregate = aggregateLedger(
			[
				record({ providerId: "unknown-svc", modelId: "mystery-1", usage: { inputTokens: 10, outputTokens: 10 } }),
				record({ providerId: "jev", modelId: "typesafe-ai/jev", usage: { inputTokens: 10, outputTokens: 10 } }),
			],
			{ price: priceFor },
		);

		expect(aggregate.unpricedModels).toEqual(["unknown-svc/mystery-1"]);
		expect(aggregate.totals.costUsd).toBeNull();
		expect(aggregate.buckets.find((bucket) => bucket.model === "unknown-svc/mystery-1")?.costUsd).toBeNull();
		// The priced bucket still carries its own number: 10 in + 10 out at 1/2 per million.
		expect(aggregate.buckets.find((bucket) => bucket.model === "jev/typesafe-ai/jev")?.costUsd).toBe(0.00003);
	});

	it("splits buckets at the local day boundary", () => {
		const late = new Date(2026, 9, 18, 23, 59, 0).toISOString();
		const early = new Date(2026, 9, 19, 0, 1, 0).toISOString();
		const aggregate = aggregateLedger(
			[
				record({ providerId: "jev", modelId: "typesafe-ai/jev", timestamp: late }),
				record({ providerId: "jev", modelId: "typesafe-ai/jev", timestamp: early }),
			],
			{ price: priceFor },
		);

		expect(aggregate.days).toEqual([localDayOf(late), localDayOf(early)]);
		expect(aggregate.buckets.map((bucket) => bucket.day)).toEqual([localDayOf(late), localDayOf(early)]);
		expect(aggregate.totals.calls).toBe(2);
	});

	it("counts a batch as the calls it covered", () => {
		const aggregate = aggregateLedger(
			[record({ providerId: "jev", modelId: "typesafe-ai/jev", batch: { size: 30, failures: 0 } })],
			{ price: priceFor },
		);
		expect(aggregate.totals.calls).toBe(30);
	});

	it("groups the same numbers by decision, model or day", () => {
		const aggregate = aggregateLedger(
			[
				record({
					providerId: "jev",
					modelId: "typesafe-ai/jev",
					usage: { inputTokens: 1_000_000, outputTokens: 0 },
				}),
				record({ providerId: "jev", modelId: "typesafe-ai/jev", specId: "preflight", source: "fallback" }),
			],
			{ price: priceFor },
		);

		const byDecision = groupBy(aggregate, "decision");
		expect(byDecision.map((row) => row.key)).toEqual(["preflight", "tool.admission"]);
		expect(byDecision.find((row) => row.key === "tool.admission")?.costUsd).toBe(1);
		expect(groupBy(aggregate, "model")[0]?.key).toBe("jev/typesafe-ai/jev");
		expect(groupBy(aggregate, "day")).toHaveLength(1);
	});
});
