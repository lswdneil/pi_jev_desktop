import { describe, expect, it } from "vitest";
import { CascadeJudge } from "../src/cascade.ts";
import { parseConfig } from "../src/config.ts";
import { admissionWaitMs } from "../src/extension/features/admission.ts";
import { Judge, type JudgeLike, type JudgeResult, judgeWaitMs } from "../src/judge.ts";
import { defaultJudgeTimeoutMs } from "../src/registry.ts";
import type { AnswersFor, JudgeProvider, ProviderResponse, Questions } from "../src/types.ts";

/**
 * A third-party judge that declares no budget: `JudgeLike.timeoutMs` is optional, so a
 * caller with its own wait must not be sized as if this judge could take forever.
 */
class NoBudgetJudge implements JudgeLike {
	readonly id = "custom";

	async evaluate<const Qs extends Questions>(): Promise<JudgeResult<Qs>> {
		return {
			// A fake that answers nothing: only the declared budget matters to this test.
			answers: {} as unknown as AnswersFor<Qs>,
			usage: { inputTokens: 0, outputTokens: 0 },
			latencyMs: 0,
			requests: 0,
			providerId: this.id,
			warnings: [],
		};
	}
}

/** A provider that never answers: this test is about budgets, not verdicts. */
function silentProvider(id: string): JudgeProvider {
	return {
		id,
		evaluate: async (): Promise<ProviderResponse> => ({ answers: {} }),
	};
}

function tier(id: string, timeoutMs: number): CascadeJudge {
	return new CascadeJudge([{ judge: new Judge({ provider: silentProvider(id), timeoutMs }) }]);
}

describe("judgeWaitMs", () => {
	it("gives a single tier its own budget plus the margin", () => {
		// registry.ts sizes a hosted judge at 10 s; a caller that waits 4 s can never use its verdict.
		expect(judgeWaitMs(tier("jev", 10_000))).toBe(10_250);
	});

	it("sums every tier, because a cascade runs them one after another", () => {
		const cascade = new CascadeJudge([
			{ judge: new Judge({ provider: silentProvider("laya"), timeoutMs: 8_000 }) },
			{ judge: new Judge({ provider: silentProvider("jev"), timeoutMs: 10_000 }) },
		]);
		expect(cascade.timeoutMs).toBe(18_000);
		expect(judgeWaitMs(cascade)).toBe(18_250);
	});

	it("waits nothing extra for a judge that declares no budget", () => {
		const undeclared: JudgeLike = new NoBudgetJudge();
		expect(undeclared.timeoutMs).toBeUndefined();
		expect(judgeWaitMs(undeclared)).toBe(0);
	});
});

describe("defaultJudgeTimeoutMs", () => {
	it("keeps the budget every judge type had before there was one preset table", () => {
		expect(defaultJudgeTimeoutMs("jev")).toBe(10_000);
		expect(defaultJudgeTimeoutMs("typesafe")).toBe(10_000);
		expect(defaultJudgeTimeoutMs("classifier")).toBe(10_000);
		expect(defaultJudgeTimeoutMs("llm")).toBe(30_000);
		expect(defaultJudgeTimeoutMs("mock")).toBe(1_000);
	});

	it("keeps the fast tiers tight so the next tier still has time", () => {
		expect(defaultJudgeTimeoutMs("local")).toBe(4_000);
		expect(defaultJudgeTimeoutMs("gateway")).toBe(4_000);
		expect(defaultJudgeTimeoutMs("clm")).toBe(8_000);
		expect(defaultJudgeTimeoutMs("http")).toBe(8_000);
	});

	it("lets a judge override the budget in its own config", () => {
		const judge = new Judge({ provider: silentProvider("jev"), timeoutMs: 15_000 });
		expect(judge.timeoutMs).toBe(15_000);
	});
});

describe("a Judge built without an explicit timeout", () => {
	it("uses the judge preset rather than the old 4 s constant", () => {
		expect(new Judge({ provider: silentProvider("direct") }).timeoutMs).toBe(10_000);
	});
});

describe("admissionWaitMs", () => {
	it("derives the wait from the cascade when the user set none", () => {
		// No `waitMs` in the config: the option default (4 s) cannot cover a two-tier cascade, the sum can.
		const cascade = new CascadeJudge([
			{ judge: new Judge({ provider: silentProvider("laya"), timeoutMs: 8_000 }) },
			{ judge: new Judge({ provider: silentProvider("jev"), timeoutMs: 10_000 }) },
		]);
		expect(admissionWaitMs(parseConfig({}), cascade, 4_000)).toBe(18_250);
		expect(admissionWaitMs(parseConfig({}), tier("jev", 10_000), 4_000)).toBe(10_250);
	});

	it("keeps an explicit waitMs, because the user is trading latency for a verdict", () => {
		const config = parseConfig({ features: { admission: { waitMs: 60 } } });
		expect(admissionWaitMs(config, tier("jev", 10_000), 4_000)).toBe(60);
	});

	it("falls back to the option default when the judge declares no budget", () => {
		expect(admissionWaitMs(parseConfig({}), new NoBudgetJudge(), 4_000)).toBe(4_000);
	});
});
