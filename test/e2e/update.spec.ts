// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { type Profile, completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The update check, against a feed this test serves.
 *
 * The app reads `SPEC_AI_JEV_UPDATE_FEED`, which is how a staging build or a test points at a feed; the server here is the only
 * thing that knows the feed's contents, so what the screen says is the app's own reading of it. Nothing is downloaded
 * or installed: this build reports, it does not install.
 */

interface Feed {
	readonly version: string;
	readonly sha512?: string;
	readonly status?: number;
}

async function serveFeed(feed: Feed): Promise<{ url: string; server: Server }> {
	const server = createServer((_request, response) => {
		response.writeHead(feed.status ?? 200, { "content-type": "text/yaml" });
		const sha = feed.sha512 ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
		response.end(
			[
				`version: ${feed.version}`,
				"files:",
				`  - url: spec.ai.jev-${feed.version}.exe`,
				`    sha512: ${sha}`,
				"    size: 1024",
				`path: spec.ai.jev-${feed.version}.exe`,
				`releaseDate: '2026-10-18T00:00:00.000Z'`,
				"",
			].join("\n"),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return { url: `http://127.0.0.1:${port}/latest.yml`, server };
}

async function openUpdates(profile: Profile): Promise<void> {
	await completeFirstRun(profile.page);
	await profile.page.locator('[data-testid="nav-settings"]').click();
	await profile.page.locator('[data-testid="update"]').waitFor({ state: "visible" });
}

test.describe("updates", () => {
	test("says a newer version exists, and that this build will not install it", async () => {
		const feed = await serveFeed({ version: "9.9.9" });
		const profile = await launchApp({ env: { SPEC_AI_JEV_UPDATE_FEED: feed.url } });
		try {
			await openUpdates(profile);
			await profile.page.locator('[data-testid="update-check"]').click();

			await expect(profile.page.locator('[data-testid="update-status"]')).toContainText("Version 9.9.9 is available", {
				timeout: 20_000,
			});
			// The honest half: the check does not pretend to have installed anything.
			await expect(profile.page.locator('[data-testid="update-not-installed"]')).toContainText("does not install them yet");
			await expect(profile.page.locator('[data-testid="update"]')).toContainText(feed.url);
		} finally {
			feed.server.close();
			await profile.close();
		}
	});

	test("says the build is current when the feed is not newer", async () => {
		const feed = await serveFeed({ version: "0.0.1" });
		const profile = await launchApp({ env: { SPEC_AI_JEV_UPDATE_FEED: feed.url } });
		try {
			await openUpdates(profile);
			await profile.page.locator('[data-testid="update-check"]').click();
			await expect(profile.page.locator('[data-testid="update-status"]')).toContainText("up to date", { timeout: 20_000 });
			await expect(profile.page.locator('[data-testid="update-not-installed"]')).toHaveCount(0);
		} finally {
			feed.server.close();
			await profile.close();
		}
	});

	test("refuses with a readable reason when the feed is unreachable", async () => {
		// A port nobody listens on: the check has to say so, not crash the settings screen.
		const profile = await launchApp({ env: { SPEC_AI_JEV_UPDATE_FEED: "http://127.0.0.1:9/latest.yml" } });
		try {
			await openUpdates(profile);
			await profile.page.locator('[data-testid="update-check"]').click();
			await expect(profile.page.locator('[data-testid="update-status"]')).toContainText("could not read the update feed", {
				timeout: 20_000,
			});
			await expect(profile.page.locator('[data-testid="settings"]')).toBeVisible();
		} finally {
			await profile.close();
		}
	});

	test("refuses an artifact it cannot verify", async () => {
		const feed = await serveFeed({ version: "9.9.9", sha512: "" });
		const profile = await launchApp({ env: { SPEC_AI_JEV_UPDATE_FEED: feed.url } });
		try {
			await openUpdates(profile);
			await profile.page.locator('[data-testid="update-check"]').click();
			// An empty sha512 in the feed parses as a file with no checksum, which is a refusal with a reason.
			await expect(profile.page.locator('[data-testid="update-status"]')).toContainText("No update:", { timeout: 20_000 });
			await expect(profile.page.locator('[data-testid="update-not-installed"]')).toHaveCount(0);
		} finally {
			feed.server.close();
			await profile.close();
		}
	});

	test("will not install what it cannot prove: no public key, no install", async () => {
		const feed = await serveFeed({ version: "9.9.9" });
		const profile = await launchApp({ env: { SPEC_AI_JEV_UPDATE_FEED: feed.url } });
		try {
			await openUpdates(profile);
			await profile.page.locator('[data-testid="update-check"]').click();
			await expect(profile.page.locator('[data-testid="update-status"]')).toContainText("9.9.9", { timeout: 20_000 });

			await profile.page.locator('[data-testid="update-install"]').click();
			// This build carries no release key (U10 adds it), so the only honest answer is a refusal — and the app
			// keeps running whatever it implements, which is what the next assertion proves.
			await expect(profile.page.locator('[data-testid="update-install-outcome"]')).toContainText("carries no update public key", {
				timeout: 20_000,
			});
			await expect(profile.page.locator('[data-testid="settings"]')).toBeVisible();
		} finally {
			feed.server.close();
			await profile.close();
		}
	});
});
