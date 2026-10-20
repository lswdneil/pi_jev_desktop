// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { MAIN_ENTRY, completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * A second start: the icon clicked again while spec.ai.jev is open.
 *
 * The lock in the main process decides this, and until now nothing tested it. Two copies over one profile would fight
 * over the same session files; one copy that ignores the second click looks like the app did nothing. What is asserted
 * here is the pair: the second process exits on its own, and the window that exists is the one that comes forward.
 */

// The `electron` package's main export is the executable's path when it is loaded outside Electron.
const ELECTRON = require("electron") as string;

test.describe("a second start", () => {
	test("exits instead of opening a second copy, and brings the window forward", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			const second = spawn(ELECTRON, [MAIN_ENTRY, `--user-data-dir=${profile.profileDir}`], {
				env: profile.environment,
				stdio: "ignore",
			});
			const code = await new Promise<number | null>((resolve) => {
				const timer = setTimeout(() => {
					second.kill();
					resolve(null);
				}, 30_000);
				second.once("exit", (exitCode) => {
					clearTimeout(timer);
					resolve(exitCode);
				});
			});
			expect(code, "the second start never exited: that is a second copy over the same profile").toBe(0);

			// The first process records that it was asked for its window; the renderer's own window count stays at one.
			await expect.poll(() => profile.shellLog() ?? "", { timeout: 20_000 }).toContain("a second instance asked for the window");
			const log = profile.shellLog() ?? "";
			expect((log.match(/info started /g) ?? []).length, "the second start became a second running app").toBe(1);
			const windows = await profile.app.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length,
			);
			expect(windows).toBe(1);
			await expect(page.locator('[data-testid="composer"]')).toBeEnabled();
		} finally {
			await profile.close();
		}
	});
});
