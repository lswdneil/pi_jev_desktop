import { spawn, spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where mu keeps provider and judge keys, and what happens when there is nowhere safe.
 *
 * The rule this file exists for: a key never sits in a world-readable file, and a store that cannot work fails
 * loudly instead of leaving the key somewhere worse. `pico`-level encryption would be security theatre, so the
 * `file` backend encrypts each entry with AES-256-GCM under a random per-machine secret that lives beside it,
 * owner-only; the `plaintext` backend exists only for machines with nothing better and says so once.
 *
 * The launcher and the app both need this, which is why it lives in the coding-agent package: the kernel
 * imports it through the package root like it does the rest of pi.
 */

export type SecretBackend = "keychain" | "file" | "plaintext";

export interface SecretStore {
	readonly backend: SecretBackend;
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

/**
 * A store that can also be read without awaiting. Exactly one caller needs it: pre-resolving judge keys before
 * the runtime that builds the judge exists, which is synchronous. The decision path itself never reads a store.
 */
export interface SyncSecretStore extends SecretStore {
	readSync(key: string): string | undefined;
}

/** Thrown when the configured store cannot be used. Never silently downgraded to a weaker backend. */
export class SecretUnavailableError extends Error {
	readonly kind = "secret-unavailable";

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options?.cause === undefined ? undefined : { cause: options.cause });
		this.name = "SecretUnavailableError";
	}
}

/** What `MU_CREDENTIAL_STORE` may say. Nothing else is accepted: a typo must not silently pick a weaker store. */
const BACKENDS: readonly SecretBackend[] = ["keychain", "file", "plaintext"];

/** The key names the rest of the tree uses. Keys are stored as-is: the store is a key/value map, not a schema. */
export const PROVIDER_SECRET = (providerId: string): string => `mu.provider.${providerId}.apiKey`;
export const JUDGE_SECRET = (judgeId: string): string => `mu.judge.${judgeId}.apiKey`;

export interface SecretStoreOptions {
	/** Where the `file` and `plaintext` backends keep their data, and the random secret they encrypt with. */
	readonly dir?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly platform?: NodeJS.Platform;
	/** Runs a keychain tool. Injectable so the tests do not need `security` or `secret-tool`. */
	readonly run?: RunTool;
	/** The same, without awaiting, for `selectSecretStoreSync` and the synchronous read. */
	readonly runSync?: RunToolSync;
	/** Called once when a weaker backend is chosen, so the user learns where their key went. */
	readonly warn?: (message: string) => void;
}

export interface RunResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	/** The tool is not installed: a different thing from "the tool said no". */
	readonly missing: boolean;
}

export type RunTool = (command: string, args: readonly string[], input?: string) => Promise<RunResult>;

/** The same result, produced without awaiting: `spawnSync`, for a read on a synchronous path. */
export type RunToolSync = (command: string, args: readonly string[], input?: string) => RunResult;

export function runToolSync(command: string, args: readonly string[], input?: string): RunResult {
	const result = spawnSync(command, [...args], { encoding: "utf8", input });
	const error = result.error as NodeJS.ErrnoException | undefined;
	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? error?.message ?? "",
		missing: error?.code === "ENOENT",
	};
}

/** Spawns a tool without a shell and with stdin, which `execCommand` does not offer (`secret-tool` needs it). */
export function runTool(command: string, args: readonly string[], input?: string): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let missing = false;
		child.on("error", (error: NodeJS.ErrnoException) => {
			missing = error.code === "ENOENT";
			stderr += error.message;
		});
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		if (input !== undefined) child.stdin?.end(input);
		else child.stdin?.end();
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr, missing });
		});
	});
}

function defaultDir(env: Readonly<Record<string, string | undefined>>): string {
	// The same directory the kernel uses for consent, quota and the ledger, so one backup covers all of it.
	const configured = env.MU_AGENT_DIR;
	return configured !== undefined && configured !== "" ? configured : join(homedir(), ".mu", "agent");
}

/** Writes a file only its owner can read, tightening a file that already existed with looser permissions. */
function writePrivate(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, { mode: 0o600 });
	try {
		// On Windows this is a no-op (ACLs decide), which is why the plaintext backend warns instead of trusting it.
		chmodSync(path, 0o600);
	} catch {
		// A filesystem that cannot chmod is not a reason to lose the key: the warning path covers the risk.
	}
}

/** Writes and removes a file in `dir`, to find out whether this machine can keep secrets there at all. */
function writable(dir: string): boolean {
	try {
		mkdirSync(dir, { recursive: true });
		const probe = join(dir, ".secret-store-probe");
		writeFileSync(probe, "ok", { mode: 0o600 });
		rmSync(probe, { force: true });
		return true;
	} catch {
		return false;
	}
}

interface EncryptedEntry {
	readonly iv: string;
	readonly tag: string;
	readonly data: string;
}

interface SecretFile {
	version: 1;
	salt?: string;
	entries: Record<string, EncryptedEntry | string>;
}

function readSecretFile(path: string): SecretFile {
	if (!existsSync(path)) return { version: 1, entries: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new SecretUnavailableError(`${path} is not valid JSON, so the keys in it cannot be read`, { cause: error });
	}
	if (typeof parsed !== "object" || parsed === null || typeof (parsed as SecretFile).entries !== "object") {
		throw new SecretUnavailableError(`${path} does not hold a secret file`);
	}
	const file = parsed as SecretFile;
	if (file.version !== 1)
		throw new SecretUnavailableError(`${path} has version ${String(file.version)}, which this build does not read`);
	return file;
}

/** The `file` backend: AES-256-GCM per entry, keyed from a random secret beside the data. */
class FileSecretStore implements SecretStore {
	readonly backend: SecretBackend = "file";
	private readonly path: string;
	private readonly keyPath: string;

	constructor(dir: string) {
		this.path = join(dir, "secrets.json");
		this.keyPath = join(dir, "secrets.key");
	}

	private masterKey(): Buffer {
		if (!existsSync(this.keyPath)) writePrivate(this.keyPath, randomBytes(32).toString("hex"));
		const hex = readFileSync(this.keyPath, "utf8").trim();
		if (!/^[0-9a-f]{64}$/.test(hex))
			throw new SecretUnavailableError(`${this.keyPath} does not hold a 32-byte secret`);
		return Buffer.from(hex, "hex");
	}

	private dataKey(salt: Buffer): Buffer {
		return scryptSync(this.masterKey(), salt, 32);
	}

	async get(key: string): Promise<string | undefined> {
		return this.readSync(key);
	}

	readSync(key: string): string | undefined {
		const file = readSecretFile(this.path);
		const entry = file.entries[key];
		if (entry === undefined) return undefined;
		if (typeof entry === "string") {
			// Written by the plaintext backend before this one was chosen: readable, and migrated on the next set.
			return entry;
		}
		const salt = Buffer.from(file.salt ?? "", "hex");
		try {
			const decipher = createDecipheriv("aes-256-gcm", this.dataKey(salt), Buffer.from(entry.iv, "hex"));
			decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
			return Buffer.concat([decipher.update(Buffer.from(entry.data, "hex")), decipher.final()]).toString("utf8");
		} catch (error) {
			throw new SecretUnavailableError(`the entry for ${key} cannot be decrypted with this machine's secret`, {
				cause: error,
			});
		}
	}

	async set(key: string, value: string): Promise<void> {
		const file = readSecretFile(this.path);
		const salt = file.salt === undefined || file.salt === "" ? randomBytes(16) : Buffer.from(file.salt, "hex");
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.dataKey(salt), iv);
		const data = Buffer.concat([cipher.update(Buffer.from(value, "utf8")), cipher.final()]);
		file.salt = salt.toString("hex");
		file.entries[key] = {
			iv: iv.toString("hex"),
			tag: cipher.getAuthTag().toString("hex"),
			data: data.toString("hex"),
		};
		writePrivate(this.path, `${JSON.stringify(file, null, "\t")}\n`);
	}

	async delete(key: string): Promise<void> {
		const file = readSecretFile(this.path);
		if (file.entries[key] === undefined) return;
		delete file.entries[key];
		writePrivate(this.path, `${JSON.stringify(file, null, "\t")}\n`);
	}
}

/** The backend of last resort: 0600 and honest about it. */
class PlaintextSecretStore implements SyncSecretStore {
	readonly backend: SecretBackend = "plaintext";
	private readonly path: string;

	constructor(dir: string) {
		this.path = join(dir, "secrets.json");
	}

	async get(key: string): Promise<string | undefined> {
		return this.readSync(key);
	}

	readSync(key: string): string | undefined {
		const entry = readSecretFile(this.path).entries[key];
		return typeof entry === "string" ? entry : undefined;
	}

	async set(key: string, value: string): Promise<void> {
		const file = readSecretFile(this.path);
		file.entries[key] = value;
		writePrivate(this.path, `${JSON.stringify(file, null, "\t")}\n`);
	}

	async delete(key: string): Promise<void> {
		const file = readSecretFile(this.path);
		if (file.entries[key] === undefined) return;
		delete file.entries[key];
		writePrivate(this.path, `${JSON.stringify(file, null, "\t")}\n`);
	}
}

/** macOS `security`, Linux `secret-tool`. Windows waits for B9: only `file` and `plaintext` exist there. */
class KeychainSecretStore implements SyncSecretStore {
	readonly backend: SecretBackend = "keychain";
	private readonly service: string;
	private readonly platform: NodeJS.Platform;
	private readonly run: RunTool;
	private readonly runSync: RunToolSync;

	constructor(service: string, platform: NodeJS.Platform, run: RunTool, runSync: RunToolSync = runToolSync) {
		this.service = service;
		this.platform = platform;
		this.run = run;
		this.runSync = runSync;
	}

	private isMac(): boolean {
		return this.platform === "darwin";
	}

	async get(key: string): Promise<string | undefined> {
		// A caller that injected its own runner (a test, a wrapper) gets it on both paths; the default runner has
		// no reason to spawn a second process for a read the synchronous path already does.
		if (this.run === runTool) return this.readSync(key);
		return this.lookup(key);
	}

	private async lookup(key: string): Promise<string | undefined> {
		const result = this.isMac()
			? await this.run("security", ["find-generic-password", "-s", this.service, "-a", key, "-w"])
			: await this.run("secret-tool", ["lookup", "service", this.service, "account", key]);
		if (result.missing)
			throw new SecretUnavailableError(`${this.isMac() ? "security" : "secret-tool"} is not installed`);
		return result.code === 0 ? result.stdout.trim() || undefined : undefined;
	}

	/** The read that cannot await. `spawnSync` costs a few milliseconds and happens once, before the first turn. */
	readSync(key: string): string | undefined {
		const result = this.runSync(
			this.isMac() ? "security" : "secret-tool",
			this.isMac()
				? ["find-generic-password", "-s", this.service, "-a", key, "-w"]
				: ["lookup", "service", this.service, "account", key],
		);
		if (result.missing)
			throw new SecretUnavailableError(`${this.isMac() ? "security" : "secret-tool"} is not installed`);
		return result.code === 0 ? result.stdout.trim() || undefined : undefined;
	}

	async set(key: string, value: string): Promise<void> {
		const result = this.isMac()
			? await this.run("security", ["add-generic-password", "-s", this.service, "-a", key, "-w", value, "-U"])
			: await this.run(
					"secret-tool",
					["store", "--label", `mu ${key}`, "service", this.service, "account", key],
					value,
				);
		if (result.missing)
			throw new SecretUnavailableError(`${this.isMac() ? "security" : "secret-tool"} is not installed`);
		if (result.code !== 0)
			throw new SecretUnavailableError(`the keychain refused to store ${key}: ${result.stderr.trim()}`);
	}

	async delete(key: string): Promise<void> {
		const result = this.isMac()
			? await this.run("security", ["delete-generic-password", "-s", this.service, "-a", key])
			: await this.run("secret-tool", ["clear", "service", this.service, "account", key]);
		if (result.missing)
			throw new SecretUnavailableError(`${this.isMac() ? "security" : "secret-tool"} is not installed`);
		// Deleting a key that is not there is not an error: the caller asked for it to be gone.
		if (result.code !== 0 && !/not be found|could not be found|No such/i.test(result.stderr)) {
			throw new SecretUnavailableError(`the keychain refused to delete ${key}: ${result.stderr.trim()}`);
		}
	}
}

/** Whether the keychain backend has a tool to talk to. Windows has none until B9 decides the backend. */
export async function keychainAvailable(platform: NodeJS.Platform, run: RunTool): Promise<boolean> {
	if (platform === "win32") return false;
	const result = await run(platform === "darwin" ? "security" : "secret-tool", ["--version"]);
	return result.missing === false;
}

/** Builds one backend directly, without the selection rules. Every backend can be read synchronously. */
export function createSecretStore(backend: SecretBackend, options: SecretStoreOptions = {}): SyncSecretStore {
	const dir = options.dir ?? defaultDir(options.env ?? {});
	if (backend === "keychain") {
		return new KeychainSecretStore(
			"mu",
			options.platform ?? process.platform,
			options.run ?? runTool,
			options.runSync ?? runToolSync,
		);
	}
	if (backend === "file") return new FileSecretStore(dir);
	return new PlaintextSecretStore(dir);
}

/**
 * Picks the strongest backend this machine can use: keychain, then the encrypted file, then — with one warning
 * — plaintext. `MU_CREDENTIAL_STORE` forces one, and a forced backend that cannot work raises
 * `SecretUnavailableError` instead of quietly using a weaker one, because "your key is somewhere else" is
 * exactly the surprise this file is meant to prevent.
 */
export async function selectSecretStore(options: SecretStoreOptions = {}): Promise<SecretStore> {
	const env = options.env ?? {};
	const forced = env.MU_CREDENTIAL_STORE?.trim();
	const platform = options.platform ?? process.platform;
	const run = options.run ?? runTool;
	const dir = options.dir ?? defaultDir(env);

	if (forced !== undefined && forced !== "") {
		if (!(BACKENDS as readonly string[]).includes(forced)) {
			throw new SecretUnavailableError(
				`MU_CREDENTIAL_STORE is "${forced}", which is not one of ${BACKENDS.join(", ")}`,
			);
		}
		const backend = forced as SecretBackend;
		if (backend === "keychain" && !(await keychainAvailable(platform, run))) {
			throw new SecretUnavailableError(
				platform === "win32"
					? "MU_CREDENTIAL_STORE=keychain is not available on Windows yet; use file or plaintext"
					: "MU_CREDENTIAL_STORE=keychain, but no keychain tool is installed (security on macOS, secret-tool on Linux)",
			);
		}
		return createSecretStore(backend, { ...options, dir, platform, run });
	}

	if (await keychainAvailable(platform, run)) return createSecretStore("keychain", { ...options, dir, platform, run });
	// The encrypted file needs nothing but Node, so it is the normal answer on Windows and in containers.
	if (writable(dir)) return createSecretStore("file", { ...options, dir, platform, run });
	options.warn?.(`mu cannot write to ${dir}; keys are kept in plaintext, readable only by you`);
	return createSecretStore("plaintext", { ...options, dir, platform, run });
}

/** `keychainAvailable`, without a promise: the probe is one short-lived child process. */
export function keychainAvailableSync(platform: NodeJS.Platform, runSync: RunToolSync = runToolSync): boolean {
	if (platform === "win32") return false;
	return runSync(platform === "darwin" ? "security" : "secret-tool", ["--version"]).missing === false;
}

/**
 * The selection rules of `selectSecretStore`, evaluated synchronously. The runtime that builds the judge is
 * synchronous, and it must know where the keys are before the first decision rather than after it.
 */
export function selectSecretStoreSync(options: SecretStoreOptions = {}): SyncSecretStore {
	const env = options.env ?? {};
	const forced = env.MU_CREDENTIAL_STORE?.trim();
	const platform = options.platform ?? process.platform;
	const runSync = options.runSync ?? runToolSync;
	const dir = options.dir ?? defaultDir(env);
	const withDefaults = { ...options, dir, platform, runSync };

	if (forced !== undefined && forced !== "") {
		if (!(BACKENDS as readonly string[]).includes(forced)) {
			throw new SecretUnavailableError(
				`MU_CREDENTIAL_STORE is "${forced}", which is not one of ${BACKENDS.join(", ")}`,
			);
		}
		const backend = forced as SecretBackend;
		if (backend === "keychain" && !keychainAvailableSync(platform, runSync)) {
			throw new SecretUnavailableError(
				platform === "win32"
					? "MU_CREDENTIAL_STORE=keychain is not available on Windows yet; use file or plaintext"
					: "MU_CREDENTIAL_STORE=keychain, but no keychain tool is installed (security on macOS, secret-tool on Linux)",
			);
		}
		return createSecretStore(backend, withDefaults);
	}

	if (keychainAvailableSync(platform, runSync)) return createSecretStore("keychain", withDefaults);
	if (writable(dir)) return createSecretStore("file", withDefaults);
	options.warn?.(`mu cannot write to ${dir}; keys are kept in plaintext, readable only by you`);
	return createSecretStore("plaintext", withDefaults);
}
