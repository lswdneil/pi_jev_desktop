// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import { inlineSpans, parseMarkdown } from "../../src/shared/markdown.ts";

/**
 * The conversation's Markdown. It renders data, never HTML, so the tests are about structure: what a message's lines
 * become, and that a model writing markup gets text rather than a tag.
 */

describe("blocks", () => {
	it("keeps a fenced code block exactly as written, blank lines and all", () => {
		const blocks = parseMarkdown("before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter");
		expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "code", "paragraph"]);
		const code = blocks[1];
		expect(code).toMatchObject({ kind: "code", language: "ts", text: "const a = 1;\n\nconst b = 2;" });
	});

	it("reads headings by level, and paragraphs until a blank line", () => {
		const blocks = parseMarkdown("# Title\n\nfirst line\nsecond line\n\n## Two");
		expect(blocks).toHaveLength(3);
		expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
		expect(blocks[1]).toMatchObject({ kind: "paragraph" });
		expect(blocks[2]).toMatchObject({ kind: "heading", level: 2 });
	});

	it("reads bullet and numbered lists", () => {
		const bullets = parseMarkdown("- one\n- two");
		expect(bullets[0]).toMatchObject({ kind: "list", ordered: false });
		expect(bullets[0]?.kind === "list" ? bullets[0].items.length : 0).toBe(2);

		const numbered = parseMarkdown("1. first\n2) second");
		expect(numbered[0]).toMatchObject({ kind: "list", ordered: true });
	});

	it("reads a quote", () => {
		const blocks = parseMarkdown("> a quoted line\n> and another");
		expect(blocks[0]).toMatchObject({ kind: "quote" });
		expect(blocks[0]?.kind === "quote" ? blocks[0].spans.map((span) => span.text).join("") : "").toContain("and another");
	});

	it("treats markup as text, because nothing here produces HTML", () => {
		const blocks = parseMarkdown('<script>alert("x")</script>');
		expect(blocks[0]).toMatchObject({ kind: "paragraph" });
		expect(blocks[0]?.kind === "paragraph" ? blocks[0].spans.map((span) => span.text).join("") : "").toBe(
			'<script>alert("x")</script>',
		);
	});
});

describe("inline spans", () => {
	it("separates code, bold and italic", () => {
		expect(inlineSpans("run `npm test` and **do not** skip *it*")).toEqual([
			{ kind: "text", text: "run " },
			{ kind: "code", text: "npm test" },
			{ kind: "text", text: " and " },
			{ kind: "strong", text: "do not" },
			{ kind: "text", text: " skip " },
			{ kind: "em", text: "it" },
		]);
	});

	it("prefers bold over italic for two asterisks", () => {
		expect(inlineSpans("**both**")).toEqual([{ kind: "strong", text: "both" }]);
	});

	it("leaves an unmatched delimiter in the text", () => {
		expect(inlineSpans("a * b")).toEqual([{ kind: "text", text: "a * b" }]);
	});

	it("does not treat an asterisk inside code as markup", () => {
		expect(inlineSpans("`a*b`")).toEqual([{ kind: "code", text: "a*b" }]);
	});

	it("returns nothing for empty text", () => {
		expect(inlineSpans("")).toEqual([]);
		expect(parseMarkdown("")).toEqual([]);
	});
});
