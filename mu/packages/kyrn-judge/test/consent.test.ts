import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import {
	CONSENT_SCOPE,
	JUDGE_CONSENT_VERSION,
	judgeConsentState,
	readJudgeConsent,
	revokeJudgeConsent,
	writeJudgeConsent,
} from "../src/consent.ts";
import type { JudgeError } from "../src/errors.ts";
import type { ClassifierCall } from "../src/providers/classifier.ts";
import { buildJudge } from "../src/registry.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-consent-"));
	dirs.push(dir);
	return dir;
}

/** Counting stand-ins: "no request" is proven by these staying at zero, not by an error message. */
function countingClassifier() {
	let calls = 0;
	const classify = (): ClassifierCall => async () => {
		calls++;
		return {
			answers: { greet: { type: "bool", probability: 0.9 } },
			usage: { input: 10, output: 2 },
			stopReason: "stop",
		};
	};
	return { classify, calls: () => calls };
}

const questions = { greet: { type: "boolean", instructions: "Is this a greeting?" } } as const;

/** The keyless default: tiers `jev`, a classifier model available, no key for any of Jev's services. */
function freeJev(classification: ReturnType<typeof countingClassifier>) {
	return buildJudge(
		{ ...loadConfig({ env: {} }).config, tiers: ["jev"] },
		{
			classify: () => classification.classify(),
			env: {},
			consent: judgeConsentState(undefined, {}),
		},
	);
}

describe("judge consent", () => {
	it("without consent the keyless default judge makes no request at all", async () => {
		const classifier = countingClassifier();
		const { judge } = freeJev(classifier);
		await expect(judge.evaluate({ state: "hello", questions })).rejects.toMatchObject({
			kind: "auth",
		});
		expect(classifier.calls()).toBe(0);
	});

	it("with consent the same call goes through once", async () => {
		const classifier = countingClassifier();
		const dir = agentDir();
		writeJudgeConsent(dir, { agreedAt: new Date("2026-10-18T00:00:00Z") });
		const { judge } = buildJudge(
			{ ...loadConfig({ env: {} }).config, tiers: ["jev"] },
			{ classify: () => classifier.classify(), env: {}, consent: judgeConsentState(dir, {}) },
		);

		const result = await judge.evaluate({ state: "hello", questions });
		expect(classifier.calls()).toBe(1);
		expect(result.answers.greet).toMatchObject({ type: "boolean", probability: 0.9 });
	});

	it("consent given by the environment covers a headless run", async () => {
		const classifier = countingClassifier();
		const state = judgeConsentState(undefined, { MU_JUDGE_CONSENT: "1" });
		expect(state.consented).toBe(true);
		const { judge } = buildJudge(
			{ ...loadConfig({ env: {} }).config, tiers: ["jev"] },
			{ classify: () => classifier.classify(), env: {}, consent: state },
		);
		await judge.evaluate({ state: "hello", questions });
		expect(classifier.calls()).toBe(1);
	});

	it("revoking it stops the requests again", async () => {
		const dir = agentDir();
		writeJudgeConsent(dir);
		expect(judgeConsentState(dir, {}).consented).toBe(true);
		expect(revokeJudgeConsent(dir)).toBe(true);
		expect(judgeConsentState(dir, {}).consented).toBe(false);

		const classifier = countingClassifier();
		const { judge } = buildJudge(
			{ ...loadConfig({ env: {} }).config, tiers: ["jev"] },
			{ classify: () => classifier.classify(), env: {}, consent: judgeConsentState(dir, {}) },
		);
		await expect(judge.evaluate({ state: "hello", questions })).rejects.toBeDefined();
		expect(classifier.calls()).toBe(0);
	});

	it("a file written for an older notice counts as no consent", () => {
		const dir = agentDir();
		writeFileSync(
			join(dir, "consent.json"),
			JSON.stringify({
				judgeId: "jev",
				consentVersion: 0,
				agreedAt: "2026-01-01T00:00:00.000Z",
				scope: CONSENT_SCOPE,
			}),
		);
		expect(readJudgeConsent(dir)).toBeUndefined();
		expect(judgeConsentState(dir, {}).consented).toBe(false);
	});

	it("writes owner-only, versioned, and says how to agree when there is no consent", () => {
		const dir = agentDir();
		const consent = writeJudgeConsent(dir, { agreedAt: new Date("2026-10-18T12:00:00Z") });
		const written = JSON.parse(readFileSync(join(dir, "consent.json"), "utf8")) as typeof consent;
		expect(written).toEqual(consent);
		expect(consent.consentVersion).toBe(JUDGE_CONSENT_VERSION);
		expect(consent.scope).toBe(CONSENT_SCOPE);

		const hint = judgeConsentState(agentDir(), {}).grantHint;
		expect(hint).toContain("MU_JUDGE_CONSENT=1");
	});

	it("MU_JUDGE=off wins over an existing consent", () => {
		const dir = agentDir();
		writeJudgeConsent(dir);
		const loaded = loadConfig({ env: { MU_JUDGE: "off" } });
		expect(loaded.disabled).toBe(true);
		// The factory turns a disabled run into the mock judge in off mode; loadConfig only reports the switch.
		expect(judgeConsentState(dir, { MU_JUDGE: "off" }).consented).toBe(true);
	});

	it("a configured judge is its own consent: the gate only guards the keyless default", async () => {
		// Tiers without a remote default: a mock judge answers even with no consent, because nothing leaves the machine.
		const { judge } = buildJudge(
			{ ...loadConfig({ env: {} }).config, tiers: ["mock"] },
			{ env: {}, consent: judgeConsentState(undefined, {}) },
		);
		const result = await judge.evaluate({ state: "hello", questions });
		expect(result.providerId).toContain("mock");
	});
});

describe("consent error", () => {
	it("is an auth failure, which the cascade reports as lasting: the next call fails the same way", async () => {
		const classifier = countingClassifier();
		const { judge } = freeJev(classifier);
		await judge
			.evaluate({ state: "hello", questions })
			.catch((error: JudgeError) => {
				expect(error.kind).toBe("auth");
				expect(error.message).toContain("consent");
			})
			.finally(() => undefined);
	});
});
