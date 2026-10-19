// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Where the mu harness is, and how to start it.
 *
 * The rules are the old shell's (`desktop/packages/desktop/src/process/agent/kyrn/harness.ts`, carried over and
 * trimmed here; this directory is Apache-2.0, see NOTICE) and they are the harness launcher's own:
 *
 * - `MU_ROOT` / `KYRN_ROOT` wins, as in development.
 * - then the copy a packaged app carries in its resources folder (`<resources>/harness/mu-agent`);
 * - then a checkout beside the desktop's: `../KYRN` (two repositories side by side) or `..` (this monorepo);
 * - then a `mu` installed with npm: the `mu` on PATH, followed to its `kyrn/bin`, or a global `node_modules`
 *   folder.
 *
 * Every function takes its dependencies, so the tests need neither Electron nor this machine's folders.
 */

export type HarnessLayout = "repo" | "package";

/** `env`: MU_ROOT/KYRN_ROOT. `bundled`: the copy inside the packaged app. `beside`: a checkout next to this one. `global`: an npm install. */
export type HarnessSource = "env" | "bundled" | "beside" | "global";

export type Harness = { readonly root: string; readonly layout: HarnessLayout; readonly source: HarnessSource };

export type HarnessDeps = {
	readonly platform: NodeJS.Platform;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly home: string;
	readonly exists: (file: string) => boolean;
	/** A directory's entries; empty when it cannot be read. */
	readonly list: (dir: string) => string[];
	/** A path with its links resolved; the path itself when it cannot be. */
	readonly real: (file: string) => string;
	/** Electron's resources folder (`process.resourcesPath`). Undefined outside a packaged app. */
	readonly resourcesPath: string | undefined;
};

export const PACKAGE_NAME = "mu-agent";

/** pi's minimum, the same as the harness launcher's. */
export const MIN_NODE: readonly [number, number] = [22, 19];

export function nodeVersionOk(version: string): boolean {
	const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
	return (major ?? 0) > MIN_NODE[0] || ((major ?? 0) === MIN_NODE[0] && (minor ?? 0) >= MIN_NODE[1]);
}

type Paths = typeof posix;

function pathFor(platform: NodeJS.Platform): Paths {
	return platform === "win32" ? win32 : posix;
}

function defaults(): HarnessDeps {
	return {
		platform: process.platform,
		env: process.env,
		home: homedir(),
		exists: existsSync,
		list: (dir) => {
			try {
				return readdirSync(dir);
			} catch {
				return [];
			}
		},
		real: (file) => {
			try {
				return realpathSync(file);
			} catch {
				return file;
			}
		},
		// Set by Electron, also when it runs as Node; plain Node has none.
		resourcesPath: (process as { resourcesPath?: string }).resourcesPath,
	};
}

/** What the harness's own `layoutOf` says: a checkout without its dependencies is still a checkout. */
export function layoutOf(root: string, deps: Pick<HarnessDeps, "platform" | "exists">): HarnessLayout {
	const p = pathFor(deps.platform);
	if (deps.exists(p.join(root, "packages", "coding-agent", "package.json"))) return "repo";
	return deps.exists(p.join(root, "dist", "bundle", "cli.js")) ? "package" : "repo";
}

/** A folder holding mu: its Node launcher is there. */
export function holdsMu(root: string, deps: Pick<HarnessDeps, "platform" | "exists">): boolean {
	return deps.exists(pathFor(deps.platform).join(root, "kyrn", "bin", "mu.mjs"));
}

function envValue(deps: HarnessDeps, name: string): string | undefined {
	const value = deps.env[`MU_${name}`] || deps.env[`KYRN_${name}`];
	return value !== undefined && value !== "" ? value : undefined;
}

/** `mu` on PATH, followed to the folder it belongs to: npm links it to `<package>/kyrn/bin/mu.mjs`. */
export function muOnPath(deps: HarnessDeps): string | undefined {
	const p = pathFor(deps.platform);
	// A Windows shim (`mu.cmd`) is a file that points at the launcher; following it is the global folder's job.
	if (deps.platform === "win32") return undefined;
	for (const dir of (deps.env.PATH ?? "").split(p.delimiter).filter(Boolean)) {
		const link = p.join(dir, "mu");
		if (!deps.exists(link)) continue;
		const target = deps.real(link);
		const bin = p.dirname(target);
		if (p.basename(bin) === "bin" && p.basename(p.dirname(bin)) === "kyrn") return p.dirname(p.dirname(bin));
	}
	return undefined;
}

/** Where the packaged app carries mu: the npm package with its dependencies, in its resources folder. */
export function bundledHarnessRoot(resourcesPath: string, platform: NodeJS.Platform): string {
	return pathFor(platform).join(resourcesPath, "harness", PACKAGE_NAME);
}

const versionParts = (name: string): number[] => name.replace(/^v/, "").split(".").map(Number);

/** Newest first, by the numbers in a Node version folder name such as `v24.16.0`. */
function byVersion(a: string, b: string): number {
	const x = versionParts(a);
	const y = versionParts(b);
	for (let index = 0; index < 3; index++) if ((x[index] ?? 0) !== (y[index] ?? 0)) return (y[index] ?? 0) - (x[index] ?? 0);
	return 0;
}

/**
 * Global `node_modules` folders npm may have installed `mu-agent` into, most likely first. A GUI app's PATH is short,
 * so the usual prefixes are listed too, not only what PATH points at.
 */
export function globalModuleDirs(deps: HarnessDeps): string[] {
	const { platform, env, home } = deps;
	const p = pathFor(platform);
	const pathDirs = (env.PATH ?? "").split(p.delimiter).filter(Boolean);
	const dirs: string[] = [];
	if (platform === "win32") {
		// npm's shims (mu.cmd) sit in the prefix, beside its node_modules: %APPDATA%\npm, or nvm-windows' node folder.
		for (const dir of pathDirs) if (deps.exists(p.join(dir, "mu.cmd"))) dirs.push(p.join(dir, "node_modules"));
		if (env.APPDATA) dirs.push(p.join(env.APPDATA, "npm", "node_modules"));
		const prefix = env.npm_config_prefix || env.NPM_CONFIG_PREFIX;
		if (prefix) dirs.push(p.join(prefix, "node_modules"));
		return [...new Set(dirs)];
	}
	const prefixes: (string | undefined)[] = [env.npm_config_prefix, env.NPM_CONFIG_PREFIX, p.join(home, ".npm-global")];
	// nvm: every installed Node has its own global folder.
	const nvm = p.join(env.NVM_DIR || p.join(home, ".nvm"), "versions", "node");
	prefixes.push(...deps.list(nvm).sort(byVersion).map((version) => p.join(nvm, version)));
	prefixes.push("/opt/homebrew", "/usr/local", "/usr");
	for (const prefix of prefixes) if (prefix) dirs.push(p.join(prefix, "lib", "node_modules"));
	return [...new Set(dirs)];
}

/**
 * The harness this app runs. Undefined when there is none: the caller shows where it looked, which is more useful
 * than a white window.
 */
export function findHarness(desktopRoot: string | undefined, patch: Partial<HarnessDeps> = {}): Harness | undefined {
	const deps = { ...defaults(), ...patch };
	const p = pathFor(deps.platform);
	const found = (root: string, source: HarnessSource): Harness => ({ root, layout: layoutOf(root, deps), source });

	const named = envValue(deps, "ROOT");
	if (named) return found(p.resolve(named), "env");

	const bundled = deps.resourcesPath ? bundledHarnessRoot(deps.resourcesPath, deps.platform) : undefined;
	if (bundled && holdsMu(bundled, deps)) return found(bundled, "bundled");

	const besides = desktopRoot ? [p.join(desktopRoot, "..", "KYRN"), p.join(desktopRoot, "..")] : [];
	for (const beside of besides) {
		const root = p.resolve(beside);
		if (holdsMu(root, deps)) return found(root, "beside");
	}

	const linked = muOnPath(deps);
	if (linked && holdsMu(linked, deps)) return found(linked, "global");

	for (const dir of globalModuleDirs(deps)) {
		const root = p.join(dir, PACKAGE_NAME);
		if (holdsMu(root, deps)) return found(root, "global");
	}
	return undefined;
}

/**
 * Where mu should have been when none was found: in the packaged app (no desktop checkout, a resources folder) the
 * copy it carries, which only a broken build lacks; in development the checkout beside this one.
 */
export function expectedHarness(
	desktopRoot: string | undefined,
	resourcesPath: string | undefined,
	platform: NodeJS.Platform = process.platform,
): { readonly root: string; readonly layout: HarnessLayout } {
	if (!desktopRoot && resourcesPath) return { root: bundledHarnessRoot(resourcesPath, platform), layout: "package" };
	return { root: pathFor(platform).resolve(desktopRoot ?? ".", "..", "KYRN"), layout: "repo" };
}

/**
 * What starts: the bash forwarder of a checkout on macOS and Linux (it picks a Node that can run pi), else the Node
 * launcher itself, which the app runs on its own binary with `ELECTRON_RUN_AS_NODE=1`.
 */
export function launcherOf(harness: Pick<Harness, "root" | "layout">, platform: NodeJS.Platform): string {
	const p = pathFor(platform);
	if (platform !== "win32" && harness.layout === "repo") return p.join(harness.root, "kyrn", "bin", "kyrn");
	return p.join(harness.root, "kyrn", "bin", "mu.mjs");
}

/**
 * The command that starts the harness. A packaged app has no `node` on PATH, so it runs the launcher on its own
 * binary as Node; a checkout on macOS/Linux goes through the forwarder, which finds a Node for it.
 */
export function launchCommand(
	harness: Pick<Harness, "root" | "layout">,
	options: { readonly platform: NodeJS.Platform; readonly processExecPath: string; readonly packaged: boolean },
): { readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> } {
	const command = launcherOf(harness, options.platform);
	const viaNode = options.platform === "win32" || options.packaged || command.endsWith("mu.mjs");
	if (!viaNode) return { command, args: [], env: {} };
	return {
		command: options.processExecPath,
		args: [command],
		env: { ELECTRON_RUN_AS_NODE: "1" },
	};
}

/** The .env the harness reads its keys from: the checkout's, or for the npm package the one in mu's home. */
export function envFileOf(harness: Pick<Harness, "root" | "layout">, home: string, platform: NodeJS.Platform): string {
	return pathFor(platform).join(harness.layout === "package" ? home : harness.root, ".env");
}
