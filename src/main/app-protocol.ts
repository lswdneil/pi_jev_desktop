// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * What `app://mu/...` means as a file.
 *
 * The app's pages are served from a custom scheme instead of `file://`: a page loaded from `file://` has an opaque
 * origin, so a Content-Security-Policy has nothing to attach to and the renderer's own `fetch`/`import` behave
 * differently than in development. `app://mu` is a real, privileged origin, and it is the only origin the window may
 * navigate to (`security.ts` `isAllowedNavigation`).
 *
 * The resolution is a pure function of the URL and the build output's folder, so the traversal rules are tested
 * without starting Electron.
 */

import { posix, win32 } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "mu";

/** The types the build emits. Anything else is served as bytes rather than guessed at. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};

export type AppResponse =
	| { readonly kind: "file"; readonly file: string; readonly contentType: string }
	| { readonly kind: "refused"; readonly status: number; readonly reason: string };

/**
 * Map a request to a file inside the renderer build. `app://mu/` is `index.html`; anything that escapes the folder,
 * arrives on another host, or uses another scheme is refused rather than sanitised into something close.
 */
export function resolveAppRequest(rawUrl: string, rendererRoot: string, platform: NodeJS.Platform): AppResponse {
	const p = platform === "win32" ? win32 : posix;
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { kind: "refused", status: 400, reason: "the request is not a URL" };
	}
	if (url.protocol !== `${APP_SCHEME}:`) return { kind: "refused", status: 400, reason: "wrong scheme" };
	if (url.hostname !== APP_HOST) return { kind: "refused", status: 400, reason: "wrong host" };

	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		return { kind: "refused", status: 400, reason: "the path is not valid percent-encoding" };
	}
	if (pathname.includes("\0")) return { kind: "refused", status: 400, reason: "the path contains a null byte" };

	const segments = pathname.split("/").filter((segment) => segment !== "");
	for (const segment of segments) {
		// `..` climbs out, `.` hides intent, a colon is a drive or an alternate data stream on Windows, and a
		// separator inside a decoded segment ("%2f") means the split above was not the real path.
		if (segment === ".." || segment === "." || segment.includes("/") || segment.includes("\\") || segment.includes(":")) {
			return { kind: "refused", status: 403, reason: "the path is outside the build" };
		}
	}

	const file = p.join(rendererRoot, ...(segments.length === 0 ? ["index.html"] : segments));
	const relative = p.relative(rendererRoot, file);
	if (relative.startsWith("..") || p.isAbsolute(relative)) {
		return { kind: "refused", status: 403, reason: "the path is outside the build" };
	}
	const extension = p.extname(file).toLowerCase();
	return {
		kind: "file",
		file,
		contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
	};
}
