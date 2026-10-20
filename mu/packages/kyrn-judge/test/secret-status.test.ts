import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretStore, JUDGE_SECRET, type SecretStore } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { secretStatus } from "../src/setup/secret-cli.ts";

/**
 * What `mu doctor` prints about the key store. The point of the line is that a person can see, without opening
 * anything, which backend their keys went into and whether any of them are sitting in plaintext.
 */

const dirs: string[] = [];
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-secret-status-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function keychain(): SecretStore {
	return { backend: "keychain", get: async () => undefined, set: async () => {}, delete: async () => {} };
}

describe("the credentials row", () => {
	it("counts the keys an encrypted store holds", async () => {
		const dir = temp();
		const store = createSecretStore("file", { dir });
		await store.set(JUDGE_SECRET("jev"), "one");
		await store.set(JUDGE_SECRET("laya"), "two");
		const status = await secretStatus(dir);
		expect(status).toMatchObject({ backend: "file", entries: 2, plaintextResidual: false });
		expect(status.path).toBe(join(dir, "secrets.json"));
	});

	it("says there are no keys yet, rather than pretending the file exists", async () => {
		expect(await secretStatus(temp())).toMatchObject({ backend: "file", entries: 0, plaintextResidual: false });
	});

	it("flags a plaintext entry left by an earlier fallback", async () => {
		const dir = temp();
		writeFileSync(
			join(dir, "secrets.json"),
			JSON.stringify({ version: 1, entries: { [JUDGE_SECRET("jev")]: "in-the-clear" } }),
		);
		expect(await secretStatus(dir)).toMatchObject({ backend: "file", entries: 1, plaintextResidual: true });
	});

	it("cannot count what the keychain holds, and says so instead of inventing a number", async () => {
		const status = await secretStatus(temp(), async () => keychain());
		expect(status).toMatchObject({ backend: "keychain", entries: undefined, plaintextResidual: false });
	});

	it("reports an unreadable store file instead of crashing the doctor", async () => {
		const dir = temp();
		writeFileSync(join(dir, "secrets.json"), "{ not json");
		expect(await secretStatus(dir)).toMatchObject({ backend: "file", entries: undefined });
	});
});
