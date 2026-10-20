// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { completeFirstRun, FIXTURE_HARNESS, launchApp } from "./helpers/app.ts";

test("fits the workspace at the minimum desktop window size", async () => {
	const profile = await launchApp();
	try {
		await completeFirstRun(profile.page);
		await profile.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(720, 540));
		await expect(profile.page.getByTestId("composer")).toBeVisible();
		await expect(profile.page.getByTestId("model-picker")).toBeVisible();
		await expect
			.poll(() => profile.page.evaluate(() => window.spec.workspace.current().then((value) => value.path)))
			.toBe(FIXTURE_HARNESS);
		await expect.poll(() => profile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await profile.page.screenshot({ path: join(__dirname, "../../test-results/branding-720.png") });
	} finally {
		await profile.close();
	}
});

test("follows a long history to the latest message without dragging a reader down", async () => {
	const profile = await launchApp({ env: { SPEC_AI_JEV_FIXTURE_HISTORY: "250" } });
	try {
		const { page } = profile;
		await completeFirstRun(page);
		await expect(page.locator(".message")).toHaveCount(200);
		const list = page.getByTestId("messages");
		await expect
			.poll(() => list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight))
			.toBeLessThan(4);
		await page.getByTestId("nav-settings").click();
		await page.evaluate(() => window.spec.harness.prompt("stream"));
		await page.getByTestId("nav-conversation").click();
		await expect
			.poll(() => list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight))
			.toBeLessThan(4);
		await list.evaluate((element) => {
			element.scrollTop = 0;
			element.dispatchEvent(new Event("scroll"));
		});
		await page.evaluate(() => window.spec.harness.prompt("stream"));
		await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Hello from the fixture");
		await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
	} finally {
		await profile.close();
	}
});

test("translates the main conversation controls and panel navigation", async () => {
	const profile = await launchApp();
	try {
		await completeFirstRun(profile.page, "zh");
		await expect(profile.page.getByTestId("send")).toHaveText("发送");
		await expect(profile.page.getByTestId("stop")).toHaveText("停止");
		await expect(profile.page.getByTestId("tab-board")).toHaveText("任务板");
		await expect(profile.page.getByTestId("composer")).toHaveAccessibleName("消息");
		await expect(profile.page.getByTestId("board-panel")).toContainText("空闲");
		// The rail's own chrome is Chinese too: the status chip and the session card used to stay English.
		await expect(profile.page.locator(".chip")).toContainText("运行中");
		await expect(profile.page.locator(".session-card")).toContainText("会话 ·");
		await profile.page.screenshot({ path: join(__dirname, "../../test-results/branding-zh.png") });
	} finally {
		await profile.close();
	}
});

test("keeps an unsent draft when visiting settings", async () => {
	const profile = await launchApp();
	try {
		const { page } = profile;
		await completeFirstRun(page);
		await expect(page.getByTestId("composer")).toBeEnabled();
		await page.getByTestId("composer").fill("my unsent draft");
		await page.getByTestId("nav-settings").click();
		await expect(page.getByTestId("settings")).toBeVisible();
		await expect(page.getByTestId("conversation")).toBeHidden();
		await page.getByTestId("nav-conversation").click();
		await expect(page.getByTestId("composer")).toHaveValue("my unsent draft");
	} finally {
		await profile.close();
	}
});

test("keeps the old messages when a new session is cancelled", async () => {
	const profile = await launchApp({ env: { SPEC_AI_JEV_FIXTURE_CANCEL_NEW_SESSION: "1" } });
	try {
		await completeFirstRun(profile.page);
		await expect(profile.page.locator(".message")).toHaveCount(2);
		await profile.page.getByTestId("new-conversation").click();
		await expect(profile.page.getByTestId("error")).toContainText(/cancel/i);
		await expect(profile.page.locator(".message")).toHaveCount(2);
	} finally {
		await profile.close();
	}
});

test("quick open finds a project file and opens it in the Files panel", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "spec-e2e-quick-open-"));
	mkdirSync(join(workspace, "src"), { recursive: true });
	writeFileSync(join(workspace, "src", "app.ts"), "export const value = 1;\n");
	const profile = await launchApp({ env: { SPEC_AI_JEV_WORKSPACE: workspace } });
	try {
		const { page } = profile;
		await completeFirstRun(page);
		await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

		await page.keyboard.press("Control+P");
		await expect(page.getByTestId("quick-open")).toBeVisible();
		await page.getByTestId("quick-open-input").fill("app");

		const hit = page.getByTestId("quick-open-hit").first();
		await expect(hit).toContainText("src/app.ts");
		// The palette has to keep a selection under the keyboard as results arrive.
		await page.keyboard.press("Enter");

		await expect(page.getByTestId("quick-open")).toHaveCount(0);
		await expect(page.getByTestId("tab-files")).toHaveAttribute("aria-selected", "true");
		await expect(page.getByTestId("file-preview")).toContainText("export const value = 1;");
	} finally {
		await profile.close();
		rmSync(workspace, { recursive: true, force: true });
	}
});

test("Ctrl+K opens the palette and runs an action", async () => {
	const profile = await launchApp();
	try {
		const { page } = profile;
		await completeFirstRun(page);

		await page.keyboard.press("Control+K");
		await expect(page.getByTestId("quick-open")).toBeVisible();
		await page.getByTestId("quick-open-input").fill("settings");

		await page.getByTestId("quick-open-action").filter({ hasText: "Settings" }).click();
		await expect(page.getByTestId("settings")).toBeVisible();
		await expect(page.getByTestId("quick-open")).toHaveCount(0);
	} finally {
		await profile.close();
	}
});

test("the palette reaches a session in another project", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "spec-e2e-palette-"));
	const other = mkdtempSync(join(tmpdir(), "spec-e2e-palette-other-"));
	const profile = await launchApp({
		env: { SPEC_AI_JEV_WORKSPACE: workspace },
		prepareHome: (home) => {
			const directory = join(home, ".spec.ai.jev", "agent", "sessions", "encoded");
			mkdirSync(directory, { recursive: true });
			const lines = [
				JSON.stringify({ type: "session", version: 3, id: "palette", cwd: other }),
				JSON.stringify({
					type: "message",
					message: { role: "user", content: [{ type: "text", text: "Palette target" }] },
				}),
			];
			writeFileSync(join(directory, "palette.jsonl"), `${lines.join("\n")}\n`, "utf8");
		},
	});
	try {
		const { page } = profile;
		await completeFirstRun(page);
		await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

		await page.keyboard.press("Control+K");
		await page.getByTestId("quick-open-input").fill("palette target");
		const session = page.getByTestId("quick-open-session").filter({ hasText: "Palette target" });
		await expect(session).toBeVisible({ timeout: 30_000 });
		await session.click();

		await expect(page.locator(".workspace-name")).toHaveText(basename(other), { timeout: 60_000 });
	} finally {
		await profile.close();
		rmSync(workspace, { recursive: true, force: true });
		rmSync(other, { recursive: true, force: true });
	}
});

test("folds the right panel away without losing the draft, and remembers the choice", async () => {
	const profileDir = mkdtempSync(join(tmpdir(), "spec-e2e-panels-"));
	const first = await launchApp({ profileDir });
	try {
		const { page } = first;
		await completeFirstRun(page);
		await expect(page.getByTestId("board-panel")).toBeVisible();
		await page.getByTestId("composer").fill("a draft that stays put");

		await page.getByTestId("toggle-panels").click();
		await expect
			.poll(() => page.getByTestId("right-panel").evaluate((element) => element.getBoundingClientRect().width))
			.toBe(0);
		await expect(page.getByTestId("composer")).toBeVisible();
		await expect(page.getByTestId("composer")).toHaveValue("a draft that stays put");
		expect(await page.evaluate(() => window.localStorage.getItem("spec.ai.jev.panelsOpen"))).toBe("0");

		await page.getByTestId("toggle-panels").click();
		await expect(page.getByTestId("board-panel")).toBeVisible();
		expect(await page.evaluate(() => window.localStorage.getItem("spec.ai.jev.panelsOpen"))).toBe("1");

		// Leave it folded so the next launch has to restore that.
		await page.getByTestId("toggle-panels").click();
		await expect
			.poll(() => page.getByTestId("right-panel").evaluate((element) => element.getBoundingClientRect().width))
			.toBe(0);
	} finally {
		await first.close();
	}

	const second = await launchApp({ profileDir });
	try {
		await expect(second.page.getByTestId("composer")).toBeVisible();
		await expect
			.poll(() => second.page.getByTestId("right-panel").evaluate((element) => element.getBoundingClientRect().width))
			.toBe(0);
		await expect(second.page.getByTestId("toggle-panels")).toHaveAttribute("aria-label", "Show panels");
	} finally {
		await second.close();
		rmSync(profileDir, { recursive: true, force: true });
	}
});

test("the panels are a tablist a keyboard can drive", async () => {
	const profile = await launchApp();
	try {
		const { page } = profile;
		await completeFirstRun(page);
		await expect(page.getByRole("tablist", { name: "Panels" })).toBeVisible();

		await page.getByTestId("tab-files").click();
		await expect(page.getByTestId("tab-files")).toHaveAttribute("aria-selected", "true");

		// Roving focus is what makes a tablist a tablist: the arrows move both the selection and the focus.
		await page.getByTestId("tab-files").focus();
		await page.keyboard.press("ArrowRight");
		await expect(page.getByTestId("tab-judgments")).toHaveAttribute("aria-selected", "true");
		await expect(page.getByTestId("tab-judgments")).toBeFocused();

		// The agent's state is a live region, so a status change is announced rather than merely drawn.
		await expect(page.locator(".chip")).toHaveAttribute("aria-live", "polite");
	} finally {
		await profile.close();
	}
});

test("comes back at the size it was closed at", async () => {
	const profileDir = mkdtempSync(join(tmpdir(), "spec-e2e-window-"));
	const first = await launchApp({ profileDir });
	try {
		await completeFirstRun(first.page);
		await first.app.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]?.setBounds({ x: 60, y: 40, width: 980, height: 700 });
		});
		// Closing the window is the moment the shell records where it was; the app exits with it.
		await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
		await first.app.waitForEvent("close", { timeout: 30_000 });
	} finally {
		await first.close();
	}

	const second = await launchApp({ profileDir });
	try {
		const bounds = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds());
		expect(bounds).toMatchObject({ width: 980, height: 700 });
	} finally {
		await second.close();
		rmSync(profileDir, { recursive: true, force: true });
	}
});

test("zooms with Ctrl+= and remembers the level", async () => {
	const profileDir = mkdtempSync(join(tmpdir(), "spec-e2e-zoom-"));
	const levelOf = (app: Awaited<ReturnType<typeof launchApp>>["app"]) =>
		app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel() ?? 0);
	const first = await launchApp({ profileDir });
	try {
		await completeFirstRun(first.page);
		await first.page.keyboard.press("Control+=");
		await first.page.keyboard.press("Control+=");
		await expect.poll(() => levelOf(first.app)).toBe(1);
		await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
		await first.app.waitForEvent("close", { timeout: 30_000 });
	} finally {
		await first.close();
	}

	const second = await launchApp({ profileDir });
	try {
		await expect.poll(() => levelOf(second.app)).toBe(1);
		// The shortcut is a page listener: the window has to be showing its own UI before a key can reach it.
		await expect(second.page.getByTestId("nav-conversation")).toBeVisible();
		await second.page.keyboard.press("Control+0");
		await expect.poll(() => levelOf(second.app)).toBe(0);
	} finally {
		await second.close();
		rmSync(profileDir, { recursive: true, force: true });
	}
});

test("shows the judgment-native home after starting a new task", async () => {
	const profile = await launchApp();
	try {
		const { page } = profile;
		await completeFirstRun(page);
		await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });
		await page.getByTestId("new-conversation").click();
		await expect(page.getByRole("heading", { name: "What are we building?" })).toBeVisible();
		await expect(page.getByTestId("composer")).toBeVisible();
		await page.screenshot({ path: join(__dirname, "../../test-results/workspace-home.png") });
	} finally {
		await profile.close();
	}
});
