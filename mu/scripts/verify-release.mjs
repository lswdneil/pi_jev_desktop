#!/usr/bin/env node

/**
 * Verifies a downloaded release: checksums first, then the proofs that say which workflow built it.
 *
 *   node scripts/verify-release.mjs dist
 *   node scripts/verify-release.mjs dist --repo owner/name --require-proof --json
 *
 * The checksum layer needs nothing but Node: every file listed in `SHA256SUMS` is hashed and compared, and
 * a file that changed, disappeared or was added is reported by name. The proof layers are what a downloader
 * cannot fake locally:
 *
 * - **Sigstore bundle** (`SHA256SUMS.sigstore.json` next to it): verified with `cosign verify-blob`, which
 *   checks the keyless certificate was issued to a GitHub Actions workflow of this repository.
 * - **Attestation** (`gh attestation verify <file> --repo …`): the SLSA build provenance the release job
 *   created, naming the commit and the workflow.
 *
 * A tool that is not installed is a **skip**, not a pass: the output says so and the exit code stays 0 only
 * when nothing failed. `--require-proof` turns a skip into a failure, which is what CI after the signing
 * pipeline exists should use.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const CHECKSUM_FILE = "SHA256SUMS";
export const SIGSTORE_BUNDLE = "SHA256SUMS.sigstore.json";

export function parseVerifyArgs(argv) {
	const options = { directory: ".", repo: undefined, requireProof: false, strict: false, json: false, only: undefined };
	const positional = [];
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		switch (argument) {
			case "--repo":
				options.repo = argv[++index];
				break;
			case "--require-proof":
				options.requireProof = true;
				break;
			case "--strict":
				options.strict = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--only":
				options.only = argv[++index];
				break;
			default:
				if (argument.startsWith("--")) throw new Error(`unknown argument "${argument}"`);
				positional.push(argument);
		}
	}
	if (positional.length > 1) throw new Error("give one directory to verify");
	options.directory = positional[0] ?? ".";
	return options;
}

/** `sha256sum` output: `<hex>  <file>` or `<hex> *<file>`, one line per file. */
export function parseChecksums(text) {
	const entries = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed);
		if (match === null) return { entries, error: `not a checksum line: ${JSON.stringify(trimmed)}` };
		entries.push({ hash: match[1].toLowerCase(), file: basename(match[2]) });
	}
	return { entries };
}

export function hashFile(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runDefault(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8" });
	return {
		status: result.error === undefined ? (result.status ?? 1) : undefined,
		missing: result.error !== undefined,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? result.error?.message ?? "",
	};
}

/**
 * Checks one release directory. Returns what passed, failed and was skipped, so the caller decides what to
 * print and the exit code comes from `failures` alone.
 */
export function verifyRelease(options) {
	const run = options.run ?? runDefault;
	const results = [];
	const failures = [];
	const warnings = [];
	const skips = [];
	const directory = options.directory;

	const checksumPath = join(directory, CHECKSUM_FILE);
	if (!existsSync(checksumPath)) {
		failures.push(`there is no ${CHECKSUM_FILE} in ${directory}: nothing can be checked`);
		return { results, failures, warnings, skips };
	}
	const parsed = parseChecksums(readFileSync(checksumPath, "utf8"));
	if (parsed.error) {
		failures.push(`${CHECKSUM_FILE}: ${parsed.error}`);
		return { results, failures, warnings, skips };
	}
	if (parsed.entries.length === 0) failures.push(`${CHECKSUM_FILE} lists no files`);

	const listed = new Set();
	for (const entry of parsed.entries) {
		listed.add(entry.file);
		const path = join(directory, entry.file);
		if (!existsSync(path)) {
			const message = `${entry.file}: listed in ${CHECKSUM_FILE} but missing`;
			failures.push(message);
			results.push({ file: entry.file, check: "checksum", status: "fail", detail: "missing" });
			continue;
		}
		const actual = hashFile(path);
		if (actual !== entry.hash) {
			failures.push(`${entry.file}: its content changed (expected ${entry.hash.slice(0, 16)}…, found ${actual.slice(0, 16)}…)`);
			results.push({ file: entry.file, check: "checksum", status: "fail", detail: `expected ${entry.hash}` });
		} else {
			results.push({ file: entry.file, check: "checksum", status: "pass" });
		}
	}

	// The checksum file and its signature are about the release, not part of it: neither can be listed in
	// the file it covers, so neither counts as an unlisted file.
	for (const name of readdirSync(directory)) {
		if (listed.has(name) || name === CHECKSUM_FILE || name === SIGSTORE_BUNDLE) continue;
		const message = `${name}: in the release but not in ${CHECKSUM_FILE}, so nobody verifies it`;
		if (options.strict) failures.push(message);
		else warnings.push(message);
		results.push({ file: name, check: "listed", status: options.strict ? "fail" : "warn" });
	}

	// Sigstore bundle: keyless signature over SHA256SUMS by a workflow of this repository.
	const bundle = join(directory, SIGSTORE_BUNDLE);
	if (existsSync(bundle)) {
		if (!options.repo) {
			skips.push(`${SIGSTORE_BUNDLE} is present but --repo was not given, so the certificate identity was not checked`);
			results.push({ file: SIGSTORE_BUNDLE, check: "signature", status: "skip", detail: "no --repo" });
		} else {
			const [owner, name] = options.repo.split("/");
			const verified = run("cosign", [
				"verify-blob",
				`--bundle=${bundle}`,
				`--certificate-oidc-issuer=https://token.actions.githubusercontent.com`,
				`--certificate-identity-regexp=^https://github.com/${owner}/${name}/`,
				checksumPath,
			]);
			if (verified.missing) {
				skips.push("cosign is not installed, so the signature was not verified");
				results.push({ file: SIGSTORE_BUNDLE, check: "signature", status: "skip", detail: "cosign not installed" });
			} else if (verified.status === 0) {
				results.push({ file: SIGSTORE_BUNDLE, check: "signature", status: "pass" });
			} else {
				failures.push(`${SIGSTORE_BUNDLE}: cosign rejected it: ${lastLine(verified.stderr)}`);
				results.push({ file: SIGSTORE_BUNDLE, check: "signature", status: "fail", detail: lastLine(verified.stderr) });
			}
		}
	} else {
		const message = "no Sigstore bundle: the checksums are unsigned, so nothing proves who made them";
		if (options.requireProof) failures.push(message);
		else warnings.push(message);
		results.push({ file: SIGSTORE_BUNDLE, check: "signature", status: options.requireProof ? "fail" : "warn" });
	}

	// Build provenance: the attestation GitHub stores for each subject.
	if (options.repo) {
		let attested = 0;
		for (const entry of parsed.entries) {
			if (options.only !== undefined && entry.file !== options.only) continue;
			const verified = run("gh", ["attestation", "verify", join(directory, entry.file), "--repo", options.repo]);
			if (verified.missing) {
				skips.push("gh is not installed or not authenticated, so the build attestations were not checked");
				results.push({ file: entry.file, check: "attestation", status: "skip", detail: "gh not installed" });
				break;
			}
			if (verified.status === 0) {
				attested++;
				results.push({ file: entry.file, check: "attestation", status: "pass" });
			} else if (verified.status === undefined) {
				skips.push("gh is not installed or not authenticated, so the build attestations were not checked");
				results.push({ file: entry.file, check: "attestation", status: "skip" });
				break;
			} else {
				failures.push(`${entry.file}: no build attestation from ${options.repo}: ${lastLine(verified.stderr)}`);
				results.push({ file: entry.file, check: "attestation", status: "fail", detail: lastLine(verified.stderr) });
			}
		}
		if (attested === 0 && options.requireProof && failures.length === 0 && skips.length === 0) {
			failures.push("no file in this release carries a build attestation");
		}
	} else if (options.requireProof) {
		failures.push("--require-proof needs --repo owner/name, so the attestations can be looked up");
	}

	return { results, failures, warnings, skips };
}

function lastLine(text) {
	const lines = text.trim().split("\n").filter((line) => line.trim() !== "");
	return lines[lines.length - 1] ?? "";
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const options = parseVerifyArgs(process.argv.slice(2));
		const report = verifyRelease(options);
		if (options.json) {
			console.log(JSON.stringify({ directory: options.directory, ...report, ok: report.failures.length === 0 }, null, "\t"));
		} else {
			for (const result of report.results) {
				const detail = result.detail === undefined ? "" : ` (${result.detail})`;
				console.log(`${result.status.padEnd(4)} ${result.check.padEnd(11)} ${result.file}${detail}`);
			}
			for (const warning of report.warnings) console.log(`note: ${warning}`);
			for (const skip of report.skips) console.log(`skip: ${skip}`);
			for (const failure of report.failures) console.log(`FAIL: ${failure}`);
			console.log(report.failures.length === 0 ? "the release verifies" : `${report.failures.length} check(s) failed`);
		}
		process.exitCode = report.failures.length > 0 ? 1 : 0;
	} catch (error) {
		console.error(`verify-release: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
