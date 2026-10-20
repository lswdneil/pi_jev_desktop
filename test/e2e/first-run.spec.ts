// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { launchApp } from "./helpers/app.ts";

/**
 * The first run: language, consent, model, usable.
 *
 * Every step is a normal path, including refusing consent and having no key: spec.ai.jev is meant to start and work locally
 * regardless. The consent file is written by the harness's own command — this test checks the file the kernel reads,
 * not a file this shell invented.
 */

test.describe("first run", () => {
	test("walks language, consent and model, and lands on a usable window", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await expect(page.locator('[data-testid="first-run"]')).toBeVisible();
			await expect(page.locator('[data-testid="first-run"]')).toHaveAttribute("data-step", "language");

			// The wizard offers the kernel's thirteen languages, and the shell's own words follow the choice.
			await expect(page.locator("[data-language]")).toHaveCount(13);
			await page.locator('[data-language="zh-TW"]').click();
			await expect(page.getByRole("heading", { name: "設定 spec.ai.jev" })).toBeVisible();

			await page.locator('[data-testid="first-run-next"]').click();
			await expect(page.locator('[data-testid="first-run-consent"]')).toBeVisible();

			// Declining is a normal path, not an error page.
			await page.locator('[data-testid="first-run-decline"]').click();
			await expect(page.locator('[data-testid="first-run-model"]')).toBeVisible();
			await expect(page.locator('[data-testid="first-run-key-hint"]')).toContainText("auth");
			await expect(page.locator('[data-testid="first-run-key-hint"]')).not.toContainText("spec auth");
			await expect(page.locator('[data-testid="first-run-error"]')).toHaveCount(0);

			await page.locator('[data-testid="first-run-finish"]').click();

			// Usable: the window, the agent running, the composer enabled, no error screen.
			await expect(page.locator(".brand")).toBeVisible();
			// The wizard was walked in Traditional Chinese, so the rail's own chrome is Chinese now.
			await expect(page.locator(".chip")).toContainText("執行中", { timeout: 60_000 });
			await expect(page.locator("textarea")).toBeEnabled();
			await expect(page.locator(".failure")).toHaveCount(0);
			expect(profile.consent()).toBeUndefined();
		} finally {
			await profile.close();
		}
	});

	test("granting consent writes the file the kernel reads, through the harness", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await page.locator('[data-language="en"]').click();
			await page.locator('[data-testid="first-run-next"]').click();
			await page.locator('[data-testid="first-run-grant"]').click();
			await expect(page.locator('[data-testid="first-run-model"]')).toBeVisible();

			const consent = profile.consent();
			expect(consent).toMatchObject({ judgeId: "jev", consentVersion: 1, scope: "remote-judge" });
			expect(typeof consent?.agreedAt).toBe("string");

			// The settings screen agrees with the file.
			await page.locator('[data-testid="first-run-finish"]').click();
			await page.locator('[data-testid="nav-settings"]').click();
			await expect(page.locator('[data-testid="consent-state"]')).toContainText("Consent granted");
		} finally {
			await profile.close();
		}
	});

	test("a chosen model goes to the running session", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await page.locator('[data-language="en"]').click();
			await page.locator('[data-testid="first-run-next"]').click();
			await page.locator('[data-testid="first-run-decline"]').click();

			// The fixture reports one model; picking it is what the wizard sends.
			await expect(page.locator('[data-testid="first-run-model"] input[type="radio"]')).toHaveCount(1);
			await page.locator('[data-testid="first-run-finish"]').click();
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			// The model the fixture accepted is the one the session reports.
			await expect
				.poll(
					async () =>
						page.evaluate(async () => {
							const state = await window.spec.harness.snapshot();
							return state.model ?? "";
						}),
					{ timeout: 20_000 },
				)
				.toBe("fixture/model-a");
		} finally {
			await profile.close();
		}
	});

	test("does not come back once it is done", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await page.locator('[data-language="en"]').click();
			await page.locator('[data-testid="first-run-next"]').click();
			await page.locator('[data-testid="first-run-decline"]').click();
			await page.locator('[data-testid="first-run-finish"]').click();
			await expect(page.locator(".brand")).toBeVisible();

			await page.reload();

			await expect(page.locator('[data-testid="nav-conversation"]')).toBeVisible();
			await expect(page.locator('[data-testid="first-run"]')).toHaveCount(0);
		} finally {
			await profile.close();
		}
	});
});
