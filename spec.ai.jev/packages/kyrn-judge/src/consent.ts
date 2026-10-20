import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Consent for the judge that is not on this machine.
 *
 * Out of the box the `jev` judge runs on a public, keyless endpoint. That is a good default for a toy and
 * the wrong one for production: the user's words leave the machine before they ever said it was all right.
 * Changing the default mode to `shadow` does not help — a shadow verdict still makes the request — so the
 * answer has to be explicit consent, and consent has to be revocable.
 *
 * A judge the user configured with their own key needs no consent file: configuring it is the consent.
 * This gates the keyless default only.
 */

/** Bumped when what the person agrees to changes; an old file then counts as no consent. */
export const JUDGE_CONSENT_VERSION = 1;

/** Non-interactive path, for a headless setup: `SPEC_AI_JEV_JUDGE_CONSENT=1` means "I read the notice". */
export const JUDGE_CONSENT_ENV = "SPEC_AI_JEV_JUDGE_CONSENT";

export const CONSENT_SCOPE = "remote-judge";

export interface JudgeConsent {
	/** The judge the consent is for: `jev`, meaning the configured keyless default. */
	judgeId: string;
	consentVersion: number;
	agreedAt: string;
	scope: typeof CONSENT_SCOPE;
}

export function consentFile(agentDir: string): string {
	return join(agentDir, "consent.json");
}

/** The stored consent, if it is for this judge and this version of the notice. */
export function readJudgeConsent(agentDir: string, judgeId = "jev"): JudgeConsent | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(consentFile(agentDir), "utf8"));
		if (typeof value !== "object" || value === null) return undefined;
		const consent = value as Partial<JudgeConsent>;
		if (consent.judgeId !== judgeId) return undefined;
		if (consent.consentVersion !== JUDGE_CONSENT_VERSION) return undefined;
		if (consent.scope !== CONSENT_SCOPE) return undefined;
		if (typeof consent.agreedAt !== "string") return undefined;
		return {
			judgeId,
			consentVersion: JUDGE_CONSENT_VERSION,
			agreedAt: consent.agreedAt,
			scope: CONSENT_SCOPE,
		};
	} catch {
		// Missing, unreadable, or a file from a version that asked something else: not consent.
		return undefined;
	}
}

/** Record consent. Written owner-only, like every file that says something about the person. */
export function writeJudgeConsent(agentDir: string, options: { judgeId?: string; agreedAt?: Date } = {}): JudgeConsent {
	const consent: JudgeConsent = {
		judgeId: options.judgeId ?? "jev",
		consentVersion: JUDGE_CONSENT_VERSION,
		agreedAt: (options.agreedAt ?? new Date()).toISOString(),
		scope: CONSENT_SCOPE,
	};
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(consentFile(agentDir), `${JSON.stringify(consent, null, 2)}\n`, { mode: 0o600 });
	return consent;
}

export function revokeJudgeConsent(agentDir: string): boolean {
	try {
		rmSync(consentFile(agentDir), { force: true });
		return true;
	} catch {
		return false;
	}
}

export interface ConsentState {
	readonly judgeId: string;
	readonly consented: boolean;
	/** How the person can consent, for the one notice mu prints. */
	readonly grantHint: string;
}

/**
 * Whether the keyless remote judge may run.
 *
 * Precedence: `SPEC_AI_JEV_JUDGE=off` wins over everything elsewhere (the judge is not consulted at all); a file
 * written by the consent command is the durable answer; the environment variable is the headless answer.
 */
export function judgeConsentState(
	agentDir: string | undefined,
	env: Readonly<Record<string, string | undefined>> = process.env,
): ConsentState {
	const judgeId = "jev";
	const granted = readJudgeConsent(agentDir ?? "", judgeId);
	const fromEnv = env[JUDGE_CONSENT_ENV]?.trim();
	const consented = granted !== undefined || fromEnv === "1";
	return {
		judgeId,
		consented,
		grantHint:
			env[JUDGE_CONSENT_ENV] === "1"
				? `consent given for this run by ${JUDGE_CONSENT_ENV}=1`
				: consentHint(agentDir),
	};
}

function consentHint(agentDir: string | undefined): string {
	const where = agentDir ? `it in ${consentFile(agentDir)}` : "the consent file";
	return `the default judge sends your messages to a shared endpoint; mu asks first. Run \`mu judge consent accept\` (writes ${where}), or set ${JUDGE_CONSENT_ENV}=1 for a headless run. Local judges and \`SPEC_AI_JEV_JUDGE=off\` need neither.`;
}

/** True when a consent file exists and is usable, for `mu judge consent status`. */
export function hasJudgeConsent(agentDir: string | undefined): boolean {
	return agentDir !== undefined && existsSync(consentFile(agentDir)) && readJudgeConsent(agentDir) !== undefined;
}
