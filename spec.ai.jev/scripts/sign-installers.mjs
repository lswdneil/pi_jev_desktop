#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The detached signatures the updater checks, made in one command instead of by hand.
 *
 * `src/main/update-install.ts` downloads `<installer>.sig` beside the installer and refuses to run anything whose
 * Ed25519 signature does not verify against the public key compiled into the build. The release therefore needs one
 * signature per installer, and until now the recipe for making them was three `openssl` lines in `docs/releasing.md`
 * — which is the kind of step that is done once, done slightly wrong, and never noticed because the app refuses
 * silently by design.
 *
 *   node scripts/sign-installers.mjs dist --key mu-update-private.pem
 *   node scripts/sign-installers.mjs dist --key mu-update-private.pem --check
 *
 * `--key` is a PEM file; `MU_UPDATE_SIGNING_KEY` (the PEM itself, for a CI secret) is used when it is not given. The
 * script writes `<artifact>.sig` for every installer in the folder and then verifies what it wrote against the public
 * half derived from the same key, so a key that is wrong, a file that changed under it, or a signature written to the
 * wrong name fails here rather than on a user's machine.
 *
 * `--check` verifies the `.sig` files that are already there and writes nothing; run it after an upload, or in a test.
 *
 * The whole point depends on the public half being the one in `desktop-next/src/main/update-verify.ts`: a signature
 * this script makes with any other key is correct and useless. `scripts/sign-installers.test.mjs` imports the app's
 * own verification and fails if the two ever disagree.
 */

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** What electron-updater can install on each platform, and therefore what needs a signature beside it. */
export const INSTALLER_EXTENSIONS = [".exe", ".dmg", ".zip", ".AppImage", ".deb"];

/** The installers in a folder, sorted so a release log reads the same every time. */
export function installerFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => INSTALLER_EXTENSIONS.some((extension) => name.endsWith(extension)))
		.sort();
}

/** The base64 signature over the file's bytes, exactly what `update-install.ts` fetches and verifies. */
export function signFile(path, privateKey) {
	return sign(null, readFileSync(path), privateKey).toString("base64");
}

/** Whether a signature beside an installer verifies against the public half of the key that made it. */
export function signatureProblems(directory, publicKeyPem) {
	const problems = [];
	const installers = installerFiles(directory);
	if (installers.length === 0) problems.push(`${directory}: no installer to verify`);
	for (const name of installers) {
		const signaturePath = join(directory, `${name}.sig`);
		if (!existsSync(signaturePath)) {
			problems.push(`${name}: there is no ${name}.sig, so the app refuses this update`);
			continue;
		}
		const bytes = readFileSync(join(directory, name));
		const signature = Buffer.from(readFileSync(signaturePath, "utf8").trim(), "base64");
		if (!verify(null, bytes, publicKeyPem, signature)) problems.push(`${name}: its signature does not verify`);
	}
	return problems;
}

/** Writes `<installer>.sig` for every installer, then reports what it wrote. */
export function signInstallers(directory, privateKey) {
	const written = [];
	for (const name of installerFiles(directory)) {
		const signature = signFile(join(directory, name), privateKey);
		writeFileSync(join(directory, `${name}.sig`), `${signature}\n`, "ascii");
		written.push(name);
	}
	return written;
}

/** The PEM from `--key <file>` or from `MU_UPDATE_SIGNING_KEY`, and the public half to check with. */
export function loadKey(options) {
	if (options.keyFile !== undefined) {
		if (!existsSync(options.keyFile)) throw new Error(`${options.keyFile} does not exist`);
		return createPrivateKey(readFileSync(options.keyFile, "utf8"));
	}
	const inline = options.keyPem ?? process.env.MU_UPDATE_SIGNING_KEY;
	if (inline === undefined || inline.trim() === "") {
		throw new Error("no signing key: pass --key <file> or set MU_UPDATE_SIGNING_KEY to the PEM");
	}
	return createPrivateKey(inline);
}

export function publicPem(privateKey) {
	return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
}

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	try {
		const args = process.argv.slice(2);
		let directory = "desktop-next/dist";
		let keyFile;
		let check = false;
		let sawDirectory = false;
		for (let index = 0; index < args.length; index++) {
			const argument = args[index];
			if (argument === "--key") {
				keyFile = args[++index];
			} else if (argument === "--check") {
				check = true;
			} else if (argument.startsWith("--")) {
				throw new Error(`unknown argument ${argument}`);
			} else if (sawDirectory) {
				throw new Error("give one folder to sign");
			} else {
				directory = argument;
				sawDirectory = true;
			}
		}

		const privateKey = loadKey({ keyFile });
		const publicKeyPem = publicPem(privateKey);
		if (check) {
			const problems = signatureProblems(directory, publicKeyPem);
			if (problems.length === 0) {
				console.log(`sign-installers: every installer in ${directory} carries a signature this key verifies`);
			} else {
				for (const problem of problems) console.error(`sign-installers: ${problem}`);
				process.exitCode = 1;
			}
		} else {
			const written = signInstallers(directory, privateKey);
			if (written.length === 0) {
				console.error(`sign-installers: no installer in ${directory}`);
				process.exitCode = 1;
			} else {
				for (const name of written) console.log(`sign-installers: wrote ${name}.sig`);
				const problems = signatureProblems(directory, publicKeyPem);
				if (problems.length > 0) {
					for (const problem of problems) console.error(`sign-installers: ${problem}`);
					process.exitCode = 1;
				}
			}
		}
	} catch (error) {
		console.error(`sign-installers: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
