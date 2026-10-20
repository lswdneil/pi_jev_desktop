// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * How long the app takes to become usable, measured by starting it.
 *
 * Two numbers, both from a real launch of the built app: spawn → window, and spawn → the agent reporting it is running
 * (the point where the composer is enabled). They are the first impression of the product, and the only performance
 * number a user experiences before doing anything.
 *
 *   node scripts/startup.mjs                 # measure, print, and compare against startup-budget.json
 *   node scripts/startup.mjs --update        # accept the current p50 as the budget
 *   node scripts/startup.mjs --runs 5        # more samples (3 by default)
 *
 * The app is started the same way the end-to-end tests start it, against the fixture harness, so it needs the build
 * (`npm run build`) and Electron's binary (`npm rebuild electron`) and nothing else — no keys, no network.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";
import { STARTUP_METRICS, formatStartup, startupProblems } from "../../scripts/startup-compare.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "..");
const BUDGET = join(DESKTOP, "startup-budget.json");
const MAIN = join(DESKTOP, "out", "main", "index.js");
const FIXTURE_HARNESS = join(DESKTOP, "test", "e2e", "fixtures", "harness");

async function launchAndMeasure() {
	const home = mkdtempSync(join(tmpdir(), "mu-startup-"));
	const profile = mkdtempSync(join(tmpdir(), "mu-startup-profile-"));
	const started = Date.now();
	const app = await electron.launch({
		args: [MAIN, `--user-data-dir=${profile}`],
		env: {
			...process.env,
			MU_ROOT: FIXTURE_HARNESS,
			USERPROFILE: home,
			HOME: home,
		},
		timeout: 120_000,
	});
	try {
		const page = await app.firstWindow({ timeout: 120_000 });
		const windowMs = Date.now() - started;
		await page.waitForLoadState("domcontentloaded");

		// A fresh profile shows the first-run wizard. A person clicks through it, so the measurement does too: the
		// number is "time until this app is usable", first launch included.
		if ((await page.locator('[data-testid="first-run"]').count()) > 0) {
			await page.locator('[data-language="en"]').click();
			await page.locator('[data-testid="first-run-next"]').click();
			await page.locator('[data-testid="first-run-decline"]').click();
			await page.locator('[data-testid="first-run-finish"]').click();
		}

		// The composer is enabled only once the agent is running, so this is "usable", not "painted".
		await page.waitForFunction(
			() => {
				const chip = document.querySelector(".chip");
				return chip !== null && /running/.test(chip.textContent ?? "");
			},
			undefined,
			{ timeout: 120_000 },
		);
		const readyMs = Date.now() - started;
		return { windowMs, readyMs };
	} finally {
		await app.close();
		rmSync(home, { recursive: true, force: true });
		rmSync(profile, { recursive: true, force: true });
	}
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

async function main() {
	const args = process.argv.slice(2);
	const runsIndex = args.indexOf("--runs");
	const runs = runsIndex === -1 ? 3 : Number(args[runsIndex + 1]);
	if (!Number.isInteger(runs) || runs <= 0) {
		console.error("startup: --runs needs a positive integer");
		return 2;
	}

	const samples = [];
	for (let index = 0; index < runs; index++) {
		samples.push(await launchAndMeasure());
	}
	const measured = {
		windowMs: median(samples.map((sample) => sample.windowMs)),
		readyMs: median(samples.map((sample) => sample.readyMs)),
	};

	if (args.includes("--update")) {
		const budget = {
			generatedAt: new Date().toISOString().slice(0, 10),
			note: "p50 of three launches of the built app against the fixture harness. Painted by hand, on purpose: startup is a product number, not a test flake to be retried away.",
			metrics: { windowMs: measured.windowMs, readyMs: measured.readyMs },
		};
		writeFileSync(BUDGET, `${JSON.stringify(budget, null, "\t")}\n`);
		console.log(`startup: budget updated from ${runs} runs (${JSON.stringify(measured)})`);
		return 0;
	}

	let budget;
	try {
		budget = JSON.parse(readFileSync(BUDGET, "utf8"));
	} catch {
		console.error(`startup: ${BUDGET} is missing or unreadable; run with --update and commit it`);
		return 2;
	}
	for (const line of formatStartup(measured, budget)) console.log(`startup: ${line}`);
	const problems = startupProblems(measured, budget);
	if (problems.length === 0) {
		console.log("startup: within budget");
		return 0;
	}
	for (const problem of problems) console.error(`startup: ${problem}`);
	return 1;
}

process.exitCode = await main();
void STARTUP_METRICS;
