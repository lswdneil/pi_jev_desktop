import { describe, expect, it } from "vitest";
import {
	allowedAttributes,
	createTypedSpanStarter,
	InMemoryTelemetryContext,
	SPEC_AI_JEV_TELEMETRY_SCHEMA,
	sensitiveAttributes,
} from "../src/index.ts";

describe("mu span schema", () => {
	it("defines the seven spans the plan asked for", () => {
		expect(Object.keys(SPEC_AI_JEV_TELEMETRY_SCHEMA.spans).sort()).toEqual([
			"context.admission",
			"context.compaction",
			"judge.decision",
			"memory.recall",
			"model.request",
			"tool.call",
			"turn",
		]);
		expect(SPEC_AI_JEV_TELEMETRY_SCHEMA.version).toBe(1);
	});

	it("names only ids, counts and outcomes: nothing that could hold a prompt or an output", () => {
		// Every attribute is a name from this list; a new one has to come through the schema first.
		for (const [spanName, span] of Object.entries(SPEC_AI_JEV_TELEMETRY_SCHEMA.spans)) {
			for (const name of Object.keys({ ...span.startAttributes, ...span.endAttributes })) {
				expect(name, `${spanName}.${name}`).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
				expect(name).not.toMatch(/prompt|message$|content|output_text|stdout|command/);
			}
		}
	});

	it("keeps the parent relations the plan describes", () => {
		const turn = SPEC_AI_JEV_TELEMETRY_SCHEMA.spans.turn;
		expect(turn.parents).toEqual({ kind: "root_or_external" });
		for (const name of ["model.request", "tool.call", "judge.decision", "context.admission"]) {
			const span = SPEC_AI_JEV_TELEMETRY_SCHEMA.spans[name as keyof typeof SPEC_AI_JEV_TELEMETRY_SCHEMA.spans];
			expect(span.parents).toEqual({ kind: "spans", spans: ["turn"] });
		}
	});

	it("is what the sinks read to decide which attributes may be written", () => {
		expect([...allowedAttributes("judge.decision", "start")].sort()).toEqual([
			"decision.id",
			"decision.mode",
			"session.id",
			"turn.id",
		]);
		expect([...allowedAttributes("judge.decision", "end")].sort()).toEqual([
			"decision.consent",
			"decision.latency_ms",
			"decision.quota",
			"decision.source",
			"decision.tier_count",
			"ledger.id",
		]);
		// An unknown span has no attributes, so a typo writes nothing instead of everything.
		expect(allowedAttributes("turnn", "start").size).toBe(0);
		expect(sensitiveAttributes().size).toBe(0);
	});

	it("rejects a span that misses a required attribute, at compile time", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const start = createTypedSpanStarter(telemetry, [SPEC_AI_JEV_TELEMETRY_SCHEMA]);
		// `session.id`, `decision.id` and `decision.mode` are required; the type error is the point of this test.
		// @ts-expect-error - a decision span without its required attributes must not compile
		await start("judge.decision", { "turn.id": 1 }, () => 1);
		await start(
			"judge.decision",
			{ "session.id": "s-1", "decision.id": "tool.admission", "decision.mode": "active" },
			(span) => {
				span.setAttributes({ "decision.source": "judge", "decision.latency_ms": 12 });
			},
		);
		// The first call above still runs at runtime, so the valid span is the last one recorded.
		const span = telemetry.getSpans().at(-1);
		expect(span?.name).toBe("judge.decision");
		expect(span?.attributes["decision.latency_ms"]).toBe(12);
	});
});
