// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The version this build is.
 *
 * `app.getVersion()` is only right when Electron resolves the app's own `package.json` — that is, in a packaged app or
 * when the app folder is the first argument. Started as `electron out/main/index.js`, as the end-to-end tests do, it
 * returns *Electron's* version, and a shell that then compares updates against 44.9.0 offers the wrong answer to
 * everyone. So the version is read from the package the build came from, and only falls back to Electron's answer when
 * that file is not there (a packaged app, where `app.getVersion()` is the packaged version).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VersionSources {
	/** `out/main` — the build's own folder, two levels below the package. */
	readonly buildRoot: string;
	/** What Electron reports (`app.getVersion()`), which is the packaged app's version. */
	readonly electronVersion: string;
	readonly read?: (path: string) => string;
}

/** The package's own version, or Electron's when the package is not beside the build. */
export function appVersion(sources: VersionSources): string {
	const read = sources.read ?? ((path: string) => readFileSync(path, "utf8"));
	try {
		const manifest = JSON.parse(read(join(sources.buildRoot, "..", "..", "package.json"))) as { version?: unknown };
		if (typeof manifest.version === "string" && manifest.version !== "") return manifest.version;
	} catch {
		// Packaged, or the file was moved: Electron's answer is the one that knows.
	}
	return sources.electronVersion;
}
