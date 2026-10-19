// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The approval: a card the run waits on, and an answer that really reaches the harness.
 *
 * The fixture only continues after it has received an `extension_ui_response`, and it writes what it received into its
 * next message. So "decision: declined" on screen is proof the answer travelled — not proof that a button was clicked.
 */

test.describe("approvals", () => {
	test("asks before a dangerous command, and passing on it stops the command", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="composer"]').fill("danger");
			await page.locator('[data-testid="send"]').click();

			const card = page.locator('[data-testid="approval"]');
			await expect(card).toBeVisible({ timeout: 30_000 });
			await expect(card).toContainText("Run rm -rf build?");
			await expect(card).toContainText("This deletes the build folder.");

			await page.locator('[data-testid="approval-deny"]').click();

			// The harness received a refusal, so it reports the denial and marks the tool it would have run as failed.
			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("decision: declined", {
				timeout: 30_000,
			});
			await expect(page.locator('[data-testid="approval"]')).toHaveCount(0);
			await expect(page.locator('.message[data-role="tool"].tool-error')).toHaveCount(1);
			await expect(page.locator(".chip")).toContainText("running");
		} finally {
			await profile.close();
		}
	});

	test("allowing runs it, and the tool row says so", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="composer"]').fill("danger");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('[data-testid="approval"]')).toBeVisible({ timeout: 30_000 });

			await page.locator('[data-testid="approval-allow"]').click();

			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("decision: allowed", {
				timeout: 30_000,
			});
			await expect(page.locator('.message[data-role="tool"].tool-ok')).toHaveCount(1);
			await expect(page.locator('[data-testid="approval"]')).toHaveCount(0);
		} finally {
			await profile.close();
		}
	});

	test("the question is visible on the board while the run waits", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="composer"]').fill("danger");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('[data-testid="approval"]')).toBeVisible({ timeout: 30_000 });

			await expect(page.locator('[data-testid="board-current"]')).toContainText("waiting: Run rm -rf build?");
			await page.locator('[data-testid="tab-board"]').click();
			await expect(page.locator('[data-testid="board-current"]')).toBeVisible();
		} finally {
			await profile.close();
		}
	});
});
