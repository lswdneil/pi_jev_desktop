// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The three panels, each from its own source: the board and the files from the conversation's events, the judgments
 * from `mu ledger --json`. None of them shares a context with the conversation, which is the point — the old shell's
 * shared preview context reached 1,396 lines.
 */

test.describe("panels", () => {
	test("the board says what is happening and what just happened", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await expect(page.locator('[data-testid="board-current"]')).toContainText("idle");

			await page.locator('[data-testid="composer"]').fill("write");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Done: src/app.ts", {
				timeout: 30_000,
			});

			await page.locator('[data-testid="tab-board"]').click();
			await expect(page.locator('[data-testid="board-steps"]')).toContainText("write: src/app.ts");
		} finally {
			await profile.close();
		}
	});

	test("the files panel lists what the conversation touched", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="tab-files"]').click();
			await expect(page.locator('[data-testid="files-panel"]')).toContainText("No file has been written yet.");

			await page.locator('[data-testid="composer"]').fill("write");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('[data-testid="files-panel"] li[data-file="src/app.ts"]')).toBeVisible({ timeout: 30_000 });
			await expect(page.locator('[data-testid="files-panel"]')).toContainText("write");
		} finally {
			await profile.close();
		}
	});

	test("the judgments panel reads the ledger through the harness", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="tab-judgments"]').click();

			// The fixture's `ledger --json` prints two decisions; the panel shows both, with their spec and mode.
			await expect(page.locator('[data-testid="judgments-count"]')).toHaveText("2 decisions", { timeout: 30_000 });
			await expect(page.locator('[data-judgment="ledger-1"]')).toContainText("turn.continue");
			await expect(page.locator('[data-judgment="ledger-1"]')).toContainText("active");
			await expect(page.locator('[data-judgment="ledger-2"]')).toContainText("tool.admission");
			await expect(page.locator('[data-judgment="ledger-2"]')).toContainText("shadow");
		} finally {
			await profile.close();
		}
	});
});
