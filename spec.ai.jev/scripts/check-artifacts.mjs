#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors


/**
 * The check that a failed end-to-end run cannot publish a secret.
 *
 * Playwright's traces are a recording of everything the page and the network did, and the desktop tests drive a real
 * child process whose environment carries keys. Uploading a trace on failure is how CI gets debuggable; uploading a
 * trace with an API key in it is how CI leaks one. So the artifacts are scanned before they leave the runner, and the
 * scan fails the job rather than warning: a leak that is announced after upload has already happened.
 *
 *   node scripts/check-artifacts.mjs test-results playwright-report
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Files whose name alone is disqualifying, wherever they are. */
export const FORBIDDEN_NAMES = [".env", ".env.local", "auth.json", "credentials.json", "id_rsa", "id_ed25519", ".netrc"];

/** Content that is a secret whatever it is called. */
export const SECRET_PATTERNS = [
	{ pattern: /sk-[A-Za-z0-9_-]{16,}/, what: "an Anthropic/OpenAI style key" },
	{ pattern: /AIza[0-9A-Za-z_-]{30,}/, what: "a Google API key" },
	{ pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: "a private key" },
	{ pattern: /(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|MU_JUDGE_API_KEY|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*\S{8,}/, what: "a key in an assignment" },
];

/** A text file small enough to scan. Binary traces are scanned too: the patterns survive zlib badly, but cheaply. */
const MAX_BYTES = 32 * 1024 * 1024;

function filesUnder(directory) {
	const files = [];
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

/** What is wrong with an artifact directory. Empty means it is safe to upload. */
export function artifactProblems(directories) {
	const problems = [];
	for (const directory of directories) {
		if (!existsSync(directory)) continue;
		for (const file of filesUnder(directory)) {
			const name = file.replaceAll("\\", "/").split("/").pop() ?? "";
			if (FORBIDDEN_NAMES.includes(name)) {
				problems.push(`${file} is a credentials file by name and must not be uploaded`);
				continue;
			}
			let size = 0;
			try {
				size = statSync(file).size;
			} catch {
				continue;
			}
			if (size === 0 || size > MAX_BYTES) continue;
			let text = "";
			try {
				text = readFileSync(file).toString("latin1");
			} catch {
				continue;
			}
			for (const { pattern, what } of SECRET_PATTERNS) {
				if (pattern.test(text)) {
					problems.push(`${file} contains ${what}`);
					break;
				}
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
	const directories = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
	if (directories.length === 0) {
		console.error("usage: node scripts/check-artifacts.mjs <directory>...");
		process.exitCode = 2;
	} else {
		const problems = artifactProblems(directories);
		if (problems.length === 0) console.log(`artifacts: ${directories.join(", ")} are safe to upload`);
		else {
			for (const problem of problems) console.error(`artifacts: ${problem}`);
			process.exitCode = 1;
		}
	}
}
