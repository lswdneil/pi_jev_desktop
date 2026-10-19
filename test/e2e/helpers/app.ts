// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Launching the built app with its own home and its own browser profile.
 *
 * A settings test that read this machine's `~/.mu` or its previous window storage would be a test of this developer's
 * laptop. Every launch gets a fresh home directory (where `mu.json` and `consent.json` live) and a fresh
 * `--user-data-dir` (where the renderer keeps its language and its "onboarded" flag).
 *
 * Three harnesses are launchable: the fixture (a stub that answers the protocol and writes the kernel's consent file),
 * no harness at all (a `MU_ROOT` pointing at an empty folder), and this checkout (the real `kyrn/bin/mu.mjs`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, type Page, _electron as electron } from "@playwright/test";

/** `test/e2e/helpers` → the desktop package itself. */
export const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
export const MAIN_ENTRY = join(DESKTOP_ROOT, "out", "main", "index.js");
export const FIXTURE_HARNESS = join(__dirname, "..", "fixtures", "harness");

export type HarnessChoice = "fixture" | "none" | "checkout";

export interface Profile {
	readonly app: ElectronApplication;
	readonly page: Page;
	readonly home: string;
	/** The browser profile (`--user-data-dir`): where the renderer keeps its language and its onboarded flag. */
	readonly profileDir: string;
	/** The environment the app was started with, for a test that has to start it a second time. */
	readonly environment: Record<string, string>;
	/** `~/.mu/agent/mu.json` as the app wrote it. */
	settings(): Record<string, unknown> | undefined;
	consent(): Record<string, unknown> | undefined;
	/** The shell's log (`~/.mu/agent/logs/mu-shell.log`), as it is on disk right now. */
	shellLog(): string | undefined;
	close(): Promise<void>;
}

export async function launchApp(
	options: {
		readonly harness?: HarnessChoice;
		readonly env?: Readonly<Record<string, string>>;
		/** Writes into the temporary home before the app starts: models.json, a key file, a session. */
		readonly prepareHome?: (home: string) => void;
	} = {},
): Promise<Profile> {
	const home = mkdtempSync(join(tmpdir(), "mu-e2e-home-"));
	const profile = mkdtempSync(join(tmpdir(), "mu-e2e-profile-"));
	const harness = options.harness ?? "fixture";
	const checkoutRoot = process.env.PI_JEV_HARNESS?.trim() || undefined;
	const muRoot =
		harness === "none"
			? join(home, "no-harness-here")
			: harness === "fixture"
				? FIXTURE_HARNESS
				: checkoutRoot;
	if (harness === "checkout" && muRoot === undefined) {
		throw new Error("checkout tests require PI_JEV_HARNESS to point at a mu checkout");
	}
	if (muRoot !== undefined) mkdirSync(muRoot, { recursive: true });
	options.prepareHome?.(home);

	const environment: Record<string, string> = {
		...process.env,
		// `os.homedir()` on Windows reads USERPROFILE; on POSIX it reads HOME. Set both so the app and the harness's
		// own command line agree on where mu's files are.
		USERPROFILE: home,
		HOME: home,
		...options.env,
	};
	if (muRoot !== undefined) environment.MU_ROOT = muRoot;
	else delete environment.MU_ROOT;

	const app = await electron.launch({
		args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
		env: environment,
		timeout: 90_000,
	});
	const page = await app.firstWindow({ timeout: 90_000 });
	await page.waitForLoadState("domcontentloaded");

	const readJson = (path: string): Record<string, unknown> | undefined => {
		try {
			return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		} catch {
			return undefined;
		}
	};
	const settingsFile = join(home, ".spec.ai.jev", "agent", "mu.json");
	const consentFile = join(home, ".spec.ai.jev", "agent", "consent.json");

	return {
		app,
		page,
		home,
		profileDir: profile,
		environment,
		settings: () => readJson(settingsFile),
		consent: () => readJson(consentFile),
		shellLog: () => {
			try {
				return readFileSync(join(home, ".spec.ai.jev", "agent", "logs", "mu-shell.log"), "utf8");
			} catch {
				return undefined;
			}
		},
		async close() {
			// An app that has already exited (a fatal crash is its own test) cannot be closed again, but its temporary
			// folders are this helper's to remove either way.
			try {
				await app.close();
			} catch {
				// already gone
			} finally {
				rmSync(home, { recursive: true, force: true });
				rmSync(profile, { recursive: true, force: true });
			}
		},
	};
}

/** Walk the first-run wizard: pick the language, decline consent, finish without choosing a model. */
export async function completeFirstRun(page: Page, language = "en"): Promise<void> {
	await page.locator('[data-testid="first-run"]').waitFor({ state: "visible", timeout: 60_000 });
	await page.locator(`[data-language="${language}"]`).click();
	await page.locator('[data-testid="first-run-next"]').click();
	await page.locator('[data-testid="first-run-decline"]').click();
	await page.locator('[data-testid="first-run-finish"]').click();
	await page.locator('[data-testid="nav-conversation"]').waitFor({ state: "visible", timeout: 60_000 });
}
