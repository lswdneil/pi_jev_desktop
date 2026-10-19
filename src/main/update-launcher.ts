// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Starting a verified installer on this machine.
 *
 * The only file that knows how an update is launched, and the only one that imports Electron's `shell`, so the
 * download-and-verify pipeline stays runnable in a plain Node test.
 */

import { spawn } from "node:child_process";
import { shell } from "electron";

/**
 * Windows runs the installer silent (`/S` for nsis) and detached, so the app can close. Elsewhere the file is handed to
 * the desktop: a `.dmg` mounts, an `.AppImage` or `.deb` is handled by the desktop's own opener.
 */
export async function launchInstaller(file: string): Promise<void> {
	if (process.platform === "win32") {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(file, ["/S"], { detached: true, stdio: "ignore" });
			child.once("error", reject);
			child.once("spawn", () => {
				child.unref();
				resolve();
			});
		});
		return;
	}
	const error = await shell.openPath(file);
	if (error !== "") throw new Error(error);
}
