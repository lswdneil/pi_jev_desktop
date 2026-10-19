// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import type { MenuItemConstructorOptions } from "electron";

/**
 * The application menu, or nothing.
 *
 * On macOS the system sends Cmd+C, Cmd+V and Cmd+Q through menu roles: an app that installs no menu has no menu bar,
 * and those keys do nothing. The standard roles are the whole answer there, and the shell's own chrome is the rest.
 *
 * Windows and Linux keep no menu bar at all — the window is the product — which is why this returns `null` rather than
 * a hidden menu: `Menu.setApplicationMenu(null)` is the documented way to have none.
 */
export function applicationMenu(platform: NodeJS.Platform): readonly MenuItemConstructorOptions[] | null {
	if (platform !== "darwin") return null;
	return [{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }];
}
