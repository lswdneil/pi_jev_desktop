#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The links in the documentation a user reads, checked against the files beside them.
 *
 * A markdown link that points at nothing is invisible until someone clicks it in a release's README, which is the worst
 * moment to find out. The repository has 1,000+ relative links; the ones this checks are the ones a reader follows:
 * the root documents, `docs/**` and `kyrn/**`. Two scopes are left out on purpose:
 *
 * - `packages/*​/CHANGELOG.md` — a changelog is a record, and its entries legitimately point at files that have since
 *   moved or at documentation of an earlier layout;
 * - `desktop/` and `evals/tasks/` — other projects' trees, kept for what they are.
 *
 *   node scripts/check-links.mjs
 *
 * Unit test: `check-links.test.mjs`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Where a reader follows links. Anything else is a record or another project's tree. */
export const CHECKED_ROOTS = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md", "GOVERNANCE.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "docs", "kyrn"];

/** Directories inside those roots that are build output or another project's fixtures. */
export const SKIP_SEGMENTS = ["node_modules", "dist", "out", "coverage", "test-results", "playwright-report", ".vite", ".artifacts"];

/** A link target that cannot be a file: absolute URLs, fragments, protocol-relative and mail links. */
function isExternal(target) {
	return target === "" || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target);
}

/** Every relative link in one markdown text, with the line it is on. Reference definitions (`[x]: url`) are included. */
export function linksIn(text) {
	const found = [];
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		for (const match of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) if (!isExternal(match[1])) found.push({ line: index + 1, target: match[1] });
		for (const match of line.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)) if (!isExternal(match[1])) found.push({ line: index + 1, target: match[1] });
	}
	return found;
}

/** What a link target means for the file it is written in: a fragment and a query are not part of the path. */
export function targetPath(target) {
	let path = target.split("#")[0].split("?")[0];
	try {
		path = decodeURIComponent(path);
	} catch {
		// An encoding mistake in a link is not this check's business; it will fail the existence test if it matters.
	}
	return path;
}

/** Every markdown file under the checked roots. */
export function documentationFiles(root) {
	const found = [];
	const visit = (path) => {
		const full = join(root, path);
		let info;
		try {
			info = statSync(full);
		} catch {
			return;
		}
		if (info.isFile()) {
			if (path.endsWith(".md")) found.push(path);
			return;
		}
		for (const entry of readdirSync(full, { withFileTypes: true })) {
			const child = `${path}/${entry.name}`;
			if (SKIP_SEGMENTS.some((segment) => child.includes(`/${segment}/`))) continue;
			visit(child);
		}
	};
	for (const entry of CHECKED_ROOTS) visit(entry);
	return found.sort();
}

/** Everything wrong with the links it is given. `files` is `{ list, read }` (see `third-party-notices.mjs`). */
export function linkProblems(files) {
	const problems = [];
	for (const path of files.list()) {
		const text = files.read(path);
		if (text === undefined) continue;
		for (const link of linksIn(text)) {
			const target = targetPath(link.target);
			if (target === "") continue;
			// A link is relative to the document that carries it, and may point at a directory.
			if (files.exists(resolve(dirname(path), target))) continue;
			problems.push(`${path}:${link.line}: ${link.target} does not exist`);
		}
	}
	return problems;
}

/** Walks the working tree: the links a release's documentation carries. */
export function diskFiles(root) {
	const files = documentationFiles(root);
	return {
		list: () => files,
		read: (path) => {
			try {
				return readFileSync(join(root, path), "utf8");
			} catch {
				return undefined;
			}
		},
		exists: (absolutePath) => existsSync(absolutePath) || existsSync(absolutePath.replace(/\\/g, "/")),
	};
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const root = process.cwd();
	const files = diskFiles(root);
	const problems = linkProblems(files);
	if (problems.length === 0) {
		console.log(`links: ${files.list().length} documents, every relative link resolves`);
	} else {
		for (const problem of problems) console.error(`links: ${problem}`);
		console.error(`
links: ${problems.length} broken link(s) in the documentation a reader follows`);
		process.exitCode = 1;
	}
}
