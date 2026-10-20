// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The shell's own words, and the window state that remembers a person's language.
 *
 * The words themselves live in `shell-strings.ts`, apart from anything that needs a browser, so a test can check them
 * without Electron; this file only adds the storage and the hook around them.
 */

import { useCallback, useEffect, useState } from "react";
import { shellText } from "./shell-strings.ts";

export { SHELL_LANGUAGES, SHELL_TRANSLATIONS, shellText } from "./shell-strings.ts";

const LANGUAGE_KEY = "mu.language";
const ONBOARDED_KEY = "mu.onboarded";

function readLanguage(): string {
	try {
		return window.localStorage.getItem(LANGUAGE_KEY) ?? "en";
	} catch {
		return "en";
	}
}

/** The language the page shows: the person's choice, kept in this window's storage. */
export function useLanguage(): { language: string; setLanguage: (language: string) => void; text: (key: string) => string } {
	const [language, setCurrent] = useState<string>(readLanguage);

	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);

	const setLanguage = useCallback((next: string) => {
		setCurrent(next);
		try {
			window.localStorage.setItem(LANGUAGE_KEY, next);
		} catch {
			// Storage disabled: the choice lasts until the window closes, which is a fair degradation.
		}
	}, []);

	const text = useCallback((key: string) => shellText(language, key), [language]);
	return { language, setLanguage, text };
}

export function hasOnboarded(): boolean {
	try {
		return window.localStorage.getItem(ONBOARDED_KEY) === "1";
	} catch {
		return true;
	}
}

export function markOnboarded(): void {
	try {
		window.localStorage.setItem(ONBOARDED_KEY, "1");
	} catch {
		// Nothing to do: the wizard shows again next launch, which is annoying and not harmful.
	}
}
