// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import { checkForUpdate, configuredFeedUrl, DEFAULT_FEED } from "../../src/main/update.ts";
import { compareVersions, decideUpdate, parseFeed, trustedFeed } from "../../src/shared/update.ts";

/**
 * The update check: a feed is read, parsed and refused unless it is newer and verifiable. Doing the network in a fake
 * fetch means every refusal — no checksum, no signature, a downgrade, an unreachable host — has a test, and the only
 * thing left unverified is the installer step (U10's signing).
 */

const FEED = [
	"version: 0.2.0",
	"files:",
	"  - url: mu-0.2.0.exe",
	"    sha512: ABCDEF==",
	"    size: 1234",
	"path: mu-0.2.0.exe",
	"sha512: ABCDEF==",
	"releaseDate: '2026-10-18T00:00:00.000Z'",
].join("\n");

const OFFICIAL = "https://github.com/lswdneil/pi_jev_desktop/releases/latest/download/latest.yml";

function fetchServing(body: string, status = 200): typeof globalThis.fetch {
	return (async () => new Response(body, { status })) as typeof globalThis.fetch;
}

describe("reading a feed", () => {
	it("reads the files block electron-builder writes", () => {
		const parsed = parseFeed(FEED);
		expect(parsed.feed).toMatchObject({
			version: "0.2.0",
			files: [{ url: "mu-0.2.0.exe", sha512: "ABCDEF==", size: 1234 }],
			path: "mu-0.2.0.exe",
		});
	});

	it("reads the older single-file form", () => {
		const parsed = parseFeed(["version: 1.2.3", "path: mu-1.2.3.dmg", "sha512: XYZ==", "size: 42"].join("\n"));
		expect(parsed.feed).toMatchObject({ version: "1.2.3", files: [{ url: "mu-1.2.3.dmg", sha512: "XYZ==", size: 42 }] });
	});

	it("refuses a feed with no version, or no verifiable artifact", () => {
		expect(parseFeed("path: x").problem).toMatch(/names no version/);
		expect(parseFeed("version: 2.0.0\npath: x").problem).toMatch(/no artifact with a sha512/);
	});
});

describe("versions", () => {
	it("compares segment by segment, numerically", () => {
		expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
		expect(compareVersions("v1.0.1", "1.0.0")).toBe(1);
		expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
		expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
	});
});

describe("deciding what to do", () => {
	const parsed = parseFeed(FEED).feed;
	if (parsed === undefined) throw new Error("the test fixture is not a feed");

	it("offers a newer, verifiable version", () => {
		expect(decideUpdate(parsed, "0.1.8")).toMatchObject({ state: "available", version: "0.2.0", current: "0.1.8" });
	});

	it("is up to date for the same or an older version, including a downgrade feed", () => {
		expect(decideUpdate(parsed, "0.2.0")).toEqual({ state: "up-to-date", current: "0.2.0" });
		expect(decideUpdate(parsed, "0.3.0")).toEqual({ state: "up-to-date", current: "0.3.0" });
	});

	it("refuses an artifact with no checksum to verify", () => {
		const unsigned = { ...parsed, files: [{ url: "x", sha512: "  ", size: undefined }] };
		expect(decideUpdate(unsigned, "0.1.8")).toMatchObject({ state: "refused" });
		expect((decideUpdate(unsigned, "0.1.8") as { reason: string }).reason).toMatch(/no sha512/);
	});

	it("refuses an unsigned feed when signatures are required", () => {
		expect(decideUpdate(parsed, "0.1.8", { requireSignature: true })).toMatchObject({ state: "refused" });
		expect(decideUpdate(parsed, "0.1.8", { requireSignature: true, signature: "sig" })).toMatchObject({ state: "available" });
	});

	it("refuses a feed with no artifact at all", () => {
		expect(decideUpdate({ ...parsed, files: [] }, "0.1.8")).toMatchObject({ state: "refused" });
	});
});

describe("which feeds may be asked", () => {
	it("publishes only over https on a release host", () => {
		expect(trustedFeed(OFFICIAL)).toEqual({ ok: true });
		expect(trustedFeed("http://github.com/x/latest.yml").ok).toBe(false);
		expect(trustedFeed("https://example.com/latest.yml").ok).toBe(false);
		expect(trustedFeed("not a url").ok).toBe(false);
	});

	it("trusts an explicitly configured feed, because setting it is a deliberate act", () => {
		expect(trustedFeed("http://127.0.0.1:8123/latest.yml", { configured: true })).toEqual({ ok: true });
		expect(trustedFeed("file:///etc/passwd", { configured: true }).ok).toBe(false);
	});
});

describe("checking", () => {
	it("reads an explicitly configured feed", async () => {
		const check = await checkForUpdate({
			currentVersion: "0.1.8",
			feedUrl: "http://127.0.0.1:8123/latest.yml",
			fetch: fetchServing(FEED),
		});
		expect(check.status).toMatchObject({ state: "available", version: "0.2.0" });
		expect(check.feedUrl).toBe("http://127.0.0.1:8123/latest.yml");
	});

	it("reports an HTTP failure instead of throwing", async () => {
		const check = await checkForUpdate({ currentVersion: "0.1.8", feedUrl: "http://127.0.0.1/x", fetch: fetchServing("nope", 503) });
		expect(check.status).toMatchObject({ state: "refused" });
		expect((check.status as { reason: string }).reason).toMatch(/answered 503/);
	});

	it("reports a network failure, and a timeout, the same way", async () => {
		const failing = (async () => {
			throw new Error("getaddrinfo ENOTFOUND");
		}) as typeof globalThis.fetch;
		const check = await checkForUpdate({ currentVersion: "0.1.8", feedUrl: "http://127.0.0.1/x", fetch: failing });
		expect((check.status as { reason: string }).reason).toMatch(/could not read the update feed: getaddrinfo ENOTFOUND/);

		const hanging = ((_url: string, init?: { signal?: AbortSignal }) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					const error = new Error("aborted");
					error.name = "AbortError";
					reject(error);
				});
			})) as unknown as typeof globalThis.fetch;
		const timedOut = await checkForUpdate({ currentVersion: "0.1.8", feedUrl: "http://127.0.0.1/x", fetch: hanging, timeoutMs: 5 });
		expect((timedOut.status as { reason: string }).reason).toMatch(/timed out/);
	});

	it("uses the packaged default unless the environment names a feed", async () => {
		expect(configuredFeedUrl({})).toBeUndefined();
		expect(configuredFeedUrl({ SPEC_AI_JEV_UPDATE_FEED: " http://127.0.0.1:1/latest.yml " })).toBe("http://127.0.0.1:1/latest.yml");
		expect(DEFAULT_FEED).toContain("github.com/lswdneil/pi_jev_desktop/releases");
	});
});
