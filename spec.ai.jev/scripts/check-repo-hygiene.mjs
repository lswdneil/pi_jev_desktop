#!/usr/bin/env node

// Repo hygiene: dead build pipelines, abandoned prototypes and unreferenced
// assets must not come back.
//
//   node scripts/check-repo-hygiene.mjs          # check, exit 1 on a violation
//   node scripts/check-repo-hygiene.mjs --json   # machine-readable result
//
// Why these paths: `desktop/.github/workflows/` is never read by GitHub (only
// the repository root `.github/` is), `desktop/kyrn/` is a Vite+Electron
// prototype from the AionUi era with no packaging step, and `desktop/mobile/`
// is AionUi's Expo app. All three mislead readers and rot in place.
//
// The keep list exists because the first version of this plan claimed
// `desktop/resources/` was "16 MB of unreferenced marketing images". It is not:
// electron-builder reads the icons and `resources/mu` (the ACP launcher), the
// NSIS scripts read `resources/windows`, and the READMEs embed `app.png`.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Trees that must not exist. */
export const DEAD_PATHS = ["desktop/.github", "desktop/kyrn", "desktop/mobile"];

/** Paths that must keep existing: build inputs and documentation images. */
export const KEEP_PATHS = [
	"desktop/resources/app.png",
	"desktop/resources/app.ico",
	"desktop/resources/app.icns",
	"desktop/resources/mu",
	"desktop/resources/windows",
	// 666 bytes, no static reference, but a small runtime-loaded candidate: too
	// cheap to risk, so it stays until someone confirms the loader.
	"desktop/resources/messages.yml",
];

/** Files removed by U24 that must not be re-added. */
export const REMOVED_PATHS = [
	"desktop/resources/ai-assistants-experts.png",
	"desktop/resources/bug-report-button.png",
	"desktop/resources/screenshot_1.png",
	"desktop/resources/screenshot_2.png",
	"desktop/resources/aionui_logo_black_bg.svg",
];

function exists(relativePath) {
	return existsSync(join(root, relativePath));
}

export function checkRepoHygiene(repositoryRoot = root) {
	const existsIn = (relativePath) => existsSync(join(repositoryRoot, relativePath));
	return {
		dead: DEAD_PATHS.filter(existsIn),
		missingKeep: KEEP_PATHS.filter((path) => !existsIn(path)),
		restored: REMOVED_PATHS.filter(existsIn),
	};
}

export function violations(result) {
	const lines = [];
	for (const path of result.dead) lines.push(`dead path is back: ${path}`);
	for (const path of result.missingKeep) lines.push(`keep path is missing: ${path}`);
	for (const path of result.restored) lines.push(`removed file is back: ${path}`);
	return lines;
}

function main() {
	const json = process.argv.includes("--json");
	const result = checkRepoHygiene();
	const problems = violations(result);
	if (json) {
		console.log(JSON.stringify({ root, ...result, problems }, null, 2));
	} else if (problems.length > 0) {
		console.error("repo hygiene violations:");
		for (const line of problems) console.error(`  - ${line}`);
	} else {
		console.log(
			`repo hygiene ok: ${DEAD_PATHS.length} dead paths absent, ${KEEP_PATHS.length} keep paths present, ${REMOVED_PATHS.length} removed files absent`,
		);
	}
	if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main();
}
