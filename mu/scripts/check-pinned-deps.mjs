import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every dependency in this repository is an exact version: a range turns "it works here" into "it worked
 * when the lockfile was written", and a lockfile is only reviewed when somebody bumps a number.
 *
 * Two places are different on purpose:
 *
 * - `desktop/` is the AionUi fork, frozen while the new shell is built. It arrived with ~150 caret ranges;
 *   cleaning them is not this repository's job today, but letting a new one in is. So it runs in whitelist
 *   mode: the ranges that exist are listed once, anything new fails, and the list only ever shrinks.
 * - `desktop-next/` (when it exists) is ours and is held to the strict rule like the harness.
 */

const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];
const exactVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ignoredDirectories = new Set([".claude", ".git", "dist", "node_modules", ".artifacts", ".tmp"]);
const internalPackageNames = new Set(["@earendil-works/chord", "@earendil-works/pi-telemetry"]);

/** The file that records which non-exact ranges `desktop/` already had. It may lose entries, never gain. */
export const BASELINE_PATH = join("scripts", "pinned-deps-desktop-baseline.json");

/** Directories that are checked under their own rule instead of the strict one. */
const SPECIAL_DIRECTORIES = new Set(["desktop", "desktop-next"]);

export function isInternalWorkspaceDependency(name) {
	return name.startsWith("@earendil-works/pi-") || internalPackageNames.has(name);
}

function isNonRegistrySpecifier(specifier) {
	return /^(?:workspace:|file:|link:|portal:|git\+|github:|git:|https?:|ssh?:|git:\/\/|catalog:)/.test(specifier);
}

function getVersionSpecifier(specifier) {
	if (!specifier.startsWith("npm:")) return specifier;
	const aliasTarget = specifier.slice("npm:".length);
	const versionSeparator = aliasTarget.lastIndexOf("@");
	if (versionSeparator <= 0) return specifier;
	return aliasTarget.slice(versionSeparator + 1);
}

function isExact(specifier) {
	return exactVersionPattern.test(getVersionSpecifier(specifier));
}

function packageJsonPaths(root) {
	const found = [];
	const walk = (directory) => {
		let entries;
		try {
			entries = readdirSync(join(root, directory), { withFileTypes: true, encoding: "utf8" });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
			if (entry.isDirectory()) {
				if (!ignoredDirectories.has(entry.name)) walk(path);
				continue;
			}
			if (entry.isFile() && entry.name === "package.json") found.push(path);
		}
	};
	walk("");
	return found.sort();
}

function loadBaseline(root) {
	const path = join(root, BASELINE_PATH);
	if (!existsSync(path)) return new Set();
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		// Keys are `<directory>:<section>.<name>` with forward slashes; normalize so a Windows-written file matches.
		return new Set(Array.isArray(value.ranges) ? value.ranges.map((entry) => String(entry).replaceAll("\\", "/")) : []);
	} catch {
		return new Set();
	}
}

/**
 * What is not pinned, as sentences. `root` defaults to this checkout, so a test can point it at a fixture.
 *
 * Returns `{ failures, stale }`: `failures` block the check, `stale` are whitelist entries whose range is
 * gone (noise, printed so the list can shrink).
 */
export function pinnedDependencyProblems(options = {}) {
	const root = options.root ?? process.cwd();
	const baseline = options.baseline ?? loadBaseline(root);
	const failures = [];
	const stale = new Set(baseline);

	for (const file of packageJsonPaths(root)) {
		const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
		const special = SPECIAL_DIRECTORIES.has(directory);
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
		} catch (error) {
			failures.push(`${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		for (const section of dependencySections) {
			const dependencies = manifest[section];
			if (!dependencies) continue;
			for (const [name, specifier] of Object.entries(dependencies)) {
				if (typeof specifier !== "string") continue;
				if (isInternalWorkspaceDependency(name) || isNonRegistrySpecifier(specifier)) continue;
				if (isExact(specifier)) continue;
				const key = `${directory}:${section}.${name}`;
				if ((directory === "desktop" || directory.startsWith("desktop/")) && baseline.has(key)) {
					stale.delete(key);
					continue;
				}
				failures.push(
					`${file}: ${section}.${name} is ${specifier}. Use the exact version (${exampleExact(specifier)}), or move it to ${BASELINE_PATH} if this is the frozen desktop shell.`,
				);
				void special;
			}
		}
	}
	return { failures, stale: [...stale].sort() };
}

/** `^1.2.3` → `1.2.3`: what the fix looks like, so the message can be acted on without a search. */
export function exampleExact(specifier) {
	const bare = String(specifier).replace(/^[\^~]|\*$/g, "");
	return exactVersionPattern.test(bare) ? bare : "<the resolved version>";
}

/**
 * The lockfile has to describe the manifests *and be installable*. A manifest edited without refreshing the lockfile is
 * exactly the drift that makes `npm ci` fail on somebody else's machine; a lockfile whose entries are missing the
 * dependencies those entries declare is the same failure one level down — `npm ci` refuses a tree it cannot build, and
 * every CI job starts with `npm ci`. (`npm install --package-lock-only --ignore-scripts` fixes both; a lockfile written
 * with `omit=optional` from a user-level npmrc is the usual way the second one happens.)
 */
export function lockfileProblems(options = {}) {
	const root = options.root ?? process.cwd();
	const lockPath = join(root, "package-lock.json");
	if (!existsSync(lockPath)) return [];
	let lock;
	try {
		lock = JSON.parse(readFileSync(lockPath, "utf8"));
	} catch (error) {
		return [`package-lock.json cannot be read: ${error instanceof Error ? error.message : String(error)}`];
	}
	const packages = lock.packages;
	if (typeof packages !== "object" || packages === null) return ["package-lock.json has no packages map"];
	const problems = [];
	const managed = workspaceDirectories(root);
	for (const file of packageJsonPaths(root)) {
		if (file.startsWith("desktop/") || file.startsWith("desktop-next/")) continue;
		const managedDirectory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
		// A spike or an example has its own dependencies and no place in the root lockfile.
		if (!managed.has(managedDirectory)) continue;
		const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
		const key = directory === "" ? "" : directory;
		const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
		const locked = packages[key];
		if (!locked) {
			problems.push(`package-lock.json has no entry for ${directory || "."}: run npm install --package-lock-only --ignore-scripts`);
			continue;
		}
		if (manifest.version !== undefined && locked.version !== manifest.version) {
			problems.push(`${file}: manifest version ${manifest.version}, lockfile ${String(locked.version)}`);
		}
		for (const section of dependencySections) {
			for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
				const lockedSpecifier = locked[section]?.[name];
				if (lockedSpecifier === undefined) {
					problems.push(`${file}: ${section}.${name} is missing from package-lock.json`);
				} else if (lockedSpecifier !== specifier) {
					problems.push(`${file}: ${section}.${name} is ${specifier} in the manifest, ${lockedSpecifier} in the lockfile`);
				}
			}
		}
	}
	problems.push(...danglingLockEntries(packages));
	return problems;
}

/**
 * Every dependency a locked package declares needs an entry the installer can reach, or `npm ci` refuses the tree. The
 * lookup is npm's own: from the package's own `node_modules`, then each ancestor's.
 */
export function danglingLockEntries(packages) {
	const problems = [];
	const names = Object.keys(packages);
	const resolve = (from, dependency) => {
		// `packages/<dir>` → the directories above it, then the root, each with `node_modules/<dependency>` beside it.
		let base = from;
		for (;;) {
			const candidate = base === "" ? `node_modules/${dependency}` : `${base}/node_modules/${dependency}`;
			if (packages[candidate] !== undefined) return candidate;
			if (base === "") return undefined;
			const cut = base.lastIndexOf("/node_modules/");
			if (cut !== -1) {
				base = base.slice(0, cut);
				continue;
			}
			if (base.startsWith("node_modules/")) {
				base = "";
				continue;
			}
			const lastSlash = base.lastIndexOf("/");
			base = lastSlash === -1 ? "" : base.slice(0, lastSlash);
		}
	};
	for (const name of names) {
		if (name === "") continue;
		const entry = packages[name];
		if (typeof entry !== "object" || entry === null) continue;
		if (entry.link === true) continue;
		const bundled = new Set([...(entry.bundleDependencies ?? []), ...(entry.bundledDependencies ?? [])]);
		for (const section of ["dependencies", "optionalDependencies"]) {
			for (const [dependency, specifier] of Object.entries(entry[section] ?? {})) {
				if (bundled.has(dependency)) continue;
				if (typeof specifier !== "string") continue;
				if (/^(?:file:|link:|workspace:)/.test(specifier)) continue;
				if (resolve(name, dependency) !== undefined) continue;
				problems.push(
					`${name} declares ${section}.${dependency}, and package-lock.json has no entry for it: run npm install --package-lock-only --ignore-scripts --include=optional`,
				);
			}
		}
	}
	return problems;
}

/** The directories npm actually manages: the root plus what `workspaces` expands to. */
function workspaceDirectories(root) {
	const manifestPath = join(root, "package.json");
	const patterns = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")).workspaces ?? []) : [];
	const directories = new Set([""]);
	for (const pattern of Array.isArray(patterns) ? patterns : []) {
		const normalized = String(pattern).replace(/\/+$/, "");
		if (!normalized.endsWith("/*")) {
			directories.add(normalized);
			continue;
		}
		const parent = normalized.slice(0, -2);
		let entries;
		try {
			entries = readdirSync(join(root, parent), { withFileTypes: true, encoding: "utf8" });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isDirectory() && existsSync(join(root, parent, entry.name, "package.json"))) {
				directories.add(`${parent}/${entry.name}`);
			}
		}
	}
	return directories;
}

function invokedDirectly() {
	const entry = process.argv[1];
	if (!entry) return false;
	const normalized = entry.replaceAll("\\", "/");
	return normalized.endsWith("scripts/check-pinned-deps.mjs");
}

if (invokedDirectly()) {
	const { failures, stale } = pinnedDependencyProblems();
	const lockProblems = optionsWithLock() ? lockfileProblems() : [];
	const all = [...failures, ...lockProblems];
	if (stale.length > 0) {
		console.log(`older whitelist entries no longer needed (remove from ${BASELINE_PATH}): ${stale.join(", ")}`);
	}
	if (all.length > 0) {
		console.error("Dependencies must be exact and the lockfile must match the manifests:");
		for (const problem of all) console.error(`  ${problem}`);
		process.exit(1);
	}
	console.log("Every dependency is pinned and package-lock.json matches the manifests.");
}

/** The lockfile check runs in `check`; a test calls the functions above instead. */
function optionsWithLock() {
	return true;
}
