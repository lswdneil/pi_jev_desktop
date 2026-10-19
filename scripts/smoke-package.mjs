// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The packaged app starts, and so does the harness inside it.
 *
 * Everything else about a release can be checked without running it: the configuration against electron-builder's
 * schema, the archive against its budget, the harness folder against its dependencies. What no static check catches is
 * the app that opens a window and then cannot start the mu it carries — the failure only appears on a machine that
 * installed it, and it did: the first package built here started, and then reported "the agent exited with code 1"
 * because the harness's own `node_modules` had been left out of the copy.
 *
 * So this launches the packaged executable, walks the first run (language, judge consent, model step) and fails if the
 * agent does not end up running. It runs on the platform it packages for (`desktop-package.yml`, Windows), because it
 * needs the artifact that was just built and a display.
 *
 *   node scripts/smoke-package.mjs [path to the packaged executable]
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "@playwright/test";

const EXECUTABLES = {
	win32: "dist/win-unpacked/spec.ai.jev.exe",
	darwin: "dist/mac/spec.ai.jev.app/Contents/MacOS/spec.ai.jev",
	linux: "dist/linux-unpacked/spec.ai.jev",
};

/** The first run, clicked through by its own words: a fresh profile always starts here. */
const FIRST_RUN = [
	{ label: "language", click: (page) => page.getByText("Settings · en").click() },
	{ label: "continue", click: (page) => page.getByRole("button", { name: /Continue/ }).click() },
	{ label: "consent", click: (page) => page.getByRole("button", { name: "Not now" }).click() },
	{ label: "model", click: (page) => page.getByRole("button", { name: "Start using mu" }).click() },
];

async function main() {
	const executablePath = process.argv[2] ?? EXECUTABLES[process.platform];
	if (executablePath === undefined) throw new Error(`no packaged executable is known for ${process.platform}: pass one`);

	const userData = mkdtempSync(join(tmpdir(), "mu-package-smoke-"));
	const app = await _electron.launch({ executablePath, args: [`--user-data-dir=${userData}`] });
	try {
		const page = await app.firstWindow();
		await page.waitForLoadState("domcontentloaded");
		for (const step of FIRST_RUN) {
			try {
				await step.click(page);
				await page.waitForTimeout(1500);
			} catch {
				// A later run skips the step it has already answered; the screen below is what decides.
				console.log(`package smoke: first-run step "${step.label}" was not shown`);
			}
		}

		const deadline = Date.now() + 45_000;
		let text = "";
		while (Date.now() < deadline) {
			text = (await page.textContent("body")) ?? "";
			if (/could not start|could not find|was not found|exited with code/i.test(text)) {
				throw new Error(`the packaged app started, but not its harness:\n${text.replace(/\s+/g, " ").slice(0, 800)}`);
			}
			if (/running ·/.test(text)) {
				console.log(`package smoke: the agent is running inside the package`);
				console.log(`package smoke: ${text.replace(/\s+/g, " ").trim().slice(0, 200)}`);
				return;
			}
			await page.waitForTimeout(1000);
		}
		throw new Error(`the packaged app never reached a running agent:\n${text.replace(/\s+/g, " ").slice(0, 800)}`);
	} finally {
		await app.close();
		rmSync(userData, { recursive: true, force: true });
	}
}

await main();
