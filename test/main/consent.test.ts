// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import {
	CONSENT_ENV,
	CONSENT_JUDGE_ID,
	CONSENT_SCOPE,
	CONSENT_VERSION,
	consentState,
	readConsent,
	runConsentCommand,
} from "../../src/main/consent.ts";
import { FakeProcess } from "./fakes.ts";

/**
 * Consent: read the kernel's file (and only accept a record that matches the notice), and grant it by running the
 * harness's own command rather than writing a second copy of the format.
 */

function record(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		judgeId: CONSENT_JUDGE_ID,
		consentVersion: CONSENT_VERSION,
		agreedAt: "2026-10-18T09:00:00.000Z",
		scope: CONSENT_SCOPE,
		...overrides,
	});
}

const FILE = "/home/ada/.spec.ai.jev/agent/consent.json";

describe("reading the consent file", () => {
	it("accepts a record the kernel would accept", () => {
		expect(readConsent(FILE, () => record())).toEqual({
			judgeId: "jev",
			consentVersion: 1,
			agreedAt: "2026-10-18T09:00:00.000Z",
			scope: "remote-judge",
		});
	});

	it("refuses a record for another judge, another notice version or another scope", () => {
		for (const wrong of [
			{ judgeId: "other" },
			{ consentVersion: CONSENT_VERSION + 1 },
			{ scope: "telemetry" },
			{ agreedAt: undefined },
		]) {
			expect(readConsent(FILE, () => record(wrong))).toBeUndefined();
		}
	});

	it("refuses a missing or unreadable file", () => {
		expect(readConsent(FILE, () => {
			throw new Error("ENOENT");
		})).toBeUndefined();
		expect(readConsent(FILE, () => "not json")).toBeUndefined();
		expect(readConsent(FILE, () => "null")).toBeUndefined();
	});
});

describe("the state the screen shows", () => {
	it("is granted when the file says so", () => {
		const state = consentState(FILE, {}, () => record());
		expect(state).toMatchObject({ granted: true, fromEnvironment: false, agreedAt: "2026-10-18T09:00:00.000Z" });
	});

	it("is granted for this run by SPEC_AI_JEV_JUDGE_CONSENT=1, and says so", () => {
		const state = consentState(FILE, { [CONSENT_ENV]: "1" }, () => {
			throw new Error("ENOENT");
		});
		expect(state).toMatchObject({ granted: true, fromEnvironment: true });
	});

	it("is not granted when neither says yes", () => {
		const state = consentState(FILE, { [CONSENT_ENV]: "0" }, () => {
			throw new Error("ENOENT");
		});
		expect(state).toMatchObject({ granted: false, fromEnvironment: false });
	});
});

describe("granting through the harness", () => {
	it("runs the harness's own consent command and passes its output through", async () => {
		const process = new FakeProcess();
		const launches: { command: string; args: readonly string[] }[] = [];

		const answer = runConsentCommand({
			launch: { command: "/work/spec.ai.jev/kyrn/bin/agent.mjs", args: [], cwd: "/work/spec.ai.jev", env: {} },
			spawn: (launch) => {
				launches.push(launch);
				return process;
			},
			action: "accept",
		});
		process.emitStdout("the default judge: consented\n");
		process.die(0);

		await expect(answer).resolves.toEqual({ ok: true, output: "the default judge: consented\n" });
		expect(launches[0]?.args).toEqual(["judge", "consent", "accept"]);
	});

	it("reports a refusal instead of pretending it worked", async () => {
		const process = new FakeProcess();
		const answer = runConsentCommand({
			launch: { command: "spec", args: [], cwd: "/", env: {} },
			spawn: () => process,
			action: "revoke",
		});
		process.emitStderr("unknown consent action\n");
		process.die(1);

		await expect(answer).resolves.toEqual({ ok: false, output: "unknown consent action\n" });
	});

	it("gives up when the command never finishes", async () => {
		const process = new FakeProcess();
		const answer = runConsentCommand({
			launch: { command: "spec", args: [], cwd: "/", env: {} },
			spawn: () => process,
			action: "accept",
			timeoutMs: 5,
		});

		await expect(answer).resolves.toMatchObject({ ok: false });
		expect(process.killed).toBe(true);
	});

	it("reports a process that could not start", async () => {
		const answer = runConsentCommand({
			launch: { command: "spec", args: [], cwd: "/", env: {} },
			spawn: (launch) => {
				void launch;
				throw new Error("spawn mu ENOENT");
			},
			action: "accept",
		});
		await expect(answer).resolves.toEqual({ ok: false, output: "spawn mu ENOENT" });
	});
});
