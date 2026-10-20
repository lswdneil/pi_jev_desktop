import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type JsonlSpanRecord, JsonlTelemetryContext } from "../src/index.ts";

function records(dir: string): JsonlSpanRecord[] {
	// A rotated file keeps the `.jsonl` stem (`spans-….jsonl.1`), so both are telemetry here.
	const files = readdirSync(dir)
		.filter((name) => name.includes(".jsonl"))
		.sort();
	return files.flatMap((name) =>
		readFileSync(join(dir, name), "utf8")
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line) as JsonlSpanRecord),
	);
}

describe("JSONL telemetry sink", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "mu-telemetry-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes a span with its ids, status and duration", async () => {
		const sink = new JsonlTelemetryContext({ dir, flushIntervalMs: 0 });
		await sink.startSpan(
			{
				name: "judge.decision",
				attributes: {
					"session.id": "s-1",
					"turn.id": 3,
					"decision.id": "tool.admission",
					"decision.mode": "active",
				},
			},
			async (span) => {
				span.setAttributes({ "decision.source": "judge", "decision.latency_ms": 7, "ledger.id": "l-1" });
			},
		);
		sink.flush();

		const [record] = records(dir);
		expect(record?.name).toBe("judge.decision");
		expect(record?.status).toBe("ok");
		expect(record?.attributes).toMatchObject({
			"session.id": "s-1",
			"turn.id": 3,
			"decision.id": "tool.admission",
			"decision.source": "judge",
			"decision.latency_ms": 7,
			"ledger.id": "l-1",
		});
		expect(record?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("drops an attribute the schema never named, and redacts the ones it keeps", async () => {
		const sink = new JsonlTelemetryContext({
			dir,
			flushIntervalMs: 0,
			redact: (text) => text.replaceAll("hunter2", "[redacted]"),
		});
		await sink.startSpan(
			{
				name: "tool.call",
				attributes: {
					"session.id": "hunter2-session",
					"tool.name": "bash",
					// Not in the schema: this is the whitelist doing its job.
					command: "curl -H 'Authorization: Bearer hunter2'",
					prompt: "the user's message",
				},
			},
			async () => {},
		);
		sink.flush();

		const [record] = records(dir);
		expect(record?.attributes).toEqual({ "session.id": "[redacted]-session", "tool.name": "bash" });
		expect(JSON.stringify(record)).not.toContain("hunter2");
		expect(JSON.stringify(record)).not.toContain("the user's message");
	});

	it("nests a child span under its parent", async () => {
		const sink = new JsonlTelemetryContext({ dir, flushIntervalMs: 0 });
		await sink.startSpan({ name: "turn", attributes: { "session.id": "s-1", "turn.id": 1 } }, async (turn) => {
			await turn.startSpan(
				{
					name: "judge.decision",
					attributes: { "session.id": "s-1", "turn.id": 1, "decision.id": "preflight", "decision.mode": "active" },
				},
				async (span) => {
					span.setAttributes({ "decision.source": "fallback", "decision.latency_ms": 1 });
				},
			);
		});
		sink.flush();

		const written = records(dir);
		const turn = written.find((record) => record.name === "turn");
		const decision = written.find((record) => record.name === "judge.decision");
		expect(turn?.parentId).toBeNull();
		expect(decision?.parentId).toBe(turn?.spanId);
	});

	it("rotates the file when it grows past the limit", async () => {
		const sink = new JsonlTelemetryContext({ dir, flushIntervalMs: 0, maxBytes: 120 });
		for (const turnId of [1, 2, 3]) {
			await sink.startSpan({ name: "turn", attributes: { "session.id": "s-1", "turn.id": turnId } }, async () => {});
			sink.flush();
		}

		const files = readdirSync(dir).sort();
		expect(files).toContain(`spans-${new Date().toISOString().slice(0, 10)}.jsonl.1`);
		// Every record is still readable: rotation renames, it never truncates.
		expect(records(dir)).toHaveLength(3);
	});

	it("gives up quietly when the directory cannot be written", async () => {
		const file = join(dir, "not-a-directory");
		writeFileSync(file, "x");
		const sink = new JsonlTelemetryContext({ dir: file, flushIntervalMs: 0 });

		await expect(
			sink.startSpan({ name: "turn", attributes: { "session.id": "s-1", "turn.id": 1 } }, async () => "done"),
		).resolves.toBe("done");
		expect(() => sink.flush()).not.toThrow();
	});

	it("records a failing span as an error and rethrows what happened", async () => {
		const sink = new JsonlTelemetryContext({ dir, flushIntervalMs: 0 });
		await expect(
			sink.startSpan({ name: "turn", attributes: { "session.id": "s-1", "turn.id": 1 } }, async () => {
				throw new Error("model went away");
			}),
		).rejects.toThrow("model went away");
		sink.flush();

		const [record] = records(dir);
		expect(record?.status).toBe("error");
		expect(record?.error).toBe("rejected");
	});
});
