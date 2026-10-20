// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The security baseline of the shell, written down rather than inherited.
 *
 * The old shell (`desktop/packages/desktop/src/index.ts`) set the window up with `{preload, webviewTag: true}` and
 * no Content-Security-Policy at all; there was nothing to copy. Every value here is therefore explicit and has a
 * test: the policy strings, the window preferences, and what a page is allowed to do in the preview session.
 *
 * The policy is applied by the `app` protocol handler (see `index.ts`), not by `webRequest`: one place sets the
 * headers of every document the app serves, so a page cannot be loaded without them.
 */

/** What the renderer may load, in production. No inline script, no eval, no remote anything. */
export const PRODUCTION_CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self'",
	"connect-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"object-src 'none'",
].join("; ");

/**
 * Development adds what Vite's HMR needs: the dev server's origin, its websocket, and the inline preamble its React
 * plugin injects. It is a separate constant on purpose — a relaxation must not be one flag away from production.
 */
export function developmentCsp(devServerOrigin: string): string {
	const ws = devServerOrigin.replace(/^http/, "ws");
	return [
		"default-src 'none'",
		`script-src 'self' 'unsafe-inline' ${devServerOrigin}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		`connect-src 'self' ${devServerOrigin} ${ws}`,
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"object-src 'none'",
	].join("; ");
}

/** The policy for the mode the app runs in. */
export function contentSecurityPolicy(options: { readonly development: boolean; readonly devServerOrigin?: string }): string {
	if (!options.development) return PRODUCTION_CSP;
	return developmentCsp(options.devServerOrigin ?? "http://localhost:5173");
}

/**
 * What the main window gets. `sandbox: true` means the preload cannot use Node built-ins: everything it needs comes
 * over the typed IPC surface, which is the point (see `preload/main.ts`).
 */
export function windowPreferences(preloadPath: string): {
	readonly preload: string;
	readonly contextIsolation: true;
	readonly sandbox: true;
	readonly nodeIntegration: false;
	readonly nodeIntegrationInWorker: false;
	readonly webviewTag: false;
	readonly webSecurity: true;
	readonly allowRunningInsecureContent: false;
	readonly experimentalFeatures: false;
} {
	return {
		preload: preloadPath,
		contextIsolation: true,
		sandbox: true,
		nodeIntegration: false,
		nodeIntegrationInWorker: false,
		webviewTag: false,
		webSecurity: true,
		allowRunningInsecureContent: false,
		experimentalFeatures: false,
	};
}

/** The origin the app's own pages live at. `file://` is not used: it has no origin to lock a policy to. */
export const APP_ORIGIN = "app://spec";

/** Where a navigation may go: the app's own pages, nothing else. */
export function isAllowedNavigation(url: string): boolean {
	return url.startsWith(`${APP_ORIGIN}/`);
}

/**
 * The preview session's rules, taken from the old shell's `pageGuards.ts` (deny permissions, cancel downloads, refuse
 * `file://`, and only navigate where the user sent the preview) — with one difference: the old shell started from "the
 * default session allows everything" and subtracted; this starts from "allow nothing" and adds.
 */
export const PREVIEW_PARTITION = "preview";

export interface PreviewDecision {
	readonly allow: boolean;
	readonly reason?: string;
}

/** Every permission the preview asks for is refused: a page the agent opened has no business asking for the camera. */
export function previewPermission(permission: string): PreviewDecision {
	void permission;
	return { allow: false, reason: "a previewed page gets no permissions" };
}

/** Whether the preview may download something: it may not; a download would write outside the conversation. */
export function previewDownload(): PreviewDecision {
	return { allow: false, reason: "a previewed page may not download files" };
}

/** Whether the preview may navigate to a URL: only http(s). `file://` and custom schemes are refused. */
export function previewNavigation(url: string): PreviewDecision {
	if (/^https?:\/\//i.test(url)) return { allow: true };
	return { allow: false, reason: `a previewed page may not navigate to ${url}` };
}

/**
 * What the app's own page may ask the browser for: nothing.
 *
 * Electron's default is to grant a permission request when no handler is set (the old shell relied on that, and the
 * preview section above exists because of it). The shell's own page needs no camera, no microphone, no location, no
 * notifications and no clipboard read: it draws a conversation and talks to the main process over the typed bridge. So
 * the app session denies by default too, which means a bug that gets script running in it still cannot reach a device.
 * If a feature ever needs one, it is added here, in one place, with a test — rather than being granted by omission.
 */
export function appPermission(permission: string): PreviewDecision {
	return { allow: false, reason: `the app's own page asks for nothing from the browser (${permission} refused)` };
}
