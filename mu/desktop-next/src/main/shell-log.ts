// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The shell's own log: one line per event, in `<agentDir>/logs/mu-shell.log`.
 *
 * A packaged app has no console on Windows, so an error in the shell leaves no trace unless it is written down. This is
 * that trace: a crash, a renderer or child process that is gone, an unresponsive window, and the start and end of a
 * run. Nothing a person typed belongs here — a line carries versions, reasons, exit codes and the shell's own URLs.
 *
 * It lives beside the agent's own logs rather than in the app's browser profile for one reason: `mu doctor --bundle`
 * reads `<agentDir>/logs`, so a person reporting a problem can send the shell's story along with the kernel's.
 *
 * The file is capped: past `limitBytes` the current file becomes `<name>.1` and a new one starts, so an app left
 * running for months cannot fill a disk. One `.1` is enough for the purpose: it is the tail of the previous run.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const SHELL_LOG_FILE = "mu-shell.log";
export const SHELL_LOG_LIMIT_BYTES = 2 * 1024 * 1024;

export type ShellLogLevel = "info" | "warn" | "error" | "fatal";

/** Where the log lives: in the agent directory's `logs`, the folder the diagnostics bundle already reads. */
export function shellLogPath(agentDir: string): string {
	return join(agentDir, "logs", SHELL_LOG_FILE);
}

/** One line: time, level, message, and details as JSON when there are any. A message never carries a newline. */
export function formatShellLogLine(
	level: ShellLogLevel,
	message: string,
	details?: Readonly<Record<string, unknown>>,
	now: Date = new Date(),
): string {
	const text = message.replaceAll(/\s+/g, " ").trim();
	const base = `${now.toISOString()} ${level} ${text}`;
	return details === undefined ? `${base}\n` : `${base} ${JSON.stringify(details)}\n`;
}

/** Append one line, rotating the file first when it has reached its cap. Throws only if the filesystem fails. */
export function appendShellLog(file: string, line: string, limitBytes: number = SHELL_LOG_LIMIT_BYTES): void {
	mkdirSync(dirname(file), { recursive: true });
	if (existsSync(file) && statSync(file).size >= limitBytes) renameSync(file, `${file}.1`);
	appendFileSync(file, line, "utf8");
}
