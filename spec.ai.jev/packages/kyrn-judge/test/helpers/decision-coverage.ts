/**
 * The decision points whose questions are built from their input, and which therefore need a real input before a
 * positive case can be written. `fault-injection.test.ts` covers every decision point's failing side; the
 * positive side for these lives in `decision-positives.test.ts` and `decision-positives-lists.test.ts`.
 *
 * The list is here rather than in either test file so the matrix can require it: a new list-shaped decision
 * point that nobody classified fails the matrix until it is added here **and** has a positive case.
 */
export const POSITIVE_SPECS: readonly string[] = [
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
