#!/usr/bin/env node

/**
 * The documented compatibility promises, checked against the code that has to keep them.
 *
 * `docs/compatibility.md` says which `agent.json` schema a build reads, where each version lives, and what a
 * rollback looks like. Documentation that drifts from the constant it describes is worse than none: this
 * fails the build when the schema version in the doc and in `migrations/index.ts` disagree, when a section
 * the release process relies on is missing, or when the changelog has no `[Unreleased]` section to release
 * from.
 *
 * The file reads are injectable so the tests can describe a repository instead of mutating this one.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const COMPATIBILITY_DOC = join("docs", "compatibility.md");
export const CONFIG_MIGRATIONS_SOURCE = join("packages", "kyrn-judge", "src", "config", "migrations", "index.ts");
export const CHANGELOG = "CHANGELOG.md";

/** Sections the release process points at; a heading rename is a documentation change, not a silent one. */
export const REQUIRED_SECTIONS = [
	"## Configuration schema",
	"## Sessions",
	"## Version sources",
	"## Rollback",
	"## The 1.0 gate",
];

/** Files whose versions the doc claims to describe. */
/** Files whose versions the doc claims to describe, as the doc spells them (repository paths use `/`). */
export const VERSION_SOURCES = ["kyrn/npm/package.template.json", "package.json"];

/**
 * `read(path)` returns the contents of a repository-relative path, or undefined when it does not exist, so the
 * tests can describe a repository instead of mutating this one.
 */
export function diskFiles(root) {
	return {
		read(path) {
			const absolute = join(root, path);
			return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
		},
	};
}

function documentedSchemaVersion(doc) {
	const match = /The current format version is \*\*(\d+)\*\*/.exec(doc);
	return match === null ? undefined : Number(match[1]);
}

function declaredSchemaVersion(source) {
	const match = /export const CONFIG_SCHEMA_VERSION = (\d+)/.exec(source);
	return match === null ? undefined : Number(match[1]);
}

/**
 * What is wrong with the repository's compatibility policy. An empty list means the doc and the code agree
 * and every promise the release process depends on is written down.
 */
export function compatibilityPolicyProblems(files) {
	const problems = [];
	const doc = files.read(COMPATIBILITY_DOC);
	if (doc === undefined) {
		problems.push(`${COMPATIBILITY_DOC} is missing: there is nowhere the compatibility promises are written`);
		return problems;
	}
	for (const section of REQUIRED_SECTIONS) {
		if (!doc.includes(section)) problems.push(`${COMPATIBILITY_DOC} no longer documents "${section}"`);
	}

	const documented = documentedSchemaVersion(doc);
	const declared = declaredSchemaVersion(files.read(CONFIG_MIGRATIONS_SOURCE) ?? "");
	if (declared === undefined) {
		problems.push(`${CONFIG_MIGRATIONS_SOURCE} does not declare CONFIG_SCHEMA_VERSION`);
	} else if (documented === undefined) {
		problems.push(`${COMPATIBILITY_DOC} does not state "The current format version is **N**"`);
	} else if (documented !== declared) {
		problems.push(
			`${COMPATIBILITY_DOC} documents schema version ${documented} but ${CONFIG_MIGRATIONS_SOURCE} declares ${declared}`,
		);
	}

	const source = files.read(CONFIG_MIGRATIONS_SOURCE) ?? "";
	if (!source.includes("CONFIG_MIGRATIONS")) {
		problems.push(`${CONFIG_MIGRATIONS_SOURCE} declares CONFIG_SCHEMA_VERSION but no CONFIG_MIGRATIONS`);
	}

	for (const path of VERSION_SOURCES) {
		if (!doc.includes(path)) {
			problems.push(`${COMPATIBILITY_DOC} does not name ${path} among the places a version lives`);
			continue;
		}
		const contents = files.read(path);
		if (contents === undefined) {
			problems.push(`${path} is named in ${COMPATIBILITY_DOC} but does not exist`);
			continue;
		}
		try {
			const version = JSON.parse(contents).version;
			if (typeof version !== "string" || version === "") problems.push(`${path} has no version field`);
		} catch {
			problems.push(`${path} is not valid JSON`);
		}
	}

	const changelog = files.read(CHANGELOG);
	if (changelog === undefined) problems.push(`${CHANGELOG} is missing`);
	else if (!changelog.includes("## [Unreleased]")) problems.push(`${CHANGELOG} has no ## [Unreleased] section to release from`);

	return problems;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const problems = compatibilityPolicyProblems(diskFiles(process.cwd()));
	if (problems.length === 0) {
		console.log("compatibility policy is documented and matches the code");
	} else {
		for (const problem of problems) console.error(`compatibility: ${problem}`);
		process.exitCode = 1;
	}
}
