// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import {
	APP_ORIGIN,
	appPermission,
	contentSecurityPolicy,
	developmentCsp,
	isAllowedNavigation,
	PREVIEW_PARTITION,
	previewDownload,
	previewNavigation,
	previewPermission,
	PRODUCTION_CSP,
	windowPreferences,
} from "../../src/main/security.ts";

/**
 * The security baseline, asserted rather than described.
 *
 * The old shell had no policy to copy (`{preload, webviewTag: true}` and nothing else), so these are the tests that
 * keep the next person from quietly relaxing one of the values: a CSP that loses a directive, a window that gains
 * `nodeIntegration`, or a preview that gains a permission all fail here.
 */

describe("the production policy", () => {
	it("denies everything by default and allows only what the app itself serves", () => {
		expect(PRODUCTION_CSP).toMatch(/^default-src 'none'/);
		expect(PRODUCTION_CSP).toContain("script-src 'self'");
		expect(PRODUCTION_CSP).toContain("object-src 'none'");
		expect(PRODUCTION_CSP).toContain("frame-ancestors 'none'");
		// No eval, no inline script, no remote origin.
		expect(PRODUCTION_CSP).not.toMatch(/unsafe-eval/);
		expect(PRODUCTION_CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
		expect(PRODUCTION_CSP).not.toMatch(/https?:\/\//);
	});

	it("is what the app sends when it is not in development", () => {
		expect(contentSecurityPolicy({ development: false })).toBe(PRODUCTION_CSP);
	});

	it("relaxes exactly the Vite HMR origin in development, and only there", () => {
		const dev = developmentCsp("http://localhost:5173");
		expect(dev).toContain("http://localhost:5173");
		expect(dev).toContain("ws://localhost:5173");
		expect(dev).not.toBe(PRODUCTION_CSP);
		expect(contentSecurityPolicy({ development: true, devServerOrigin: "http://localhost:5173" })).toBe(dev);
	});
});

describe("the window", () => {
	it("isolates the renderer and denies it Node, whatever the page asks", () => {
		expect(windowPreferences("/app/preload/main.js")).toEqual({
			preload: "/app/preload/main.js",
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			nodeIntegrationInWorker: false,
			webviewTag: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			experimentalFeatures: false,
		});
	});

	it("serves the app from its own origin, never from file://", () => {
		expect(APP_ORIGIN).toBe("app://mu");
		expect(isAllowedNavigation("app://mu/index.html")).toBe(true);
		expect(isAllowedNavigation("file:///etc/passwd")).toBe(false);
		expect(isAllowedNavigation("https://example.com")).toBe(false);
	});
});

describe("the preview session", () => {
	it("keeps its own partition, so a previewed page shares nothing with the app", () => {
		expect(PREVIEW_PARTITION).toBe("preview");
	});

	it("grants no permission and no download", () => {
		expect(previewPermission("media")).toEqual({ allow: false, reason: "a previewed page gets no permissions" });
		expect(previewDownload()).toEqual({ allow: false, reason: "a previewed page may not download files" });
	});

	it("navigates to http(s) only", () => {
		expect(previewNavigation("https://example.com/a").allow).toBe(true);
		expect(previewNavigation("http://127.0.0.1:3000/").allow).toBe(true);
		expect(previewNavigation("file:///etc/passwd").allow).toBe(false);
		expect(previewNavigation("javascript:alert(1)").allow).toBe(false);
		expect(previewNavigation("data:text/html,<script>1</script>").allow).toBe(false);
	});
});

describe("the app's own page", () => {
	// Electron grants a permission request when a session has no handler, so this is the difference between "the page
	// happens to ask for nothing" and "the page cannot get anything". The list is the one Electron documents for
	// `setPermissionCheckHandler`, minus the ones that are only meaningful to a preview.
	it("is granted no permission at all", () => {
		const permissions = [
			"media",
			"geolocation",
			"notifications",
			"clipboard-read",
			"display-capture",
			"midi",
			"midiSysex",
			"openExternal",
			"pointerLock",
			"serial",
			"usb",
			"hid",
			"fileSystem",
			"fullscreen",
			"idle-detection",
			"keyboardLock",
			"screen-wake-lock",
			"speaker-selection",
			"storage-access",
			"payment-handler",
			"unknown",
		];
		for (const permission of permissions) {
			const decision = appPermission(permission);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain(permission);
		}
	});
});
