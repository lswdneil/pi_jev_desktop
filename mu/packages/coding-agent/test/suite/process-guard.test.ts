import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CrashRecord, readCrashLog } from "../../src/core/crash-log.ts";
import {
	classifyFailure,
	disposeWithWatchdog,
	EXIT_FATAL,
	EXIT_RETRYABLE,
	installProcessGuard,
	type ProcessGuardOptions,
} from "../../src/core/process-guard.ts";

/** A stand-in for `process`: the real one cannot be crashed on purpose inside a test run. */
function fakeProcess() {
	const events = new EventEmitter();
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	return { events, stdout, stderr };
}

function records(path: string): CrashRecord[] {
	return readCrashLog(path);
}

describe("process guard", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "mu-guard-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function install(mode: ProcessGuardOptions["mode"], extra: Partial<ProcessGuardOptions> = {}) {
		const fake = fakeProcess();
		const exits: number[] = [];
		const lines: string[] = [];
		let restores = 0;
		const crashLogPath = join(dir, "crashes.json");
		const seen: string[] = [];
		const guard = installProcessGuard({
			mode,
			cwd: dir,
			sessionFile: join(dir, "session.jsonl"),
			crashLogPath,
			target: fake.events,
			streams: { stdout: fake.stdout, stderr: fake.stderr },
			exit: (code) => exits.push(code),
			log: (line) => lines.push(line),
			restoreTerminal: () => {
				restores++;
			},
			onFailure: (failure) => seen.push(failure.line),
			...extra,
		});
		return {
			fake,
			guard,
			exits,
			lines,
			seen,
			crashLogPath,
			restores: () => restores,
			records: () => records(crashLogPath),
		};
	}

	it("writes a record, restores the terminal once and exits 2 for an internal throw", () => {
		const harness = install("print");
		harness.fake.events.emit("uncaughtException", new TypeError("cannot read properties of undefined"));

		expect(harness.exits).toEqual([EXIT_FATAL]);
		expect(harness.restores()).toBe(1);
		const [record] = harness.records();
		expect(record?.kind).toBe("uncaught_exception");
		expect(record?.category).toBe("internal");
		expect(record?.mode).toBe("print");
		expect(record?.platform).toBe(process.platform);
		expect(record?.sessionFile).toBe(join(dir, "session.jsonl"));
		harness.guard.uninstall();
	});

	it("exits 1 for a retryable failure: a timeout or a cancellation", () => {
		const timeout = install("print");
		timeout.fake.events.emit(
			"uncaughtException",
			Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
		);
		expect(timeout.exits).toEqual([EXIT_RETRYABLE]);
		expect(timeout.records()[0]?.category).toBe("timeout");

		const cancelled = install("print");
		const abort = new Error("The operation was aborted");
		abort.name = "AbortError";
		cancelled.fake.events.emit("uncaughtException", abort);
		expect(cancelled.exits).toEqual([EXIT_RETRYABLE]);
		expect(cancelled.records().at(-1)?.category).toBe("aborted");
	});

	it("survives an unhandled rejection, reports it once, and keeps the session alive", () => {
		const harness = install("rpc");
		harness.fake.events.emit("unhandledRejection", new Error("a promise nobody handled"));

		// No exit: the conversation continues, one operation was lost.
		expect(harness.exits).toEqual([]);
		expect(harness.restores()).toBe(0);
		expect(harness.seen).toHaveLength(1);
		expect(harness.lines[0]).toContain("a promise failed and nothing handled it");
		const [record] = harness.records();
		expect(record?.kind).toBe("unhandled_rejection");
		expect(record?.mode).toBe("rpc");
	});

	it("keeps a credential out of the record and out of the log line", () => {
		const harness = install("print");
		const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
		harness.fake.events.emit("unhandledRejection", new Error(`request failed with ${secret}`));

		const written = readFileSync(harness.crashLogPath, "utf8");
		expect(written).not.toContain(secret);
		expect(harness.lines[0]).not.toContain(secret);
		expect(written).toContain("[redacted]");
	});

	it("stops quietly on a closed pipe instead of printing a stack", () => {
		const harness = install("print");
		harness.fake.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));

		expect(harness.exits).toEqual([EXIT_RETRYABLE]);
		expect(harness.lines).toEqual([]);
		expect(harness.records()[0]?.kind).toBe("fatal_error");
	});

	it("restores the terminal only once even when two failures arrive", () => {
		const harness = install("interactive");
		harness.fake.events.emit("uncaughtException", new Error("first"));
		harness.fake.events.emit("uncaughtException", new Error("second"));

		// The second event arrives while the process is already leaving: one restore, one exit.
		expect(harness.restores()).toBe(1);
		expect(harness.exits).toEqual([EXIT_FATAL]);
	});

	it("removes every listener it added", () => {
		const harness = install("print");
		harness.guard.uninstall();
		expect(harness.fake.events.listenerCount("uncaughtException")).toBe(0);
		expect(harness.fake.events.listenerCount("unhandledRejection")).toBe(0);
		expect(harness.fake.stdout.listenerCount("error")).toBe(0);
	});
});

describe("classifyFailure", () => {
	it("names the categories the record and the exit code are built from", () => {
		expect(classifyFailure(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("user-data");
		expect(classifyFailure(new SyntaxError("Unexpected token"))).toBe("user-data");
		expect(classifyFailure(new Error("connect timed out"))).toBe("timeout");
		expect(classifyFailure(Object.assign(new Error("x"), { code: "UND_ERR_BODY_TIMEOUT" }))).toBe("timeout");
		expect(classifyFailure(new Error("socket hang up"))).toBe("internal");
	});
});

describe("disposeWithWatchdog", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "mu-watchdog-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("leaves with a nonzero code and a record when a shutdown step never finishes", async () => {
		const exits: number[] = [];
		const lines: string[] = [];
		const crashLogPath = join(dir, "crashes.json");
		const finished = await disposeWithWatchdog(() => new Promise<void>(() => {}), {
			timeoutMs: 40,
			mode: "rpc",
			cwd: dir,
			sessionFile: join(dir, "session.jsonl"),
			crashLogPath,
			exit: (code) => exits.push(code),
			log: (line) => lines.push(line),
		});

		expect(finished).toBe(false);
		expect(exits).toEqual([EXIT_RETRYABLE]);
		expect(lines[0]).toContain("did not finish in 40 ms");
		expect(records(crashLogPath)[0]?.kind).toBe("shutdown_timeout");
	});

	it("returns true when the step finishes inside the budget", async () => {
		const finished = await disposeWithWatchdog(() => Promise.resolve(), {
			timeoutMs: 1_000,
			cwd: dir,
			exit: () => {
				throw new Error("must not exit");
			},
		});
		expect(finished).toBe(true);
	});
});
