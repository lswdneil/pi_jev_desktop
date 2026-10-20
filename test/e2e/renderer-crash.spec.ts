// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test, type Page } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * A renderer that dies while the app is running.
 *
 * The crash is real: Electron's `forcefullyCrashRenderer` takes the renderer down the way a GPU hang or a renderer
 * bug does, which is the failure a person reports as "the window went blank". Two things must hold after it: the
 * shell's own log says what happened (the file a report can be checked against), and a working window comes back
 * without the app restarting — the agent behind it never stopped.
 *
 * The log is read from the `--user-data-dir` this run owns, not from the developer's profile.
 */

test.describe("a crashed renderer", () => {
	test("is recorded in the shell log, and the window is replaced with one that works", async () => {
		const profile = await launchApp();
		const { app, page } = profile;

		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			// A CDP Page.crash call can stay pending after its target is destroyed; trigger from the surviving process.
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
			});

			// The log is the evidence: the crash, then the replacement, in that order.
			await expect.poll(() => profile.shellLog() ?? "", { timeout: 20_000 }).toContain("a renderer process is gone");
			const log = profile.shellLog() ?? "";
			expect(log).toMatch(/error a renderer process is gone \{.*"reason":"crashed"/);
			expect(log).toContain("replacing the window after its renderer was gone");
			expect(log.indexOf("a renderer process is gone")).toBeLessThan(log.indexOf("replacing the window"));

			// A fresh window comes back, on the app's origin, with the agent still running behind it.
			//
			// Every wait below is a poll, because a crash is asynchronous in three separate ways and the first version of
			// this test read each of them once: the crashed page may still report itself open when the replacement is
			// already there (so `find` could hand back the dead window), the new window exists before it has navigated
			// to `app://spec`, and the old one closes a moment after the new one is up.
			const findReplacement = async (): Promise<Page> => {
				for (let attempt = 0; attempt < 300; attempt++) {
					const candidate = app.windows().find((window) => window !== page && !window.isClosed());
					if (candidate !== undefined) return candidate;
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				throw new Error("no window replaced the crashed one within 30 s");
			};
			const replacement = await findReplacement();
			await expect
				.poll(() => replacement.evaluate(() => location.origin).catch(() => ""), { timeout: 30_000 })
				.toBe("app://spec");
			await expect(replacement.locator(".chip")).toContainText("running", { timeout: 60_000 });
			// The crashed page is gone; the app did not quit and did not fall back to a first-run wizard.
			await expect.poll(() => page.isClosed(), { timeout: 30_000 }).toBe(true);
			expect(await replacement.locator('[data-testid="first-run"]').count()).toBe(0);
		} finally {
			await profile.close();
		}
	});
});

test.describe("a crash that keeps happening", () => {
	/**
	 * The budget is per run, not per window: two replacements, then the third crash is recorded and the person is told
	 * to restart spec.ai.jev — a window that only reproduces the crash would look like the app still works. The crash here comes
	 * from the main process (`forcefullyCrashRenderer`), not the DevTools protocol — the protocol call on a window that
	 * has already been replaced never answers, which is why this case cannot use `Page.crash`.
	 */
	test("replaces the window twice, then stops and says to restart", async () => {
		const profile = await launchApp();
		const { app, page } = profile;
		const crash = async (): Promise<void> => {
			await app.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
			});
		};

		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			let current = page;
			for (const recovery of [1, 2]) {
				// Listen before crashing: the replacement window is announced as it opens.
				const announced = app.waitForEvent("window", { timeout: 30_000 });
				await crash();
				current = await announced;
				await expect(current.locator(".chip")).toContainText("running", { timeout: 60_000 });
				await expect
					.poll(
						() => (profile.shellLog() ?? "").match(/replacing the window after its renderer was gone/g)?.length ?? 0,
						{ timeout: 20_000 },
					)
					.toBe(recovery);
			}

			// The third crash is not replaced: the log says so, no window arrives for it, and the person is told once in
			// a dialog the main process draws (the dead window cannot draw one). The dialog is replaced before the
			// crash, so the assertion is about the real call site rather than about a message box nobody can dismiss
			// in a test.
			const windowsBefore = app.windows().filter((candidate) => !candidate.isClosed()).length;
			await app.evaluate(({ dialog }) => {
				const messages: string[] = [];
				(globalThis as unknown as { __muMessages?: string[] }).__muMessages = messages;
				const record = (options: { message?: string; detail?: string }): Promise<unknown> => {
					messages.push(`${options.message ?? ""} ${options.detail ?? ""}`);
					return Promise.resolve({ response: 0, checkboxChecked: false });
				};
				(dialog as unknown as { showMessageBox: typeof record }).showMessageBox = record;
			});
			await crash();
			await expect.poll(() => profile.shellLog() ?? "", { timeout: 20_000 }).toContain("not being replaced again");
			await new Promise((resolve) => setTimeout(resolve, 2_000));
			const log = profile.shellLog() ?? "";
			expect(log).toContain('"recoveries":2');
			expect((log.match(/error a renderer process is gone/g) ?? []).length).toBe(3);
			expect((log.match(/replacing the window after its renderer was gone/g) ?? []).length).toBe(2);
			expect(app.windows().filter((candidate) => !candidate.isClosed()).length).toBe(windowsBefore);
			const messages = await app.evaluate(
				() => (globalThis as unknown as { __muMessages?: string[] }).__muMessages ?? [],
			);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toContain("keeps crashing");
			expect(messages[0]).toContain("spec-shell.log");
		} finally {
			await profile.close();
		}
	});
});
