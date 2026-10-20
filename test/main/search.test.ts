// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchProjectFiles } from "../../src/main/search.ts";

/**
 * Quick open answers with the project's own files. The rules that matter are which files it is allowed to see, how it
 * ranks them, and that it stops: a search that walks a `node_modules` tree is a window that stops responding.
 */

const roots: string[] = [];

function project(files: readonly string[]): string {
	const root = mkdtempSync(join(tmpdir(), "spec-ai-jev-search-"));
	roots.push(root);
	for (const file of files) {
		const path = join(root, file);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "");
	}
	return root;
}

afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("quick open", () => {
	it("finds a file by name, relative to the project and with forward slashes", () => {
		const root = project(["src/app.ts", "src/lib/parse.ts", "README.md"]);
		expect(searchProjectFiles(root, "app")).toEqual([{ path: "src/app.ts", name: "app.ts", score: 85 }]);
		expect(searchProjectFiles(root, "readme")[0]).toMatchObject({ path: "README.md", score: 85 });
	});

	it("ranks a name match above a path match, and a path match above a subsequence", () => {
		const root = project(["src/app.ts", "docs/notes-about-app.md", "src/alpha/pretty-thing.ts"]);
		const hits = searchProjectFiles(root, "app");
		expect(hits[0]?.path).toBe("src/app.ts");
		expect(hits.map((hit) => hit.path)).toContain("docs/notes-about-app.md");
		expect(hits.find((hit) => hit.path === "src/app.ts")?.score).toBeGreaterThan(
			hits.find((hit) => hit.path === "docs/notes-about-app.md")?.score ?? 0,
		);
	});

	it("matches a subsequence, for the half-remembered path", () => {
		const root = project(["src/alpha/pretty-thing.ts"]);
		const hits = searchProjectFiles(root, "sapt");
		expect(hits.map((hit) => hit.path)).toEqual(["src/alpha/pretty-thing.ts"]);
		expect(hits[0]?.score).toBe(20);
	});

	it("never offers dependencies or build output", () => {
		const root = project([
			"src/app.ts",
			"node_modules/left-pad/index.js",
			"dist/app.js",
			".git/config",
			"out/main.js",
			".hidden/secret.ts",
			"resources/harness/spec-ai-agent/examples/app-extension.ts",
		]);
		expect(searchProjectFiles(root, "app").map((hit) => hit.path)).toEqual(["src/app.ts"]);
		expect(searchProjectFiles(root, "index")).toEqual([]);
		expect(searchProjectFiles(root, "secret")).toEqual([]);
	});

	it("bounds the answer, and says nothing for an empty query", () => {
		const root = project(Array.from({ length: 30 }, (_, index) => `src/file-${index}.ts`));
		expect(searchProjectFiles(root, "file")).toHaveLength(30);
		expect(searchProjectFiles(root, "file", { limit: 5 })).toHaveLength(5);
		expect(searchProjectFiles(root, "file", { limit: 0 })).toEqual([]);
		expect(searchProjectFiles(root, "   ")).toEqual([]);
	});
});
