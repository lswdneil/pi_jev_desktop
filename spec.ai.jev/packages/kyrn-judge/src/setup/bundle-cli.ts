import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { archiveBundle, inspectArchive, planBundle, writeBundle } from "./bundle.ts";

/**
 * `mu doctor --bundle [--dry-run]`: one archive to attach to an issue.
 *
 * The entry lives beside the module rather than in the launcher script for the same reason the ledger's cost
 * view does: it reads the kernel's ledger types, and the launcher stays a plain file reader. `kyrn-doctor`
 * hands over to this file in a checkout, and to the built copy in a package.
 */

export interface DoctorBundleArgs {
	readonly dryRun: boolean;
	readonly outputDir: string | undefined;
}

export function parseDoctorBundleArgs(argv: readonly string[], env = process.env): DoctorBundleArgs {
	const outputIndex = argv.indexOf("--out");
	return {
		dryRun: argv.includes("--dry-run"),
		outputDir: argv[outputIndex + 1] ?? env.SPEC_AI_JEV_BUNDLE_DIR,
	};
}

export function agentDirFromEnv(env = process.env): string {
	const read = (name: string): string | undefined => env[`SPEC_AI_JEV_${name}`];
	return read("AGENT_DIR") ?? env.PI_CODING_AGENT_DIR ?? join(homedir(), ".spec.ai.jev", "agent");
}

export interface RunDoctorBundleOptions {
	readonly argv: readonly string[];
	readonly agentDir?: string;
	readonly out?: (text: string) => void;
	readonly now?: () => Date;
}

/** Returns the exit code; exported so a test drives it without a process or a real home. */
export function runDoctorBundle(options: RunDoctorBundleOptions): number {
	const args = parseDoctorBundleArgs(options.argv);
	const agentDir = options.agentDir ?? agentDirFromEnv();
	const out = options.out ?? ((text: string) => process.stdout.write(`${text}\n`));
	const plan = planBundle({ agentDir, now: options.now });

	if (args.dryRun) {
		out(`would include ${plan.files.length} files plus manifest.json (${plan.manifest.format}):`);
		for (const file of plan.files) {
			const note = file.truncation ? ` [${file.truncation}]` : "";
			out(`  ${file.path}  ${Buffer.byteLength(file.content, "utf8")} B${note}`);
		}
		out(`omitted: ${plan.manifest.omitted.map((entry) => `${entry.what} (${entry.why})`).join("; ")}`);
		out(`archive listing: ${inspectArchive(archiveBundle(plan, 0)).join(", ")}`);
		return 0;
	}

	const outputDir = args.outputDir ?? join(agentDir, "..", "diagnostics");
	const written = writeBundle({ agentDir, outputDir, now: options.now });
	if (!written.path) return 1;
	out(`wrote ${written.path} (${written.bytes ?? 0} bytes, ${written.plan.files.length} files plus manifest.json)`);
	out(
		`before sending it anywhere, open it once: it holds versions, platform, verdict summaries, crash records and the log tail, and nothing else.`,
	);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runDoctorBundle({ argv: process.argv.slice(2) });
}
