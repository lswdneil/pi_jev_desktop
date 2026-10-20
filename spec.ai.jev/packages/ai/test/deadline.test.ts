import { describe, expect, it } from "vitest";
import {
	composeDeadline,
	DEADLINE_MARGIN_MS,
	DEADLINE_PRESETS,
	DeadlineError,
	deadlinePolicy,
	deadlineStageOf,
	transportStageOf,
	withDeadline,
} from "../src/utils/deadline.ts";

/** A clock the test advances by hand, so deadline tests never wait. */
function manualTimers() {
	let now = 0;
	let nextId = 1;
	const pending = new Map<number, { at: number; callback: () => void }>();
	return {
		timers: {
			set(callback: () => void, ms: number) {
				const id = nextId++;
				pending.set(id, { at: now + ms, callback });
				return id;
			},
			clear(handle: unknown) {
				pending.delete(handle as number);
			},
		},
		advance(ms: number) {
			now += ms;
			for (;;) {
				const due = [...pending.entries()]
					.filter(([, timer]) => timer.at <= now)
					.sort((left, right) => left[1].at - right[1].at)[0];
				if (!due) return;
				pending.delete(due[0]);
				due[1].callback();
			}
		},
		pendingCount() {
			return pending.size;
		},
	};
}

describe("composeDeadline", () => {
	it("reports a first-byte timeout as stage first-byte", () => {
		const clock = manualTimers();
		const deadline = composeDeadline({ firstByteMs: 1_000 }, { preset: "judge", timers: clock.timers });

		clock.advance(999);
		expect(deadline.signal.aborted).toBe(false);

		clock.advance(1);
		expect(deadline.signal.aborted).toBe(true);
		expect(deadline.stage).toBe("first-byte");
		const reason = deadline.signal.reason;
		expect(reason).toBeInstanceOf(DeadlineError);
		expect(reason).toMatchObject({ kind: "timeout", stage: "first-byte", timeoutMs: 1_000 });
		expect(deadlineStageOf(reason)).toBe("first-byte");
		deadline.dispose();
	});

	it("restarts the idle budget for every chunk and only fires when the stream really goes quiet", () => {
		const clock = manualTimers();
		const deadline = composeDeadline({ idleMs: 1_000 }, { timers: clock.timers });

		deadline.progress();
		clock.advance(900);
		expect(deadline.signal.aborted).toBe(false);

		deadline.progress();
		clock.advance(900);
		expect(deadline.signal.aborted).toBe(false);

		clock.advance(100);
		expect(deadline.signal.aborted).toBe(true);
		expect(deadline.stage).toBe("idle");
		deadline.dispose();
	});

	it("lets the total budget win over a longer idle budget", () => {
		const clock = manualTimers();
		const deadline = composeDeadline({ idleMs: 5_000, totalMs: 3_000 }, { timers: clock.timers });

		deadline.progress();
		clock.advance(2_999);
		expect(deadline.signal.aborted).toBe(false);

		clock.advance(1);
		expect(deadline.signal.aborted).toBe(true);
		expect(deadline.stage).toBe("total");
		expect(deadline.timeoutMs).toBe(3_000);
		deadline.dispose();
	});

	it("turns a caller abort into stage aborted and leaves no timer behind", () => {
		const clock = manualTimers();
		const controller = new AbortController();
		const deadline = composeDeadline(
			{ idleMs: 1_000, totalMs: 10_000 },
			{ signal: controller.signal, timers: clock.timers },
		);

		deadline.progress();
		expect(clock.pendingCount()).toBe(2);

		controller.abort();
		expect(deadline.signal.aborted).toBe(true);
		expect(deadline.stage).toBe("aborted");
		expect(deadline.signal.reason).toMatchObject({ kind: "aborted", stage: "aborted", timeoutMs: 0 });
		expect(clock.pendingCount()).toBe(0);
		deadline.dispose();
	});

	it("does not fire a stage whose budget is zero", () => {
		const clock = manualTimers();
		const deadline = composeDeadline(DEADLINE_PRESETS["bash-command"], { timers: clock.timers });

		clock.advance(60 * 60 * 1000);
		expect(deadline.signal.aborted).toBe(false);
		expect(clock.pendingCount()).toBe(0);
		deadline.dispose();
	});
});

describe("withDeadline", () => {
	it("passes chunks through, then fails the stream at the stage that expired", async () => {
		const clock = manualTimers();
		const deadline = composeDeadline({ idleMs: 1_000, totalMs: 5_000 }, { timers: clock.timers });
		async function* source() {
			yield "one";
			await new Promise((resolve) => setImmediate(resolve));
			yield "two";
			clock.advance(6_000);
			await new Promise((resolve) => setImmediate(resolve));
			yield "never";
		}

		const seen: string[] = [];
		await expect(async () => {
			for await (const chunk of withDeadline(source(), deadline)) seen.push(chunk);
		}).rejects.toBeInstanceOf(DeadlineError);
		expect(seen).toEqual(["one", "two"]);
		deadline.dispose();
	});

	it("stops a stream when the caller aborts, without an unhandled rejection", async () => {
		const clock = manualTimers();
		const controller = new AbortController();
		const deadline = composeDeadline({ idleMs: 5_000 }, { signal: controller.signal, timers: clock.timers });
		async function* source() {
			yield "first";
			await new Promise((resolve) => setTimeout(resolve, 50));
			yield "second";
		}

		const seen: string[] = [];
		const failure = (async () => {
			for await (const chunk of withDeadline(source(), deadline)) {
				seen.push(chunk);
				controller.abort();
			}
		})();

		await expect(failure).rejects.toMatchObject({ kind: "aborted", stage: "aborted" });
		expect(seen).toEqual(["first"]);
		deadline.dispose();
	});
});

describe("transportStageOf", () => {
	it("reads the stage out of the errors undici throws when its own timeouts fire", () => {
		// The transport enforces first-byte and idle itself, so these errors never pass through composeDeadline.
		expect(transportStageOf(Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" }))).toBe(
			"first-byte",
		);
		expect(transportStageOf(Object.assign(new Error("body timeout"), { code: "UND_ERR_BODY_TIMEOUT" }))).toBe("idle");
		expect(transportStageOf(Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }))).toBe(
			"connect",
		);
	});

	it("calls a cancellation aborted and leaves an unrelated failure unattributed", () => {
		const cancelled = new Error("The operation was aborted");
		cancelled.name = "AbortError";
		expect(transportStageOf(cancelled)).toBe("aborted");
		expect(transportStageOf(new Error("socket hang up"))).toBeUndefined();
		expect(transportStageOf(undefined)).toBeUndefined();
	});
});

describe("deadlinePolicy", () => {
	it("uses the preset table and lets an integer env override replace one stage", () => {
		expect(deadlinePolicy("judge", {})).toEqual(DEADLINE_PRESETS.judge);
		expect(deadlinePolicy("judge", { SPEC_AI_JEV_DEADLINE_JUDGE_TOTAL: "15000" })).toEqual({
			...DEADLINE_PRESETS.judge,
			totalMs: 15_000,
		});
		expect(deadlinePolicy("judge", { SPEC_AI_JEV_DEADLINE_JUDGE_TOTAL: "0" })).toEqual({
			...DEADLINE_PRESETS.judge,
			totalMs: 0,
		});
		expect(deadlinePolicy("bash-command", { SPEC_AI_JEV_DEADLINE_BASH_COMMAND_TOTAL: "5000" })).toEqual({ totalMs: 5_000 });
	});

	it("ignores an override that is not a whole number of milliseconds", () => {
		expect(deadlinePolicy("judge", { SPEC_AI_JEV_DEADLINE_JUDGE_TOTAL: "15s" })).toEqual(DEADLINE_PRESETS.judge);
		expect(deadlinePolicy("judge", { SPEC_AI_JEV_DEADLINE_JUDGE_TOTAL: "-1" })).toEqual(DEADLINE_PRESETS.judge);
	});
});

describe("judge budget relation used by admission", () => {
	it("keeps the margin the admission wait adds to a cascade's worst case", () => {
		expect(DEADLINE_MARGIN_MS).toBe(250);
	});
});
