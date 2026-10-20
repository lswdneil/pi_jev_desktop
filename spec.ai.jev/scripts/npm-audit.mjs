#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

// Runs `npm audit --omit=dev` and fails on advisories at or above the audit
// level, except for advisories that were reviewed and accepted below. Every
// accepted advisory must name the affected package and explain why it does not
// apply. Remove an entry once a fixed version is installed; the script warns
// about entries that no longer match.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const auditLevel = "moderate";
const severities = ["info", "low", "moderate", "high", "critical"];

/**
 * How to run npm itself. On Windows `npm` is a `.cmd` shim, which Node refuses to spawn without a shell, so a bare
 * `spawnSync("npm", …)` fails with ENOENT there while passing on the Linux CI runner. npm's JavaScript entry point is
 * spawnable everywhere: under an npm script `npm_execpath` names it, and otherwise it sits beside the running node
 * (`<node>/node_modules/npm/bin/npm-cli.js`). Falling back to `npm` keeps the script working where neither holds.
 */
export function npmInvocation(env = process.env, nodePath = process.execPath, exists = existsSync) {
	const fromEnv = env.npm_execpath;
	if (fromEnv !== undefined && fromEnv.endsWith(".js")) return { command: nodePath, args: [fromEnv] };
	const besideNode = join(dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js");
	if (exists(besideNode)) return { command: nodePath, args: [besideNode] };
	return { command: "npm", args: [] };
}

/** @type {Record<string, { package: string; reason: string }>} */
const acceptedAdvisories = {
	"GHSA-86w9-cpqp-85rv": {
		package: "node-forge",
		reason:
			"Written for the low-exponent forgery the advisory described when it was accepted; it now covers RSA PKCS#1 v1.5 " +
			"signature verification accepting extra nested DigestAlgorithm elements (CVSS 7.5, node-forge <= 1.4.0, and 1.4.0 " +
			"is the latest release, so there is nothing to upgrade to). node-forge is reachable only through " +
			"@earendil-works/gondolin, which the workspace pulls in because packages/coding-agent/examples/extensions/gondolin " +
			"is a workspace member; neither shipped product installs it (spec-ai-agent depends on chord, photon-node and jiti only, " +
			"and the staged desktop harness has no @earendil-works packages). Gondolin's only verification call is " +
			"`caCert.verify(leafCert)` against the CA it generates in-process for its own sandbox session, so a leaf it would " +
			"accept needs a signature from that ephemeral CA key.",
	},
};

function invokedDirectly() {
	const entry = process.argv[1];
	return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
	const npm = npmInvocation();
	const result = spawnSync(npm.command, [...npm.args, "audit", "--omit=dev", "--json"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) {
		throw result.error;
	}

	let report;
	try {
		report = JSON.parse(result.stdout);
	} catch {
		process.stderr.write(result.stderr);
		process.stderr.write(result.stdout);
		console.error("npm audit did not produce a JSON report.");
		process.exit(1);
	}

	if (report.error) {
		console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
		process.exit(1);
	}

	const minimumSeverity = severities.indexOf(auditLevel);
	const seenAccepted = new Set();
	const failures = new Map();

	for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
		for (const via of vulnerability.via) {
			// String entries point at another vulnerable package, which is reported on its own.
			if (typeof via === "string") {
				continue;
			}
			const id = via.url?.split("/").pop() ?? String(via.source);
			const accepted = acceptedAdvisories[id];
			if (accepted && accepted.package === via.name) {
				seenAccepted.add(id);
				continue;
			}
			if (severities.indexOf(via.severity) >= minimumSeverity) {
				failures.set(`${id}:${via.name}`, via);
			}
		}
	}

	for (const id of seenAccepted) {
		console.log(`Accepted ${id} (${acceptedAdvisories[id].package}): ${acceptedAdvisories[id].reason}`);
	}

	for (const id of Object.keys(acceptedAdvisories)) {
		if (!seenAccepted.has(id)) {
			console.log(`::warning::Accepted advisory ${id} no longer matches; remove it from scripts/npm-audit.mjs.`);
		}
	}

	if (failures.size > 0) {
		console.error(`\nFound ${failures.size} unaccepted advisories at or above ${auditLevel}:`);
		for (const via of failures.values()) {
			console.error(`- ${via.name} ${via.range} [${via.severity}] ${via.title} ${via.url}`);
		}
		process.exit(1);
	}

	console.log(`No unaccepted advisories at or above ${auditLevel}.`);
}
