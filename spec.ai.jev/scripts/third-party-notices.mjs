#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors


/**
 * The third-party inventory: what mu ships, under which licence.
 *
 * Hand-maintained lists go stale silently, and a release that ships a dependency the notices do not mention is the
 * kind of finding that stops a distribution review. The list is therefore generated from the lockfiles — the same
 * files that decide what gets installed — and CI compares it with the file in the repository, so adding a dependency
 * without refreshing the list fails the build.
 *
 * Two lockfiles, because the desktop shell is its own application with its own tree. Its dev dependencies are
 * included: electron-vite bundles them into the app, so they ship. The root tree's dev dependencies do not.
 *
 * Code adapted from other projects (rather than installed from npm) is recorded by hand in
 * `packages/kyrn-judge/THIRD_PARTY_NOTICES.md`; that file is not touched here.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const NOTICES_FILE = "THIRD_PARTY_NOTICES.md";
export const ROOT_LOCKFILE = "package-lock.json";
export const DESKTOP_LOCKFILE = "desktop-next/package-lock.json";

/**
 * The production packages a lockfile describes. `includeDev` is for the desktop shell, whose build dependencies are
 * bundled into the application.
 */
export function lockComponents(lock, includeDev = false) {
	const components = [];
	for (const [key, entry] of Object.entries(lock.packages ?? {})) {
		if (key === "" || entry === undefined) continue;
		const workspace = !key.startsWith("node_modules/") && !key.includes("/node_modules/");
		if (entry.link === true) continue;
		if (!workspace && (entry.dev === true || entry.devOptional === true) && !includeDev) continue;
		const name = workspace ? entry.name : key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
		if (typeof name !== "string" || name === "") continue;
		components.push({
			name,
			version: typeof entry.version === "string" ? entry.version : "",
			license: typeof entry.license === "string" ? entry.license : "",
			workspace,
			// A workspace entry names its own folder; a lockfile written from a subdirectory writes `../packages/x`.
			path: workspace ? key.replace(/^\.\.\//, "") : undefined,
		});
	}
	return components;
}

function manifestLicense(files, path) {
	const text = path === undefined ? undefined : files.read(`${path}/package.json`);
	if (text === undefined) return "";
	try {
		const manifest = JSON.parse(text);
		return typeof manifest.license === "string" ? manifest.license : "";
	} catch {
		return "";
	}
}

/**
 * Every component, deduplicated by `name@version`, with the licence it ships under. A workspace package has no licence
 * in the lockfile when npm wrote it from a linked folder, so its own manifest answers; that is why every manifest in
 * this repository carries the field.
 */
export function collectComponents(locks, files) {
	const seen = new Map();
	for (const { lock, includeDev } of locks) {
		if (lock === undefined) continue;
		for (const component of lockComponents(lock, includeDev)) {
			const key = `${component.name}@${component.version}`;
			if (seen.has(key)) continue;
			const license = component.license === "" ? manifestLicense(files, component.path) : component.license;
			seen.set(key, { ...component, license });
		}
	}
	return [...seen.values()].sort(
		(left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
	);
}

function display(license) {
	return license === "" ? "unrecorded" : license;
}

function table(components) {
	return [
		"| Package | Version | Licence |",
		"| --- | --- | --- |",
		...components.map(
			({ name, version, license }) => `| \`${name}\` | ${version === "" ? "—" : version} | ${display(license)} |`,
		),
	].join("\n");
}

/** The file as it should be. Deterministic: the same lockfiles produce the same bytes, so a diff means a real change. */
export function renderNotices(components) {
	const mine = components.filter((component) => component.workspace);
	const shipped = components.filter((component) => !component.workspace);
	const byLicense = new Map();
	for (const component of shipped) {
		const key = display(component.license);
		byLicense.set(key, [...(byLicense.get(key) ?? []), component]);
	}
	// "unrecorded" last: it is the section a reviewer has to do something about.
	const sections = [...byLicense.keys()]
		.sort((left, right) => (left === "unrecorded" ? 1 : right === "unrecorded" ? -1 : left.localeCompare(right)))
		.map((license) => `### ${license} (${byLicense.get(license)?.length ?? 0})\n\n${table(byLicense.get(license) ?? [])}`);

	return [
		"# Third-party notices",
		"",
		"This file lists the npm packages mu ships and the licence each is distributed under. It is generated from the",
		"lockfiles by `node scripts/third-party-notices.mjs --write` and checked by `node scripts/license-check.mjs`.",
		"Do not edit it by hand: change the dependency and let the file follow.",
		"",
		"- The root tree is mu's JavaScript packages. Its development dependencies are not listed, because they do not",
		"  ship.",
		"- `desktop-next/` is a separate application with its own lockfile. Its dependencies are bundled into the app, so",
		"  they are all listed, development ones included.",
		"- mu's own packages are covered by the repository's `LICENSE`; they appear here for completeness.",
		"- A dependency the lockfile records no licence for appears as `unrecorded`. That is a question for the",
		"  dependency's own package, not a licence mu chose.",
		"",
		`${components.length} components.`,
		"",
		"## This repository's own packages",
		"",
		mine.length === 0 ? "None." : table(mine),
		"",
		"## Shipped dependencies",
		"",
		sections.length === 0 ? "None." : sections.join("\n\n"),
		"",
	].join("\n");
}

/** Whether the file in the repository is what the lockfiles describe. */
export function noticesProblems(files) {
	const locks = [];
	for (const [path, includeDev] of [
		[ROOT_LOCKFILE, false],
		[DESKTOP_LOCKFILE, true],
	]) {
		const text = files.read(path);
		if (text === undefined) {
			if (path === ROOT_LOCKFILE) return [`${path} is missing`];
			continue;
		}
		try {
			locks.push({ lock: JSON.parse(text), includeDev });
		} catch {
			return [`${path} is not valid JSON`];
		}
	}

	const components = collectComponents(locks, files);
	const expected = renderNotices(components);
	const actual = files.read(NOTICES_FILE);
	if (actual === undefined) return [`${NOTICES_FILE} is missing; run: node scripts/third-party-notices.mjs --write`];
	if (actual === expected) return [];

	const listed = new Set((actual.match(/^\|\s`([^`]+)`\s\|/gm) ?? []).map((line) => line.replace(/^\|\s`|`\s\|$/g, "")));
	const described = new Set(components.map((component) => component.name));
	const added = [...described].filter((name) => !listed.has(name)).sort();
	const removed = [...listed].filter((name) => !described.has(name)).sort();
	const parts = [];
	if (added.length > 0) parts.push(`added: ${added.join(", ")}`);
	if (removed.length > 0) parts.push(`removed: ${removed.join(", ")}`);
	if (parts.length === 0) parts.push("a version or a licence changed");
	return [`${NOTICES_FILE} is out of date (${parts.join("; ")}); run: node scripts/third-party-notices.mjs --write`];
}

const WALK_SKIP = new Set([
	"node_modules",
	"dist",
	"out",
	".git",
	".artifacts",
	"coverage",
	"test-results",
	"playwright-report",
]);

/** Repository-relative files under `relative`, without build output. */
export function walk(directory, relative = "") {
	const files = [];
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
		if (entry.isDirectory()) {
			if (WALK_SKIP.has(entry.name)) continue;
			files.push(...walk(join(directory, entry.name), path));
		} else if (entry.isFile()) {
			files.push(path);
		}
	}
	return files;
}

/** The repository as this script sees it: read a file, list a folder, both repository-relative. */
export function diskFiles(root) {
	return {
		read(path) {
			const absolute = join(root, path);
			return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
		},
		list(prefix) {
			return walk(join(root, prefix), prefix);
		},
	};
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const root = process.cwd();
	const files = diskFiles(root);
	if (process.argv.slice(2).includes("--write")) {
		const locks = [];
		for (const [path, includeDev] of [
			[ROOT_LOCKFILE, false],
			[DESKTOP_LOCKFILE, true],
		]) {
			const text = files.read(path);
			if (text !== undefined) locks.push({ lock: JSON.parse(text), includeDev });
		}
		const components = collectComponents(locks, files);
		writeFileSync(join(root, NOTICES_FILE), renderNotices(components));
		console.log(`${NOTICES_FILE}: ${components.length} components`);
	} else {
		const problems = noticesProblems(files);
		if (problems.length === 0) console.log(`${NOTICES_FILE} matches the lockfiles`);
		else {
			for (const problem of problems) console.error(`notices: ${problem}`);
			process.exitCode = 1;
		}
	}
}
