// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * Comparing a startup measurement against its budget.
 *
 * Startup is the first thing a person judges mu by, and it is also the noisiest number in the repository: a shared CI
 * runner, an antivirus first-run scan, a cold filesystem cache. So the comparison has a tolerance (40%) *and* an
 * absolute floor: a change that neither exceeds the percentage nor the floor in milliseconds is noise, not a
 * regression. The floor exists because 40% of a very small number is still a very small number.
 *
 * Kept apart from the probe so the rule is testable without starting Electron.
 */

/** What is measured: from spawning the app to its window, and from there to the agent being usable. */
export const STARTUP_METRICS = [
	{ id: "windowMs", description: "spawn to the first window", tolerance: 0.4, floorMs: 200 },
	{ id: "readyMs", description: "spawn to the agent reporting it is running", tolerance: 0.4, floorMs: 300 },
];

/**
 * What is over budget. `budget` holds the milliseconds the slow path may take; a missing budget is reported, not
 * treated as "no limit".
 */
export function startupProblems(measured, budget, metrics = STARTUP_METRICS) {
	const problems = [];
	for (const metric of metrics) {
		const allowed = budget.metrics?.[metric.id];
		const actual = measured[metric.id];
		if (typeof allowed !== "number") {
			problems.push(`${metric.id} has no budget: run with --update and commit it`);
			continue;
		}
		if (typeof actual !== "number") {
			problems.push(`${metric.id} was not measured`);
			continue;
		}
		const ceiling = Math.round(allowed * (1 + metric.tolerance));
		if (actual > ceiling && actual - allowed > metric.floorMs) {
			problems.push(
				`${metric.id} is ${actual} ms, over the ${ceiling} ms budget (${metric.description}; +${actual - allowed} ms)`,
			);
		}
	}
	return problems;
}

/** One line per metric, for the log: what was measured against what was allowed. */
export function formatStartup(measured, budget, metrics = STARTUP_METRICS) {
	return metrics.map((metric) => {
		const allowed = budget.metrics?.[metric.id];
		const ceiling = typeof allowed === "number" ? Math.round(allowed * (1 + metric.tolerance)) : undefined;
		return `${metric.id} ${measured[metric.id] ?? "?"} ms (budget ${ceiling ?? "?"} ms)`;
	});
}
