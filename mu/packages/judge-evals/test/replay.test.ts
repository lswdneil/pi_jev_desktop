import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldOutCases, testLogCases } from "../../kyrn-judge/test/fixtures/test-log-cases.ts";
import { offlineArms, oracleArm } from "../src/arms.ts";
import { corpusFor, parseArgs } from "../src/cli.ts";
import { replayTestLogs, stableProjection } from "../src/replay.ts";
import { evaluateThresholds, toBaseline } from "../src/thresholds.ts";

/**
 * The replay is what makes the README's numbers falsifiable: same corpus in, same verdicts out, and the
 * oracle proves the labels can be satisfied. Everything here runs offline in a few seconds.
 */

const tuned = corpusFor("tuned");
const few = tuned.slice(0, 4);

function archive(): string {
	return mkdtempSync(join(tmpdir(), "judge-evals-test-"));
}

describe("replay", () => {
	it("replays the same input to the same verdicts", async () => {
		const arms = offlineArms().filter((arm) => arm.name === "rules" || arm.name === "full");
		const first = await replayTestLogs({ cases: few, arms, archiveDir: archive() });
		const second = await replayTestLogs({
			cases: few,
			arms: offlineArms().filter((arm) => arm.name === "rules" || arm.name === "full"),
			archiveDir: archive(),
		});
		expect(stableProjection(second.rows)).toEqual(stableProjection(first.rows));
		expect(first.summary.map((arm) => arm.arm)).toEqual(["full", "rules"]);
	});

	it("keeps every required line with the oracle, and omits something", async () => {
		const { summary, rows } = await replayTestLogs({ cases: tuned, arms: [oracleArm()], archiveDir: archive() });
		const oracle = summary[0];
		expect(oracle?.wrongOmissions).toBe(0);
		expect(oracle?.applied).toBeGreaterThan(0);
		expect(oracle?.netSavedChars).toBeGreaterThan(0);
		// A judge that reads the labels never asks for more than the selection itself.
		expect(rows.every((row) => row.lost.length === 0)).toBe(true);
	});

	it("keeps every required line with the rules arm, without any judge", async () => {
		const { summary } = await replayTestLogs({
			cases: tuned,
			arms: offlineArms().filter((arm) => arm.name === "rules"),
			archiveDir: archive(),
		});
		expect(summary[0]?.wrongOmissions).toBe(0);
		expect(summary[0]?.judgeCalls).toBe(0);
	});

	it("shows what the protections alone guarantee: a judge that omits everything loses evidence", async () => {
		const { summary } = await replayTestLogs({
			cases: tuned,
			arms: offlineArms().filter((arm) => arm.name === "ceiling"),
			archiveDir: archive(),
		});
		expect(summary[0]?.wrongOmissions).toBeGreaterThan(0);
	});

	it("points every omission at an archive that holds the original log", async () => {
		const { rows } = await replayTestLogs({ cases: few, arms: offlineArms(), archiveDir: archive() });
		expect(rows.every((row) => row.archiveIntact)).toBe(true);
	});
});

describe("thresholds", () => {
	const baselineFrom = async (name: string) => {
		const { summary } = await replayTestLogs({
			cases: tuned,
			arms: offlineArms().filter((arm) => arm.name === name),
			archiveDir: archive(),
		});
		return {
			summary,
			baseline: toBaseline(summary, {
				now: new Date("2026-10-18T00:00:00.000Z"),
				node: "v24.13.0",
				platform: "win32-x64",
			}),
		};
	};

	it("passes a run that matches its own baseline", async () => {
		const { summary, baseline } = await baselineFrom("rules");
		expect(baseline.metrics["rules.requiredLoss"]).toEqual({ unit: "lines", p50: 0, budget: 0 });
		expect(baseline.metrics["rules.netSavedPct"]?.floor).toBeCloseTo(
			(baseline.metrics["rules.netSavedPct"]?.p50 ?? 0) - 1,
			5,
		);
		expect(evaluateThresholds(summary, baseline).failures).toEqual([]);
	});

	it("fails when an arm loses the saving the baseline recorded", async () => {
		const { summary, baseline } = await baselineFrom("rules");
		const degraded = summary.map((arm) => ({
			...arm,
			netSavedPct: (baseline.metrics["rules.netSavedPct"]?.floor ?? 0) - 0.5,
		}));
		const report = evaluateThresholds(degraded, baseline);
		expect(report.failures.length).toBeGreaterThan(0);
		expect(report.failures.some((failure) => /rules\.netSavedPct: .* under the floor/.test(failure))).toBe(true);
	});

	it("fails when a protecting arm loses a required line", async () => {
		const { summary, baseline } = await baselineFrom("rules");
		const lossy = summary.map((arm) => ({ ...arm, wrongOmissions: 1, casesWithLoss: 1 }));
		expect(evaluateThresholds(lossy, baseline).failures.some((failure) => /lost 1 required line/.test(failure))).toBe(
			true,
		);
	});

	it("fails when a protecting arm falls back instead of deciding", async () => {
		const { summary, baseline } = await baselineFrom("rules");
		const failedOpen = summary.map((arm) => ({ ...arm, fallbacks: 2 }));
		expect(
			evaluateThresholds(failedOpen, baseline).failures.some((failure) => /rules\.fallbacks: 2cases/.test(failure)),
		).toBe(true);
	});

	it("fails when the run no longer reports a baseline number", async () => {
		const { summary, baseline } = await baselineFrom("rules");
		const incomplete = { ...baseline, metrics: { ...baseline.metrics } };
		delete incomplete.metrics["rules.requiredLoss"];
		expect(
			evaluateThresholds(summary, incomplete).failures.some((failure) => /no longer reports/.test(failure)),
		).toBe(false);
		// The reverse is the failure: the baseline knows a number and this run did not produce it.
		const stale = {
			...baseline,
			metrics: { ...baseline.metrics, "jev:suffices.netSavedPct": { unit: "%", p50: 10, floor: 9 } },
		};
		expect(evaluateThresholds(summary, stale).failures.some((failure) => /no longer reports/.test(failure))).toBe(
			true,
		);
	});
});

describe("cli", () => {
	it("defaults to every case and every offline arm", () => {
		expect(parseArgs([])).toMatchObject({
			set: "all",
			json: false,
			updateBaseline: false,
			live: false,
			maxRequests: 150,
		});
	});

	it("takes the set, the arms and the json flag", () => {
		expect(parseArgs(["--set", "heldout", "--arm", "rules,oracle", "--json"])).toMatchObject({
			set: "heldout",
			arms: ["rules", "oracle"],
			json: true,
		});
	});

	it("refuses an unknown argument and an unknown set", () => {
		expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
		expect(() => parseArgs(["--set", "every"])).toThrow(/--set needs/);
	});

	it("splits the corpus into the set the wording was tuned on and the set it never saw", () => {
		expect(corpusFor("heldout")).toBe(heldOutCases);
		expect(corpusFor("all")).toHaveLength(testLogCases.length);
		const tunedIds = new Set(corpusFor("tuned").map((testCase) => testCase.id));
		expect(heldOutCases.some((testCase) => tunedIds.has(testCase.id))).toBe(false);
		expect(corpusFor("tuned").length + heldOutCases.length).toBe(testLogCases.length);
	});
});
