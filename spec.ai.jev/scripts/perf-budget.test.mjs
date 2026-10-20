import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { judgeShell, loadJudgeInputs, parseBudgetArgs, phaseTwoMessage, PERF_TOLERANCE, runBudget, SHELL_GATES } from "./perf-budget.mjs";

const dirs = [];
function temp() {
	const directory = mkdtempSync(join(tmpdir(), "mu-perf-"));
	dirs.push(directory);
	return directory;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

function run(metrics) {
	return {
		schemaVersion: 1,
		generatedAt: "2026-10-18T00:00:00.000Z",
		node: "v24.13.0",
		platform: "win32-x64",
		metrics,
	};
}

const BASELINE_METRICS = {
	"transcript.jsonl.encode": { unit: "ms", p50: 10, p95: 12, samples: 20 },
	"transcript.jsonl.bytes": { unit: "bytes", p50: 10495587, p95: 10495587, samples: 1 },
};

test("writes a baseline when the repository has none, and reports it", () => {
	const root = temp();
	const { code, report } = runBudget({
		root,
		baselinePath: join(root, "baseline.json"),
		measure: () => run(BASELINE_METRICS),
	});
	assert.equal(code, 0);
	assert.match(report.warnings[0], /no baseline in the repository/);
	const written = JSON.parse(readFileSync(join(root, "baseline.json"), "utf8"));
	assert.equal(written.schemaVersion, 1);
	// The budget is the measured value plus the perf tolerance, not the kernel benchmarks' 20%.
	assert.equal(written.metrics["transcript.jsonl.encode"].budget, 13);
	assert.equal(written.metrics["transcript.jsonl.bytes"].budget, Math.round(10495587 * (1 + PERF_TOLERANCE) * 1000) / 1000);
});

test("passes a run inside the tolerance and fails one past it", () => {
	const root = temp();
	const baselinePath = join(root, "baseline.json");
	runBudget({ root, baselinePath, measure: () => run(BASELINE_METRICS) });
	const ok = runBudget({
		root,
		baselinePath,
		measure: () => run({ ...BASELINE_METRICS, "transcript.jsonl.encode": { unit: "ms", p50: 11, p95: 12, samples: 20 } }),
	});
	assert.equal(ok.code, 0);
	const slow = runBudget({
		root,
		baselinePath,
		measure: () => run({ ...BASELINE_METRICS, "transcript.jsonl.encode": { unit: "ms", p50: 40, p95: 42, samples: 20 } }),
	});
	assert.equal(slow.code, 1);
	assert.match(slow.report.failures.join("\n"), /transcript\.jsonl\.encode: 40 ms/);
});

test("--update rewrites the baseline instead of comparing", () => {
	const root = temp();
	const baselinePath = join(root, "baseline.json");
	runBudget({ root, baselinePath, measure: () => run(BASELINE_METRICS) });
	const slower = { ...BASELINE_METRICS, "transcript.jsonl.encode": { unit: "ms", p50: 40, p95: 42, samples: 20 } };
	const { code, report } = runBudget({ root, baselinePath, mode: "update", measure: () => run(slower) });
	assert.equal(code, 0);
	assert.match(report.warnings.join("\n"), /wrote bench\/desktop\/baseline\.json|wrote bench\\desktop\\baseline\.json/);
	assert.equal(JSON.parse(readFileSync(baselinePath, "utf8")).metrics["transcript.jsonl.encode"].p50, 40);
});

test("compares only on the same Node major", () => {
	const root = temp();
	const baselinePath = join(root, "baseline.json");
	runBudget({ root, baselinePath, measure: () => run(BASELINE_METRICS) });
	const other = runBudget({
		root,
		baselinePath,
		measure: () => ({ ...run({ ...BASELINE_METRICS, "transcript.jsonl.encode": { unit: "ms", p50: 99, p95: 99, samples: 20 } }), node: "v26.1.0" }),
	});
	assert.equal(other.code, 0);
	assert.match(other.report.warnings.join("\n"), /node v26\.1\.0/);
});

test("Phase 2 refuses with a reason instead of inventing numbers", () => {
	assert.match(phaseTwoMessage("judge"), /Phase 2/);
	// Both halves are named, because neither command can measure the other's numbers.
	assert.match(phaseTwoMessage("judge"), /npm run metrics/);
	assert.match(phaseTwoMessage("judge"), /render-probes/);
	// The gates that would start a spike are in the code, not only in a document.
	assert.equal(SHELL_GATES.idleRssMb.limit, 250);
	assert.equal(SHELL_GATES.coldStartP95Ms.limit, 1500);
	assert.equal(SHELL_GATES.scrollP95Ms.limit, 25);
	assert.equal(SHELL_GATES.installerMb.limit, 180);
	assert.equal(SHELL_GATES.spikeToleranceRatio, 0.1);
});

test("the shell decision follows the four gates, including what survives trimming", () => {
	const healthy = { idleRssMb: 180, trimmedRssMb: 170, coldStartP95Ms: 900, scrollP95Ms: 12, installerMb: 140, trimmedInstallerMb: 110 };
	assert.deepEqual(judgeShell(healthy), { decision: "stay-on-electron", reasons: [], missing: [] });

	// ① Memory over the limit, but trimming gives 30% back: no spike.
	assert.equal(judgeShell({ ...healthy, idleRssMb: 400, trimmedRssMb: 250 }).decision, "stay-on-electron");
	// The same memory, and trimming cannot get it under 70%: a spike.
	const memory = judgeShell({ ...healthy, idleRssMb: 400, trimmedRssMb: 330 });
	assert.equal(memory.decision, "start-tauri-spike");
	assert.match(memory.reasons[0], /idle RSS 400 MB/);

	// ② ③ cold start and scroll are single limits.
	assert.match(judgeShell({ ...healthy, coldStartP95Ms: 1600 }).reasons[0], /cold start p95 1600 ms/);
	assert.match(judgeShell({ ...healthy, scrollP95Ms: 30 }).reasons[0], /scroll p95 30 ms/);

	// ④ An installer over 180 MB only counts when trimming cannot bring it under 120 MB.
	assert.equal(judgeShell({ ...healthy, installerMb: 200, trimmedInstallerMb: 110 }).decision, "stay-on-electron");
	assert.match(judgeShell({ ...healthy, installerMb: 200, trimmedInstallerMb: 150 }).reasons[0], /installer 200 MB/);
	// A no-install requirement triggers on its own.
	assert.match(judgeShell({ ...healthy, needsNoInstallRuntime: true }).reasons[0], /without installing anything/);
});

test("a number that was never measured is cannot-judge, not a pass", () => {
	// `undefined > 250` is false, so before this rule an unmeasured gate was indistinguishable from a healthy one.
	const nothing = judgeShell({});
	assert.equal(nothing.decision, "cannot-judge");
	assert.equal(nothing.reasons.length, 0);
	assert.equal(nothing.missing.length, 4);
	assert.match(nothing.missing.join("\n"), /idle RSS/);
	assert.match(nothing.missing.join("\n"), /scroll p95 \(npm run render-probes\)/);

	const healthy = { idleRssMb: 180, trimmedRssMb: 170, coldStartP95Ms: 900, scrollP95Ms: 12, installerMb: 140, trimmedInstallerMb: 110 };
	// The gate's second half is the half that decides it: memory over the limit with no trimmed number cannot be judged.
	const noTrim = judgeShell({ ...healthy, idleRssMb: 400, trimmedRssMb: undefined });
	assert.equal(noTrim.decision, "cannot-judge");
	assert.match(noTrim.missing[0], /trim applied/);
	// The same for the installer, and for a gate that has no number at all.
	assert.equal(judgeShell({ ...healthy, installerMb: 200, trimmedInstallerMb: undefined }).decision, "cannot-judge");
	assert.equal(judgeShell({ ...healthy, scrollP95Ms: undefined }).decision, "cannot-judge");
	// Memory under the limit needs no trimmed number: nothing to explain.
	assert.equal(judgeShell({ ...healthy, trimmedRssMb: undefined }).decision, "stay-on-electron");
	// A gate that already fired wins: the spike decision does not wait for the other numbers.
	const fired = judgeShell({ ...healthy, scrollP95Ms: 30, coldStartP95Ms: undefined });
	assert.equal(fired.decision, "start-tauri-spike");
	assert.equal(fired.missing.length, 1);
});

test("merges the app's numbers with the renderer's, app first on a shared key", () => {
	const root = temp();
	const result = join(root, "shell-metrics.json");
	const render = join(root, "render-probes.json");
	writeFileSync(result, JSON.stringify({ idleRssMb: 338.7, coldStartP95Ms: 456 }));
	writeFileSync(render, JSON.stringify({ scrollP95Ms: 0.4, coldStartP95Ms: 1, ipcP50Ms: 0.2 }));
	const merged = loadJudgeInputs({ result, render });
	assert.equal(merged.scrollP95Ms, 0.4);
	assert.equal(merged.idleRssMb, 338.7);
	// The packaged app is what a user runs, so its number wins where both files carry one.
	assert.equal(merged.coldStartP95Ms, 456);
	// Without a renderer file the app numbers still load, and the judge says what is missing.
	assert.equal(loadJudgeInputs({ result }).scrollP95Ms, undefined);
});

test("reads the mode flags", () => {
	assert.deepEqual(parseBudgetArgs([]), { mode: "check", json: false, result: undefined, render: undefined });
	assert.deepEqual(parseBudgetArgs(["--update", "--json"]), { mode: "update", json: true, result: undefined, render: undefined });
	assert.deepEqual(parseBudgetArgs(["--collect"]), { mode: "collect", json: false, result: undefined, render: undefined });
	assert.deepEqual(parseBudgetArgs(["--judge", "--result", "r.json"]), { mode: "judge", json: false, result: "r.json", render: undefined });
	assert.deepEqual(parseBudgetArgs(["--judge", "--result", "r.json", "--render", "p.json"]), {
		mode: "judge",
		json: false,
		result: "r.json",
		render: "p.json",
	});
	assert.throws(() => parseBudgetArgs(["--nope"]), /unknown argument/);
});
