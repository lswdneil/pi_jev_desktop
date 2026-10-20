// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The signatures the release writes, checked against the code that reads them.
 *
 * The two halves live apart on purpose: this script runs on a maintainer's machine or in CI and holds the private key,
 * while `desktop-next/src/main/update-verify.ts` runs in the app and holds the public one. Nothing in either package's
 * own tests can notice them drifting — a release could sign with key A while the build carries key B, every check
 * would pass, and the app would refuse every update in the field. So the last test here hands a signature made by the
 * script to the app's own `verifyArtifact`.
 */

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { verifyArtifact } from "../desktop-next/src/main/update-verify.ts";
import { installerFiles, loadKey, publicPem, signInstallers, signatureProblems } from "./sign-installers.mjs";

const dirs = [];
afterEach(() => {
	while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** An Ed25519 key pair in PEM, as the release secret holds it. */
function keyPair() {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
		privateKey,
	};
}

/** A `dist` folder with the installers and non-installers a real build leaves behind. */
function dist(names = ["mu-0.1.8-x64.exe", "mu-0.1.8-x64.exe.blockmap", "latest.yml", "builder-debug.yml"]) {
	const directory = mkdtempSync(join(tmpdir(), "mu-sign-"));
	dirs.push(directory);
	for (const name of names) writeFileSync(join(directory, name), randomBytes(64));
	return directory;
}

test("only the installers are signed", () => {
	const directory = dist(["mu-0.1.8-x64.exe", "mu-0.1.8-x64.exe.blockmap", "latest.yml", "mu-0.1.8-arm64.dmg", "mu-0.1.8-x64.AppImage"]);
	assert.deepEqual(installerFiles(directory), ["mu-0.1.8-arm64.dmg", "mu-0.1.8-x64.AppImage", "mu-0.1.8-x64.exe"]);
});

test("signing writes one .sig per installer and verifies what it wrote", () => {
	const keys = keyPair();
	const directory = dist();
	const written = signInstallers(directory, keys.privateKey);
	assert.deepEqual(written, ["mu-0.1.8-x64.exe"]);
	assert.deepEqual(signatureProblems(directory, keys.publicPem), []);

	const signature = readFileSync(join(directory, "mu-0.1.8-x64.exe.sig"), "utf8").trim();
	assert.equal(Buffer.from(signature, "base64").length, 64, "an Ed25519 signature is 64 bytes");
});

test("a file that changed after it was signed is caught", () => {
	const keys = keyPair();
	const directory = dist();
	signInstallers(directory, keys.privateKey);
	writeFileSync(join(directory, "mu-0.1.8-x64.exe"), randomBytes(64));
	assert.match(signatureProblems(directory, keys.publicPem).join("\n"), /its signature does not verify/);
});

test("a missing signature, an empty folder and another key are each named", () => {
	const keys = keyPair();
	const unsigned = dist();
	assert.match(signatureProblems(unsigned, keys.publicPem).join("\n"), /there is no mu-0\.1\.8-x64\.exe\.sig/);

	const empty = dist(["latest.yml"]);
	assert.match(signatureProblems(empty, keys.publicPem).join("\n"), /no installer to verify/);

	const signed = dist();
	signInstallers(signed, keys.privateKey);
	assert.match(signatureProblems(signed, keyPair().publicPem).join("\n"), /its signature does not verify/);
});

test("a key file is read as a PEM, and a missing one says so", () => {
	const keys = keyPair();
	const directory = mkdtempSync(join(tmpdir(), "mu-sign-key-"));
	dirs.push(directory);
	const path = join(directory, "mu-update-private.pem");
	writeFileSync(path, keys.privatePem);
	assert.equal(publicPem(loadKey({ keyFile: path })), keys.publicPem);
	assert.throws(() => loadKey({ keyFile: join(directory, "absent.pem") }), /does not exist/);
	assert.throws(() => loadKey({ keyPem: "  " }), /no signing key/);
});

// The whole point of the exercise: what this script writes, the app accepts. If these ever disagree, every release is
// signed with a key the build does not carry and the app refuses updates that are perfectly good.
test("the signature the release makes is the one the app verifies", () => {
	const keys = keyPair();
	const directory = dist();
	signInstallers(directory, keys.privateKey);

	const bytes = new Uint8Array(readFileSync(join(directory, "mu-0.1.8-x64.exe")));
	const signature = readFileSync(join(directory, "mu-0.1.8-x64.exe.sig"), "utf8").trim();
	const digest = digestOf(bytes);
	assert.deepEqual(verifyArtifact(bytes, digest, { signature, publicKey: keys.publicPem }), { ok: true });

	assert.deepEqual(verifyArtifact(bytes, digest, { signature, publicKey: keyPair().publicPem }), {
		ok: false,
		reason: "the signature does not match this artifact",
	});
	assert.match(
		verifyArtifact(bytes, digestOf(new Uint8Array([1, 2, 3])), { signature, publicKey: keys.publicPem }).reason,
		/does not match the feed's sha512/,
	);
});

/** The feed's digest field: base64 of the file's SHA-512, the same value electron-builder writes into `latest.yml`. */
function digestOf(bytes) {
	return createHash("sha512").update(bytes).digest("base64");
}
