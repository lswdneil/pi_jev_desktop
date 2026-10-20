import { raceWithAbortSignal } from "./abort.ts";

/**
 * Which part of a request ran out of budget. A crashed or hung request is only
 * diagnosable when the log says where it stopped: a connect that never finished
 * and a stream that went quiet for a minute are different bugs.
 */
export type DeadlineStage = "connect" | "first-byte" | "idle" | "total" | "aborted";

export type DeadlinePreset =
	| "provider-stream"
	| "judge"
	| "judge-generative"
	| "mcp-call"
	| "lsp-request"
	| "browser-step"
	| "bash-command"
	| "mock";

/** A budget per stage. `0` (or a missing field) means "no limit for this stage". */
export interface DeadlinePolicy {
	connectMs?: number;
	firstByteMs?: number;
	idleMs?: number;
	totalMs?: number;
}

/** Thrown (as the abort reason) when a deadline fires, so callers can tell stages apart. */
export class DeadlineError extends Error {
	readonly kind: "timeout" | "aborted";
	readonly stage: DeadlineStage;
	/** The budget of the stage that fired; `0` when the caller aborted. */
	readonly timeoutMs: number;

	constructor(kind: "timeout" | "aborted", stage: DeadlineStage, timeoutMs: number, message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "DeadlineError";
		this.kind = kind;
		this.stage = stage;
		this.timeoutMs = timeoutMs;
	}
}

/** Margin added to a cascade's worst case before a caller stops waiting for it. */
export const DEADLINE_MARGIN_MS = 250;

/**
 * Initial budgets. Values are the ones the code used before there was one
 * place to read them (`registry.ts` per judge type, `http-dispatcher.ts`),
 * so unifying them changes no behavior. Tuning happens here, not at the
 * call sites.
 */
export const DEADLINE_PRESETS = {
	/** A model stream: generous first byte, idle per chunk, no total (long answers are normal). */
	"provider-stream": { connectMs: 10_000, firstByteMs: 30_000, idleMs: 60_000, totalMs: 0 },
	/** A hosted judge on a Jev-like route: answers in well under a second, but a cold connection takes a few. */
	judge: { connectMs: 2_000, firstByteMs: 4_000, totalMs: 10_000 },
	/** A generative judge (llm type): it reasons, so it gets more room. */
	"judge-generative": { connectMs: 2_000, firstByteMs: 4_000, totalMs: 30_000 },
	"mcp-call": { connectMs: 5_000, firstByteMs: 10_000, totalMs: 60_000 },
	"lsp-request": { connectMs: 2_000, firstByteMs: 5_000, totalMs: 30_000 },
	"browser-step": { connectMs: 2_000, firstByteMs: 10_000, totalMs: 60_000 },
	/** No limit by default: a build may legitimately run for an hour. Configure `bashTimeoutMs` to cap it. */
	"bash-command": { totalMs: 0 },
	mock: { connectMs: 500, firstByteMs: 1_000, totalMs: 1_000 },
} as const satisfies Readonly<Record<DeadlinePreset, DeadlinePolicy>>;

const STAGE_ENV_NAMES = [
	["connectMs", "CONNECT"],
	["firstByteMs", "FIRST_BYTE"],
	["idleMs", "IDLE"],
	["totalMs", "TOTAL"],
] as const satisfies Readonly<readonly [keyof DeadlinePolicy, string][]>;

const warnedOverrides = new Set<string>();

/**
 * The policy for a preset, with `MU_DEADLINE_<PRESET>_<STAGE>` overrides applied
 * (e.g. `MU_DEADLINE_JUDGE_TOTAL=15000`). The override exists for tests and
 * diagnosis; the user-facing knob stays the setting in `settings.json`.
 */
export function deadlinePolicy(
	preset: DeadlinePreset,
	env: Readonly<Record<string, string | undefined>> = process.env,
): DeadlinePolicy {
	const policy: DeadlinePolicy = { ...DEADLINE_PRESETS[preset] };
	const prefix = `MU_DEADLINE_${preset.toUpperCase().replaceAll("-", "_")}`;
	for (const [field, stageName] of STAGE_ENV_NAMES) {
		const name = `${prefix}_${stageName}`;
		const raw = env[name];
		if (raw === undefined) continue;
		const trimmed = raw.trim();
		if (!/^\d+$/.test(trimmed)) {
			if (!warnedOverrides.has(name)) {
				warnedOverrides.add(name);
				console.warn(`${name}="${raw}" is not a whole number of milliseconds; ignored`);
			}
			continue;
		}
		policy[field] = Number(trimmed);
	}
	return policy;
}

export interface DeadlineTimers {
	set(callback: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

const systemTimers: DeadlineTimers = {
	set: (callback, ms) => setTimeout(callback, ms),
	clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * A running deadline. `signal` aborts with a `DeadlineError` when a stage runs
 * out; `progress()` reports that data arrived, which restarts the idle budget.
 *
 * Connect time is not observable from here: the transport reports it, so
 * `connectMs` is carried for the dispatcher mapping rather than armed as a
 * timer (see `http-dispatcher.ts`).
 */
export interface Deadline {
	readonly signal: AbortSignal;
	/** The stage that fired, once it has. */
	readonly stage: DeadlineStage | undefined;
	readonly timeoutMs: number | undefined;
	/** A chunk (or the response headers) arrived: restarts the idle budget. */
	progress(): void;
	dispose(): void;
}

export interface DeadlineOptions {
	signal?: AbortSignal;
	/** Names the policy in the error message, e.g. "judge". */
	preset?: DeadlinePreset;
	/** Injectable timers, so tests drive time instead of waiting for it. */
	timers?: DeadlineTimers;
}

/** Starts the clocks for one request. Call `dispose()` when it settles. */
export function composeDeadline(policy: DeadlinePolicy, options: DeadlineOptions = {}): Deadline {
	const timers = options.timers ?? systemTimers;
	const caller = options.signal;
	const controller = new AbortController();
	const label = options.preset ? `${options.preset} ` : "";
	let stage: DeadlineStage | undefined;
	let timeoutMs: number | undefined;
	let totalHandle: unknown;
	let firstByteHandle: unknown;
	let idleHandle: unknown;
	let callerListener: (() => void) | undefined;

	const clear = (handle: unknown): undefined => {
		if (handle !== undefined) timers.clear(handle);
		return undefined;
	};

	const stopClocks = () => {
		totalHandle = clear(totalHandle);
		firstByteHandle = clear(firstByteHandle);
		idleHandle = clear(idleHandle);
	};

	const fire = (firedStage: DeadlineStage, budget: number) => {
		if (controller.signal.aborted) return;
		stage = firedStage;
		timeoutMs = budget;
		stopClocks();
		controller.abort(
			new DeadlineError("timeout", firedStage, budget, `${label}${firedStage} deadline (${budget} ms) expired`),
		);
	};

	const totalMs = policy.totalMs ?? 0;
	const firstByteMs = policy.firstByteMs ?? 0;
	const idleMs = policy.idleMs ?? 0;

	if (totalMs > 0) totalHandle = timers.set(() => fire("total", totalMs), totalMs);
	if (firstByteMs > 0) firstByteHandle = timers.set(() => fire("first-byte", firstByteMs), firstByteMs);

	const armIdle = () => {
		if (idleMs <= 0) return;
		idleHandle = clear(idleHandle);
		idleHandle = timers.set(() => fire("idle", idleMs), idleMs);
	};

	if (caller) {
		callerListener = () => {
			if (controller.signal.aborted) return;
			stage = "aborted";
			timeoutMs = 0;
			stopClocks();
			controller.abort(new DeadlineError("aborted", "aborted", 0, `${label}was aborted`, caller.reason));
		};
		if (caller.aborted) callerListener();
		else caller.addEventListener("abort", callerListener, { once: true });
	}

	return {
		signal: controller.signal,
		get stage() {
			return stage;
		},
		get timeoutMs() {
			return timeoutMs;
		},
		progress() {
			if (controller.signal.aborted) return;
			firstByteHandle = clear(firstByteHandle);
			armIdle();
		},
		dispose() {
			stopClocks();
			if (caller && callerListener) caller.removeEventListener("abort", callerListener);
		},
	};
}

/**
 * Passes a stream through, restarting the idle budget per chunk and throwing the
 * deadline's `DeadlineError` when a stage expires. Without this, a deadline on a
 * whole stream cannot tell a slow chunk from a dead connection.
 */
export async function* withDeadline<T>(source: AsyncIterable<T>, deadline: Deadline): AsyncGenerator<T> {
	const iterator = source[Symbol.asyncIterator]();
	try {
		for (;;) {
			const next = await raceWithAbortSignal(iterator.next(), deadline.signal);
			if (next.done) return;
			deadline.progress();
			yield next.value;
		}
	} finally {
		try {
			await iterator.return?.();
		} catch {
			// The source is already failing; its error is not the caller's problem.
		}
	}
}

/** The stage of a failure caused by a deadline, for logs and spans. */
export function deadlineStageOf(error: unknown): DeadlineStage | undefined {
	return error instanceof DeadlineError ? error.stage : undefined;
}

const TRANSPORT_STAGE_BY_CODE: ReadonlyMap<string, DeadlineStage> = new Map([
	["UND_ERR_CONNECT_TIMEOUT", "connect"],
	["UND_ERR_HEADERS_TIMEOUT", "first-byte"],
	["UND_ERR_BODY_TIMEOUT", "idle"],
]);

/**
 * The stage a transport failure belongs to. undici enforces `headersTimeout` and
 * `bodyTimeout` itself and throws its own error, so a request that dies at the socket
 * never produces a `DeadlineError`. Mapping what it does throw onto the same vocabulary
 * is what makes "hanging first byte" and "silent stream" distinguishable in one log.
 */
export function transportStageOf(error: unknown): DeadlineStage | undefined {
	if (error instanceof DeadlineError) return error.stage;
	const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
	if (typeof code === "string") {
		const mapped = TRANSPORT_STAGE_BY_CODE.get(code);
		if (mapped) return mapped;
	}
	if (error instanceof Error && error.name === "AbortError") return "aborted";
	return undefined;
}
