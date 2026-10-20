// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Installing an update: download, prove, then run — in that order, and never the other way round.
 *
 * The launch is injected so the whole pipeline is testable without running an installer: a test records what would
 * have been launched and fails if anything was launched before both checks passed. `main/update-launcher.ts` is the
 * only place that knows how to start a file on this machine.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { trustedFeed, type FeedFile } from "../shared/update.ts";
import { verifyArtifact, type VerifyResult } from "./update-verify.ts";

export type InstallOutcome =
	| { readonly state: "installed"; readonly file: string }
	| { readonly state: "refused"; readonly reason: string };

export interface InstallOptions {
	readonly url: string;
	readonly file: FeedFile;
	/** The detached signature, when the caller already has it; otherwise it is fetched from `<url>.sig`. */
	readonly signature?: string;
	readonly publicKey?: string;
	readonly fetch?: typeof globalThis.fetch;
	/** Started only after both checks pass. */
	readonly launch: (file: string) => Promise<void>;
	readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** Where the artifact's detached signature lives: beside it, which is what the release pipeline uploads. */
export function signatureUrlFor(url: string): string {
	return `${url}.sig`;
}

/**
 * Download an artifact, verify it, and only then launch it. Every refusal is a sentence: the screen shows it and the
 * running build stays usable, which is the property that makes refusing safe.
 */
export async function installUpdate(options: InstallOptions): Promise<InstallOutcome> {
	// A signature this build can check is the point of the exercise; without a key there is nothing to check, and an
	// unverifiable update is not installed.
	if ((options.publicKey ?? "").trim() === "") {
		return { state: "refused", reason: "this build carries no update public key, so it will not install an update" };
	}
	const trust = trustedFeed(options.url, { configured: true });
	if (!trust.ok) return { state: "refused", reason: trust.reason ?? "untrusted artifact URL" };

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const directory = await mkdtemp(join(tmpdir(), "mu-update-"));
	const destination = join(directory, basename(new URL(options.url).pathname) || "update.bin");
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		let bytes: Uint8Array;
		let signature = options.signature;
		try {
			const response = await fetchImpl(options.url, { signal: controller.signal });
			if (!response.ok) return { state: "refused", reason: `the download answered ${response.status}` };
			bytes = new Uint8Array(await response.arrayBuffer());
			if (signature === undefined) {
				const signatureResponse = await fetchImpl(signatureUrlFor(options.url), { signal: controller.signal });
				if (signatureResponse.ok) signature = (await signatureResponse.text()).trim();
			}
		} catch (error) {
			const reason = error instanceof Error && error.name === "AbortError" ? "the download timed out" : String(error);
			return { state: "refused", reason: `could not download the update: ${reason}` };
		} finally {
			clearTimeout(timer);
		}

		const verified: VerifyResult = verifyArtifact(bytes, options.file.sha512, {
			...(signature === undefined ? {} : { signature }),
			publicKey: options.publicKey ?? "",
		});
		if (!verified.ok) return { state: "refused", reason: verified.reason };

		await writeFile(destination, bytes);
		try {
			await options.launch(destination);
		} catch (error) {
			return { state: "refused", reason: `the update could not be started: ${error instanceof Error ? error.message : String(error)}` };
		}
		return { state: "installed", file: destination };
	} finally {
		// The launcher has been awaited; nothing holds the downloaded file open.
		await rm(directory, { recursive: true, force: true }).catch(() => {});
	}
}
