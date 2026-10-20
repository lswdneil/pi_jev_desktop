#!/usr/bin/env node

/**
 * The published package's version has to be one number, written in two places that must agree.
 *
 * `spec-ai-agent` is not a workspace package: it is assembled by `kyrn/npm/build.mjs` from
 * `kyrn/npm/package.template.json`, and whose version users see is the one in the template. The changelog
 * says which versions exist. When those two drift, the release notes describe a version nobody can install
 * (or the tarball ships a version with no notes), so they are checked together.
 *
 * The root `package.json` versions the monorepo, not the package (`0.0.x`), and is deliberately not compared:
 * the two are different products with different release rhythms.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const TEMPLATE_PATH = join("kyrn", "npm", "package.template.json");
export const CHANGELOG_PATH = join("kyrn", "npm", "CHANGELOG.md");
export const DESKTOP_NEXT_PATH = join("desktop-next", "package.json");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The newest version the changelog lists as released; `[Unreleased]` is skipped. */
export function latestReleasedVersion(changelog) {
	for (const line of changelog.split(/\r?\n/)) {
		const match = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]/.exec(line);
		if (match?.[1]) return match[1];
	}
	return undefined;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * What is wrong with the release versions, as sentences a maintainer can act on. Empty means consistent.
 *
 * `desktop-next/` does not exist yet; when it does, its version must extend the package's (`0.1.8-beta.1`),
 * because the app ships this exact spec-ai-agent inside it.
 */
export function releaseVersionProblems(options = {}) {
	const root = options.root ?? process.cwd();
	const problems = [];
	const templatePath = join(root, TEMPLATE_PATH);
	if (!existsSync(templatePath)) {
		problems.push(`${TEMPLATE_PATH} is missing: that file is what spec-ai-agent's version comes from`);
		return problems;
	}
	let template;
	try {
		template = readJson(templatePath);
	} catch (error) {
		problems.push(`${TEMPLATE_PATH} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
		return problems;
	}
	if (template.name !== "spec-ai-agent") problems.push(`${TEMPLATE_PATH} names "${String(template.name)}", not spec-ai-agent`);
	if (typeof template.version !== "string" || !SEMVER.test(template.version)) {
		problems.push(`${TEMPLATE_PATH} has no usable version: ${String(template.version)}`);
		return problems;
	}

	const changelogPath = join(root, CHANGELOG_PATH);
	if (!existsSync(changelogPath)) {
		problems.push(`${CHANGELOG_PATH} is missing: a published version with no notes is a mystery for users`);
	} else {
		const released = latestReleasedVersion(readFileSync(changelogPath, "utf8"));
		if (released === undefined) {
			problems.push(`${CHANGELOG_PATH} lists no released version (a "## [x.y.z]" heading)`);
		} else if (released !== template.version) {
			problems.push(
				`version drift: ${TEMPLATE_PATH} says ${template.version}, ${CHANGELOG_PATH} releases ${released}. Move [Unreleased] to a version and bump the template together.`,
			);
		}
	}

	const desktopPath = join(root, DESKTOP_NEXT_PATH);
	if (existsSync(desktopPath)) {
		try {
			const desktop = readJson(desktopPath);
			if (typeof desktop.version !== "string" || !desktop.version.startsWith(`${template.version}`)) {
				problems.push(
					`${DESKTOP_NEXT_PATH} ships spec-ai-agent ${template.version} but is versioned ${String(desktop.version)}; it must start with the package's version`,
				);
			}
		} catch (error) {
			problems.push(`${DESKTOP_NEXT_PATH} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return problems;
}

/**
 * Write `version` into the template and into the desktop shell when it exists.
 *
 * It does not touch the changelog: moving `[Unreleased]` under a version is a sentence only the release
 * notes can supply. `releaseVersionProblems()` then fails until that is done, which is the point — a
 * version with no notes and notes with no version are the same mistake seen from two sides.
 */
export function setReleaseVersion(version, options = {}) {
	const root = options.root ?? process.cwd();
	if (!SEMVER.test(version)) throw new Error(`not a version: ${version}`);
	const template = readJson(join(root, TEMPLATE_PATH));
	template.version = version;
	writeFileSync(join(root, TEMPLATE_PATH), `${JSON.stringify(template, null, "\t")}\n`);

	const desktopPath = join(root, DESKTOP_NEXT_PATH);
	if (existsSync(desktopPath)) {
		const desktop = readJson(desktopPath);
		const current = typeof desktop.version === "string" ? desktop.version : "";
		const suffix = current.startsWith(`${template.version}`) ? current.slice(template.version.length) : /-[0-9A-Za-z.-]+$/.exec(current)?.[0] ?? "";
		desktop.version = `${version}${suffix}`;
		writeFileSync(desktopPath, `${JSON.stringify(desktop, null, "\t")}\n`);
	}
	return version;
}

function invokedDirectly() {
	const entry = process.argv[1];
	if (!entry) return false;
	return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const args = process.argv.slice(2);
	const setIndex = args.indexOf("--set");
	if (setIndex !== -1) {
		const version = args[setIndex + 1];
		if (!version) {
			console.error("usage: node scripts/release-versions.mjs --set <x.y.z>");
			process.exit(1);
		}
		setReleaseVersion(version);
		console.log(`wrote spec-ai-agent ${version} into ${TEMPLATE_PATH}`);
		console.log(`now move [Unreleased] in ${CHANGELOG_PATH} to "## [${version}] - <date>": the check below fails until then.`);
	}
	const problems = releaseVersionProblems();
	if (problems.length > 0) {
		console.error("release versions are inconsistent:");
		for (const problem of problems) console.error(`  ${problem}`);
		process.exit(1);
	}
	console.log(`release versions agree: spec-ai-agent ${readJson(join(process.cwd(), TEMPLATE_PATH)).version}`);
}
