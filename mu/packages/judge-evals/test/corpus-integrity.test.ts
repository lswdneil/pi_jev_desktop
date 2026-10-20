import { describe, expect, it } from "vitest";
import { heldOutCases, type TestLogCase, testLogCases } from "../../kyrn-judge/test/fixtures/test-log-cases.ts";

/**
 * The corpus is committed data, so its own invariants are worth checking: the labels have to be real
 * substrings of the log, nothing private may have survived sanitising, and the held-out set has to stay
 * held out.
 */

const ALL: readonly TestLogCase[] = testLogCases;

/** Absolute paths, home directories, Windows drive letters and hostnames: what sanitising has to remove. */
const PRIVATE_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
	{ name: "posix home", pattern: /(^|[\s"'(])\/(Users|home)\/[A-Za-z0-9._-]+/ },
	{ name: "windows drive", pattern: /[A-Za-z]:\\{1,2}[A-Za-z0-9._-]+/ },
	{ name: "internal host", pattern: /\b[a-z0-9-]+\.(local|internal|corp|lan)\b/i },
	{ name: "unix user prompt", pattern: /\b[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/ },
];

/** Shapes only a credential has. A corpus with one of these in it is a leak, not a test fixture. */
const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
	{ name: "openai key", pattern: /\bsk-[A-Za-z0-9]{16,}/ },
	{ name: "github token", pattern: /\bghp_[A-Za-z0-9]{20,}/ },
	{ name: "aws key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
	{ name: "assignment", pattern: /\b(AI_GATEWAY_API_KEY|TYPESAFE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)=\S+/ },
];

describe("corpus integrity", () => {
	it("carries no private path, host or user name", () => {
		const leaks: string[] = [];
		for (const testCase of ALL) {
			for (const { name, pattern } of PRIVATE_PATTERNS) {
				if (pattern.test(testCase.output) || pattern.test(testCase.goal) || pattern.test(testCase.intent)) {
					leaks.push(`${testCase.id}: ${name}`);
				}
			}
		}
		expect(leaks).toEqual([]);
	});

	it("carries no credential shape", () => {
		const leaks: string[] = [];
		for (const testCase of ALL) {
			for (const { name, pattern } of SECRET_PATTERNS) {
				if (pattern.test(testCase.output)) leaks.push(`${testCase.id}: ${name}`);
			}
		}
		expect(leaks).toEqual([]);
	});

	it("labels substrings that are actually in the log", () => {
		const broken: string[] = [];
		for (const testCase of ALL) {
			for (const required of testCase.required) {
				if (!testCase.output.includes(required))
					broken.push(`${testCase.id}: required ${JSON.stringify(required.slice(0, 40))}`);
			}
			for (const optional of testCase.optional) {
				if (!testCase.output.includes(optional))
					broken.push(`${testCase.id}: optional ${JSON.stringify(optional.slice(0, 40))}`);
			}
			if (testCase.required.length === 0) broken.push(`${testCase.id}: no required label, so nothing can be lost`);
		}
		expect(broken).toEqual([]);
	});

	it("gives every case a unique id and a runner to talk about", () => {
		const ids = ALL.map((testCase) => testCase.id);
		expect(new Set(ids).size).toBe(ids.length);
		// The corpus is only representative if it holds more than one runner's output shape.
		const calls = ALL.map((testCase) => testCase.call).join("\n");
		expect(calls).toMatch(/vitest/);
		expect(calls).toMatch(/pytest/);
		expect(calls).toMatch(/node/);
	});

	it("keeps the held-out cases out of the tuned set", () => {
		expect(heldOutCases.length).toBeGreaterThan(0);
		const heldOutIds = new Set(heldOutCases.map((testCase) => testCase.id));
		const tuned = testLogCases.filter((testCase) => !heldOutCases.includes(testCase));
		expect(tuned.some((testCase) => heldOutIds.has(testCase.id))).toBe(false);
		// The held-out set is only worth having if the same logs also appear tuned: it is the goal that is new.
		expect(heldOutCases.length).toBeLessThan(testLogCases.length);
	});
});
