import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretStore, JUDGE_SECRET, type SyncSecretStore } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type KyrnConfig } from "../src/config.ts";
import { parseCredentialsArgs } from "../src/setup/credentials-cli.ts";
import { describeMigration, migrateCredentials } from "../src/setup/credentials-migrate.ts";
import { envFileValue } from "../src/setup/env-file.ts";

/**
 * Moving keys out of `.env`. The rules that matter are the ones a user can be surprised by: what moves, what
 * stays because pi also reads it, and what the file looks like afterwards (a backup, no key, no lost setting).
 */

const dirs: string[] = [];
function home(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-migrate-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function setup(envText: string): { agentDir: string; envFile: string; store: SyncSecretStore } {
	const root = home();
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	const envFile = join(agentDir, ".env");
	writeFileSync(envFile, envText);
	const store = createSecretStore("file", { dir: agentDir });
	return { agentDir, envFile, store };
}

const config = (overrides: Partial<KyrnConfig> = {}): KyrnConfig => ({ ...DEFAULT_CONFIG, ...overrides });

describe("moving keys into the store", () => {
	it("moves a key only mu reads, and leaves the file without it", async () => {
		const { agentDir, envFile, store } = setup("MU_JUDGE_OPENROUTER_API_KEY=secret-one\nOTHER=kept\n");
		const result = await migrateCredentials({
			agentDir,
			envFile,
			config: config({ tiers: ["jev-openrouter"] }),
			store,
		});

		expect(result.moved).toEqual([
			{ name: "MU_JUDGE_OPENROUTER_API_KEY", judge: "jev-openrouter", removedFromEnv: true },
		]);
		expect(result.envFileWritten).toBe(true);
		expect(store.readSync(JUDGE_SECRET("jev-openrouter"))).toBe("secret-one");
		const text = readFileSync(envFile, "utf8");
		expect(text).not.toContain("secret-one");
		expect(text).not.toContain("MU_JUDGE_OPENROUTER_API_KEY");
		expect(envFileValue(text, "OTHER")).toBe("kept");
		expect(text).toContain("# Keys moved to the credential store");
		expect(result.backup).toBeDefined();
		expect(existsSync(join(result.backup as string, ".env"))).toBe(true);
	});

	it("copies a key pi also reads, and keeps it in the file unless asked", async () => {
		const { agentDir, envFile, store } = setup("AI_GATEWAY_API_KEY=shared-secret\n");
		const result = await migrateCredentials({
			agentDir,
			envFile,
			config: config({ tiers: ["jev-gateway"] }),
			store,
		});
		expect(result.moved).toEqual([{ name: "AI_GATEWAY_API_KEY", judge: "jev-gateway", removedFromEnv: false }]);
		expect(store.readSync(JUDGE_SECRET("jev-gateway"))).toBe("shared-secret");
		expect(readFileSync(envFile, "utf8")).toContain("AI_GATEWAY_API_KEY=shared-secret");
		expect(result.envFileWritten).toBe(false);

		const rewritten = await migrateCredentials({
			agentDir,
			envFile,
			config: config({ tiers: ["jev-gateway"] }),
			store,
			rewriteEnv: true,
		});
		expect(rewritten.moved[0]?.removedFromEnv).toBe(true);
		expect(readFileSync(envFile, "utf8")).not.toContain("shared-secret");
	});

	it("writes nothing at all in a dry run", async () => {
		const { agentDir, envFile, store } = setup("MU_JUDGE_CLM_API_KEY=secret-two\n");
		const before = readFileSync(envFile, "utf8");
		const result = await migrateCredentials({
			agentDir,
			envFile,
			config: config({ tiers: ["clm"] }),
			store,
			dryRun: true,
		});
		expect(result.dryRun).toBe(true);
		expect(result.moved).toHaveLength(1);
		expect(result.backup).toBeUndefined();
		expect(readFileSync(envFile, "utf8")).toBe(before);
		expect(store.readSync(JUDGE_SECRET("clm"))).toBeUndefined();
	});

	it("keeps what is not a key: references, empty values and names no judge reads", async () => {
		const { agentDir, envFile, store } = setup(
			"MU_JUDGE_CLM_API_KEY=$ALREADY_IN_SHELL\nMU_JUDGE_OPENROUTER_API_KEY=\nUNRELATED=1\n",
		);
		const result = await migrateCredentials({
			agentDir,
			envFile,
			config: config({ tiers: ["clm", "jev-openrouter"] }),
			store,
		});
		expect(result.moved).toEqual([]);
		expect(result.kept.map((entry) => entry.reason)).toEqual([
			"it is already a reference, not a key",
			"it has no value",
			"no judge of this configuration reads it",
		]);
		expect(readFileSync(envFile, "utf8")).toContain("MU_JUDGE_CLM_API_KEY=$ALREADY_IN_SHELL");
	});

	it("is idempotent: the second run finds nothing to move", async () => {
		const { agentDir, envFile, store } = setup("MU_JUDGE_CLM_API_KEY=secret-three\n");
		await migrateCredentials({ agentDir, envFile, config: config({ tiers: ["clm"] }), store });
		const again = await migrateCredentials({ agentDir, envFile, config: config({ tiers: ["clm"] }), store });
		expect(again.moved).toEqual([]);
		expect(again.envFileWritten).toBe(false);
	});

	it("says what it did, that auth.json is not part of it, and that the backup is still a secret", async () => {
		const { agentDir, envFile, store } = setup("MU_JUDGE_CLM_API_KEY=k\n");
		const result = await migrateCredentials({ agentDir, envFile, config: config({ tiers: ["clm"] }), store });
		const lines = describeMigration(result).join("\n");
		expect(lines).toMatch(/1 key moved to the file store/);
		expect(lines).toMatch(/mu\.judge\.clm\.apiKey/);
		expect(lines).toMatch(/auth\.json is left alone/);
		// The backup keeps the key in plain text: the message must say so, because nothing else tells the user.
		expect(lines).toMatch(/it still holds the key in plain text, so delete it once the store works/);
		expect(lines).toContain(result.backup as string);
	});

	it("does nothing quietly when there is no .env", async () => {
		const root = home();
		const agentDir = join(root, "agent");
		const result = await migrateCredentials({
			agentDir,
			config: config(),
			store: createSecretStore("file", { dir: agentDir }),
		});
		expect(result.moved).toEqual([]);
		expect(result.envFileWritten).toBe(false);
	});
});

describe("the CLI arguments", () => {
	it("takes the agent directory, the flags, and refuses anything else", () => {
		expect(parseCredentialsArgs(["--agent-dir", "/tmp/agent", "--dry-run", "--json"], {})).toEqual({
			agentDir: "/tmp/agent",
			dryRun: true,
			rewriteEnv: false,
			json: true,
		});
		expect(parseCredentialsArgs([], { MU_AGENT_DIR: "/tmp/from-env" })).toMatchObject({ agentDir: "/tmp/from-env" });
		expect(() => parseCredentialsArgs([], {})).toThrow(/--agent-dir is required/);
		expect(() => parseCredentialsArgs(["--nope"], { MU_AGENT_DIR: "/x" })).toThrow(/unknown argument/);
	});
});
