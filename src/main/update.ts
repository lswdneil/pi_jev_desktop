// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Asking for an update, once, over the network.
 *
 * The network is here and nowhere else: `shared/update.ts` parses and decides, this file fetches. `SPEC_AI_JEV_UPDATE_FEED`
 * overrides the URL (a test serves a feed on localhost; a developer points at a staging release), and a build with no
 * feed configured reports that instead of guessing one — an update check that invents a URL is an update check that
 * phones somewhere unexpected.
 */

import { decideUpdate, type UpdateCheck, parseFeed, trustedFeed } from "../shared/update.ts";

/** Where the packaged app asks. The repository is the release host; a fork sets its own in the build. */
export const DEFAULT_FEED = "https://github.com/lswdneil/pi_jev_desktop/releases/latest/download/latest.yml";

export interface UpdateCheckOptions {
	readonly currentVersion: string;
	/** An explicitly configured feed: a test's local server, or a staging release. Trusted for its host. */
	readonly feedUrl?: string;
	readonly fetch?: typeof globalThis.fetch;
	readonly requireSignature?: boolean;
	readonly signature?: string;
	readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** The feed URL this build uses: the environment's override, else the packaged default. */
export function configuredFeedUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
	const override = env.SPEC_AI_JEV_UPDATE_FEED?.trim();
	return override !== undefined && override !== "" ? override : undefined;
}

/**
 * Check the feed and say what should happen. Every failure is a status with a sentence, never a thrown error: an
 * update check that crashes the settings screen is worse than one that says it could not reach the server.
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheck> {
	const configured = options.feedUrl ?? configuredFeedUrl();
	const url = configured ?? DEFAULT_FEED;
	const trust = trustedFeed(url, configured === undefined ? {} : { configured: true });
	if (!trust.ok) return { status: { state: "refused", reason: trust.reason ?? "untrusted feed" }, feedUrl: url };

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let text: string;
	try {
		const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "text/yaml, text/plain" } });
		if (!response.ok) {
			return { status: { state: "refused", reason: `the update feed answered ${response.status}` }, feedUrl: url };
		}
		text = await response.text();
	} catch (error) {
		const reason = error instanceof Error && error.name === "AbortError" ? "the update check timed out" : describe(error);
		return { status: { state: "refused", reason: `could not read the update feed: ${reason}` }, feedUrl: url };
	} finally {
		clearTimeout(timer);
	}

	const parsed = parseFeed(text);
	if (parsed.feed === undefined) return { status: { state: "refused", reason: parsed.problem ?? "the feed is unreadable" }, feedUrl: url };
	return {
		status: decideUpdate(parsed.feed, options.currentVersion, {
			...(options.requireSignature === true ? { requireSignature: true, signature: options.signature ?? "" } : {}),
		}),
		feedUrl: url,
	};
}

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
