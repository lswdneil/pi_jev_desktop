import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripBom } from "../../utils/text.ts";
import { type ExtensionTrustStore, extensionHash, isAuthorized } from "./trust-store.ts";

/**
 * Static trust declaration for an extension.
 *
 * The tier is read from `package.json` (`pkg.pi.trust`) and never from the
 * extension module: reading an export would execute the code the tier is meant
 * to gate.
 */

export const EXTENSION_TRUST_TIERS = ["declarative", "hosted", "trusted"] as const;

export type ExtensionTrust = (typeof EXTENSION_TRUST_TIERS)[number];

export interface ExtensionCapabilities {
	/** Absolute paths, or paths starting with `${project}` / `${home}`. */
	fsRoots?: string[];
	/** Environment variable names the extension may read. */
	env?: string[];
	/** Command basenames the extension may spawn. */
	spawn?: string[];
}

export interface ExtensionTrustManifest {
	trust: ExtensionTrust;
	capabilities: ExtensionCapabilities;
	/** False when `package.json` has no `pi.trust`; the tier is then the default. */
	declared: boolean;
	/** Set when a declaration was present but could not be used. */
	issue?: string;
}

/**
 * Tier used for an extension that does not declare one.
 *
 * `trusted` keeps every existing extension working. Flipping this to
 * `declarative` is a separate change, because the bundled examples import
 * `node:fs` and `node:child_process` directly.
 */
export const DEFAULT_EXTENSION_TRUST: ExtensionTrust = "trusted";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = value.filter((entry): entry is string => typeof entry === "string");
	return strings.length === value.length ? strings : undefined;
}

function readCapabilities(value: unknown): ExtensionCapabilities | undefined {
	if (!isObject(value)) return undefined;
	const capabilities: ExtensionCapabilities = {};
	const fsRoots = stringArray(value.fsRoots);
	if (fsRoots) capabilities.fsRoots = fsRoots;
	const env = stringArray(value.env);
	if (env) capabilities.env = env;
	const spawn = stringArray(value.spawn);
	if (spawn) capabilities.spawn = spawn;
	return capabilities;
}

/**
 * Read the trust declaration of the extension whose `package.json` lives at
 * `packageJsonPath`. A missing or unreadable file yields the default tier with
 * `declared: false`; a present but invalid declaration yields the default tier
 * with an `issue`, so the caller can warn instead of failing.
 */
export function readExtensionTrust(packageJsonPath: string): ExtensionTrustManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8")));
	} catch {
		return { trust: DEFAULT_EXTENSION_TRUST, capabilities: {}, declared: false };
	}
	if (!isObject(parsed) || !isObject(parsed.pi)) {
		return { trust: DEFAULT_EXTENSION_TRUST, capabilities: {}, declared: false };
	}

	const capabilities = readCapabilities(parsed.pi.capabilities) ?? {};
	const declaredTrust = parsed.pi.trust;
	if (declaredTrust === undefined) {
		return { trust: DEFAULT_EXTENSION_TRUST, capabilities, declared: false };
	}
	const trust = EXTENSION_TRUST_TIERS.find((tier) => tier === declaredTrust);
	if (!trust) {
		return {
			trust: DEFAULT_EXTENSION_TRUST,
			capabilities,
			declared: false,
			issue: `unknown trust tier ${JSON.stringify(declaredTrust)}; using ${DEFAULT_EXTENSION_TRUST}`,
		};
	}
	return { trust, capabilities, declared: true };
}

export interface ExtensionTrustRow {
	/** Absolute path of the extension file or directory. */
	path: string;
	trust: ExtensionTrust;
	capabilities: ExtensionCapabilities;
	declared: boolean;
	/** `sha256:` digest of the extension's source files. */
	hash: string;
	authorized: boolean;
	issue?: string;
}

function isExtensionFile(name: string): boolean {
	return name.endsWith(".ts") || name.endsWith(".js");
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Extensions discovered in `dir`, following the loader's one-level rules: a
 * `*.ts`/`*.js` file, or a subdirectory holding a `package.json` or an
 * `index.ts`/`index.js`.
 */
function discoverInDir(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const entryPath = join(dir, entry.name);
		if (entry.isFile() && isExtensionFile(entry.name)) {
			found.push(entryPath);
			continue;
		}
		if (!isDirectory(entryPath)) continue;
		if (existsSync(join(entryPath, "package.json"))) {
			found.push(entryPath);
			continue;
		}
		if (existsSync(join(entryPath, "index.ts")) || existsSync(join(entryPath, "index.js"))) {
			found.push(entryPath);
		}
	}
	return found;
}

function rowFor(entryPath: string, store: ExtensionTrustStore): ExtensionTrustRow {
	const target = resolve(entryPath);
	const packageJsonPath = join(target, "package.json");
	const isDir = isDirectory(target);
	const manifest = isDir
		? readExtensionTrust(packageJsonPath)
		: { trust: DEFAULT_EXTENSION_TRUST, capabilities: {}, declared: false };
	const hash = extensionHash(target);
	return {
		path: target,
		trust: manifest.trust,
		capabilities: manifest.capabilities,
		declared: manifest.declared,
		hash,
		authorized: isAuthorized(store, target, hash),
		...(manifest.issue === undefined ? {} : { issue: manifest.issue }),
	};
}

/**
 * One row per extension found under `roots` (one level deep), sorted by path so
 * the output is stable.
 */
export function listExtensionTrust(roots: readonly string[], store: ExtensionTrustStore): ExtensionTrustRow[] {
	const paths = roots.flatMap((root) => discoverInDir(root));
	const unique = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
	return unique.map((entryPath) => rowFor(entryPath, store));
}

function describeCapabilities(capabilities: ExtensionCapabilities): string {
	const parts: string[] = [];
	if (capabilities.fsRoots?.length) parts.push(`fs:${capabilities.fsRoots.length}`);
	if (capabilities.env?.length) parts.push(`env:${capabilities.env.length}`);
	if (capabilities.spawn?.length) parts.push(`spawn:${capabilities.spawn.length}`);
	return parts.length > 0 ? parts.join(",") : "-";
}

/**
 * Fixed-width table for `mu extensions`. The column order is part of the
 * command's output and is covered by a test.
 */
export function formatExtensionTrustTable(rows: readonly ExtensionTrustRow[]): string {
	const header = ["TRUST", "DECLARED", "AUTH", "CAPABILITIES", "PATH"];
	const body = rows.map((row) => [
		row.trust,
		row.declared ? "yes" : "no",
		row.authorized ? "yes" : "no",
		describeCapabilities(row.capabilities),
		row.path,
	]);
	const widths = header.map((title, index) =>
		Math.max(title.length, ...body.map((cells) => cells[index]?.length ?? 0)),
	);
	const line = (cells: readonly string[]): string =>
		cells
			.map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
			.join("  ")
			.trimEnd();
	const lines = [line(header), ...body.map(line)];
	for (const row of rows) {
		if (row.issue) lines.push(`warning: ${row.path}: ${row.issue}`);
	}
	return lines.join("\n");
}
