import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, VERSION } from "../config.ts";
import type { Extension } from "./extensions/types.ts";
import { environmentSecrets, redactFailure } from "./redact.ts";
import { isSyntheticPath } from "./source-info.ts";

/** Why a run ended abnormally. `unhandled_rejection` is survivable; the rest end the process. */
export type CrashKind = "uncaught_exception" | "unhandled_rejection" | "fatal_error" | "shutdown_timeout";

/** What the failure was about, which is what decides whether trying again is worth it. */
export type CrashCategory = "timeout" | "aborted" | "user-data" | "internal";

export interface CrashRecord {
	timestamp: string;
	version: string;
	kind: CrashKind;
	/** Absent on records written before the classification existed. */
	category?: CrashCategory;
	/** The run mode the process was in: interactive, print, json or rpc. */
	mode?: string;
	platform?: string;
	/** Redacted: a crash record is written to disk and read by whoever debugs it. */
	message: string;
	stack: string | null;
	sessionFile: string | null;
	cwd: string;
	/** Where the session was, as far as the caller could tell. */
	turn?: number;
	tool?: string;
	notified?: boolean;
}

const MAX_CRASH_RECORDS = 5;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function crashLogPath(agentDir = getAgentDir()): string {
	return join(agentDir, "crashes.json");
}

export function readCrashLog(path = crashLogPath()): CrashRecord[] {
	try {
		const records: unknown = JSON.parse(readFileSync(path, "utf8"));
		return Array.isArray(records)
			? records.filter(
					(record): record is CrashRecord =>
						typeof record === "object" &&
						record !== null &&
						typeof (record as CrashRecord).timestamp === "string" &&
						typeof (record as CrashRecord).message === "string",
				)
			: [];
	} catch {
		return [];
	}
}

function writeCrashLog(records: readonly CrashRecord[], path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`);
}

type ExtensionStackMetadata = Pick<Extension, "path" | "resolvedPath" | "sourceInfo">;

function normalizeStackPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+$/u, "");
}

function stackContainsPath(stack: string, targetPath: string, includeDescendants: boolean): boolean {
	const target = normalizeStackPath(targetPath);
	if (!target || isSyntheticPath(target)) return false;
	const caseInsensitive = /^[a-z]:\//iu.test(target);
	const haystack = caseInsensitive ? stack.toLowerCase() : stack;
	const needle = caseInsensitive ? target.toLowerCase() : target;
	if (includeDescendants) return haystack.includes(`${needle}/`);

	let index = haystack.indexOf(needle);
	while (index !== -1) {
		const next = haystack[index + needle.length];
		if (next === undefined || next === ":" || next === ")" || /\s/u.test(next)) return true;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return false;
}

/** Find loaded extensions with source files in a stack trace. */
export function findExtensionStackMatches(
	stack: string | undefined,
	extensions: readonly ExtensionStackMetadata[],
): string[] {
	if (!stack) return [];
	const normalizedStack = stack
		.split("\n")
		.slice(1)
		.filter((line) => /^\s+at\s/u.test(line))
		.map((line) => {
			try {
				return decodeURI(line);
			} catch {
				return line;
			}
		})
		.join("\n")
		.replace(/\\/g, "/");
	const matches: string[] = [];
	const seen = new Set<string>();

	for (const extension of extensions) {
		const resolvedPath = normalizeStackPath(extension.resolvedPath);
		const singleFilePackage =
			extension.sourceInfo.origin === "package" &&
			!/^(?:npm:|git:|https?:\/\/|ssh:\/\/)/u.test(extension.sourceInfo.source) &&
			/\.[cm]?[jt]s$/u.test(extension.sourceInfo.source);
		const packageRoot =
			extension.sourceInfo.origin === "package" && !singleFilePackage && extension.sourceInfo.baseDir
				? extension.sourceInfo.baseDir
				: undefined;
		const slashIndex = resolvedPath.lastIndexOf("/");
		const directoryEntry = /\/index\.[cm]?[jt]s$/u.test(resolvedPath);
		const matched = packageRoot
			? stackContainsPath(normalizedStack, packageRoot, true)
			: directoryEntry && slashIndex !== -1
				? stackContainsPath(normalizedStack, resolvedPath.slice(0, slashIndex), true)
				: stackContainsPath(normalizedStack, resolvedPath, false);
		if (!matched) continue;

		const label =
			extension.sourceInfo.origin === "package" && extension.sourceInfo.source
				? extension.sourceInfo.source
				: extension.path;
		if (!seen.has(label)) {
			seen.add(label);
			matches.push(label);
		}
	}
	return matches;
}

/**
 * Best-effort persistence for callers that are already crashing.
 *
 * Two things must never happen here: a credential reaching the file, and a second failure caused by the
 * record itself. So the text is redacted, and a write that fails falls back to one stderr line — the
 * person debugging has to learn that the record was lost, and that must not throw either.
 */
export function recordCrash(
	crash: {
		kind: CrashKind;
		error: unknown;
		category?: CrashCategory;
		mode?: string;
		sessionFile?: string;
		cwd: string;
		turn?: number;
		tool?: string;
	},
	path = crashLogPath(),
): CrashRecord | undefined {
	const failure = redactFailure(crash.error, environmentSecrets());
	const record: CrashRecord = {
		timestamp: new Date().toISOString(),
		version: VERSION,
		kind: crash.kind,
		...(crash.category ? { category: crash.category } : {}),
		...(crash.mode ? { mode: crash.mode } : {}),
		platform: process.platform,
		message: failure.message,
		stack: failure.stack,
		sessionFile: crash.sessionFile ?? null,
		cwd: crash.cwd,
		...(crash.turn !== undefined ? { turn: crash.turn } : {}),
		...(crash.tool ? { tool: crash.tool } : {}),
	};
	try {
		writeCrashLog([...readCrashLog(path), record].slice(-MAX_CRASH_RECORDS), path);
		return record;
	} catch (writeError) {
		try {
			process.stderr.write(
				`mu could not write its crash record to ${path} (${writeError instanceof Error ? writeError.message : String(writeError)}); the failure was ${record.kind}${record.category ? ` (${record.category})` : ""}: ${record.message}\n`,
			);
		} catch {
			// Nowhere left to write to, and a crash must not crash.
		}
		return undefined;
	}
}

/** Return the newest recent crash, marking pending records as announced. */
export function takeUnnotifiedCrash(path = crashLogPath(), now = Date.now()): CrashRecord | undefined {
	const records = readCrashLog(path);
	const crash = [...records]
		.reverse()
		.find((record) => !record.notified && now - Date.parse(record.timestamp) <= MAX_AGE);
	if (!crash) return undefined;
	try {
		writeCrashLog(
			records.map((record) => (record.notified ? record : { ...record, notified: true })),
			path,
		);
	} catch {
		// Showing the notice again is harmless.
	}
	return crash;
}

export function clearCrashLog(path = crashLogPath()): void {
	try {
		rmSync(path, { force: true });
	} catch {
		// The records can be attached again if cleanup fails.
	}
}
