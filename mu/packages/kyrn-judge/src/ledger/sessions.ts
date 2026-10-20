import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LedgerRecord } from "../ledger.ts";

/** The entry type the kernel appends decisions under, in the session files. */
export const LEDGER_ENTRY_TYPE = "kyrn.decision";

export interface SessionLedgerRecord {
	/** The session file the record came from, so a number in a report can be traced to it. */
	readonly sessionFile: string;
	readonly record: LedgerRecord;
}

/** `kyrn.decision` entries of one session file, in the order they were written. */
export function* ledgerRecordsInFile(path: string): Generator<SessionLedgerRecord> {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return;
	}
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		const custom = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (custom.type !== "custom" || custom.customType !== LEDGER_ENTRY_TYPE) continue;
		if (typeof custom.data !== "object" || custom.data === null) continue;
		yield { sessionFile: path, record: custom.data as LedgerRecord };
	}
}

/** Newest session files first, up to `limit`; the walk is lazy so a large home is not read twice. */
export function* recentSessionFiles(sessionsDir: string, limit: number): Generator<string> {
	const files: { path: string; mtime: number }[] = [];
	const walk = (dir: string): void => {
		let entries: Dirent<string>[];
		try {
			entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
			} else if (entry.name.endsWith(".jsonl")) {
				try {
					files.push({ path, mtime: statSync(path).mtimeMs });
				} catch {
					// A file that disappears between the listing and the stat is simply not there.
				}
			}
		}
	};
	walk(sessionsDir);
	files.sort((left, right) => right.mtime - left.mtime);
	for (const file of files.slice(0, Math.max(0, limit))) yield file.path;
}

/** Every decision from the newest `sessions` session files, newest session first. */
export function* ledgerRecords(sessionsDir: string, sessions = 5): Generator<SessionLedgerRecord> {
	for (const path of recentSessionFiles(sessionsDir, sessions)) yield* ledgerRecordsInFile(path);
}
