import type { TelemetryContext } from "./index.ts";
import { NOOP_TELEMETRY_CONTEXT } from "./noop.ts";
import { JsonlTelemetryContext } from "./sinks/jsonl.ts";
import { OtlpTelemetryContext } from "./sinks/otlp.ts";

/** What the host reads from its environment. Every value is optional: the defaults are the safe ones. */
export interface TelemetryEnvironment {
	/** `jsonl` (default), `otlp`, or `off`. */
	MU_TELEMETRY?: string;
	/** `1` turns OTLP on; anything else leaves it off. */
	MU_OTEL?: string;
	/** Collector base URL, e.g. `http://127.0.0.1:4318`. */
	MU_OTEL_ENDPOINT?: string;
	/** Where the JSONL files go. The host passes its own default (`~/.mu/logs`). */
	MU_TELEMETRY_DIR?: string;
}

export type TelemetryMode = "off" | "jsonl" | "otlp";

/** OTLP is opt-in twice over: the mode must ask for it and `MU_OTEL=1` must be set. */
export function telemetryMode(env: TelemetryEnvironment): TelemetryMode {
	const requested = env.MU_TELEMETRY?.trim().toLowerCase();
	if (requested === "off" || requested === "none") return "off";
	if (requested === "otlp") return env.MU_OTEL?.trim() === "1" ? "otlp" : "off";
	if (env.MU_OTEL?.trim() === "1") return "otlp";
	return "jsonl";
}

export interface TelemetryFactoryOptions {
	env: TelemetryEnvironment;
	/** Directory for the JSONL sink; required for `jsonl`, ignored otherwise. */
	dir: string;
	/** Redaction for string values, applied by both sinks. */
	redact?: (text: string) => string;
	/** Injected for tests. */
	fetch?: typeof fetch;
	/** Written into the OTLP resource, e.g. `service.name=mu`, `service.version=1.0.2`. */
	version?: string;
}

export interface TelemetryHandle {
	readonly mode: TelemetryMode;
	readonly context: TelemetryContext;
	/** Write out what is buffered. Safe at shutdown, never throws. */
	flush(): void;
	/** Flush and stop accepting spans. */
	close(): Promise<void>;
}

/**
 * The one place a host decides whether mu writes telemetry and where.
 *
 * Default is local JSONL: the spans answer "what happened" without leaving the machine, and they hold
 * no prompt, no output and no key. A remote collector needs `MU_OTEL=1` as well, so a setting copied
 * from a colleague's config cannot start shipping spans by itself.
 */
export function createTelemetryContext(options: TelemetryFactoryOptions): TelemetryHandle {
	const mode = telemetryMode(options.env);
	if (mode === "off") {
		return {
			mode,
			context: NOOP_TELEMETRY_CONTEXT,
			flush: () => {},
			close: async () => {},
		};
	}
	if (mode === "otlp") {
		const sink = new OtlpTelemetryContext({
			endpoint: options.env.MU_OTEL_ENDPOINT?.trim() || "http://127.0.0.1:4318",
			resource: { "service.name": "mu", ...(options.version ? { "service.version": options.version } : {}) },
			...(options.fetch ? { fetch: options.fetch } : {}),
			...(options.redact ? { redact: options.redact } : {}),
		});
		return {
			mode,
			context: sink,
			flush: () => {
				void sink.export();
			},
			close: () => sink.close(),
		};
	}
	const sink = new JsonlTelemetryContext({
		dir: options.env.MU_TELEMETRY_DIR?.trim() || options.dir,
		...(options.redact ? { redact: options.redact } : {}),
	});
	return {
		mode,
		context: sink,
		flush: () => sink.flush(),
		close: async () => sink.close(),
	};
}
