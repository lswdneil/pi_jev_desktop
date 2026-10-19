// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The settings, as the kernel describes them.
 *
 * `packages/kyrn-judge/manifest.json` is the single source of truth: every feature, every option with its kind,
 * default, bounds and choices, and every decision point, each text in thirteen languages. The kernel's own comment
 * says why it exists as data — "for clients that do not import TypeScript (the desktop app reads it)" — so the shell
 * renders from it instead of writing forms by hand, and a new option in the kernel shows up here without a line of
 * shell code.
 *
 * Nothing here re-derives a default. A default is whatever the manifest says; when the manifest is silent the control
 * shows the kernel's value instead of guessing.
 */

/** One text in every language the kernel ships. Keys are language tags (`en`, `zh`, `zh-TW`, …). */
export type LocalizedText = Readonly<Record<string, string>>;

/** A feature switched off is `false` under `features.<name>`; switched on it is an object of option values. */
export type FeatureSettings = Readonly<Record<string, unknown>> | false;

/** A `mu.json` as this shell touches it: it preserves everything it does not understand. */
export type SettingsDocument = Readonly<Record<string, unknown>>;

interface OptionBase {
	readonly key: string;
	readonly label: LocalizedText;
	readonly help?: LocalizedText;
}

export type ManifestOption =
	| (OptionBase & { readonly kind: "boolean"; readonly default: boolean })
	| (OptionBase & {
			readonly kind: "number";
			readonly default: number;
			readonly min?: number;
			readonly max?: number;
			readonly unit?: LocalizedText;
	  })
	| (OptionBase & { readonly kind: "text"; readonly default: string })
	| (OptionBase & { readonly kind: "list"; readonly default: readonly string[] })
	| (OptionBase & { readonly kind: "numbers"; readonly default: readonly number[] })
	| (OptionBase & {
			readonly kind: "choice";
			readonly default: string;
			readonly choices: readonly { readonly value: string; readonly label: LocalizedText }[];
	  })
	/** A kind this build does not know. The screen shows it as read-only and says so, rather than dropping it. */
	| (OptionBase & { readonly kind: "unsupported"; readonly default?: unknown });

export interface ManifestFeature {
	readonly name: string;
	readonly title: LocalizedText;
	readonly summary?: LocalizedText;
	readonly defaultEnabled?: boolean;
	readonly options: readonly ManifestOption[];
}

export interface ManifestDecision {
	readonly id: string;
	readonly group: string;
	/** The feature that asks it; switching that feature off silences the decision. */
	readonly feature: string;
	readonly title: LocalizedText;
	readonly summary: LocalizedText;
}

export interface ManifestMode {
	readonly value: string;
	readonly label: LocalizedText;
	readonly help?: LocalizedText;
}

export interface SettingsManifest {
	readonly version: number;
	readonly groups: Readonly<Record<string, LocalizedText>>;
	readonly modes: readonly ManifestMode[];
	readonly features: readonly ManifestFeature[];
	readonly decisions: readonly ManifestDecision[];
}

/** What the settings screen loads. `path` is where a change would be written, which the screen shows. */
export interface SettingsSnapshot {
	readonly manifest: SettingsManifest;
	readonly document: SettingsDocument;
	readonly path: string;
	readonly problems: readonly string[];
}

/** One change the screen asks for. The main process validates it against the manifest before writing anything. */
export interface SettingsChange {
	readonly feature: string;
	readonly option: string;
	readonly value: unknown;
}

/** The languages the kernel ships, in the order the first-run screen offers them. */
export const MANIFEST_LANGUAGES = [
	"en",
	"zh",
	"zh-TW",
	"ja-JP",
	"ko-KR",
	"de-DE",
	"fr-FR",
	"es-ES",
	"pt-BR",
	"ru-RU",
	"uk-UA",
	"tr-TR",
	"fa-IR",
] as const;

export const FALLBACK_LANGUAGE = "en";

/**
 * The text for a language: exact tag, then its base language (so `zh-Hans` finds `zh`), then English, then the first
 * language the manifest has. When there is no text at all the caller gets the code it asked for, which is more useful
 * on screen than an empty label — an unknown presentation code must not blank the interface.
 */
export function localized(text: LocalizedText | undefined, language: string, code: string): string {
	if (text === undefined) return code;
	const exact = text[language];
	if (typeof exact === "string" && exact !== "") return exact;
	const base = language.split("-")[0];
	if (base !== undefined) {
		for (const [tag, value] of Object.entries(text)) {
			if (tag.split("-")[0] === base && value !== "") return value;
		}
	}
	const english = text[FALLBACK_LANGUAGE];
	if (typeof english === "string" && english !== "") return english;
	const first = Object.values(text).find((value) => typeof value === "string" && value !== "");
	return first ?? code;
}

export function optionOf(feature: ManifestFeature, key: string): ManifestOption | undefined {
	return feature.options.find((option) => option.key === key);
}

/** The value in use: the document's, or the manifest's default when the document is silent. */
export function valueOf(document: SettingsDocument, feature: ManifestFeature, option: ManifestOption): unknown {
	const features = document.features;
	if (typeof features !== "object" || features === null) return option.default;
	const settings = (features as Record<string, unknown>)[feature.name];
	if (settings === false) return option.default;
	if (typeof settings !== "object" || settings === null) return option.default;
	const value = (settings as Record<string, unknown>)[option.key];
	return value === undefined ? option.default : value;
}

/** Whether a feature is on: an explicit `false` turns it off, otherwise the manifest's own default decides. */
export function featureEnabled(document: SettingsDocument, feature: ManifestFeature): boolean {
	const features = document.features;
	if (typeof features === "object" && features !== null) {
		const settings = (features as Record<string, unknown>)[feature.name];
		if (settings === false) return false;
		if (typeof settings === "object" && settings !== null) return true;
	}
	return feature.defaultEnabled ?? true;
}

/** A readable value for the log and for a read-only row. */
export function describeValue(value: unknown): string {
	if (Array.isArray(value)) return value.length === 0 ? "(empty)" : value.join(", ");
	if (value === undefined) return "(unset)";
	if (typeof value === "string") return value === "" ? "(empty)" : value;
	return String(value);
}

/** A change the screen asks for, judged against the manifest before anything is written. */
export class SettingsChangeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SettingsChangeError";
	}
}

function checked(option: ManifestOption, value: unknown): unknown {
	const where = `"${option.key}"`;
	switch (option.kind) {
		case "boolean":
			if (typeof value !== "boolean") throw new SettingsChangeError(`${where} takes true or false`);
			return value;
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) throw new SettingsChangeError(`${where} takes a number`);
			if (option.min !== undefined && value < option.min) throw new SettingsChangeError(`${where} may not be below ${option.min}`);
			if (option.max !== undefined && value > option.max) throw new SettingsChangeError(`${where} may not be above ${option.max}`);
			return value;
		}
		case "text":
			if (typeof value !== "string") throw new SettingsChangeError(`${where} takes text`);
			return value;
		case "list":
			if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
				throw new SettingsChangeError(`${where} takes a list of strings`);
			}
			return [...value];
		case "numbers":
			if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
				throw new SettingsChangeError(`${where} takes a list of numbers`);
			}
			return [...value];
		case "choice":
			if (typeof value !== "string") throw new SettingsChangeError(`${where} takes one of its choices`);
			if (!option.choices.some((choice) => choice.value === value)) {
				throw new SettingsChangeError(`${where} may not be ${JSON.stringify(value)}`);
			}
			return value;
		case "unsupported":
			throw new SettingsChangeError(`${where} is a setting from a newer kernel; this build cannot change it`);
	}
}

/**
 * The document with one option set. Everything else is preserved, including keys this shell does not know: a settings
 * screen that dropped what it cannot show would quietly erase a hand-written `tiers` list.
 *
 * The screen calls this to show a change immediately and the main process calls it before writing, so there is one
 * answer to "is this value allowed", not two that can disagree.
 */
export function applyChange(document: SettingsDocument, manifest: SettingsManifest, change: SettingsChange): SettingsDocument {
	const feature = manifest.features.find((entry) => entry.name === change.feature);
	if (feature === undefined) throw new SettingsChangeError(`there is no feature called ${JSON.stringify(change.feature)}`);
	const option = feature.options.find((entry) => entry.key === change.option);
	if (option === undefined) {
		throw new SettingsChangeError(`${feature.name} has no option called ${JSON.stringify(change.option)}`);
	}
	const value = checked(option, change.value);

	const current = document.features;
	const features: Record<string, unknown> =
		typeof current === "object" && current !== null ? { ...(current as Record<string, unknown>) } : {};
	const existing = features[feature.name];
	const settings: Record<string, unknown> =
		existing === false || typeof existing !== "object" || existing === null ? {} : { ...(existing as Record<string, unknown>) };
	settings[option.key] = value;
	features[feature.name] = settings;

	return { ...document, features };
}
