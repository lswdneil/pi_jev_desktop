import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findChrome } from "../src/browser/chrome.ts";
import { loadConfig } from "../src/config.ts";
import { VERDICT_ENTRY } from "../src/extension/features/preflight-view.ts";
import { PRESENTATION_STATUS_KEY } from "../src/extension/presentation.ts";
import { LEDGER_ENTRY_TYPE } from "../src/extension/runtime.ts";
import { specEnv, specHome } from "../src/naming.ts";
import { HIVE_MESSAGE, SWARM_MESSAGE } from "../src/swarm/markers.ts";

const dirs: string[] = [];
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "spec-naming-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("the spec.ai.jev names", () => {
	it("reads one prefix and treats an empty value as unset", () => {
		expect(specEnv("JUDGE", { SPEC_AI_JEV_JUDGE: "laya" })).toBe("laya");
		expect(specEnv("JUDGE", { SPEC_AI_JEV_JUDGE: "" })).toBeUndefined();
		expect(specEnv("JUDGE", {})).toBeUndefined();
	});

	it("applies the judge, mode and writer overrides", () => {
		const current = loadConfig({
			env: { SPEC_AI_JEV_JUDGE: "laya,gateway", SPEC_AI_JEV_JUDGE_MODE: "active", SPEC_AI_JEV_WRITER: "p/m" },
		});
		expect(current.config).toMatchObject({ tiers: ["laya", "jev"], modes: { default: "active" }, writer: "p/m" });
		expect(loadConfig({ env: { SPEC_AI_JEV_JUDGE: "off" } }).disabled).toBe(true);
	});

	it("reads agent.json and ignores an old config file", () => {
		const oldOnly = temp();
		writeFileSync(join(oldOnly, "kyrn.json"), JSON.stringify({ tiers: ["old"] }));
		expect(loadConfig({ dir: oldOnly, env: {} }).config.tiers).toEqual(["jev"]);

		const current = temp();
		writeFileSync(join(current, "agent.json"), JSON.stringify({ tiers: ["new"] }));
		expect(loadConfig({ dir: current, env: {} }).config.tiers).toEqual(["new"]);
	});

	it("reports a broken agent.json instead of falling back to defaults silently", () => {
		const dir = temp();
		writeFileSync(join(dir, "agent.json"), "{ not json");

		const loaded = loadConfig({ dir, env: {} });

		expect(loaded.problem).toMatch(/^agent\.json could not be read/);
		expect(loaded.config.tiers).toEqual(["jev"]);
	});

	it("always uses ~/.spec.ai.jev, with no second home beside it", () => {
		const fresh = temp();
		expect(specHome(fresh)).toBe(join(fresh, ".spec.ai.jev"));

		mkdirSync(join(fresh, ".kyrn"));
		mkdirSync(join(fresh, ".mu"));
		expect(specHome(fresh)).toBe(join(fresh, ".spec.ai.jev"));
	});

	it("finds the browser named by SPEC_AI_JEV_CHROME", () => {
		const chrome = join(temp(), "chrome");
		writeFileSync(chrome, "");
		expect(findChrome({ SPEC_AI_JEV_CHROME: chrome })).toBe(chrome);
	});

	it("leaves every name that is already stored in sessions and desktop event logs as it was", () => {
		// Renaming any of these orphans history: compaction would quote them as user text, forgetting would
		// not restore, verdict lines would not render, and the desktop would drop the events without an error.
		expect({ LEDGER_ENTRY_TYPE, VERDICT_ENTRY, PRESENTATION_STATUS_KEY, HIVE_MESSAGE, SWARM_MESSAGE }).toEqual({
			LEDGER_ENTRY_TYPE: "kyrn.decision",
			VERDICT_ENTRY: "kyrn.verdict",
			PRESENTATION_STATUS_KEY: "kyrn.presentation.v1",
			HIVE_MESSAGE: "kyrn.hive",
			SWARM_MESSAGE: "kyrn.swarm",
		});
	});
});
