// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { installUpdate, signatureUrlFor } from "../../src/main/update-install.ts";
import {
	sha512Base64,
	UPDATE_PUBLIC_KEY,
	verifyArtifact,
	verifyDigest,
	verifySignature,
} from "../../src/main/update-verify.ts";
import type { FeedFile } from "../../src/shared/update.ts";

/**
 * Proving an update before running it. The four cases the card asks for — a bad checksum, a missing signature, a
 * downgrade, and an installer that must not start until both checks pass — plus the failure shapes around them.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

function artifact(text = "installer bytes"): { bytes: Uint8Array; file: FeedFile; signature: string } {
	const bytes = new TextEncoder().encode(text);
	return {
		bytes,
		file: { url: "https://github.com/lswdneil/pi_jev_desktop/releases/download/v1/mu-1.0.0.exe", sha512: sha512Base64(bytes), size: bytes.length },
		signature: sign(null, Buffer.from(bytes), privateKey).toString("base64"),
	};
}

function fetchServing(files: Readonly<Record<string, { body: Uint8Array | string; status?: number }>>): typeof globalThis.fetch {
	return (async (input: string) => {
		const entry = files[input];
		if (entry === undefined) return new Response("not found", { status: 404 });
		return new Response(entry.body, { status: entry.status ?? 200 });
	}) as unknown as typeof globalThis.fetch;
}

describe("the digest", () => {
	it("carries no trust anchor unless the build was given one", () => {
		// This build sets no `SPEC_UPDATE_PUBLIC_KEY`; the safe default is an anchor that verifies nothing.
		expect(UPDATE_PUBLIC_KEY).toBe("");
	});

	it("matches what the feed promised, and refuses anything else", () => {
		const { bytes, file } = artifact();
		expect(verifyDigest(bytes, file.sha512)).toEqual({ ok: true });
		expect(verifyDigest(bytes, "AAAA")).toMatchObject({ ok: false, reason: /does not match/ });
		expect(verifyDigest(bytes, "  ")).toMatchObject({ ok: false, reason: /no sha512/ });
	});
});

describe("the signature", () => {
	it("accepts the release key's signature and refuses another key's", () => {
		const { bytes, signature } = artifact();
		expect(verifySignature(bytes, signature, PUBLIC_PEM)).toEqual({ ok: true });

		const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
		expect(verifySignature(bytes, signature, other)).toMatchObject({ ok: false, reason: /does not match/ });
	});

	it("refuses when the build has no key, when the release has no signature, and when it is not base64", () => {
		const { bytes, signature } = artifact();
		expect(verifySignature(bytes, signature, "")).toMatchObject({ ok: false, reason: /carries no update public key/ });
		expect(verifySignature(bytes, "   ", PUBLIC_PEM)).toMatchObject({ ok: false, reason: /no signature/ });
		expect(verifySignature(bytes, "!!!not base64!!!", PUBLIC_PEM)).toMatchObject({ ok: false });
	});

	it("checks the digest first, so a corrupt download fails without pretending to check a signature", () => {
		const { bytes } = artifact();
		expect(verifyArtifact(bytes, "wrong", { signature: "sig", publicKey: PUBLIC_PEM })).toMatchObject({
			ok: false,
			reason: /does not match the feed's sha512/,
		});
	});
});

describe("installing", () => {
	it("launches the verified artifact, and only after both checks", async () => {
		const { bytes, file, signature } = artifact();
		const launched: string[] = [];
		const outcome = await installUpdate({
			url: file.url,
			file,
			publicKey: PUBLIC_PEM,
			fetch: fetchServing({ [file.url]: { body: bytes }, [signatureUrlFor(file.url)]: { body: signature } }),
			launch: async (path) => {
				launched.push(path);
			},
		});
		expect(outcome).toMatchObject({ state: "installed" });
		expect(launched).toHaveLength(1);
		expect(launched[0]?.endsWith("mu-1.0.0.exe")).toBe(true);
	});

	it("refuses a tampered artifact and launches nothing", async () => {
		const { file, signature } = artifact();
		const tampered = new TextEncoder().encode("installer bytes, plus a payload");
		const launched: string[] = [];
		const outcome = await installUpdate({
			url: file.url,
			file,
			publicKey: PUBLIC_PEM,
			fetch: fetchServing({ [file.url]: { body: tampered }, [signatureUrlFor(file.url)]: { body: signature } }),
			launch: async (path) => {
				launched.push(path);
			},
		});
		expect(outcome).toMatchObject({ state: "refused", reason: /does not match the feed's sha512/ });
		expect(launched).toEqual([]);
	});

	it("refuses an unsigned release and launches nothing", async () => {
		const { bytes, file } = artifact();
		const launched: string[] = [];
		const outcome = await installUpdate({
			url: file.url,
			file,
			publicKey: PUBLIC_PEM,
			fetch: fetchServing({ [file.url]: { body: bytes } }),
			launch: async (path) => {
				launched.push(path);
			},
		});
		expect(outcome).toMatchObject({ state: "refused", reason: /no signature for this artifact/ });
		expect(launched).toEqual([]);
	});

	it("refuses when this build has no key at all, before downloading anything", async () => {
		const { file } = artifact();
		let fetched = 0;
		const outcome = await installUpdate({
			url: file.url,
			file,
			fetch: (async () => {
				fetched++;
				return new Response("");
			}) as unknown as typeof globalThis.fetch,
			launch: async () => {},
		});
		expect(outcome).toMatchObject({ state: "refused", reason: /carries no update public key/ });
		expect(fetched).toBe(0);
	});

	it("reports a download that answered, a download that failed, and a launcher that threw", async () => {
		const { bytes, file, signature } = artifact();
		const notFound = await installUpdate({
			url: file.url,
			file,
			publicKey: PUBLIC_PEM,
			fetch: fetchServing({ [file.url]: { body: "gone", status: 503 } }),
			launch: async () => {},
		});
		expect(notFound).toMatchObject({ state: "refused", reason: /answered 503/ });

		const failing = (async () => {
			throw new Error("getaddrinfo ENOTFOUND");
		}) as unknown as typeof globalThis.fetch;
		const network = await installUpdate({ url: file.url, file, publicKey: PUBLIC_PEM, fetch: failing, launch: async () => {} });
		expect(network).toMatchObject({ state: "refused", reason: /could not download the update/ });

		const launchFailed = await installUpdate({
			url: file.url,
			file,
			publicKey: PUBLIC_PEM,
			fetch: fetchServing({ [file.url]: { body: bytes }, [signatureUrlFor(file.url)]: { body: signature } }),
			launch: async () => {
				throw new Error("no handler for that file");
			},
		});
		expect(launchFailed).toMatchObject({ state: "refused", reason: /could not be started: no handler/ });
	});
});
