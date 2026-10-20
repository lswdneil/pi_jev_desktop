// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import { SHELL_LANGUAGES, SHELL_TRANSLATIONS, shellText } from "../../src/renderer/lib/shell-strings.ts";

/**
 * The shell's chrome in every language it claims.
 *
 * A key missing from one language falls back to English at runtime, which is a sentence nobody translated appearing in
 * the middle of a Chinese window. The fallback is right for a language the shell has never heard of; it is not right
 * for one of its own three.
 */

describe("the shell's own words", () => {
	it("carries every key in every language, each with text", () => {
		const keys = Object.keys(SHELL_TRANSLATIONS.en).sort();
		expect(keys.length).toBeGreaterThan(20);
		for (const language of SHELL_LANGUAGES) {
			expect(Object.keys(SHELL_TRANSLATIONS[language]).sort(), language).toEqual(keys);
			for (const key of keys) {
				expect(SHELL_TRANSLATIONS[language][key]?.trim(), `${language} / ${key}`).not.toBe("");
			}
		}
	});

	it("falls back the way a person would expect", () => {
		// A regional variant of a language the shell has is that language; one it does not have is English.
		expect(shellText("zh-CN", "nav.conversation")).toBe(SHELL_TRANSLATIONS.zh["nav.conversation"]);
		expect(shellText("de-DE", "nav.conversation")).toBe(SHELL_TRANSLATIONS.en["nav.conversation"]);
		// A key nobody wrote is shown as the key, not as an empty button.
		expect(shellText("en", "no.such.key")).toBe("no.such.key");
	});
});
