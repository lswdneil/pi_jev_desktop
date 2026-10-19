// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileConflictError, isPathInside, matchLineEndings, readFilePreview, saveFile } from "../../src/main/files.ts";

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

	it("resolves the relative path the agent used against the project, not the app's own folder", () => {
		const base = root();
		writeFileSync(join(base, "app.ts"), "export const value = 1;\n");
		expect(readFilePreview(base, join("app.ts")).text).toBe("export const value = 1;\n");
		expect(readFilePreview(base, "app.ts").path).toBe(join(base, "app.ts"));
		// A relative path that climbs out is still outside.
		expect(() => readFilePreview(base, join("..", "app.ts"))).toThrow(/outside/i);
	});

	it("reports binary content without trying to render it", () => {
		const base = root();
		const file = join(base, "image.bin");
		writeFileSync(file, Buffer.from([0, 1, 2, 3]));
		expect(readFilePreview(base, file)).toMatchObject({ text: "", binary: true });
	});

	it("carries the hash an edit has to quote, and refuses to edit what it could not read whole", () => {
		const base = root();
		const text = join(base, "small.ts");
		writeFileSync(text, "const a = 1;\n");
		const preview = readFilePreview(base, text);
		expect(preview).toMatchObject({ editable: true, size: 13 });
		expect(preview.hash).toMatch(/^[0-9a-f]{64}$/);

		// A file past the preview limit is shown and not offered for editing; the read never holds the whole thing.
		const large = join(base, "log.txt");
		writeFileSync(large, `${"x".repeat(1_200_000)}\n`);
		expect(readFilePreview(base, large)).toMatchObject({ truncated: true, editable: false, hash: "", text: "x".repeat(1_000_000) });
	});
});

describe("saving an edit", () => {
	it("writes the text and hands back the hash of what it wrote", () => {
		const base = root();
		const file = join(base, "app.ts");
		writeFileSync(file, "const a = 1;\n");
		const preview = readFilePreview(base, file);

		const saved = saveFile(base, file, "const a = 2;\n", preview.hash);

		expect(readFileSync(file, "utf8")).toBe("const a = 2;\n");
		expect(saved.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(readFilePreview(base, file).hash).toBe(saved.hash);
	});

	it("refuses when the file changed since it was read", () => {
		const base = root();
		const file = join(base, "app.ts");
		writeFileSync(file, "const a = 1;\n");
		const preview = readFilePreview(base, file);
		writeFileSync(file, "const a = 9;\n");

		expect(() => saveFile(base, file, "const a = 2;\n", preview.hash)).toThrow(FileConflictError);
		expect(readFileSync(file, "utf8")).toBe("const a = 9;\n");
	});

	it("refuses a path outside the project", () => {
		const base = root();
		const outside = join(base, "..", "elsewhere.ts");
		writeFileSync(outside, "x");
		expect(() => saveFile(base, outside, "y", "a".repeat(64))).toThrow(/outside/i);
		rmSync(outside, { force: true });
	});

	it("keeps the file's line endings", () => {
		const base = root();
		const file = join(base, "windows.txt");
		writeFileSync(file, "one\r\ntwo\r\n");
		const preview = readFilePreview(base, file);

		saveFile(base, file, "one\nTWO\n", preview.hash);

		expect(readFileSync(file, "utf8")).toBe("one\r\nTWO\r\n");
		expect(matchLineEndings("one\ntwo", "a\nb")).toBe("a\nb");
	});

	it("does not overwrite a binary file with text", () => {
		const base = root();
		const file = join(base, "image.bin");
		writeFileSync(file, Buffer.from([0, 1, 2, 3]));
		expect(() => saveFile(base, file, "text", "a".repeat(64))).toThrow(/not a text file/i);
	});

	it("saves the relative path the panel listed", () => {
		const base = root();
		writeFileSync(join(base, "app.ts"), "one\n");
		const preview = readFilePreview(base, "app.ts");
		saveFile(base, "app.ts", "two\n", preview.hash);
		expect(readFileSync(join(base, "app.ts"), "utf8")).toBe("two\n");
	});
});
