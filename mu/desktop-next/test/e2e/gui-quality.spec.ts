// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

test("fits the workspace at the minimum desktop window size", async () => {
	const profile = await launchApp();
	try {
		await completeFirstRun(profile.page);
		await profile.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(720, 540));
		await expect(profile.page.getByTestId("composer")).toBeVisible();
		await expect.poll(() => profile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await profile.page.screenshot({
			path: join(__dirname, "../../../.artifacts/desktop-audit-2026-10-19/workspace-720.png"),
		});
	} finally {
		await profile.close();
	}
});

test("follows a long history to the latest message without dragging a reader down", async () => {
	const profile = await launchApp({ env: { MU_FIXTURE_HISTORY: "250" } });
	try {
		const { page } = profile;
		await completeFirstRun(page);
		await expect(page.locator(".message")).toHaveCount(200);
		const list = page.getByTestId("messages");
		await expect
			.poll(() => list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight))
			.toBeLessThan(4);
		await page.getByTestId("nav-settings").click();
		await page.evaluate(() => window.mu.harness.prompt("stream"));
		await page.getByTestId("nav-conversation").click();
		await expect
			.poll(() => list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight))
			.toBeLessThan(4);
		await list.evaluate((element) => {
			element.scrollTop = 0;
			element.dispatchEvent(new Event("scroll"));
		});
		await page.evaluate(() => window.mu.harness.prompt("stream"));
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
		await profile.page.screenshot({
			path: join(__dirname, "../../../.artifacts/desktop-audit-2026-10-19/workspace-zh.png"),
		});
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
	const profile = await launchApp({ env: { MU_FIXTURE_CANCEL_NEW_SESSION: "1" } });
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
