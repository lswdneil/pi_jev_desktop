#!/usr/bin/env node

/**
 * The benchmark gate: did one of the three hot paths get slower than the baseline in the repository?
 *
 * A run number on its own is noise — a loaded machine is three times slower than an idle one. So the gate
 * compares this run to `packages/kyrn-judge/bench/baseline.json` and only fails when the median is more than
 * 20% slower than the baseline median, on the same Node major, by an amount above the timer's noise floor.
 * A different Node major is reported, not failed: V8 changes between majors are not regressions this
 * repository can fix.
 *
 * The baseline is the repository's shared baseline format (C6 in
 * `docs/plans/production-readiness/04-CONVENTIONS.md`): a `metrics` map of `{unit, p50, p95, samples, budget}`.
 * A metric's `budget` is an absolute ceiling in milliseconds; without one the metric has no ceiling and the
 * relative rule alone decides. `measure` is injectable so the tests do not have to wait for real timings.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_PATH = join("packages", "kyrn-judge", "bench", "baseline.json");
export const TOLERANCE = 0.2;
export const NOISE_FLOOR_MS = 0.5;

/** How much slower than the baseline is still fine. */
export function withinRegression(currentMs, baselineMs, tolerance = TOLERANCE, floor = NOISE_FLOOR_MS) {
	// The relative limit alone is not enough: a case that takes 0.2 ms can double because the event loop was
	// busy, so an increase below the noise floor never fails.
	if (currentMs - baselineMs <= floor) return true;
	return currentMs <= baselineMs * (1 + tolerance);
}

export function nodeMajor(version) {
	return String(version).replace(/^v/, "").split(".")[0] ?? "0";
}

/**
 * Compares one run to the baseline. `failures` block; `warnings` are printed and ignored (`new` for a metric
 * the baseline does not know yet, `node` for a run under a different Node major).
 */
export function compareToBaseline(current, baseline, options = {}) {
	const tolerance = options.tolerance ?? baseline.tolerance ?? TOLERANCE;
	const failures = [];
	const warnings = [];
	const rows = [];
	const sameNode = nodeMajor(current.node) === nodeMajor(baseline.node ?? current.node);
	if (!sameNode) {
		warnings.push(
			`this run is on node ${current.node}, the baseline on node ${baseline.node}: numbers are not comparable, so nothing fails`,
		);
	}
	const metrics = baseline.metrics ?? {};
	const currentMetrics = current.metrics ?? {};
	// A metric the baseline knows and the run does not is a check that silently stopped happening, which is the same
	// kind of green as a stale report. The `rows` loop below can only see metrics that are there, so it cannot notice.
	const absent = Object.keys(metrics).filter((name) => currentMetrics[name] === undefined);
	if (Object.keys(currentMetrics).length === 0) {
		failures.push("the run produced no metrics: nothing was measured, so nothing was compared");
	}
	for (const name of absent) {
		const message = `${name}: the baseline has this metric and this run does not report it — the probe stopped running, or it was replaced without --update`;
		// A different Node major already means "not comparable, so nothing fails"; keeping that contract here too stops
		// a Node bump from turning this into a red build for a reason nobody can fix.
		if (sameNode) failures.push(message);
		else warnings.push(message);
	}
	if (baseline.platform !== undefined && current.platform !== baseline.platform) {
		warnings.push(
			`this run is on ${current.platform}, the baseline on ${baseline.platform}: the numbers still compare, but the tolerance is the only thing absorbing the difference`,
		);
	}
	for (const [name, metric] of Object.entries(currentMetrics)) {
		const known = metrics[name];
		if (known === undefined) {
			warnings.push(`${name}: no baseline yet (${metric.p50} ms recorded as new)`);
			rows.push({ name, currentMs: metric.p50, baselineMs: undefined, delta: undefined, budgetMs: undefined });
			continue;
		}
		const delta = known.p50 === 0 ? 0 : (metric.p50 - known.p50) / known.p50;
		rows.push({ name, currentMs: metric.p50, baselineMs: known.p50, delta, budgetMs: known.budget });
		if (!sameNode) continue;
		// The budget is an absolute ceiling, but one written from a median below the timer's noise floor cannot be
		// judged to that precision: a 0.28 ms case whose budget is 0.36 ms fails at 0.37 ms for scheduling reasons,
		// which is the same jitter the noise floor in `withinRegression` absorbs. Timings get that allowance; byte
		// counts do not, because a byte is exact.
		const allowance = known.unit === "bytes" ? 0 : NOISE_FLOOR_MS;
		if (typeof known.budget === "number" && metric.p50 - known.budget > allowance) {
			failures.push(`${name}: ${metric.p50} ms over its budget of ${known.budget} ms`);
			continue;
		}
		if (!withinRegression(metric.p50, known.p50, tolerance)) {
			failures.push(
				`${name}: ${metric.p50} ms against a baseline of ${known.p50} ms (${Math.round(delta * 100)}% slower, limit ${Math.round(tolerance * 100)}%)`,
			);
		}
	}
	return { failures, warnings, rows, sameNode };
}

/** Fills in `generatedAt`/`node`/`platform` and the per-metric budget, so a baseline is one command. */
export function toBaseline(current, options = {}) {
	const tolerance = options.tolerance ?? TOLERANCE;
	const metrics = {};
	for (const [name, metric] of Object.entries(current.metrics ?? {})) {
		metrics[name] = {
			unit: metric.unit ?? "ms",
			p50: metric.p50,
			p95: metric.p95,
			samples: metric.samples,
			// The budget is the 20% ceiling written down, so a reviewer of the baseline file can see the limit
			// without knowing the rule.
			budget: Math.round(metric.p50 * (1 + tolerance) * 1000) / 1000,
		};
	}
	return {
		schemaVersion: 1,
		generatedAt: current.generatedAt ?? new Date().toISOString(),
		node: current.node,
		platform: current.platform,
		tolerance,
		metrics,
	};
}

/** Runs the gate end to end. `measure`, the clock, and the file system are injectable for the tests. */
export function runGate(options = {}) {
	const root = options.root ?? process.cwd();
	const baselinePath = options.baselinePath ?? join(root, BASELINE_PATH);
	const read = options.read ?? ((path) => readFileSync(path, "utf8"));
	const write =
		options.write ??
		((path, text) => {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
		});
	const measure = options.measure ?? defaultMeasure(root);
	const current = measure();
	const baselineText = options.force === true ? undefined : safeRead(read, baselinePath);
	const report = { current, baseline: undefined, failures: [], warnings: [], rows: [] };

	if (baselineText === undefined || baselineText.trim() === "") {
		const baseline = toBaseline(current, options);
		write(baselinePath, `${JSON.stringify(baseline, null, "\t")}\n`);
		report.baseline = baseline;
		report.warnings.push(`no baseline in the repository: wrote ${BASELINE_PATH} from this run`);
		// The first run establishes the baseline; failing here would block the commit that adds it.
		return { code: 0, report };
	}

	report.baseline = JSON.parse(baselineText);
	const compared = compareToBaseline(current, report.baseline, options);
	report.failures = compared.failures;
	report.warnings = [...report.warnings, ...compared.warnings];
	report.rows = compared.rows;
	return { code: compared.failures.length > 0 ? 1 : 0, report };
}

function safeRead(read, path) {
	try {
		return read(path);
	} catch {
		return undefined;
	}
}

/** Real timings, from a child process so this script's own imports cannot distort them. */
export function defaultMeasure(root) {
	return () => {
		const bench = join(root, "packages", "kyrn-judge", "bench", "bench.ts");
		const output = execFileSync(process.execPath, ["--experimental-strip-types", bench, "--json"], {
			encoding: "utf8",
			cwd: root,
		});
		return JSON.parse(output);
	};
}

export function renderReport(report) {
	const lines = [];
	for (const row of report.rows) {
		const baseline = row.baselineMs === undefined ? "new" : `${row.baselineMs} ms`;
		const budget = row.budgetMs === undefined ? "" : `, budget ${row.budgetMs} ms`;
		const delta = row.delta === undefined ? "" : ` (${row.delta >= 0 ? "+" : ""}${Math.round(row.delta * 100)}%)`;
		lines.push(`  ${row.name.padEnd(17)} ${String(row.currentMs).padStart(8)} ms   baseline ${baseline}${budget}${delta}`);
	}
	for (const warning of report.warnings) lines.push(`  note: ${warning}`);
	for (const failure of report.failures) lines.push(`  FAIL: ${failure}`);
	return lines.join("\n");
}

function invokedDirectly() {
	const entry = process.argv[1];
	if (!entry) return false;
	return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const argv = process.argv.slice(2);
	const update = argv.includes("--update");
	const json = argv.includes("--json");
	// `--check` is the default; accepted so the documented command and the flag agree.
	const unknown = argv.filter((arg) => !["--check", "--update", "--json"].includes(arg));
	if (unknown.length > 0) {
		console.error(`unknown arguments: ${unknown.join(" ")} (expected --check, --update, --json)`);
		process.exitCode = 2;
	} else {
		const { code, report } = runGate({ force: update });
		if (json) console.log(JSON.stringify({ ...report, code }, null, "\t"));
		else {
			console.log(`benchmarks (node ${report.current.node} on ${report.current.platform}):`);
			console.log(renderReport(report));
			console.log(code === 0 ? "no regression past the limit" : "a hot path regressed past the limit");
		}
		process.exitCode = code;
	}
}
