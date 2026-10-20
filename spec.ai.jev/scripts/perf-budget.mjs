#!/usr/bin/env node

/**
 * The performance budget: what a shell switch could change, measured before anyone pays for one.
 *
 * Phase 1 (this file, now): the shell-independent costs — transcript codecs, one message's render cost and
 * streaming batching. If a rewrite cannot move these, it cannot justify itself, because the model and the
 * judge are where the latency actually is.
 *
 * Phase 2 (after U19/U22, when the new shell exists): cold start, idle RSS, first-token-to-first-frame,
 * scroll cost, input latency, installer size. Those need an app to measure, so `--collect` and `--judge` say
 * so instead of pretending.
 *
 *   node scripts/perf-budget.mjs                 # compare with bench/desktop/baseline.json
 *   node scripts/perf-budget.mjs --json
 *   node scripts/perf-budget.mjs --update        # after a deliberate change
 *   node scripts/perf-budget.mjs --judge         # Phase 2: needs the shells
 *
 * `--judge` needs two result files, because no single command can measure both halves: the packaged app's cold start,
 * idle memory and installer size (`desktop-next/scripts/collect-metrics.mjs`), and the renderer's scroll, text and input
 * costs (`desktop-next/scripts/render-probes.mjs`). A gate whose number is missing is not "passed" — it is unknown, and
 * the verdict says so instead of letting a missing measurement read as a healthy one.
 *
 * The comparison is `scripts/bench-gate.mjs`'s: the same 20% limit, the same noise floor, the same refusal to
 * compare across Node majors. One reader for every baseline in the tree (C6).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareToBaseline, nodeMajor, renderReport, toBaseline } from "./bench-gate.mjs";

export const BASELINE = join("bench", "desktop", "baseline.json");
export const PROBES = join("bench", "desktop", "run.ts");

/**
 * Shared CI runners are noisier than the 20% the kernel benchmarks tolerate: a 10 MB encode moves by 10-15%
 * between runs on the same machine. 30% still catches a change that doubles a cost, and does not page anyone
 * for a slow runner.
 */
export const PERF_TOLERANCE = 0.3;

/** Phase 2 numbers and the gates that would justify a time-boxed spike (docs/performance-budget.md). */
export const SHELL_GATES = {
	idleRssMb: { limit: 250, afterTrimming: 0.7 },
	coldStartP95Ms: { limit: 1500 },
	scrollP95Ms: { limit: 25 },
	installerMb: { limit: 180, afterTrimming: 120 },
	spikeToleranceRatio: 0.1,
};

/**
 * The decision the Phase 2 numbers exist to make, encoded now so the thresholds cannot be argued with later.
 *
 * A trigger only counts when the complaint survives the obvious remedy: memory over 250 MB starts a spike only
 * when trimming does not give 30% back, and an installer over 180 MB only when trimming cannot get it under
 * 120 MB. A stated need to run without installing anything triggers on its own — that is a distribution
 * requirement, not a size.
 *
 * An absent number is `cannot-judge`, never a pass. `undefined > 250` is false, so a missing measurement and a
 * healthy one used to look identical to this function; the `missing` list is what makes them differ. A gate that
 * already fired still wins, because the spike decision does not need the other gates to be answered first.
 */
export function judgeShell(measures) {
	const reasons = [];
	const missing = [];
	const known = (value) => typeof value === "number" && Number.isFinite(value);
	const { idleRssMb, trimmedRssMb, coldStartP95Ms, scrollP95Ms, installerMb, trimmedInstallerMb, needsNoInstallRuntime } =
		measures;

	if (!known(idleRssMb)) missing.push("idle RSS (npm run metrics)");
	if (known(idleRssMb) && idleRssMb > SHELL_GATES.idleRssMb.limit) {
		if (!known(trimmedRssMb)) missing.push("idle RSS with the trim applied (npm run metrics -- --trim disable-gpu)");
		else if (trimmedRssMb > idleRssMb * SHELL_GATES.idleRssMb.afterTrimming) {
			reasons.push(
				`idle RSS ${idleRssMb} MB is over ${SHELL_GATES.idleRssMb.limit} MB and trimming leaves ${trimmedRssMb} MB (more than ${Math.round(SHELL_GATES.idleRssMb.afterTrimming * 100)}% of it)`,
			);
		}
	}
	if (!known(coldStartP95Ms)) missing.push("cold start p95 (npm run metrics)");
	else if (coldStartP95Ms > SHELL_GATES.coldStartP95Ms.limit) {
		reasons.push(`cold start p95 ${coldStartP95Ms} ms is over ${SHELL_GATES.coldStartP95Ms.limit} ms`);
	}
	if (!known(scrollP95Ms)) missing.push("scroll p95 (npm run render-probes)");
	else if (scrollP95Ms > SHELL_GATES.scrollP95Ms.limit) {
		reasons.push(`scroll p95 ${scrollP95Ms} ms is over ${SHELL_GATES.scrollP95Ms.limit} ms`);
	}
	if (!known(installerMb)) missing.push("installer size (npm run metrics)");
	else if (installerMb > SHELL_GATES.installerMb.limit) {
		if (!known(trimmedInstallerMb)) missing.push("installer size after trimming platforms and locales");
		else if (trimmedInstallerMb > SHELL_GATES.installerMb.afterTrimming) {
			reasons.push(
				`installer ${installerMb} MB is over ${SHELL_GATES.installerMb.limit} MB and trimming leaves ${trimmedInstallerMb} MB (over ${SHELL_GATES.installerMb.afterTrimming} MB)`,
			);
		}
	}
	if (needsNoInstallRuntime === true) {
		reasons.push("there is a stated requirement to run without installing anything, which an installer cannot meet");
	}

	const decision = reasons.length > 0 ? "start-tauri-spike" : missing.length > 0 ? "cannot-judge" : "stay-on-electron";
	return { decision, reasons, missing };
}

export function parseBudgetArgs(argv) {
	const options = { mode: "check", json: false, result: undefined, render: undefined };
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--check") options.mode = "check";
		else if (argument === "--update") options.mode = "update";
		else if (argument === "--json") options.json = true;
		else if (argument === "--result") options.result = argv[++index];
		else if (argument === "--render") options.render = argv[++index];
		else if (argument === "--collect" || argument === "--judge") options.mode = argument.slice(2);
		else throw new Error(`unknown argument "${argument}"`);
	}
	return options;
}

/** Runs the probes in a child process, so this script's own imports cannot distort the timings. */
export function measureProbes(root) {
	return () => {
		const result = spawnSync(process.execPath, ["--experimental-strip-types", join(root, PROBES), "--json"], {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		});
		if (result.status !== 0) throw new Error(`the probes failed: ${result.stderr?.trim() || `exit ${result.status}`}`);
		return JSON.parse(result.stdout);
	};
}

/**
 * Phase 2 needs a running app and a display, so it is collected by `desktop-next/scripts/collect-metrics.mjs`, which
 * owns the launch, the first run and the process accounting. This script keeps the decision.
 */
export function phaseTwoMessage(mode) {
	return [
		`--${mode} is Phase 2 of the performance budget and needs a built desktop app to measure.`,
		"Two commands collect it, because one of them needs a session and a renderer and the other needs the packaged app:",
		"  cd desktop-next && npm run package -- --win --x64 && npm run metrics",
		"  cd desktop-next && npm run build && npm run render-probes",
		"then judge both files together:",
		"  node scripts/perf-budget.mjs --judge --result desktop-next/shell-metrics.json --render desktop-next/render-probes.json",
		"Until then run Phase 1: node scripts/perf-budget.mjs",
	].join("\n");
}

/**
 * The two result files, merged. The app's numbers win where both files carry the same key: `collect-metrics.mjs` measures
 * the packaged app, and a renderer probe on a dev build is the stand-in only for the numbers the packaged app cannot
 * produce (a session and a window full of rows).
 */
export function loadJudgeInputs(options = {}) {
	const read = options.read ?? ((path) => readFileSync(path, "utf8"));
	const render = options.render === undefined ? {} : JSON.parse(read(options.render));
	const app = options.result === undefined ? {} : JSON.parse(read(options.result));
	return { ...render, ...app };
}

export function runBudget(options = {}) {
	const root = options.root ?? process.cwd();
	const baselinePath = options.baselinePath ?? join(root, BASELINE);
	const read = options.read ?? ((path) => readFileSync(path, "utf8"));
	const write =
		options.write ??
		((path, text) => {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
		});
	const measure = options.measure ?? measureProbes(root);
	const current = measure();
	const report = { current, baseline: undefined, failures: [], warnings: [], rows: [] };

	if (options.mode === "update" || !existsSync(baselinePath)) {
		const baseline = toBaseline(current, { tolerance: PERF_TOLERANCE });
		write(baselinePath, `${JSON.stringify(baseline, null, "\t")}\n`);
		report.baseline = baseline;
		report.warnings.push(
			options.mode === "update"
				? `wrote ${BASELINE} from this run`
				: `no baseline in the repository: wrote ${BASELINE} from this run`,
		);
		return { code: 0, report };
	}

	report.baseline = JSON.parse(read(baselinePath));
	const compared = compareToBaseline(current, report.baseline, { tolerance: PERF_TOLERANCE });
	report.failures = compared.failures;
	report.warnings = [...report.warnings, ...compared.warnings];
	report.rows = compared.rows;
	return { code: compared.failures.length > 0 ? 1 : 0, report };
}

export function renderBudgetReport(report) {
	const lines = [];
	for (const row of report.rows) {
		const unit = report.current.metrics[row.name]?.unit ?? "ms";
		const baseline = row.baselineMs === undefined ? "new" : `${row.baselineMs} ${unit}`;
		const budget = row.budgetMs === undefined ? "" : `, budget ${row.budgetMs} ${unit}`;
		const delta = row.delta === undefined ? "" : ` (${row.delta >= 0 ? "+" : ""}${Math.round(row.delta * 100)}%)`;
		lines.push(`  ${row.name.padEnd(28)} ${String(row.currentMs).padStart(9)} ${unit}   baseline ${baseline}${budget}${delta}`);
	}
	for (const warning of report.warnings) lines.push(`  note: ${warning}`);
	for (const failure of report.failures) lines.push(`  FAIL: ${failure}`);
	return lines.join("\n");
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const options = parseBudgetArgs(process.argv.slice(2));
		const renderMissing = options.render !== undefined && !existsSync(options.render);
		// The decision rule is ready; the numbers it consumes need an app. A result file from a real run is
		// judged here, and without one the script says what is missing instead of deciding on nothing.
		if (options.mode === "judge" && options.result !== undefined && existsSync(options.result) && !renderMissing) {
			const measures = loadJudgeInputs({ result: options.result, render: options.render });
			const verdict = judgeShell(measures);
			if (options.json) console.log(JSON.stringify(verdict, null, "\t"));
			else {
				console.log(verdict.decision);
				for (const reason of verdict.reasons) console.log(`  because ${reason}`);
				for (const item of verdict.missing) console.log(`  missing ${item}`);
			}
			// A decision that was not reached is not a pass: exit 2 is "no verdict", 0 is one.
			process.exitCode = verdict.decision === "cannot-judge" ? 2 : 0;
		} else if (options.mode === "judge" && renderMissing) {
			console.error(`perf-budget: no renderer probes at ${options.render}; run "cd desktop-next && npm run render-probes"`);
			process.exitCode = 2;
		} else if (options.mode === "collect" || options.mode === "judge") {
			console.error(phaseTwoMessage(options.mode));
			process.exitCode = 2;
		} else {
			const { code, report } = runBudget({ mode: options.mode });
			if (options.json) console.log(JSON.stringify({ ...report, code }, null, "\t"));
			else {
				console.log(`performance budget (node ${report.current.node} on ${report.current.platform}, major ${nodeMajor(report.current.node)}):`);
				console.log(renderBudgetReport(report));
				console.log(code === 0 ? "no regression past the limit" : "a measured cost regressed past the limit");
			}
			process.exitCode = code;
		}
	} catch (error) {
		console.error(`perf-budget: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
