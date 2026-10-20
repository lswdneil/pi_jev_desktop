// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The preview, for real: an http page the agent opened, in its own session, with nothing allowed.
 *
 * `security.ts` states the rules and `test/main/security.test.ts` asserts them as functions; what neither can show is
 * that the view the app builds actually uses them. The old shell ran the preview in the default session, where Electron
 * grants permissions by default — the kind of wiring mistake a unit test of a pure function cannot catch. So this
 * serves a page from a local server, opens it through the app's own bridge, and then asks the page what it was given.
 */

import { type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";
import { listenLoopback } from "./helpers/http.ts";

/** One page that records what the browser said about permissions. */
const PAGE = `<!doctype html>
<html><head><title>preview probe</title></head>
<body>
<p id="title">preview probe</p>
<a id="file" href="file:///etc/passwd">local file</a>
<p id="origin"></p>
<script>
	document.getElementById("origin").textContent = location.origin;
	window.__permissions = {};
	Promise.all([
		navigator.permissions.query({ name: "geolocation" }).then((status) => (window.__permissions.geolocation = status.state)).catch((error) => (window.__permissions.geolocation = "error: " + error.message)),
		navigator.permissions.query({ name: "notifications" }).then((status) => (window.__permissions.notifications = status.state)).catch((error) => (window.__permissions.notifications = "error: " + error.message)),
	]);
</script>
</body></html>`;

/** Serves the probe page on a loopback port Chromium accepts (see `helpers/http.ts`). */
function serve(): Promise<{ server: Server; origin: string }> {
	return listenLoopback(PAGE);
}

test.describe("the preview", () => {
	test("a link in a message opens the preview, and the window closes it", async () => {
		const { server, origin } = await serve();
		const profile = await launchApp({ env: { SPEC_AI_JEV_FIXTURE_LINK_URL: `${origin}/docs` } });
		try {
			const { page } = profile;
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.getByTestId("composer").fill("markdown");
			await page.getByTestId("send").click();
			const link = page.getByTestId("message-link").last();
			await expect(link).toHaveText("the build");
			await link.click();

			// The chip is the app's own knowledge of the view; the view is what the main process actually attached.
			await expect(page.getByTestId("preview-status")).toContainText(new URL(origin).host);
			const attached = () =>
				profile.app.evaluate(({ BrowserWindow }) => {
					const window = BrowserWindow.getAllWindows()[0];
					return (window?.contentView.children ?? []).filter((child) => "webContents" in child).length;
				});
			await expect.poll(attached).toBe(1);

			// It starts under the app's header, so the model picker and this very close button stay reachable.
			const bounds = await profile.app.evaluate(({ BrowserWindow }) => {
				const window = BrowserWindow.getAllWindows()[0];
				const view = (window?.contentView.children ?? []).find((child) => "webContents" in child) as unknown as
					| { getBounds(): Electron.Rectangle }
					| undefined;
				return view?.getBounds();
			});
			expect(bounds?.y).toBeGreaterThanOrEqual(60);
			expect(bounds?.x).toBeGreaterThan(0);

			await page.getByTestId("close-preview").click();
			await expect(page.getByTestId("preview-status")).toHaveCount(0);
			await expect.poll(attached).toBe(0);
		} finally {
			await profile.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	test("shows an http page in its own session, and grants it nothing", async () => {
		const { server, origin } = await serve();
		const profile = await launchApp();
		try {
			await completeFirstRun(profile.page);
			await profile.page.evaluate((url) => window.spec.preview.open(url), origin);

			// The view is attached beside the conversation, in a session of its own rather than the app's — and that
			// session carries the download rule. `will-download` is the one handler a listener count can prove was
			// attached; the permission handlers next to it are what the page's answer above measures.
			const shape = await profile.app.evaluate(async ({ BrowserWindow, webContents, session }) => {
				const window = BrowserWindow.getAllWindows()[0];
				const views = (window?.contentView.children ?? []).filter((child) => "webContents" in child);
				const preview = views
					.map((child) => (child as unknown as { webContents: Electron.WebContents }).webContents)
					.find((contents) => contents.getURL().startsWith("http://127.0.0.1"));
				if (preview === undefined) return { attached: false };
				const permissions = await preview.executeJavaScript("window.__permissions", true);
				return {
					attached: true,
					url: preview.getURL(),
					ownSession: preview.session !== session.defaultSession,
					inAppSession: webContents.getAllWebContents().some((contents) => contents.getURL() === preview.getURL() && contents.session === session.defaultSession),
					downloadRules: preview.session.listenerCount("will-download"),
					permissions,
				};
			});

			expect(shape.attached).toBe(true);
			expect(shape.url).toBe(`${origin}/`);
			expect(shape.ownSession).toBe(true);
			expect(shape.inAppSession).toBe(false);
			// "A previewed page may not download files" is installed on the session the view actually uses, not merely
			// written down in `security.ts`.
			expect(shape.downloadRules).toBe(1);
			// The same "granted unless a handler says otherwise" default this checks against lives here.
			expect(shape.permissions?.geolocation).toBe("denied");
			expect(shape.permissions?.notifications).toBe("denied");
		} finally {
			await profile.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	test("refuses what is not http(s), and closes without leaving the view behind", async () => {
		const profile = await launchApp();
		try {
			await completeFirstRun(profile.page);

			// The payload reaches the main process and the rule there refuses it; the renderer's promise rejects.
			await expect(profile.page.evaluate(() => window.spec.preview.open("file:///etc/passwd"))).rejects.toThrow();
			await expect(profile.page.evaluate(() => window.spec.preview.open("javascript:alert(1)"))).rejects.toThrow();

			const attached = await profile.app.evaluate(({ BrowserWindow }) => {
				const window = BrowserWindow.getAllWindows()[0];
				return (window?.contentView.children ?? []).filter((child) => "webContents" in child).length;
			});
			expect(attached).toBe(0);

			// A refused open leaves nothing behind; an accepted one can be closed again.
			const { server, origin } = await serve();
			try {
				await profile.page.evaluate((url) => window.spec.preview.open(url), origin);
				expect(
					await profile.app.evaluate(({ BrowserWindow }) => {
						const window = BrowserWindow.getAllWindows()[0];
						return (window?.contentView.children ?? []).filter((child) => "webContents" in child).length;
					}),
				).toBe(1);
				await profile.page.evaluate(() => window.spec.preview.close());
				expect(
					await profile.app.evaluate(({ BrowserWindow }) => {
						const window = BrowserWindow.getAllWindows()[0];
						return (window?.contentView.children ?? []).filter((child) => "webContents" in child).length;
					}),
				).toBe(0);
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		} finally {
			await profile.close();
		}
	});
});
