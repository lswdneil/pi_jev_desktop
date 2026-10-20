// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppRequest } from "../../src/main/app-protocol.ts";

/**
 * What `app://spec/...` resolves to, including everything it must refuse. The traversal cases are the reason this is a
 * pure function: they are the ones worth testing, and testing them does not need a window.
 */

const RENDERER_ROOT = "/work/pi_jev_desktop/out/renderer";

describe("serving the build", () => {
	it("serves the page at the root", () => {
		expect(resolveAppRequest("app://spec/", RENDERER_ROOT, "linux")).toEqual({
			kind: "file",
			file: posix.join(RENDERER_ROOT, "index.html"),
			contentType: "text/html; charset=utf-8",
		});
	});

	it("serves the page by name, and its assets by their type", () => {
		expect(resolveAppRequest("app://spec/index.html", RENDERER_ROOT, "linux")).toMatchObject({
			kind: "file",
			file: posix.join(RENDERER_ROOT, "index.html"),
		});
		expect(resolveAppRequest("app://spec/assets/index-4f2a.js", RENDERER_ROOT, "linux")).toEqual({
			kind: "file",
			file: posix.join(RENDERER_ROOT, "assets", "index-4f2a.js"),
			contentType: "text/javascript; charset=utf-8",
		});
		expect(resolveAppRequest("app://spec/assets/index.css", RENDERER_ROOT, "linux")).toMatchObject({
			contentType: "text/css; charset=utf-8",
		});
		expect(resolveAppRequest("app://spec/assets/font.woff2", RENDERER_ROOT, "linux")).toMatchObject({
			contentType: "font/woff2",
		});
	});

	it("ignores the query and the fragment", () => {
		expect(resolveAppRequest("app://spec/index.html?cache=0#top", RENDERER_ROOT, "linux")).toMatchObject({
			kind: "file",
			file: posix.join(RENDERER_ROOT, "index.html"),
		});
	});

	it("serves from a Windows build folder with Windows separators", () => {
		const root = "C:\\work\\pi_jev_desktop\\out\\renderer";
		expect(resolveAppRequest("app://spec/assets/index.js", root, "win32")).toEqual({
			kind: "file",
			file: win32.join(root, "assets", "index.js"),
			contentType: "text/javascript; charset=utf-8",
		});
	});

	it("serves what it does not know as bytes, rather than guessing", () => {
		expect(resolveAppRequest("app://spec/LICENSE.txt", RENDERER_ROOT, "linux")).toMatchObject({
			contentType: "text/plain; charset=utf-8",
		});
	});
});

describe("what it refuses", () => {
	it("refuses another host", () => {
		expect(resolveAppRequest("app://elsewhere/index.html", RENDERER_ROOT, "linux")).toMatchObject({
			kind: "refused",
			status: 400,
		});
	});

	it("refuses another scheme, including file://", () => {
		for (const url of ["file:///etc/passwd", "https://example.com/index.html", "app-evil://mu/index.html"]) {
			expect(resolveAppRequest(url, RENDERER_ROOT, "linux")).toMatchObject({ kind: "refused", status: 400 });
		}
	});

	it("refuses an encoded separator, which the URL parser leaves alone", () => {
		for (const url of ["app://spec/a/../%2e%2e%2f%2e%2e%2fetc/passwd", "app://spec/assets/app.js%5c..%5cwin.ini"]) {
			expect(resolveAppRequest(url, RENDERER_ROOT, "linux")).toMatchObject({ kind: "refused", status: 403 });
		}
	});

	it("cannot climb out through %2e%2e: the URL parser collapses it before we see the path", () => {
		// Normalisation happens in the URL parser, so what reaches us is already inside the build. It is asserted here
		// rather than assumed: if that ever changed, this test would fail instead of the file being served.
		expect(resolveAppRequest("app://spec/%2e%2e/%2e%2e/etc/passwd", RENDERER_ROOT, "linux")).toMatchObject({
			kind: "file",
			file: posix.join(RENDERER_ROOT, "etc", "passwd"),
		});
	});

	it("refuses a Windows drive or an alternate data stream in the path", () => {
		const root = "C:\\work\\pi_jev_desktop\\out\\renderer";
		expect(resolveAppRequest("app://spec/C:/Windows/win.ini", root, "win32")).toMatchObject({ kind: "refused", status: 403 });
		expect(resolveAppRequest("app://spec/assets/app.js%3Astream", root, "win32")).toMatchObject({
			kind: "refused",
			status: 403,
		});
	});

	it("refuses a null byte and broken encoding", () => {
		expect(resolveAppRequest("app://spec/index%00.html", RENDERER_ROOT, "linux")).toMatchObject({
			kind: "refused",
			status: 400,
		});
		expect(resolveAppRequest("app://spec/%E0%A4%A", RENDERER_ROOT, "linux")).toMatchObject({ kind: "refused", status: 400 });
	});

	it("refuses something that is not a URL at all", () => {
		expect(resolveAppRequest("not a url", RENDERER_ROOT, "linux")).toMatchObject({ kind: "refused", status: 400 });
	});
});
