// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { describe, expect, it } from "vitest";
import { diffLines, splitLines } from "../../src/shared/diff.ts";

/**
 * The diff the file editor shows before a save. It has to be exact about the counts and readable in the rows; the
 * algorithm is the shell's own, so nothing else checks it.
 */

describe("line diff", () => {
	it("splits lines without inventing a last empty one", () => {
		expect(splitLines("")).toEqual([]);
		expect(splitLines("a")).toEqual(["a"]);
		expect(splitLines("a\n")).toEqual(["a"]);
		expect(splitLines("a\n\n")).toEqual(["a", ""]);
		expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
	});

	it("is all common lines when nothing changed", () => {
		const diff = diffLines("a\nb\n", "a\nb\n");
		expect(diff).toMatchObject({ added: 0, removed: 0, tooLarge: false });
		expect(diff.rows.map((row) => row.kind)).toEqual(["same", "same"]);
		expect(diff.rows[1]).toMatchObject({ before: 2, after: 2 });
	});

	it("reports one changed line as a removal and an addition", () => {
		const diff = diffLines("a\nb\nc\n", "a\nB\nc\n");
		expect(diff).toMatchObject({ added: 1, removed: 1 });
		expect(diff.rows.map((row) => [row.kind, row.text])).toEqual([
			["same", "a"],
			["remove", "b"],
			["add", "B"],
			["same", "c"],
		]);
		// The rows keep their own line numbers, which is what the gutters show.
		expect(diff.rows[1]).toMatchObject({ before: 2 });
		expect(diff.rows[1]).not.toHaveProperty("after");
		expect(diff.rows[2]).toMatchObject({ after: 2 });
		expect(diff.rows[2]).not.toHaveProperty("before");
		expect(diff.rows[3]).toMatchObject({ before: 3, after: 3 });
	});

	it("counts an insertion at the end", () => {
		const diff = diffLines("a\n", "a\nb\n");
		expect(diff).toMatchObject({ added: 1, removed: 0 });
		expect(diff.rows).toMatchObject([{ kind: "same" }, { kind: "add", text: "b", after: 2 }]);
	});

	it("keeps the line numbers of the tail right when lines are removed", () => {
		const diff = diffLines("a\nb\nc\nd\n", "a\nd\n");
		expect(diff).toMatchObject({ added: 0, removed: 2 });
		expect(diff.rows[diff.rows.length - 1]).toMatchObject({ kind: "same", text: "d", before: 4, after: 2 });
	});

	it("falls back to exact counts when the pair is too large to align", () => {
		const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
		const after = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? `line ${index}` : `changed ${index}`)).join("\n");
		const diff = diffLines(before, after, 10);
		expect(diff.tooLarge).toBe(true);
		expect(diff).toMatchObject({ added: 20, removed: 20 });
		// The common head is still shown; the middle is what the panel replaces with a sentence.
		expect(diff.rows).toEqual([{ kind: "same", text: "line 0", before: 1, after: 1 }]);
	});
});
