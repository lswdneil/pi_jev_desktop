// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The three panels, each from its own source: the board and the files from the conversation's events, the judgments
 * from `spec ledger --json`. None of them shares a context with the conversation, which is the point — the old shell's
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

			// What the tool said back is on the row, one click away rather than in the agent's own words.
			await page.locator('[data-testid="tool-output"] summary').click();
			await expect(page.locator('[data-testid="tool-output"]')).toContainText("wrote 12 bytes to src/app.ts");
		} finally {
			await profile.close();
		}
	});

	test("the files panel edits a file, and refuses to overwrite one that changed", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "spec-e2e-workspace-"));
		mkdirSync(join(workspace, "src"), { recursive: true });
		const file = join(workspace, "src", "app.ts");
		writeFileSync(file, "export const value = 1;\n");
		const profile = await launchApp({ env: { SPEC_AI_JEV_WORKSPACE: workspace } });
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="composer"]').fill("write");
			await page.locator('[data-testid="send"]').click();
			await page.locator('[data-testid="tab-files"]').click();
			await page.locator('[data-file="src/app.ts"] button').click();
			await expect(page.locator('[data-testid="file-preview"]')).toContainText("export const value = 1;");

			await page.locator('[data-testid="file-edit"]').click();
			await page.locator('[data-testid="file-editor"]').fill("export const value = 2;\n");
			await expect(page.locator('[data-testid="file-diff"]')).toContainText("+1");
			await page.locator('[data-testid="file-save"]').click();
			await expect(page.locator('[data-testid="file-preview"]')).toContainText("Saved");
			expect(readFileSync(file, "utf8")).toBe("export const value = 2;\n");

			// The agent writes while the editor is open: saving is a conflict to look at, not an overwrite.
			await page.locator('[data-testid="file-edit"]').click();
			await page.locator('[data-testid="file-editor"]').fill("export const value = 3;\n");
			writeFileSync(file, "export const value = 9;\n");
			await page.locator('[data-testid="file-save"]').click();
			await expect(page.locator('[data-testid="file-reload"]')).toBeVisible();
			expect(readFileSync(file, "utf8")).toBe("export const value = 9;\n");
		} finally {
			await profile.close();
			rmSync(workspace, { recursive: true, force: true });
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

			// A row opens what the record actually carries: the id, the mode, the provider and its request.
			await page.locator('[data-judgment="ledger-1"] button').click();
			const detail = page.locator('[data-testid="judgment-detail"]');
			await expect(detail).toContainText("turn.continue");
			await expect(detail).toContainText("active");
			await expect(detail).toContainText("ledger-1");
			await expect(page.locator('[data-testid="judgment-copy"]')).toBeVisible();
		} finally {
			await profile.close();
		}
	});
});
