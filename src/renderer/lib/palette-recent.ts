// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/** The last few commands or sessions run from the palette, newest first. */

const STORAGE_KEY = "spec.ai.jev.paletteRecent";
const LIMIT = 6;

export function readRecentPalette(): string[] {
	try {
		const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
		if (!Array.isArray(value)) return [];
		return [...new Set(value.filter((item): item is string => typeof item === "string" && item !== ""))].slice(0, LIMIT);
	} catch {
		return [];
	}
}

export function rememberPaletteUse(id: string): string[] {
	const next = [id, ...readRecentPalette().filter((item) => item !== id)].slice(0, LIMIT);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Storage is optional; the order still holds for this window.
	}
	return next;
}
