// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The rail's way back into another project's work.
 *
 * A session file records the folder it ran in. Opening one from the rail has to move the agent there first, or the
 * conversation would come back inside the wrong project.
 */

test.describe("sessions", () => {
	test("deletes a saved session after asking, and leaves the file gone", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "mu-e2e-delete-"));
		let sessionFile = "";
		const profile = await launchApp({
			env: { MU_WORKSPACE: workspace },
			prepareHome: (home) => {
				const directory = join(home, ".spec.ai.jev", "agent", "sessions", "encoded");
				mkdirSync(directory, { recursive: true });
				sessionFile = join(directory, "delete-me.jsonl");
				const lines = [
					JSON.stringify({ type: "session", version: 3, id: "delete-me", cwd: workspace }),
					JSON.stringify({
						type: "message",
						message: { role: "user", content: [{ type: "text", text: "Delete this one" }] },
					}),
				];
				writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf8");
			},
		});
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			const row = page.locator(".session-row").filter({ hasText: "Delete this one" });
			await expect(row).toBeVisible({ timeout: 30_000 });

			// The first click only asks; the file is still there until the second.
			await row.locator('[data-testid="session-delete"]').click();
			await expect(row.locator('[data-testid="session-delete-confirm"]')).toBeVisible();
			expect(existsSync(sessionFile)).toBe(true);

			await row.locator('[data-testid="session-delete-confirm"]').click();
			await expect(page.locator(".session-row").filter({ hasText: "Delete this one" })).toHaveCount(0);
			await expect.poll(() => existsSync(sessionFile)).toBe(false);
		} finally {
			await profile.close();
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	test("a session from another project reopens that project and switches to it", async () => {
		const current = mkdtempSync(join(tmpdir(), "mu-e2e-current-"));
		const other = mkdtempSync(join(tmpdir(), "mu-e2e-other-"));
		const profile = await launchApp({
			env: { MU_WORKSPACE: current },
			prepareHome: (home) => {
				const directory = join(home, ".spec.ai.jev", "agent", "sessions", "encoded");
				mkdirSync(directory, { recursive: true });
				const lines = [
					JSON.stringify({ type: "session", version: 3, id: "yesterday", cwd: other }),
					JSON.stringify({
						type: "message",
						message: { role: "user", content: [{ type: "text", text: "Yesterday in the other project" }] },
					}),
				];
				writeFileSync(join(directory, "yesterday.jsonl"), `${lines.join("\n")}\n`, "utf8");
			},
		});
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			const otherItem = page.locator('[data-testid="session-other"]').first();
			await expect(otherItem).toContainText("Yesterday in the other project", { timeout: 30_000 });
			await expect(otherItem).toContainText(basename(other));

			await otherItem.click();

			await expect(page.locator(".workspace-name")).toHaveText(basename(other), { timeout: 60_000 });
			// It is the current project's session now, so it leaves the other-projects list.
			await expect(page.locator('[data-testid="session-other"]')).toHaveCount(0);
		} finally {
			await profile.close();
			rmSync(current, { recursive: true, force: true });
			rmSync(other, { recursive: true, force: true });
		}
	});
});
