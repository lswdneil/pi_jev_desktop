#!/usr/bin/env node

/**
 * A CycloneDX SBOM for a release, built from `package-lock.json` with no network and no extra tooling.
 *
 * The point of shipping an SBOM is that someone else can answer "what is inside this build?" without
 * installing it. That only holds if the SBOM is reproducible from the repository, so this reads the
 * lockfile every dependency is resolved in — versions, resolved URLs, integrity hashes — and writes them
 * as CycloneDX 1.5. Workspace links are left out: they are this repository, not shipped dependencies.
 *
 *   node scripts/sbom.mjs --lock package-lock.json --out dist/sbom.cdx.json --name mu --version 0.1.7
 *   node scripts/sbom.mjs --lock package-lock.json                 # to stdout
 *
 * The output is deterministic except for the timestamp: the same lockfile yields the same components, the
 * same hashes and the same serial number, which is what makes two builds comparable.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SBOM_SPEC_VERSION = "1.5";
export const SBOM_SCHEMA = "http://cyclonedx.org/schema/bom-1.5.schema.json";

/** Registry URLs carry `/@scope/name/-/name-version.tgz`; the purl needs the scope encoded, not the slash. */
export function purlFor(name, version) {
	const scoped = /^(@[^/]+)\/(.+)$/.exec(name);
	if (scoped === null) return `pkg:npm/${name}@${version}`;
	return `pkg:npm/%40${scoped[1].slice(1)}/${scoped[2]}@${version}`;
}

/** `sha512-<base64>` from the lockfile into CycloneDX's algorithm + hex value. */
export function hashOf(integrity) {
	if (typeof integrity !== "string") return undefined;
	const match = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(integrity);
	if (match === null) return undefined;
	const algorithm = { sha512: "SHA-512", sha384: "SHA-384", sha256: "SHA-256", sha1: "SHA-1" }[match[1]];
	return { alg: algorithm, content: Buffer.from(match[2], "base64").toString("hex") };
}

/** The package name of a lockfile entry, from the `node_modules/...` path it is installed at. */
export function nameOf(path) {
	const marker = "node_modules/";
	const index = path.lastIndexOf(marker);
	return index === -1 ? undefined : path.slice(index + marker.length);
}

/**
 * Every installed dependency as a CycloneDX component. Links (workspace packages) and the root project are
 * skipped: the first is this repository, the second is the subject of the SBOM rather than a dependency.
 */
export function componentsFromLock(lock) {
	const packages = lock.packages ?? {};
	const components = [];
	for (const [path, entry] of Object.entries(packages)) {
		if (path === "" || entry?.link === true) continue;
		const name = nameOf(path);
		const version = typeof entry?.version === "string" ? entry.version : undefined;
		if (name === undefined || version === undefined) continue;
		const hash = hashOf(entry.integrity);
		components.push({
			type: "library",
			name,
			version,
			purl: purlFor(name, version),
			"bom-ref": `${purlFor(name, version)}?path=${path}`,
			...(hash === undefined ? {} : { hashes: [hash] }),
			properties: [
				{ name: "mu:lockPath", value: path },
				...(typeof entry.resolved === "string" ? [{ name: "mu:resolved", value: entry.resolved }] : []),
				...(typeof entry.license === "string" ? [{ name: "mu:license", value: entry.license }] : []),
			],
		});
	}
	components.sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
	return components;
}

/** A UUID-shaped serial derived from the components, so the same lockfile always describes the same BOM. */
function serialFor(components) {
	const hex = createHash("sha256").update(JSON.stringify(components)).digest("hex");
	return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The whole document. `now` is injectable so a test does not depend on the clock. */
export function buildSbom(lock, options) {
	const components = componentsFromLock(lock);
	return {
		$schema: SBOM_SCHEMA,
		bomFormat: "CycloneDX",
		specVersion: SBOM_SPEC_VERSION,
		serialNumber: serialFor(components),
		version: 1,
		metadata: {
			timestamp: (options.now ?? new Date()).toISOString(),
			tools: [{ vendor: "mu", name: "scripts/sbom.mjs", version: "1" }],
			component: {
				type: "application",
				name: options.name,
				version: options.version,
				...(options.commit ? { properties: [{ name: "mu:commit", value: options.commit }] } : {}),
			},
		},
		components,
	};
}

export function parseSbomArgs(argv) {
	const options = { lock: "package-lock.json", out: undefined, name: "mu", version: undefined, commit: undefined };
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		switch (argument) {
			case "--lock":
				options.lock = argv[++index];
				break;
			case "--out":
				options.out = argv[++index];
				break;
			case "--name":
				options.name = argv[++index];
				break;
			case "--version":
				options.version = argv[++index];
				break;
			case "--commit":
				options.commit = argv[++index];
				break;
			default:
				throw new Error(`unknown argument "${argument}"`);
		}
	}
	if (!options.version) throw new Error("--version is required: an SBOM without the version certifies nothing");
	return options;
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const options = parseSbomArgs(process.argv.slice(2));
		if (!existsSync(options.lock)) throw new Error(`${options.lock} does not exist`);
		const lock = JSON.parse(readFileSync(options.lock, "utf8"));
		const sbom = buildSbom(lock, options);
		const text = `${JSON.stringify(sbom, null, "\t")}\n`;
		if (options.out) {
			writeFileSync(options.out, text);
			console.log(`${sbom.components.length} components written to ${options.out}`);
		} else process.stdout.write(text);
	} catch (error) {
		console.error(`sbom: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
