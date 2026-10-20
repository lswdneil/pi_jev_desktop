#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * Text that was decoded with the wrong encoding, found before it ships.
 *
 * This repository has corrupted its own files three times by round-tripping UTF-8 through a Windows console: a handover
 * document lost 260 characters, an i18n module lost its Chinese and Chinese-Traditional blocks, and two eval tests kept
 * an em dash as `鈥?`. Nothing caught any of them, because a mojibake line is still valid UTF-8 and still parses as
 * Markdown, TypeScript or JSON — it just says something nobody wrote.
 *
 * The first version of this check is deliberately narrow, because a false positive here would train people to ignore it:
 *
 * - U+FFFD, the replacement character, is always a failure: it is what a decoder writes when it gives up.
 * - A short list of characters that only appear when UTF-8 bytes were read as GBK (`鈥`, `鈽`, `鈫`, `锛`, `鐨`, `璇`,
 *   `鑻`, `锟斤拷`). They are rare in Chinese prose — no prompt, doc or message in this repository contains one — so a hit
 *   is evidence rather than a guess. Characters that are merely uncommon (`涓`, `鏄`, `鍙`) are left out on purpose: they
 *   are real words and names.
 *
 *   node scripts/check-encoding.mjs
 *
 * Unit test: `check-encoding.test.mjs`.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** Text that should never reach a repository file, with what it usually means. */
export const CORRUPTION_MARKERS = [
	{ text: "\uFFFD", reason: "the replacement character: something was decoded and lost" },
	{ text: "鈥", reason: "an em dash read as GBK" },
	{ text: "鈽", reason: "a box-drawing character read as GBK" },
	{ text: "鈫", reason: "an arrow read as GBK" },
	{ text: "锛", reason: "a full-width punctuation mark read as GBK" },
	{ text: "鐨", reason: "a common particle read as GBK" },
	{ text: "璇", reason: "a common character read as GBK" },
	{ text: "鑻", reason: "a common character read as GBK" },
	{ text: "锟斤拷", reason: "the classic UTF-8 read as GBK then re-encoded artifact" },
];

/** Extensions whose files are text and are checked. */
export const TEXT_EXTENSIONS = [".md", ".mdx", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".txt", ".html", ".css", ".plist", ".sh", ".nix"];

/** Directories left alone: vendored code, build output, and other projects' fixtures. */
export const SKIP_PREFIXES = ["node_modules", "dist", "out", ".artifacts", "coverage", "test-results", "playwright-report", ".vite", "desktop", "evals/tasks", "packages/mcp/LICENSES"];

/**
 * Files that are meant to look corrupted. This script has to name the markers it looks for, and the GBK fixture is the
 * subject of a decoding test (`fixtures/web/gbk-page.html` is GBK on purpose, so reading it as UTF-8 produces exactly
 * the replacement characters this check exists to find).
 */
export const ALLOWED_PATHS = ["scripts/check-encoding.mjs", "packages/kyrn-judge/test/fixtures/web/gbk-page.html"];

function isCheckedPath(path) {
	const normalized = path.replaceAll("\\", "/");
	if (ALLOWED_PATHS.includes(normalized)) return false;
	return TEXT_EXTENSIONS.some((extension) => normalized.endsWith(extension)) && !SKIP_PREFIXES.some((prefix) => normalized.startsWith(`${prefix}/`) || normalized.includes(`/${prefix}/`));
}

/** Every corruption marker in one text, with the line number it is on. */
export function corruptionIn(text) {
	const found = [];
	const lines = text.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		for (const marker of CORRUPTION_MARKERS) {
			if (line.includes(marker.text)) found.push({ line: index + 1, marker: marker.text, reason: marker.reason, text: line.trim().slice(0, 120) });
		}
	}
	return found;
}

/** Everything wrong with the files it is given. `files` is `{ list, read }` (see `third-party-notices.mjs`). */
export function encodingProblems(files, options = {}) {
	const problems = [];
	for (const path of files.list("")) {
		if (!isCheckedPath(path)) continue;
		const text = files.read(path);
		if (text === undefined) continue;
		for (const hit of corruptionIn(text)) {
			problems.push(`${path}:${hit.line}: ${hit.reason} (${JSON.stringify(hit.marker)} in ${JSON.stringify(hit.text)})`);
		}
	}
	void options;
	return problems;
}

/** Walks the working tree, skipping the directories that are not this repository's own text. */
export function diskFiles(root) {
	const read = (path) => {
		try {
			return readFileSync(join(root, path), "utf8");
		} catch {
			return undefined;
		}
	};
	const list = (prefix) => {
		const found = [];
		const walk = (directory) => {
			let entries;
			try {
				entries = readdirSync(join(root, directory), { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
				if (entry.isDirectory()) {
					if (SKIP_PREFIXES.some((skipped) => path === skipped || path.startsWith(`${skipped}/`))) continue;
					walk(path);
				} else if (entry.isFile()) found.push(path);
			}
		};
		walk(prefix);
		return found.map((path) => relative("", path).replaceAll("\\", "/"));
	};
	return { read, list };
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const problems = encodingProblems(diskFiles(process.cwd()));
	if (problems.length === 0) {
		console.log("encoding: no file carries the marks of a wrong decode");
	} else {
		for (const problem of problems) console.error(`encoding: ${problem}`);
		console.error(`\nencoding: ${problems.length} corrupted line(s). Fix the text, do not re-save the file through a console.`);
		process.exitCode = 1;
	}
}
