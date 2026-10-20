import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetryContext, NOOP_TELEMETRY_CONTEXT, OtlpTelemetryContext, telemetryMode } from "../src/index.ts";

describe("telemetry mode", () => {
	it("is local by default and never remote unless asked twice", () => {
		expect(telemetryMode({})).toBe("jsonl");
		expect(telemetryMode({ MU_TELEMETRY: "jsonl" })).toBe("jsonl");
		expect(telemetryMode({ MU_TELEMETRY: "off" })).toBe("off");
		expect(telemetryMode({ MU_TELEMETRY: "none" })).toBe("off");
		// A collector address in the environment is not consent to use it.
		expect(telemetryMode({ MU_OTEL: "1" })).toBe("otlp");
		expect(telemetryMode({ MU_TELEMETRY: "otlp" })).toBe("off");
		expect(telemetryMode({ MU_TELEMETRY: "otlp", MU_OTEL: "1" })).toBe("otlp");
	});
});

describe("createTelemetryContext", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "mu-otlp-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("hands back the noop context when telemetry is off", async () => {
		const handle = createTelemetryContext({ env: { MU_TELEMETRY: "off" }, dir });
		expect(handle.mode).toBe("off");
		expect(handle.context).toBe(NOOP_TELEMETRY_CONTEXT);
		await handle.close();
	});

	it("writes to the agent directory by default", async () => {
		const handle = createTelemetryContext({ env: {}, dir });
		expect(handle.mode).toBe("jsonl");
		await handle.context.startSpan(
			{ name: "turn", attributes: { "session.id": "s-1", "turn.id": 1 } },
			async () => {},
		);
		await handle.close();
		const files = readdirSync(dir).filter((name) => name.includes(".jsonl"));
		expect(files).toHaveLength(1);
		expect(readFileSync(join(dir, files[0]!), "utf8")).toContain('"session.id":"s-1"');
	});
});

describe("OTLP sink", () => {
	it("sends nothing until asked, and a collector that is down is not an error the session sees", async () => {
		const fetch = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		const sink = new OtlpTelemetryContext({ endpoint: "http://127.0.0.1:4318", fetch, flushIntervalMs: 0 });
		await sink.startSpan(
			{ name: "turn", attributes: { "session.id": "s-1", "turn.id": 1, secret: "should not leave" } },
			async () => {},
		);
		await expect(sink.export()).resolves.toBeUndefined();
		expect(sink.exports).toEqual({ succeeded: 0, failed: 1 });
	});

	it("posts OTLP spans with only the attributes the schema allows", async () => {
		const requests: { url: string; body: string }[] = [];
		const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: String(url), body: String(init?.body ?? "") });
			return new Response("{}", { status: 200 });
		});
		const sink = new OtlpTelemetryContext({
			endpoint: "http://collector.test:4318/",
			fetch: fetch as typeof globalThis.fetch,
			flushIntervalMs: 0,
		});
		await sink.startSpan(
			{
				name: "judge.decision",
				attributes: { "session.id": "s-1", "decision.id": "tool.admission", "decision.mode": "active" },
			},
			async (span) => {
				span.setAttributes({ "decision.source": "judge", "decision.latency_ms": 3 });
			},
		);
		await sink.export();

		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("http://collector.test:4318/v1/traces");
		const body = JSON.parse(requests[0]?.body ?? "{}") as {
			resourceSpans: { scopeSpans: { spans: { name: string; attributes: { key: string }[] }[] }[] }[];
		};
		const span = body.resourceSpans[0]?.scopeSpans[0]?.spans[0];
		expect(span?.name).toBe("judge.decision");
		expect(span?.attributes.map((attribute) => attribute.key).sort()).toEqual([
			"decision.id",
			"decision.latency_ms",
			"decision.mode",
			"decision.source",
			"session.id",
		]);
		expect(sink.exports).toEqual({ succeeded: 1, failed: 0 });
	});
});
