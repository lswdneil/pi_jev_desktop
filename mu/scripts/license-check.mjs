#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors


/**
 * The licence check: the one command CI and a contributor run.
 *
 * Four rules, all of them things a scanner would otherwise report as "unknown" or that a distribution review would
 * otherwise find by hand:
 *
 * 1. Every package manifest says which licence it is under. A `private: true` package still ships its sources with
 *    the npm tarball of its siblings, and a scanner still reads its manifest.
 * 2. `desktop-next/` is Apache-2.0 and the rest of the repository is MIT; a file in the wrong tree with the wrong
 *    header is a mistake.
 * 3. Files a change adds carry an SPDX header. Files that were already here are left alone — stamping the whole tree
 *    would rewrite code that came from pi and AionUi — and `THIRD_PARTY_NOTICES.md` covers them.
 * 4. `THIRD_PARTY_NOTICES.md` matches the lockfiles.
 *
 *   node scripts/license-check.mjs                     # rules 1, 2 and 4, plus any --new file
 *   node scripts/license-check.mjs --new $(git diff --diff-filter=A --name-only origin/main...HEAD)
 */

import { pathToFileURL } from "node:url";

import { APACHE_LICENSE, APACHE_TREES, headerProblems, MIT_LICENSE } from "./license-headers.mjs";
import { diskFiles, noticesProblems } from "./third-party-notices.mjs";

/** Every manifest a scanner reads: the root, the workspaces, and the desktop shell (its own application). */
export const MANIFESTS = ["package.json", "desktop-next/package.json"];

/** The licence each of them must declare, by tree. */
export function requiredLicense(path) {
	if (path === "package.json") return MIT_LICENSE;
	if (APACHE_TREES.some((prefix) => path.startsWith(prefix))) return APACHE_LICENSE;
	return undefined;
}

function workspaceManifests(files) {
	const listed = files.list("packages") ?? [];
	return listed.filter((path) => /^packages\/[^/]+\/package\.json$/.test(path));
}

function manifestProblems(files) {
	const problems = [];
	for (const path of [...MANIFESTS, ...workspaceManifests(files)]) {
		const text = files.read(path);
		if (text === undefined) {
			problems.push(`${path} is missing`);
			continue;
		}
		let manifest;
		try {
			manifest = JSON.parse(text);
		} catch {
			problems.push(`${path} is not valid JSON`);
			continue;
		}
		const expected = requiredLicense(path) ?? MIT_LICENSE;
		const declared = manifest.license;
		if (typeof declared !== "string" || declared === "") {
			problems.push(`${path} (${manifest.name ?? "unnamed"}) declares no license; add "${expected}"`);
			continue;
		}
		if (requiredLicense(path) !== undefined && declared !== expected) {
			problems.push(`${path} declares ${declared} but this tree is ${expected}`);
		}
	}
	return problems;
}

/**
 * Everything wrong with the repository's licences. `files` is `{read, list}` (see `third-party-notices.mjs`), and
 * `newPaths` are the files a change added, which must carry a header.
 */
export function licenseProblems(files, options = {}) {
	const problems = [];
	problems.push(...manifestProblems(files));

	const headers = [];
	for (const prefix of [...new Set(["desktop-next", "packages", "kyrn", "scripts", "bench"])]) {
		for (const path of files.list(prefix) ?? []) {
			headers.push({ path, text: files.read(path) ?? "" });
		}
	}
	problems.push(...headerProblems(headers, options.newPaths ?? []));

	problems.push(...noticesProblems(files));
	return problems;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const args = process.argv.slice(2);
	const files = diskFiles(process.cwd());
	const newPaths = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--new") newPaths.push(...args.slice(index + 1));
	}
	const problems = licenseProblems(files, { newPaths });
	if (problems.length === 0) {
		console.log("licenses: headers, manifests and third-party notices agree");
	} else {
		for (const problem of problems) console.error(`license: ${problem}`);
		process.exitCode = 1;
	}
}
