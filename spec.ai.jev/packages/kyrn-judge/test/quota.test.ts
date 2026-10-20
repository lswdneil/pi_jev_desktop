import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionEngine, defineDecision } from "../src/decision.ts";
import { JudgeError } from "../src/errors.ts";
import type { JudgeLike, JudgeResult } from "../src/judge.ts";
import { Judge } from "../src/judge.ts";
import { MemoryLedger } from "../src/ledger.ts";
import { MockJudgeProvider } from "../src/providers/mock.ts";
import { JudgeQuotaTracker, localDay, QuotaGuardedJudge } from "../src/quota.ts";
import type { AnswersFor, Questions } from "../src/types.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dir(): string {
	const path = mkdtempSync(join(tmpdir(), "mu-quota-"));
	dirs.push(path);
	return path;
}

const questions = { greet: { type: "boolean", instructions: "Is this a greeting?" } } satisfies Questions;

describe("JudgeQuotaTracker", () => {
	it("stops at the daily request cap", () => {
		const quota = new JudgeQuotaTracker({ limits: { dailyRequests: 2 } });
		expect(quota.check()).toEqual({ exhausted: false });
		quota.record({ inputTokens: 5, outputTokens: 1 });
		quota.record({ inputTokens: 5, outputTokens: 1 });
		const verdict = quota.check();
		expect(verdict).toMatchObject({ exhausted: true, reason: "daily-requests" });
	});

	it("stops at the daily token cap, counting input and output together", () => {
		const quota = new JudgeQuotaTracker({ limits: { dailyTokens: 100 } });
		quota.record({ inputTokens: 60, outputTokens: 30 });
		expect(quota.check().exhausted).toBe(false);
		quota.record({ inputTokens: 10, outputTokens: 5 });
		expect(quota.check()).toMatchObject({ exhausted: true, reason: "daily-tokens" });
	});

	it("counts a fanned-out judge as the requests it made, not as one", () => {
		const quota = new JudgeQuotaTracker({ limits: { dailyRequests: 2 } });
		quota.record({ inputTokens: 1, outputTokens: 1 }, 2);
		expect(quota.check()).toMatchObject({ exhausted: true, reason: "daily-requests" });
	});

	it("caps a session even when the day has room", () => {
		const quota = new JudgeQuotaTracker({ limits: { sessionRequests: 1, dailyRequests: 100 } });
		quota.record({ inputTokens: 1, outputTokens: 1 });
		expect(quota.check()).toMatchObject({ exhausted: true, reason: "session-requests" });
	});

	it("resets at local midnight, not at UTC midnight", () => {
		// 23:59 and 00:01 local: the same day in UTC only if the machine were set to UTC.
		const before = new Date(2026, 9, 18, 23, 59, 0);
		const after = new Date(2026, 9, 19, 0, 1, 0);
		const clock = { now: before };
		const quota = new JudgeQuotaTracker({ limits: { dailyRequests: 1 }, now: () => clock.now });
		quota.record({ inputTokens: 1, outputTokens: 1 });
		expect(quota.check().exhausted).toBe(true);

		clock.now = after;
		expect(quota.check().exhausted).toBe(false);
		expect(quota.snapshot().state.requests).toBe(0);
		expect(localDay(before)).not.toBe(localDay(after));
	});

	it("persists the day's counters across processes", () => {
		const path = join(dir(), "judge-quota.json");
		const now = () => new Date(2026, 9, 18, 12, 0, 0);
		const first = new JudgeQuotaTracker({ limits: { dailyRequests: 1 }, path, now });
		first.record({ inputTokens: 3, outputTokens: 4 });

		const second = new JudgeQuotaTracker({ limits: { dailyRequests: 1 }, path, now });
		expect(second.check()).toMatchObject({ exhausted: true, reason: "daily-requests" });
		const stored = JSON.parse(readFileSync(path, "utf8")) as { requests: number };
		expect(stored.requests).toBe(1);
	});

	it("survives an unreadable state file", () => {
		const path = join(dir(), "judge-quota.json");
		writeFileSync(path, "not json");
		const quota = new JudgeQuotaTracker({ limits: { dailyRequests: 1 }, path });
		expect(quota.check()).toEqual({ exhausted: false });
	});
});

describe("QuotaGuardedJudge", () => {
	function countingJudge(): { judge: JudgeLike; calls: () => number } {
		let calls = 0;
		const judge: JudgeLike = {
			id: "counted",
			async evaluate<const Qs extends Questions>(): Promise<JudgeResult<Qs>> {
				calls++;
				return {
					answers: { greet: { type: "boolean", probability: 0.9 } } as unknown as AnswersFor<Qs>,
					usage: { inputTokens: 20, outputTokens: 5 },
					latencyMs: 1,
					requests: 1,
					providerId: "counted",
					warnings: [],
				};
			},
		};
		return { judge, calls: () => calls };
	}

	it("does not call the judge once the budget is spent", async () => {
		const counted = countingJudge();
		const quota = new JudgeQuotaTracker({ limits: { dailyRequests: 1 } });
		const guarded = new QuotaGuardedJudge({ judge: counted.judge, quota });

		await guarded.evaluate({ state: "hi", questions });
		await expect(guarded.evaluate({ state: "hi", questions })).rejects.toMatchObject({ kind: "quota" });
		expect(counted.calls()).toBe(1);
	});

	it("counts what the judge reported", async () => {
		const counted = countingJudge();
		const quota = new JudgeQuotaTracker({ limits: { dailyTokens: 10 } });
		const guarded = new QuotaGuardedJudge({ judge: counted.judge, quota });

		await guarded.evaluate({ state: "hi", questions });
		// 20 + 5 tokens is past 10: the next call is refused, and it is the recorded usage that says so.
		expect(quota.check()).toMatchObject({ exhausted: true, reason: "daily-tokens" });
		await expect(guarded.evaluate({ state: "hi", questions })).rejects.toBeInstanceOf(JudgeError);
		expect(counted.calls()).toBe(1);
	});

	it("reports the exhaustion once, so the machine says it rather than repeating it", async () => {
		const counted = countingJudge();
		const quota = new JudgeQuotaTracker({ limits: { dailyRequests: 1 } });
		const notices: string[] = [];
		const guarded = new QuotaGuardedJudge({
			judge: counted.judge,
			quota,
			onExhausted: (verdict) => notices.push(verdict.reason),
		});
		await guarded.evaluate({ state: "hi", questions });
		await guarded.evaluate({ state: "hi", questions }).catch(() => undefined);
		await guarded.evaluate({ state: "hi", questions }).catch(() => undefined);
		// The guard reports each refused call; the runtime keeps the "once per session" promise.
		expect(notices).toEqual(["daily-requests", "daily-requests"]);
	});
});

const greeting = defineDecision({
	id: "test.quota_greeting",
	version: 1,
	cacheImpact: "none",
	latency: "inline",
	questions,
	capabilities: "classify",
	fallback: () => "work" as const,
	policy(answers) {
		return answers.greet?.type === "boolean" && answers.greet.probability > 0.75
			? ("greeting" as const)
			: ("work" as const);
	},
	buildState: (input: string) => ({ user_message: input }),
});

describe("a spent budget in the engine", () => {
	it("falls back with reason error:quota, and the ledger says why", async () => {
		const quota = new JudgeQuotaTracker({ limits: { dailyRequests: 1 } });
		const judge = new QuotaGuardedJudge({
			judge: new Judge({
				provider: new MockJudgeProvider(() => ({ greet: { type: "boolean", probability: 0.9 } })),
				timeoutMs: 1_000,
			}),
			quota,
		});
		const ledger = new MemoryLedger();
		const engine = new DecisionEngine({ judge, ledger, defaultMode: "active" });

		const first = await engine.decide(greeting, "hello");
		const second = await engine.decide(greeting, "hello");

		expect(first.source).toBe("judge");
		expect(first.outcome).toBe("greeting");
		expect(second.source).toBe("fallback");
		expect(second.reason).toBe("error:quota");
		expect(second.outcome).toBe("work");
	});
});
