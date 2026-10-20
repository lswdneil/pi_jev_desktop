// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Updates: what a feed has to say before anything is downloaded, and when a build may install it.
 *
 * The shell never trusts a version string alone. A feed is a small YAML-ish document that electron-builder writes
 * beside the artifacts (`latest.yml`, `latest-mac.yml`): a version, a file name, its SHA-512 and its size. This module
 * parses that, compares versions, and refuses anything that cannot be verified — a feed without a checksum, a version
 * that is not newer, a feed from a host this build does not publish on. Installing is a separate step (signature
 * verification is U10's job); until then the shell can *tell* someone an update exists and refuse to pretend it
 * installed one.
 *
 * All of it is pure: the network lives in `main/update.ts`, so every refusal has a test without one.
 */

/** One artifact a feed offers. `sha512` is required: without it there is nothing to verify after the download. */
export interface FeedFile {
	readonly url: string;
	readonly sha512: string;
	readonly size: number | undefined;
}

export interface UpdateFeed {
	readonly version: string;
	readonly files: readonly FeedFile[];
	readonly releaseDate: string | undefined;
	readonly path: string | undefined;
}

/** What a check found, as the screen shows it: the status, and the feed that was read. */
export interface UpdateCheck {
	readonly status: UpdateStatus;
	readonly feedUrl: string;
}

/** What downloading, proving and starting an installer ended as. */
export type UpdateInstallOutcome =
	| { readonly state: "installed"; readonly file: string }
	| { readonly state: "refused"; readonly reason: string };

export type UpdateStatus =
	| { readonly state: "up-to-date"; readonly current: string }
	| {
			readonly state: "available";
			readonly current: string;
			readonly version: string;
			readonly file: FeedFile;
			readonly releaseDate: string | undefined;
	  }
	| { readonly state: "refused"; readonly reason: string };
export interface FeedParseResult {
	readonly feed?: UpdateFeed;
	readonly problem?: string;
}

function scalar(text: string, key: string): string | undefined {
	// electron-builder writes `key: value` lines; a value may be quoted. Files are a nested list, handled separately.
	const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text);
	if (match === null) return undefined;
	const value = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
	return value === "" ? undefined : value;
}

/** The `files:` block: `- url: …` followed by `sha512:` and `size:` lines at the same indent. */
function files(text: string): FeedFile[] {
	const block = /^files:\s*\n((?:[ \t]+.*\n?)*)/m.exec(text);
	if (block === null) return [];
	const entries: FeedFile[] = [];
	let current: { url: string; sha512: string | undefined; size: number | undefined } | undefined;
	for (const line of (block[1] ?? "").split("\n")) {
		const url = /^\s*-\s*url:\s*(.+)$/.exec(line);
		if (url !== null) {
			if (current !== undefined && current.sha512 !== undefined) entries.push(finish({ ...current, sha512: current.sha512 }));
			current = { url: (url[1] ?? "").trim().replace(/^["']|["']$/g, ""), sha512: undefined, size: undefined };
			continue;
		}
		if (current === undefined) continue;
		const sha = /^\s+sha512:\s*(.+)$/.exec(line);
		if (sha !== null) current.sha512 = (sha[1] ?? "").trim();
		const size = /^\s+size:\s*(\d+)\s*$/.exec(line);
		if (size !== null) current.size = Number(size[1]);
	}
	if (current !== undefined && current.sha512 !== undefined) entries.push(finish({ ...current, sha512: current.sha512 }));
	return entries;
}

function finish(entry: { url: string; sha512: string; size: number | undefined }): FeedFile {
	return { url: entry.url, sha512: entry.sha512, size: entry.size };
}

/**
 * Read a feed. A single-file feed (no `files:` block) uses the top-level `path`/`sha512`, which is how electron-builder
 * writes the older format; both arrive as the same shape here.
 */
export function parseFeed(text: string): FeedParseResult {
	const version = scalar(text, "version");
	if (version === undefined) return { problem: "the feed names no version" };
	const listed = files(text);
	if (listed.length > 0) {
		return { feed: { version, files: listed, releaseDate: scalar(text, "releaseDate"), path: scalar(text, "path") } };
	}
	const path = scalar(text, "path");
	const sha512 = scalar(text, "sha512");
	if (path === undefined || sha512 === undefined) return { problem: "the feed names no artifact with a sha512" };
	const size = scalar(text, "size");
	return {
		feed: {
			version,
			files: [{ url: path, sha512, size: size === undefined ? undefined : Number(size) }],
			releaseDate: scalar(text, "releaseDate"),
			path,
		},
	};
}

/** `1.2.3`, with an optional `-prerelease` tail. Numeric comparison, segment by segment; a prerelease sorts first. */
export function compareVersions(left: string, right: string): number {
	const [leftCore, leftTail] = splitVersion(left);
	const [rightCore, rightTail] = splitVersion(right);
	for (let index = 0; index < Math.max(leftCore.length, rightCore.length); index++) {
		const a = leftCore[index] ?? 0;
		const b = rightCore[index] ?? 0;
		if (a !== b) return a < b ? -1 : 1;
	}
	if (leftTail === rightTail) return 0;
	if (leftTail === undefined) return 1;
	if (rightTail === undefined) return -1;
	return leftTail < rightTail ? -1 : 1;
}

function splitVersion(version: string): [number[], string | undefined] {
	const trimmed = version.trim().replace(/^v/, "");
	const [core, ...tail] = trimmed.split("-");
	return [(core ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0), tail.length === 0 ? undefined : tail.join("-")];
}

/** The artifact's absolute URL: a feed lists a bare file name beside itself. */
export function artifactUrl(feedUrl: string, fileUrl: string): string {
	try {
		return new URL(fileUrl, feedUrl).toString();
	} catch {
		return fileUrl;
	}
}

/** The hosts a build may take an update from; anything else is refused before a request is made. */
export const UPDATE_HOSTS = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

/**
 * Whether a feed URL is one this build is willing to ask. The published feed must be https on a release host: an
 * update over plain HTTP, or from somewhere else, is a downgrade dressed as a version.
 *
 * An explicitly configured feed (`MU_UPDATE_FEED`, a test's localhost server) is trusted for its host and scheme
 * because setting it is a deliberate act by whoever runs the build — the URL is not something a server can talk the
 * app into.
 */
export function trustedFeed(
	url: string,
	options: { readonly hosts?: readonly string[]; readonly configured?: boolean } = {},
): { ok: boolean; reason?: string } {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { ok: false, reason: `"${url}" is not a URL` };
	}
	if (options.configured === true) {
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return { ok: false, reason: `"${url}" is not http or https` };
		}
		return { ok: true };
	}
	if (parsed.protocol !== "https:") return { ok: false, reason: `"${url}" is not https` };
	const hosts = options.hosts ?? UPDATE_HOSTS;
	if (!hosts.includes(parsed.hostname)) return { ok: false, reason: `"${parsed.hostname}" is not a host this build updates from` };
	return { ok: true };
}

/**
 * What to do with a feed: install nothing unless it is newer and verifiable. The refusal is a sentence a person can
 * read, because "update failed" with no reason is how a release gets stuck.
 */
export function decideUpdate(
	feed: UpdateFeed,
	currentVersion: string,
	options: { readonly requireSignature?: boolean; readonly signature?: string } = {},
): UpdateStatus {
	if (compareVersions(feed.version, currentVersion) <= 0) return { state: "up-to-date", current: currentVersion };
	const file = feed.files[0];
	if (file === undefined) return { state: "refused", reason: "the feed lists no artifact" };
	if (file.sha512.trim() === "") return { state: "refused", reason: `the ${feed.version} feed has no sha512 to verify` };
	if (options.requireSignature === true && (options.signature ?? "").trim() === "") {
		return { state: "refused", reason: `the ${feed.version} feed is not signed` };
	}
	return {
		state: "available",
		current: currentVersion,
		version: feed.version,
		file,
		releaseDate: feed.releaseDate,
	};
}
