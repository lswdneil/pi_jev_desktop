import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionCapabilities, ExtensionTrust } from "./manifest.ts";

/**
 * Approval records for extension trust tiers.
 *
 * A record is keyed by the extension's absolute path plus a digest of its
 * source files, so editing an extension revokes its approval instead of
 * silently keeping it.
 */

export interface ExtensionTrustEntry {
	trust: ExtensionTrust;
	capabilities: ExtensionCapabilities;
	/** ISO timestamp of the approval. */
	approvedAt: string;
}

export type ExtensionTrustStore = Record<string, ExtensionTrustEntry>;

/** File extensions that take part in the digest. */
export const EXTENSION_HASH_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);

/** Directories whose contents never take part in the digest. */
export const EXTENSION_HASH_IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);

/** Lockfiles and similar machine-written files never take part in the digest. */
export const EXTENSION_HASH_IGNORED_FILES = new Set([
	"package-lock.json",
	"npm-shrinkwrap.json",
	"bun.lock",
	"bun.lockb",
	"yarn.lock",
	"pnpm-lock.yaml",
]);

function digestOfFiles(files: ReadonlyArray<{ relative: string; bytes: Buffer }>): string {
	const hash = createHash("sha256");
	for (const file of [...files].sort((left, right) => left.relative.localeCompare(right.relative))) {
		hash.update(file.relative);
		hash.update("\0");
		hash.update(file.bytes);
		hash.update("\0");
	}
	return hash.digest("hex");
}

function collectFiles(root: string, dir: string, files: Array<{ relative: string; bytes: Buffer }>): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (EXTENSION_HASH_IGNORED_DIRS.has(entry.name)) continue;
			collectFiles(root, join(dir, entry.name), files);
			continue;
		}
		if (!entry.isFile()) continue;
		if (EXTENSION_HASH_IGNORED_FILES.has(entry.name)) continue;
		const extension = entry.name.slice(entry.name.lastIndexOf("."));
		if (!EXTENSION_HASH_EXTENSIONS.has(extension)) continue;
		const path = join(dir, entry.name);
		files.push({ relative: path.slice(root.length + 1).replace(/\\/g, "/"), bytes: readFileSync(path) });
	}
}

/**
 * Digest of an extension target: the file's bytes for a single-file extension,
 * or every source file below the directory for a directory extension. Lockfiles
 * and generated directories are excluded so that installing dependencies does
 * not revoke an approval.
 */
export function extensionHash(target: string): string {
	const resolved = resolve(target);
	if (!existsSync(resolved)) return digestOfFiles([]);
	const stats = statSync(resolved);
	if (stats.isFile()) {
		return digestOfFiles([
			{ relative: resolved.slice(resolved.lastIndexOf("\\") + 1), bytes: readFileSync(resolved) },
		]);
	}
	const files: Array<{ relative: string; bytes: Buffer }> = [];
	collectFiles(resolved, resolved, files);
	return digestOfFiles(files);
}

/** Store key for `target` at `hash`. */
export function extensionTrustKey(target: string, hash: string): string {
	return `${resolve(target)}#sha256:${hash}`;
}

export function emptyTrustStore(): ExtensionTrustStore {
	return {};
}

/** Read the store; a missing or malformed file yields an empty store. */
export function readTrustStore(path: string): ExtensionTrustStore {
	if (!existsSync(path)) return emptyTrustStore();
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyTrustStore();
		const store: ExtensionTrustStore = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
			const entry = value as Partial<ExtensionTrustEntry>;
			if (typeof entry.trust !== "string" || typeof entry.approvedAt !== "string") continue;
			store[key] = {
				trust: entry.trust as ExtensionTrust,
				capabilities:
					typeof entry.capabilities === "object" && entry.capabilities !== null ? entry.capabilities : {},
				approvedAt: entry.approvedAt,
			};
		}
		return store;
	} catch {
		return emptyTrustStore();
	}
}

/** Write the store, creating the directory when needed. */
export function writeTrustStore(path: string, store: ExtensionTrustStore): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

/** True when `target` at `hash` has been approved. */
export function isAuthorized(store: ExtensionTrustStore, target: string, hash: string): boolean {
	return Object.hasOwn(store, extensionTrustKey(target, hash));
}

/** Record an approval for `target` at `hash`, returning the updated store. */
export function authorize(
	store: ExtensionTrustStore,
	target: string,
	hash: string,
	trust: ExtensionTrust,
	capabilities: ExtensionCapabilities,
	approvedAt: Date = new Date(),
): ExtensionTrustStore {
	return {
		...store,
		[extensionTrustKey(target, hash)]: { trust, capabilities, approvedAt: approvedAt.toISOString() },
	};
}

/** Drop every approval recorded for `target` (any content). */
export function revoke(store: ExtensionTrustStore, target: string): ExtensionTrustStore {
	const prefix = `${resolve(target)}#`;
	const next: ExtensionTrustStore = {};
	for (const [key, entry] of Object.entries(store)) {
		if (!key.startsWith(prefix)) next[key] = entry;
	}
	return next;
}
