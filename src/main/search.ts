// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FileHit } from "../shared/api.ts";

/**
 * Quick-open: the files of the project, by name.
 *
 * A coding workspace is unusable if the only files a person can reach are the ones the agent happened to touch. This
 * walks the folder the agent runs in and ranks names against what was typed; it never leaves that folder, never
 * follows a symlink, and stops on a budget so a huge checkout cannot freeze the window.
 */

/** Folders that are build output, dependencies, or another tool's state: never what someone means by "the project". */
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	".hg",
	".svn",
	"out",
	"dist",
	"build",
	"target",
	".next",
	".nuxt",
	".turbo",
	".cache",
	".venv",
	"venv",
	"__pycache__",
	"coverage",
	"test-results",
	"playwright-report",
	".artifacts",
	// The shell's own staged runtime, when the project someone opened happens to be this repository.
	"spec-ai-agent",
]);

const MAX_DEPTH = 10;
const MAX_ENTRIES = 50_000;
const DEFAULT_LIMIT = 40;
const DEFAULT_BUDGET_MS = 300;

/** How well a path answers what was typed; 0 means it does not. */
function scoreOf(path: string, name: string, query: string): number {
	const lowerPath = path.toLowerCase();
	const lowerName = name.toLowerCase();
	if (lowerName === query) return 100;
	if (lowerName.startsWith(query)) return 85;
	if (lowerName.includes(query)) return 65;
	if (lowerPath.includes(query)) return 45;
	// A subsequence keeps "sapp" finding "src/app.ts" when the letters are in order; it is the weakest reason to show.
	let index = 0;
	for (const character of lowerPath) {
		if (character === query[index]) index++;
		if (index === query.length) return 20;
	}
	return 0;
}

export function searchProjectFiles(
	root: string,
	query: string,
	options: { readonly limit?: number; readonly budgetMs?: number } = {},
): FileHit[] {
	const wanted = query.trim().toLowerCase();
	if (wanted === "") return [];
	const limit = options.limit ?? DEFAULT_LIMIT;
	const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
	const hits: FileHit[] = [];
	let entries = 0;

	const walk = (directory: string, depth: number): void => {
		if (depth > MAX_DEPTH || entries > MAX_ENTRIES || Date.now() > deadline) return;
		let listing;
		try {
			listing = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of listing) {
			entries++;
			if (entries > MAX_ENTRIES || Date.now() > deadline) return;
			if (entry.name.startsWith(".")) continue;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				walk(absolute, depth + 1);
				continue;
			}
			// A symlink is not walked and not offered: the file it points at may be anywhere.
			if (!entry.isFile()) continue;
			const path = relative(root, absolute).split(sep).join("/");
			const score = scoreOf(path, entry.name, wanted);
			if (score > 0) hits.push({ path, name: entry.name, score });
		}
	};

	walk(root, 0);
	return hits
		.sort((left, right) => right.score - left.score || left.path.length - right.path.length || left.path.localeCompare(right.path))
		.slice(0, limit);
}
