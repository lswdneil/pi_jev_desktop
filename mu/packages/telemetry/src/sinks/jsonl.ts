import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SpanAttributes, SpanOptions, TelemetryContext, TelemetrySpan } from "../index.ts";
import { allowedAttributes, sensitiveAttributes } from "../schema.ts";

export interface JsonlSinkOptions {
	/** Directory the files go to; created on first write. */
	dir: string;
	/** File name prefix: `<prefix>-YYYY-MM-DD.jsonl`. */
	prefix?: string;
	/** Rotate to `<name>.1` past this size. Default 5 MiB. */
	maxBytes?: number;
	/** Spans buffered before a write. Default 32. */
	batchSize?: number;
	/** Longest a span waits in the buffer, ms. Default 1000. */
	flushIntervalMs?: number;
	/** Extra redaction for string values, applied after the whitelist. */
	redact?: (text: string) => string;
	/** Clock, so tests can drive rotation by date. */
	now?: () => Date;
}

export interface JsonlSpanRecord {
	type: "span";
	name: string;
	spanId: number;
	parentId: number | null;
	startedAt: string;
	durationMs: number;
	status: "ok" | "error";
	error?: string;
	attributes: Record<string, string | number | boolean | readonly (string | number | boolean)[]>;
}

type Buffered = JsonlSpanRecord;

type WritableValue = string | number | boolean | readonly (string | number | boolean)[];

function isWritableValue(value: unknown): value is WritableValue {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
	);
}

/**
 * Writes spans as JSON lines, one directory of daily files.
 *
 * Two rules are enforced here rather than at the call sites, because a call site forgets:
 *
 * 1. Only attributes the schema names for that span are written. An extra field means a newer call
 *    site than this sink, and writing it would put something unaudited into the log.
 * 2. String values go through redaction. The whitelist is the main defense; redaction is there for a
 *    value whose *shape* is a credential even though the schema expected a harmless string.
 *
 * Writes happen off a buffer, never in the request path, and nothing here may throw into the caller:
 * telemetry that breaks the turn it observes is worse than no telemetry.
 */
export class JsonlTelemetryContext implements TelemetryContext {
	private readonly options: Required<Omit<JsonlSinkOptions, "redact" | "now">> & {
		redact: (text: string) => string;
		now: () => Date;
	};
	private readonly allowed = new Map<string, { start: ReadonlySet<string>; end: ReadonlySet<string> }>();
	private readonly sensitive = sensitiveAttributes();
	private readonly parents = new AsyncLocalStorage<number>();
	private buffer: Buffered[] = [];
	private nextSpanId = 1;
	private timer: NodeJS.Timeout | undefined;
	private closed = false;
	private failed = false;

	constructor(options: JsonlSinkOptions) {
		this.options = {
			dir: options.dir,
			prefix: options.prefix ?? "spans",
			maxBytes: options.maxBytes ?? 5 * 1024 * 1024,
			batchSize: options.batchSize ?? 32,
			flushIntervalMs: options.flushIntervalMs ?? 1_000,
			redact: options.redact ?? ((text) => text),
			now: options.now ?? (() => new Date()),
		};
	}

	/** Spans written so far, for tests and for a shutdown report. */
	get pending(): number {
		return this.buffer.length;
	}

	async startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
		if (this.closed || this.failed) return callback(this.noopSpan());
		const spanId = this.nextSpanId++;
		const parentId = this.parents.getStore() ?? null;
		const startedAt = this.options.now();
		const started = performance.now();
		const startAttributes = this.clean(options.name, "start", options.attributes);
		const endAttributes: Record<string, JsonlSpanRecord["attributes"][string]> = {};
		let status: "ok" | "error" = "ok";
		let error: string | undefined;
		let settled = false;

		const span: TelemetrySpan = {
			startSpan: <Result>(
				childOptions: SpanOptions,
				childCallback: (child: TelemetrySpan) => Result | Promise<Result>,
			) => this.parents.run(spanId, () => this.startSpan(childOptions, childCallback)),
			addEvent: () => {
				// Schema events are not needed for the first version; a span's end attributes carry the outcome.
			},
			setAttributes: (attributes) => {
				if (settled) return;
				Object.assign(endAttributes, this.clean(options.name, "end", attributes));
			},
			setStatus: (value) => {
				if (settled) return;
				status = value.status;
				error = value.status === "error" ? value.error?.name : undefined;
			},
		};

		let result: T | Promise<T>;
		try {
			result = this.parents.run(spanId, () => callback(span));
		} catch (thrown) {
			this.record(options.name, spanId, parentId, startedAt, started, "error", "thrown", {
				...startAttributes,
				...endAttributes,
			});
			throw thrown;
		}
		return Promise.resolve(result).then(
			(value) => {
				if (!settled) {
					settled = true;
					this.record(options.name, spanId, parentId, startedAt, started, status, error, {
						...startAttributes,
						...endAttributes,
					});
				}
				return value;
			},
			(reason: unknown) => {
				if (!settled) {
					settled = true;
					this.record(options.name, spanId, parentId, startedAt, started, "error", "rejected", {
						...startAttributes,
						...endAttributes,
					});
				}
				throw reason;
			},
		);
	}

	/** Write what is buffered. Safe to call at shutdown, and never throws. */
	flush(): void {
		if (this.buffer.length === 0) return;
		const lines = this.buffer.map((record) => `${JSON.stringify(record)}\n`).join("");
		this.buffer = [];
		try {
			const now = this.options.now();
			mkdirSync(this.options.dir, { recursive: true });
			const path = this.pathFor(now);
			this.rotateIfNeeded(path);
			appendFileSync(path, lines);
		} catch {
			// A full disk or a read-only home must not break the session it is observing.
			this.failed = true;
			this.buffer = [];
			this.stopTimer();
		}
	}

	close(): void {
		this.flush();
		this.closed = true;
		this.stopTimer();
	}

	private record(
		name: string,
		spanId: number,
		parentId: number | null,
		startedAt: Date,
		started: number,
		status: "ok" | "error",
		error: string | undefined,
		attributes: Record<string, unknown>,
	): void {
		if (this.closed || this.failed) return;
		const clean: JsonlSpanRecord["attributes"] = {};
		for (const [key, value] of Object.entries(attributes)) {
			if (value !== undefined && isWritableValue(value)) clean[key] = value;
		}
		this.buffer.push({
			type: "span",
			name,
			spanId,
			parentId,
			startedAt: startedAt.toISOString(),
			durationMs: Math.round((performance.now() - started) * 100) / 100,
			status,
			...(error === undefined ? {} : { error }),
			attributes: clean,
		});
		if (this.buffer.length >= this.options.batchSize) this.flush();
		else this.startTimer();
	}

	/** Whitelist, then redaction: unknown names are dropped, sensitive ones are never written. */
	private clean(
		spanName: string,
		phase: "start" | "end",
		attributes: SpanAttributes | undefined,
	): Record<string, string | number | boolean | readonly (string | number | boolean)[]> {
		const out: Record<string, string | number | boolean | readonly (string | number | boolean)[]> = {};
		if (!attributes) return out;
		const allowed = this.allowedFor(spanName);
		const names = phase === "start" ? allowed.start : allowed.end;
		for (const [name, value] of Object.entries(attributes)) {
			if (value === undefined || !names.has(name) || this.sensitive.has(name)) continue;
			if (typeof value === "string") out[name] = this.options.redact(value);
			else if (isWritableValue(value)) out[name] = value;
		}
		return out;
	}

	private allowedFor(spanName: string): { start: ReadonlySet<string>; end: ReadonlySet<string> } {
		const existing = this.allowed.get(spanName);
		if (existing) return existing;
		const computed = { start: allowedAttributes(spanName, "start"), end: allowedAttributes(spanName, "end") };
		this.allowed.set(spanName, computed);
		return computed;
	}

	private pathFor(now: Date): string {
		const day = now.toISOString().slice(0, 10);
		return join(this.options.dir, `${this.options.prefix}-${day}.jsonl`);
	}

	/**
	 * Move the current file aside once it is full. The suffix is the first free number, because a second
	 * rotation that reused `.1` would overwrite the older file: rotation is supposed to keep history, not
	 * replace it. After nine, the oldest goes and `.1` is reused.
	 */
	private rotateIfNeeded(path: string): void {
		try {
			if (statSync(path).size < this.options.maxBytes) return;
		} catch {
			return; // No file yet: nothing to rotate.
		}
		for (let index = 1; index <= 9; index++) {
			const target = `${path}.${index}`;
			if (existsSync(target)) continue;
			renameSync(path, target);
			return;
		}
		renameSync(path, `${path}.1`);
	}

	private startTimer(): void {
		if (this.timer || this.options.flushIntervalMs <= 0) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.flush();
		}, this.options.flushIntervalMs);
		this.timer.unref?.();
	}

	private stopTimer(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	private noopSpan(): TelemetrySpan {
		return {
			startSpan: (_options, callback) => Promise.resolve(callback(this.noopSpan())),
			addEvent: () => {},
			setAttributes: () => {},
			setStatus: () => {},
		};
	}
}
