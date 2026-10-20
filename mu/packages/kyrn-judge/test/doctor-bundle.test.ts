import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	archiveBundle,
	BUNDLE_LIMITS,
	inspectArchive,
	NEVER_INCLUDED,
	planBundle,
	writeBundle,
} from "../src/setup/bundle.ts";
import { runDoctorBundle } from "../src/setup/bundle-cli.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SECRET = "sk-proj-TestVector0123456789abcdefghij";
const SETTING_SECRET = "/Users/somebody/private/path/that-should-not-travel";

/** An agent directory with the files that must never be read, plus one session and one crash record. */
function agentDir(options: { decisions?: number; crashLog?: string } = {}): string {
	const root = mkdtempSync(join(tmpdir(), "mu-doctor-"));
	dirs.push(root);
	const sessions = join(root, "sessions", "project");
	mkdirSync(sessions, { recursive: true });
	writeFileSync(join(root, ".env"), `TYPESAFE_API_KEY=${SECRET}\nOTHER=${SECRET}\n`);
	writeFileSync(join(root, "auth.json"), JSON.stringify({ token: SECRET }));
	writeFileSync(join(root, "models-store.json"), JSON.stringify({ key: SECRET }));
	writeFileSync(
		join(root, "mu.json"),
		JSON.stringify({ features: { admission: { enabled: true } }, writer: SETTING_SECRET }),
	);

	const lines: string[] = [];
	for (let index = 0; index < (options.decisions ?? 3); index++) {
		lines.push(
			JSON.stringify({
				type: "custom",
				customType: "kyrn.decision",
				data: {
					id: `id-${index}`,
					timestamp: `2026-10-1${index}T10:00:00.000Z`,
					specId: "tool.admission",
					specVersion: 1,
					mode: "active",
					providerId: "classifier:opencode",
					modelId: "opencode/jev-1.13-free",
					outcome: { keep: true, note: "the user's own words" },
					source: "judge",
					latencyMs: 400 + index,
					usage: { inputTokens: 100, outputTokens: 10 },
					stateDigest: "digest",
				},
			}),
		);
	}
	if (lines.length > 0) writeFileSync(join(sessions, "s.jsonl"), `${lines.join("\n")}\n`);
	writeFileSync(
		join(root, "crashes.json"),
		options.crashLog ?? JSON.stringify([{ kind: "uncaught_exception", message: "boom" }]),
	);
	return root;
}

describe("the diagnostic bundle", () => {
	it("never carries a credential file or a secret, and says what it left out", () => {
		const root = agentDir();
		const plan = planBundle({
			agentDir: root,
			now: () => new Date("2026-10-18T12:00:00.000Z"),
			env: { TYPESAFE_API_KEY: SECRET },
			versions: { mu: "0.1.8" },
			platform: "test-platform",
		});

		const everything = plan.files.map((file) => `${file.path}\n${file.content}`).join("\n");
		expect(everything.includes(SECRET), "a secret from a credential file reached the bundle").toBe(false);
		expect(everything.includes(SETTING_SECRET), "a setting value reached the bundle").toBe(false);
		expect(everything.includes("the user's own words"), "verdict content reached the bundle").toBe(false);
		expect(everything.includes("digest"), "the state digest is the point of the verdict summary").toBe(true);

		for (const name of NEVER_INCLUDED) {
			expect(
				plan.files.some((file) => file.path.includes(name)),
				`${name} must not be a bundle entry`,
			).toBe(false);
			expect(
				plan.manifest.omitted.some((entry) => entry.what === name),
				`the manifest must say ${name} was left out`,
			).toBe(true);
		}
		expect(plan.manifest.format).toBe("mu-diagnostic-bundle/1");
		expect(plan.manifest.createdAt).toBe("2026-10-18T12:00:00.000Z");
		expect(plan.manifest.versions.mu).toBe("0.1.8");
	});

	it("is deterministic: the same input and clock produce the same plan and the same bytes", () => {
		const root = agentDir();
		const options = {
			agentDir: root,
			now: () => new Date("2026-10-18T12:00:00.000Z"),
			env: {},
			versions: { mu: "0.1.8" },
			platform: "test-platform",
		};
		const first = planBundle(options);
		const second = planBundle(options);
		expect(first.manifest).toEqual(second.manifest);
		expect(first.files.map((file) => file.path)).toEqual(second.files.map((file) => file.path));
		expect(archiveBundle(first, 0)).toEqual(archiveBundle(second, 0));
	});

	it("truncates an oversized file and records why, instead of shipping half a file silently", () => {
		const root = agentDir({ crashLog: JSON.stringify([{ kind: "fatal_error", message: "x".repeat(4000) }]) });
		const plan = planBundle({
			agentDir: root,
			now: () => new Date("2026-10-18T12:00:00.000Z"),
			env: {},
			limits: { maxFileBytes: 512 },
		});

		const crashes = plan.manifest.files.find((file) => file.path === "crashes.json");
		expect(crashes, "crashes.json should be in the bundle").toBeDefined();
		expect(crashes?.truncated, "the manifest must say the file was cut").toBeDefined();
		expect(crashes?.truncated).toMatch(/kept 512 of/);
		expect((crashes?.bytes ?? 0) <= 512).toBe(true);
	});

	it("stops at the file limit and names what it dropped", () => {
		const root = agentDir();
		const plan = planBundle({
			agentDir: root,
			now: () => new Date("2026-10-18T12:00:00.000Z"),
			env: {},
			limits: { maxFiles: 3 },
		});
		expect(plan.files.length, "at most two files plus the manifest").toBeLessThanOrEqual(2);
		expect(plan.manifest.omitted.some((entry) => entry.why.includes("file limit"))).toBe(true);
	});

	it("keeps archive paths relative, so no user name travels with it", () => {
		const root = agentDir();
		const plan = planBundle({ agentDir: root, now: () => new Date("2026-10-18T12:00:00.000Z"), env: {} });
		const names = inspectArchive(archiveBundle(plan, 0));
		expect(names).toContain("manifest.json");
		for (const name of names) {
			expect(name.startsWith("/") || name.includes("\\"), `${name} is not a relative path`).toBe(false);
			expect(name.includes(tmpdir().replaceAll("\\", "/")), `${name} leaks the home directory`).toBe(false);
		}
		expect(BUNDLE_LIMITS.maxFiles).toBeGreaterThan(4);
	});
});

describe("mu doctor --bundle", () => {
	it("--dry-run reports the plan and writes nothing", () => {
		const root = agentDir();
		const outputDir = join(root, "diagnostics");
		const lines: string[] = [];
		const code = runDoctorBundle({
			argv: ["--bundle", "--dry-run", "--out", outputDir],
			agentDir: root,
			now: () => new Date("2026-10-18T12:00:00.000Z"),
			out: (text) => lines.push(text),
		});

		expect(code).toBe(0);
		expect(existsSync(outputDir), "a dry run must not create the output directory").toBe(false);
		const report = lines.join("\n");
		expect(report).toMatch(/would include \d+ files plus manifest\.json/);
		expect(report).toMatch(/\.env \(may hold credentials/);
		expect(report).toMatch(/archive listing: .*manifest\.json/);
	});

	it("writes one archive that holds the manifest and nothing dangerous", () => {
		const root = agentDir();
		const outputDir = join(root, "diagnostics");
		const written = writeBundle({
			agentDir: root,
			outputDir,
			now: () => new Date("2026-10-18T12:00:00.000Z"),
			env: { TYPESAFE_API_KEY: SECRET },
		});

		expect(written.path, "expected a written archive").toBeDefined();
		expect(existsSync(written.path as string)).toBe(true);
		expect((written.bytes ?? 0) > 0).toBe(true);
		const names = inspectArchive(readFileSync(written.path as string));
		expect(names).toContain("manifest.json");
		expect(names.some((name) => name.includes(".env"))).toBe(false);
	});
});

describe("the desktop shell's log in the bundle", () => {
	it("carries the tail of mu-shell.log, redacted, and does not list it as omitted", () => {
		const root = agentDir();
		mkdirSync(join(root, "logs"), { recursive: true });
		writeFileSync(
			join(root, "logs", "mu-shell.log"),
			`${[
				'2026-10-19T01:00:00.000Z info started {"version":"0.1.8"}',
				'2026-10-19T01:00:01.000Z error a renderer process is gone {"url":"app://mu/index.html"}',
				`2026-10-19T01:00:02.000Z fatal uncaught exception {"message":"the key was ${SECRET}"}`,
			].join("\n")}\n`,
		);
		const plan = planBundle({ agentDir: root, env: { TYPESAFE_API_KEY: SECRET } });
		const file = plan.files.find((entry) => entry.path === "logs/shell-tail.log");
		expect(file?.content, "expected the shell log in the archive").toBeDefined();
		expect(file?.content).toContain("a renderer process is gone");
		expect(file?.content.includes(SECRET), "a secret from the shell log reached the bundle").toBe(false);
		expect(plan.manifest.omitted.some((entry) => entry.what === "logs/mu-shell.log")).toBe(false);
	});

	it("puts the rotated file before the current one, so a crash that filled 2 MiB is still in the story", () => {
		const root = agentDir();
		mkdirSync(join(root, "logs"), { recursive: true });
		writeFileSync(
			join(root, "logs", "mu-shell.log.1"),
			`${[
				'2026-10-18T23:00:00.000Z info started {"version":"0.1.8"}',
				'2026-10-18T23:10:00.000Z error a renderer process is gone {"reason":"crashed"}',
			].join("\n")}\n`,
		);
		writeFileSync(
			join(root, "logs", "mu-shell.log"),
			`${['2026-10-19T01:00:00.000Z error the window is not being replaced again {"recoveries":2}'].join("\n")}\n`,
		);
		const plan = planBundle({ agentDir: root, env: {} });
		const content = plan.files.find((entry) => entry.path === "logs/shell-tail.log")?.content ?? "";
		expect(content).toContain("a renderer process is gone");
		expect(content).toContain("not being replaced again");
		expect(content.indexOf("a renderer process is gone")).toBeLessThan(content.indexOf("not being replaced again"));
	});

	it("says the shell log is absent instead of pretending it is empty", () => {
		const root = agentDir();
		const plan = planBundle({ agentDir: root, env: {} });
		expect(plan.files.some((entry) => entry.path === "logs/shell-tail.log")).toBe(false);
		expect(plan.manifest.omitted.some((entry) => entry.what === "logs/mu-shell.log")).toBe(true);
	});
});
