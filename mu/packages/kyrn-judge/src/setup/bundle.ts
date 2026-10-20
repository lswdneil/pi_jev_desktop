import { type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { LedgerRecord } from "../ledger.ts";
import { environmentSecrets, redactSecrets } from "../redact.ts";

/**
 * One archive a person can send, so "it is stuck" or "it judged that wrong" can be looked at instead of
 * guessed at.
 *
 * What goes in: versions, platform, which settings *exist* (keys only, never values), whether each judge
 * variable is set (booleans, never values), the last verdicts reduced to ids and outcomes' shape, the crash
 * records, and the tails of the telemetry and desktop-shell logs. What never goes in: `.env`, `auth.json`,
 * `models-store.json`, session transcripts, prompt or tool text.
 *
 * Every text is passed through the kernel's redaction on the way out, and the manifest lists what was left
 * out and why — a bundle whose omissions are invisible cannot be trusted by the person sending it.
 *
 * The archive is ustar + gzip, written here rather than with a dependency: npm packages for zipping are one
 * more supply-chain edge for a command that only ever writes eight small files.
 */

export interface BundleLimits {
	readonly maxFiles: number;
	readonly maxTotalBytes: number;
	readonly maxFileBytes: number;
	readonly maxLedgerRecords: number;
	readonly maxLogLines: number;
}

export const BUNDLE_LIMITS: BundleLimits = Object.freeze({
	/** Files in the archive, manifest included. */
	maxFiles: 24,
	/** Total uncompressed bytes. */
	maxTotalBytes: 2 * 1024 * 1024,
	/** One file, uncompressed. */
	maxFileBytes: 256 * 1024,
	/** Verdicts carried. */
	maxLedgerRecords: 200,
	/** Lines of the telemetry tail. */
	maxLogLines: 200,
});

/** Names that are never read, whatever they contain. Kept here so the manifest can say so. */
export const NEVER_INCLUDED = Object.freeze([".env", "auth.json", "models-store.json", "credentials.json"]);

export interface BundleFile {
	/** Path inside the archive, always relative and always forward-slashed. */
	readonly path: string;
	readonly content: string;
	/** Set when the content was cut; the manifest says by how much. */
	readonly truncation?: string;
}

export interface BundleManifest {
	readonly format: "mu-diagnostic-bundle/1";
	readonly createdAt: string;
	readonly platform: string;
	readonly node: string;
	readonly versions: Readonly<Record<string, string>>;
	readonly files: readonly { path: string; bytes: number; truncated?: string }[];
	readonly omitted: readonly { what: string; why: string }[];
	readonly redaction: string;
}

export interface BundleInput {
	/** Where mu keeps its state (`~/.mu/agent`). */
	readonly agentDir: string;
	/** Session files, for the verdicts. Defaults to `<agentDir>/sessions`. */
	readonly sessionsDir?: string;
	/** Telemetry files, for the tail. Defaults to `<agentDir>/logs`. */
	readonly logsDir?: string;
	readonly versions?: Readonly<Record<string, string>>;
	readonly platform?: string;
	readonly node?: string;
	readonly now?: () => Date;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly limits?: Partial<BundleLimits>;
}

export interface BundlePlan {
	readonly files: readonly BundleFile[];
	readonly manifest: BundleManifest;
}

/** Variables whose *presence* is worth knowing when a judge does not answer. Values never leave. */
const JUDGE_ENV = Object.freeze([
	"TYPESAFE_API_KEY",
	"MU_JUDGE_OPENROUTER_API_KEY",
	"AI_GATEWAY_API_KEY",
	"OPENCODE_API_KEY",
	"CLOUDFLARE_API_KEY",
	"MU_JUDGE_CLM_API_KEY",
	"MU_JUDGE",
	"MU_JUDGE_MODE",
	"MU_JUDGE_CONSENT",
	"MU_TELEMETRY",
	"MU_OTEL",
]);

function bounded(text: string, limit: number, what: string): { content: string; truncation?: string } {
	const bytes = Buffer.byteLength(text, "utf8");
	if (bytes <= limit) return { content: text };
	// Cut on a character boundary and say how much was dropped: a silently short file reads like a complete one.
	const kept = Buffer.from(text, "utf8").subarray(0, limit).toString("utf8");
	const lost = bytes - Buffer.byteLength(kept, "utf8");
	return { content: kept, truncation: `${what}: kept ${limit} of ${bytes} bytes (${lost} dropped)` };
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** Only the names: a setting's value can be a path or a token, and its existence is what diagnoses. */
function settingNames(value: unknown): string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
	const names: string[] = [];
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		names.push(key);
		if (typeof child === "object" && child !== null && !Array.isArray(child)) {
			for (const nested of Object.keys(child as Record<string, unknown>)) names.push(`${key}.${nested}`);
		}
	}
	return names.sort();
}

function verdictShape(record: LedgerRecord): Record<string, unknown> {
	const outcome = record.outcome;
	// The shape says which decision point answered how; the content (a title, a snippet) stays out.
	const shape =
		outcome === null
			? "null"
			: Array.isArray(outcome)
				? `array(${outcome.length})`
				: typeof outcome === "object"
					? `object(${Object.keys(outcome as Record<string, unknown>)
							.sort()
							.join(",")})`
					: typeof outcome;
	return {
		id: record.id,
		timestamp: record.timestamp,
		specId: record.specId,
		mode: record.mode,
		source: record.source,
		...(record.reason ? { reason: record.reason } : {}),
		...(typeof record.latencyMs === "number" ? { latencyMs: record.latencyMs } : {}),
		...(record.usage
			? { usage: { inputTokens: record.usage.inputTokens ?? 0, outputTokens: record.usage.outputTokens ?? 0 } }
			: {}),
		outcome: shape,
		stateDigest: record.stateDigest,
	};
}

function recentVerdicts(sessionsDir: string, limit: number): LedgerRecord[] {
	const files: { path: string; mtime: number }[] = [];
	const walk = (dir: string): void => {
		let entries: Dirent<string>[];
		try {
			entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".jsonl")) {
				try {
					files.push({ path, mtime: statSync(path).mtimeMs });
				} catch {
					// A file that disappeared is simply not there.
				}
			}
		}
	};
	walk(sessionsDir);
	const records: LedgerRecord[] = [];
	for (const file of files.sort((left, right) => right.mtime - left.mtime)) {
		for (const line of readFileSync(file.path, "utf8").split("\n")) {
			if (!line.includes('"kyrn.decision"')) continue;
			try {
				const entry = JSON.parse(line) as { customType?: string; data?: LedgerRecord };
				if (entry.customType === "kyrn.decision" && entry.data) records.push(entry.data);
			} catch {
				// A truncated line is exactly the kind of thing a bundle is sent about; skip it here.
			}
		}
		if (records.length >= limit) break;
	}
	return records.slice(-limit);
}

function telemetryTail(logsDir: string, limit: number): string[] {
	let files: string[] = [];
	try {
		files = readdirSync(logsDir, { encoding: "utf8" })
			.filter((name) => name.includes(".jsonl"))
			.sort()
			.reverse();
	} catch {
		return [];
	}
	const lines: string[] = [];
	for (const name of files.slice(0, 2)) {
		try {
			lines.push(...readFileSync(join(logsDir, name), "utf8").split("\n").filter(Boolean));
		} catch {
			// Unreadable log: the manifest still says the direction it was looked for.
		}
	}
	return lines.slice(-limit);
}

/**
 * The desktop shell's own log (`mu-shell.log`), when it exists in the same folder as the telemetry files: crashes,
 * dead child processes, an unresponsive window. Absent unless the shell has run under this home.
 *
 * The rotated file goes first. The shell keeps 2 MiB and rotates to `.1`, so a run that crashed repeatedly can push the
 * first lines of the failure out of the current file; a tail of `mu-shell.log` alone would then start in the middle of
 * the story, or miss it entirely.
 */
function shellLogTail(logsDir: string, limit: number): string[] {
	const read = (name: string): string[] => {
		try {
			return readFileSync(join(logsDir, name), "utf8").split("\n").filter(Boolean);
		} catch {
			return [];
		}
	};
	return [...read("mu-shell.log.1"), ...read("mu-shell.log")].slice(-limit);
}

/** The plan, in memory. Nothing is written and nothing outside `agentDir` is read. */
export function planBundle(input: BundleInput): BundlePlan {
	const limits = { ...BUNDLE_LIMITS, ...input.limits };
	const now = input.now ?? (() => new Date());
	const env = input.env ?? process.env;
	const sessionsDir = input.sessionsDir ?? join(input.agentDir, "sessions");
	const logsDir = input.logsDir ?? join(input.agentDir, "logs");
	const secrets = environmentSecrets(env);
	const clean = (text: string): string => redactSecrets(text, secrets);

	const omitted: { what: string; why: string }[] = NEVER_INCLUDED.map((name) => ({
		what: name,
		why: "may hold credentials; the doctor only checks that it exists",
	}));
	omitted.push(
		{ what: "session transcripts", why: "contain the conversation; only verdict summaries are included" },
		{ what: "environment values", why: "only whether a judge variable is set is included" },
		{ what: "setting values", why: "only the names of the settings that exist are included" },
	);

	const files: BundleFile[] = [];
	const push = (path: string, text: string): void => {
		const redacted = clean(text);
		const boundedText = bounded(redacted, limits.maxFileBytes, path);
		files.push({
			path,
			content: boundedText.content,
			...(boundedText.truncation ? { truncation: boundedText.truncation } : {}),
		});
	};

	push(
		"versions.json",
		`${JSON.stringify(
			{
				platform: input.platform ?? process.platform,
				node: input.node ?? process.version,
				versions: { ...(input.versions ?? {}) },
			},
			null,
			2,
		)}\n`,
	);

	const muJson = readJson(join(input.agentDir, "mu.json")) ?? readJson(join(input.agentDir, "kyrn.json"));
	push(
		"config/settings.json",
		`${JSON.stringify(
			{
				file: existsSync(join(input.agentDir, "mu.json")) ? "mu.json" : "kyrn.json",
				exists: muJson !== undefined,
				names: settingNames(muJson),
			},
			null,
			2,
		)}\n`,
	);

	push(
		"env/presence.json",
		`${JSON.stringify(
			Object.fromEntries(JUDGE_ENV.map((name) => [name, (env[name] ?? "").trim().length > 0])),
			null,
			2,
		)}\n`,
	);

	let verdicts: LedgerRecord[] = [];
	try {
		verdicts = recentVerdicts(sessionsDir, limits.maxLedgerRecords);
	} catch {
		verdicts = [];
	}
	push(
		"ledger/verdicts.jsonl",
		verdicts.length === 0 ? "" : `${verdicts.map((record) => JSON.stringify(verdictShape(record))).join("\n")}\n`,
	);

	const crashesPath = join(input.agentDir, "crashes.json");
	const crashes = readJson(crashesPath);
	push("crashes.json", crashes === undefined ? "{}\n" : `${JSON.stringify(crashes, null, 2)}\n`);

	const tail = telemetryTail(logsDir, limits.maxLogLines);
	if (tail.length > 0) push("logs/spans-tail.jsonl", `${tail.join("\n")}\n`);

	// The desktop shell keeps its own log in the same `logs` folder. It is the only account of a window that died, and
	// the only one a person can produce without a debugger.
	const shell = shellLogTail(logsDir, limits.maxLogLines);
	if (shell.length > 0) push("logs/shell-tail.log", `${shell.join("\n")}\n`);
	else omitted.push({ what: "logs/mu-shell.log", why: "the desktop shell has not written a log under this home" });

	// The caps: total bytes first (oldest big files go), then the file count.
	let total = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
	const kept: BundleFile[] = [];
	for (const file of files) {
		const bytes = Buffer.byteLength(file.content, "utf8");
		if (kept.length + 1 > limits.maxFiles - 1) {
			omitted.push({ what: file.path, why: `over the file limit (${limits.maxFiles - 1} plus the manifest)` });
			continue;
		}
		if (total > limits.maxTotalBytes && kept.length > 0) {
			omitted.push({ what: file.path, why: `over the total size limit (${limits.maxTotalBytes} bytes)` });
			total -= bytes;
			continue;
		}
		kept.push(file);
	}

	const manifest: BundleManifest = {
		format: "mu-diagnostic-bundle/1",
		createdAt: now().toISOString(),
		platform: input.platform ?? process.platform,
		node: input.node ?? process.version,
		versions: { ...(input.versions ?? {}) },
		files: kept.map((file) => ({
			path: file.path,
			bytes: Buffer.byteLength(file.content, "utf8"),
			...(file.truncation ? { truncated: file.truncation } : {}),
		})),
		omitted,
		redaction:
			"every text passed through the kernel redaction; credential values, transcripts and setting values never enter the archive",
	};
	return { files: kept, manifest };
}

/** tar header for one entry, ustar, fixed mtime and mode so two runs over the same plan produce the same bytes. */
function tarHeader(path: string, size: number, mtime: number): Buffer {
	const header = Buffer.alloc(512, 0);
	const write = (value: string, offset: number, length: number): void => {
		Buffer.from(value, "utf8").copy(header, offset, 0, length);
	};
	const writeOctal = (value: number, offset: number, length: number): void => {
		write(value.toString(8).padStart(length - 1, "0"), offset, length - 1);
	};
	write(path, 0, 100);
	writeOctal(0o644, 100, 8);
	writeOctal(0, 108, 8);
	writeOctal(0, 116, 8);
	writeOctal(size, 124, 12);
	writeOctal(mtime, 136, 12);
	header.fill(0x20, 148, 156);
	write("0", 156, 1);
	write("ustar", 257, 6);
	write("00", 263, 2);
	// Checksum: spaces first, then the sum of the header's bytes.
	let checksum = 0;
	for (const byte of header) checksum += byte;
	write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
	return header;
}

/** Deterministic ustar+gzip of the plan. Paths are relative, so no user name travels with it. */
export function archiveBundle(plan: BundlePlan, mtimeSeconds = 0): Buffer {
	const entries = [
		...plan.files,
		{ path: "manifest.json", content: `${JSON.stringify(plan.manifest, null, 2)}\n` },
	].sort((left, right) => left.path.localeCompare(right.path));
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		const body = Buffer.from(entry.content, "utf8");
		chunks.push(tarHeader(entry.path, body.length, mtimeSeconds), body);
		const padding = (512 - (body.length % 512)) % 512;
		if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
	}
	chunks.push(Buffer.alloc(1024, 0));
	return gzipSync(Buffer.concat(chunks), { level: 9 });
}

export interface WriteBundleOptions extends BundleInput {
	/** Directory the archive goes to. */
	readonly outputDir: string;
	/** With `true`, the plan is built and described but nothing is written. */
	readonly dryRun?: boolean;
	readonly write?: (path: string, bytes: Buffer) => void;
}

export interface WriteBundleResult {
	readonly path: string | undefined;
	readonly plan: BundlePlan;
	readonly bytes: number | undefined;
}

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/** Writes `bundle-<stamp>.tar.gz`; with `dryRun`, only the plan comes back. */
export function writeBundle(options: WriteBundleOptions): WriteBundleResult {
	const plan = planBundle(options);
	if (options.dryRun) return { path: undefined, plan, bytes: undefined };
	const stamp = plan.manifest.createdAt.replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
	const path = join(options.outputDir, `bundle-${stamp}.tar.gz`);
	const bytes = archiveBundle(plan, Math.floor(new Date(plan.manifest.createdAt).getTime() / 1000));
	if (!GZIP_MAGIC.equals(bytes.subarray(0, 2))) throw new Error("the archive is not gzip");
	(options.write ?? writeArchiveFile)(path, bytes);
	return { path, plan, bytes: bytes.length };
}

/** The archive's own listing, for a test and for `--dry-run` to prove what it would contain. */
export function inspectArchive(bytes: Buffer): string[] {
	const tar = gunzipSync(bytes);
	const names: string[] = [];
	for (let offset = 0; offset + 512 <= tar.length; ) {
		const name = tar
			.subarray(offset, offset + 100)
			.toString("utf8")
			.replace(/\0.*$/, "");
		if (!name) break;
		const size = Number.parseInt(
			tar
				.subarray(offset + 124, offset + 136)
				.toString("utf8")
				.trim() || "0",
			8,
		);
		names.push(name);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return names;
}

function writeArchiveFile(path: string, bytes: Buffer): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, bytes);
}
