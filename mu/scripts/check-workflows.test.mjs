// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 the mu authors

/**
 * The workflows, parsed instead of trusted.
 *
 * GitHub only tells you a workflow is malformed when it runs — which, for a release job, is the worst moment to find
 * out. This parses every file under `.github/workflows/` with the same YAML parser the coding agent already ships,
 * and checks the things a typo silently breaks: `on` and `jobs` present, every job runnable (`runs-on` plus steps),
 * `needs` pointing at a job that exists, and no tab indentation (which YAML rejects and GitHub reports as "invalid
 * workflow file" without a line number).
 *
 * It is a unit test rather than a script: it runs in `npm run test:scripts`, where a broken workflow stops the build.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");

function workflowFiles() {
	return readdirSync(WORKFLOWS)
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.sort();
}

/** What is wrong with one workflow's text. Empty means it is structurally a workflow. */
export function workflowProblems(name, text) {
	const problems = [];
	if (/^\t/m.test(text)) problems.push(`${name}: a tab is indentation; YAML wants spaces`);

	let parsed;
	try {
		parsed = parse(text);
	} catch (error) {
		return [...problems, `${name}: ${error instanceof Error ? error.message : String(error)}`];
	}
	if (typeof parsed !== "object" || parsed === null) return [...problems, `${name}: the file is not a mapping`];

	// YAML reads the bare word `on` as a boolean; both spellings are accepted by GitHub.
	const triggers = parsed.on ?? parsed.true;
	if (triggers === undefined) problems.push(`${name}: no on: trigger`);

	const jobs = parsed.jobs;
	if (jarsNotAMapping(jobs)) return [...problems, `${name}: no jobs`];

	for (const [id, job] of Object.entries(jobs)) {
		if (typeof job !== "object" || job === null) {
			problems.push(`${name}: job ${id} is not a mapping`);
			continue;
		}
		const uses = typeof job.uses === "string";
		if (!uses) {
			if (job["runs-on"] === undefined) problems.push(`${name}: job ${id} has no runs-on`);
			if (!Array.isArray(job.steps) || job.steps.length === 0) problems.push(`${name}: job ${id} has no steps`);
			else {
				job.steps.forEach((step, index) => {
					const hasRun = typeof step?.run === "string";
					const hasUses = typeof step?.uses === "string";
					if (!hasRun && !hasUses) problems.push(`${name}: job ${id} step ${index + 1} has neither run nor uses`);
				});
			}
		}
		const needs = job.needs;
		if (typeof needs === "string" && jobs[needs] === undefined) problems.push(`${name}: job ${id} needs ${needs}, which does not exist`);
		if (Array.isArray(needs)) {
			for (const dependency of needs) {
				if (typeof dependency === "string" && jobs[dependency] === undefined) {
					problems.push(`${name}: job ${id} needs ${dependency}, which does not exist`);
				}
			}
		}
	}
	return problems;
}

function jarsNotAMapping(jobs) {
	return typeof jobs !== "object" || jobs === null || Array.isArray(jobs);
}

test("every workflow is structurally a workflow", () => {
	const problems = [];
	for (const name of workflowFiles()) problems.push(...workflowProblems(name, readFileSync(join(WORKFLOWS, name), "utf8")));
	assert.deepEqual(problems, []);
});

test("a tab indentation is caught before GitHub sees it", () => {
	const problems = workflowProblems("bad.yml", "name: x\non: push\njobs:\n\tone:\n\t\truns-on: linux\n");
	assert.match(problems.join("\n"), /tab is indentation/);
});

// The verifier is only worth its exit code if CI demands the proofs: without --require-proof a release with no
// signature and no attestation passes as a warning, which is exactly the state a broken signing step leaves.
test("CI never verifies a release without requiring the proofs", () => {
	const text = readFileSync(join(WORKFLOWS, "desktop.yml"), "utf8");
	const calls = [...text.matchAll(/verify-release\.mjs[^\n]*/g)].map((match) => match[0]);
	assert.ok(calls.length > 0, "desktop.yml no longer runs scripts/verify-release.mjs");
	for (const call of calls) {
		if (!call.includes("--repo")) continue; // a local run of the script in a comment
		assert.match(call, /--require-proof/, `a verification in CI that does not require the proofs: ${call}`);
	}
});

test("a missing trigger, a missing runs-on or steps, and a dangling needs are each caught", () => {
	assert.match(workflowProblems("a.yml", "jobs:\n  one:\n    runs-on: linux\n    steps:\n      - run: echo hi\n").join("\n"), /no on: trigger/);
	assert.match(workflowProblems("b.yml", "on: push\njobs:\n  one:\n    steps:\n      - run: echo hi\n").join("\n"), /no runs-on|has no runs-on/);
	assert.match(workflowProblems("c.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps: []\n").join("\n"), /has no steps/);
	assert.match(
		workflowProblems("d.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    needs: [two]\n    steps:\n      - run: echo hi\n").join("\n"),
		/needs two, which does not exist/,
	);
});

test("an empty step is caught, and a reusable-workflow job does not need runs-on", () => {
	assert.match(
		workflowProblems("e.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps:\n      - name: nothing\n").join("\n"),
		/step 1 has neither run nor uses/,
	);
	assert.deepEqual(
		workflowProblems("f.yml", "on: push\njobs:\n  call:\n    uses: owner/repo/.github/workflows/x.yml@v1\n"),
		[],
	);
});

/**
 * What the workflow *refers to*, checked against the repository: a `node scripts/…` path or an `npm run …` script that
 * does not exist fails here instead of in CI, where it costs a full run to discover. The base directory matters — CI
 * runs some jobs in `desktop/`, so `scripts/check-i18n.js` is valid there and missing at the root — and matrix commands
 * carry their own base, so every `working-directory` a workflow mentions is tried.
 */
export function referenceProblems(name, text, repo) {
	const parsed = parse(text);
	const problems = [];
	if (parsed === null || typeof parsed !== "object") return problems;

	const bases = new Set(["."]);
	const addBase = (value) => {
		if (typeof value !== "string" || value.includes("${{")) return;
		bases.add(value.replaceAll("\\", "/").replace(/^\.\//, ""));
	};
	// `defaults: run: working-directory:` sets it for a whole workflow or job, and it is where most of this repository's
	// CI declares the `desktop/` base; the per-job and per-step keys win over it.
	addBase(parsed.defaults?.run?.["working-directory"]);
	for (const job of Object.values(parsed.jobs ?? {})) {
		if (job === null || typeof job !== "object") continue;
		addBase(job.defaults?.run?.["working-directory"]);
		addBase(job["working-directory"]);
		for (const step of Array.isArray(job.steps) ? job.steps : []) addBase(step?.["working-directory"]);
	}

	const resolve = (path) => {
		for (const base of bases) {
			const candidate = base === "." ? path : `${base}/${path}`;
			if (repo.exists(candidate)) return candidate;
		}
		return undefined;
	};

	for (const match of text.matchAll(/(?:^|[\s'"])node\s+(\.{0,2}\/?[A-Za-z0-9._/-]+\.(?:mjs|cjs|js|ts))/g)) {
		const path = match[1].replace(/^\.\//, "");
		if (path.startsWith("/") || path.includes("${{")) continue;
		if (resolve(path) === undefined) problems.push(`${name}: runs node ${path}, which is not in the repository`);
	}

	for (const match of text.matchAll(/npm run ([a-zA-Z0-9:_.-]+)/g)) {
		const script = match[1];
		let found = false;
		for (const base of bases) {
			if (repo.scriptsIn(base).has(script)) {
				found = true;
				break;
			}
		}
		if (!found) problems.push(`${name}: runs npm run ${script}, which no package.json at ${[...bases].join(", ")} defines`);
	}
	return problems;
}

/** The files a workflow needs in order to be runnable at all, plus the scripts it names. */
function repositoryView() {
	const root = join(import.meta.dirname, "..");
	return {
		exists: (path) => {
			try {
				return existsSync(join(root, path));
			} catch {
				return false;
			}
		},
		scriptsIn: (directory) => {
			try {
				const manifest = JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"));
				return new Set(Object.keys(manifest.scripts ?? {}));
			} catch {
				return new Set();
			}
		},
	};
}

test("every workflow names scripts and npm scripts that exist", () => {
	const repo = repositoryView();
	const problems = [];
	for (const name of workflowFiles()) problems.push(...referenceProblems(name, readFileSync(join(WORKFLOWS, name), "utf8"), repo));
	assert.deepEqual(problems, []);
});

test("a wrong script path or a wrong npm script is caught, and a base directory is honoured", () => {
	const repo = {
		exists: (path) => new Set(["scripts/real.mjs", "desktop/scripts/real.mjs"]).has(path),
		scriptsIn: (directory) => new Set(directory === "desktop" ? ["lint", "i18n"] : ["check"]),
	};
	assert.match(
		referenceProblems("a.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps:\n      - run: node scripts/typo.mjs\n", repo).join("\n"),
		/runs node scripts\/typo\.mjs, which is not in the repository/,
	);
	assert.match(
		referenceProblems("b.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps:\n      - run: npm run typo\n", repo).join("\n"),
		/runs npm run typo, which no package\.json/,
	);
	assert.deepEqual(
		referenceProblems("c.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    working-directory: desktop\n    steps:\n      - run: node scripts/real.mjs\n", repo),
		[],
		"a job that runs in desktop/ resolves scripts/real.mjs there",
	);
	assert.deepEqual(
		referenceProblems("d.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps:\n      - working-directory: desktop\n        run: npm run i18n\n", repo),
		[],
		"a step-level working-directory is honoured too",
	);
});

/** The token a workflow's jobs use, and whether it is write-capable by default. */
test("every workflow declares the token permissions it needs", () => {
	const problems = [];
	for (const name of workflowFiles()) {
		const parsed = parse(readFileSync(join(WORKFLOWS, name), "utf8"));
		if (parsed === null || typeof parsed !== "object") continue;
		if (parsed.permissions === undefined) problems.push(`${name}: no permissions block, so the job takes whatever the repository default gives it`);
	}
	assert.deepEqual(problems, []);
});

/**
 * `npm install` resolves fresh versions; `npm ci` installs the lockfile. In CI that difference decides whether the test
 * exercises what will ship, so a workflow that has a lockfile at its base directory has to use `npm ci`.
 */
export function installProblems(name, text, repo) {
	const parsed = parse(text);
	if (parsed === null || typeof parsed !== "object") return [];
	const bases = new Set(["."]);
	const addBase = (value) => {
		if (typeof value !== "string" || value.includes("${{")) return;
		bases.add(value.replaceAll("\\", "/").replace(/^\.\//, ""));
	};
	addBase(parsed.defaults?.run?.["working-directory"]);
	for (const job of Object.values(parsed.jobs ?? {})) {
		if (job === null || typeof job !== "object") continue;
		addBase(job.defaults?.run?.["working-directory"]);
		addBase(job["working-directory"]);
		for (const step of Array.isArray(job.steps) ? job.steps : []) addBase(step?.["working-directory"]);
	}

	const problems = [];
	for (const line of text.split("\n")) {
		if (!/npm install\b/.test(line)) continue;
		if (/--no-package-lock|--package-lock-only/.test(line)) continue;
		const locked = [...bases].filter((base) => repo.exists(base === "." ? "package-lock.json" : `${base}/package-lock.json`));
		if (locked.length > 0) {
			problems.push(`${name}: "${line.trim()}" resolves fresh versions; use npm ci, because ${locked.join(", ")} has a lockfile`);
		}
	}
	return problems;
}

test("CI installs from the lockfile wherever there is one", () => {
	const repo = repositoryView();
	const problems = [];
	for (const name of workflowFiles()) problems.push(...installProblems(name, readFileSync(join(WORKFLOWS, name), "utf8"), repo));
	assert.deepEqual(problems, []);
});

test("an npm install in a directory with a lockfile is caught, and an unlocked one is left alone", () => {
	const repo = { exists: (path) => path === "desktop-next/package-lock.json", scriptsIn: () => new Set() };
	assert.match(
		installProblems("a.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps:\n      - working-directory: desktop-next\n        run: npm install --ignore-scripts\n", repo).join("\n"),
		/use npm ci/,
	);
	assert.deepEqual(
		installProblems("b.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps:\n      - run: npm install --omit=dev --ignore-scripts --no-package-lock\n", repo),
		[],
		"an install that is deliberately not lockfile-backed is fine",
	);
	assert.deepEqual(
		installProblems("c.yml", "on: push\njobs:\n  one:\n    runs-on: linux\n    steps:\n      - run: npm ci --ignore-scripts\n", repo),
		[],
	);
});

/**
 * A tag is a moving reference: `@v4` today can be another commit tomorrow, and a workflow that runs it with this
 * repository's token follows it. Every remote action is pinned to the commit its tag pointed at, with the tag kept as a
 * comment so a reader can still tell which version that is. Local actions and container references are not tags.
 */
export function pinProblems(name, text) {
	const problems = [];
	for (const line of text.split("\n")) {
		const match = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/.exec(line);
		if (match === null) continue;
		const reference = match[1];
		if (reference.startsWith("./") || reference.startsWith("docker://")) continue;
		const parts = /^([^@]+)@(.+)$/.exec(reference);
		if (parts === null) {
			problems.push(`${name}: "${reference}" is not action@ref`);
			continue;
		}
		const [, action, ref] = parts;
		if (!/^[0-9a-f]{40}$/.test(ref)) {
			problems.push(`${name}: ${action}@${ref} is a moving reference; pin the commit and keep the tag as a comment`);
			continue;
		}
		if (!/#\s*v?\d/.test(match[2] ?? "")) problems.push(`${name}: ${action}@${ref} carries no tag comment, so nobody can tell which release it is`);
	}
	return problems;
}

test("every action a workflow runs is pinned to a commit", () => {
	const problems = [];
	for (const name of workflowFiles()) problems.push(...pinProblems(name, readFileSync(join(WORKFLOWS, name), "utf8")));
	assert.deepEqual(problems, []);
});

test("a tag instead of a commit is caught, and so is a pin with no tag comment", () => {
	assert.match(pinProblems("a.yml", "on: push\njobs:\n  one:\n    steps:\n      - uses: actions/checkout@v4\n").join("\n"), /is a moving reference/);
	assert.match(
		pinProblems("b.yml", "on: push\njobs:\n  one:\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n").join("\n"),
		/carries no tag comment/,
	);
	assert.deepEqual(pinProblems("c.yml", "on: push\njobs:\n  one:\n    steps:\n      - uses: ./local-action\n      - uses: docker://alpine:3\n"), []);
});
