#!/usr/bin/env node

/**
 * The commands the documentation tells a reader to run, checked against the repository that has to have them.
 *
 * A release recipe that names a script nobody renamed is worse than no recipe: the operator runs the old command, gets
 * "Cannot find module", and has to work out from git history what replaced it. `check-workflows.mjs` already does this
 * for the workflows; this does it for the prose.
 *
 * What is checked, in every markdown file the repository tells a person to follow:
 *
 * - `npm run <script>` — the script exists in the root `package.json` or in `desktop-next/package.json` (both are places
 *   the docs send people);
 * - `node scripts/<file>`, `node packages/<path>`, `node kyrn/<path>`, `node bench/<path>` — the file exists;
 * - `./test.sh` — the file exists and is executable.
 *
 * What is not: a command inside a paragraph that only mentions it (`the `npm run check` step`), a placeholder argument, a
 * command for another tool (`git tag`, `gh release create`), or a line whose path starts with `$` or `<`. A command that
 * cannot be resolved and is not explained below fails the run, because that is the case worth reading.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The documents a contributor or an operator is expected to follow. */
export const DOCUMENTS = [
	"README.md",
	"CONTRIBUTING.md",
	"docs/releasing.md",
	"docs/getting-started.md",
	"docs/configuration.md",
	"docs/troubleshooting.md",
	"docs/compatibility.md",
	"docs/performance-budget.md",
	"desktop-next/README.md",
];

/** Names that appear in prose as commands people type but are not files in this repository. */
const ALLOWED = new Map([
	["node scripts/local-release.mjs --skip-test", "documented as an example of the flags, the file exists"],
]);

/** Every `npm run <name>` in the text, with the line it is on. */
export function npmRunNames(text) {
	const found = [];
	const pattern = /\bnpm run ([a-z0-9][a-z0-9:_.-]*)/g;
	for (const match of text.matchAll(pattern)) {
		found.push({ name: match[1], line: lineOf(text, match.index ?? 0) });
	}
	return found;
}

/** Every `node <path>` where the path looks like a file in this repository. */
export function nodePaths(text) {
	const found = [];
	const pattern = /\bnode ((?:scripts|packages|kyrn|bench|desktop-next)\/[A-Za-z0-9_./-]+)/g;
	for (const match of text.matchAll(pattern)) {
		found.push({ path: match[1], line: lineOf(text, match.index ?? 0) });
	}
	return found;
}

/** `./test.sh` and friends. */
export function shellScripts(text) {
	const found = [];
	const pattern = /(?:^|[\s`(])(\.\/[A-Za-z0-9_./-]+\.sh)\b/g;
	for (const match of text.matchAll(pattern)) {
		found.push({ path: match[1].slice(2), line: lineOf(text, match.index ?? 0) });
	}
	return found;
}

function lineOf(text, index) {
	return text.slice(0, index).split("\n").length;
}

/** The scripts of a `package.json`, or undefined when the file is not there. */
function scriptsOf(path) {
	if (!existsSync(path)) return undefined;
	try {
		const manifest = JSON.parse(readFileSync(path, "utf8"));
		return new Set(Object.keys(manifest.scripts ?? {}));
	} catch {
		return undefined;
	}
}

/** The `cd <dir>` that a code block walks into, so a path after it is resolved against that directory. */
export function directoriesWalked(text, root = ROOT) {
	const seen = [];
	let current = "";
	for (const line of text.split("\n")) {
		const match = /^\s*cd\s+([^\s;&|]+)\s*$/.exec(line);
		if (match === null) {
			seen.push(current);
			continue;
		}
		const directory = match[1];
		if (directory === ".." || directory.startsWith("../")) {
			const parts = current.split("/").filter(Boolean);
			parts.pop();
			current = parts.join("/");
		} else if (directory.startsWith("/") || directory.startsWith("~") || directory.startsWith("$")) {
			current = "";
		} else {
			// A block usually starts from the repository root, so `cd desktop` after `cd packages/kyrn-judge` is the
			// top-level `desktop/`, not a folder inside the package. Where the joined path exists it is meant literally.
			const joined = current === "" ? directory : `${current}/${directory}`;
			current = existsSync(join(root, joined)) ? joined : directory;
		}
		seen.push(current);
	}
	return seen;
}

/** Everything wrong with the commands in `documents`, read through `read`. */
export function commandProblems(documents, read, root = ROOT) {
	const problems = [];
	const rootScripts = scriptsOf(join(root, "package.json")) ?? new Set();
	const desktopScripts = scriptsOf(join(root, "desktop-next", "package.json")) ?? new Set();
	const checkExecutable = process.platform !== "win32";
	for (const document of documents) {
		const text = read(join(root, document));
		if (text === undefined) {
			problems.push(`${document}: cannot be read, so its commands are not checked`);
			continue;
		}
		// The `cd` in force on each line: a block that says `cd desktop` first names `scripts/…` inside that folder.
		const walked = directoriesWalked(text, root);
		const resolve = (path, line) => {
			const candidates = [join(root, path)];
			const directory = walked[line - 1] ?? "";
			if (directory !== "") candidates.push(join(root, directory, path));
			return candidates.find((candidate) => existsSync(candidate));
		};
		for (const { name, line } of npmRunNames(text)) {
			if (rootScripts.has(name) || desktopScripts.has(name)) continue;
			if (ALLOWED.has(`npm run ${name}`)) continue;
			problems.push(`${document}:${line}: npm run ${name} is not a script in the root or desktop-next manifest`);
		}
		for (const { path, line } of nodePaths(text)) {
			if (path.includes("<") || path.includes("$")) continue;
			if (resolve(path, line) !== undefined) continue;
			if (ALLOWED.has(`node ${path}`)) continue;
			problems.push(`${document}:${line}: node ${path} does not exist (from the repository root or from the directory the block walks into)`);
		}
		for (const { path, line } of shellScripts(text)) {
			const full = resolve(path, line);
			if (full === undefined) {
				problems.push(`${document}:${line}: ./${path} does not exist`);
				continue;
			}
			// A script the docs run as `./x.sh` has to be executable, or the first command in the recipe fails. The bit
			// is not a property of a file on Windows, so the check is POSIX-only.
			if (checkExecutable && (statSync(full).mode & 0o111) === 0) {
				problems.push(`${document}:${line}: ./${path} is not executable`);
			}
		}
	}
	return problems;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const read = (path) => {
		try {
			return readFileSync(path, "utf8");
		} catch {
			return undefined;
		}
	};
	const problems = commandProblems(DOCUMENTS, read);
	if (problems.length === 0) console.log(`docs commands: ${DOCUMENTS.length} documents, every command names something that exists`);
	else {
		for (const problem of problems) console.error(`docs commands: ${problem}`);
		console.error(`docs commands: ${problems.length} problem(s)`);
		process.exitCode = 1;
	}
}
