// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The app-wide navigation guard: the one rule a WebContents cannot be created without.
 *
 * The window and the preview each attach their own guards, one object at a time — which is exactly how the previous
 * round's hole happened, when a session was created and nobody hardened it. `guardContents` runs from
 * `app.on("web-contents-created")`, so a third WebContents (a print view, devtools, a future panel) inherits the rules
 * without anyone remembering to attach them. What this proves is the part that is easy to get wrong: the guard refuses
 * to let a page that is not the app's own leave where it is, and it leaves the preview its http(s) rule.
 */

import { expect, test } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";
import { listenLoopback } from "./helpers/http.ts";

test.describe("the app-wide guard", () => {
	test("a WebContents nobody guarded still cannot navigate away", async () => {
		const profile = await launchApp();
		try {
			await completeFirstRun(profile.page);

			// A view created by the main process, the way a future panel would be: no view-specific guards attached.
			const contentsId = await profile.app.evaluate(async ({ WebContentsView, BrowserWindow }) => {
				const window = BrowserWindow.getAllWindows()[0];
				const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
				window?.contentView.addChildView(view);
				(globalThis as unknown as { __muProbe: { webContents: Electron.WebContents } }).__muProbe = view;
				await view.webContents.loadURL("data:text/html,<p>probe</p>");
				return view.webContents.id;
			});

			// Renderer-initiated navigation is what `will-navigate` sees; asking the page to leave must not work.
			const after = await profile.app.evaluate(async () => {
				const probe = (globalThis as unknown as { __muProbe: { webContents: Electron.WebContents } }).__muProbe;
				await probe.webContents.executeJavaScript("location.href = 'https://example.com/'").catch(() => {});
				await new Promise((resolve) => setTimeout(resolve, 500));
				return probe.webContents.getURL();
			});

			expect(after).toContain("data:text/html");
			expect(after).not.toContain("example.com");
			expect(contentsId).toBeGreaterThan(0);
		} finally {
			await profile.close();
		}
	});

	test("the preview still follows its own http(s) rule", async () => {
		const { server, origin } = await listenLoopback((url) => ({
			contentType: "text/html; charset=utf-8",
			body: `<p id="where">${url}</p><a id="next" href="/second">next</a>`,
		}));

		const profile = await launchApp();
		try {
			await completeFirstRun(profile.page);
			await profile.page.evaluate((url) => window.mu.preview.open(url), origin);

			// A link inside the previewed page: the preview's rule allows it, and the app-wide guard must not overrule
			// that (which is what it would do if it treated a preview like the app's own page).
			const url = await profile.app.evaluate(async ({ webContents }) => {
				const preview = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("http://127.0.0.1"));
				if (preview === undefined) return "missing";
				await preview.executeJavaScript("document.getElementById('next').click()");
				await new Promise((resolve) => setTimeout(resolve, 600));
				return preview.getURL();
			});
			expect(url).toBe(`${origin}/second`);
		} finally {
			await profile.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
