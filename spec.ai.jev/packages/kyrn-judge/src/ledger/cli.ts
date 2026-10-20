import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getBuiltinClassifierModels, getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { aggregateLedger, groupBy, type LedgerAggregate, type ModelPrice, type PriceLookup } from "./aggregate.ts";
import { composePriceLookup, freeRoutePrice } from "./prices.ts";
import { ledgerRecords } from "./sessions.ts";

/**
 * `mu ledger --cost` / `--by decision|model|day`: the same ledger the review view reads, summed up.
 *
 * This runs as its own Node entry rather than inside the review script: the price catalog is pi-ai's, and
 * pulling it into the kernel bundle to render one column is not a trade a judge extension should make.
 * `kyrn/bin/kyrn-ledger` decides which of the two entries to run.
 */

export interface LedgerCliArgs {
	/** How many recent session files to read. */
	readonly sessions: number;
	readonly json: boolean;
	/** Summed cost view (the default when `--by` is present). */
	readonly cost: boolean;
	readonly by: "decision" | "model" | "day" | undefined;
}

/** Parses the flags this entry understands; anything else is the review view's business. */
export function parseLedgerArgs(argv: readonly string[]): LedgerCliArgs {
	let sessions = 5;
	let by: "decision" | "model" | "day" | undefined;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === undefined) continue;
		if (/^\d+$/.test(arg)) {
			sessions = Math.max(1, Number(arg));
			continue;
		}
		if (arg === "--by") {
			const value = argv[index + 1];
			if (value === "decision" || value === "model" || value === "day") {
				by = value;
				index++;
			}
			continue;
		}
		if (arg.startsWith("--by=")) {
			const value = arg.slice("--by=".length);
			if (value === "decision" || value === "model" || value === "day") by = value;
		}
	}
	return { sessions, json: argv.includes("--json"), cost: argv.includes("--cost") || by !== undefined, by };
}

/**
 * Prices from the model catalog, keyed provider/id the way the ledger records them.
 *
 * A ledger's `providerId` is the judge's own (`openrouter.ai:~typesafe/jev-latest`), while the model id is
 * the catalog's (`typesafe/jev-1.14-…`), so the lookup tries the model id first and the pair second.
 */
export function catalogPriceLookup(): PriceLookup {
	const index = new Map<string, ModelPrice>();
	const put = (id: string, cost: { input: number; output: number }): void => {
		index.set(id, { inputPerMillion: cost.input, outputPerMillion: cost.output });
	};
	for (const provider of getBuiltinProviders()) {
		for (const model of getBuiltinModels(provider)) put(model.id, model.cost);
		for (const model of getBuiltinClassifierModels(provider)) put(model.id, model.cost);
	}
	return (model) => {
		if (model.modelId) {
			const hit = index.get(model.modelId) ?? index.get(`${model.providerId}/${model.modelId}`);
			if (hit) return hit;
			// `typesafe/jev-1.14-20261014` is catalogued under the last segment's own id.
			const tail = model.modelId.includes("/") ? model.modelId.slice(model.modelId.lastIndexOf("/") + 1) : "";
			const tailHit = tail ? index.get(tail) : undefined;
			if (tailHit) return tailHit;
		}
		return index.get(model.providerId) ?? null;
	};
}

const US_DOLLARS = (value: number): string => `$${value.toFixed(value < 0.01 ? 4 : 2)}`;

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function latency(value: number | null): string {
	return value === null ? "-" : `${value}ms`;
}

/** The human view: one block of totals, then the rows for the grouping that was asked for. */
export function renderAggregate(aggregate: LedgerAggregate, by: "decision" | "model" | "day" = "decision"): string {
	if (aggregate.totals.calls === 0) return "No decisions in the sessions read (or the ledger is empty).";
	const { totals } = aggregate;
	const lines = [
		`judge: ${totals.calls} calls over ${aggregate.days.length} day${aggregate.days.length === 1 ? "" : "s"} · fallback ${percent(totals.fallbackRate)} · p50 ${latency(totals.latencyP50)} · p95 ${latency(totals.latencyP95)}`,
		`tokens: ${totals.inputTokens} in + ${totals.outputTokens} out · cost: ${totals.costUsd === null ? "unknown for some models" : US_DOLLARS(totals.costUsd)}`,
	];
	if (aggregate.unpricedModels.length > 0) {
		lines.push(`unpriced (not in the catalog): ${aggregate.unpricedModels.join(", ")}`);
	}
	for (const row of groupBy(aggregate, by)) {
		const cost = row.costUsd === null ? "unknown" : US_DOLLARS(row.costUsd);
		lines.push(
			`  ${row.key.padEnd(28)} ${String(row.calls).padStart(5)} calls  fallback ${percent(row.fallbacks / Math.max(1, row.calls)).padStart(4)}  p50 ${latency(row.latencyP50)}  ${cost}`,
		);
	}
	return lines.join("\n");
}

export interface RunLedgerCliOptions {
	readonly argv: readonly string[];
	readonly sessionsDir: string;
	readonly price?: PriceLookup;
	readonly out?: (text: string) => void;
}

/** Runs the cost view; returns the process exit code. Exported so a test drives it without a process. */
export function runLedgerCli(options: RunLedgerCliOptions): number {
	const args = parseLedgerArgs(options.argv);
	if (!args.cost) {
		options.out?.("nothing to do: pass --cost, or --by decision|model|day");
		return 1;
	}
	const price = composePriceLookup(options.price ?? catalogPriceLookup(), freeRoutePrice);
	const aggregate = aggregateLedger(
		[...ledgerRecords(options.sessionsDir, args.sessions)].map((entry) => entry.record),
		{ price },
	);
	if (args.json) {
		options.out?.(JSON.stringify(aggregate, null, 2));
		return 0;
	}
	options.out?.(renderAggregate(aggregate, args.by ?? "decision"));
	return 0;
}
/**
 * Where the session files are, resolved the way the review script resolves it: `MU_AGENT_DIR`, then pi's
 * own agent dir variable, then `~/.mu/agent` (or the older `~/.kyrn/agent`).
 */
export function sessionsDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
	const read = (name: string): string | undefined => env[`MU_${name}`] || env[`KYRN_${name}`];
	const home = existsSync(join(homedir(), ".mu")) || !existsSync(join(homedir(), ".kyrn")) ? ".mu" : ".kyrn";
	const agentDir = read("AGENT_DIR") ?? env.PI_CODING_AGENT_DIR ?? join(homedir(), home, "agent");
	return read("SESSIONS_DIR") ?? join(agentDir, "sessions");
}

// Run when executed, stay silent when imported (the kernel index and the tests import this module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runLedgerCli({
		argv: process.argv.slice(2),
		sessionsDir: sessionsDir(),
		out: (text) => process.stdout.write(`${text}\n`),
	});
}
