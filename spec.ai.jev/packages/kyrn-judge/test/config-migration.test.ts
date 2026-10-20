import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_SCHEMA_VERSION, configSchemaVersion, migrateConfig } from "../src/config/migrations/index.ts";
import { loadConfig, parseConfig, validateConfig } from "../src/config.ts";

/**
 * `agent.json` is the file a user edits by hand, so the tests here are about what they see afterwards: a moved
 * setting is reported, a typo is named, and nothing is rewritten without a copy of the old file beside it.
 */

const dirs: string[] = [];
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-config-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function write(dir: string, value: unknown): string {
	const path = join(dir, "agent.json");
	writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
	return path;
}

describe("migrating agent.json", () => {
	it("reads a file with no schemaVersion as version 0 and stamps the current version", () => {
		expect(configSchemaVersion({})).toBe(0);
		expect(configSchemaVersion({ schemaVersion: 1 })).toBe(1);
		expect(configSchemaVersion({ schemaVersion: "1" })).toBeUndefined();

		const migrated = migrateConfig({ tiers: "laya,jev", recordState: true });
		expect(migrated).toMatchObject({ from: 0, to: CONFIG_SCHEMA_VERSION });
		expect(migrated.unsupported).toBeUndefined();
		expect(migrated.value).toMatchObject({
			schemaVersion: CONFIG_SCHEMA_VERSION,
			tiers: ["laya", "jev"],
			recordState: true,
		});
		expect(migrated.notes[0]).toMatch(/schemaVersion 0 -> 1/);
	});

	it("leaves a current file alone, so a second start writes nothing", () => {
		const current = { schemaVersion: CONFIG_SCHEMA_VERSION, tiers: ["laya"] };
		expect(migrateConfig(current)).toMatchObject({
			from: CONFIG_SCHEMA_VERSION,
			to: CONFIG_SCHEMA_VERSION,
			notes: [],
		});
	});

	it("refuses a file from a newer mu instead of guessing at its format", () => {
		const migrated = migrateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION + 7 });
		expect(migrated.unsupported).toMatch(/newer mu/);
		expect(migrated.value).toEqual({});
	});

	it("migrates on load, keeps the old file as .bak, and does not lose settings", () => {
		const dir = temp();
		const path = write(dir, { tiers: "laya,jev", modes: { "tool.admission": "shadow" }, recordState: true });

		const loaded = loadConfig({ dir, env: {} });

		expect(loaded.config.tiers).toEqual(["laya", "jev"]);
		expect(loaded.config.modes).toEqual({ default: "active", "tool.admission": "shadow" });
		expect(loaded.config.recordState).toBe(true);
		expect(loaded.problems.join("\n")).toMatch(/migrated to schemaVersion 1/);
		expect(readFileSync(`${path}.bak`, "utf8")).toBe(
			JSON.stringify({ tiers: "laya,jev", modes: { "tool.admission": "shadow" }, recordState: true }),
		);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ schemaVersion: 1, tiers: ["laya", "jev"] });

		// Second start: the file is current, so nothing is rewritten and nothing is reported.
		const again = loadConfig({ dir, env: {} });
		expect(again.problems).toEqual([]);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ schemaVersion: 1 });
	});
});

describe("a agent.json that cannot be used", () => {
	it("reports broken JSON, keeps the original, and starts on defaults", () => {
		const dir = temp();
		const path = write(dir, "{ not json");

		const loaded = loadConfig({ dir, env: {} });

		expect(loaded.problem).toMatch(/^agent\.json could not be read/);
		expect(loaded.problems.join("\n")).toMatch(new RegExp(`${path.replaceAll("\\", "\\\\")}\\.bak`));
		expect(readFileSync(`${path}.bak`, "utf8")).toBe("{ not json");
		expect(loaded.config.tiers).toEqual(["jev"]);
	});

	it("refuses a newer schema and writes nothing at all", () => {
		const dir = temp();
		const path = write(dir, { schemaVersion: 99, tiers: ["laya"] });
		const before = readFileSync(path, "utf8");

		const loaded = loadConfig({ dir, env: {} });

		expect(loaded.problems.join("\n")).toMatch(/newer spec\.ai\.jev \(schemaVersion 99/);
		expect(loaded.config.tiers).toEqual(["jev"]);
		expect(readFileSync(path, "utf8")).toBe(before);
		expect(existsSync(`${path}.bak`)).toBe(false);
	});
});

describe("a agent.json that half makes sense", () => {
	it("names every setting it could not read instead of applying half of it in silence", () => {
		const warnings = validateConfig({
			schemaVersion: 1,
			jduges: {},
			tiers: "laya",
			modes: { "tool.admission": "sometimes", "turn.completion": "shadow" },
			judges: { bespoke: { type: "telepathy" }, nameless: {} },
			recordState: "yes",
		});

		expect(warnings.join("\n")).toMatch(/"jduges" is not a setting this build knows/);
		expect(warnings.join("\n")).toMatch(/"tiers" is "laya", not a list of judge names/);
		expect(warnings.join("\n")).toMatch(/"modes\.tool\.admission" is "sometimes"/);
		expect(warnings.join("\n")).toMatch(/"judges\.bespoke\.type" is "telepathy"/);
		expect(warnings.join("\n")).toMatch(/"judges\.nameless" has no type/);
		expect(warnings.join("\n")).toMatch(/"recordState" is "yes"/);
		// The parts that are fine are still applied: one bad key does not throw the file away.
		expect(parseConfig({ schemaVersion: 1, modes: { "turn.completion": "shadow" } }).modes).toMatchObject({
			"turn.completion": "shadow",
		});
	});

	it("says which file the warnings came from, in the load result", () => {
		const dir = temp();
		write(dir, { schemaVersion: 1, jduges: {}, tiers: ["laya"] });

		const loaded = loadConfig({ dir, env: {} });

		expect(loaded.config.tiers).toEqual(["laya"]);
		expect(loaded.problems).toHaveLength(1);
		expect(loaded.problems[0]).toMatch(/^mu\.json: "jduges" is not a setting this build knows/);
		expect(loaded.problem).toBe(loaded.problems[0]);
	});

	it("accepts a file that is entirely well-formed without a word", () => {
		expect(
			validateConfig({
				schemaVersion: 1,
				tiers: ["jev"],
				modes: { default: "active" },
				judges: { laya: { type: "local" } },
				recordState: false,
			}),
		).toEqual([]);
	});
});
