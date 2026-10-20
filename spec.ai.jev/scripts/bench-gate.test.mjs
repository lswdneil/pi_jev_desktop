import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
	BASELINE_PATH,
	compareToBaseline,
	nodeMajor,
	renderReport,
	runGate,
	toBaseline,
	withinRegression,
} from "./bench-gate.mjs";

const BASELINE = {
	schemaVersion: 1,
	generatedAt: "2026-10-18T00:00:00.000Z",
	node: "v24.13.0",
	platform: "win32-x64",
	tolerance: 0.2,
	metrics: {
		segmentTestLog: { unit: "ms", p50: 5.7, p95: 6.4, samples: 20, budget: 6.84 },
		chunkLines: { unit: "ms", p50: 2.4, p95: 2.9, samples: 20 },
	},
};

function run(metrics, node = "v24.13.0") {
	const named = {};
	for (const [name, p50] of Object.entries(metrics)) {
		named[name] = { unit: "ms", p50, p95: p50 + 0.5, samples: 20 };
	}
	return { schemaVersion: 1, generatedAt: "2026-10-18T01:00:00.000Z", node, platform: "win32-x64", metrics: named };
}

function tempRoot() {
	return mkdtempSync(join(tmpdir(), "bench-gate-"));
}

function writeBaseline(root, baseline) {
	const path = join(root, BASELINE_PATH);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(baseline, null, "\t")}\n`);
}

test("a run inside the tolerance passes and records the delta", () => {
	const compared = compareToBaseline(run({ segmentTestLog: 6.5, chunkLines: 2.4 }), BASELINE);
	assert.deepEqual(compared.failures, []);
	assert.equal(compared.rows.length, 2);
	assert.equal(compared.rows[1].delta, 0);
	assert.ok(Math.abs((compared.rows[0].delta ?? 0) - 0.14) < 0.001);
});

test("a run past the tolerance fails with both numbers in the message", () => {
	const compared = compareToBaseline(run({ segmentTestLog: 5.7, chunkLines: 3.4 }), BASELINE);
	assert.equal(compared.failures.length, 1);
	assert.match(compared.failures[0], /chunkLines: 3\.4 ms against a baseline of 2\.4 ms \(42% slower, limit 20%\)/);
});

test("a budget in the baseline is a hard ceiling, even inside the tolerance", () => {
	// 6.6 is only 16% over the median, so the relative rule would let it through; the budget is 6.84.
	const under = compareToBaseline(run({ segmentTestLog: 6.6, chunkLines: 2.4 }), BASELINE);
	assert.deepEqual(under.failures, []);
	// 7.4 is inside the relative limit (7.41) but past the ceiling by more than the timer's noise.
	const over = compareToBaseline(run({ segmentTestLog: 7.4, chunkLines: 2.4 }), BASELINE);
	assert.equal(over.failures.length, 1);
	assert.match(over.failures[0], /segmentTestLog: 7\.4 ms over its budget of 6\.84 ms/);
});

test("a ceiling below the timer's noise floor is not judged to thousandths", () => {
	// The stream probe's median is 0.278 ms; its budget 0.361 ms. A run at 0.37 is the event loop, not the code.
	const baseline = { ...BASELINE, metrics: { streaming: { unit: "ms", p50: 0.278, p95: 0.319, samples: 20, budget: 0.361 } } };
	assert.deepEqual(compareToBaseline(run({ streaming: 0.37 }), baseline).failures, []);
	// It is not a blank cheque: past the ceiling by more than the floor, and the gate fails.
	assert.equal(compareToBaseline(run({ streaming: 1.2 }), baseline).failures.length, 1);
	// Byte counts are exact, so their ceiling has no allowance at all.
	const bytes = { ...BASELINE, metrics: { transcript: { unit: "bytes", p50: 10, p95: 10, samples: 1, budget: 10 } } };
	assert.equal(compareToBaseline(run({ transcript: 11 }), bytes).failures.length, 1);
});

test("an increase below the noise floor does not fail, however large it looks", () => {
	// 0.2 ms doubling is the event loop, not the code: the gate would otherwise fail at random.
	const compared = compareToBaseline(
		run({ chunkLines: 0.4 }),
		{ ...BASELINE, metrics: { chunkLines: { unit: "ms", p50: 0.2, p95: 0.3, samples: 20 } } },
	);
	assert.deepEqual(compared.failures, []);
	assert.equal(withinRegression(0.4, 0.1), true);
	assert.equal(withinRegression(1.2, 0.1), false);
});

test("a different node major is reported, never failed", () => {
	const compared = compareToBaseline(run({ segmentTestLog: 99 }, "v26.1.0"), BASELINE);
	assert.deepEqual(compared.failures, []);
	assert.equal(compared.sameNode, false);
	assert.match(compared.warnings[0], /node v26\.1\.0/);
	assert.equal(nodeMajor("v24.13.0"), "24");
	assert.equal(nodeMajor("24.13.0"), "24");
});

test("a metric the baseline knows and the run forgets fails, instead of going unchecked", () => {
	// The rows loop can only see metrics the run reports, so a probe that stopped running was a silent green.
	const compared = compareToBaseline(run({ chunkLines: 2.4 }), BASELINE);
	assert.equal(compared.failures.length, 1);
	assert.match(compared.failures[0], /segmentTestLog: the baseline has this metric and this run does not report it/);
	// Another Node major already means "not comparable, so nothing fails"; the absence is reported there, not failed.
	const otherNode = compareToBaseline(run({ chunkLines: 2.4 }, "v26.1.0"), BASELINE);
	assert.deepEqual(otherNode.failures, []);
	assert.match(otherNode.warnings.join("\n"), /segmentTestLog: the baseline has this metric/);
	// A run that measured nothing is a failure too: an empty map used to pass every check it did not contain.
	const empty = compareToBaseline({ ...run({}), metrics: {} }, BASELINE);
	assert.equal(empty.failures.length, 3);
	assert.match(empty.failures[0], /the run produced no metrics/);
});

test("a metric the baseline does not know is a note, not a regression", () => {
	const compared = compareToBaseline(run({ segmentTestLog: 5.7, chunkLines: 2.4, judgeTurn: 12 }), BASELINE);
	assert.deepEqual(compared.failures, []);
	assert.match(compared.warnings[0], /judgeTurn: no baseline yet/);
	assert.equal(compared.rows[2].baselineMs, undefined);
});

test("toBaseline writes the shared baseline format with a budget per metric", () => {
	const baseline = toBaseline(run({ chunkLines: 2 }), { tolerance: 0.2 });
	assert.equal(baseline.schemaVersion, 1);
	assert.equal(baseline.node, "v24.13.0");
	assert.equal(baseline.platform, "win32-x64");
	assert.deepEqual(baseline.metrics.chunkLines, { unit: "ms", p50: 2, p95: 2.5, samples: 20, budget: 2.4 });
});

test("a baseline from another platform is noted, and still compared", () => {
	const linux = { ...run({ segmentTestLog: 5.7, chunkLines: 2.4 }), platform: "linux-x64" };
	const compared = compareToBaseline(linux, BASELINE);
	assert.deepEqual(compared.failures, []);
	assert.match(compared.warnings[0], /this run is on linux-x64, the baseline on win32-x64/);
	const over = compareToBaseline({ ...linux, metrics: run({ segmentTestLog: 9, chunkLines: 2.4 }).metrics }, BASELINE);
	assert.equal(over.failures.length, 1);
});

test("runGate writes a baseline when the repository has none", () => {
	const root = tempRoot();
	const { code, report } = runGate({ root, measure: () => run({ segmentTestLog: 5.7 }) });
	assert.equal(code, 0);
	assert.equal(report.rows.length, 0);
	// Either separator: this assertion used to carry Windows' `\`, which made the whole script suite red on the Linux
	// runner the preflight job uses (found 2026-10-19 by running the suite under WSL).
	assert.match(report.warnings[0], /wrote packages[\\/]kyrn-judge[\\/]bench[\\/]baseline\.json/);
	const written = JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8"));
	assert.equal(written.schemaVersion, 1);
	assert.deepEqual(written.metrics.segmentTestLog, { unit: "ms", p50: 5.7, p95: 6.2, samples: 20, budget: 6.84 });
});

test("runGate compares against an existing baseline and exits non-zero on a real regression", () => {
	const root = tempRoot();
	writeBaseline(root, BASELINE);
	const slow = runGate({ root, measure: () => run({ segmentTestLog: 9, chunkLines: 2.4 }) });
	assert.equal(slow.code, 1);
	assert.equal(slow.report.failures.length, 1);
	assert.equal(slow.report.baseline.node, "v24.13.0");

	const fast = runGate({ root, measure: () => run({ segmentTestLog: 5.5, chunkLines: 2.4 }) });
	assert.equal(fast.code, 0);
	assert.deepEqual(fast.report.failures, []);
});

test("runGate with force rewrites the baseline instead of comparing to it", () => {
	const root = tempRoot();
	writeBaseline(root, BASELINE);
	const { code } = runGate({ root, force: true, measure: () => run({ segmentTestLog: 9 }) });
	assert.equal(code, 0);
	const written = JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8"));
	assert.equal(written.metrics.segmentTestLog.p50, 9);
	assert.equal(written.metrics.segmentTestLog.budget, 10.8);
});

test("the rendered report shows current, baseline, budget, and every failure", () => {
	const text = renderReport({
		current: run({}),
		rows: [{ name: "segmentTestLog", currentMs: 8, baselineMs: 5.7, delta: 0.4, budgetMs: 6.84 }],
		warnings: ["this run is on node v26.1.0"],
		failures: ["segmentTestLog: 8 ms against a baseline of 5.7 ms"],
	});
	assert.match(text, /segmentTestLog\s+8 ms {3}baseline 5\.7 ms, budget 6\.84 ms \(\+40%\)/);
	assert.match(text, /note: this run is on node v26\.1\.0/);
	assert.match(text, /FAIL: segmentTestLog: 8 ms/);
});
