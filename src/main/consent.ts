// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The judge's consent: read here, granted through the harness.
 *
 * `~/.spec.ai.jev/agent/consent.json` is the kernel's file (`packages/kyrn-judge/src/consent.ts`), in this app's own
 * agent folder (`SPEC_AI_JEV_AGENT_DIR`, the same one the command line uses). The shell only reads it - the durable
 * answer is written by `spec judge consent accept`, which is the same code the command line uses.
 * Writing the four fields here would mean a second copy of a format that has a version number, and the first kernel bump
 * would leave the shell writing files the kernel ignores.
 *
 * Declining is a normal state, not an error: without consent the keyless remote judge is not consulted, and everything
 * local still works. That is the kernel's precedence, and the screen says exactly that.
 */

import { readFileSync } from "node:fs";
import type { AgentLaunch, AgentProcess, SpawnAgent } from "./rpc.ts";

/** Mirrors the kernel: the default keyless judge, the notice version, and what was agreed to. */
export const CONSENT_JUDGE_ID = "jev";
export const CONSENT_VERSION = 1;
export const CONSENT_SCOPE = "remote-judge";
export const CONSENT_ENV = "SPEC_AI_JEV_JUDGE_CONSENT";

export interface ConsentRecord {
	readonly judgeId: string;
	readonly consentVersion: number;
	readonly agreedAt: string;
	readonly scope: string;
}

/** The consent on disk, if it is for this judge and this version of the notice — the same checks the kernel makes. */
export function readConsent(file: string, read: (path: string) => string = (path) => readFileSync(path, "utf8")): ConsentRecord | undefined {
	let text: string;
	try {
		text = read(file);
	} catch {
		return undefined;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Partial<ConsentRecord>;
	if (record.judgeId !== CONSENT_JUDGE_ID) return undefined;
	if (record.consentVersion !== CONSENT_VERSION) return undefined;
	if (record.scope !== CONSENT_SCOPE) return undefined;
	if (typeof record.agreedAt !== "string") return undefined;
	return { judgeId: CONSENT_JUDGE_ID, consentVersion: CONSENT_VERSION, agreedAt: record.agreedAt, scope: CONSENT_SCOPE };
}

export interface ConsentState {
	readonly granted: boolean;
	/** True when the answer comes from `SPEC_AI_JEV_JUDGE_CONSENT=1` for this run, rather than from the file. */
	readonly fromEnvironment: boolean;
	readonly agreedAt: string | undefined;
	readonly file: string;
}

export function consentState(file: string, env: Readonly<Record<string, string | undefined>>, read?: (path: string) => string): ConsentState {
	const record = readConsent(file, read);
	const fromEnvironment = (env[CONSENT_ENV] ?? "").trim() === "1";
	return {
		granted: record !== undefined || fromEnvironment,
		fromEnvironment,
		agreedAt: record?.agreedAt,
		file,
	};
}

export interface ConsentCommandResult {
	readonly ok: boolean;
	/** The command's own output, which is what an error screen shows if it failed. */
	readonly output: string;
}

const COMMAND_TIMEOUT_MS = 20_000;

/**
 * Run a subcommand of the harness's command line and wait for it. The child is killed if it does not answer: a screen
 * that waits forever is worse than one that reports the timeout.
 */
export function runHarnessCommand(options: {
	/** How to run the harness's command line: the executable and the launcher, without a subcommand. */
	readonly launch: AgentLaunch;
	readonly spawn: SpawnAgent;
	readonly args: readonly string[];
	readonly timeoutMs?: number;
}): Promise<ConsentCommandResult> {
	return new Promise<ConsentCommandResult>((resolve) => {
		let output = "";
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (result: ConsentCommandResult): void => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			resolve(result);
		};

		let child: AgentProcess;
		try {
			child = options.spawn({ ...options.launch, args: [...options.launch.args, ...options.args] });
		} catch (error) {
			resolve({ ok: false, output: error instanceof Error ? error.message : String(error) });
			return;
		}

		const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
		timer = setTimeout(() => {
			child.kill();
			finish({ ok: false, output: `${output}\n${options.args.join(" ")} did not finish within ${timeoutMs} ms` });
		}, timeoutMs);

		child.onStdout((chunk) => {
			output += chunk;
		});
		child.onStderr((chunk) => {
			output += chunk;
		});
		child.onError((error) => finish({ ok: false, output: `${output}\n${error.message}` }));
		child.onExit((code) => finish({ ok: code === 0, output }));
	});
}

/** `spec judge consent accept|revoke`, which is the only writer of the consent file. */
export function runConsentCommand(options: {
	readonly launch: AgentLaunch;
	readonly spawn: SpawnAgent;
	readonly action: "accept" | "revoke";
	readonly timeoutMs?: number;
}): Promise<ConsentCommandResult> {
	return runHarnessCommand({
		launch: options.launch,
		spawn: options.spawn,
		args: ["judge", "consent", options.action],
		...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
	});
}
