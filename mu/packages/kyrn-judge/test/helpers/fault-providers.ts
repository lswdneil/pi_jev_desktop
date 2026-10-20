import { JudgeError } from "../../src/errors.ts";
import { isEscapeOption, neutralAnswer } from "../../src/policy.ts";
import type {
	Answer,
	BooleanAnswer,
	ChoiceAnswer,
	JudgeProvider,
	JudgeRequest,
	ProviderResponse,
	Question,
	Questions,
} from "../../src/types.ts";

/**
 * The seven ways a judge can fail, as providers the decision engine can be pointed at.
 *
 * Every one of them must end in the spec's fallback: the kernel's promise is that a judge that is slow,
 * broken, or unsure changes nothing about what the agent does. `FAULT_REASONS` is what the engine has to
 * report for the faults that carry a classification; the answer-shaped ones are judged per question below.
 */
export type FaultKind = "timeout" | "server" | "malformed" | "missing_probability" | "boundary" | "abstain" | "quota";

export const FAULT_KINDS: readonly FaultKind[] = [
	"timeout",
	"server",
	"malformed",
	"missing_probability",
	"boundary",
	"abstain",
	"quota",
];

const THROWING: readonly FaultKind[] = ["timeout", "server", "quota"];

/** Faults where the provider never delivers answers, so the outcome does not depend on the decision's input. */
export const THROWING_FAULTS: readonly FaultKind[] = FAULT_KINDS.filter((kind) => THROWING.includes(kind));

/** Faults carried by the answers themselves, so they only mean something for a well-formed question set. */
export const ANSWER_FAULTS: readonly FaultKind[] = FAULT_KINDS.filter((kind) => !THROWING.includes(kind));

/** What the ledger and the decision must say for a throwing fault. */
export const FAULT_REASONS: Readonly<Record<"timeout" | "server" | "quota", string>> = {
	timeout: "error:timeout",
	server: "error:server",
	quota: "error:quota",
};

/** A provider that records what it was asked and fails in the requested way. */
export class FaultProvider implements JudgeProvider {
	readonly id: string;
	readonly calls: JudgeRequest[] = [];
	private readonly kind: FaultKind;

	constructor(kind: FaultKind) {
		this.kind = kind;
		this.id = `fault:${kind}`;
	}

	async evaluate(request: JudgeRequest): Promise<ProviderResponse> {
		this.calls.push(request);
		switch (this.kind) {
			case "timeout":
				return neverAnswers(request);
			case "server":
				throw new JudgeError("server", "fault: the judge answered 500", { status: 500 });
			case "quota":
				throw new JudgeError("quota", "fault: the budget for remote judges is spent");
			default:
				return {
					answers: answersFor(request.questions, this.kind),
					usage: { inputTokens: 0, outputTokens: 0 },
					modelId: this.id,
				};
		}
	}
}

/**
 * Never answers. The engine's own deadline is what has to end the wait; the safety timer only exists so a
 * broken deadline shows up as a failed assertion instead of a test that hangs.
 */
function neverAnswers(request: JudgeRequest): Promise<ProviderResponse> {
	return new Promise((_resolve, reject) => {
		const safety = setTimeout(
			() => reject(new JudgeError("unreachable", "fault: the provider never answered")),
			2000,
		);
		const abort = () => {
			clearTimeout(safety);
			reject(new JudgeError("aborted", "fault: the provider was abandoned"));
		};
		if (request.signal?.aborted) abort();
		else request.signal?.addEventListener("abort", abort, { once: true });
	});
}

function answersFor(
	questions: Questions,
	kind: Exclude<FaultKind, "timeout" | "server" | "quota">,
): Record<string, Answer> {
	const answers: Record<string, Answer> = {};
	for (const [id, question] of Object.entries(questions)) answers[id] = answerFor(question, kind);
	return answers;
}

function answerFor(question: Question, kind: "malformed" | "missing_probability" | "boundary" | "abstain"): Answer {
	if (kind === "abstain") return neutralAnswer(question);
	if (kind === "boundary") return boundaryAnswer(question);
	if (kind === "missing_probability") return missingProbabilityAnswer(question);
	return malformedAnswer(question);
}

/** Every answer has the wrong type for its question: what a provider returning English prose would produce. */
function malformedAnswer(question: Question): Answer {
	if (question.type === "boolean") return { type: "score", score: 0 };
	if (question.type === "choice") return { type: "choice", choice: "not-an-option" };
	return { type: "boolean", probability: 0.5 };
}

/**
 * A boolean answer with no probability. The field is required, so this is the provider forgetting it rather
 * than a validator dropping it; the kernel must reject it instead of reading `undefined` as a number.
 */
function missingProbabilityAnswer(question: Question): Answer {
	if (question.type === "boolean") return { type: "boolean" } as unknown as BooleanAnswer;
	return neutralAnswer(question);
}

/**
 * Exactly on every threshold: 0.5 for a boolean, the middle level for a score, the weakest non-escape option
 * at 0.5. Whatever a policy does here it has to do the same on the next run.
 */
function boundaryAnswer(question: Question): Answer {
	if (question.type === "boolean") return { type: "boolean", probability: 0.5 };
	if (question.type === "score") return { type: "score", score: (question.criteria.length - 1) / 2 };
	const options = Object.keys(question.criteria);
	const option = options.find((candidate) => !isEscapeOption(candidate)) ?? options[0] ?? "";
	return { type: "choice", choice: option, probabilities: { [option]: 0.5 } } satisfies ChoiceAnswer;
}

/**
 * An input that exists only so `buildState` and `fallback` can run: the matrix is about what happens after
 * the judge is asked, and a decision point's own input is exercised by its feature's tests.
 *
 * Array-ish reads hand back one element (so `questionsFor` builds a real question) and everything else is a
 * permissive object, which is enough for the `buildState`/`fallback` of every decision point in the tree.
 */
export function permissiveInput(): unknown {
	const fake = new Proxy(function fakeInput() {}, {
		get(_target, property: string | symbol) {
			if (property === Symbol.toPrimitive) return () => 0;
			if (property === Symbol.iterator) return function* empty() {};
			if (property === "length") return 0;
			if (property === "then") return undefined;
			if (property === "toJSON") return () => ({});
			if (property === "toString") return () => "";
			if (property === "valueOf") return () => 0;
			if (property === "map" || property === "filter") return () => [fake];
			if (["slice", "concat", "flatMap", "find", "includes", "indexOf"].includes(String(property))) return () => [];
			return fake;
		},
	});
	return fake;
}

/** A question is usable by the matrix when the judge request built from it can be validated at all. */
export function questionsAreWellFormed(questions: Questions): boolean {
	const entries = Object.entries(questions);
	if (entries.length === 0) return false;
	return entries.every(([, question]) => {
		const type = (question as { type?: unknown }).type;
		return type === "boolean" || type === "choice" || type === "score";
	});
}
