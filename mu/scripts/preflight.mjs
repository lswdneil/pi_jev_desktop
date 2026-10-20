#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors


/**
 * Everything a release needs that does not need a credential, run in order, with one summary.
 *
 * Releasing has grown a dozen gates — the repository check, the script tests, the desktop unit tests, its build, its size
 * budget, its startup budget, its end-to-end suite, and the task benchmark's self-check. Run one at a time by hand, one
 * of them is always forgotten; run by this, the forgettable becomes the default.
 *
 *   node scripts/preflight.mjs --fast     # minutes: checks and unit tests, no Electron
 *   node scripts/preflight.mjs --full     # the above plus the built app: size, startup, end-to-end
 *   node scripts/preflight.mjs --list     # what it would run, in order
 *
 * What it does *not* run is as deliberate as what it does: signing, the release verification against a real tag, and the
 * model-backed task benchmark need credentials or a published artifact, and those are in `docs/releasing.md` instead.
 *
 * One caveat about the kernel step: that suite has tests needing a real Chrome (`browser.test.ts`), permissions a
 * confined sandbox withholds (`lsp-client`), and Windows-specific git behaviour (`swarm-patches`, `swarm-worktree`). On a
 * machine without them `--fast` stops at the kernel step for reasons unrelated to the change under review — CI is the
 * authority for that suite.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** One step: a name, the command, and where it runs. `needs` says what it is proving, for the summary. */
export function preflightPlan(mode) {
	const fast = [
		{ name: "check", run: ["npm", ["run", "check"]], cwd: ROOT, proves: "lint, types, dependencies, licences, compatibility" },
		{ name: "script tests", run: ["npm", ["run", "test:scripts"]], cwd: ROOT, proves: "the gates themselves" },
		{ name: "kernel tests", run: ["npm", ["test", "-w", "@kyrn/judge"]], cwd: ROOT, proves: "the judgment layer" },
		{ name: "model layer tests", run: ["npm", ["test", "-w", "@earendil-works/pi-ai"]], cwd: ROOT, proves: "the model layer" },
		{ name: "task benchmark", run: ["npm", ["run", "eval:tasks:self-check"]], cwd: ROOT, proves: "every task's judge is red then green" },
	];
	const desktop = [
		{ name: "desktop unit tests", run: ["npm", ["run", "test"]], cwd: join(ROOT, "desktop-next"), proves: "the shell's logic" },
		// The shell's build strips types instead of checking them (electron-vite/esbuild), and the root `npm run check`
		// does not cover `desktop-next` (it is not a workspace member), so this step is the only local type check.
		{ name: "desktop typecheck", run: ["npm", ["run", "typecheck"]], cwd: join(ROOT, "desktop-next"), proves: "the shell's types, which its build only strips" },
		{ name: "desktop build", run: ["npm", ["run", "build"]], cwd: join(ROOT, "desktop-next"), proves: "the shell builds" },
		{ name: "desktop size budget", run: ["npm", ["run", "budget"]], cwd: join(ROOT, "desktop-next"), proves: "the download stays small" },
		{ name: "desktop startup budget", run: ["npm", ["run", "startup"]], cwd: join(ROOT, "desktop-next"), proves: "the app becomes usable in time" },
		{ name: "desktop e2e", run: ["npm", ["run", "test:e2e"]], cwd: join(ROOT, "desktop-next"), proves: "the shell works as an app" },
	];
	return mode === "full" ? [...fast, ...desktop] : fast;
}

function summary(entries) {
	return [
		"",
		"preflight summary",
		...entries.map((entry) => `  ${entry.ok ? "pass" : "FAIL"}  ${entry.name}  (${entry.ms} ms)  — ${entry.proves}`),
	].join("\n");
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const args = process.argv.slice(2);
	const mode = args.includes("--full") ? "full" : "fast";
	const steps = preflightPlan(mode);
	if (args.includes("--list")) {
		for (const step of steps) console.log(`${step.name}\t${step.run[0]} ${step.run[1].join(" ")}\t(${step.proves})`);
		process.exitCode = 0;
	} else {
		const entries = [];
		let failed = false;
		for (const step of steps) {
			const started = Date.now();
			process.stdout.write(`\n== ${step.name} — ${step.proves}\n`);
			const result = spawnSync(step.run[0], step.run[1], { cwd: step.cwd, stdio: "inherit", shell: process.platform === "win32" });
			const ok = result.status === 0;
			entries.push({ name: step.name, proves: step.proves, ok, ms: Date.now() - started });
			if (!ok) {
				failed = true;
				console.error(`\npreflight: ${step.name} failed (exit ${result.status}); stopping here`);
				break;
			}
		}
		console.log(summary(entries));
		process.exitCode = failed ? 1 : 0;
	}
}
