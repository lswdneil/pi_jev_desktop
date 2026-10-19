// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export interface SessionSummary {
	readonly path: string;
	readonly id: string;
	readonly title: string;
	readonly cwd: string;
	readonly updatedAt: string;
}

const HEAD_BYTES = 256 * 1024;
const DEFAULT_LIMIT = 40;

export function sessionsRoot(agentDir: string): string {
	return join(agentDir, "sessions");
}

function textOfContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((item) => {
			if (typeof item !== "object" || item === null) return "";
			const block = item as { type?: unknown; text?: unknown };
			return block.type === "text" && typeof block.text === "string" ? block.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function readHead(file: string): string {
	const handle = openSync(file, "r");
	try {
		const buffer = Buffer.alloc(HEAD_BYTES);
		const bytes = readSync(handle, buffer, 0, buffer.length, 0);
		return buffer.subarray(0, bytes).toString("utf8");
	} finally {
		closeSync(handle);
	}
}

function parseSummary(file: string): SessionSummary | undefined {
	let text: string;
	try {
		text = readHead(file);
	} catch {
		return undefined;
	}
	let header: Record<string, unknown> | undefined;
	let name: string | undefined;
	let firstUser: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === "") continue;
		let entry: Record<string, unknown>;
		try {
			const parsed = JSON.parse(line) as unknown;
			if (typeof parsed !== "object" || parsed === null) continue;
			entry = parsed as Record<string, unknown>;
		} catch {
			continue;
		}
		if (header === undefined && entry.type === "session") header = entry;
		if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim() !== "") {
			name = entry.name.trim();
		}
		if (firstUser === undefined && entry.type === "message") {
			const message = entry.message;
			if (typeof message === "object" && message !== null) {
				const typed = message as { role?: unknown; content?: unknown };
				if (typed.role === "user") firstUser = textOfContent(typed.content).trim() || undefined;
			}
		}
	}
	if (header === undefined) return undefined;
	let updatedAt: string;
	try {
		updatedAt = statSync(file).mtime.toISOString();
	} catch {
		return undefined;
	}
	const id = typeof header.id === "string" && header.id !== "" ? header.id : basename(file, ".jsonl");
	const cwd = typeof header.cwd === "string" ? header.cwd : "";
	const title = name ?? (firstUser === undefined ? "Untitled session" : firstUser.slice(0, 80));
	return { path: resolve(file), id, title, cwd, updatedAt };
}

function collectJsonl(root: string): string[] {
	const files: string[] = [];
	const walk = (directory: string, depth: number): void => {
		if (depth > 3) return;
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path, depth + 1);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
		}
	};
	walk(root, 0);
	return files;
}

function sameCwd(left: string, right: string): boolean {
	const a = resolve(left);
	const b = resolve(right);
	return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function listSessions(options: {
	readonly root: string;
	readonly cwd?: string;
	readonly limit?: number;
}): SessionSummary[] {
	const files = collectJsonl(options.root)
		.map((path) => {
			try {
				return { path, modified: statSync(path).mtimeMs };
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is { path: string; modified: number } => entry !== undefined)
		.sort((left, right) => right.modified - left.modified);
	// The limit is what someone can see, so it applies to sessions that match, not to the files looked at: taking the
	// forty newest files and then filtering by project hides an older session of the project in front of you.
	const wanted = options.limit ?? DEFAULT_LIMIT;
	const summaries: SessionSummary[] = [];
	for (const entry of files) {
		const summary = parseSummary(entry.path);
		if (summary === undefined) continue;
		if (options.cwd !== undefined && (summary.cwd === "" || !sameCwd(summary.cwd, options.cwd))) continue;
		summaries.push(summary);
		if (summaries.length >= wanted) break;
	}
	return summaries;
}

/** One session's summary, for a caller that already knows the file (opening it from another project, for example). */
export function readSession(file: string): SessionSummary | undefined {
	return parseSummary(file);
}

/** A session path must stay inside the app's own sessions folder. */
export function isSessionPath(root: string, file: string): boolean {
	const base = resolve(root);
	const candidate = resolve(file);
	const normalizedBase = process.platform === "win32" ? base.toLowerCase() : base;
	const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
	return normalizedCandidate.startsWith(`${normalizedBase}${sep}`) && normalizedCandidate.endsWith(".jsonl");
}
