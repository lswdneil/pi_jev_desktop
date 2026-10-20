import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { selectSecretStore } from "@earendil-works/pi-coding-agent";

/**
 * What `mu doctor` says about the key store: which backend this machine gets, how many keys are in it, and
 * whether any of them are sitting in plaintext (a store that fell back on an earlier run may hold both).
 *
 * A CLI of its own rather than a function in the doctor because the selection rules live in the coding-agent
 * package: the doctor stays a plain file reader, and this entry is spawned the way the bundle entry is.
 *
 *   node packages/kyrn-judge/src/setup/secret-cli.ts [--json]
 *
 * Prints `backend=<backend> entries=<n|unknown> plaintext=<yes|no>`; `--json` prints the same as an object.
 */

export interface SecretStatus {
	readonly backend: string;
	/** How many keys the store holds, or undefined when the backend cannot count them without listing them. */
	readonly entries: number | undefined;
	/** Whether a plaintext entry was found in the store file (a fallback from an earlier run). */
	readonly plaintextResidual: boolean;
	/** Where the store keeps its data, for the doctor to print. */
	readonly path: string;
}

/** The file the `file` and `plaintext` backends share; the keychain backend keeps nothing there. */
export async function secretStatus(
	dir: string,
	fetchStore: typeof selectSecretStore = selectSecretStore,
): Promise<SecretStatus> {
	const store = await fetchStore({ dir });
	if (store.backend === "keychain")
		return { backend: "keychain", entries: undefined, plaintextResidual: false, path: dir };
	const path = join(dir, "secrets.json");
	if (!existsSync(path)) return { backend: store.backend, entries: 0, plaintextResidual: false, path };
	let entries: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: Record<string, unknown> };
		entries = parsed.entries ?? {};
	} catch {
		// A file this build cannot read is the doctor's business to report as a broken store, not to crash on.
		return { backend: store.backend, entries: undefined, plaintextResidual: false, path };
	}
	const values = Object.values(entries);
	return {
		backend: store.backend,
		entries: values.length,
		plaintextResidual: values.some((value) => typeof value === "string"),
		path,
	};
}

function invokedDirectly(): boolean {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const dirArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
		const dir =
			dirArgument ??
			process.env.MU_AGENT_DIR ??
			join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".mu", "agent");
		const status = await secretStatus(dir);
		if (process.argv.includes("--json")) console.log(JSON.stringify(status));
		else {
			console.log(
				`backend=${status.backend} entries=${status.entries ?? "unknown"} plaintext=${status.plaintextResidual ? "yes" : "no"}`,
			);
		}
	} catch (error) {
		console.error(`credentials: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
