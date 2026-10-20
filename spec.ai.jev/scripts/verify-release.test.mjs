import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { CHECKSUM_FILE, parseChecksums, parseVerifyArgs, SIGSTORE_BUNDLE, verifyRelease } from "./verify-release.mjs";

const dirs = [];
function release(files) {
	const directory = mkdtempSync(join(tmpdir(), "mu-release-"));
	dirs.push(directory);
	for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
	return directory;
}
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

const INSTALLER = "mu-0.1.7-x64.deb";
const INSTALLER_BYTES = "not really a deb";

/** A release directory with a SHA256SUMS that matches it. */
function goodRelease(extra = {}) {
	const sums = `${sha256(INSTALLER_BYTES)}  ${INSTALLER}\n`;
	return release({ [INSTALLER]: INSTALLER_BYTES, [CHECKSUM_FILE]: sums, ...extra });
}

/** A fake tool that answers like the real one would; `undefined` status means the command is not installed. */
function tool(status, stdout = "", stderr = "") {
	const calls = [];
	return {
		calls,
		run: (command, args) => {
			calls.push([command, ...args].join(" "));
			return { status, missing: status === undefined, stdout, stderr };
		},
	};
}

test("a release whose files match its checksums verifies", () => {
	const report = verifyRelease({ directory: goodRelease() });
	assert.deepEqual(report.failures, []);
	assert.equal(report.results[0].status, "pass");
	assert.equal(report.warnings.length, 1); // no signature yet
});

test("a file that changed is named", () => {
	const directory = goodRelease();
	writeFileSync(join(directory, INSTALLER), "tampered");
	const report = verifyRelease({ directory });
	assert.equal(report.failures.length, 1);
	assert.match(report.failures[0], new RegExp(`${INSTALLER}: its content changed`));
});

test("a file that disappeared is named", () => {
	const directory = goodRelease();
	rmSync(join(directory, INSTALLER));
	const report = verifyRelease({ directory });
	assert.match(report.failures.join("\n"), /listed in SHA256SUMS but missing/);
});

test("a missing checksum file is a failure, not an empty pass", () => {
	const directory = release({ [INSTALLER]: INSTALLER_BYTES });
	const report = verifyRelease({ directory });
	assert.match(report.failures.join("\n"), /there is no SHA256SUMS/);
});

test("an unlisted file is a warning, and a failure when the caller asks for strict", () => {
	const directory = goodRelease({ "extra.txt": "hello" });
	const loose = verifyRelease({ directory });
	assert.deepEqual(loose.failures, []);
	assert.match(loose.warnings.join("\n"), /extra\.txt: in the release but not in SHA256SUMS/);
	const strict = verifyRelease({ directory, strict: true });
	assert.match(strict.failures.join("\n"), /extra\.txt/);
});

// The layout the release job publishes: the signature cannot be listed in the file it signs, so strict mode
// must not count it as an unlisted file.
test("strict mode accepts the checksum file and its signature, and nothing else", () => {
	const directory = goodRelease({ [SIGSTORE_BUNDLE]: "{}" });
	const strict = verifyRelease({ directory, strict: true, repo: "qybaihe/mu", run: tool(0).run });
	assert.deepEqual(strict.failures, []);

	writeFileSync(join(directory, "notes.md"), "hello");
	const withNotes = verifyRelease({ directory, strict: true, repo: "qybaihe/mu", run: tool(0).run });
	assert.equal(withNotes.failures.length, 1);
	assert.match(withNotes.failures[0], /notes\.md/);
});

test("a signed release is verified with cosign, and a bad signature fails with cosign's reason", () => {
	const directory = goodRelease({ [SIGSTORE_BUNDLE]: "{}" });
	const good = tool(0);
	assert.deepEqual(verifyRelease({ directory, repo: "qybaihe/mu", run: good.run }).failures, []);
	assert.match(good.calls[0], /^cosign verify-blob --bundle=/);
	assert.match(good.calls[0], /certificate-identity-regexp=\^https:\/\/github\.com\/qybaihe\/mu\//);

	const bad = tool(1, "", "error: no matching signatures");
	const report = verifyRelease({ directory, repo: "qybaihe/mu", run: bad.run });
	assert.match(report.failures.join("\n"), /cosign rejected it: error: no matching signatures/);
});

test("a missing tool is a skip, and --require-proof turns an unsigned release into a failure", () => {
	const signed = goodRelease({ [SIGSTORE_BUNDLE]: "{}" });
	const skipped = verifyRelease({ directory: signed, repo: "qybaihe/mu", run: tool(undefined, "", "not found").run });
	assert.equal(skipped.failures.length, 0);
	assert.match(skipped.skips.join("\n"), /cosign is not installed/);
	assert.match(skipped.skips.join("\n"), /gh is not installed/);

	const required = verifyRelease({ directory: goodRelease(), repo: "qybaihe/mu", requireProof: true, run: tool(0).run });
	assert.match(required.failures.join("\n"), /no Sigstore bundle/);
});

test("build attestations are checked per file when gh is available", () => {
	const directory = goodRelease({ [SIGSTORE_BUNDLE]: "{}" });
	const passing = tool(0);
	const report = verifyRelease({ directory, repo: "qybaihe/mu", requireProof: true, run: passing.run });
	assert.deepEqual(report.failures, []);
	assert.ok(passing.calls.some((call) => call.startsWith("gh attestation verify")));

	const missing = tool(1, "", "no attestations found");
	assert.match(verifyRelease({ directory, repo: "qybaihe/mu", run: missing.run }).failures.join("\n"), /no build attestation/);
});

test("--require-proof without --repo says what it needs", () => {
	const report = verifyRelease({ directory: goodRelease(), requireProof: true, run: tool(0).run });
	assert.match(report.failures.join("\n"), /--require-proof needs --repo/);
});

test("parses sha256sum output, including the binary marker and a bad line", () => {
	assert.deepEqual(parseChecksums(`${"a".repeat(64)}  dist/mu.deb\n${"b".repeat(64)} *mu.exe\n`).entries, [
		{ hash: "a".repeat(64), file: "mu.deb" },
		{ hash: "b".repeat(64), file: "mu.exe" },
	]);
	assert.equal(parseChecksums("not a checksum\n").error, "not a checksum line: \"not a checksum\"");
});

test("reads the directory, the repo and the flags", () => {
	assert.deepEqual(parseVerifyArgs(["dist", "--repo", "qybaihe/mu", "--require-proof", "--json"]), {
		directory: "dist",
		repo: "qybaihe/mu",
		requireProof: true,
		strict: false,
		json: true,
		only: undefined,
	});
	assert.throws(() => parseVerifyArgs(["--nope"]), /unknown argument/);
	assert.throws(() => parseVerifyArgs(["a", "b"]), /one directory/);
});
