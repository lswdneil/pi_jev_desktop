// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPathInside, readFilePreview } from "../../src/main/files.ts";

const roots: string[] = [];

function root(): string {
	const path = mkdtempSync(join(tmpdir(), "spec-ai-jev-files-"));
	roots.push(path);
	return path;
}

afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("file preview", () => {
	it("reads a text file inside the project", () => {
		const base = root();
		const file = join(base, "src.ts");
		writeFileSync(file, "export const value = 1;\n", "utf8");
		expect(readFilePreview(base, file)).toMatchObject({ text: "export const value = 1;\n", binary: false, truncated: false });
	});

	it("refuses a path outside the project", () => {
		const base = root();
		const outside = join(base, "..", "outside.txt");
		expect(isPathInside(base, join(base, "inside.txt"))).toBe(true);
		expect(isPathInside(base, outside)).toBe(false);
		expect(() => readFilePreview(base, outside)).toThrow(/outside/i);
	});

	it("reports binary content without trying to render it", () => {
		const base = root();
		const file = join(base, "image.bin");
		writeFileSync(file, Buffer.from([0, 1, 2, 3]));
		expect(readFilePreview(base, file)).toMatchObject({ text: "", binary: true });
	});
});
