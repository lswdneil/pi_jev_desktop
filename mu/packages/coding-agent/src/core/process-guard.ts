import { DeadlineError } from "@earendil-works/pi-ai/utils/deadline";
import { type CrashCategory, type CrashKind, type CrashRecord, recordCrash } from "./crash-log.ts";
import type { AppMode } from "./project-trust.ts";
import { environmentSecrets, redactFailure } from "./redact.ts";

/**
 * Process-level safety net.
 *
 * Before this, coding-agent had exactly one crash hook and it lived in the interactive TUI: a promise that
 * failed with nothing to handle it ended print, json and rpc modes silently — the session file kept the
 * conversation, but nothing said why the process was gone. A run that dies must leave a reason behind, in
 * a form the person can act on, and the reason must not be a credential.
 *
 * The guard distinguishes two failures that used to be one:
 *
 * - `unhandledRejection`: one operation was lost; the process is still sound and keeps going. Ending the
 *   process for it would end a conversation over a failure that may not matter.
 * - `uncaughtException`: the stack is unwound with no invariant known to hold, so the process still ends,
 *   after the terminal is restored and the record is written. Node's own default is the same exit, minus
 *   everything else.
 *
 * Exit codes follow the plan: 0 fine, 1 retryable (timeout, cancellation, bad input or data), 2 fatal
 * (a bug). The interactive TUI keeps its own handler and its own codes; see `installProcessGuard`.
 */

/** Why the process died, in the vocabulary the record and the RPC frame use. */
export type ProcessFailureKind = CrashKind;

export interface ProcessFailure {
	kind: ProcessFailureKind;
	category: CrashCategory;
	/** The original thrown value, for callers that can use it; never written to disk unredacted. */
	error: unknown;
	/** One redacted line, safe for stderr, an RPC frame or a log. */
	line: string;
}

/** The bits of `process` this module touches, so a test can stand in for it. */
export interface ProcessGuardTarget {
	on(event: string, listener: (...args: unknown[]) => void): unknown;
	off(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** A standard stream, as far as closing it matters here. */
export interface GuardStream {
	on(event: "error", listener: (error: unknown) => void): unknown;
	off(event: "error", listener: (error: unknown) => void): unknown;
}

export interface ProcessGuardOptions {
	mode: AppMode;
	cwd: string;
	sessionFile?: string | null;
	/** Restore the terminal (cursor, raw mode, alt screen). Called at most once, before the record is written. */
	restoreTerminal?: () => void;
	/** Survived-failure sink: RPC turns it into an error frame, tests collect it. Must not throw. */
	onFailure?: (failure: ProcessFailure) => void;
	/** One line per failure. Defaults to stderr; never throws. */
	log?: (line: string) => void;
	/** Injected by tests; defaults to `process.exit`. */
	exit?: (code: number) => void;
	/** Injected by tests; defaults to `process`. */
	target?: ProcessGuardTarget;
	/** Injected by tests; defaults to the real `process.stdout`/`process.stderr`. */
	streams?: { stdout: GuardStream; stderr: GuardStream };
	crashLogPath?: string;
	/** Session position at the time of the failure, when the caller can say. */
	position?: () => { turn?: number; tool?: string };
}

export interface ProcessGuard {
	uninstall(): void;
	/** One error frame per survived failure, for callers that talk to a client. */
	onFailure(listener: (failure: ProcessFailure) => void): () => void;
}

/** Retryable: the same call may work later, or after the input is fixed. */
export const EXIT_RETRYABLE = 1;
/** Fatal: something in mu is wrong. */
export const EXIT_FATAL = 2;

const USER_DATA_CODES = new Set([
	"EACCES",
	"EEXIST",
	"EISDIR",
	"EMFILE",
	"ENOENT",
	"ENOSPC",
	"ENOTDIR",
	"EPERM",
	"EROFS",
]);

/**
 * What the failure was about. The category is what makes a record actionable: a timeout is a network or
 * budget question, bad data is a user question, and anything else is a bug to file.
 */
export function classifyFailure(error: unknown): CrashCategory {
	if (error instanceof DeadlineError) return error.kind === "timeout" ? "timeout" : "aborted";
	if (error instanceof Error) {
		if (error.name === "AbortError") return "aborted";
		if (error.name === "SyntaxError") return "user-data";
	}
	const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
	if (typeof code === "string") {
		if (code.startsWith("UND_ERR_") && code.includes("TIMEOUT")) return "timeout";
		if (USER_DATA_CODES.has(code)) return "user-data";
	}
	const message = error instanceof Error ? error.message : String(error);
	if (/\btimed? ?out\b/iu.test(message)) return "timeout";
	if (/\babort(?:ed)?\b/iu.test(message)) return "aborted";
	return "internal";
}

/** Retryable failures end with 1; a bug ends with 2. */
export function exitCodeFor(category: CrashCategory): number {
	return category === "internal" ? EXIT_FATAL : EXIT_RETRYABLE;
}

function lineFor(prefix: string, error: unknown): string {
	const failure = redactFailure(error, environmentSecrets());
	const firstLine = failure.message.split("\n")[0];
	return `${prefix}: ${firstLine}`;
}

/**
 * Install the handlers. Returns a handle; `uninstall()` removes every listener it added.
 *
 * Ordering with the interactive TUI: `InteractiveMode` registers its own `uncaughtException` with
 * `prependListener`, and calls `process.exit` from it, so an exception in that mode is handled there first
 * and this guard's exception handler never runs. That is deliberate — the TUI knows how to put the terminal
 * back — and the guard's `restoreTerminal` is idempotent so a future ordering change cannot double-restore.
 * Rejections are the guard's either way: nothing else handles them.
 */
export function installProcessGuard(options: ProcessGuardOptions): ProcessGuard {
	const target = options.target ?? (process as unknown as ProcessGuardTarget);
	const log = options.log ?? ((line: string) => writeStderr(line));
	const exit = options.exit ?? ((code: number) => process.exit(code));
	const listeners = new Set<(failure: ProcessFailure) => void>();
	let restored = false;
	let exiting = false;
	let disposed = false;

	const restoreOnce = () => {
		if (restored) return;
		restored = true;
		try {
			options.restoreTerminal?.();
		} catch {
			// The terminal is the thing that may already be broken; nothing here may throw.
		}
	};

	const notify = (failure: ProcessFailure) => {
		if (options.onFailure) {
			try {
				options.onFailure(failure);
			} catch {
				// A sink that throws is the sink's problem, not the crash path's.
			}
		}
		for (const listener of listeners) {
			try {
				listener(failure);
			} catch {
				// Same.
			}
		}
	};

	const persist = (kind: ProcessFailureKind, failure: ProcessFailure) => {
		const position = options.position?.();
		const record: CrashRecord | undefined = recordCrash(
			{
				kind,
				error: failure.error,
				category: failure.category,
				mode: options.mode,
				sessionFile: options.sessionFile ?? undefined,
				cwd: options.cwd,
				turn: position?.turn,
				tool: position?.tool,
			},
			options.crashLogPath,
		);
		return record;
	};

	const onUnhandledRejection = (reason: unknown) => {
		if (disposed) return;
		const failure: ProcessFailure = {
			kind: "unhandled_rejection",
			category: classifyFailure(reason),
			error: reason,
			line: lineFor("a promise failed and nothing handled it; mu goes on", reason),
		};
		// The process is still sound: record it, say it once, keep the session alive.
		persist("unhandled_rejection", failure);
		log(failure.line);
		notify(failure);
	};

	const onUncaughtException = (error: unknown) => {
		if (disposed || exiting) return;
		exiting = true;
		const failure: ProcessFailure = {
			kind: "uncaught_exception",
			category: classifyFailure(error),
			error,
			line: lineFor("mu is exiting on an uncaught exception", error),
		};
		restoreOnce();
		persist("uncaught_exception", failure);
		log(failure.line);
		notify(failure);
		exit(exitCodeFor(failure.category));
	};

	/** A closed pipe (`mu | head`) is not a crash worth a stack: stop writing and leave quietly. */
	const onStreamError = (stream: "stdout" | "stderr") => (error: unknown) => {
		if (disposed || exiting) return;
		const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
		if (code !== "EPIPE") return;
		exiting = true;
		const failure: ProcessFailure = {
			kind: "fatal_error",
			category: "internal",
			error,
			line: `${stream} was closed by the reader (EPIPE); mu stops writing`,
		};
		persist("fatal_error", failure);
		notify(failure);
		exit(EXIT_RETRYABLE);
	};

	const onStdoutError = onStreamError("stdout");
	const onStderrError = onStreamError("stderr");

	target.on("unhandledRejection", onUnhandledRejection);
	target.on("uncaughtException", onUncaughtException);
	const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
	streams.stdout.on("error", onStdoutError);
	streams.stderr.on("error", onStderrError);

	return {
		uninstall() {
			disposed = true;
			target.off("unhandledRejection", onUnhandledRejection);
			target.off("uncaughtException", onUncaughtException);
			streams.stdout.off("error", onStdoutError);
			streams.stderr.off("error", onStderrError);
			listeners.clear();
		},
		onFailure(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function writeStderr(line: string): void {
	try {
		process.stderr.write(`${line}\n`);
	} catch {
		// Nowhere to log to.
	}
}

/** How long a shutdown may take before the process leaves anyway. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;

export interface ShutdownWatchdogOptions {
	timeoutMs?: number;
	/** What to do when the budget expires. Defaults to recording the failure and exiting with 1. */
	onTimeout?: () => void;
	/** Extra context for the record. */
	label?: string;
}

export interface DisposeWatchdogOptions extends ShutdownWatchdogOptions {
	mode?: AppMode;
	cwd: string;
	sessionFile?: string | null;
	crashLogPath?: string;
	log?: (line: string) => void;
	exit?: (code: number) => void;
}

/**
 * A shutdown step that never finishes used to keep the process alive with the terminal still in raw mode:
 * an extension's dispose waiting on a socket that will not close, and mu sits there. After the budget the
 * process leaves, and the record says which step was still running.
 *
 * Returns true when the work finished on time. A false means the process is on its way out.
 */
export async function disposeWithWatchdog(
	dispose: () => Promise<void>,
	options: DisposeWatchdogOptions,
): Promise<boolean> {
	const label = options.label ?? "runtimeHost.dispose";
	const budget = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
	// Both outcomes resolve to undefined, so completion is recorded instead of inferred from the value.
	let finished = false;
	const work = dispose().then(() => {
		finished = true;
	});
	await withShutdownWatchdog(work, {
		timeoutMs: budget,
		onTimeout:
			options.onTimeout ??
			(() => {
				const failure = new Error(`${label} did not finish in ${budget} ms`);
				const line = `mu is exiting: ${redactFailure(failure, environmentSecrets()).message}`;
				recordCrash(
					{
						kind: "shutdown_timeout",
						error: failure,
						category: "internal",
						mode: options.mode,
						sessionFile: options.sessionFile ?? undefined,
						cwd: options.cwd,
					},
					options.crashLogPath,
				);
				try {
					(options.log ?? writeStderr)(line);
				} catch {
					// Nowhere to say it.
				}
				(options.exit ?? ((code: number) => process.exit(code)))(EXIT_RETRYABLE);
			}),
	});
	return finished;
}

/**
 * Run a shutdown step with an upper bound. An extension's dispose that never resolves used to keep the
 * process alive forever with the terminal still in raw mode; after the budget the process leaves with a
 * nonzero code, and the record says which step was still running.
 */
export async function withShutdownWatchdog<T>(
	work: Promise<T>,
	options: ShutdownWatchdogOptions = {},
): Promise<T | undefined> {
	const budget = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
	let timer: NodeJS.Timeout | undefined;
	const expired = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => {
			try {
				options.onTimeout?.();
			} catch {
				// Same rule as above: the timeout path must not throw.
			}
			resolve(undefined);
		}, budget);
		timer.unref?.();
	});
	try {
		return await Promise.race([work, expired]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
