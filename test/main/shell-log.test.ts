// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendShellLog, formatShellLogLine, shellLogPath } from "../../src/main/shell-log.ts";

/**
 * The shell's log. Until it existed a packaged app recorded nothing at all, so the cases that matter are the ones a
 * person would look for after a report: a readable line, details kept as data, and a file that cannot grow forever.
 */

describe("the shell log", () => {
	it("writes one line per event: time, level, message, and details as JSON", () => {
		const line = formatShellLogLine(
			"error",
			"a renderer process is gone",
			{ reason: "crashed", exitCode: 139 },
			new Date("2026-10-19T09:00:00.000Z"),
		);
		expect(line).toBe('2026-10-19T09:00:00.000Z error a renderer process is gone {"reason":"crashed","exitCode":139}\n');
		expect(formatShellLogLine("info", "started", undefined, new Date("2026-10-19T09:00:00.000Z"))).toBe(
			"2026-10-19T09:00:00.000Z info started\n",
		);
	});

	it("keeps a message on one line, because a log is read line by line", () => {
		const line = formatShellLogLine("warn", "the window  is\nunresponsive", undefined, new Date("2026-10-19T09:00:00.000Z"));
		expect(line).toBe("2026-10-19T09:00:00.000Z warn the window is unresponsive\n");
	});

	it("creates its folder and appends, so two runs keep the first run's tail", () => {
		const home = mkdtempSync(join(tmpdir(), "mu-shell-log-"));
		try {
			const file = shellLogPath(home);
			expect(file.replaceAll("\\", "/")).toMatch(/\/logs\/mu-shell\.log$/);
			appendShellLog(file, "first\n");
			appendShellLog(file, "second\n");
			expect(readFileSync(file, "utf8")).toBe("first\nsecond\n");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("rotates to one .1 file at the cap instead of growing without bound", () => {
		const home = mkdtempSync(join(tmpdir(), "mu-shell-log-cap-"));
		try {
			const file = shellLogPath(home);
			appendShellLog(file, "a".repeat(64), 32);
			expect(existsSync(`${file}.1`)).toBe(false);
			appendShellLog(file, "b\n", 32);
			expect(readFileSync(`${file}.1`, "utf8")).toBe("a".repeat(64));
			expect(readFileSync(file, "utf8")).toBe("b\n");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
