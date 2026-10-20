import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ABSTAIN, DecisionEngine, type DecisionSpec, defineDecision } from "../src/decision.ts";
import { boardRead } from "../src/decisions/board-read.ts";
import { browserStep } from "../src/decisions/browser-step.ts";
import { cacheWarming } from "../src/decisions/cache-warming.ts";
import { capabilityDisclosure } from "../src/decisions/capability-disclosure.ts";
import { contextCompact } from "../src/decisions/context-compact.ts";
import { contextForget } from "../src/decisions/context-forget.ts";
import { diagnosticsDelivery } from "../src/decisions/diagnostics-delivery.ts";
import { fileLocate } from "../src/decisions/file-locate.ts";
import { goalMet } from "../src/decisions/goal-met.ts";
import { hiveDeliver, hivePublish, hiveRelate } from "../src/decisions/hive.ts";
import { inputPreflight } from "../src/decisions/input-preflight.ts";
import { inputInterjection } from "../src/decisions/interjection.ts";
import { judgeItems } from "../src/decisions/judge-items.ts";
import {
	memoryApplied,
	memoryCapture,
	memoryMerge,
	memoryOutcome,
	memoryRecall,
	memoryRecallForTask,
	memoryWorth,
} from "../src/decisions/memory.ts";
import { notifyRouting } from "../src/decisions/notify-routing.ts";
import { outputDrift } from "../src/decisions/output-drift.ts";
import { reviewTriage } from "../src/decisions/review-triage.ts";
import { skillDisclosure } from "../src/decisions/skill-disclosure.ts";
import { swarmPatch } from "../src/decisions/swarm-patch.ts";
import { swarmRouting } from "../src/decisions/swarm-routing.ts";
import { taskFrame } from "../src/decisions/task-frame.ts";
import { toolAdmission, toolAdmissionBatch } from "../src/decisions/tool-admission.ts";
import { toolApproval } from "../src/decisions/tool-approval.ts";
import { toolConstraint } from "../src/decisions/tool-constraint.ts";
import { toolInjection, toolInjectionBatch } from "../src/decisions/tool-injection.ts";
import { toolRisk } from "../src/decisions/tool-risk.ts";
import { turnCompletion } from "../src/decisions/turn-completion.ts";
import { turnContinue } from "../src/decisions/turn-continue.ts";
import { turnDrift } from "../src/decisions/turn-drift.ts";
import { turnRewind } from "../src/decisions/turn-rewind.ts";
import { Judge } from "../src/judge.ts";
import { MemoryLedger } from "../src/ledger.ts";
import { isEscapeOption } from "../src/policy.ts";
import type { Answer, JsonValue, JudgeProvider, Questions } from "../src/types.ts";
import { POSITIVE_SPECS } from "./helpers/decision-coverage.ts";
import {
	ANSWER_FAULTS,
	FAULT_KINDS,
	FAULT_REASONS,
	FaultProvider,
	permissiveInput,
	questionsAreWellFormed,
	THROWING_FAULTS,
} from "./helpers/fault-providers.ts";

/**
 * The fail-open contract, over every decision point rather than the handful with a feature test.
 *
 * A judge that is slow, broken, rate limited or unsure must leave the agent on its deterministic fallback.
 * That is the premise the whole judgment layer is safe to ship on, so it is checked structurally: the
 * catalogue below is compared with the definitions on disk, and every entry runs the faults.
 */

/** A spec, viewed at the type level as an arbitrary decision, so one table can drive all of them. */
type AnyDecision = DecisionSpec<never, Questions, JsonValue>;

/**
 * Every decision point in `src/decisions/`, in the order the files are read. A new one fails the catalogue
 * test until it is added here, which is the point: the matrix cannot silently fall behind the tree.
 */
const CATALOGUE: readonly { readonly name: string; readonly spec: AnyDecision }[] = [
	{ name: "boardRead", spec: boardRead },
	{ name: "browserStep", spec: browserStep },
	{ name: "cacheWarming", spec: cacheWarming },
	{ name: "capabilityDisclosure", spec: capabilityDisclosure },
	{ name: "contextCompact", spec: contextCompact },
	{ name: "contextForget", spec: contextForget },
	{ name: "diagnosticsDelivery", spec: diagnosticsDelivery },
	{ name: "fileLocate", spec: fileLocate },
	{ name: "goalMet", spec: goalMet },
	{ name: "hivePublish", spec: hivePublish },
	{ name: "hiveDeliver", spec: hiveDeliver },
	{ name: "hiveRelate", spec: hiveRelate },
	{ name: "inputPreflight", spec: inputPreflight },
	{ name: "inputInterjection", spec: inputInterjection },
	{ name: "judgeItems", spec: judgeItems },
	{ name: "memoryRecall", spec: memoryRecall },
	{ name: "memoryRecallForTask", spec: memoryRecallForTask },
	{ name: "memoryCapture", spec: memoryCapture },
	{ name: "memoryOutcome", spec: memoryOutcome },
	{ name: "memoryWorth", spec: memoryWorth },
	{ name: "memoryMerge", spec: memoryMerge },
	{ name: "memoryApplied", spec: memoryApplied },
	{ name: "notifyRouting", spec: notifyRouting },
	{ name: "outputDrift", spec: outputDrift },
	{ name: "reviewTriage", spec: reviewTriage },
	{ name: "skillDisclosure", spec: skillDisclosure },
	{ name: "swarmPatch", spec: swarmPatch },
	{ name: "swarmRouting", spec: swarmRouting },
	{ name: "taskFrame", spec: taskFrame },
	{ name: "toolAdmission", spec: toolAdmission },
	{ name: "toolAdmissionBatch", spec: toolAdmissionBatch },
	{ name: "toolApproval", spec: toolApproval },
	{ name: "toolConstraint", spec: toolConstraint },
	{ name: "toolInjection", spec: toolInjection },
	{ name: "toolInjectionBatch", spec: toolInjectionBatch },
	{ name: "toolRisk", spec: toolRisk },
	{ name: "turnCompletion", spec: turnCompletion },
	{ name: "turnContinue", spec: turnContinue },
	{ name: "turnDrift", spec: turnDrift },
	{ name: "turnRewind", spec: turnRewind },
];

/**
 * Decision points whose questions are built from their input, so the permissive input does not produce a
 * question set a judge could be asked. They still get the throwing faults, which never reach an answer, and
 * their answer-shaped behaviour is covered where they are built and used.
 */
const NEEDS_A_REAL_INPUT: readonly string[] = [
	"capabilityDisclosure",
	"fileLocate",
	"judgeItems",
	"memoryApplied",
	"memoryMerge",
	"memoryRecall",
	"memoryRecallForTask",
	"memoryWorth",
	"outputDrift",
	"reviewTriage",
	"skillDisclosure",
	"toolAdmissionBatch",
	"toolConstraint",
	"toolInjectionBatch",
];

/** With no questions at all the engine abstains without asking anyone: no judge, no wait, no failure. */
const ASKS_NOTHING: readonly string[] = ["reviewTriage"];

const decisionsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "decisions");

/** Names the source tree declares, read from disk so the test does not have to import what it compares. */
function declaredDecisionNames(): string[] {
	const names: string[] = [];
	for (const file of readdirSync(decisionsDir).filter((entry) => entry.endsWith(".ts"))) {
		const text = readFileSync(join(decisionsDir, file), "utf8");
		for (const match of text.matchAll(/export const (\w+) = defineDecision/g)) names.push(match[1] ?? "");
	}
	return names.sort();
}

function questionsOf(spec: AnyDecision, input: unknown): Questions {
	const build = (spec as { questionsFor?: (value: never) => Questions }).questionsFor;
	return build ? build(input as never) : spec.questions;
}

/** Exactly what the mock provider would send if every question were answered confidently. */
function decisiveAnswers(questions: Questions): Record<string, Answer> {
	const answers: Record<string, Answer> = {};
	for (const [id, question] of Object.entries(questions)) {
		if (question.type === "boolean") answers[id] = { type: "boolean", probability: 0.99 };
		else if (question.type === "score") answers[id] = { type: "score", score: question.criteria.length - 1 };
		else {
			const options = Object.keys(question.criteria);
			const option = options.find((candidate) => !isEscapeOption(candidate)) ?? options[0] ?? "";
			const probabilities = Object.fromEntries(
				options.map((candidate) => [candidate, candidate === option ? 0.97 : 0.01 / options.length]),
			);
			answers[id] = { type: "choice", choice: option, probabilities };
		}
	}
	return answers;
}

function engineFor(provider: FaultProvider, mode: "active" | "shadow" = "active") {
	const ledger = new MemoryLedger();
	const engine = new DecisionEngine({ judge: new Judge({ provider, timeoutMs: 25 }), defaultMode: mode, ledger });
	return { engine, ledger };
}

const rejections: unknown[] = [];
const onRejection = (reason: unknown) => rejections.push(reason);

beforeAll(() => {
	// A fail-open path that fails by leaking a rejected promise would otherwise pass silently.
	process.on("unhandledRejection", onRejection);
});

afterAll(() => {
	process.off("unhandledRejection", onRejection);
});

afterEach(async () => {
	// Let any late rejection surface before the assertion, then drain so it is attributed to one test.
	await new Promise((resolve) => setTimeout(resolve, 0));
	const leaked = rejections.splice(0, rejections.length);
	expect(leaked).toEqual([]);
});

describe("decision point catalogue", () => {
	it("lists every decision point the tree declares", () => {
		expect(CATALOGUE.map((entry) => entry.name).sort()).toEqual(declaredDecisionNames());
	});

	it("declares unique ids, so the ledger can be read per decision", () => {
		const ids = CATALOGUE.map((entry) => entry.spec.id);
		const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
		// The batch variant of a decision shares its id: one ledger line per tool output either way, and the
		// same for the two recall questions, which read the same candidate list. The exports differ, which is
		// why the catalogue is keyed by name.
		expect(duplicates).toEqual(["memory.recall", "tool.admission", "tool.injection"]);
	});

	it("records which decision points the synthetic input cannot build a judge request for", () => {
		const unbuildable = CATALOGUE.filter(
			(entry) => !questionsAreWellFormed(questionsOf(entry.spec, permissiveInput())),
		).map((entry) => entry.name);
		expect(unbuildable.sort()).toEqual([...NEEDS_A_REAL_INPUT].sort());
	});
});

describe("throwing faults", () => {
	for (const entry of CATALOGUE) {
		it(`${entry.spec.id} falls back when the judge cannot answer`, async () => {
			const input = permissiveInput();
			for (const kind of THROWING_FAULTS) {
				const provider = new FaultProvider(kind);
				const { engine, ledger } = engineFor(provider);
				const decision = await engine.decide(entry.spec, input as never);
				const label = `${entry.spec.id} / ${kind}`;

				expect(decision.source, label).toBe("fallback");
				expect(ledger.records, label).toHaveLength(1);
				expect(ledger.records[0]?.source, label).toBe("fallback");
				// The fallback the spec declares is the outcome the caller gets, byte for byte.
				expect(decision.outcome, label).toEqual(ledger.records[0]?.outcome);

				if (provider.calls.length === 0) {
					// Nothing was asked: the engine must say so rather than report a failure that never happened.
					expect(ASKS_NOTHING, label).toContain(entry.name);
					expect(decision.reason, label).toBe("abstain");
					expect(ledger.records[0]?.reason, label).toBe("abstain");
					continue;
				}

				expect(provider.calls.length, label).toBeGreaterThan(0);
				expect(decision.reason, label).toBe(FAULT_REASONS[kind as keyof typeof FAULT_REASONS]);
				expect(decision.judged, label).toBeUndefined();
				expect(ledger.records[0]?.reason, label).toBe(FAULT_REASONS[kind as keyof typeof FAULT_REASONS]);
				expect(engine.stats.failures, label).toBe(1);
			}
		});
	}

	it("records the verdict but returns the fallback in shadow mode", async () => {
		const input = permissiveInput();
		for (const entry of CATALOGUE) {
			for (const kind of THROWING_FAULTS) {
				const provider = new FaultProvider(kind);
				const { engine, ledger } = engineFor(provider, "shadow");
				const decision = await engine.decide(entry.spec, input as never);
				const label = `${entry.spec.id} / ${kind}`;
				expect(decision.source, label).toBe("fallback");
				expect(ledger.records, label).toHaveLength(1);
				expect(decision.outcome, label).toEqual(ledger.records[0]?.outcome);
				const expected =
					provider.calls.length === 0 ? "abstain" : FAULT_REASONS[kind as keyof typeof FAULT_REASONS];
				expect(decision.reason, label).toBe(expected);
			}
		}
	});
});

describe("answer-shaped faults", () => {
	const usable = CATALOGUE.filter(
		(entry) =>
			!NEEDS_A_REAL_INPUT.includes(entry.name) && questionsAreWellFormed(questionsOf(entry.spec, permissiveInput())),
	);

	for (const entry of usable) {
		it(`${entry.spec.id} falls back on answers it cannot use`, async () => {
			const input = permissiveInput();
			const questions = questionsOf(entry.spec, input);
			const hasBoolean = Object.values(questions).some((question) => question.type === "boolean");
			for (const kind of ANSWER_FAULTS) {
				const provider = new FaultProvider(kind);
				const { engine, ledger } = engineFor(provider);
				const decision = await engine.decide(entry.spec, input as never);
				const label = `${entry.spec.id} / ${kind}`;

				expect(ledger.records, label).toHaveLength(1);
				expect(decision.outcome, label).toEqual(ledger.records[0]?.outcome);

				if (kind === "malformed" || (kind === "missing_probability" && hasBoolean)) {
					// An answer the judge declared but cannot be read: rejected before any policy runs, whether
					// the problem is the wrong type for the question or a boolean with no P(true) at all.
					expect(decision.source, label).toBe("fallback");
					expect(decision.reason, label).toBe("error:invalid_response");
				} else {
					// The answers are usable, so the policy decides: either a verdict or an abstention. Both are
					// deterministic and neither is an error. Choosing an option with no distribution is B2's
					// question, so this asserts only that the engine neither crashes nor invents a failure.
					expect(decision.reason ?? "judged", label).not.toMatch(/^error:/);
					if (decision.source === "fallback") expect(decision.reason, label).toBe("abstain");
				}
			}
		});

		it(`${entry.spec.id} decides the same way twice on a boundary answer`, async () => {
			const input = permissiveInput();
			const runs = [];
			for (let attempt = 0; attempt < 2; attempt++) {
				const provider = new FaultProvider("boundary");
				const { engine } = engineFor(provider);
				runs.push(await engine.decide(entry.spec, input as never));
			}
			expect(runs[1]?.outcome).toEqual(runs[0]?.outcome);
			expect(runs[1]?.source).toBe(runs[0]?.source);
			expect(runs[1]?.reason).toBe(runs[0]?.reason);
		});
	}
});

describe("a judged answer reaches the caller exactly as the policy decided", () => {
	for (const entry of CATALOGUE) {
		if (NEEDS_A_REAL_INPUT.includes(entry.name)) continue;
		it(`${entry.spec.id} applies its policy`, async () => {
			const input = permissiveInput();
			const answers = decisiveAnswers(questionsOf(entry.spec, input));
			const expected = entry.spec.policy(answers as never, input as never);
			const answering: JudgeProvider = {
				id: "decisive",
				evaluate: async () => ({ answers, usage: { inputTokens: 0, outputTokens: 0 }, modelId: "decisive" }),
			};
			const ledger = new MemoryLedger();
			const engine = new DecisionEngine({
				judge: new Judge({ provider: answering }),
				defaultMode: "active",
				ledger,
			});
			const decision = await engine.decide(entry.spec, input as never);

			if (expected === ABSTAIN) {
				expect(decision.source).toBe("fallback");
				expect(decision.reason).toBe("abstain");
				expect(engine.stats.abstentions).toBe(1);
			} else {
				expect(decision.source).toBe("judge");
				expect(decision.outcome).toEqual(expected);
				expect(decision.judged).toEqual(expected);
				expect(decision.reason).toBeUndefined();
			}
			expect(ledger.records).toHaveLength(1);
		});
	}
});

describe("defineDecision", () => {
	it("refuses a decision point with no fallback, before it can be used", () => {
		const incomplete = {
			id: "test.no_fallback",
			version: 1,
			cacheImpact: "none",
			latency: "inline",
			questions: { ok: { type: "boolean", instructions: "?" } },
			buildState: () => "state",
			policy: () => "none",
		};
		expect(() => defineDecision(incomplete as unknown as AnyDecision)).toThrow(/fallback/);
	});

	it("refuses a decision point with no policy", () => {
		const incomplete = {
			id: "test.no_policy",
			version: 1,
			cacheImpact: "none",
			latency: "inline",
			questions: { ok: { type: "boolean", instructions: "?" } },
			buildState: () => "state",
			fallback: () => "none",
		};
		expect(() => defineDecision(incomplete as unknown as AnyDecision)).toThrow(/policy/);
	});
});

describe("the matrix itself", () => {
	it("covers all seven faults and classifies every decision point", () => {
		expect(FAULT_KINDS).toHaveLength(7);
		// The two groups partition the seven: every fault is exercised, by exactly one kind of provider.
		expect([...THROWING_FAULTS, ...ANSWER_FAULTS].sort()).toEqual([...FAULT_KINDS].sort());
		expect(ANSWER_FAULTS).toHaveLength(4);
		const unclassified = CATALOGUE.filter(
			(entry) =>
				!NEEDS_A_REAL_INPUT.includes(entry.name) &&
				!questionsAreWellFormed(questionsOf(entry.spec, permissiveInput())),
		);
		expect(unclassified.map((entry) => entry.name)).toEqual([]);
	});

	it("has a positive case for every decision point that needs a real input", () => {
		// The matrix covers the failing side of all of them. The points whose questions come from their input
		// cannot be exercised by the synthetic input, so each needs a positive case somewhere: the two
		// decision-positives test files cover the list in `helpers/decision-coverage.ts`, and this asserts the
		// two lists agree. A new list-shaped point fails here until it has both.
		expect([...NEEDS_A_REAL_INPUT].sort()).toEqual([...POSITIVE_SPECS].sort());
	});
});
