// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Where the settings live, how they are read, and the one rule a write follows.
 *
 * The manifest comes from the harness this window is attached to, not from this build: a checkout carries
 * `packages/kyrn-judge/manifest.json`, an npm install carries `judge/manifest.json`. That is what makes the settings
 * screen a picture of *this* kernel — a shell built last month still shows the options the running harness has.
 *
 * A write is validated against the manifest first (the option has to exist, the value has to be the kind the manifest
 * says, within its bounds), then merged into the document, which keeps every key this shell does not understand. The
 * file is `mu.json` in mu's agent directory: what the harness reads on its next start, which is why the screen says so.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";
import {
	applyChange,
	SettingsChangeError,
	type ManifestFeature,
	type ManifestOption,
	type SettingsDocument,
	type SettingsManifest,
} from "../shared/settings.ts";

/**
 * The change rule lives with the types (`shared/settings.ts`) because the screen applies it too: it shows a value as
 * soon as it is clicked and puts the old one back if the write is refused. The main process runs the same function
 * before saving, so "the screen shows it" and "the file holds it" cannot drift.
 */
export { applyChange, SettingsChangeError };

/**
 * This app's agent directory, the one the kernel reads `mu.json` from (`config.ts` `ConfigSource.dir`).
 *
 * `mu` (the command line) and `spec.ai.jev` (this app) are two products with their own state: the folder is
 * `~/.spec.ai.jev/agent`, not the command line's `~/.mu/agent`, and nothing migrates between them. The kernel is told
 * about it with `MU_AGENT_DIR` (see `main/index.ts`), so both sides agree on one path.
 */
export function agentDirFor(home: string, platform: NodeJS.Platform): string {
	return pathFor(platform).join(home, ".spec.ai.jev", "agent");
}

export function settingsFileFor(home: string, platform: NodeJS.Platform): string {
	return pathFor(platform).join(agentDirFor(home, platform), "mu.json");
}

/** The consent file the kernel reads, beside `mu.json`. */
export function consentFileFor(home: string, platform: NodeJS.Platform): string {
	return pathFor(platform).join(agentDirFor(home, platform), "consent.json");
}

function pathFor(platform: NodeJS.Platform): typeof posix {
	return platform === "win32" ? win32 : posix;
}

/** Where a harness keeps its manifest: a checkout has the package, an npm install has the `judge/` folder. */
export function manifestCandidates(root: string, platform: NodeJS.Platform): string[] {
	const p = pathFor(platform);
	return [
		p.join(root, "packages", "kyrn-judge", "manifest.json"),
		p.join(root, "judge", "manifest.json"),
		p.join(root, "manifest.json"),
	];
}

export function findManifest(root: string, platform: NodeJS.Platform, exists: (file: string) => boolean): string | undefined {
	return manifestCandidates(root, platform).find((candidate) => exists(candidate));
}

export class ManifestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ManifestError";
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function localized(value: unknown, where: string): Record<string, string> {
	const text = record(value);
	if (text === undefined) throw new ManifestError(`${where} is not a text`);
	const entries = Object.entries(text).filter(([, entry]) => typeof entry === "string") as [string, string][];
	if (entries.length === 0) throw new ManifestError(`${where} has no language`);
	return Object.fromEntries(entries);
}

function optionalLocalized(value: unknown, where: string): Record<string, string> | undefined {
	return value === undefined ? undefined : localized(value, where);
}

function number(value: unknown, where: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new ManifestError(`${where} is not a number`);
	return value;
}

function option(value: unknown, where: string): ManifestOption {
	const entry = record(value);
	if (entry === undefined) throw new ManifestError(`${where} is not an option`);
	const key = entry.key;
	if (typeof key !== "string" || key === "") throw new ManifestError(`${where} has no key`);
	const label = localized(entry.label, `${where}.label`);
	const help = optionalLocalized(entry.help, `${where}.help`);
	const base = { key, label, ...(help === undefined ? {} : { help }) };

	switch (entry.kind) {
		case "boolean":
			return { ...base, kind: "boolean", default: entry.default === true };
		case "number":
			return {
				...base,
				kind: "number",
				default: number(entry.default, `${where}.default`),
				...(typeof entry.min === "number" ? { min: entry.min } : {}),
				...(typeof entry.max === "number" ? { max: entry.max } : {}),
				...(entry.unit === undefined ? {} : { unit: localized(entry.unit, `${where}.unit`) }),
			};
		case "text":
			return { ...base, kind: "text", default: typeof entry.default === "string" ? entry.default : "" };
		case "list":
			return {
				...base,
				kind: "list",
				default: Array.isArray(entry.default) ? entry.default.filter((item): item is string => typeof item === "string") : [],
			};
		case "numbers":
			return {
				...base,
				kind: "numbers",
				default: Array.isArray(entry.default) ? entry.default.filter((item): item is number => typeof item === "number") : [],
			};
		case "choice": {
			const choices = Array.isArray(entry.choices) ? entry.choices : [];
			return {
				...base,
				kind: "choice",
				default: typeof entry.default === "string" ? entry.default : "",
				choices: choices.map((choice, index) => {
					const item = record(choice);
					if (item === undefined || typeof item.value !== "string") {
						throw new ManifestError(`${where}.choices[${index}] has no value`);
					}
					return { value: item.value, label: localized(item.label, `${where}.choices[${index}].label`) };
				}),
			};
		}
		default:
			// A kind from a newer kernel: shown, not dropped, and not editable until this build learns it.
			return { ...base, kind: "unsupported", default: entry.default };
	}
}

function feature(value: unknown, where: string): ManifestFeature {
	const entry = record(value);
	if (entry === undefined) throw new ManifestError(`${where} is not a feature`);
	if (typeof entry.name !== "string" || entry.name === "") throw new ManifestError(`${where} has no name`);
	const summary = optionalLocalized(entry.summary, `${where}.summary`);
	const options = Array.isArray(entry.options) ? entry.options : [];
	return {
		name: entry.name,
		title: localized(entry.title, `${where}.title`),
		...(summary === undefined ? {} : { summary }),
		...(typeof entry.defaultEnabled === "boolean" ? { defaultEnabled: entry.defaultEnabled } : {}),
		options: options.map((item, index) => option(item, `${where}.options[${index}]`)),
	};
}

function decision(value: unknown, where: string): SettingsManifest["decisions"][number] {
	const entry = record(value);
	if (entry === undefined) throw new ManifestError(`${where} is not a decision`);
	if (typeof entry.id !== "string" || entry.id === "") throw new ManifestError(`${where} has no id`);
	return {
		id: entry.id,
		group: typeof entry.group === "string" ? entry.group : "unknown",
		feature: typeof entry.feature === "string" ? entry.feature : "",
		title: localized(entry.title, `${where}.title`),
		summary: localized(entry.summary, `${where}.summary`),
	};
}

function mode(value: unknown, where: string): SettingsManifest["modes"][number] {
	const entry = record(value);
	if (entry === undefined) throw new ManifestError(`${where} is not a mode`);
	if (typeof entry.value !== "string" || entry.value === "") throw new ManifestError(`${where} has no value`);
	const help = optionalLocalized(entry.help, `${where}.help`);
	return { value: entry.value, label: localized(entry.label, `${where}.label`), ...(help === undefined ? {} : { help }) };
}

/**
 * The manifest as data. It is read strictly: a malformed manifest is a broken install, and a settings screen built
 * from half of one is worse than an error that says which field is wrong.
 */
export function parseManifest(text: string): SettingsManifest {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new ManifestError("manifest.json is not valid JSON");
	}
	const entry = record(value);
	if (entry === undefined) throw new ManifestError("manifest.json does not hold an object");
	const version = number(entry.version, "version");
	const groups = record(entry.groups);
	if (groups === undefined) throw new ManifestError("groups is not an object");
	const features = entry.features;
	if (!Array.isArray(features)) throw new ManifestError("features is not a list");
	const decisions = entry.decisions;
	if (!Array.isArray(decisions)) throw new ManifestError("decisions is not a list");
	const modes = Array.isArray(entry.modes) ? entry.modes : [];

	return {
		version,
		groups: Object.fromEntries(Object.entries(groups).map(([id, value]) => [id, localized(value, `groups.${id}`)])),
		modes: modes.map((value, index) => mode(value, `modes[${index}]`)),
		features: features.map((value, index) => feature(value, `features[${index}]`)),
		decisions: decisions.map((value, index) => decision(value, `decisions[${index}]`)),
	};
}

export function readManifest(file: string): SettingsManifest {
	return parseManifest(readFileSync(file, "utf8"));
}

export interface SettingsReadResult {
	readonly document: SettingsDocument;
	readonly problems: string[];
}

/** `mu.json` as it is on disk. A missing file is not a problem; a broken one is reported and treated as empty. */
export function readSettings(file: string): SettingsReadResult {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return { document: {}, problems: [] };
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { document: {}, problems: [`${file} is not valid JSON, so the defaults are in use`] };
	}
	const entry = record(value);
	if (entry === undefined) return { document: {}, problems: [`${file} does not hold a JSON object`] };
	return { document: entry, problems: [] };
}

/** Writing is atomic and owner-only: a half-written `mu.json` would come back as "defaults are in use". */
export function writeSettings(file: string, document: SettingsDocument): void {
	mkdirSync(dirname(file), { recursive: true });
	const temporary = `${file}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(document, null, "\t")}\n`, { mode: 0o600 });
	renameSync(temporary, file);
}

/** The home the shell reads mu's files from. Injected by the caller so a test does not need this machine's. */
export function homeDirectory(): string {
	return homedir();
}
