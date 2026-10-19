// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
