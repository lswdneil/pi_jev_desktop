import type { TestLogStrategy, TestLogWording } from "../../kyrn-judge/src/admission/test-log.ts";
import { MockJudgeProvider } from "../../kyrn-judge/src/providers/mock.ts";
import type { Answer, JudgeProvider, JudgeRequest } from "../../kyrn-judge/src/types.ts";
import type { TestLogCase } from "../../kyrn-judge/test/fixtures/test-log-cases.ts";

/**
 * The arms a replay compares. One arm is a strategy (how the log is rendered) plus, for the arms that
 * judge, the provider that answers.
 *
 * - `full`: the whole log, untouched. What the model reads without any admission.
 * - `rules`: the deterministic selection, no judge. The floor mu always has, and the arm a change must not
 *   make worse.
 * - `ceiling`: a judge that omits everything. What the protections alone guarantee, whatever a model says.
 * - `oracle`: a judge that reads the labels. The best a correct judge could do — if this arm loses evidence,
 *   the labels are wrong rather than the code.
 * - `jev…`: the real model, only when a key is configured.
 */
export interface Arm {
	readonly name: string;
	readonly strategy: TestLogStrategy;
	readonly provider?: JudgeProvider;
	readonly wording?: TestLogWording;
	readonly anchors?: boolean;
	/** Told which case is being replayed, for an arm that answers from the labels. */
	readonly prepare?: (testCase: TestLogCase, units: ReadonlyMap<string, string>) => void;
}

function omitAnswer(question: JudgeRequest["questions"][string], omit: boolean): Answer {
	if (question.type !== "choice") throw new Error(`unexpected ${question.type} question`);
	const [keep, drop] = "omit" in question.criteria ? ["keep", "omit"] : ["needed", "not_needed"];
	const choice = omit ? drop : keep;
	return { type: "choice", choice, probabilities: { [choice]: 0.99 } };
}

/** Says "omit" to every question: the arm that proves the protections, not the judge, keep evidence. */
export function ceilingProvider(): JudgeProvider {
	return new MockJudgeProvider(
		(request) =>
			Object.fromEntries(
				Object.entries(request.questions).map(([id, question]) => [id, omitAnswer(question, true)]),
			),
		"ceiling",
	);
}

/**
 * Answers from the case's labels: "needed" exactly when the candidate unit holds a required substring.
 * `prepare` is what makes it replayable case by case without the module-level state the spike carried.
 */
export class OracleProvider implements JudgeProvider {
	readonly id = "oracle";
	private testCase: TestLogCase | undefined;
	private units: ReadonlyMap<string, string> = new Map();

	prepare(testCase: TestLogCase, units: ReadonlyMap<string, string>): void {
		this.testCase = testCase;
		this.units = units;
	}

	async evaluate(request: JudgeRequest): Promise<{
		answers: Readonly<Record<string, Answer>>;
		usage: { inputTokens: number; outputTokens: number };
		modelId: string;
	}> {
		const answers: Record<string, Answer> = {};
		for (const [id, question] of Object.entries(request.questions)) {
			const text = this.units.get(id) ?? "";
			const needed = (this.testCase?.required ?? []).some((required) => text.includes(required));
			answers[id] = omitAnswer(question, !needed);
		}
		return { answers, usage: { inputTokens: 0, outputTokens: 0 }, modelId: this.id };
	}
}

/** An oracle bound to its arm, so the replay can call `prepare` without knowing it is an oracle. */
export function oracleArm(): Arm {
	const oracle = new OracleProvider();
	return {
		name: "oracle",
		strategy: "jev",
		provider: oracle,
		prepare: (testCase, units) => oracle.prepare(testCase, units),
	};
}

/** The arms that need nothing but this repository, in the order they are reported. */
export function offlineArms(): Arm[] {
	return [
		{ name: "full", strategy: "full" },
		{ name: "rules", strategy: "rules" },
		{ name: "ceiling", strategy: "jev", provider: ceilingProvider() },
		oracleArm(),
	];
}

export const WORDINGS: readonly TestLogWording[] = ["suffices", "policy"];

/** The live arms, for `--judge`: one per wording and anchor mode, all behind the same counted provider. */
export function liveArms(
	provider: JudgeProvider,
	wordings: readonly TestLogWording[],
	anchorModes: readonly boolean[],
): Arm[] {
	const arms: Arm[] = [];
	for (const anchors of anchorModes) {
		for (const wording of wordings) {
			arms.push({
				name: `jev:${wording}${anchors ? "" : ":no-anchors"}`,
				strategy: "jev",
				provider,
				wording,
				anchors,
			});
		}
	}
	return arms;
}

/** A provider that refuses to exceed a request budget, so a nightly run cannot spend by accident. */
export function counted(provider: JudgeProvider, maxRequests: number): JudgeProvider & { requests: number } {
	const wrapper = {
		id: provider.id,
		requests: 0,
		evaluate: async (request: JudgeRequest) => {
			wrapper.requests++;
			if (wrapper.requests > maxRequests) throw new Error(`request budget of ${maxRequests} reached`);
			return provider.evaluate(request);
		},
	};
	return wrapper;
}
