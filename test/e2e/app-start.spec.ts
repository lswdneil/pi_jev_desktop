// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { type Page, expect, test } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The app, started for real.
 *
 * These tests exist because the security baseline is not observable from a unit test: whether the window is
 * isolated, whether the policy is actually delivered, and whether a missing agent produces a screen with instructions
 * rather than an empty window are all properties of a running Electron app. `npm run build` must have run first.
 *
 * The harness is this checkout's, so the first test also proves the real launcher starts under Electron's own Node. The
 * first-run wizard is walked through first; it has its own file.
 */

/** The page as the renderer sees it, without importing anything from it. */
interface Probe extends Record<string, unknown> {
	__muCspViolations?: string[];
	__muInlineRan?: boolean;
}

/** Read the counter the init script installed. The cast stays local: the page has no types of its own. */
async function violations(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const host = window as unknown as { __muCspViolations?: string[] };
		return host.__muCspViolations ?? [];
	});
}

test.describe("starting", () => {
	test("starts the configured runtime and reports it", async () => {
		test.skip(
			(process.env.SPEC_AI_JEV_HARNESS ?? process.env.PI_JEV_HARNESS) === undefined,
			"set SPEC_AI_JEV_HARNESS to a runtime checkout to run this test",
		);
		const profile = await launchApp({ harness: "checkout" });
		const { page } = profile;

		try {
			await completeFirstRun(page);

			// The window is ours, served from `app://spec`, and the preload got there.
			expect(await page.evaluate(() => location.origin)).toBe("app://spec");

			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });
			await expect(page.locator(".chip")).toHaveText(/running · (repo|package)/);
			await expect(page.locator(".brand img")).toHaveAttribute("alt", "spec.ai.jev");
			// The version row only renders once the bridge answered — and it is this build's version, not Electron's.
			await expect(page.locator(".rail")).toContainText("v0.1.0");

			const status = await page.evaluate(() => window.spec.harness.status());
			expect(status.state).toBe("running");
			if (status.state === "running") {
				// A checkout and a built package are both valid sources; the env names the one this run uses.
				expect(status.layout).toMatch(/^(repo|package)$/);
				const configured = (process.env.SPEC_AI_JEV_HARNESS ?? process.env.PI_JEV_HARNESS ?? "").replaceAll("\\", "/");
				expect(status.root.replaceAll("\\", "/")).toBe(configured);
			}
		} finally {
			await profile.close();
		}
	});

	test("shows where it looked and what to do when there is no harness", async () => {
		const profile = await launchApp({ harness: "none" });
		const { page } = profile;

		try {
			await completeFirstRun(page);

			await expect(page.getByRole("heading", { name: "The agent could not start" })).toBeVisible({ timeout: 90_000 });
			// The screen has to say what to change, not just that something broke. The path is the platform's own.
			await expect(page.locator(".failure")).toContainText("SPEC_AI_JEV_ROOT");
			await expect(page.locator(".failure")).toContainText(profile.home);
			await expect(page.locator(".failure").getByRole("button", { name: "Retry" })).toBeVisible();
			// The header offers the same way out.
			await expect(page.getByTestId("restart")).toHaveText("Retry");
		} finally {
			await profile.close();
		}
	});

	test("shows what a crashing agent said, after the retries are spent", async () => {
		// Not a missing harness: a harness that starts and dies. The window has to end on the error screen with the
		// child's own words, because "it does not work" with no reason is the report nobody can act on.
		const profile = await launchApp({ env: { MU_FIXTURE_CRASH_ON_START: "1" } });
		const { page } = profile;

		try {
			await completeFirstRun(page);

			await expect(page.getByRole("heading", { name: "The agent could not start" })).toBeVisible({ timeout: 90_000 });
			await expect(page.locator(".failure")).toContainText("exited with code 3");
			await expect(page.locator(".failure pre")).toContainText("crashing on purpose");
			await expect(page.locator(".failure").getByRole("button", { name: "Retry" })).toBeVisible();
		} finally {
			await profile.close();
		}
	});

	test("records an uncaught exception in the main process and exits with a failure code", async () => {
		// An exception nothing caught is the failure that used to leave no trace at all. The throw is scheduled from
		// the main process itself (Playwright runs the function there), so it lands on the app's own handler — there is
		// no test-only crash switch in the shipped code.
		const profile = await launchApp();
		const { app, page } = profile;

		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			// The child process is observable while it is alive, so the exit code is too — taken before it exits.
			const exitCode = new Promise<number | null>((resolve) => {
				app.process().once("exit", (code) => resolve(code));
			});
			await app.evaluate(() => {
				setTimeout(() => {
					throw new Error("main-process crash from the test");
				}, 50);
			});

			// The handler logs and quits: the process is gone, the code says it was a failure, and the log says why.
			await app.waitForEvent("close", { timeout: 30_000 });
			expect(await exitCode).toBe(1);
			const log = profile.shellLog() ?? "";
			expect(log).toMatch(/fatal uncaught exception \{.*"message":"main-process crash from the test"/);
			expect(log).toContain("started");
		} finally {
			await profile.close();
		}
	});
});

test.describe("the security baseline", () => {
	test("isolates the renderer from the main process", async () => {
		const profile = await launchApp();
		const { page } = profile;

		try {
			await completeFirstRun(page);
			const globals = await page.evaluate(() =>
				["require", "process", "module", "Buffer", "global", "__dirname"].map((name) => [
					name,
					typeof (window as unknown as Record<string, unknown>)[name],
				]),
			);
			expect(Object.fromEntries(globals)).toEqual({
				require: "undefined",
				process: "undefined",
				module: "undefined",
				Buffer: "undefined",
				global: "undefined",
				__dirname: "undefined",
			});
		} finally {
			await profile.close();
		}
	});

	test("exposes named capabilities only, and validates what they are given", async () => {
		const profile = await launchApp();
		const { page } = profile;

		try {
			await completeFirstRun(page);
			const surface = await page.evaluate(() => Object.keys(window.spec).sort());
			expect(surface).toEqual([
				"app",
				"consent",
				"harness",
				"judgments",
				"preview",
				"sessions",
				"settings",
				"update",
				"workspace",
			]);

			const harnessMethods = await page.evaluate(() => Object.keys(window.spec.harness).sort());
			expect(harnessMethods).toEqual([
				"abort",
				"history",
				"models",
				"newSession",
				"onEvent",
				"onStatus",
				"prompt",
				"respond",
				"restart",
				"setModel",
				"snapshot",
				"status",
				"stop",
			]);
			const workspaceMethods = await page.evaluate(() => Object.keys(window.spec.workspace).sort());
			expect(workspaceMethods).toEqual(["choose", "current", "open", "readFile", "saveFile", "searchFiles"]);
			const sessionMethods = await page.evaluate(() => Object.keys(window.spec.sessions).sort());
			expect(sessionMethods).toEqual(["list", "listAll", "open", "openAcross", "remove", "rename"]);

			// There is no generic sender: a page cannot name a channel of its own.
			const generic = await page.evaluate(() =>
				["invoke", "send", "emit", "ipcRenderer"].filter((name) => name in (window.spec as unknown as Record<string, unknown>)),
			);
			expect(generic).toEqual([]);

			// A payload the main process does not accept comes back as a typed refusal, not as a window that opens.
			await expect(page.evaluate(() => window.spec.preview.open("file:///etc/passwd"))).rejects.toThrow(/invalid-payload/);
			// And a setting the manifest does not describe is refused by the main process, not written.
			await expect(
				page.evaluate(() => window.spec.settings.write({ feature: "no-such-feature", option: "x", value: 1 })),
			).rejects.toThrow(/no feature called/);
		} finally {
			await profile.close();
		}
	});

	test("grants the app's own page no browser permission", async () => {
		const profile = await launchApp();
		const { page } = profile;

		try {
			await completeFirstRun(page);
			// The check handler decides what `navigator.permissions.query` answers. Electron's default, with no handler
			// set, is to grant; this is the assertion that the shell does not rely on that.
			const states = await page.evaluate(async () => {
				const names = ["geolocation", "notifications", "camera", "microphone"] as const;
				const answers: Record<string, string> = {};
				for (const name of names) {
					answers[name] = await navigator.permissions
						.query({ name: name as PermissionName })
						.then((status) => status.state)
						.catch((error: Error) => `error: ${error.message}`);
				}
				return answers;
			});
			expect(states.geolocation).toBe("denied");
			// Chromium does not expose camera/microphone through the Permissions API in every version; what matters is
			// that nothing reports "granted".
			for (const [name, state] of Object.entries(states)) {
				expect(state, `${name} should not be granted`).not.toBe("granted");
			}
		} finally {
			await profile.close();
		}
	});

	test("delivers the production policy and keeps the page inside it", async () => {
		const profile = await launchApp();
		const { page } = profile;

		try {
			await completeFirstRun(page);

			// The policy arrives as a header of the document itself, so there is no window without it.
			const header = await page.evaluate(async () => (await fetch(location.href)).headers.get("content-security-policy"));
			expect(header).toContain("default-src 'none'");
			expect(header).toContain("script-src 'self'");
			expect(header).toContain("frame-ancestors 'none'");
			expect(header).not.toMatch(/script-src[^;]*unsafe-inline/);

			// Count violations from the start of a document, then reload so that the counter is installed first.
			await page.addInitScript(() => {
				const host = window as unknown as Probe;
				host.__muCspViolations = [];
				document.addEventListener("securitypolicyviolation", (event) => {
					host.__muCspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
				});
			});
			await page.reload();
			await expect(page.locator(".brand img")).toHaveAttribute("alt", "spec.ai.jev");
			await expect(page.locator(".chip")).toContainText(/running|starting|restarting/);

			expect(await violations(page)).toEqual([]);

			// Negative control: the same hook does fire when the policy is violated, so the zero above meant something.
			await page.evaluate(() => {
				const script = document.createElement("script");
				script.textContent = "window.__muInlineRan = true;";
				document.head.append(script);
			});
			await expect.poll(async () => (await violations(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);
			expect(await page.evaluate(() => (window as unknown as Probe).__muInlineRan)).toBeUndefined();
		} finally {
			await profile.close();
		}
	});
});
