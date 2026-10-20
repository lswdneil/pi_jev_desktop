import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { JUDGE_CONSENT_ENV, judgeConsentState, writeJudgeConsent } from "../src/consent.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-headless-"));
	dirs.push(dir);
	return dir;
}

/**
 * A machine with no terminal: CI, a container, the desktop app's child process. Nothing here may wait for
 * an answer, and every path has to be reachable from the environment alone.
 */
describe("headless (no TTY) paths", () => {
	it("never asks for consent interactively: the hint names both non-interactive ways to give it", () => {
		const state = judgeConsentState(agentDir(), {});
		expect(state.consented).toBe(false);
		expect(state.grantHint).toContain(JUDGE_CONSENT_ENV);
		expect(state.grantHint).toContain("judge consent accept");
		expect(state.grantHint).toMatch(/no TTY|headless|never|asks first/i);
	});

	it("accepts the environment grant without touching the disk", () => {
		const dir = agentDir();
		expect(judgeConsentState(dir, { [JUDGE_CONSENT_ENV]: "1" }).consented).toBe(true);
		expect(judgeConsentState(dir, { [JUDGE_CONSENT_ENV]: "0" }).consented).toBe(false);
		expect(judgeConsentState(dir, { [JUDGE_CONSENT_ENV]: " 1 " }).consented).toBe(true);
	});

	it("turns the whole judge off from the environment, whether or not consent exists", () => {
		const dir = agentDir();
		writeJudgeConsent(dir);
		const loaded = loadConfig({ env: { SPEC_AI_JEV_JUDGE: "off", [JUDGE_CONSENT_ENV]: "1" } });
		// Off wins over both: nothing is asked, nothing is sent, no prompt is waiting on a terminal that is not there.
		expect(loaded.disabled).toBe(true);
		expect(judgeConsentState(dir, { SPEC_AI_JEV_JUDGE: "off" }).consented).toBe(true);
	});
});
