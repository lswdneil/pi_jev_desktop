// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The renderer half of the performance budget, measured in the app's own renderer.
 *
 * `scripts/collect-metrics.mjs` measures the packaged app: cold start, idle memory, installer size. It cannot measure a
 * conversation, because a packaged app has no session and no model, and the shell's own renderer is what a shell switch
 * would have to match. So this starts the built app against the fixture harness with a 5,000-message session, which is
 * the size the budget line names, and measures what the window does with it:
 *
 * - **scroll**: main-thread work per scripted scroll step, and the frame deltas around it. The gate is the work, not the
 *   frame delta: a frame delta cannot go below one vsync (~16.7 ms at 60 Hz), so gating on it would measure the display
 *   rather than the code.
 * - **conversation mount**: click into the conversation and time it until the window's bounded set of rows is on screen.
 *   This is the text-rendering cost a rewrite has to match: history request, 200 markdown rows, layout.
 * - **font fallback**: painting Latin, Chinese, Japanese, Korean and emoji on a canvas. A missing glyph is silently
 *   substituted by the platform, and the substituted font is what makes a text-heavy window feel slow.
 * - **IPC round trip**: `app.version` over the preload bridge, twenty times. It is the floor a different process model
 *   (CBOR over a foreign IPC) has to beat, measured on the same machine as everything else here.
 * - **input method**: a synthesized composition through the DevTools protocol, then a commit. Not a real IME — there is
 *   none to drive headlessly — but the composition path is the part a controlled textarea breaks, and it breaks
 *   visibly: the committed text is checked.
 *
 *   node scripts/render-probes.mjs                  # 200 rows, 5 mount samples, writes render-probes.json
 *   node scripts/render-probes.mjs --json           # print the same numbers
 *   cd ../.. && node scripts/perf-budget.mjs --judge --result desktop-next/shell-metrics.json \
 *       --render desktop-next/render-probes.json
 *
 * Run it on an otherwise quiet machine: the scroll numbers are sub-millisecond when nothing else is running, and a
 * 900 ms startup measurement next door is enough to make them look terrible.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "..");
const MAIN = join(DESKTOP, "out", "main", "index.js");
const FIXTURE_HARNESS = join(DESKTOP, "test", "e2e", "fixtures", "harness");
const DEFAULT_OUT = join(DESKTOP, "render-probes.json");

/** The session size in the budget line, and the number of rows the window keeps mounted for it. */
export const FIXTURE_HISTORY = 5000;
export const MOUNTED_ROWS = 200;

/** The first run, clicked through by its own attributes: a fresh home always starts here. */
const FIRST_RUN = [
	'[data-language="en"]',
	'[data-testid="first-run-next"]',
	'[data-testid="first-run-decline"]',
	'[data-testid="first-run-finish"]',
];

function percentile(values, fraction) {
	const sorted = [...values].sort((left, right) => left - right);
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
	return Math.round(sorted[index] * 100) / 100;
}

/** Scroll cost inside the page: main-thread work per step, and the frame deltas around it for context. */
async function scrollProbe(page, steps) {
	return page.evaluate(async (count) => {
		const list = document.querySelector('[data-testid="messages"]');
		if (list === null) throw new Error("no messages list to scroll");
		const work = [];
		const frames = [];
		list.scrollTop = list.scrollHeight;
		for (let index = 0; index < count; index++) {
			const startedAt = performance.now();
			list.scrollTop -= 480;
			// Reading the height is what a scroll handler does, and it flushes layout: this is work, not waiting.
			void list.scrollHeight;
			work.push(performance.now() - startedAt);
			await new Promise((resolve) => requestAnimationFrame(() => resolve()));
			frames.push(performance.now() - startedAt);
		}
		return { work, frames };
	}, steps);
}

/** Painting text in four scripts on a canvas: the fallback fonts are the cost, so they are in one sample. */
async function fontProbe(page, samples) {
	return page.evaluate((count) => {
		const canvas = document.createElement("canvas");
		canvas.width = 900;
		canvas.height = 200;
		const context = canvas.getContext("2d");
		if (context === null) throw new Error("no 2d context");
		context.font = '16px "Segoe UI", system-ui, sans-serif';
		const lines = [
			"The quick brown fox jumps over the lazy dog 0123456789",
			"中文在这里回退到另一种字体，因为默认字体没有这些字形。",
			"日本語のテキストもフォールバックする。한국어도 마찬가지다.",
			"Emoji fallback: ✅ 🚀 🔍 🧪",
		];
		const timings = [];
		for (let index = 0; index < count; index++) {
			const startedAt = performance.now();
			let y = 24;
			for (const line of lines) {
				context.fillText(line, 10, y);
				y += 40;
			}
			// Reading a pixel is what makes the paint happen rather than being queued behind the next sample.
			void context.getImageData(0, 0, 1, 1).data;
			timings.push(performance.now() - startedAt);
		}
		// A zero-width measurement would mean the line could not be shaped at all, which is not fallback but failure.
		const unshaped = lines.filter((line) => context.measureText(line).width === 0).length;
		// The first sample is the one that pays for resolving four fallback fonts; the rest reuse them.
		return { first: timings[0] ?? 0, timings, unshaped, fonts: document.fonts.size };
	}, samples);
}

/** The preload bridge, one cheap call per sample: the floor a different IPC has to beat. */
async function ipcProbe(page, samples) {
	return page.evaluate(async (count) => {
		const timings = [];
		for (let index = 0; index < count; index++) {
			const startedAt = performance.now();
			await window.mu.app.version();
			timings.push(performance.now() - startedAt);
		}
		return timings;
	}, samples);
}

/**
 * A synthesized composition, then a commit. The DevTools protocol is the only way to drive the composition path without
 * a keyboard, and the assertion is the one that matters: after committing "中", the textarea holds it.
 */
async function imeProbe(page, samples) {
	const composer = page.locator('[data-testid="composer"]');
	const session = await page.context().newCDPSession(page);
	const timings = [];
	let compositionVisible = true;
	let committedOk = true;
	try {
		for (let index = 0; index < samples; index++) {
			await composer.click();
			const startedAt = Date.now();
			await session.send("Input.imeSetComposition", { text: "zhong", selectionStart: 5, selectionEnd: 5 });
			await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
			const composing = await composer.inputValue();
			await session.send("Input.insertText", { text: "中" });
			await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
			const committed = await composer.inputValue();
			timings.push(Date.now() - startedAt);
			if (!composing.includes("zhong")) compositionVisible = false;
			if (committed !== "中") committedOk = false;
			await composer.fill("");
		}
	} finally {
		await session.detach();
	}
	return { timings, compositionVisible, committedOk };
}

async function launch() {
	const home = mkdtempSync(join(tmpdir(), "mu-render-home-"));
	const profile = mkdtempSync(join(tmpdir(), "mu-render-profile-"));
	const app = await electron.launch({
		args: [MAIN, `--user-data-dir=${profile}`],
		env: {
			...process.env,
			MU_ROOT: FIXTURE_HARNESS,
			MU_FIXTURE_HISTORY: String(FIXTURE_HISTORY),
			USERPROFILE: home,
			HOME: home,
		},
		timeout: 120_000,
	});
	return {
		app,
		close: async () => {
			await app.close();
			rmSync(home, { recursive: true, force: true });
			rmSync(profile, { recursive: true, force: true });
		},
	};
}

async function run(options) {
	const launched = await launch();
	try {
		const page = await launched.app.firstWindow({ timeout: 120_000 });
		await page.waitForLoadState("domcontentloaded");
		for (const selector of FIRST_RUN) {
			const step = page.locator(selector);
			if ((await step.count()) > 0) {
				await step.first().click({ timeout: 10_000 }).catch(() => {});
				await page.waitForTimeout(300);
			}
		}
		await page.waitForFunction(() => /running/.test(document.querySelector(".chip")?.textContent ?? ""), undefined, {
			timeout: 120_000,
		});
		await page.locator('[data-testid="nav-conversation"]').click();
		await page.waitForFunction(
			(rows) => document.querySelectorAll('[data-testid="messages"] .message').length >= rows,
			MOUNTED_ROWS,
			{ timeout: 120_000 },
		);

		const scroll = await scrollProbe(page, options.steps);
		const fonts = await fontProbe(page, options.fontSamples);
		const ipc = await ipcProbe(page, options.ipcSamples);
		let ime;
		try {
			ime = await imeProbe(page, options.imeSamples);
		} catch (error) {
			ime = { error: error instanceof Error ? error.message : String(error) };
		}

		// Mounted rows are re-rendered from scratch when the screen is re-entered, which is the renderer's own text cost.
		const mounts = [];
		for (let index = 0; index < options.runs; index++) {
			await page.locator('[data-testid="nav-settings"]').click();
			await page.locator('[data-testid="settings"]').waitFor({ state: "visible", timeout: 60_000 });
			const startedAt = Date.now();
			await page.locator('[data-testid="nav-conversation"]').click();
			await page.waitForFunction(
				(rows) => document.querySelectorAll('[data-testid="messages"] .message').length >= rows,
				MOUNTED_ROWS,
				{ timeout: 120_000 },
			);
			mounts.push(Date.now() - startedAt);
		}

		return {
			generatedAt: new Date().toISOString(),
			app: MAIN,
			fixtureHistory: FIXTURE_HISTORY,
			mountedRows: MOUNTED_ROWS,
			runs: options.runs,
			// The gate: main-thread work per scripted scroll step.
			scrollP50Ms: percentile(scroll.work, 0.5),
			scrollP95Ms: percentile(scroll.work, 0.95),
			scrollFrameP50Ms: percentile(scroll.frames, 0.5),
			scrollFrameP95Ms: percentile(scroll.frames, 0.95),
			conversationMountP50Ms: percentile(mounts, 0.5),
			conversationMountP95Ms: percentile(mounts, 0.95),
			fontFallbackFirstMs: Math.round(fonts.first * 100) / 100,
			fontFallbackP50Ms: percentile(fonts.timings, 0.5),
			fontFallbackP95Ms: percentile(fonts.timings, 0.95),
			fontUnshapedLines: fonts.unshaped,
			fontFaces: fonts.fonts,
			ipcP50Ms: percentile(ipc, 0.5),
			ipcP95Ms: percentile(ipc, 0.95),
			imeCommitP50Ms: ime.error === undefined ? percentile(ime.timings, 0.5) : undefined,
			imeCompositionVisible: ime.compositionVisible,
			imeCommittedOk: ime.committedOk,
			imeError: ime.error,
			samples: {
				scroll: scroll.work.length,
				mount: mounts.length,
				font: fonts.timings.length,
				ipc: ipc.length,
				ime: ime.error === undefined ? ime.timings.length : 0,
			},
		};
	} finally {
		await launched.close();
	}
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

async function main() {
	const args = process.argv.slice(2);
	const option = (name, fallback) => {
		const index = args.indexOf(name);
		return index === -1 ? fallback : args[index + 1];
	};
	const options = {
		runs: Number(option("--runs", 5)),
		steps: Number(option("--steps", 40)),
		fontSamples: Number(option("--font-samples", 60)),
		ipcSamples: Number(option("--ipc-samples", 40)),
		imeSamples: Number(option("--ime-samples", 3)),
	};
	for (const [name, value] of Object.entries(options)) {
		if (!Number.isInteger(value) || value <= 0) {
			console.error(`render-probes: --${name} needs a positive integer`);
			return 2;
		}
	}
	const out = option("--out", DEFAULT_OUT);

	const measures = await run(options);
	writeFileSync(out, `${JSON.stringify(measures, null, "\t")}\n`);

	if (args.includes("--json")) console.log(JSON.stringify(measures, null, "\t"));
	else {
		console.log(`render-probes: ${MOUNTED_ROWS} rows of a ${FIXTURE_HISTORY}-message session, ${measures.runs} mounts`);
		console.log(
			`render-probes: scroll ${measures.scrollP50Ms} ms p50 / ${measures.scrollP95Ms} ms p95 of main-thread work (frame delta ${measures.scrollFrameP50Ms} / ${measures.scrollFrameP95Ms} ms, vsync-bound)`,
		);
		console.log(
			`render-probes: conversation mount ${measures.conversationMountP50Ms} ms p50 / ${measures.conversationMountP95Ms} ms p95`,
		);
		console.log(
			`render-probes: font fallback ${measures.fontFallbackFirstMs} ms on the first paint, ${measures.fontFallbackP50Ms} ms p50 / ${measures.fontFallbackP95Ms} ms p95 after that, over ${measures.samples.font} samples, ${measures.fontUnshapedLines} unshaped lines, ${measures.fontFaces} faces loaded`,
		);
		console.log(`render-probes: ipc round trip ${measures.ipcP50Ms} ms p50 / ${measures.ipcP95Ms} ms p95`);
		console.log(
			measures.imeError === undefined
				? `render-probes: input method ${measures.imeCommitP50Ms} ms p50, composition visible ${measures.imeCompositionVisible}, commit correct ${measures.imeCommittedOk}`
				: `render-probes: input method not measured: ${measures.imeError}`,
		);
		console.log(`render-probes: wrote ${out}`);
		console.log("render-probes: judge it with: node scripts/perf-budget.mjs --judge --result desktop-next/shell-metrics.json --render " + out);
	}
	// A composition that does not survive the commit is a broken composer, not a slow one: that fails the run.
	if (measures.imeCommittedOk === false) {
		console.error("render-probes: the composer did not keep the committed composition text");
		return 1;
	}
	return 0;
}

if (invokedDirectly()) process.exitCode = await main();
