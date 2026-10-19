#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the spec.ai.jev authors

/**
 * Put the mu harness where electron-builder expects it.
 *
 * Packaging copies `resources/harness` beside the asar, and the resolver in `src/main/harness.ts` looks for
 * `harness/mu-agent/kyrn/bin/mu.mjs` there. That folder is a built runtime package (~34 MB with its dependencies),
 * not source, so it is staged on demand and stays out of git.
 *
 *   node scripts/stage-harness.mjs                       # from MU_HARNESS_ROOT
 *   node scripts/stage-harness.mjs --from <mu-work>      # explicit checkout
 *   node scripts/stage-harness.mjs --from <dir> --force  # restage even when the marker matches
 *
 * `--from` and `MU_HARNESS_ROOT` accept either the folder that holds `mu-agent` or the `mu-agent` folder itself.
 * Without either, the script falls back to `<MU_ROOT>/.artifacts/desktop-harness`, which is where the mu build puts
 * the package it produced.
 *
 * The marker lives under `node_modules/.cache` rather than in `resources/`: a staged build should not carry a record
 * of this machine's paths into an installer.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(REPO_ROOT, "resources", "harness", "mu-agent");
const MARKER = join(REPO_ROOT, "node_modules", ".cache", "spec-ai-jev", "harness-stage.json");
const LAUNCHER = join("kyrn", "bin", "mu.mjs");

function fail(message) {
	console.error(`stage-harness: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const options = { from: undefined, force: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--force") options.force = true;
		else if (arg === "--from") {
			const value = argv[++index];
			if (value === undefined) fail("--from needs a folder");
			options.from = value;
		} else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
		else if (arg === "--help" || arg === "-h") {
			console.log("usage: node scripts/stage-harness.mjs [--from <folder>] [--force]");
			process.exit(0);
		} else fail(`unknown argument: ${arg}`);
	}
	return options;
}

/** The folder that holds `mu-agent`, from a path that may be either it or its parent. */
function packageRoot(path) {
	const absolute = resolve(path);
	if (existsSync(join(absolute, "mu-agent", LAUNCHER))) return join(absolute, "mu-agent");
	if (existsSync(join(absolute, LAUNCHER))) return absolute;
	return undefined;
}

function candidateSources(options) {
	const candidates = [];
	if (options.from) candidates.push(options.from);
	if (process.env.MU_HARNESS_ROOT) candidates.push(process.env.MU_HARNESS_ROOT);
	for (const name of ["MU_ROOT", "KYRN_ROOT", "PI_JEV_HARNESS"]) {
		const root = process.env[name];
		if (root) candidates.push(join(root, ".artifacts", "desktop-harness"));
	}
	return candidates;
}

function locate(options) {
	const tried = [];
	for (const candidate of candidateSources(options)) {
		const root = packageRoot(candidate);
		if (root) return root;
		tried.push(`  ${candidate}`);
	}
	fail(
		[
			"no mu harness found. Pass --from <folder>, or set MU_HARNESS_ROOT (or MU_ROOT to a mu checkout).",
			tried.length ? `looked in:\n${tried.join("\n")}` : "nothing was named to look in.",
		].join("\n"),
	);
}

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function check(source) {
	const manifest = readJson(join(source, "package.json"));
	if (manifest?.name !== "mu-agent") fail(`${source} is not the mu-agent package (package.json name: ${manifest?.name})`);
	// The judge extension is loaded through jiti at runtime; without it the harness starts and cannot judge.
	if (!existsSync(join(source, "node_modules", "jiti"))) {
		fail(
			[
				`${source} has no node_modules/jiti.`,
				"That copy cannot load its judge extension. Install its dependencies first:",
				`  npm install --omit=dev --prefix "${source}"`,
			].join("\n"),
		);
	}
	return manifest;
}

function fingerprint(source) {
	const launcher = statSync(join(source, LAUNCHER));
	const manifest = statSync(join(source, "package.json"));
	return { source, launcherMs: launcher.mtimeMs, manifestMs: manifest.mtimeMs };
}

function upToDate(now) {
	if (!existsSync(join(TARGET, LAUNCHER))) return false;
	const previous = readJson(MARKER);
	return (
		previous?.source === now.source &&
		previous?.launcherMs === now.launcherMs &&
		previous?.manifestMs === now.manifestMs
	);
}

function count(dir) {
	let files = 0;
	let bytes = 0;
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const next = join(current, entry.name);
			if (entry.isDirectory()) walk(next);
			else if (entry.isFile()) {
				files++;
				bytes += statSync(next).size;
			}
		}
	};
	walk(dir);
	return { files, bytes };
}

const options = parseArgs(process.argv.slice(2));
const source = locate(options);
const manifest = check(source);
const now = fingerprint(source);

if (!options.force && upToDate(now)) {
	console.log(`stage-harness: up to date (mu-agent ${manifest.version}) at ${TARGET}`);
	process.exit(0);
}

console.log(`stage-harness: copying mu-agent ${manifest.version} from ${source}`);
rmSync(TARGET, { recursive: true, force: true });
mkdirSync(dirname(TARGET), { recursive: true });
cpSync(source, TARGET, { recursive: true, force: true, dereference: false });

const { files, bytes } = count(TARGET);
mkdirSync(dirname(MARKER), { recursive: true });
writeFileSync(MARKER, `${JSON.stringify(now, null, 2)}\n`);
console.log(`stage-harness: staged ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB into resources/harness/mu-agent`);
