import { AsyncLocalStorage } from "node:async_hooks";
import type { SpanAttributes, SpanOptions, TelemetryContext, TelemetrySpan } from "../index.ts";
import { allowedAttributes, sensitiveAttributes } from "../schema.ts";

export interface OtlpSinkOptions {
	/** Collector endpoint: the base URL of the OTLP/HTTP receiver. */
	endpoint: string;
	/** Resource attributes, e.g. service name and version. */
	resource?: Record<string, string>;
	/** Spans buffered before an export. Default 32. */
	batchSize?: number;
	/** Longest a span waits in the buffer, ms. Default 5000. */
	flushIntervalMs?: number;
	/** Injected for tests; defaults to global fetch. */
	fetch?: typeof fetch;
	/** Extra redaction for string values. */
	redact?: (text: string) => string;
	now?: () => Date;
}

interface PendingSpan {
	name: string;
	spanId: string;
	parentId: string | null;
	startUnixNano: bigint;
	endUnixNano: bigint;
	status: "ok" | "error";
	attributes: Record<string, string | number | boolean | readonly (string | number | boolean)[]>;
}

/** OTLP/HTTP wants a fixed set of typed values; everything else is stringified. */
function otlpValue(value: string | number | boolean | readonly (string | number | boolean)[]): object {
	if (typeof value === "string") return { stringValue: value };
	if (typeof value === "boolean") return { boolValue: value };
	if (typeof value === "number") {
		return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
	}
	return { arrayValue: { values: value.map((item) => otlpValue(item)) } };
}

/**
 * Sends spans to an OTLP/HTTP collector.
 *
 * Off unless the host turns it on: a session that phones home without being asked is exactly what a
 * production-readiness pass is supposed to remove. Nothing here may fail a turn — a collector that is
 * down, slow, or rejecting is recorded as a failed export and the session carries on.
 */
export class OtlpTelemetryContext implements TelemetryContext {
	private readonly options: Required<Omit<OtlpSinkOptions, "resource" | "fetch" | "redact" | "now">> & {
		resource: Record<string, string>;
		fetch: typeof fetch;
		redact: (text: string) => string;
		now: () => Date;
	};
	private readonly sensitive = sensitiveAttributes();
	private buffer: PendingSpan[] = [];
	private nextSpanId = 1;
	private timer: NodeJS.Timeout | undefined;
	private closed = false;
	/** Ambient parent, so a span opened deeper in the call stack nests without threading the parent through. */
	private readonly parents = new AsyncLocalStorage<string>();
	/** What the last export did, for the shutdown report and tests. */
	exports = { succeeded: 0, failed: 0 };

	constructor(options: OtlpSinkOptions) {
		this.options = {
			endpoint: options.endpoint.replace(/\/+$/, ""),
			resource: options.resource ?? {},
			batchSize: options.batchSize ?? 32,
			flushIntervalMs: options.flushIntervalMs ?? 5_000,
			fetch: options.fetch ?? ((input, init) => fetch(input, init)),
			redact: options.redact ?? ((text) => text),
			now: options.now ?? (() => new Date()),
		};
	}

	async startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
		if (this.closed) return callback(this.noopSpan());
		const spanId = (this.nextSpanId++).toString(16).padStart(16, "0");
		const parentId = this.parents.getStore() ?? null;
		const startUnixNano = BigInt(this.options.now().getTime()) * 1_000_000n;
		const startAttributes = this.clean(options.name, "start", options.attributes);
		const endAttributes: PendingSpan["attributes"] = {};
		let status: "ok" | "error" = "ok";
		const span: TelemetrySpan = {
			startSpan: (childOptions, childCallback) =>
				this.parents.run(spanId, () => this.startSpan(childOptions, childCallback)),
			addEvent: () => {},
			setAttributes: (attributes) => {
				Object.assign(endAttributes, this.clean(options.name, "end", attributes));
			},
			setStatus: (value) => {
				status = value.status;
			},
		};
		const finish = () => {
			if (this.closed) return;
			this.buffer.push({
				name: options.name,
				spanId,
				parentId,
				startUnixNano,
				endUnixNano: BigInt(this.options.now().getTime()) * 1_000_000n,
				status,
				attributes: { ...startAttributes, ...endAttributes },
			});
			if (this.buffer.length >= this.options.batchSize) void this.export();
			else this.startTimer();
		};
		try {
			const result = await this.parents.run(spanId, () => callback(span));
			finish();
			return result;
		} catch (thrown) {
			status = "error";
			finish();
			throw thrown;
		}
	}

	/** Export what is buffered. Never throws: a collector that is down is not the session's problem. */
	async export(): Promise<void> {
		if (this.buffer.length === 0) return;
		const spans = this.buffer;
		this.buffer = [];
		try {
			const response = await this.options.fetch(`${this.options.endpoint}/v1/traces`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					resourceSpans: [
						{
							resource: {
								attributes: Object.entries(this.options.resource).map(([key, value]) => ({
									key,
									value: { stringValue: value },
								})),
							},
							scopeSpans: [
								{
									scope: { name: "mu", version: "1" },
									spans: spans.map((span) => ({
										traceId: span.spanId,
										spanId: span.spanId,
										name: span.name,
										kind: 1,
										startTimeUnixNano: span.startUnixNano.toString(),
										endTimeUnixNano: span.endUnixNano.toString(),
										attributes: Object.entries(span.attributes).map(([key, value]) => ({
											key,
											value: otlpValue(value),
										})),
										status: { code: span.status === "ok" ? 1 : 2 },
									})),
								},
							],
						},
					],
				}),
			});
			if (!response.ok) throw new Error(`collector answered ${response.status}`);
			this.exports.succeeded++;
		} catch {
			this.exports.failed++;
		}
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		await this.export();
	}

	private clean(
		spanName: string,
		phase: "start" | "end",
		attributes: SpanAttributes | undefined,
	): Record<string, string | number | boolean | readonly (string | number | boolean)[]> {
		const out: Record<string, string | number | boolean | readonly (string | number | boolean)[]> = {};
		if (!attributes) return out;
		const names = allowedAttributes(spanName, phase);
		for (const [name, value] of Object.entries(attributes)) {
			if (value === undefined || !names.has(name) || this.sensitive.has(name)) continue;
			if (typeof value === "string") out[name] = this.options.redact(value);
			else out[name] = value;
		}
		return out;
	}

	private startTimer(): void {
		if (this.timer || this.options.flushIntervalMs <= 0) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.export();
		}, this.options.flushIntervalMs);
		this.timer.unref?.();
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
