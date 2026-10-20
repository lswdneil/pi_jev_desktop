#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * What is inside the packaged app, checked before anyone is asked to install it.
 *
 * `electron-builder` will happily pack anything a production dependency pulls in. The shell has no runtime
 * dependencies (the harness it starts ships beside the archive, staged from `.artifacts/desktop-harness`), so the
 * archive should hold the build and the manifest and little else; a `dependencies` entry that only exists for its
 * types put the whole pi toolchain inside it once, 243 MB per installer, and nothing failed until the artifact was
 * unpacked and measured. The budget below is what turns that into a failure.
 *
 *   node scripts/check-package.mjs desktop-next/dist
 *   node scripts/check-package.mjs desktop-next/dist --require-harness
 *
 * Two things it does not do: it does not scan the Electron runtime for secrets (a locale pack and the SwiftShader
 * libraries match a key pattern by accident; `check-artifacts.mjs` keeps that job for test artifacts), and it does
 * not verify a signature — that is `signtool verify` in the packaging workflow, and it needs a certificate.
 *
 * It does refuse a package older than the inputs it should contain: an artifact whose build or staged harness is
 * newer than the artifact itself describes code nobody has any more. `--allow-stale` exists for the one legitimate
 * case, inspecting a package downloaded from somewhere else.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { FORBIDDEN_NAMES } from "./check-artifacts.mjs";

/**
 * The archive holds the shell's own build: 729 KiB on the first measured build, and the budget leaves room for the
 * renderer to grow inside its own limit (630 KiB today) without opening the door to a bundled toolchain (243 MB).
 */
export const ASAR_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * The installer budget is the shell decision's own threshold (`docs/performance-budget.md`, the fourth gate: an
 * installer over 180 MB is what reopens the Tauri question). Measured at 116.7 MiB for Windows x64, so this is a
 * ceiling with room, not a target: it exists because a target that declares two architectures built a 237 MB combined
 * installer, which would have crossed the line without anyone deciding to.
 */
export const INSTALLER_BUDGET_BYTES = 180 * 1024 * 1024;

/** The installer each platform's packager leaves in `dist`, for the `--require-installer` check. */
export const INSTALLER_EXTENSIONS = [".exe", ".dmg", ".zip", ".AppImage", ".deb"];

/** The executable each package layout carries, so an empty stage does not pass as a package. */
const EXECUTABLES = {
	"win-unpacked": ["spec.ai.jev.exe"],
	"linux-unpacked": ["spec.ai.jev"],
	mac: ["spec.ai.jev.app/Contents/MacOS/spec.ai.jev"],
};

/** The installers in a `dist` folder: what a user downloads, as opposed to the unpacked layout it was built from. */
export function installerFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && INSTALLER_EXTENSIONS.some((extension) => entry.name.endsWith(extension)))
		.map((entry) => entry.name)
		.sort();
}

/** Every packaged layout in a `dist` folder, with the resources folder each one has. */
function layouts(directory) {
	const found = [];
	if (!existsSync(directory)) return found;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "win-unpacked" || entry.name === "linux-unpacked") {
			found.push({ name: entry.name, root: join(directory, entry.name), resources: join(directory, entry.name, "resources") });
		} else if (entry.name === "mac" || entry.name === "mac-arm64") {
			const apps = readdirSync(join(directory, entry.name), { withFileTypes: true }).filter((child) => child.name.endsWith(".app"));
			for (const app of apps) {
				const root = join(directory, entry.name, app.name);
				found.push({ name: `${entry.name}/${app.name}`, root, resources: join(root, "Contents", "Resources") });
			}
		}
	}
	return found;
}

/** Files a package must not carry: the same names the trace scan refuses. */
function forbiddenFiles(directory, prefix = "") {
	const problems = [];
	if (!existsSync(directory)) return problems;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) problems.push(...forbiddenFiles(path, relative));
		else if (FORBIDDEN_NAMES.includes(entry.name)) problems.push(`${relative} is a credentials file by name and must not ship`);
	}
	return problems;
}

function bytes(path) {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

/**
 * The harness declares what it needs at runtime, and inside the app it gets those from its own `node_modules` — there
 * is no npm install on a user's machine. A package that carries the harness but not its dependencies starts, then
 * exits with `Cannot find module 'jiti'` when the agent loads the judge extension.
 */
function harnessDependencyProblems(layout, harness) {
	const problems = [];
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(harness, "package.json"), "utf8"));
	} catch {
		return [`${layout}: the harness carries no readable package.json`];
	}
	for (const name of Object.keys(manifest.dependencies ?? {})) {
		if (!existsSync(join(harness, "node_modules", name))) {
			problems.push(`${layout}: the harness needs ${name} in its node_modules and the package does not carry it`);
		}
	}
	return problems;
}

/** The newest file under `path`, or undefined when there is none. A missing path is not an error here. */
function newestFile(path) {
	if (!existsSync(path)) return undefined;
	let newest;
	const walk = (current) => {
		const stats = statSync(current);
		if (!stats.isDirectory()) {
			if (newest === undefined || stats.mtimeMs > newest.modified) newest = { modified: stats.mtimeMs, path: current };
			return;
		}
		for (const entry of readdirSync(current)) walk(join(current, entry));
	};
	walk(path);
	return newest;
}

/**
 * The files a package in `directory` is built from: the shell's build output, its manifest and packaging config, and
 * the harness staged beside the shell. A `dist` copied from another machine has none of them, which is why a missing
 * input is skipped rather than reported.
 */
export function packageInputs(directory) {
	const shell = dirname(directory);
	return [
		join(shell, "out"),
		join(shell, "package.json"),
		join(shell, "electron-builder.yml"),
		join(dirname(shell), ".artifacts", "desktop-harness"),
	];
}

/** A package older than the inputs it should contain describes code nobody has any more. */
export function freshnessProblems(directory) {
	const built = newestFile(directory);
	if (built === undefined) return [];
	for (const input of packageInputs(directory)) {
		const newest = newestFile(input);
		if (newest !== undefined && newest.modified > built.modified) {
			return [`${directory} is older than ${newest.path}: it does not contain the current build — run \`npm run package\``];
		}
	}
	return [];
}

/**
 * The harness inside the package is built from this repository: `kyrn/npm/build.mjs` bundles the workspace's sources
 * into `spec-ai-agent`, and the packaged app starts *that*. A staged harness older than the sources it bundles means the
 * package starts code the repository no longer has — the same staleness the build and coverage gates refuse, one
 * level down. Only a checkout that has this repository's layout is judged: a package copied elsewhere has no sources
 * to compare against.
 */
export function harnessFreshnessProblems(directory) {
	const shell = dirname(directory);
	const root = dirname(shell);
	if (!existsSync(join(root, "packages", "kyrn-judge"))) return [];
	const built = newestFile(join(root, ".artifacts", "desktop-harness", "spec-ai-agent"));
	if (built === undefined) return [];
	const inputs = [];
	const packages = join(root, "packages");
	for (const entry of readdirSync(packages, { withFileTypes: true })) {
		if (entry.isDirectory()) inputs.push(join(packages, entry.name, "src"));
	}
	inputs.push(join(root, "kyrn", "bin"), join(root, "kyrn", "npm", "build.mjs"), join(packages, "kyrn-judge", "manifest.json"));
	for (const input of inputs) {
		const newest = newestFile(input);
		if (newest !== undefined && newest.modified > built.modified) {
			return [
				`${join(root, ".artifacts", "desktop-harness", "spec-ai-agent")} is older than ${newest.path}: the package would bundle a harness built before the sources it contains — run \`node kyrn/npm/build.mjs\`, stage the package again, and repackage`,
			];
		}
	}
	return [];
}

/** What is wrong with a packaged `dist` folder. Empty means it is what a user may be asked to install. */
export function packageProblems(directory, options = {}) {
	const found = layouts(directory);
	if (found.length === 0) return [`${directory}: no packaged layout (win-unpacked, linux-unpacked, mac/*.app)`];

	const problems = [];
	for (const layout of found) {
		const expected = EXECUTABLES[layout.name.split("/")[0]] ?? [];
		for (const executable of expected) {
			if (!existsSync(join(layout.root, executable))) problems.push(`${layout.name}: no ${executable}`);
		}

		const archive = join(layout.resources, "app.asar");
		if (!existsSync(archive)) {
			problems.push(`${layout.name}: no resources/app.asar, so the app's own build was not packed`);
		} else {
			const size = bytes(archive);
			if (size > ASAR_BUDGET_BYTES) {
				const megabytes = (size / (1024 * 1024)).toFixed(1);
				const budget = ASAR_BUDGET_BYTES / (1024 * 1024);
				problems.push(`${layout.name}: app.asar is ${megabytes} MB, over its ${budget} MB budget: something large is a runtime dependency`);
			}
			problems.push(...forbiddenFiles(layout.resources).map((problem) => `${layout.name}: ${problem}`));
		}

		const harness = join(layout.resources, "harness", "spec-ai-agent");
		if (options.requireHarness === true && !existsSync(harness)) {
			problems.push(`${layout.name}: no resources/harness/spec-ai-agent, so the packaged app has no harness to start`);
		} else if (existsSync(harness)) {
			problems.push(...harnessDependencyProblems(layout.name, harness));
		}
	}

	problems.push(...installerProblems(directory, options));
	if (options.allowStale !== true) {
		problems.push(...freshnessProblems(directory));
		problems.push(...harnessFreshnessProblems(directory));
	}
	return problems;
}

/**
 * The installers themselves: there has to be one when the release asks for one, and it has to stay under the size the
 * shell decision was made with. A `--dir` build has none, which is why the requirement is a flag.
 */
function installerProblems(directory, options) {
	const installers = installerFiles(directory);
	const problems = [];
	if (options.requireInstaller === true && installers.length === 0) {
		problems.push(`${directory}: no installer (${INSTALLER_EXTENSIONS.join(", ")}), so there is nothing for a user to run`);
	}
	for (const name of installers) {
		const size = bytes(join(directory, name));
		if (size > INSTALLER_BUDGET_BYTES) {
			const megabytes = (size / (1024 * 1024)).toFixed(1);
			const budget = INSTALLER_BUDGET_BYTES / (1024 * 1024);
			problems.push(`${name}: ${megabytes} MB, over the ${budget} MB installer budget that keeps the shell decision valid`);
		}
	}
	return problems;
}

/** What a person would want to know about a package that passed, in one line per layout. */
export function describePackage(directory, options = {}) {
	const lines = layouts(directory).map((layout) => {
		const archive = bytes(join(layout.resources, "app.asar"));
		const harness = existsSync(join(layout.resources, "harness", "spec-ai-agent"));
		const megabytes = (archive / (1024 * 1024)).toFixed(2);
		const harnessNote = harness ? "harness staged" : options.requireHarness === true ? "harness missing" : "no harness (a local --dir build does not stage one)";
		return `${layout.name}: app.asar ${megabytes} MB, ${harnessNote}`;
	});
	for (const name of installerFiles(directory)) {
		const megabytes = (bytes(join(directory, name)) / (1024 * 1024)).toFixed(1);
		lines.push(`${name}: ${megabytes} MB installer`);
	}
	return lines;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const args = process.argv.slice(2);
	const options = {
		requireHarness: args.includes("--require-harness"),
		requireInstaller: args.includes("--require-installer"),
		allowStale: args.includes("--allow-stale"),
	};
	const known = ["--require-harness", "--require-installer", "--allow-stale"];
	const unknown = args.find((argument) => argument.startsWith("--") && !known.includes(argument));
	const directory = args.find((argument) => !argument.startsWith("--")) ?? "desktop-next/dist";
	if (unknown !== undefined) {
		console.error(`package: unknown argument ${unknown}`);
		process.exitCode = 2;
	} else {
		const problems = packageProblems(directory, options);
		if (problems.length > 0) {
			for (const problem of problems) console.error(`package: ${problem}`);
			console.error(`\npackage: ${problems.length} problem(s)`);
			process.exitCode = 1;
		} else {
			for (const line of describePackage(directory, options)) console.log(`package: ${line}`);
		}
	}
}
