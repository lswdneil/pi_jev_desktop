// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The proof set for a release folder. The build is what it is; this is about the files that let someone else check it:
 * which ones the checksum file covers, that the file parses, and that the verifier a downloader runs accepts the result.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { coveredFiles, uncoveredFiles, writeChecksums, parseReleaseProofArgs } from "./release-proofs.mjs";
import { verifyRelease } from "./verify-release.mjs";

function folder(files) {
	const directory = mkdtempSync(join(tmpdir(), "mu-proofs-"));
	for (const [name, content] of Object.entries(files)) {
		const path = join(directory, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
	return directory;
}

test("covers the installers, a source archive and the SBOM, and nothing the app reads beside them", () => {
	const directory = folder({
		"mu-0.1.8-x64.exe": "installer",
		"mu-0.1.8-arm64.dmg": "image",
		"mu-0.1.8.AppImage": "appimage",
		"mu-0.1.8.deb": "package",
		"mu-0.1.8-source.tar.gz": "source",
		"sbom.cdx.json": "{}",
		"latest.yml": "version: 0.1.8",
		"latest.yml.sig": "signature",
		"mu-0.1.8-x64.exe.blockmap": "blockmap",
		"SHA256SUMS": "stale",
		"SHA256SUMS.sigstore.json": "{}",
	});
	try {
		assert.deepEqual(coveredFiles(directory), [
			"mu-0.1.8-arm64.dmg",
			"mu-0.1.8-source.tar.gz",
			"mu-0.1.8-x64.exe",
			"mu-0.1.8.AppImage",
			"mu-0.1.8.deb",
			"sbom.cdx.json",
		]);
		// The update feed and its companions are listed separately: the release notes say they are outside the checksums.
		assert.deepEqual(uncoveredFiles(directory), ["latest.yml", "latest.yml.sig", "mu-0.1.8-x64.exe.blockmap"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("a written checksum file is the one a downloader's verifier accepts", () => {
	const directory = folder({ "mu-0.1.8-x64.exe": "installer bytes", "sbom.cdx.json": "{}", "latest.yml": "version: 0.1.8" });
	try {
		assert.equal(writeChecksums(directory, coveredFiles(directory)), 2);
		const text = readFileSync(join(directory, "SHA256SUMS"), "utf8");
		assert.match(text, /^[0-9a-f]{64} {2}mu-0\.1\.8-x64\.exe\n[0-9a-f]{64} {2}sbom\.cdx\.json\n$/);

		const report = verifyRelease({ directory, strict: false });
		assert.deepEqual(report.failures, []);
		const checksums = report.results.filter((result) => result.check === "checksum");
		assert.equal(checksums.length, 2);
		assert.ok(checksums.every((result) => result.status === "pass"));
		// The feed is beside the release, so it is a warning (what the release notes tell a downloader), not a failure.
		assert.match(report.warnings.join("\n"), /latest\.yml: in the release but not in SHA256SUMS/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("a file that changes after the checksums are written fails the verification", () => {
	const directory = folder({ "mu-0.1.8-x64.exe": "installer bytes" });
	try {
		writeChecksums(directory, coveredFiles(directory));
		writeFileSync(join(directory, "mu-0.1.8-x64.exe"), "installer bytes, tampered");
		const report = verifyRelease({ directory, strict: false });
		assert.equal(report.failures.length, 1);
		assert.match(report.failures[0], /its content changed/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("an empty folder covers nothing, and a dry run says so without writing", () => {
	const directory = folder({ "latest.yml": "version: 0.1.8" });
	try {
		assert.deepEqual(coveredFiles(directory), []);
		assert.deepEqual(coveredFiles(join(directory, "missing")), []);
		assert.deepEqual(uncoveredFiles(join(directory, "missing")), []);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("reads the arguments", () => {
	assert.deepEqual(parseReleaseProofArgs([]), {
		directory: join("desktop-next", "dist"),
		version: undefined,
		commit: undefined,
		sbom: true,
		dryRun: false,
	});
	assert.deepEqual(parseReleaseProofArgs(["out", "--version", "0.1.8", "--commit", "abc", "--no-sbom", "--dry-run"]), {
		directory: "out",
		version: "0.1.8",
		commit: "abc",
		sbom: false,
		dryRun: true,
	});
	assert.throws(() => parseReleaseProofArgs(["a", "b"]), /one folder/);
	assert.throws(() => parseReleaseProofArgs(["--nope"]), /unknown argument/);
});
