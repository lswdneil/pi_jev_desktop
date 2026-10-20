import { pathToFileURL } from "node:url";
import { credentialFiles, describeMigration, migrateCredentials } from "./credentials-migrate.ts";

/**
 * `mu migrate --credentials`: moves the keys in `.env` into the credential store.
 *
 *   node packages/kyrn-judge/src/setup/credentials-cli.ts --agent-dir ~/.mu/agent
 *   ... --dry-run          what it would do, writing nothing
 *   ... --rewrite-env      also drop the keys pi reads (only when they are in the real environment)
 *   ... --json             the result as one object, for a script
 *
 * `mu.mjs` starts this (from the sources in a checkout, from the build in the package), because the store and
 * the `.env` parser are the kernel's and the launcher must not grow a second copy of either.
 */

export interface CredentialsCliOptions {
	readonly agentDir: string;
	readonly dryRun: boolean;
	readonly rewriteEnv: boolean;
	readonly json: boolean;
}

export function parseCredentialsArgs(
	argv: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): CredentialsCliOptions {
	let agentDir = env.MU_AGENT_DIR ?? env.MU_CODING_AGENT_DIR;
	let dryRun = false;
	let rewriteEnv = false;
	let json = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--agent-dir") agentDir = argv[++index];
		else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--rewrite-env") rewriteEnv = true;
		else if (argument === "--json") json = true;
		else throw new Error(`unknown argument "${argument}"`);
	}
	if (agentDir === undefined || agentDir === "") throw new Error("--agent-dir is required (the folder holding .env)");
	return { agentDir, dryRun, rewriteEnv, json };
}

export async function runCredentialsMigration(options: CredentialsCliOptions): Promise<number> {
	const files = credentialFiles(options.agentDir);
	const result = await migrateCredentials({
		agentDir: options.agentDir,
		envFile: files.envFile,
		dryRun: options.dryRun,
		rewriteEnv: options.rewriteEnv,
	});
	if (options.json) {
		console.log(JSON.stringify(result, null, "\t"));
	} else {
		for (const line of describeMigration(result)) console.log(line);
	}
	// A migration that could not write is a failed migration: the caller should not record it as done.
	return 0;
}

function invokedDirectly(): boolean {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const options = parseCredentialsArgs(process.argv.slice(2));
		process.exitCode = await runCredentialsMigration(options);
	} catch (error) {
		console.error(`mu migrate --credentials: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
