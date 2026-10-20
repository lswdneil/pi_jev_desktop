import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTelemetryContext, type JsonlSpanRecord, JsonlTelemetryContext } from "@earendil-works/pi-telemetry";
import { describe, expect, it } from "vitest";
import { DecisionEngine, defineDecision } from "../src/decision.ts";
import { Judge } from "../src/judge.ts";
import { MemoryLedger } from "../src/ledger.ts";
import { MockJudgeProvider } from "../src/providers/mock.ts";
import type { Questions } from "../src/types.ts";

const questions = {
	greet: { type: "boolean", instructions: "Is `user_message` a greeting?" },
} satisfies Questions;

const greeting = defineDecision({
	id: "test.greeting",
	version: 1,
	cacheImpact: "none",
	latency: "inline",
	questions,
	capabilities: "classify",
	fallback: () => "work" as const,
	policy(answers) {
		return answers.greet?.type === "boolean" && answers.greet.probability > 0.75
			? ("greeting" as const)
			: ("work" as const);
	},
	buildState: (input: string) => ({ user_message: input }),
});

function engine(telemetry: InMemoryTelemetryContext) {
	const engine = new DecisionEngine({
		judge: new Judge({
			provider: new MockJudgeProvider(() => ({ greet: { type: "boolean", probability: 0.9 } })),
			timeoutMs: 1_000,
		}),
		ledger: new MemoryLedger(),
		defaultMode: "active",
		telemetry,
		scope: () => ({ sessionId: "session-1", turnId: 4 }),
	});
	return engine;
}

describe("judge.decision spans", () => {
	it("records one span per decision with the ids needed to join the ledger", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const decision = await engine(telemetry).decide(greeting, "hello");

		const spans = telemetry.getSpans();
		expect(spans).toHaveLength(1);
		const [span] = spans;
		expect(span?.name).toBe("judge.decision");
		expect(span?.attributes).toMatchObject({
			"session.id": "session-1",
			"turn.id": 4,
			"decision.id": "test.greeting",
			"decision.mode": "active",
			"decision.source": "judge",
		});
		expect(span?.attributes["decision.latency_ms"]).toBeGreaterThanOrEqual(0);
		expect(span?.attributes["ledger.id"]).toBe(decision.ledgerId);
	});

	it("nests under a caller's turn span, and keeps the outcome when the judge falls back", async () => {
		// Nesting is the sink's job (ambient parent), so this one runs against the sink that ships.
		const dir = mkdtempSync(join(tmpdir(), "mu-span-"));
		const telemetry = new JsonlTelemetryContext({ dir, flushIntervalMs: 0 });
		const engineUnderTest = new DecisionEngine({
			judge: new Judge({
				provider: new MockJudgeProvider(() => {
					throw new Error("judge is down");
				}),
				timeoutMs: 1_000,
			}),
			ledger: new MemoryLedger(),
			defaultMode: "active",
			telemetry,
			scope: () => ({ sessionId: "session-1", turnId: 1 }),
		});

		const decision = await telemetry.startSpan(
			{ name: "turn", attributes: { "session.id": "session-1", "turn.id": 1 } },
			async (turn) => {
				const result = await engineUnderTest.decide(greeting, "hello");
				turn.setAttributes({ "turn.outcome": "answered", "turn.judge_calls": 1 });
				return result;
			},
		);

		telemetry.flush();
		const written: JsonlSpanRecord[] = readdirSync(dir)
			.filter((name) => name.includes(".jsonl"))
			.flatMap((name) =>
				readFileSync(join(dir, name), "utf8")
					.split("\n")
					.filter((line) => line.trim())
					.map((line) => JSON.parse(line) as JsonlSpanRecord),
			);
		rmSync(dir, { recursive: true, force: true });
		const turn = written.find((span) => span.name === "turn");
		const decisionSpan = written.find((span) => span.name === "judge.decision");
		expect(decisionSpan?.parentId).toBe(turn?.spanId);
		expect(decisionSpan?.attributes["decision.source"]).toBe("fallback");
		expect(decision.outcome).toBe("work");
	});

	it("writes no span when the decision point is off", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const off = { ...greeting, id: "test.greeting-off" };
		const instance = engine(telemetry);
		instance.setMode(off.id, "off");
		await instance.decide(off, "hello");
		expect(telemetry.getSpans()).toHaveLength(0);
	});
});
