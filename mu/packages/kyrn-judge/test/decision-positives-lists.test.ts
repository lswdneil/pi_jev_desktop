import { describe, expect, it } from "vitest";
import { DecisionEngine } from "../src/decision.ts";
import { fileLocate } from "../src/decisions/file-locate.ts";
import { judgeItems } from "../src/decisions/judge-items.ts";
import {
	type Lesson,
	memoryApplied,
	memoryMerge,
	memoryRecall,
	memoryRecallForTask,
	memoryWorth,
} from "../src/decisions/memory.ts";
import { Judge } from "../src/judge.ts";
import { MockJudgeProvider } from "../src/providers/mock.ts";
import type { Answer, JudgeRequest } from "../src/types.ts";

/**
 * Positive cases for the list-shaped decision points: each builds one question per candidate, so the answers
 * that decide something are worth a test of their own. `fault-injection.test.ts` covers the failing side.
 */

function engineFor(responder: (request: JudgeRequest) => Readonly<Record<string, Answer>>): DecisionEngine {
	return new DecisionEngine({
		judge: new Judge({ provider: new MockJudgeProvider(responder) }),
		defaultMode: "active",
	});
}

const yes = (): Answer => ({ type: "boolean", probability: 0.95 });
const no = (): Answer => ({ type: "boolean", probability: 0.05 });
const unsure = (): Answer => ({ type: "boolean", probability: 0.5 });
const pick = (choice: string): Answer => ({ type: "choice", choice, probabilities: { [choice]: 0.95 } });

const LESSONS: readonly Lesson[] = [
	{ id: "vitest-watch", trigger: "the test command in this project", lesson: "run vitest, not jest" },
	{ id: "pnpm", trigger: "installing dependencies", lesson: "this project uses npm workspaces" },
];

describe("recalling lessons", () => {
	it("injects the lessons the judge is sure apply to the message", async () => {
		const engine = engineFor(() => ({ lesson_0: yes(), lesson_1: no() }));
		const decision = await engine.decide(memoryRecall, { userMessage: "run the tests", lessons: LESSONS });
		expect(decision.outcome).toEqual({ apply: ["vitest-watch"] });
	});

	it("injects nothing on an unsure answer: that lesson is not brought into the turn", async () => {
		const engine = engineFor(() => ({ lesson_0: unsure(), lesson_1: unsure() }));
		expect((await engine.decide(memoryRecall, { userMessage: "usual work", lessons: LESSONS })).outcome).toEqual({
			apply: [],
		});
	});

	it("asks the same question of a sub-agent's task, and says the state is a task", async () => {
		const engine = engineFor(() => ({ lesson_0: no(), lesson_1: yes() }));
		const decision = await engine.decide(memoryRecallForTask, {
			task: "install dependencies and build",
			lessons: LESSONS,
		});
		expect(decision.outcome).toEqual({ apply: ["pnpm"] });
		expect(decision.specId).toBe("memory.recall");
		// The questions came from the task's lesson list, one per lesson: the answers say which were asked.
		expect(Object.keys(decision.answers ?? {})).toEqual(["lesson_0", "lesson_1"]);
	});
});

describe("deciding whether a lesson is worth keeping", () => {
	it("keeps only what will help again later", async () => {
		const engine = engineFor(() => ({ worth_1: pick("reusable"), worth_2: pick("one_off") }));
		const decision = await engine.decide(memoryWorth, {
			lessons: [
				{ trigger: "a vitest assertion differs only in object key order", lesson: "compare sorted keys first" },
				{ trigger: "this one run of the migration", lesson: "it took four minutes" },
			],
			projectInstructions: "Run the tests with npm test.",
		});
		expect(decision.outcome).toEqual(["reusable", "one_off"]);
	});

	it("reads an escape option as unclear, so nothing is stored", async () => {
		const engine = engineFor(() => ({ worth_1: pick("unclear") }));
		expect(
			(
				await engine.decide(memoryWorth, {
					lessons: [{ trigger: "something", lesson: "something else" }],
					projectInstructions: "",
				})
			).outcome,
		).toEqual(["unclear"]);
	});
});

describe("merging a candidate with what is kept", () => {
	it("reports same, refines, contradicts and unrelated per kept lesson", async () => {
		const engine = engineFor(() => ({
			merge_1: pick("same"),
			merge_2: pick("refines"),
			merge_3: pick("contradicts"),
			merge_4: pick("unrelated"),
		}));
		const decision = await engine.decide(memoryMerge, {
			candidate: { trigger: "running tests", lesson: "use vitest --run" },
			existing: [
				{ id: "a", trigger: "running tests", lesson: "use vitest" },
				{ id: "b", trigger: "running tests", lesson: "use vitest --run --reporter=dot" },
				{ id: "c", trigger: "running tests", lesson: "use jest" },
				{ id: "d", trigger: "installing", lesson: "use npm" },
			],
		});
		expect(decision.outcome).toEqual(["same", "refines", "contradicts", "unrelated"]);
	});
});

describe("did the agent follow the lessons", () => {
	it("separates the ones it did from the ones it did not, and leaves an unsure one in neither", async () => {
		const engine = engineFor(() => ({ applied_1: yes(), applied_2: no(), applied_3: unsure() }));
		const decision = await engine.decide(memoryApplied, {
			lessons: [...LESSONS, { id: "style", trigger: "committing", lesson: "one commit per change" }],
			turnDigest: "user: run the tests\nassistant: npm test (jest) — 3 failures",
		});
		expect(decision.outcome).toEqual({ applied: ["vitest-watch"], notApplied: ["pnpm"] });
	});
});

describe("file location", () => {
	it("ranks the candidates by the probability the judge gave each", async () => {
		const engine = engineFor(() => ({ path_0: no(), path_1: yes(), path_2: unsure() }));
		const decision = await engine.decide(fileLocate, {
			query: "where the judge consent is written",
			paths: ["src/config.ts", "src/consent.ts", "src/quota.ts"],
		});
		expect(decision.outcome).toEqual({
			ranked: [
				{ path: "src/consent.ts", probability: 0.95 },
				{ path: "src/quota.ts", probability: 0.5 },
				{ path: "src/config.ts", probability: 0.05 },
			],
		});
	});
});

describe("judge_items", () => {
	it("gives the probability of yes for every item, in order", async () => {
		const engine = engineFor(() => ({ q1: yes(), q2: no(), q3: unsure() }));
		const decision = await engine.decide(judgeItems, {
			question: "is this test about login?",
			context: "the auth suite",
			items: ["auth.login.test.ts", "billing.invoice.test.ts", "auth.logout.test.ts"],
		});
		expect(decision.outcome).toEqual([0.95, 0.05, 0.5]);
	});
});
