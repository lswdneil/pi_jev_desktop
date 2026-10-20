// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/** Whether the right-hand panels were left open, and which tab they were showing. */

const STORAGE_KEY = "spec.ai.jev.panelsOpen";
const TAB_KEY = "spec.ai.jev.panelTab";

export type PanelTab = "board" | "files" | "judgments";

export function readPanelsOpen(): boolean {
	try {
		return window.localStorage.getItem(STORAGE_KEY) !== "0";
	} catch {
		return true;
	}
}

export function rememberPanelsOpen(open: boolean): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
	} catch {
		// Storage is optional; the panels still fold for this window.
	}
}

export function readPanelTab(): PanelTab {
	try {
		const value = window.localStorage.getItem(TAB_KEY);
		return value === "files" || value === "judgments" ? value : "board";
	} catch {
		return "board";
	}
}

export function rememberPanelTab(tab: PanelTab): void {
	try {
		window.localStorage.setItem(TAB_KEY, tab);
	} catch {
		// Same as above: the tab still changes for this window.
	}
}
