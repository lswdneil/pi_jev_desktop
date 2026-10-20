#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors


/**
 * The size budget for the desktop shell.
 *
 * An app people download is a product constraint, not a curiosity: `out/renderer` is what loads before the first
 * pixel, and the installer people wait for. This measures what the build produced and refuses a jump over the budget,
 * the same way the performance budget does for timings — a size that grows by a few percent per change is how an app
 * reaches 300 MB without anyone deciding to.
 *
 *   node scripts/desktop-budget.mjs --check           # what CI runs, after `npm run build`
 *   node scripts/desktop-budget.mjs --update          # accept the current sizes as the new budget
 *
 * The tolerances are small on purpose (2% for one file, 5% for the whole output) and there is no noise floor: bytes do
 * not jitter between runs the way timings do.
 *
 * The build has to be newer than the code: when `out/` predates `src/`, the numbers describe a program nobody has, and
 * this refuses instead of printing a confident figure — both for `--check` and for `--update`, which would otherwise
 * record those old sizes as the budget.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const BUDGET_FILE = "bundle-budget.json";

/** What is measured, and how much it may grow before the check fails. */
export const METRICS = [
	{ id: "rendererJs", description: "the renderer bundle the window loads first", tolerance: 0.02 },
	{ id: "rendererCss", description: "the renderer stylesheet", tolerance: 0.05 },
	{ id: "mainJs", description: "the main process bundle", tolerance: 0.05 },
	{ id: "total", description: "everything the build emits", tolerance: 0.05 },
];

function filesUnder(directory) {
	const files = [];
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

/** The sizes of one build, in bytes. A missing build is an error, not a zero. */
export function measure(output) {
	if (!existsSync(join(output, "main")) || !existsSync(join(output, "renderer"))) {
		throw new Error(`${output} is not a build: run \`npm run build\` first`);
	}
	const files = filesUnder(output).map((path) => ({ path: relative(output, path).replaceAll("\\", "/"), bytes: statSync(path).size }));
	const sizeOf = (predicate) => files.filter((file) => predicate(file.path)).reduce((total, file) => total + file.bytes, 0);
	const measured = {
		rendererJs: sizeOf((path) => path.startsWith("renderer/") && path.endsWith(".js")),
		rendererCss: sizeOf((path) => path.startsWith("renderer/") && path.endsWith(".css")),
		mainJs: sizeOf((path) => path.startsWith("main/") && path.endsWith(".js")),
		total: files.reduce((total, file) => total + file.bytes, 0),
	};
	void METRICS;
	return { measured, files };
}

/** The newest file under `directory`, or undefined when there is none. */
function newestFile(directory) {
	let newest;
	for (const path of filesUnder(directory)) {
		const modified = statSync(path).mtimeMs;
		if (newest === undefined || modified > newest.modified) newest = { modified, path };
	}
	return newest;
}

/**
 * Problems with the build itself, before its sizes are compared to anything: a build older than the code it claims to
 * measure is a number from the past. Running `npm run budget` without a build in front is how that happens, and it
 * turns this gate into a green light for an old figure — the same vacuous pass the coverage gate refuses for a stale
 * summary. `--update` refuses a stale build too, because accepting its sizes would record code nobody has.
 */
export function staleBuildProblems(output, sources) {
	const built = newestFile(output);
	const source = newestFile(sources);
	if (built === undefined || source === undefined || source.modified <= built.modified) return [];
	return [`${output} is older than ${source.path}: it measured code that has since changed — run \`npm run build\` first`];
}

/** What is over budget. Empty means the build fits. */
export function budgetProblems(measured, budget) {
	const problems = [];
	for (const metric of METRICS) {
		const allowed = budget.metrics[metric.id];
		const actual = measured[metric.id];
		if (typeof allowed !== "number") {
			problems.push(`${metric.id} has no budget: run with --update and commit ${BUDGET_FILE}`);
			continue;
		}
		// A part of the build that emitted nothing is not "small": the file is gone, and comparing 0 to its budget is
		// the same vacuous pass as a stale coverage report. A budget of 0 is a deliberate "there is none of this".
		if (typeof actual !== "number" || (actual === 0 && allowed > 0)) {
			problems.push(
				`${metric.id} measured nothing, while its budget is ${(allowed / 1024).toFixed(1)} KiB: the build no longer emits it, so this check would pass on nothing`,
			);
			continue;
		}
		const ceiling = Math.round(allowed * (1 + metric.tolerance));
		if (actual > ceiling) {
			problems.push(
				`${metric.id} is ${(actual / 1024).toFixed(1)} KiB, over the ${(ceiling / 1024).toFixed(1)} KiB budget (${metric.description})`,
			);
		}
	}
	return problems;
}

export function readBudget(directory) {
	const path = join(directory, BUDGET_FILE);
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8"));
}

export function writeBudget(directory, measured, now = new Date()) {
	const metrics = {};
	for (const metric of METRICS) metrics[metric.id] = measured[metric.id] ?? 0;
	const budget = {
		generatedAt: now.toISOString().slice(0, 10),
		note: "Byte budgets for the desktop build. A change may exceed the tolerance only by raising this file on purpose.",
		metrics,
	};
	writeFileSync(join(directory, BUDGET_FILE), `${JSON.stringify(budget, null, "\t")}\n`);
	return budget;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const directory = process.cwd();
	const args = process.argv.slice(2);
	let report;
	try {
		report = measure(join(directory, "out"));
	} catch (error) {
		console.error(`desktop-budget: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 2;
		report = undefined;
	}
	if (report !== undefined) {
		const { measured } = report;
		const stale = staleBuildProblems(join(directory, "out"), join(directory, "src"));
		if (stale.length > 0) {
			for (const problem of stale) console.error(`desktop-budget: ${problem}`);
			process.exitCode = 1;
		} else if (args.includes("--update")) {
			const budget = writeBudget(directory, measured);
			for (const metric of METRICS) console.log(`desktop-budget: ${metric.id} ${(budget.metrics[metric.id] / 1024).toFixed(1)} KiB`);
		} else {
			const budget = readBudget(directory);
			if (budget === undefined) {
				console.error(`desktop-budget: ${BUDGET_FILE} is missing; run with --update and commit it`);
				process.exitCode = 2;
			} else {
				const problems = budgetProblems(measured, budget);
				for (const metric of METRICS) {
					const allowed = Math.round((budget.metrics[metric.id] ?? 0) * (1 + metric.tolerance));
					console.log(
						`desktop-budget: ${metric.id} ${(measured[metric.id] / 1024).toFixed(1)} KiB (budget ${(allowed / 1024).toFixed(1)} KiB)`,
					);
				}
				if (problems.length === 0) console.log("desktop-budget: within budget");
				else {
					for (const problem of problems) console.error(`desktop-budget: ${problem}`);
					process.exitCode = 1;
				}
			}
		}
	}
}
