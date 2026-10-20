import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createSecretStore,
	JUDGE_SECRET,
	keychainAvailable,
	PROVIDER_SECRET,
	type RunResult,
	runTool,
	type SecretStore,
	SecretUnavailableError,
	selectSecretStore,
} from "../src/core/secret-store.ts";

/**
 * The store that keeps provider and judge keys. What matters here is not the encryption (AES-GCM is not the
 * interesting part) but the decisions around it: which backend, what happens when it cannot work, and whether
 * a key can ever end up somewhere world-readable without the user being told.
 */

const dirs: string[] = [];
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-secrets-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const windows = process.platform === "win32";

/** A fake keychain tool: reports missing or answers from a map, and records what it was asked to do. */
function fakeKeychain(options: { readonly installed: boolean; readonly entries?: Map<string, string> }) {
	const entries = options.entries ?? new Map<string, string>();
	const calls: string[] = [];
	const run = async (command: string, args: readonly string[], input?: string): Promise<RunResult> => {
		calls.push([command, ...args].join(" "));
		if (!options.installed) return { code: 127, stdout: "", stderr: "", missing: true };
		// `security` names the account with -a; `secret-tool` names it as the value after "account".
		const account = args.includes("-a")
			? (args[args.indexOf("-a") + 1] ?? "")
			: (args[args.indexOf("account") + 1] ?? "");
		if (args[0] === "--version") return { code: 0, stdout: "1.0", stderr: "", missing: false };
		if (args[0] === "find-generic-password" || args[0] === "lookup") {
			const value = entries.get(account);
			return value === undefined
				? { code: 44, stdout: "", stderr: "The specified item could not be found.", missing: false }
				: { code: 0, stdout: `${value}\n`, stderr: "", missing: false };
		}
		if (args[0] === "add-generic-password" || args[0] === "store") {
			entries.set(account, input ?? args[args.indexOf("-w") + 1] ?? "");
			return { code: 0, stdout: "", stderr: "", missing: false };
		}
		if (args[0] === "delete-generic-password" || args[0] === "clear") {
			return entries.delete(account)
				? { code: 0, stdout: "", stderr: "", missing: false }
				: { code: 44, stdout: "", stderr: "The specified item could not be found.", missing: false };
		}
		return { code: 1, stdout: "", stderr: "unexpected", missing: false };
	};
	return { run, calls, entries };
}

describe("choosing a backend", () => {
	it("takes the keychain when the machine has one", async () => {
		const keychain = fakeKeychain({ installed: true });
		const store = await selectSecretStore({ dir: temp(), platform: "darwin", run: keychain.run });
		expect(store.backend).toBe("keychain");
	});

	it("takes the encrypted file when there is no keychain, which is the normal answer on Windows", async () => {
		const store = await selectSecretStore({
			dir: temp(),
			platform: "win32",
			run: fakeKeychain({ installed: false }).run,
		});
		expect(store.backend).toBe("file");
	});

	it("refuses a forced keychain that is not there instead of using something weaker", async () => {
		await expect(
			selectSecretStore({
				dir: temp(),
				platform: "linux",
				env: { MU_CREDENTIAL_STORE: "keychain" },
				run: fakeKeychain({ installed: false }).run,
			}),
		).rejects.toBeInstanceOf(SecretUnavailableError);
	});

	it("says on Windows that the keychain backend is not implemented there yet", async () => {
		await expect(
			selectSecretStore({ dir: temp(), platform: "win32", env: { MU_CREDENTIAL_STORE: "keychain" }, run: runTool }),
		).rejects.toThrow(/not available on Windows yet/);
	});

	it("refuses a backend name it does not know, rather than guessing", async () => {
		await expect(selectSecretStore({ dir: temp(), env: { MU_CREDENTIAL_STORE: "osx" } })).rejects.toThrow(
			/MU_CREDENTIAL_STORE is "osx"/,
		);
	});

	it("falls back to plaintext only when the directory cannot be written, and says so once", async () => {
		const warnings: string[] = [];
		// A path under a file cannot be created: mkdir fails, so the encrypted backend cannot be used.
		const file = join(temp(), "not-a-directory");
		writeFileSync(file, "x");
		const store = await selectSecretStore({
			dir: join(file, "agent"),
			platform: "linux",
			run: fakeKeychain({ installed: false }).run,
			warn: (message) => warnings.push(message),
		});
		expect(store.backend).toBe("plaintext");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/plaintext/);
	});

	it("reports whether a keychain tool exists without inventing one", async () => {
		expect(await keychainAvailable("win32", runTool)).toBe(false);
		expect(await keychainAvailable("darwin", fakeKeychain({ installed: true }).run)).toBe(true);
		expect(await keychainAvailable("linux", fakeKeychain({ installed: false }).run)).toBe(false);
	});
});

describe("the keychain backend", () => {
	it("stores, reads and deletes through the platform tool", async () => {
		const keychain = fakeKeychain({ installed: true });
		const store = createSecretStore("keychain", { platform: "darwin", run: keychain.run });
		await store.set(PROVIDER_SECRET("anthropic"), "sk-ant-secret");
		expect(keychain.entries.get(PROVIDER_SECRET("anthropic"))).toBe("sk-ant-secret");
		expect(keychain.calls[0]).toMatch(
			/^security add-generic-password -s mu -a mu\.provider\.anthropic\.apiKey -w sk-ant-secret -U$/,
		);
		expect(await store.get(PROVIDER_SECRET("anthropic"))).toBe("sk-ant-secret");
		await store.delete(PROVIDER_SECRET("anthropic"));
		expect(await store.get(PROVIDER_SECRET("anthropic"))).toBeUndefined();
		// Deleting a key that is already gone is not an error.
		await store.delete(PROVIDER_SECRET("anthropic"));
	});

	it("uses secret-tool on Linux, with the value on stdin rather than in the argument list", async () => {
		const keychain = fakeKeychain({ installed: true });
		const store = createSecretStore("keychain", { platform: "linux", run: keychain.run });
		await store.set(JUDGE_SECRET("jev"), "judge-key");
		expect(keychain.entries.get(JUDGE_SECRET("jev"))).toBe("judge-key");
		expect(keychain.calls[0]).not.toContain("judge-key");
		expect(await store.get(JUDGE_SECRET("jev"))).toBe("judge-key");
	});

	it("raises instead of pretending a store that cannot be reached worked", async () => {
		const store = createSecretStore("keychain", { platform: "darwin", run: fakeKeychain({ installed: false }).run });
		await expect(store.get("anything")).rejects.toThrow(/not installed/);
	});
});

describe("the encrypted file backend", () => {
	it("round-trips a key and does not leave it in clear on disk", async () => {
		const dir = temp();
		const store = createSecretStore("file", { dir });
		await store.set(PROVIDER_SECRET("openai"), "sk-plaintext-needle");
		expect(await store.get(PROVIDER_SECRET("openai"))).toBe("sk-plaintext-needle");

		const onDisk = readFileSync(join(dir, "secrets.json"), "utf8");
		expect(onDisk).not.toContain("sk-plaintext-needle");
		expect(onDisk).not.toContain(Buffer.from("sk-plaintext-needle").toString("hex"));
		// The key material is beside it, not inside it.
		expect(readFileSync(join(dir, "secrets.key"), "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
	});

	it("keeps the file owner-only", async () => {
		if (windows) return; // ACLs, not mode bits: the plaintext warning is what covers this platform.
		const dir = temp();
		const store = createSecretStore("file", { dir });
		await store.set("mu.judge.clef.apiKey", "value");
		expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
		expect(statSync(join(dir, "secrets.key")).mode & 0o777).toBe(0o600);
	});

	it("reads the same key back from a second store over the same directory", async () => {
		const dir = temp();
		await createSecretStore("file", { dir }).set(JUDGE_SECRET("laya"), "local");
		expect(await createSecretStore("file", { dir }).get(JUDGE_SECRET("laya"))).toBe("local");
	});

	it("refuses a file it cannot read instead of returning no key", async () => {
		const dir = temp();
		const store = createSecretStore("file", { dir });
		await store.set("mu.provider.x.apiKey", "v");
		writeFileSync(join(dir, "secrets.json"), "{ not json");
		await expect(store.get("mu.provider.x.apiKey")).rejects.toBeInstanceOf(SecretUnavailableError);
	});

	it("does not decrypt with the wrong machine secret", async () => {
		const dir = temp();
		await createSecretStore("file", { dir }).set("mu.provider.x.apiKey", "v");
		writeFileSync(join(dir, "secrets.key"), "0".repeat(64));
		await expect(createSecretStore("file", { dir }).get("mu.provider.x.apiKey")).rejects.toThrow(
			/cannot be decrypted/,
		);
	});
});

describe("the plaintext backend", () => {
	it("stores and deletes, and is chosen only when nothing better works", async () => {
		const dir = temp();
		const store: SecretStore = createSecretStore("plaintext", { dir });
		expect(store.backend).toBe("plaintext");
		await store.set("mu.provider.x.apiKey", "v");
		expect(await store.get("mu.provider.x.apiKey")).toBe("v");
		await store.delete("mu.provider.x.apiKey");
		expect(await store.get("mu.provider.x.apiKey")).toBeUndefined();
	});
});

describe("the key names", () => {
	it("is the shape every other module will use", () => {
		expect(PROVIDER_SECRET("anthropic")).toBe("mu.provider.anthropic.apiKey");
		expect(JUDGE_SECRET("jev")).toBe("mu.judge.jev.apiKey");
	});
});
