// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

const STORAGE_KEY = "spec.ai.jev.recentWorkspaces";
const LIMIT = 6;

export function readRecentWorkspaces(): string[] {
	try {
		const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
		if (!Array.isArray(value)) return [];
		return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== ""))].slice(0, LIMIT);
	} catch {
		return [];
	}
}

export function rememberWorkspace(path: string): string[] {
	const next = [path, ...readRecentWorkspaces().filter((item) => item !== path)].slice(0, LIMIT);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Storage is optional; the in-memory list still works for this window.
	}
	return next;
}

/** Take one folder off the list. This forgets the shortcut, never the folder or anything in it. */
export function forgetWorkspace(path: string): string[] {
	const next = readRecentWorkspaces().filter((item) => item !== path);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Same as above: the returned list is still right for this window.
	}
	return next;
}
