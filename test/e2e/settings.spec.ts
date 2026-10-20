// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { type Profile, completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The settings screen, driven by the running harness's manifest.
 *
 * The fixture harness ships a manifest the shell has never seen: a feature it does not know, four option kinds, and a
 * decision point. If the screen renders those, then a kernel that adds an option gets it drawn here without a change in
 * this repository — which is the whole reason the screen is not written by hand.
 */

async function openSettings(profile: Profile): Promise<void> {
	await completeFirstRun(profile.page);
	await profile.page.locator('[data-testid="nav-settings"]').click();
	await profile.page.locator('[data-testid="settings"]').waitFor({ state: "visible" });
	// The feature sections start collapsed when they have many options; a person clicks them open, and so does this.
	for (const summary of await profile.page.locator("[data-feature] summary").all()) {
		await summary.click();
	}
}

test.describe("settings from the manifest", () => {
	test("draws a feature and its options that this build has never heard of", async () => {
		const profile = await launchApp();
		try {
			await openSettings(profile);

			const feature = profile.page.locator('[data-feature="fixtureFeature"]');
			await expect(feature).toBeVisible();
			await expect(feature.locator("summary")).toContainText("Fixture feature");

			// One control per kind, all of them described by the manifest rather than by this repository's code.
			await expect(profile.page.locator('[data-option="fixtureFeature.flag"] input[type="checkbox"]')).toBeVisible();
			await expect(profile.page.locator('[data-option="fixtureFeature.limit"] input[type="number"]')).toHaveValue("7");
			await expect(profile.page.locator('[data-option="fixtureFeature.limit"]')).toContainText("items");
			await expect(profile.page.locator('[data-option="fixtureFeature.mode"] select')).toHaveValue("alpha");
			await expect(profile.page.locator('[data-option="fixtureFeature.mode"] select option')).toHaveCount(2);

			// A kind from a newer kernel is shown as it stands in the file, not dropped.
			const future = profile.page.locator('[data-option="fixtureFeature.futureThing"]');
			await expect(future).toContainText("A kind from a newer kernel");
			await expect(future.locator("code")).toHaveText("mauve");

			// The decision the fixture's manifest describes appears under the decision heading.
			await expect(profile.page.locator('[data-decision="fixture.decision"]')).toContainText("Fixture decision");
		} finally {
			await profile.close();
		}
	});

	test("saves a change to agent.json and says it takes effect on restart", async () => {
		const profile = await launchApp();
		try {
			await openSettings(profile);

			await profile.page.locator('[data-option="fixtureFeature.flag"] input[type="checkbox"]').check();

			await expect(profile.page.locator('[data-testid="settings-saved"]')).toContainText("Restart the agent");
			await expect(profile.page.locator('[data-option="fixtureFeature.limit"] input[type="number"]')).toHaveValue("7");

			// The file is what the harness reads next time, and it holds what the screen showed.
			await expect
				.poll(() => JSON.stringify(profile.settings() ?? {}), { timeout: 10_000 })
				.toContain('"flag":true');
			expect(profile.settings()).toEqual({ features: { fixtureFeature: { flag: true } } });
		} finally {
			await profile.close();
		}
	});

	test("shows another language's text from the same manifest", async () => {
		const profile = await launchApp();
		try {
			await openSettings(profile);
			await expect(profile.page.locator('[data-feature="fixtureFeature"] summary')).toContainText("Fixture feature");

			await profile.page.getByTestId("settings-language").click();
			await profile.page.getByRole("option", { name: "zh-TW", exact: true }).click();

			await expect(profile.page.locator('[data-feature="fixtureFeature"] summary')).toContainText("夾具功能");
			await expect(profile.page.locator('[data-option="fixtureFeature.flag"] .option-label')).toHaveText("夾具開關");
			await expect(profile.page.locator('[data-decision="fixture.decision"]')).toContainText("夾具決策");
		} finally {
			await profile.close();
		}
	});

	test("refuses nothing it was not asked to, and reports a value the manifest excludes", async () => {
		const profile = await launchApp();
		try {
			await openSettings(profile);

			// Above the manifest's own maximum: the main process refuses, so the screen reports it and the file is
			// untouched rather than holding a value the kernel would clamp or reject.
			await profile.page.locator('[data-option="fixtureFeature.limit"] input[type="number"]').fill("99");
			await expect(profile.page.locator('[data-testid="settings-error"]')).toContainText("may not be above 10");
			expect(profile.settings()).toBeUndefined();
		} finally {
			await profile.close();
		}
	});
});
