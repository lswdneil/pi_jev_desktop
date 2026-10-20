#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors


/**
 * The licence each source file carries, as a rule rather than as a thousand edits.
 *
 * Nothing in this repository had an SPDX header, so a scanner sees every file as "unknown". Stamping the whole tree
 * would be a diff the size of the tree and would rewrite files that came from pi and AionUi; so the rule is:
 *
 * - files **added from now on** must say which licence they carry, and CI checks the ones a pull request adds;
 * - `desktop-next/` is Apache-2.0 while the rest is MIT, and the directory decides (a file there with an MIT header
 *   is a mistake, not a choice) — that rule is checked over the whole directory, not only over new files.
 *
 * Existing files keep whatever they have; `THIRD_PARTY_NOTICES.md` is what covers them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MIT_LICENSE = "MIT";
export const APACHE_LICENSE = "Apache-2.0";
export const COPYRIGHT_HOLDER = "the mu authors";

/**
 * The tag every header carries. Split in two so that this file does not itself declare a licence in its own source:
 * the detector would find the paragraph you are reading instead of the header at the top.
 */
const SPDX_TAG = "SPDX-License" + "-Identifier:";

/** Extensions that can carry a line comment. Everything else (JSON, Markdown, HTML) has its licence elsewhere. */
export const HEADER_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Directories whose files keep their own headers: the frozen AionUi fork, vendored licences, build output, and the
 * task benchmark's fixture repositories (they are other projects' code shapes, and their own licence story is the
 * benchmark's, not this repository's).
 */
export const SKIP_PREFIXES = [
	"desktop/",
	"packages/mcp/LICENSES/",
	"evals/tasks/",
	"node_modules/",
	"out/",
	"dist/",
	".artifacts/",
];

/** The Apache-2.0 tree. A new directory here needs its own entry, and `CONTRIBUTING.md` says why. */
export const APACHE_TREES = ["desktop-next/"];

/** The licence a file must declare, or undefined when this rule does not apply to it. */
export function licenseFor(path) {
	// A path can arrive from a shell on Windows; the rules are written with the repository's own separators.
	const relative = path.replaceAll("\\", "/");
	if (!HEADER_EXTENSIONS.some((extension) => relative.endsWith(extension))) return undefined;
	if (SKIP_PREFIXES.some((prefix) => relative.startsWith(prefix) || relative.includes(`/${prefix}`))) return undefined;
	return APACHE_TREES.some((prefix) => relative.startsWith(prefix)) ? APACHE_LICENSE : MIT_LICENSE;
}

/** The two lines a file carries. Two, not one: the licence alone does not say whose copyright it is. */
export function headerLines(license) {
	return [`// ${SPDX_TAG} ${license}`, `// Copyright (c) 2025-2026 ${COPYRIGHT_HOLDER}`];
}

/** What the file already declares, if anything. */
export function declaredLicense(text) {
	const match = new RegExp(`${SPDX_TAG}\\s*([^\\s*]+)`).exec(text);
	return match === null ? undefined : match[1];
}

/**
 * The file with its header, inserted after a shebang if there is one. A file that already declares the right licence
 * comes back unchanged, so stamping twice is not a diff.
 */
export function withHeader(text, license) {
	if (declaredLicense(text) === license) return text;
	const header = `${headerLines(license).join("\n")}\n\n`;
	const lines = text.split("\n");
	if (lines[0]?.startsWith("#!")) return `${lines[0]}\n${header}${lines.slice(1).join("\n")}`;
	return `${header}${text}`;
}

/**
 * The header problems in the files it is given. `files` is a list of `{ path, text }`; `newPaths` are the files a
 * change added, which must be stamped (the rest of the tree is not, on purpose).
 */
export function headerProblems(files, newPaths = []) {
	const problems = [];
	const added = new Set(newPaths.map((path) => path.replaceAll("\\", "/")));
	for (const { path, text } of files) {
		const license = licenseFor(path);
		if (license === undefined) continue;
		const relative = path.replaceAll("\\", "/");
		const declared = declaredLicense(text);
		if (declared === license) continue;
		if (declared !== undefined) {
			problems.push(`${relative} declares ${declared} but ${APACHE_TREES.some((prefix) => relative.startsWith(prefix)) ? APACHE_LICENSE : MIT_LICENSE} is what this tree carries`);
			continue;
		}
		if (added.has(relative)) {
			problems.push(`${relative} is new and has no SPDX header; run: node scripts/license-headers.mjs --stamp ${relative}`);
			continue;
		}
		if (APACHE_TREES.some((prefix) => relative.startsWith(prefix))) {
			problems.push(`${relative} is in an Apache-2.0 directory but has no SPDX header`);
		}
	}
	return problems;
}

/** Stamp the files named on the command line. Everything else is `license-check.mjs`'s business heading. */
function stamp(paths) {
	let stamped = 0;
	for (const path of paths) {
		const license = licenseFor(path);
		if (license === undefined) {
			console.error(`license-headers: ${path} does not take a header`);
			process.exitCode = 1;
			continue;
		}
		const text = readFileSync(path, "utf8");
		const next = withHeader(text, license);
		if (next === text) continue;
		writeFileSync(path, next);
		console.log(`stamped ${path} (${license})`);
		stamped++;
	}
	if (stamped === 0) console.log("license-headers: every named file already declares its licence");
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const args = process.argv.slice(2);
	if (args[0] !== "--stamp") {
		console.error("usage: node scripts/license-headers.mjs --stamp <file>...");
		process.exitCode = 2;
	} else {
		stamp(args.slice(1));
	}
}
