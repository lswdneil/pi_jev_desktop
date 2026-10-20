import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { JUDGE_SECRET, type SyncSecretStore, selectSecretStoreSync } from "@earendil-works/pi-coding-agent";
import { type KyrnConfig, loadConfig } from "../config.ts";
import { reachableJudges } from "../credentials.ts";
import { judgeKeyEnvNames, resolveJudgeConfig } from "../registry.ts";
import { envFileValue, readEnvEntries, removeEnvValue } from "./env-file.ts";
import { Backups, readTextFile, writeFileAtomic } from "./files.ts";

/**
 * Moving keys out of `.env` and into the credential store.
 *
 * A key written into `.env` in clear text is the file equivalent of a sticky note, and every rewrite used to
 * keep it readable by everyone. This moves what it safely can and says exactly what it did:
 *
 * - **A key only mu reads** (`SPEC_AI_JEV_JUDGE_*`, or a custom judge's own `apiKeyEnv`) moves: the store holds it, the
 *   line is removed from `.env`, and the kernel picks it up at session start.
 * - **A key pi also reads** (`AI_GATEWAY_API_KEY`, `TYPESAFE_API_KEY`, `OPENCODE_API_KEY`, `CLOUDFLARE_*`) is
 *   copied into the store but **left in `.env`**, because removing it would break the model calls pi makes with
 *   its own credentials. `--rewrite-env` removes it for someone whose key is in the real environment instead.
 * - **`auth.json` is not touched.** pi reads it directly and has no way to read mu's store, so moving a key out
 *   of it would sign the user out. That has to wait for pi to offer a credential store.
 *
 * The `.env` is copied into the run's backup folder first; a dry run writes nothing at all.
 */

export interface CredentialMigrationOptions {
	readonly agentDir: string;
	/** The `.env` the launcher reads. Absent: nothing to move from it. */
	readonly envFile?: string;
	readonly dryRun?: boolean;
	/** Removes even the keys pi also reads. Only for someone whose environment already sets them. */
	readonly rewriteEnv?: boolean;
	/** Injected by the tests; selected from the agent directory otherwise. */
	readonly store?: SyncSecretStore;
	readonly config?: KyrnConfig;
	readonly now?: Date;
}

export interface MovedKey {
	readonly name: string;
	readonly judge: string;
	/** Whether the line left `.env` (true) or stayed because pi also reads that variable (false). */
	readonly removedFromEnv: boolean;
}

export interface CredentialMigrationResult {
	readonly moved: readonly MovedKey[];
	/** Names that look like keys but stayed: already a reference, empty, or no judge reads them. */
	readonly kept: readonly { readonly name: string; readonly reason: string }[];
	readonly backup?: string;
	readonly envFileWritten: boolean;
	readonly dryRun: boolean;
	readonly backend: string;
}

/** The judge a variable belongs to, most specific first: the first reachable judge that reads it. */
function ownerOf(name: string, config: KyrnConfig): string | undefined {
	const candidates = [...reachableJudges(config), ...Object.keys(config.judges)];
	for (const judgeId of candidates) {
		const judge = resolveJudgeConfig(judgeId, config);
		if (judge === undefined) continue;
		const names = judgeKeyEnvNames(judge);
		if (names[0] === name) return judgeId;
	}
	return undefined;
}

/** `SPEC_AI_JEV_JUDGE_*` and a custom judge's own variable are mu's alone; the rest are shared with pi's model auth. */
function muOnly(name: string): boolean {
	return name.startsWith("SPEC_AI_JEV_JUDGE_");
}

/** A value that is already a reference holds no secret: there is nothing to move. */
function isReference(value: string): boolean {
	return /^\s*\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\s*$/.test(value);
}

export async function migrateCredentials(options: CredentialMigrationOptions): Promise<CredentialMigrationResult> {
	const config = options.config ?? loadConfig({ dir: options.agentDir, env: {} }).config;
	const store = options.store ?? selectSecretStoreSync({ dir: options.agentDir, env: process.env });

	const moved: MovedKey[] = [];
	const kept: { name: string; reason: string }[] = [];
	const text = options.envFile === undefined ? undefined : readTextFile(options.envFile);

	if (text !== undefined) {
		for (const entry of readEnvEntries(text)) {
			const value = envFileValue(text, entry.name);
			if (value === undefined || value.trim() === "") {
				kept.push({ name: entry.name, reason: "it has no value" });
				continue;
			}
			if (isReference(entry.value)) {
				kept.push({ name: entry.name, reason: "it is already a reference, not a key" });
				continue;
			}
			const judge = ownerOf(entry.name, config);
			if (judge === undefined) {
				kept.push({ name: entry.name, reason: "no judge of this configuration reads it" });
				continue;
			}
			const removable = muOnly(entry.name) || options.rewriteEnv === true;
			moved.push({ name: entry.name, judge, removedFromEnv: removable });
			if (options.dryRun === true) continue;
			await store.set(JUDGE_SECRET(judge), value);
		}
	}

	let backup: string | undefined;
	let envFileWritten = false;
	const removableNames = moved.filter((entry) => entry.removedFromEnv).map((entry) => entry.name);
	if (options.dryRun !== true && text !== undefined && options.envFile !== undefined && removableNames.length > 0) {
		const backups = new Backups(dirname(options.agentDir), options.now ?? new Date());
		backups.save(options.envFile);
		backup = backups.path;
		let next = text;
		for (const name of removableNames) next = removeEnvValue(next, name);
		if (next !== text) {
			const note =
				"# Keys moved to the credential store by `mu migrate --credentials`; run `mu doctor .` to see it.";
			const newline = next.includes("\r\n") ? "\r\n" : "\n";
			next = next === "" ? `${note}${newline}` : `${note}${newline}${next}`;
			writeFileAtomic(options.envFile, next);
			envFileWritten = true;
		}
	}

	return { moved, kept, backup, envFileWritten, dryRun: options.dryRun === true, backend: store.backend };
}

/** Where the migration reads from, for the CLI and for the message when there is nothing to do. */
export function credentialFiles(agentDir: string): { readonly envFile?: string; readonly authFile: string } {
	const envFile = join(agentDir, ".env");
	return {
		envFile: existsSync(envFile) ? envFile : undefined,
		authFile: join(agentDir, "auth.json"),
	};
}

export function describeMigration(result: CredentialMigrationResult): string[] {
	const lines: string[] = [];
	const removed = result.moved.filter((entry) => entry.removedFromEnv);
	const copied = result.moved.filter((entry) => !entry.removedFromEnv);
	if (result.dryRun) lines.push("dry run: nothing was written");
	if (removed.length > 0) {
		lines.push(
			`${removed.length} key${removed.length === 1 ? "" : "s"} moved to the ${result.backend} store and removed from .env:`,
		);
		for (const entry of removed) lines.push(`  ${entry.name} -> mu.judge.${entry.judge}.apiKey`);
	}
	if (copied.length > 0) {
		lines.push(
			`${copied.length} key${copied.length === 1 ? "" : "s"} copied to the store and left in .env (pi reads the same variable):`,
		);
		for (const entry of copied) lines.push(`  ${entry.name} -> mu.judge.${entry.judge}.apiKey`);
		lines.push("  move them to your shell environment and run with --rewrite-env to drop them from .env");
	}
	if (result.moved.length === 0 && !result.dryRun) lines.push("nothing to move: no key in .env belongs to a judge");
	if (result.backup !== undefined) {
		lines.push(
			`the previous .env is in ${result.backup}: it still holds the key in plain text, so delete it once the store works`,
		);
	}
	lines.push("auth.json is left alone: pi reads it directly and cannot read mu's store");
	return lines;
}
