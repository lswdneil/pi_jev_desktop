import type { ArmSummary } from "./replay.ts";

/**
 * What a change has to keep: no evidence lost, and no less of the log omitted than the committed baseline
 * allowed. The rest is reported, not enforced.
 *
 * Two rules are hard because they are the product claim: `full` and `rules` are what every user gets without
 * a judge, and `oracle` proves the labels are satisfiable. Every other number (judge calls, tokens, recovery
 * cost of a wrong omission) moves with batching and wording, so it is printed and never gates.
 */
export const PROTECTING_ARMS: readonly string[] = ["full", "rules", "oracle"];

/** The arms whose saving is part of the claim, so a drop is a regression rather than a fact to report. */
export const SAVING_ARMS: readonly string[] = ["rules", "oracle"];

/** How many percentage points of net saving an arm may lose before the run fails. */
export const NET_SAVING_SLACK_PP = 1;

export interface ThresholdMetric {
	readonly unit: string;
	/** The measured value. */
	readonly p50: number;
	/** Fail above this. */
	readonly budget?: number;
	/** Fail below this. */
	readonly floor?: number;
}

export interface JudgeEvalBaseline {
	readonly schemaVersion: 1;
	readonly generatedAt: string;
	readonly node: string;
	readonly platform: string;
	readonly metrics: Readonly<Record<string, ThresholdMetric>>;
}

export interface ThresholdReport {
	readonly failures: readonly string[];
	readonly notes: readonly string[];
}

/** Every number this package can regress on, keyed `<arm>.<metric>`. */
export function armMetrics(summary: readonly ArmSummary[]): Record<string, number> {
	const metrics: Record<string, number> = {};
	for (const arm of summary) {
		metrics[`${arm.arm}.requiredLoss`] = arm.wrongOmissions;
		metrics[`${arm.arm}.netSavedPct`] = arm.netSavedPct;
		metrics[`${arm.arm}.fallbacks`] = arm.fallbacks;
	}
	return metrics;
}

/**
 * Writes the baseline from a run. A saving arm's number gets a floor one point below what it measured:
 * rewording may move it a little, and a judge change that costs a real percentage point still fails.
 * The arm that omits everything on purpose gets no bounds: losing evidence is what it is for.
 */
export function toBaseline(
	summary: readonly ArmSummary[],
	options: { readonly now?: Date; readonly node?: string; readonly platform?: string } = {},
): JudgeEvalBaseline {
	const metrics: Record<string, ThresholdMetric> = {};
	for (const arm of summary) {
		const protecting = PROTECTING_ARMS.includes(arm.arm);
		const saving = SAVING_ARMS.includes(arm.arm);
		metrics[`${arm.arm}.requiredLoss`] = {
			unit: "lines",
			p50: arm.wrongOmissions,
			...(protecting ? { budget: 0 } : {}),
		};
		metrics[`${arm.arm}.netSavedPct`] = {
			unit: "%",
			p50: arm.netSavedPct,
			...(saving ? { floor: Math.round((arm.netSavedPct - NET_SAVING_SLACK_PP) * 10) / 10 } : {}),
		};
		metrics[`${arm.arm}.fallbacks`] = {
			unit: "cases",
			p50: arm.fallbacks,
			...(protecting ? { budget: 0 } : {}),
		};
	}
	return {
		schemaVersion: 1,
		generatedAt: (options.now ?? new Date()).toISOString(),
		node: options.node ?? process.version,
		platform: options.platform ?? `${process.platform}-${process.arch}`,
		metrics,
	};
}

/**
 * Compares a run to the baseline. The two hard rules above come first, then every bound the baseline
 * records, then notes for numbers that were not there before.
 */
export function evaluateThresholds(summary: readonly ArmSummary[], baseline: JudgeEvalBaseline): ThresholdReport {
	const failures: string[] = [];
	const notes: string[] = [];

	for (const arm of summary) {
		if (PROTECTING_ARMS.includes(arm.arm) && arm.wrongOmissions > 0) {
			failures.push(`${arm.arm}: lost ${arm.wrongOmissions} required line(s) across ${arm.casesWithLoss} case(s)`);
		}
		if (!arm.archivesIntact)
			failures.push(`${arm.arm}: an omission's archive pointer does not resolve to the original log`);
	}

	const measured = armMetrics(summary);
	for (const [name, metric] of Object.entries(baseline.metrics)) {
		const value = measured[name];
		if (value === undefined) {
			failures.push(`${name}: the run no longer reports this number`);
			continue;
		}
		if (metric.budget !== undefined && value > metric.budget) {
			failures.push(`${name}: ${value}${metric.unit} is over the budget of ${metric.budget}${metric.unit}`);
		}
		if (metric.floor !== undefined && value < metric.floor) {
			failures.push(`${name}: ${value}${metric.unit} is under the floor of ${metric.floor}${metric.unit}`);
		}
	}
	for (const name of Object.keys(measured)) {
		if (baseline.metrics[name] === undefined)
			notes.push(`${name}: new number, not compared (${measured[name]}${name.endsWith("Pct") ? "%" : ""})`);
	}
	return { failures, notes };
}

/**
 * The same baseline, holding only the arms a run actually selected. `--arm rules` compares the rules numbers
 * and says nothing about the arms it did not run; running every arm still fails when one stops reporting.
 */
export function restrictBaseline(baseline: JudgeEvalBaseline, arms: readonly string[]): JudgeEvalBaseline {
	const wanted = new Set(arms);
	const metrics = Object.fromEntries(
		Object.entries(baseline.metrics).filter(([name]) => wanted.has(name.split(".")[0] ?? "")),
	);
	return { ...baseline, metrics };
}
