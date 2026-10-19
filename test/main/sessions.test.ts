// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSessionPath, listSessions, sessionsRoot } from "../../src/main/sessions.ts";

const roots: string[] = [];

function root(): string {
	const path = mkdtempSync(join(tmpdir(), "spec-ai-jev-sessions-"));
	roots.push(path);
	return path;
}

function writeSession(directory: string, name: string, cwd: string, userText: string, sessionName?: string): string {
	mkdirSync(directory, { recursive: true });
	const path = join(directory, name);
	const lines = [
		JSON.stringify({ type: "session", version: 3, id: name.replace(".jsonl", ""), timestamp: "2026-10-19T10:00:00.000Z", cwd }),
		JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: userText }] } }),
	];
	if (sessionName !== undefined) lines.push(JSON.stringify({ type: "session_info", name: sessionName }));
	writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
	return path;
}

afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("session index", () => {
	it("reads a title, cwd and a session name", () => {
		const base = root();
		const directory = join(base, "sessions", "encoded");
		writeSession(directory, "one.jsonl", "C:\\work\\alpha", "Fix the flaky test", "Flaky renderer");
		writeSession(directory, "two.jsonl", "C:\\work\\beta", "Write the release notes");

		const all = listSessions({ root: sessionsRoot(base) });
		expect(all).toHaveLength(2);
		expect(all.find((entry) => entry.title === "Flaky renderer")).toMatchObject({ cwd: "C:\\work\\alpha" });
		expect(all.find((entry) => entry.title === "Write the release notes")).toMatchObject({ cwd: "C:\\work\\beta" });

		const alpha = listSessions({ root: sessionsRoot(base), cwd: "C:\\work\\alpha" });
		expect(alpha).toHaveLength(1);
		expect(alpha[0]?.title).toBe("Flaky renderer");
	});

	it("refuses a path outside the sessions root", () => {
		const base = root();
		expect(isSessionPath(sessionsRoot(base), join(base, "sessions", "ok.jsonl"))).toBe(true);
		expect(isSessionPath(sessionsRoot(base), join(base, "elsewhere.jsonl"))).toBe(false);
		expect(isSessionPath(sessionsRoot(base), join(base, "sessions", "..", "escape.jsonl"))).toBe(false);
	});
});
