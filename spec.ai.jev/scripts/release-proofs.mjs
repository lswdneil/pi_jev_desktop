#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The proof set a release folder needs: an SBOM, a checksum file over what a person downloads, and then the same
 * verifier a downloader runs — so the folder is checked by the code that will judge the published release, not by the
 * code that made it.
 *
 * This exists because the proofs used to be a recipe in a workflow file only (`desktop.yml`), and a recipe that runs in
 * one place cannot be rehearsed anywhere else. The two steps a machine without credentials cannot do stay out: the
 * Sigstore signature needs this run's OIDC identity, and the build attestation is created by GitHub for the workflow
 * that built the file. `release-proofs.mjs` therefore produces the local half and then reports honestly that the
 * signature and the attestation are missing, which is what `verify-release` already distinguishes (warn/skip, not pass).
 *
 *   node scripts/release-proofs.mjs desktop-next/dist
 *   node scripts/release-proofs.mjs release --version 0.1.8 --commit "$(git rev-parse HEAD)"
 *   node scripts/release-proofs.mjs desktop-next/dist --dry-run     # what it would cover, writes nothing
 *
 * What the checksum file covers: the installers, a source archive, and the SBOM. What it deliberately does not cover:
 * the update feed (`latest*.yml`), the update signature (`*.sig`) and blockmaps — the app reads those to find its next
 * installer, and the release notes say so. `verify-release` lists them as warnings, which is the answer this script
 * prints too.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INSTALLER_EXTENSIONS } from "./sign-installers.mjs";
import { CHECKSUM_FILE, SIGSTORE_BUNDLE, hashFile, verifyRelease } from "./verify-release.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** What a downloader runs, plus the SBOM and a source archive when the release carries them. */
export const COVERED_EXTENSIONS = [...INSTALLER_EXTENSIONS, ".tar.gz", ".cdx.json"];

/** The files that sit beside a release rather than in it: the update feed, the updater's signature, blockmaps. */
export const BESIDE_THE_RELEASE = [/^latest.*\.yml$/, /\.blockmap$/, /\.sig$/];

/** Whether a file is one the release deliberately leaves out of the checksums (`latest.yml` and its companions). */
export function isBesideTheRelease(name) {
	return BESIDE_THE_RELEASE.some((pattern) => pattern.test(name));
}

/** Every file in `directory` the checksum file should cover, sorted so two runs produce the same file. */
export function coveredFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name !== CHECKSUM_FILE && name !== SIGSTORE_BUNDLE)
		.filter((name) => statSync(join(directory, name)).isFile())
		.filter((name) => COVERED_EXTENSIONS.some((extension) => name.endsWith(extension)))
		.sort();
}

/** The files in the folder that are not covered, and why they are not: the update feed and its companions. */
export function uncoveredFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name !== CHECKSUM_FILE && name !== SIGSTORE_BUNDLE)
		.filter((name) => statSync(join(directory, name)).isFile())
		.filter((name) => !COVERED_EXTENSIONS.some((extension) => name.endsWith(extension)))
		.sort();
}

/** Writes `SHA256SUMS` over the given files, in `sha256sum`'s own format. */
export function writeChecksums(directory, files) {
	const lines = files.map((name) => `${hashFile(join(directory, name))}  ${name}`);
	writeFileSync(join(directory, CHECKSUM_FILE), `${lines.join("\n")}\n`, "ascii");
	return lines.length;
}

function versionOf(directory) {
	try {
		const manifest = JSON.parse(readFileSync(join(directory, "..", "package.json"), "utf8"));
		return typeof manifest.version === "string" ? manifest.version : undefined;
	} catch {
		return undefined;
	}
}

function commitOf() {
	// A delivery copy has no `.git` of its own, so CI's own variable and an explicit override come first.
	const fromEnv = process.env.GITHUB_SHA ?? process.env.MU_COMMIT;
	if (fromEnv !== undefined && /^[0-9a-f]{40}$/.test(fromEnv.trim())) return fromEnv.trim();
	const result = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
	const text = (result.stdout ?? "").trim();
	return /^[0-9a-f]{40}$/.test(text) ? text : "unknown";
}

function writeSbom(directory, version, commit) {
	const out = join(directory, "sbom.cdx.json");
	const result = spawnSync(
		process.execPath,
		[join(ROOT, "scripts", "sbom.mjs"), "--lock", join(ROOT, "package-lock.json"), "--out", out, "--name", "spec.ai.jev", "--version", version, "--commit", commit],
		{ encoding: "utf8", cwd: ROOT },
	);
	if (result.status !== 0) {
		throw new Error(`could not write the SBOM: ${(result.stderr ?? "").trim() || `exit ${result.status}`}`);
	}
	return out;
}

export function parseReleaseProofArgs(argv) {
	const options = { directory: join("desktop-next", "dist"), version: undefined, commit: undefined, sbom: true, dryRun: false };
	const positional = [];
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--version") options.version = argv[++index];
		else if (argument === "--commit") options.commit = argv[++index];
		else if (argument === "--no-sbom") options.sbom = false;
		else if (argument === "--dry-run") options.dryRun = true;
		else if (argument === "--help") options.help = true;
		else if (argument.startsWith("--")) throw new Error(`unknown argument "${argument}"`);
		else positional.push(argument);
	}
	if (positional.length > 1) throw new Error("give one folder to prove");
	if (positional.length === 1) options.directory = positional[0];
	return options;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const options = parseReleaseProofArgs(process.argv.slice(2));
		if (options.help === true) {
			console.log("node scripts/release-proofs.mjs [folder] [--version v] [--commit sha] [--no-sbom] [--dry-run]");
			process.exitCode = 0;
		} else {
			const directory = options.directory;
			if (!existsSync(directory)) {
				console.error(`release-proofs: ${directory} does not exist; package the app first`);
				process.exitCode = 2;
			} else if (options.dryRun === true) {
				const covered = coveredFiles(directory);
				console.log(`release-proofs: would cover ${covered.length} file(s): ${covered.join(", ") || "(none)"}`);
				const beside = uncoveredFiles(directory);
				if (beside.length > 0) console.log(`release-proofs: beside the release, not covered: ${beside.join(", ")}`);
				process.exitCode = covered.length === 0 ? 2 : 0;
			} else {
				const version = options.version ?? versionOf(directory);
				if (version === undefined) throw new Error("no --version given and no package.json beside the folder to read one from");
				const commit = options.commit ?? commitOf();
				if (options.sbom) writeSbom(directory, version, commit);
				const covered = coveredFiles(directory);
				if (covered.length === 0) {
					console.error(`release-proofs: no installer, archive or SBOM in ${directory}; nothing to cover`);
					process.exitCode = 2;
				} else {
					const count = writeChecksums(directory, covered);
					console.log(`release-proofs: wrote ${CHECKSUM_FILE} over ${count} file(s) for ${version} at ${commit.slice(0, 7)}`);
					for (const name of uncoveredFiles(directory)) {
						console.log(`release-proofs: ${isBesideTheRelease(name) ? "beside the release, not covered" : "NOT COVERED"}: ${name}`);
					}
					const report = verifyRelease({ directory, strict: false });
					for (const result of report.results) {
						const detail = result.detail === undefined ? "" : ` (${result.detail})`;
						console.log(`${result.status.padEnd(4)} ${result.check.padEnd(11)} ${result.file}${detail}`);
					}
					for (const warning of report.warnings) console.log(`note: ${warning}`);
					for (const skip of report.skips) console.log(`skip: ${skip}`);
					for (const failure of report.failures) console.log(`FAIL: ${failure}`);
					// The checksum layer is what this machine can prove; the signature and the attestation need credentials
					// and GitHub, and `verify-release` reports them as warn/skip rather than as passes.
					console.log(report.failures.length === 0 ? "release-proofs: the checksums verify" : "release-proofs: the checksums do not verify");
					process.exitCode = report.failures.length === 0 ? 0 : 1;
				}
			}
		}
	} catch (error) {
		console.error(`release-proofs: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
