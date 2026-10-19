// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The Phase 2 numbers, measured on the app a user actually installs.
 *
 * `scripts/startup.mjs` measures the dev build against the fixture harness, which is a regression budget: useful when
 * changing the renderer, useless for the platform decision, because it is not the artifact anyone runs. This starts the
 * **packaged** app with the **real** harness it carries, in a throwaway home directory, and writes the numbers
 * `scripts/perf-budget.mjs --judge` consumes:
 *
 *   node scripts/collect-metrics.mjs                     # 5 launches, then 60 s idle RSS
 *   node scripts/collect-metrics.mjs --runs 3 --idle-seconds 30 --out shell-metrics.json
 *   node ../../scripts/perf-budget.mjs --judge --result shell-metrics.json
 *
 * What it measures, and why each one is in this shape:
 *
 * - **cold start**: launch → the window paints text. A fresh home directory every run, so the first-run wizard is part
 *   of it; that is the worst case a new user sees, and the number the 1.5 s p95 gate is about.
 * - **ready**: launch → the header says the agent is running, which is when the composer becomes usable. Reported, not
 *   gated: it includes starting the harness, which is asynchronous by design.
 * - **idle RSS**: a launch walked to the conversation, then the whole process tree's working set after the requested
 *   idle time. On Windows this is every process of the app's executable (`mu.exe`), renderers and the harness included;
 *   elsewhere it falls back to the main process alone and says so in `idleRssSource`.
 * - **installer size**: the largest installer in the dist folder, which is what a download costs.
 *
 * Playwright's connection costs a little (it drives the app through the DevTools protocol), so `cold start` here is a
 * few hundred milliseconds worse than a user's stopwatch. For a gate that must not be crossed that is the safe
 * direction; the comparison with `startup.mjs` in `docs/performance-budget.md` records the difference.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "..");
const DIST = join(DESKTOP, "dist");

const EXECUTABLES = {
	win32: join(DIST, "win-unpacked", "spec.ai.jev.exe"),
	darwin: join(DIST, "mac", "spec.ai.jev.app", "Contents", "MacOS", "spec.ai.jev"),
	linux: join(DIST, "linux-unpacked", "spec.ai.jev"),
};

const INSTALLER_EXTENSIONS = [".exe", ".dmg", ".zip", ".AppImage", ".deb"];

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
	return sorted[index];
}

function median(values) {
	return percentile(values, 0.5);
}

/**
 * One process tree, by PID: working set and private bytes, summed over the main process and everything below it.
 *
 * By tree rather than by executable name on purpose. The first version of this script summed every process called
 * `mu.exe`, and the number it produced (847 MB) was mostly **four leftovers from an earlier session** that had never
 * exited: an app that is force-closed does not get its `before-quit` hook, so its harness survives. Measuring the tree
 * of the launch under test keeps other instances out of the number; the leftovers are a separate problem, recorded in
 * the validation log.
 */
function treeUsage(pid) {
	if (process.platform !== "win32" || pid === undefined) return undefined;
	let report;
	try {
		report = execFileSync(
			"powershell",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize),$($_.PrivatePageCount),$($_.CommandLine)\" }",
			],
			{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
		);
	} catch {
		return undefined;
	}
	const rows = [];
	for (const line of report.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		const [id, parent, working, priv, command] = trimmed.split(",");
		const numbers = [id, parent, working, priv].map(Number);
		if (numbers.some((value) => !Number.isFinite(value))) continue;
		rows.push({ id: numbers[0], parent: numbers[1], working: numbers[2], priv: numbers[3], command: command ?? "" });
	}
	const inTree = new Set([pid]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const row of rows) {
			if (inTree.has(row.id) || !inTree.has(row.parent)) continue;
			inTree.add(row.id);
			grew = true;
		}
	}
	const members = rows.filter((row) => inTree.has(row.id));
	if (members.length === 0) return undefined;
	const sum = (key) => members.reduce((total, row) => total + row[key], 0);
	const mb = (value) => Math.round((value / (1024 * 1024)) * 10) / 10;
	// Who holds what: the split is what makes the total actionable, and it is the number a runtime comparison needs.
	const breakdown = members
		.map((row) => ({
			role: roleOf(row.command),
			pid: row.id,
			privateMb: mb(row.priv),
			workingSetMb: mb(row.working),
		}))
		.sort((left, right) => right.privateMb - left.privateMb);
	return { workingSetMb: mb(sum("working")), privateMb: mb(sum("priv")), processes: members.length, breakdown };
}

/** Chromium's own processes name their role on the command line; anything else is the shell or the harness. */
export function roleOf(command) {
	const type = /--type=([a-z-]+)/.exec(command)?.[1];
	if (type !== undefined) return type;
	if (command.includes("harness") || command.includes("cli.js") || command.includes("cli-runtime")) {
		return command.includes("mu.mjs") ? "harness-launcher" : "harness";
	}
	return "main";
}

/** Empty the working set of every process in a tree: what "trimming" means for the memory gate. Windows only. */
function trimTree(pid) {
	if (process.platform !== "win32" || pid === undefined) return false;
	// Collect the tree here, then empty the working set of each member: a process that already exited is skipped.
	const members = new Set([pid]);
	try {
		const rows = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", PROCESS_PAIRS], { encoding: "utf8" });
		const pairs = rows
			.split("\n")
			.map((line) => line.trim().split(",").map(Number))
			.filter(([id, parent]) => Number.isFinite(id) && Number.isFinite(parent));
		let grew = true;
		while (grew) {
			grew = false;
			for (const [id, parent] of pairs) {
				if (members.has(id) || !members.has(parent)) continue;
				members.add(id);
				grew = true;
			}
		}
	} catch {
		return false;
	}
	const trim = [...members]
		.map((id) => `(Get-Process -Id ${id} -ErrorAction SilentlyContinue) | ForEach-Object { [void][Win32.Psapi]::EmptyWorkingSet($_.Handle) }`)
		.join("; ");
	try {
		execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `${EMPTY_WORKING_SET}; ${trim}`], { encoding: "utf8" });
		return true;
	} catch {
		return false;
	}
}

const PROCESS_PAIRS = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId)\" }";
const EMPTY_WORKING_SET =
	"Add-Type -Name Psapi -Namespace Win32 -MemberDefinition '[DllImport(\"psapi.dll\")] public static extern bool EmptyWorkingSet(IntPtr hProcess);'";

async function launchAndMeasure(executable, { idleSeconds = 0, extraArgs = [] } = {}) {
	const home = mkdtempSync(join(tmpdir(), "mu-metrics-home-"));
	const profile = mkdtempSync(join(tmpdir(), "mu-metrics-profile-"));
	const started = Date.now();
	const app = await electron.launch({
		executablePath: executable,
		args: [`--user-data-dir=${profile}`, ...extraArgs],
		env: { ...process.env, HOME: home, USERPROFILE: home },
		timeout: 120_000,
	});
	try {
		const page = await app.firstWindow({ timeout: 120_000 });
		const windowMs = Date.now() - started;
		await page.waitForFunction(() => (document.body?.textContent ?? "").trim().length > 0, undefined, { timeout: 120_000 });
		const paintedMs = Date.now() - started;

		for (const selector of FIRST_RUN) {
			const step = page.locator(selector);
			if ((await step.count()) > 0) {
				await step.first().click({ timeout: 10_000 }).catch(() => {});
				await page.waitForTimeout(750);
			}
		}

		let readyMs;
		try {
			await page.waitForFunction(
				() => /running/.test(document.querySelector(".chip")?.textContent ?? ""),
				undefined,
				{ timeout: 120_000 },
			);
			readyMs = Date.now() - started;
			if (idleSeconds <= 0) return { windowMs, paintedMs, readyMs };
			await page.waitForTimeout(idleSeconds * 1000);
			const usage = treeUsage(app.process().pid);
			if (usage === undefined) {
				// No OS query on this platform: the main process alone, which understates the app and says so.
				const memory = await app.evaluate(() => process.getProcessMemoryInfo());
				return { windowMs, paintedMs, readyMs, idleRssMb: Math.round((memory.private / 1024) * 10) / 10, idleRssSource: "main process only" };
			}
			// A page-eviction pass is measured for context only. `EmptyWorkingSet` pushes the resident pages out and an
			// idle app then reports a few megabytes, which is the trick every "memory cleaner" uses and says nothing
			// about what the product needs; the gate's "trimming" means removing product weight, which is a build.
			const evicted = trimTree(app.process().pid);
			if (evicted) await page.waitForTimeout(3_000);
			const afterEviction = evicted ? treeUsage(app.process().pid) : undefined;
			return {
				windowMs,
				paintedMs,
				readyMs,
				idleRssMb: usage.privateMb,
				idleWorkingSetMb: usage.workingSetMb,
				workingSetAfterEvictionMb: afterEviction?.workingSetMb,
				breakdown: usage.breakdown,
				idleRssSource: `process tree, ${usage.processes} processes, private bytes`,
			};
		} catch {
			return { windowMs, paintedMs, readyMs: undefined };
		}
	} finally {
		await app.close();
		rmSync(home, { recursive: true, force: true });
		rmSync(profile, { recursive: true, force: true });
	}
}

function installerMb(directory) {
	if (!existsSync(directory)) return undefined;
	const installers = readdirSync(directory).filter((name) => INSTALLER_EXTENSIONS.some((extension) => name.endsWith(extension)));
	if (installers.length === 0) return undefined;
	const largest = installers.sort((left, right) => statSync(join(directory, right)).size - statSync(join(directory, left)).size)[0];
	return { name: largest, mb: Math.round((statSync(join(directory, largest)).size / (1024 * 1024)) * 10) / 10 };
}

/** The plausible non-radical remedies for the memory number, by the flags that implement them. */
const TRIMS = {
	none: [],
	"disable-gpu": ["--disable-gpu"],
};

async function main() {
	const args = process.argv.slice(2);
	const option = (name, fallback) => {
		const index = args.indexOf(name);
		return index === -1 ? fallback : args[index + 1];
	};
	const runs = Number(option("--runs", 5));
	const idleSeconds = Number(option("--idle-seconds", 60));
	const trimName = option("--trim", "none");
	const out = option("--out", join(DESKTOP, "shell-metrics.json"));
	const executable = option("--app", EXECUTABLES[process.platform]);
	const trimArgs = TRIMS[trimName];
	if (trimArgs === undefined) {
		console.error(`collect-metrics: --trim is one of ${Object.keys(TRIMS).join(", ")}`);
		return 2;
	}
	if (executable === undefined || !existsSync(executable)) {
		console.error(`collect-metrics: no packaged app at ${executable ?? "(unknown platform)"}; run "npm run package -- --${process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux"} --x64" first`);
		return 2;
	}
	if (!Number.isInteger(runs) || runs <= 0) {
		console.error("collect-metrics: --runs needs a positive integer");
		return 2;
	}

	const samples = [];
	for (let index = 0; index < runs; index++) samples.push(await launchAndMeasure(executable));
	const painted = samples.map((sample) => sample.paintedMs);
	const ready = samples.map((sample) => sample.readyMs).filter((value) => value !== undefined);
	const idle = await launchAndMeasure(executable, { idleSeconds });
	// The trimmed run, when asked for: the same measurement with one plausible remedy applied. Without it the gate's
	// second half cannot be answered, and leaving it out must not be mistaken for "trimming does not help".
	const trimmed = trimArgs.length === 0 ? undefined : await launchAndMeasure(executable, { idleSeconds, extraArgs: trimArgs });
	const installer = installerMb(DIST);

	const measures = {
		generatedAt: new Date().toISOString(),
		app: executable,
		runs,
		coldStartP50Ms: Math.round(median(painted)),
		coldStartP95Ms: Math.round(percentile(painted, 0.95)),
		windowP50Ms: Math.round(median(samples.map((sample) => sample.windowMs))),
		readyP50Ms: ready.length === 0 ? undefined : Math.round(median(ready)),
		readyP95Ms: ready.length === 0 ? undefined : Math.round(percentile(ready, 0.95)),
		readySamples: ready.length,
		idleRssMb: idle.idleRssMb,
		idleWorkingSetMb: idle.idleWorkingSetMb,
		workingSetAfterEvictionMb: idle.workingSetAfterEvictionMb,
		// Where the idle number comes from, process by process. The total alone invites the wrong conclusion: the
		// largest single process is the harness, while Chromium's processes together are more than half of it.
		breakdown: idle.breakdown,
		idleRssSource: idle.idleRssSource,
		idleSeconds,
		trim: trimmed === undefined ? "not measured" : trimName,
		trimmedRssMb: trimmed?.idleRssMb,
		trimmedWorkingSetMb: trimmed?.idleWorkingSetMb,
		installerMb: installer?.mb,
		installer: installer?.name,
		needsNoInstallRuntime: false,
		// Stripping platforms and locales out of the installer is a separate build; without it the installer half of
		// the size gate stays open rather than being answered with the untrimmed number.
		trimmedInstallerMb: undefined,
	};
	writeFileSync(out, `${JSON.stringify(measures, null, "\t")}\n`);

	console.log(`collect-metrics: ${runs} launches of ${executable}`);
	console.log(`collect-metrics: cold start p50 ${measures.coldStartP50Ms} ms, p95 ${measures.coldStartP95Ms} ms (window ${measures.windowP50Ms} ms)`);
	console.log(`collect-metrics: agent running p50 ${measures.readyP50Ms ?? "n/a"} ms over ${measures.readySamples} runs`);
	console.log(
		`collect-metrics: idle RSS ${measures.idleRssMb ?? "n/a"} MB private, ${measures.idleWorkingSetMb ?? "n/a"} MB working set, ${measures.workingSetAfterEvictionMb ?? "n/a"} MB after a page eviction (context only), after ${idleSeconds} s`,
	);
	if (trimmed !== undefined) {
		console.log(`collect-metrics: with --trim ${trimName}: ${measures.trimmedRssMb} MB private, ${measures.trimmedWorkingSetMb} MB working set`);
	}
	if (args.includes("--breakdown") && Array.isArray(measures.breakdown)) {
		const chromium = new Set(["gpu-process", "utility", "renderer", "network.mojom.NetworkService", "browser"]);
		let shell = 0;
		for (const row of measures.breakdown) {
			console.log(`collect-metrics:   ${String(row.privateMb).padStart(6)} MB private ${String(row.workingSetMb).padStart(6)} MB ws  ${row.role} (${row.pid})`);
			if (!row.role.startsWith("harness") && chromium.has(row.role)) shell += row.privateMb;
		}
		console.log(`collect-metrics:   chromium processes together: ${Math.round(shell * 10) / 10} MB private`);
	}
	console.log(`collect-metrics: installer ${measures.installerMb ?? "n/a"} MB (${measures.installer ?? "none"})`);
	console.log(`collect-metrics: wrote ${out}`);
	console.log("collect-metrics: judge it with: node scripts/perf-budget.mjs --judge --result <that file> --render desktop-next/render-probes.json");
	return 0;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

// Guarded so the module can be imported by a test: the role parser is worth a unit test, and running the collector on
// import would start the app.
if (invokedDirectly()) process.exitCode = await main();
