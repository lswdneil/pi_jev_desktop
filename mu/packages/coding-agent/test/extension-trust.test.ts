import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_EXTENSION_TRUST,
	formatExtensionTrustTable,
	listExtensionTrust,
	readExtensionTrust,
} from "../src/core/extensions/manifest.ts";
import {
	authorize,
	extensionHash,
	isAuthorized,
	readTrustStore,
	revoke,
	writeTrustStore,
} from "../src/core/extensions/trust-store.ts";

const created: string[] = [];

/** ${project} as written in a manifest, built at runtime so the linter does not read it as a template. */
const PROJECT_ROOT_PLACEHOLDER = ["$", "{project}"].join("");

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-extension-trust-"));
	created.push(dir);
	return dir;
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** An extension directory with a package.json and one source file. */
function makeExtension(root: string, name: string, pi: Record<string, unknown> | undefined): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	writeJson(join(dir, "package.json"), pi === undefined ? { name } : { name, pi });
	writeFileSync(join(dir, "index.ts"), `export const name = ${JSON.stringify(name)};\n`);
	return dir;
}

afterEach(() => {
	for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readExtensionTrust", () => {
	it("reads a declared tier and its capabilities", () => {
		const root = tempDir();
		const dir = makeExtension(root, "declared", {
			trust: "hosted",
			capabilities: { fsRoots: [PROJECT_ROOT_PLACEHOLDER], env: ["PATH"], spawn: ["git"] },
		});
		const manifest = readExtensionTrust(join(dir, "package.json"));
		expect(manifest.trust).toBe("hosted");
		expect(manifest.declared).toBe(true);
		expect(manifest.capabilities).toEqual({ fsRoots: [PROJECT_ROOT_PLACEHOLDER], env: ["PATH"], spawn: ["git"] });
		expect(manifest.issue).toBeUndefined();
	});

	it("falls back to the default tier with an issue for an unknown tier", () => {
		const root = tempDir();
		const dir = makeExtension(root, "invalid", { trust: "sandboxed" });
		const manifest = readExtensionTrust(join(dir, "package.json"));
		expect(manifest.trust).toBe(DEFAULT_EXTENSION_TRUST);
		expect(manifest.declared).toBe(false);
		expect(manifest.issue).toContain("unknown trust tier");
	});

	it("treats a missing package.json as undeclared", () => {
		const root = tempDir();
		const manifest = readExtensionTrust(join(root, "missing", "package.json"));
		expect(manifest).toEqual({ trust: DEFAULT_EXTENSION_TRUST, capabilities: {}, declared: false });
	});
});

describe("extensionHash", () => {
	it("is stable for unchanged content and changes when a source file changes", () => {
		const root = tempDir();
		const dir = makeExtension(root, "hashed", { trust: "trusted" });
		const before = extensionHash(dir);
		expect(extensionHash(dir)).toBe(before);
		writeFileSync(join(dir, "index.ts"), "export const name = 'changed';\n");
		expect(extensionHash(dir)).not.toBe(before);
	});

	it("ignores lockfiles, node_modules and dist", () => {
		const root = tempDir();
		const dir = makeExtension(root, "ignored", { trust: "trusted" });
		const before = extensionHash(dir);
		writeFileSync(join(dir, "package-lock.json"), "{}\n");
		mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
		writeFileSync(join(dir, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
		mkdirSync(join(dir, "dist"), { recursive: true });
		writeFileSync(join(dir, "dist", "index.js"), "export {};\n");
		expect(extensionHash(dir)).toBe(before);
	});
});

describe("trust store", () => {
	it("round-trips through disk and grants authority only for the approved content", () => {
		const root = tempDir();
		const storePath = join(root, "trust.json");
		const dir = makeExtension(root, "approved", { trust: "hosted" });
		const hash = extensionHash(dir);

		const store = authorize({}, dir, hash, "hosted", { env: ["PATH"] }, new Date("2026-01-01T00:00:00Z"));
		writeTrustStore(storePath, store);

		const reloaded = readTrustStore(storePath);
		expect(isAuthorized(reloaded, dir, hash)).toBe(true);
		expect(isAuthorized(reloaded, dir, "sha256:other")).toBe(false);
		expect(reloaded[`${dir}#sha256:${hash}`]?.trust).toBe("hosted");
	});

	it("returns an empty store for a malformed file and drops records for a target on revoke", () => {
		const root = tempDir();
		const storePath = join(root, "trust.json");
		const dir = makeExtension(root, "revoked", { trust: "trusted" });
		const hash = extensionHash(dir);

		const store = authorize({}, dir, hash, "trusted", {});
		writeTrustStore(storePath, store);
		writeFileSync(storePath, "not json\n");
		expect(readTrustStore(storePath)).toEqual({});

		expect(isAuthorized(revoke(store, dir), dir, hash)).toBe(false);
	});
});

describe("listExtensionTrust", () => {
	it("lists declared and undeclared extensions with their authorization state", () => {
		const root = tempDir();
		const extensionsDir = join(root, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		const declared = makeExtension(extensionsDir, "declared", { trust: "hosted" });
		const bare = makeExtension(extensionsDir, "bare", undefined);
		writeFileSync(join(extensionsDir, "single-file.ts"), "export {};\n");

		const hash = extensionHash(declared);
		const store = authorize({}, declared, hash, "hosted", {});
		const rows = listExtensionTrust([extensionsDir], store);

		expect(rows.map((row) => row.path)).toEqual(
			[bare, declared, join(extensionsDir, "single-file.ts")].sort((a, b) => a.localeCompare(b)),
		);
		const declaredRow = rows.find((row) => row.path === declared);
		expect(declaredRow).toMatchObject({ trust: "hosted", declared: true, authorized: true });
		const bareRow = rows.find((row) => row.path === bare);
		expect(bareRow).toMatchObject({ trust: DEFAULT_EXTENSION_TRUST, declared: false, authorized: false });
		const fileRow = rows.find((row) => row.path.endsWith("single-file.ts"));
		expect(fileRow?.trust).toBe(DEFAULT_EXTENSION_TRUST);
		expect(fileRow?.declared).toBe(false);
	});

	it("formats a stable table", () => {
		const root = tempDir();
		const extensionsDir = join(root, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		makeExtension(extensionsDir, "one", { trust: "hosted", capabilities: { env: ["PATH"] } });
		const rows = listExtensionTrust([extensionsDir], {});
		const table = formatExtensionTrustTable(rows);
		const [header, first] = table.split("\n");
		expect(header.split(/\s{2,}/)).toEqual(["TRUST", "DECLARED", "AUTH", "CAPABILITIES", "PATH"]);
		expect(first.split(/\s{2,}/)).toEqual(["hosted", "yes", "no", "env:1", rows[0]?.path]);
		expect(formatExtensionTrustTable(rows)).toBe(table);
	});
});
