// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	BASELINE_FILE,
	COVERED_PACKAGES,
	coverageProblems,
	readAllReports,
	readSummary,
	updatedBaseline,
	writeBaselineForTest,
} from "./check-coverage.mjs";

/**
 * The coverage gate. Each case is a way a regression reaches a release: a package that lost coverage, a new file
 * nobody tested, and the ratchet being loosened instead of raised.
 */

/** A summary in istanbul's shape, with the absolute paths the reporter writes. `total` defaults to the mean. */
function summary(files, overrides = {}) {
	const entries = Object.fromEntries(
		Object.entries(files).map(([file, pct]) => [file, { lines: { total: 100, covered: pct, pct } }]),
	);
	const values = Object.values(files);
	const mean = values.length === 0 ? 0 : Math.round((values.reduce((sum, pct) => sum + pct, 0) / values.length) * 100) / 100;
	const total = { lines: { total: 100, covered: overrides.covered ?? mean, pct: overrides.total ?? mean } };
	return JSON.stringify({ total, ...entries });
}

function repository(files) {
	const root = mkdtempSync(join(tmpdir(), "mu-coverage-test-"));
	for (const [path, content] of Object.entries(files)) {
		const absolute = join(root, path);
		mkdirSync(join(absolute, ".."), { recursive: true });
		writeFileSync(absolute, content);
	}
	return root;
}

const KERNEL = COVERED_PACKAGES[0].directory;
const AI = COVERED_PACKAGES[1].directory;

function baselineWith(packages) {
	return { generatedAt: "2026-10-18", note: "test", packages };
}

test("a package that lost coverage fails, and the files that fell are named", () => {
	const repo = repository({
		[join(KERNEL, "coverage", "coverage-summary.json")]: summary({
			[`C:/repo/${KERNEL}/src/a.ts`]: 90,
			[`C:/repo/${KERNEL}/src/b.ts`]: 40,
		}),
	});
	try {
		const { reports } = readAllReports(repo);
		const baseline = baselineWith({ "@kyrn/judge": { lines: 90, files: { "src/a.ts": 90, "src/b.ts": 80 } } });
		const problems = coverageProblems(reports, baseline);
		assert.match(problems.join("\n"), /@kyrn\/judge line coverage is 65%, below the baseline of 90%/);
		assert.match(problems.join("\n"), /src\/b\.ts \(40% was 80%\)/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("the same coverage passes, and so does more", () => {
	const repo = repository({ [join(KERNEL, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${KERNEL}/src/a.ts`]: 95 }) });
	try {
		const { reports } = readAllReports(repo);
		assert.deepEqual(coverageProblems(reports, baselineWith({ "@kyrn/judge": { lines: 95, files: {} } })), []);
		assert.deepEqual(coverageProblems(reports, baselineWith({ "@kyrn/judge": { lines: 80, files: {} } })), []);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a package with no baseline is a problem, not a pass", () => {
	const repo = repository({ [join(KERNEL, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${KERNEL}/src/a.ts`]: 95 }) });
	try {
		const { reports } = readAllReports(repo);
		assert.match(coverageProblems(reports, baselineWith({})).join("\n"), /has no baseline/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a missing report says which command to run", () => {
	const repo = repository({});
	try {
		const { problems } = readAllReports(repo);
		assert.equal(problems.length, COVERED_PACKAGES.length);
		assert.match(problems[0] ?? "", /run the package's tests with --coverage/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a report older than the code it measured is a problem, not a pass", () => {
	const repo = repository({
		[join(KERNEL, "src", "later.ts")]: "export const later = 1;\n",
		[join(KERNEL, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${KERNEL}/src/a.ts`]: 95 }),
	});
	try {
		const old = new Date("2026-10-18T00:00:00Z");
		const fresh = new Date("2026-10-19T00:00:00Z");
		utimesSync(join(repo, KERNEL, "coverage", "coverage-summary.json"), old, old);
		utimesSync(join(repo, KERNEL, "src", "later.ts"), fresh, fresh);
		const { reports, problems } = readAllReports(repo);
		assert.deepEqual(reports, [], "a report that measured older code is not a report");
		assert.match(problems.join("\n"), /older than .*later\.ts/);
		assert.match(problems.join("\n"), /run the package's tests with --coverage/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a report written after its sources passes the freshness check", () => {
	const repo = repository({
		[join(KERNEL, "src", "earlier.ts")]: "export const earlier = 1;\n",
		[join(KERNEL, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${KERNEL}/src/a.ts`]: 95 }),
	});
	try {
		const old = new Date("2026-10-18T00:00:00Z");
		const fresh = new Date("2026-10-19T00:00:00Z");
		utimesSync(join(repo, KERNEL, "src", "earlier.ts"), old, old);
		utimesSync(join(repo, KERNEL, "coverage", "coverage-summary.json"), fresh, fresh);
		const { reports, problems } = readAllReports(repo);
		assert.equal(reports.length, 1);
		assert.equal(problems.filter((problem) => /older than/.test(problem)).length, 0);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a changed source file nobody tested fails the change gate", () => {
	const repo = repository({
		[join(KERNEL, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${KERNEL}/src/a.ts`]: 95 }),
	});
	try {
		const { reports } = readAllReports(repo);
		const baseline = baselineWith({ "@kyrn/judge": { lines: 95, files: {} } });
		const problems = coverageProblems(reports, baseline, { changedFiles: [`packages/kyrn-judge/src/untested.ts`] });
		assert.match(problems.join("\n"), /untested\.ts is changed but has no coverage entry: is it tested\?/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a changed file below the floor fails, and one above it does not", () => {
	const repo = repository({
		[join(KERNEL, "coverage", "coverage-summary.json")]: summary({
			[`C:/r/${KERNEL}/src/thin.ts`]: 10,
			[`C:/r/${KERNEL}/src/good.ts`]: 90,
		}),
	});
	try {
		const { reports } = readAllReports(repo);
		const baseline = baselineWith({ "@kyrn/judge": { lines: 50, files: {} } });
		const problems = coverageProblems(reports, baseline, {
			changedFiles: ["packages/kyrn-judge/src/thin.ts", "packages/kyrn-judge/src/good.ts"],
		});
		assert.deepEqual(problems, ["packages/kyrn-judge/src/thin.ts line coverage is 10%, below the 60% floor for changed files"]);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("a changed file outside the covered packages is ignored", () => {
	const repo = repository({ [join(KERNEL, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${KERNEL}/src/a.ts`]: 95 }) });
	try {
		const { reports } = readAllReports(repo);
		assert.deepEqual(coverageProblems(reports, baselineWith({ "@kyrn/judge": { lines: 95, files: {} } }), {
			changedFiles: ["desktop-next/src/main/index.ts", "scripts/whatever.mjs"],
		}), []);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("the ratchet only goes up: a package or a file that fell keeps its old number", () => {
	const reports = [
		{ name: "@kyrn/judge", lines: 70, covered: 70, total: 100, files: { "src/a.ts": 50, "src/new.ts": 30 } },
		{ name: "@earendil-works/pi-ai", lines: 90, covered: 90, total: 100, files: { "src/b.ts": 95 } },
	];
	const previous = { generatedAt: "2026-10-01", note: "", packages: { "@kyrn/judge": { lines: 88, files: { "src/a.ts": 80 } } } };
	const next = updatedBaseline(previous, reports, new Date("2026-10-18T00:00:00Z"));
	assert.equal(next.packages["@kyrn/judge"].lines, 88);
	assert.equal(next.packages["@kyrn/judge"].files["src/a.ts"], 80);
	// A new file has no old number, so it is recorded as measured.
	assert.equal(next.packages["@kyrn/judge"].files["src/new.ts"], 30);
	assert.equal(next.packages["@earendil-works/pi-ai"].lines, 90);
	assert.equal(next.generatedAt, "2026-10-18");
});

test("a report that is not a json-summary is refused, with the file named", () => {
	const path = join(mkdtempSync(join(tmpdir(), "mu-coverage-bad-")), "coverage-summary.json");
	writeFileSync(path, JSON.stringify({ hello: "world" }));
	try {
		assert.throws(() => readSummary(path, "x", "packages/x"), /no total\.lines\.pct/);
	} finally {
		rmSync(join(path, ".."), { recursive: true, force: true });
	}
});

test("a report that instrumented no lines is a problem, not a 100%", () => {
	// Istanbul writes pct 100 for every counter that is 0/0, so an empty report would ratchet to the top and pass.
	const repo = repository({
		[join(KERNEL, "coverage", "coverage-summary.json")]: JSON.stringify({ total: { lines: { total: 0, covered: 0, pct: 100 } } }),
	});
	try {
		const { reports, problems } = readAllReports(repo);
		assert.deepEqual(reports, []);
		assert.match(problems.join("\n"), /instrumented no lines .*would pass on nothing/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("the baseline is written where the gate reads it", () => {
	const repo = repository({
		[join(KERNEL, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${KERNEL}/src/a.ts`]: 77 }),
		[join(AI, "coverage", "coverage-summary.json")]: summary({ [`C:/r/${AI}/src/b.ts`]: 91 }),
	});
	try {
		const { reports, problems } = readAllReports(repo);
		assert.deepEqual(problems, []);
		const baseline = updatedBaseline(undefined, reports, new Date("2026-10-18T00:00:00Z"));
		writeBaselineForTest(repo, baseline);
		const written = JSON.parse(readFileSync(join(repo, BASELINE_FILE), "utf8"));
		assert.equal(written.packages["@kyrn/judge"]?.lines, 77);
		assert.deepEqual(coverageProblems(reports, written), []);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});
