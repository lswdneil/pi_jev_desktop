import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JudgeError } from "./errors.ts";
import type { JudgeCall, JudgeLike, JudgeResult } from "./judge.ts";
import type { JudgeUsage, Questions } from "./types.ts";

/**
 * How much of someone else's shared budget this machine may spend.
 *
 * The keyless judge is free for now, which is not the same as unlimited or permanent. A cap that the
 * person sets (requests and tokens per day, requests per session) turns a surprise — a blocked key, a
 * bill, a service that stops answering — into a known limit that degrades to the fallback on purpose.
 *
 * The numbers counted here are the same `usage` the ledger records, not a second accounting: the guard
 * wraps the judge, reads what the response reported, and writes it down.
 */

export interface JudgeQuotaLimits {
	/** Requests per local day. */
	dailyRequests?: number;
	/** Tokens (input + output) per local day. */
	dailyTokens?: number;
	/** Requests in this process (one session). */
	sessionRequests?: number;
}

export interface JudgeQuotaState {
	/** Local date the daily counters belong to. */
	day: string;
	requests: number;
	inputTokens: number;
	outputTokens: number;
}

export interface JudgeQuotaConfig {
	readonly limits: JudgeQuotaLimits;
	/** Where the daily counters persist; in-memory when undefined. */
	readonly path?: string;
	/** Clock, so a test can cross midnight. */
	readonly now?: () => Date;
}

export type QuotaVerdict =
	| { exhausted: false }
	| { exhausted: true; reason: "daily-requests" | "daily-tokens" | "session-requests"; message: string };

const DEFAULT_STATE: JudgeQuotaState = { day: "", requests: 0, inputTokens: 0, outputTokens: 0 };

/** `YYYY-MM-DD` in local time: a person's day, not UTC's, so the reset happens at their midnight. */
export function localDay(now: Date): string {
	const year = now.getFullYear();
	const month = `${now.getMonth() + 1}`.padStart(2, "0");
	const day = `${now.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function quotaFile(agentDir: string): string {
	return join(agentDir, "judge-quota.json");
}

function readState(path: string): JudgeQuotaState {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof value !== "object" || value === null) return { ...DEFAULT_STATE };
		const state = value as Partial<JudgeQuotaState>;
		return {
			day: typeof state.day === "string" ? state.day : "",
			requests: typeof state.requests === "number" ? state.requests : 0,
			inputTokens: typeof state.inputTokens === "number" ? state.inputTokens : 0,
			outputTokens: typeof state.outputTokens === "number" ? state.outputTokens : 0,
		};
	} catch {
		return { ...DEFAULT_STATE };
	}
}

/** The counters for `now`'s day, reset when the day changed. */
export function rollToDay(state: JudgeQuotaState, day: string): JudgeQuotaState {
	if (state.day === day) return state;
	return { day, requests: 0, inputTokens: 0, outputTokens: 0 };
}

export class JudgeQuotaTracker {
	private readonly limits: JudgeQuotaLimits;
	private readonly path: string | undefined;
	private readonly now: () => Date;
	private state: JudgeQuotaState;
	private sessionRequests = 0;

	constructor(config: JudgeQuotaConfig) {
		this.limits = config.limits;
		this.path = config.path;
		this.now = config.now ?? (() => new Date());
		this.state = this.path ? readState(this.path) : { ...DEFAULT_STATE };
	}

	/** Whether another call may be made right now. */
	check(): QuotaVerdict {
		const day = localDay(this.now());
		this.state = rollToDay(this.state, day);
		const { dailyRequests, dailyTokens, sessionRequests } = this.limits;
		if (dailyRequests !== undefined && this.state.requests >= dailyRequests) {
			return {
				exhausted: true,
				reason: "daily-requests",
				message: `daily judge budget spent: ${this.state.requests} of ${dailyRequests} requests on ${day}`,
			};
		}
		const tokens = this.state.inputTokens + this.state.outputTokens;
		if (dailyTokens !== undefined && tokens >= dailyTokens) {
			return {
				exhausted: true,
				reason: "daily-tokens",
				message: `daily judge budget spent: ${tokens} of ${dailyTokens} tokens on ${day}`,
			};
		}
		if (sessionRequests !== undefined && this.sessionRequests >= sessionRequests) {
			return {
				exhausted: true,
				reason: "session-requests",
				message: `session judge budget spent: ${this.sessionRequests} of ${sessionRequests} requests`,
			};
		}
		return { exhausted: false };
	}

	/** Count one answered call. `requests` may be more than one when the judge fanned a batch out. */
	record(usage: JudgeUsage | undefined, requests = 1): void {
		const day = localDay(this.now());
		this.state = rollToDay(this.state, day);
		this.state.requests += Math.max(1, requests);
		this.sessionRequests += Math.max(1, requests);
		this.state.inputTokens += usage?.inputTokens ?? 0;
		this.state.outputTokens += usage?.outputTokens ?? 0;
		this.persist();
	}

	/** The counters as `mu judge consent status` and a span report them. */
	snapshot(): { state: JudgeQuotaState; sessionRequests: number; limits: JudgeQuotaLimits } {
		const day = localDay(this.now());
		this.state = rollToDay(this.state, day);
		return { state: { ...this.state }, sessionRequests: this.sessionRequests, limits: this.limits };
	}

	private persist(): void {
		if (!this.path) return;
		try {
			mkdirSync(join(this.path, ".."), { recursive: true });
			writeFileSync(this.path, `${JSON.stringify(this.state, null, 2)}\n`);
		} catch {
			// A counter that cannot be written must not end the session it counts.
		}
	}
}

/**
 * A judge with a budget: same answers, one check in front and one count behind.
 *
 * Exhaustion throws `JudgeError("quota")`, which the engine treats like any other judge failure: the
 * decision falls back, the ledger records `error:quota`, and the user sees the fallback rather than an
 * error dialog. A budget is a policy, not a crash.
 */
export class QuotaGuardedJudge implements JudgeLike {
	readonly id: string;
	readonly timeoutMs: number | undefined;
	private readonly inner: JudgeLike;
	private readonly quota: JudgeQuotaTracker;
	private readonly onExhausted: ((verdict: Extract<QuotaVerdict, { exhausted: true }>) => void) | undefined;

	constructor(options: {
		judge: JudgeLike;
		quota: JudgeQuotaTracker;
		onExhausted?: (verdict: Extract<QuotaVerdict, { exhausted: true }>) => void;
	}) {
		this.inner = options.judge;
		this.quota = options.quota;
		this.onExhausted = options.onExhausted;
		this.id = options.judge.id;
		this.timeoutMs = options.judge.timeoutMs;
	}

	async evaluate<const Qs extends Questions>(request: JudgeCall<Qs>): Promise<JudgeResult<Qs>> {
		const verdict = this.quota.check();
		if (verdict.exhausted) {
			this.onExhausted?.(verdict);
			throw new JudgeError("quota", verdict.message);
		}
		const result = await this.inner.evaluate<Qs>(request);
		this.quota.record(result.usage, result.requests);
		return result;
	}
}
