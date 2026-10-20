import { JUDGE_SECRET, type SyncSecretStore } from "@earendil-works/pi-coding-agent";
import type { KyrnConfig } from "./config.ts";
import { judgeKeyEnvNames, resolveJudgeConfig } from "./registry.ts";

/**
 * Fills in the judge keys the person stored, before anything can decide.
 *
 * The constraint this file exists for: `JudgeHost.env` is read synchronously, in the middle of a decision, so
 * the store cannot be asked there. Instead every key a session could need is resolved once, up front, and
 * placed in the environment the host is built with. Precedence is C3's: an explicit variable in the real
 * environment wins over the store, and the store wins over whatever a `.env` reference resolved to.
 *
 * Only judges a session can reach are looked up: the tiers, and the per-decision routes. A key for a judge
 * nobody selected stays where it is.
 */

export interface JudgeKeyResolution {
	/** Variable name to value, for names that were actually found. Spread over `process.env` by the caller. */
	readonly env: Readonly<Record<string, string>>;
	/** The judges whose key came from the store, and the variable it went into. */
	readonly resolved: readonly { readonly judge: string; readonly key: string }[];
	/** Judges with a key-shaped hole: they ask for a variable and nothing sets it. */
	readonly missing: readonly { readonly judge: string; readonly key: string }[];
}

/** Every judge id a session can hand a decision to: the cascade, plus each route's tiers. */
export function reachableJudges(config: KyrnConfig): string[] {
	const names = new Set<string>(config.tiers);
	for (const tiers of Object.values(config.routes)) for (const name of tiers) names.add(name);
	// A judge entry nothing reaches is still worth knowing about for the doctor, but not worth a lookup here.
	return [...names];
}

/**
 * Resolves stored keys into environment values. Throws `SecretUnavailableError` from the store when it cannot be
 * read at all — a session with no access to its keys must say so, not behave as if the keys were never set.
 */
export function preResolveJudgeKeys(input: {
	readonly config: KyrnConfig;
	readonly store: SyncSecretStore;
	readonly env?: Readonly<Record<string, string | undefined>>;
}): JudgeKeyResolution {
	const env = input.env ?? process.env;
	const resolved: { judge: string; key: string }[] = [];
	const missing: { judge: string; key: string }[] = [];
	const collected: Record<string, string> = {};

	for (const name of reachableJudges(input.config)) {
		const judge = resolveJudgeConfig(name, input.config);
		if (judge === undefined) continue;
		const candidates = judgeKeyEnvNames(judge);
		if (candidates.length === 0) continue;
		// An explicit variable is the person's own setting: never overwrite it.
		const alreadySet = candidates.find((candidate) => (env[candidate] ?? "").trim() !== "");
		if (alreadySet !== undefined) continue;

		const stored = input.store.readSync(JUDGE_SECRET(name));
		if (stored === undefined || stored.trim() === "") {
			missing.push({ judge: name, key: candidates[0] as string });
			continue;
		}
		const target = candidates[0] as string;
		collected[target] = stored;
		resolved.push({ judge: name, key: target });
	}

	return { env: collected, resolved, missing };
}
