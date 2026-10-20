// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/** Whether the right-hand panels were left open. Kept beside the other window choices. */

const STORAGE_KEY = "spec.ai.jev.panelsOpen";

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
