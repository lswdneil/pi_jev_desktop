import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretStore, JUDGE_SECRET, type SyncSecretStore } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type KyrnConfig } from "../src/config.ts";
import { preResolveJudgeKeys, reachableJudges } from "../src/credentials.ts";
import { judgeKeyEnvNames } from "../src/registry.ts";

/**
 * The bridge between where keys are kept and where the judge reads them.
 *
 * `JudgeHost.env` is consulted in the middle of a decision, so a key cannot be fetched there: it is resolved
 * once, before the judge exists. What matters in the tests is the precedence (an explicit variable wins), the
 * reach (only judges a session can hand a decision to), and that a store that cannot be read is reported rather
 * than quietly becoming "no key".
 */

const dirs: string[] = [];
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-credentials-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function store(): SyncSecretStore {
	return createSecretStore("file", { dir: temp() });
}

function config(overrides: Partial<KyrnConfig> = {}): KyrnConfig {
	return { ...DEFAULT_CONFIG, ...overrides };
}

describe("which variable a judge reads", () => {
	it("names the variables a provider factory would read, specific first", () => {
		expect(judgeKeyEnvNames({ type: "jev" })).toEqual([
			"TYPESAFE_API_KEY",
			"MU_JUDGE_OPENROUTER_API_KEY",
			"AI_GATEWAY_API_KEY",
			"OPENCODE_API_KEY",
			"CLOUDFLARE_API_KEY",
		]);
		expect(judgeKeyEnvNames({ type: "gateway" })).toEqual(["AI_GATEWAY_API_KEY"]);
		expect(judgeKeyEnvNames({ type: "typesafe", apiKeyEnv: "MY_KEY" })).toEqual(["MY_KEY"]);
		expect(judgeKeyEnvNames({ type: "clm" })).toEqual(["MU_JUDGE_CLM_API_KEY"]);
		expect(judgeKeyEnvNames({ type: "http" })).toEqual([]);
		// Judges that never hold a key of their own: the host's credentials or none at all.
		expect(judgeKeyEnvNames({ type: "classifier", model: "x/y" })).toEqual([]);
		expect(judgeKeyEnvNames({ type: "local" })).toEqual([]);
	});
});

describe("pre-resolving the store into the environment", () => {
	it("fills the judge's variable from the store", async () => {
		const secrets = store();
		await secrets.set(JUDGE_SECRET("jev"), "stored-key");
		const resolution = preResolveJudgeKeys({ config: config({ tiers: ["jev"] }), store: secrets, env: {} });
		expect(resolution.env).toEqual({ TYPESAFE_API_KEY: "stored-key" });
		expect(resolution.resolved).toEqual([{ judge: "jev", key: "TYPESAFE_API_KEY" }]);
		expect(resolution.missing).toEqual([]);
	});

	it("never overwrites a variable the person set themselves", async () => {
		const secrets = store();
		await secrets.set(JUDGE_SECRET("jev"), "stored-key");
		const resolution = preResolveJudgeKeys({
			config: config({ tiers: ["jev"] }),
			store: secrets,
			env: { AI_GATEWAY_API_KEY: "explicit" },
		});
		// One of the jev route's variables is set, so the store is not consulted at all.
		expect(resolution.env).toEqual({});
		expect(resolution.missing).toEqual([]);
	});

	it("reports the judges whose key is nowhere, without failing the rest", async () => {
		const secrets = store();
		await secrets.set(JUDGE_SECRET("laya"), "unused-key");
		const resolution = preResolveJudgeKeys({ config: config({ tiers: ["jev"] }), store: secrets, env: {} });
		expect(resolution.env).toEqual({});
		expect(resolution.missing).toEqual([{ judge: "jev", key: "TYPESAFE_API_KEY" }]);
	});

	it("looks at the tiers and the routes, and nothing else", async () => {
		const secrets = store();
		await secrets.set(JUDGE_SECRET("bespoke"), "route-key");
		await secrets.set(JUDGE_SECRET("unused"), "ignored-key");
		const resolved = preResolveJudgeKeys({
			config: config({
				tiers: ["mock"],
				routes: { "browser.step": ["bespoke"] },
				judges: { bespoke: { type: "gateway" }, unused: { type: "gateway" } },
			}),
			store: secrets,
			env: {},
		});
		expect(resolved.env).toEqual({ AI_GATEWAY_API_KEY: "route-key" });
		expect(reachableJudges(config({ tiers: ["mock"], routes: { "browser.step": ["bespoke"] } }))).toEqual([
			"mock",
			"bespoke",
		]);
	});

	it("throws when the store cannot be read at all, instead of behaving as if there were no key", () => {
		const broken: SyncSecretStore = {
			backend: "file",
			get: async () => undefined,
			set: async () => {},
			delete: async () => {},
			readSync: () => {
				throw new Error("the key cannot be decrypted with this machine's secret");
			},
		};
		expect(() => preResolveJudgeKeys({ config: config({ tiers: ["jev"] }), store: broken, env: {} })).toThrow(
			/cannot be decrypted/,
		);
	});
});
