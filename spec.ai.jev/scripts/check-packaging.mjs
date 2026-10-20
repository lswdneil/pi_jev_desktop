#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The packaging configuration, checked against the code that depends on it.
 *
 * The packaged app is the only thing a user installs and the one build nobody runs on their own machine, so the lines
 * in `desktop-next/electron-builder.yml` have neither a compiler nor a unit test behind them: when they drift, the
 * failure shows up in a release. An app that reports "mu was not found" because `extraResources.to` moved away from
 * where `bundledHarnessRoot` looks, an updater whose `DEFAULT_FEED` names a repository the feed is not published in, a
 * packager that `npx` resolves afresh instead of the version the lockfile pinned, an installer that is built and then
 * not uploaded because the upload globs do not cover its extension.
 *
 * So every rule here pairs a line of the packaging config with the code or the workflow that relies on it:
 *
 *  - `extraResources` `from`/`to` are the folder `desktop-package.yml` stages and the path `bundledHarnessRoot`
 *    (`src/main/harness.ts`) resolves inside a packaged app.
 *  - `publish.owner`/`publish.repo` are the repository `DEFAULT_FEED` (`src/main/update.ts`) points at.
 *  - `files` ships the build and the manifest, never the sources.
 *  - `electron-builder` is a pinned devDependency, installed with `npm ci` and run with `npx --no-install`.
 *  - every declared target's installer extension appears in the upload globs, which fail the job only when no file of
 *    any kind matches.
 *
 * Unit test: `check-packaging.test.mjs`.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const DESKTOP = "desktop-next";
const PACKAGING_FILE = `${DESKTOP}/electron-builder.yml`;
const PACKAGE_FILE = `${DESKTOP}/package.json`;
const HARNESS_SOURCE = `${DESKTOP}/src/main/harness.ts`;
const UPDATE_SOURCE = `${DESKTOP}/src/main/update.ts`;
const WORKFLOW_FILE = ".github/workflows/desktop-package.yml";

/** Which file each platform's target produces, so an installer cannot be built and then not uploaded. */
const TARGET_EXTENSIONS = { nsis: ".exe", dmg: ".dmg", zip: ".zip", AppImage: ".AppImage", deb: ".deb" };

/** The targets the updater and the release notes promise, per platform. */
const EXPECTED_TARGETS = { win: ["nsis"], mac: ["dmg", "zip"], linux: ["AppImage", "deb"] };

function resourcePathProblems(packaging, harnessSource, workflow, packageName) {
	const problems = [];
	const resources = Array.isArray(packaging.extraResources) ? packaging.extraResources : [];
	// The copy is the folder that *holds* `mu-agent`, so that the package's own `node_modules` is a subdirectory of
	// what is copied: electron-builder skips the root `node_modules` of a source folder unconditionally, and a harness
	// without `jiti` starts and then fails to load its judge extension.
	const entry = resources.find((candidate) => candidate?.to === "harness");
	if (entry === undefined) {
		const seen = resources.map((candidate) => candidate?.to ?? "(no to)").join(", ") || "nothing";
		problems.push(`${PACKAGING_FILE}: no extraResources entry copies into harness/ (found: ${seen}), which is where the packaged app looks for the harness`);
		return problems;
	}

	const from = "../.artifacts/desktop-harness";
	if (entry.from !== from) {
		problems.push(`${PACKAGING_FILE}: extraResources copies the harness from ${entry.from ?? "(no from)"}, but the workflow stages ${from}/${packageName}`);
	}
	// The `mv` line, not the comment above it: the comment names the same two paths, and a comment stages nothing.
	const staging = workflow.split("\n").find((line) => line.trim().startsWith("mv ") && line.includes(".artifacts/desktop-harness/"));
	if (staging === undefined || !staging.includes(`.artifacts/desktop-harness/${packageName}`)) {
		problems.push(`${WORKFLOW_FILE}: nothing stages .artifacts/desktop-harness/${packageName}, so the packaged app carries no harness`);
	} else if (!staging.includes(`.artifacts/npm/${packageName}`)) {
		problems.push(`${WORKFLOW_FILE}: the harness package is read from .artifacts/npm/${packageName} by kyrn/npm/build.mjs, and the staging step no longer moves it`);
	}
	if (!workflow.includes("npm install --omit=dev")) {
		problems.push(`${WORKFLOW_FILE}: the harness's own dependencies are not installed into the staged folder, and the packaged agent needs them (jiti loads the judge extension)`);
	}
	if (!harnessSource.includes(`harness", PACKAGE_NAME`)) {
		problems.push(`${HARNESS_SOURCE}: bundledHarnessRoot no longer joins "harness" with PACKAGE_NAME, so the path above is no longer the one the app resolves`);
	}
	return problems;
}

function feedProblems(packaging, updateSource) {
	const problems = [];
	const feed = /export const DEFAULT_FEED = "([^"]+)";/.exec(updateSource)?.[1];
	if (feed === undefined) {
		problems.push(`${UPDATE_SOURCE}: no DEFAULT_FEED, so the release settings cannot be compared with the updater`);
		return problems;
	}
	let owner;
	let repo;
	try {
		const url = new URL(feed);
		[owner, repo] = url.pathname.split("/").filter((part) => part !== "");
	} catch {
		problems.push(`${UPDATE_SOURCE}: DEFAULT_FEED is not a URL: ${feed}`);
		return problems;
	}
	const publish = packaging.publish;
	if (publish === undefined) {
		problems.push(`${PACKAGING_FILE}: no publish section, so no update feed is written`);
		return problems;
	}
	if (publish.owner !== owner || publish.repo !== repo) {
		problems.push(`${PACKAGING_FILE}: publish is ${publish.owner}/${publish.repo}, but the app reads its feed from ${owner}/${repo}`);
	}
	return problems;
}

function contentProblems(packaging, packageJson) {
	const problems = [];
	if (packaging.asar !== true) problems.push(`${PACKAGING_FILE}: asar is not true, so the build ships as loose files`);
	const files = Array.isArray(packaging.files) ? packaging.files : [];
	for (const required of ["out/**/*", "package.json"]) {
		if (!files.includes(required)) problems.push(`${PACKAGING_FILE}: files no longer ships ${required}`);
	}
	for (const entry of files) {
		if (/^src\//.test(String(entry))) problems.push(`${PACKAGING_FILE}: files ships ${entry}, and the sources are not what a user installs`);
	}
	// electron-builder packs every production dependency into the archive. The shell has none: the harness it starts
	// is staged beside the archive, and the pi packages are imported for their types only (erased before packaging).
	for (const name of Object.keys(packageJson.dependencies ?? {})) {
		problems.push(`${PACKAGE_FILE}: ${name} is a runtime dependency, so it would be packed into the app archive; the shell imports pi's types and starts the harness beside the archive`);
	}
	return problems;
}

function targetProblems(packaging, workflow) {
	const problems = [];
	for (const [platform, expected] of Object.entries(EXPECTED_TARGETS)) {
		const section = packaging[platform];
		const entries = Array.isArray(section?.target) ? section.target : [];
		const declared = entries.map((entry) => (typeof entry === "string" ? entry : entry?.target));
		// A target that lists its architectures builds one combined installer for them: 237 MB instead of 117 MB, and
		// the feed's `path` then sends every user to the combined one. The architecture comes from the command line.
		for (const entry of entries) {
			if (typeof entry === "object" && entry !== null && entry.arch !== undefined) {
				problems.push(`${PACKAGING_FILE}: the ${entry.target} target for ${platform} declares arch ${JSON.stringify(entry.arch)}, which builds one combined installer instead of one per architecture`);
			}
		}
		for (const target of expected) {
			if (!declared.includes(target)) {
				problems.push(`${PACKAGING_FILE}: ${platform} no longer builds ${target} (declared: ${declared.join(", ") || "nothing"})`);
			}
			const extension = TARGET_EXTENSIONS[target];
			if (!workflow.includes(`${DESKTOP}/dist/*${extension}`)) {
				problems.push(`${WORKFLOW_FILE}: a ${target} installer is built but ${DESKTOP}/dist/*${extension} is not uploaded`);
			}
		}
	}
	// The updater downloads `<installer>.sig` from the release, so a workflow that signs them but does not upload them
	// publishes installers no app can update from.
	if (workflow.includes("sign-installers.mjs") && !workflow.includes(`${DESKTOP}/dist/*.sig`)) {
		problems.push(`${WORKFLOW_FILE}: the installers are signed but ${DESKTOP}/dist/*.sig is not uploaded`);
	}
	return problems;
}

function packagerProblems(packageJson, workflow) {
	const problems = [];
	const pinned = packageJson.devDependencies?.["electron-builder"];
	if (pinned === undefined) {
		problems.push(`${PACKAGE_FILE}: electron-builder is not a devDependency, so the packaging workflow downloads whatever is current`);
	} else if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
		problems.push(`${PACKAGE_FILE}: electron-builder is pinned to ${pinned}, not an exact version`);
	}
	if (!/npm ci --ignore-scripts/.test(workflow)) {
		problems.push(`${WORKFLOW_FILE}: the shell's dependencies are not installed from the lockfile with npm ci --ignore-scripts`);
	}
	// `npx electron-builder` downloads the packager when it is missing, so the release would be built by whatever npm
	// resolved that day. Either form of a local run is fine; a bare npx is not.
	if (/npx(?! --no-install) electron-builder/.test(workflow)) {
		problems.push(`${WORKFLOW_FILE}: the packager is run with a bare npx, which downloads one when the binary is missing`);
	}
	const script = String(packageJson.scripts?.package ?? "");
	if (!/electron-builder/.test(script)) {
		problems.push(`${PACKAGE_FILE}: no package script that runs electron-builder, so there is no command a person can use locally`);
	}
	if (!/npm run package\b/.test(workflow)) {
		problems.push(`${WORKFLOW_FILE}: the workflow does not build the installers with npm run package`);
	}
	return problems;
}

/**
 * The configuration as electron-builder itself reads it. Its schema is the only authority on which keys exist — a
 * misspelling there (`entitlementInherit` for `entitlementsInherit`) rejects the whole file, and the release fails on
 * every platform at once. The validator is injected because it lives in `desktop-next/node_modules`, which a checkout
 * that only installed the root dependencies does not have.
 */
function schemaProblems(packaging, validator) {
	if (validator === undefined) return [];
	try {
		validator.validate(packaging);
		return [];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return [`${PACKAGING_FILE}: electron-builder rejects this configuration:\n${message}`];
	}
}

/** Everything wrong with the packaging configuration. Empty means the packaged app can find what it needs. */
export function packagingProblems(read, options = {}) {
	const packagingText = read(PACKAGING_FILE);
	if (packagingText === undefined) return [`${PACKAGING_FILE} is missing`];
	let packaging;
	try {
		packaging = parse(packagingText);
	} catch (error) {
		return [`${PACKAGING_FILE}: ${error instanceof Error ? error.message : String(error)}`];
	}
	if (typeof packaging !== "object" || packaging === null) return [`${PACKAGING_FILE}: the file is not a mapping`];

	const problems = schemaProblems(packaging, options.validator);
	if (typeof packaging.appId !== "string" || packaging.appId === "") problems.push(`${PACKAGING_FILE}: no appId`);
	if (typeof packaging.productName !== "string" || packaging.productName === "") problems.push(`${PACKAGING_FILE}: no productName`);

	const packageText = read(PACKAGE_FILE);
	let packageJson = {};
	if (packageText === undefined) problems.push(`${PACKAGE_FILE} is missing`);
	else {
		try {
			packageJson = JSON.parse(packageText);
		} catch (error) {
			problems.push(`${PACKAGE_FILE}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const harnessSource = read(HARNESS_SOURCE) ?? "";
	const updateSource = read(UPDATE_SOURCE) ?? "";
	const workflow = read(WORKFLOW_FILE) ?? "";
	const packageName = /export const PACKAGE_NAME = "([^"]+)";/.exec(harnessSource)?.[1];
	if (packageName === undefined) {
		problems.push(`${HARNESS_SOURCE}: no PACKAGE_NAME, so the harness folder inside the app cannot be named`);
		return problems;
	}

	problems.push(...resourcePathProblems(packaging, harnessSource, workflow, packageName));
	problems.push(...feedProblems(packaging, updateSource));
	problems.push(...contentProblems(packaging, packageJson));
	problems.push(...targetProblems(packaging, workflow));
	if (packageText !== undefined) problems.push(...packagerProblems(packageJson, workflow));
	return problems;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

/** electron-builder's own validator, when the shell's dependencies are installed where it put them. */
function installedValidator(root) {
	const library = join(root, "desktop-next", "node_modules", "app-builder-lib");
	const scheme = join(library, "scheme.json");
	const validator = join(library, "out", "util", "config", "schemaValidator.js");
	if (!existsSync(scheme) || !existsSync(validator)) return undefined;
	const schema = JSON.parse(readFileSync(scheme, "utf8"));
	const { validateSchema } = createRequire(import.meta.url)(validator);
	return { validate: (configuration) => validateSchema(schema, configuration, { name: "electron-builder" }) };
}

if (invokedDirectly()) {
	const validator = installedValidator(process.cwd());
	const problems = packagingProblems(
		(path) => {
			const file = join(process.cwd(), path);
			return existsSync(file) ? readFileSync(file, "utf8") : undefined;
		},
		{ validator },
	);
	if (problems.length > 0) {
		for (const problem of problems) console.error(problem);
		console.error(`\npackaging: ${problems.length} problem(s)`);
		process.exitCode = 1;
	} else {
		console.log("packaging: the packaged app finds its harness, its feed and its packager");
		if (validator === undefined) {
			console.log("packaging: electron-builder is not installed in desktop-next, so its schema was not checked (desktop-package.yml checks it)");
		}
	}
}
