// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Proving an update is the update, before anything runs it.
 *
 * Two checks, both mandatory: the file's SHA-512 matches what the feed said, and a detached Ed25519 signature over the
 * file verifies against the public key this build carries. A build with no public key configured cannot verify, and
 * therefore does not install — "unsigned, so not installed" is the only safe reading of a key that is not there.
 *
 * The key is a constant rather than a setting on purpose: an update mechanism whose trust anchor the user can edit is
 * one a compromised settings screen can point at itself.
 */

import { createHash, verify } from "node:crypto";

declare const __SPEC_UPDATE_PUBLIC_KEY__: string;

/**
 * The release signing key (Ed25519, PEM), compiled in by the build from `SPEC_UPDATE_PUBLIC_KEY`.
 *
 * Empty when the release job has not set one: the app then reports updates and refuses to install them, which is the
 * only safe reading of "no trust anchor". The value is a build input rather than a setting or a run-time variable on
 * purpose — neither the settings screen nor the environment of the user's session can move it.
 */
export const UPDATE_PUBLIC_KEY = (typeof __SPEC_UPDATE_PUBLIC_KEY__ === "string" ? __SPEC_UPDATE_PUBLIC_KEY__ : "").trim();

/** The digest the feed lists: base64 of the file's SHA-512, as electron-builder writes it. */
export function sha512Base64(bytes: Uint8Array): string {
	return createHash("sha512").update(bytes).digest("base64");
}

export type VerifyResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Whether the bytes are what the feed promised. A mismatch is a corrupted or swapped download, never a warning. */
export function verifyDigest(bytes: Uint8Array, expected: string): VerifyResult {
	if (expected.trim() === "") return { ok: false, reason: "the feed lists no sha512, so this download cannot be verified" };
	const actual = sha512Base64(bytes);
	if (actual !== expected.trim()) return { ok: false, reason: "the download does not match the feed's sha512" };
	return { ok: true };
}

/**
 * Whether the detached signature is this public key's signature over the bytes. Ed25519 signs the bytes themselves, so
 * there is no hash parameter to get wrong; a signature is base64, one per artifact, beside it on the release.
 */
export function verifySignature(bytes: Uint8Array, signatureBase64: string, publicKeyPem: string): VerifyResult {
	if (publicKeyPem.trim() === "") return { ok: false, reason: "this build carries no update public key, so it cannot verify a signature" };
	if (signatureBase64.trim() === "") return { ok: false, reason: "the release has no signature for this artifact" };
	let signature: Buffer;
	try {
		signature = Buffer.from(signatureBase64.trim(), "base64");
	} catch {
		return { ok: false, reason: "the signature is not base64" };
	}
	try {
		const valid = verify(null, Buffer.from(bytes), publicKeyPem, signature);
		return valid ? { ok: true } : { ok: false, reason: "the signature does not match this artifact" };
	} catch (error) {
		return { ok: false, reason: `the signature could not be checked: ${error instanceof Error ? error.message : String(error)}` };
	}
}

/** Both checks, in the order that fails fastest: the digest is local arithmetic, the signature is the real gate. */
export function verifyArtifact(
	bytes: Uint8Array,
	expectedDigest: string,
	options: { readonly signature?: string; readonly publicKey?: string } = {},
): VerifyResult {
	const digest = verifyDigest(bytes, expectedDigest);
	if (!digest.ok) return digest;
	return verifySignature(bytes, options.signature ?? "", options.publicKey ?? UPDATE_PUBLIC_KEY);
}
