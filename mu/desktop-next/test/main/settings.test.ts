// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	agentDirFor,
	applyChange,
	consentFileFor,
	findManifest,
	ManifestError,
	manifestCandidates,
	parseManifest,
	readSettings,
	SettingsChangeError,
	settingsFileFor,
	writeSettings,
} from "../../src/main/settings.ts";
import { localized, MANIFEST_LANGUAGES } from "../../src/shared/settings.ts";

/**
 * The settings layer: where the manifest comes from, how strict its parse is, and the one rule a write follows —
 * a change is judged against the manifest, and everything the shell does not understand survives the write.
 */

const TEXT = { en: "Text", zh: "文本", "zh-TW": "文字" };

const MANIFEST = {
	version: 1,
	groups: { input: TEXT },
	modes: [{ value: "active", label: TEXT, help: TEXT }],
	features: [
		{
			name: "preflight",
			title: TEXT,
			summary: TEXT,
			defaultEnabled: true,
			options: [
				{ key: "thinking", kind: "boolean", default: false, label: TEXT },
				{ key: "minSkills", kind: "number", default: 4, min: 1, max: 100, label: TEXT, unit: TEXT },
				{ key: "mode", kind: "choice", default: "auto", label: TEXT, choices: [{ value: "auto", label: TEXT }] },
				{ key: "names", kind: "list", default: [], label: TEXT },
			],
		},
	],
	decisions: [{ id: "input.preflight", group: "input", feature: "preflight", title: TEXT, summary: TEXT }],
};

const DIRECTORIES: string[] = [];

function temporary(): string {
	const directory = mkdtempSync(join(tmpdir(), "mu-settings-"));
	DIRECTORIES.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of DIRECTORIES.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("where mu keeps its files", () => {
	it("puts mu.json and consent.json in the agent directory", () => {
		// This app's own folder, not the command line's `~/.mu`: the two products never read each other's state.
		expect(agentDirFor("/home/ada", "linux")).toBe("/home/ada/.spec.ai.jev/agent");
		expect(settingsFileFor("/home/ada", "linux")).toBe("/home/ada/.spec.ai.jev/agent/mu.json");
		expect(consentFileFor("/home/ada", "linux")).toBe("/home/ada/.spec.ai.jev/agent/consent.json");
		expect(settingsFileFor("C:\\Users\\ada", "win32")).toBe("C:\\Users\\ada\\.spec.ai.jev\\agent\\mu.json");
	});

	it("looks in the checkout first, then the installed package", () => {
		const [checkout, npmPackage] = manifestCandidates("/work/KYRN", "linux");
		expect(checkout).toBe("/work/KYRN/packages/kyrn-judge/manifest.json");
		expect(npmPackage).toBe("/work/KYRN/judge/manifest.json");

		expect(findManifest("/work/KYRN", "linux", (file) => file === npmPackage)).toBe(npmPackage);
		expect(findManifest("/work/KYRN", "linux", () => false)).toBeUndefined();
	});
});

describe("reading the manifest", () => {
	it("reads the fields the screen needs", () => {
		const manifest = parseManifest(JSON.stringify(MANIFEST));
		expect(manifest.version).toBe(1);
		expect(manifest.features.map((feature) => feature.name)).toEqual(["preflight"]);
		expect(manifest.features[0]?.options.map((option) => option.kind)).toEqual(["boolean", "number", "choice", "list"]);
		expect(manifest.decisions[0]?.id).toBe("input.preflight");
	});

	it("keeps an option whose kind this build does not know, as uneditable", () => {
		const future = structuredClone(MANIFEST) as Record<string, unknown>;
		const features = future.features as Record<string, unknown>[];
		(features[0]?.options as Record<string, unknown>[]).push({ key: "colour", kind: "hologram", default: "mauve", label: TEXT });

		const manifest = parseManifest(JSON.stringify(future));
		const option = manifest.features[0]?.options.find((entry) => entry.key === "colour");
		expect(option).toMatchObject({ kind: "unsupported", key: "colour" });

		// And a change through it is refused rather than written as something the kernel cannot read.
		expect(() => applyChange({}, manifest, { feature: "preflight", option: "colour", value: "blue" })).toThrow(
			SettingsChangeError,
		);
	});

	it("says which field is broken instead of half-loading", () => {
		expect(() => parseManifest("not json")).toThrow(ManifestError);
		expect(() => parseManifest(JSON.stringify({ version: 1, groups: {}, features: "no", decisions: [] }))).toThrow(/features is not a list/);
		expect(() =>
			parseManifest(JSON.stringify({ version: 1, groups: {}, features: [{ name: "x", title: {} }], decisions: [] })),
		).toThrow(/title has no language/);
	});
});

describe("the texts", () => {
	it("falls back through the base language and then English", () => {
		expect(localized(TEXT, "zh-TW", "code")).toBe("文字");
		expect(localized(TEXT, "zh-Hans", "code")).toBe("文本");
		expect(localized(TEXT, "de-DE", "code")).toBe("Text");
	});

	it("returns the code when there is no text at all, so an unknown code shows something", () => {
		expect(localized(undefined, "en", "feature.x.title")).toBe("feature.x.title");
		expect(localized({}, "en", "feature.x.title")).toBe("feature.x.title");
	});

	it("offers the kernel's thirteen languages", () => {
		expect(MANIFEST_LANGUAGES).toHaveLength(13);
		expect(MANIFEST_LANGUAGES).toContain("zh-TW");
	});
});

describe("reading mu.json", () => {
	it("treats a missing file as the defaults", () => {
		expect(readSettings(join(temporary(), "mu.json"))).toEqual({ document: {}, problems: [] });
	});

	it("reports a broken file and keeps going with the defaults", () => {
		const directory = temporary();
		const file = join(directory, "mu.json");
		writeFileSync(file, "{ not json");
		const result = readSettings(file);
		expect(result.document).toEqual({});
		expect(result.problems.join("\n")).toMatch(/not valid JSON/);
	});
});

describe("writing a change", () => {
	const manifest = parseManifest(JSON.stringify(MANIFEST));

	it("sets the option and keeps everything else, including what the shell does not know", () => {
		const before = { schemaVersion: 1, tiers: [{ name: "jev" }], features: { other: { kept: true } } };
		const after = applyChange(before, manifest, { feature: "preflight", option: "thinking", value: true });
		expect(after).toEqual({
			schemaVersion: 1,
			tiers: [{ name: "jev" }],
			features: { other: { kept: true }, preflight: { thinking: true } },
		});
	});

	it("turns a switched-off feature back into an object", () => {
		const after = applyChange({ features: { preflight: false } }, manifest, {
			feature: "preflight",
			option: "minSkills",
			value: 10,
		});
		expect(after).toEqual({ features: { preflight: { minSkills: 10 } } });
	});

	it("refuses a feature or an option the manifest does not have", () => {
		expect(() => applyChange({}, manifest, { feature: "nope", option: "x", value: 1 })).toThrow(/no feature called "nope"/);
		expect(() => applyChange({}, manifest, { feature: "preflight", option: "nope", value: 1 })).toThrow(/no option called "nope"/);
	});

	it("refuses a value the manifest's own bounds exclude", () => {
		expect(() => applyChange({}, manifest, { feature: "preflight", option: "minSkills", value: 0 })).toThrow(/may not be below 1/);
		expect(() => applyChange({}, manifest, { feature: "preflight", option: "minSkills", value: 101 })).toThrow(/may not be above 100/);
		expect(() => applyChange({}, manifest, { feature: "preflight", option: "thinking", value: "yes" })).toThrow(/takes true or false/);
		expect(() => applyChange({}, manifest, { feature: "preflight", option: "mode", value: "other" })).toThrow(/may not be "other"/);
		expect(() => applyChange({}, manifest, { feature: "preflight", option: "names", value: [1] })).toThrow(/list of strings/);
	});

	it("writes owner-only, atomically, and leaves no temporary file behind", () => {
		const directory = temporary();
		const file = join(directory, "mu.json");
		writeSettings(file, { features: { preflight: { thinking: true } } });

		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ features: { preflight: { thinking: true } } });
		expect(readdirSync(directory)).toEqual(["mu.json"]);
		if (process.platform !== "win32") {
			// Windows does not report the mode bits it enforces; the kernel's write is the same shape.
			expect(statSync(file).mode & 0o777).toBe(0o600);
		}
	});
});
