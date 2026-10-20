#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors


/**
 * The coverage gate.
 *
 * Coverage that is only reported is decoration: a number nobody acts on. This compares what the tests actually cover
 * against a baseline committed in the repository, and refuses to let it fall. The baseline only ever moves up
 * (`--update` keeps the higher of the two), which is what stops the ratchet from being loosened in a hurry.
 *
 * Two questions, because they catch different regressions:
 *
 * - **Did the package lose coverage?** Compared against the baseline, with the files that lost it named.
 * - **Is the code this change adds covered?** For a pull request (`--changed`), each touched source file must be at or
 *   above a floor, and a touched file that has no coverage entry at all fails: it was never run.
 *
 * The numbers come from vitest's `json-summary` reporter (`coverage/coverage-summary.json` in each package), which is
 * per-file line coverage. "Changed lines" is approximated by the changed file's own line coverage — recorded here so
 * nobody mistakes it for line-level precision.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_FILE = "coverage-baseline.json";

/**
 * The packages the gate covers: the kernel and the model layer.
 *
 * `packages/coding-agent` is deliberately not here yet. On this machine its suite has 94 failing tests (concurrency
 * timeouts and `EPERM` on a temp auth lock), and vitest skips the coverage report when a run raises an unhandled error —
 * so there is no honest baseline to ratchet from. It joins this list when its suite is green.
 */
export const COVERED_PACKAGES = [
	{ name: "@kyrn/judge", directory: join("packages", "kyrn-judge") },
	{ name: "@earendil-works/pi-ai", directory: join("packages", "ai") },
];

/** A changed source file below this line percentage fails the gate. New code is expected to be mostly covered. */
export const CHANGED_FILE_FLOOR = 60;

function relativeToPackage(file, packageDirectory) {
	const normalised = file.replaceAll("\\", "/");
	const marker = `/${packageDirectory.replaceAll("\\", "/")}/`;
	const index = normalised.lastIndexOf(marker);
	return index === -1 ? normalised : normalised.slice(index + marker.length);
}

/**
 * Read one package's `coverage-summary.json`: istanbul's shape, a `total` key plus one entry per file, each with
 * `lines: { total, covered, pct }`.
 */
export function readSummary(path, name, packageDirectory) {
	if (!existsSync(path)) {
		throw new Error(
			`${path} is missing: run the package's tests with --coverage (add --coverage.reportOnFailure when the suite has known environment failures, which otherwise suppress the report)`,
		);
	}
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof parsed !== "object" || parsed === null) throw new Error(`${path}: not an object`);
	const total = parsed.total;
	if (total?.lines === undefined || typeof total.lines.pct !== "number") {
		throw new Error(`${path}: no total.lines.pct (is this a json-summary report?)`);
	}
	// Istanbul reports 100% for a summary whose every counter is 0/0, so a run that instrumented nothing would ratchet
	// upward and pass forever. A package with real sources always has lines; zero means the report is empty.
	const instrumented = typeof total.lines.total === "number" ? total.lines.total : 0;
	if (instrumented === 0) {
		throw new Error(
			`${path}: the report instrumented no lines (total.lines.total is 0), so the gate would pass on nothing — did the run load any source?`,
		);
	}
	const files = {};
	for (const [file, entry] of Object.entries(parsed)) {
		if (file === "total") continue;
		if (typeof entry?.lines?.pct === "number") {
			files[relativeToPackage(file, packageDirectory)] = Math.round(entry.lines.pct * 100) / 100;
		}
	}
	return {
		name,
		lines: Math.round(total.lines.pct * 100) / 100,
		covered: total.lines.covered ?? 0,
		total: total.lines.total ?? 0,
		files,
	};
}

/** The newest file under `directory`, or undefined when there is none. Used to date a report against its sources. */
function newestFile(directory) {
	if (!existsSync(directory)) return undefined;
	let newest;
	const walk = (path) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) walk(child);
			else if (entry.isFile()) {
				const modified = statSync(child).mtimeMs;
				if (newest === undefined || modified > newest.modified) newest = { modified, path: child };
			}
		}
	};
	walk(directory);
	return newest;
}

/**
 * Every covered package's report, read from the default places. A missing report is a problem, not a skip.
 *
 * A report that predates the code it claims to cover is also a problem. Comparing against a stale summary passes
 * forever while the real number moves — the same vacuous green as measuring a build that was never rebuilt — so the
 * report must be newer than the newest file under the package's `src/`. In CI the order is build → tests with
 * `--coverage` → this gate, so a fresh report always satisfies it.
 */
export function readAllReports(root) {
	const reports = [];
	const problems = [];
	for (const entry of COVERED_PACKAGES) {
		const report = join(root, entry.directory, "coverage", "coverage-summary.json");
		try {
			const summary = readSummary(report, entry.name, entry.directory);
			const newest = newestFile(join(root, entry.directory, "src"));
			const written = statSync(report).mtimeMs;
			if (newest !== undefined && newest.modified > written) {
				problems.push(
					`${report} is older than ${newest.path}: it measured code that has since changed — run the package's tests with --coverage (add --coverage.reportOnFailure when the suite has known environment failures)`,
				);
			} else {
				reports.push(summary);
			}
		} catch (error) {
			problems.push(error instanceof Error ? error.message : String(error));
		}
	}
	return { reports, problems };
}

/**
 * The gate. A package below its baseline fails, and the files that fell furthest are named so the report is actionable
 * instead of a single percentage. `files` are paths as the caller has them (a pull request's changed files).
 */
export function coverageProblems(reports, baseline, options = {}) {
	const problems = [];
	for (const report of reports) {
		const expected = baseline.packages[report.name];
		if (expected === undefined) {
			problems.push(`${report.name} has no baseline: run with --update and commit ${BASELINE_FILE}`);
			continue;
		}
		if (report.lines + 1e-9 < expected.lines) {
			const dropped = Object.entries(report.files)
				.filter(([file, pct]) => {
					const before = expected.files[file];
					return before !== undefined && pct + 0.5 < before;
				})
				.sort(([, left], [, right]) => left - right)
				.slice(0, 8)
				.map(([file, pct]) => `${file} (${pct}% was ${expected.files[file]}%)`);
			problems.push(
				`${report.name} line coverage is ${report.lines}%, below the baseline of ${expected.lines}%${
					dropped.length === 0 ? "" : `; these files lost the most: ${dropped.join(", ")}`
				}`,
			);
		}
	}

	const floor = options.changedFileFloor ?? CHANGED_FILE_FLOOR;
	for (const file of options.changedFiles ?? []) {
		const normalised = file.replaceAll("\\", "/");
		const owner = COVERED_PACKAGES.find((entry) => normalised.includes(`${entry.directory.replaceAll("\\", "/")}/src/`));
		if (owner === undefined) continue; // not a source file of a package this gate covers
		const prefix = `${owner.directory.replaceAll("\\", "/")}/`;
		const relative = normalised.slice(normalised.indexOf(prefix) + prefix.length);
		const pct = reports.find((report) => report.name === owner.name)?.files[relative];
		if (pct === undefined) {
			// A changed source file that no test loaded. Failing is the point: new code without a test is the case this
			// check exists for, and a file the coverage tool merely missed would be a bug in this script, not a pass.
			problems.push(`${normalised} is changed but has no coverage entry: is it tested?`);
			continue;
		}
		if (pct + 1e-9 < floor) problems.push(`${normalised} line coverage is ${pct}%, below the ${floor}% floor for changed files`);
	}
	return problems;
}

/** Raise the baseline to what was measured. A package or a file that lost coverage keeps its old number. */
export function updatedBaseline(previous, reports, now = new Date()) {
	const packages = {};
	for (const [name, entry] of Object.entries(previous?.packages ?? {})) packages[name] = { lines: entry.lines, files: { ...entry.files } };
	for (const report of reports) {
		const existing = packages[report.name];
		const files = { ...(existing?.files ?? {}) };
		for (const [file, pct] of Object.entries(report.files)) files[file] = Math.max(files[file] ?? 0, pct);
		packages[report.name] = { lines: Math.max(existing?.lines ?? 0, report.lines), files };
	}
	return {
		generatedAt: now.toISOString().slice(0, 10),
		note: "Line coverage per package, from vitest's json-summary report. Raised with --update; never lowered by hand.",
		packages: Object.fromEntries(Object.entries(packages).sort(([left], [right]) => left.localeCompare(right))),
	};
}

export function readBaseline(root) {
	const path = join(root, BASELINE_FILE);
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8"));
}

/** Written by the CLI and by a test that needs a baseline in a temporary repository. */
export function writeBaselineForTest(root, baseline) {
	writeFileSync(join(root, BASELINE_FILE), `${JSON.stringify(baseline, null, "\t")}\n`);
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const args = process.argv.slice(2);
	const root = process.cwd();
	const update = args.includes("--update");
	const changed = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--changed") changed.push(...args.slice(index + 1).filter((arg) => !arg.startsWith("--")));
	}

	const { reports, problems } = readAllReports(root);
	if (problems.length > 0) {
		for (const problem of problems) console.error(`coverage: ${problem}`);
		process.exitCode = 2;
	} else if (update) {
		const baseline = updatedBaseline(readBaseline(root), reports);
		writeFileSync(join(root, BASELINE_FILE), `${JSON.stringify(baseline, null, "\t")}\n`);
		for (const report of reports) {
			console.log(`coverage: ${report.name} ${report.lines}% (baseline ${baseline.packages[report.name]?.lines}%)`);
		}
	} else {
		const baseline = readBaseline(root);
		if (baseline === undefined) {
			console.error(`coverage: ${BASELINE_FILE} is missing; run with --update and commit it`);
			process.exitCode = 2;
		} else {
			const failures = coverageProblems(reports, baseline, { changedFiles: changed });
			for (const report of reports) {
				console.log(`coverage: ${report.name} ${report.lines}% (baseline ${baseline.packages[report.name]?.lines ?? "none"}%)`);
			}
			if (failures.length === 0) console.log("coverage: no regression");
			else for (const failure of failures) console.error(`coverage: ${failure}`);
			process.exitCode = failures.length === 0 ? 0 : 1;
		}
	}
}
