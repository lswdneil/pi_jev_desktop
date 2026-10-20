import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aggregateLedger } from "../src/ledger/aggregate.ts";
import { parseLedgerArgs, renderAggregate, runLedgerCli } from "../src/ledger/cli.ts";
import { composePriceLookup, freeRoutePrice, tablePriceLookup } from "../src/ledger/prices.ts";
import { ledgerRecords, ledgerRecordsInFile, recentSessionFiles } from "../src/ledger/sessions.ts";
import type { LedgerRecord } from "../src/ledger.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function area(): string {
	const dir = mkdtempSync(join(tmpdir(), "mu-ledger-cli-"));
	dirs.push(dir);
	return dir;
}

function decisionLine(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: "custom",
		customType: "kyrn.decision",
		data: {
			id: `r-${Math.random().toString(36).slice(2)}`,
			timestamp: "2026-10-18T10:00:00.000Z",
			specId: "tool.admission",
			specVersion: 1,
			mode: "active",
			providerId: "classifier:opencode",
			modelId: "opencode/jev-1.13-free",
			outcome: "keep",
			source: "judge",
			latencyMs: 400,
			usage: { inputTokens: 1_000, outputTokens: 100 },
			stateDigest: "digest",
			...overrides,
		},
	});
}

describe("ledger cost view arguments", () => {
	it("reads the session count and the grouping, and only treats cost flags as its own", () => {
		expect(parseLedgerArgs([])).toEqual({ sessions: 5, json: false, cost: false, by: undefined });
		expect(parseLedgerArgs(["20"])).toMatchObject({ sessions: 20, cost: false });
		expect(parseLedgerArgs(["--cost"])).toMatchObject({ cost: true, by: undefined });
		expect(parseLedgerArgs(["--cost", "--by", "model"])).toMatchObject({ cost: true, by: "model" });
		expect(parseLedgerArgs(["--by=day", "--json"])).toMatchObject({ cost: true, by: "day", json: true });
		// An unknown --by value is ignored rather than guessed at.
		expect(parseLedgerArgs(["--by", "colour"])).toMatchObject({ by: undefined, cost: false });
	});
});

describe("reading the ledger out of session files", () => {
	it("keeps only decision entries, skips broken lines, and orders sessions newest first", () => {
		const dir = area();
		const older = join(dir, "older.jsonl");
		const newer = join(dir, "newer.jsonl");
		writeFileSync(
			older,
			[
				JSON.stringify({ type: "message", message: { role: "user", content: "hi" } }),
				decisionLine({ specId: "older.spec" }),
				"{ not json",
				JSON.stringify({ type: "custom", customType: "other", data: {} }),
			].join("\n"),
		);
		writeFileSync(newer, `${decisionLine({ specId: "newer.spec" })}\n`);

		const specs: string[] = [];
		for (const entry of ledgerRecordsInFile(older)) specs.push(entry.record.specId);
		expect(specs).toEqual(["older.spec"]);

		expect([...recentSessionFiles(dir, 1)]).toEqual([newer]);
		const all = [...ledgerRecords(dir, 5)].map((entry) => entry.record.specId);
		expect(all.sort()).toEqual(["newer.spec", "older.spec"]);
	});
});

describe("prices and rendering", () => {
	it("knows the free route by either name and leaves a truly unknown model unpriced", () => {
		expect(freeRoutePrice({ modelId: "opencode/jev-1.13-free" })).toEqual({
			inputPerMillion: 0,
			outputPerMillion: 0,
		});
		expect(freeRoutePrice({ providerId: "classifier:opencode/jev-1.13-free" })).toEqual({
			inputPerMillion: 0,
			outputPerMillion: 0,
		});
		expect(freeRoutePrice({ modelId: "typesafe/jev-1.14" })).toBeNull();

		const price = composePriceLookup(
			tablePriceLookup({ "typesafe/jev-1.14": { inputPerMillion: 1, outputPerMillion: 2 } }),
			freeRoutePrice,
		);
		expect(price({ providerId: "openrouter.ai:~typesafe/jev-latest", modelId: "typesafe/jev-1.14" })).toEqual({
			inputPerMillion: 1,
			outputPerMillion: 2,
		});
		expect(price({ providerId: "classifier:opencode/jev-1.13-free" })).toEqual({
			inputPerMillion: 0,
			outputPerMillion: 0,
		});
		// A provider that only names the service is not a free route: leave it to the catalog.
		expect(price({ providerId: "classifier:opencode" })).toBeNull();
	});

	it("prints totals and one row per decision, and says why a cost is missing", () => {
		const records = [
			{
				id: "a",
				timestamp: "2026-10-18T10:00:00.000Z",
				specId: "tool.admission",
				specVersion: 1,
				mode: "active",
				providerId: "classifier:opencode",
				modelId: "opencode/jev-1.13-free",
				outcome: "keep",
				source: "judge",
				latencyMs: 400,
				usage: { inputTokens: 1_000, outputTokens: 100 },
				stateDigest: "d",
			} satisfies LedgerRecord,
		];
		const aggregate = aggregateLedger(records, { price: composePriceLookup(freeRoutePrice) });
		const text = renderAggregate(aggregate, "decision");
		expect(text).toContain("1 calls");
		expect(text).toContain("fallback 0%");
		expect(text).toContain("tool.admission");
		expect(text).toContain("$0.0000");
		expect(renderAggregate(aggregateLedger([], {}))).toContain("No decisions");
	});
});

describe("runLedgerCli", () => {
	it("answers with the aggregate as JSON when asked", () => {
		const dir = area();
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "s.jsonl"),
			`${decisionLine()}\n${decisionLine({ source: "fallback", reason: "error:quota", latencyMs: 900 })}\n`,
		);
		const written: string[] = [];
		const code = runLedgerCli({
			argv: ["--cost", "--json", "--by", "decision"],
			sessionsDir: dir,
			price: composePriceLookup(freeRoutePrice),
			out: (text) => written.push(text),
		});
		expect(code).toBe(0);
		const parsed = JSON.parse(written.join("\n")) as {
			totals: { calls: number; fallbacks: number };
			buckets: { specId: string }[];
		};
		expect(parsed.totals.calls).toBe(2);
		expect(parsed.totals.fallbacks).toBe(1);
		expect(parsed.buckets[0]?.specId).toBe("tool.admission");
	});

	it("refuses to run without a cost flag", () => {
		expect(runLedgerCli({ argv: ["--json"], sessionsDir: area(), out: () => {} })).toBe(1);
	});
});
