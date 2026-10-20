// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The little bit of Markdown a conversation actually needs.
 *
 * A model answers in Markdown, and showing the backticks is showing the model's plumbing instead of its point. This is
 * deliberately not a Markdown engine: headings, paragraphs, fenced code, bullet and numbered lists, quotes, and three
 * inline spans (`code`, **bold**, *italic*). Everything else is text.
 *
 * It parses to data, never to HTML. The renderer builds React elements from it, so a model that writes `<script>` gets a
 * paragraph that says `<script>` — the page has no way to turn text into markup.
 */

export interface InlineSpan {
	readonly kind: "text" | "code" | "strong" | "em" | "link";
	readonly text: string;
	/** Only on `link`: an http(s) address, which is the only kind the preview opens. */
	readonly href?: string;
}

export type Block =
	| { readonly kind: "paragraph"; readonly spans: readonly InlineSpan[] }
	| { readonly kind: "heading"; readonly level: number; readonly spans: readonly InlineSpan[] }
	| { readonly kind: "code"; readonly language: string; readonly text: string }
	| { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly (readonly InlineSpan[])[] }
	| { readonly kind: "quote"; readonly spans: readonly InlineSpan[] }
	| {
			readonly kind: "table";
			readonly headers: readonly (readonly InlineSpan[])[];
			readonly align: readonly TableAlign[];
			readonly rows: readonly (readonly (readonly InlineSpan[])[])[];
	  };

export type TableAlign = "left" | "center" | "right";

/** Inline spans, longest-delimiter first so `**bold**` does not become two italics. */
export function inlineSpans(text: string): InlineSpan[] {
	const spans: InlineSpan[] = [];
	let rest = text;
	const patterns: readonly { readonly kind: InlineSpan["kind"]; readonly pattern: RegExp }[] = [
		{ kind: "code", pattern: /^`([^`]+)`/ },
		{ kind: "strong", pattern: /^\*\*([^*]+)\*\*/ },
		{ kind: "em", pattern: /^\*([^*]+)\*/ },
	];
	// Links are the one span with a second field, so they are matched here rather than in the table above. Only
	// http(s) becomes a link: `javascript:`, `file:` and `data:` stay text, which is the whole rule.
	const markdownLink = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
	const bareLink = /^(https?:\/\/[^\s<>()]+)/;
	let buffer = "";
	const flush = (): void => {
		if (buffer !== "") spans.push({ kind: "text", text: buffer });
		buffer = "";
	};

	while (rest !== "") {
		const labelled = markdownLink.exec(rest);
		if (labelled !== null) {
			flush();
			spans.push({ kind: "link", text: labelled[1] ?? "", href: labelled[2] ?? "" });
			rest = rest.slice(labelled[0].length);
			continue;
		}
		const bare = bareLink.exec(rest);
		if (bare !== null) {
			flush();
			const href = (bare[1] ?? "").replace(/[.,;:]+$/, "");
			if (href.length > "https://".length) {
				spans.push({ kind: "link", text: href, href });
				rest = rest.slice(href.length);
				continue;
			}
		}
		const match = patterns.map((entry) => ({ entry, found: entry.pattern.exec(rest) })).find((candidate) => candidate.found !== null);
		if (match?.found) {
			flush();
			spans.push({ kind: match.entry.kind, text: match.found[1] ?? "" });
			rest = rest.slice(match.found[0].length);
			continue;
		}
		const char = rest[0] ?? "";
		buffer += char;
		rest = rest.slice(1);
	}
	flush();
	return spans;
}

function splitTableRow(line: string): string[] {
	const trimmed = line.trim();
	const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
	const withoutEnd = body.endsWith("|") ? body.slice(0, -1) : body;
	return withoutEnd.split("|").map((cell) => cell.trim());
}

function tableAligns(line: string): readonly TableAlign[] | null {
	if (!line.includes("-")) return null;
	const cells = splitTableRow(line);
	if (cells.length === 0) return null;
	const aligns: TableAlign[] = [];
	for (const cell of cells) {
		const match = /^(:)?-{3,}(:)?$/.exec(cell);
		if (match === null) return null;
		aligns.push(match[1] === ":" && match[2] === ":" ? "center" : match[2] === ":" ? "right" : "left");
	}
	return aligns;
}

function tableAt(
	lines: readonly string[],
	index: number,
): { readonly headers: readonly string[]; readonly align: readonly TableAlign[] } | null {
	const header = lines[index] ?? "";
	if (!header.includes("|")) return null;
	const align = tableAligns(lines[index + 1] ?? "");
	if (align === null) return null;
	const headers = splitTableRow(header);
	if (headers.length !== align.length) return null;
	return { headers, align };
}

/** The blocks of a message. Fenced code keeps everything inside it, including blank lines and backticks. */
export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	const lines = text.replaceAll("\r\n", "\n").split("\n");
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (line.trim() === "") {
			index++;
			continue;
		}

		const fence = /^\s*```\s*([A-Za-z0-9_+#.-]*)\s*$/.exec(line);
		if (fence !== null) {
			const language = fence[1] ?? "";
			const body: string[] = [];
			index++;
			while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
				body.push(lines[index] ?? "");
				index++;
			}
			index++; // the closing fence
			blocks.push({ kind: "code", language, text: body.join("\n") });
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading !== null) {
			blocks.push({ kind: "heading", level: (heading[1] ?? "#").length, spans: inlineSpans(heading[2] ?? "") });
			index++;
			continue;
		}

		const table = tableAt(lines, index);
		if (table !== null) {
			const rows: InlineSpan[][][] = [];
			index += 2;
			while (index < lines.length) {
				const current = lines[index] ?? "";
				if (current.trim() === "" || !current.includes("|")) break;
				const cells = splitTableRow(current);
				rows.push(table.headers.map((_, cellIndex) => inlineSpans(cells[cellIndex] ?? "")));
				index++;
			}
			blocks.push({
				kind: "table",
				headers: table.headers.map((cell) => inlineSpans(cell)),
				align: table.align,
				rows,
			});
			continue;
		}

		const quote = /^>\s?(.*)$/.exec(line);
		if (quote !== null) {
			const body: string[] = [quote[1] ?? ""];
			index++;
			while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
				body.push((lines[index] ?? "").replace(/^>\s?/, ""));
				index++;
			}
			blocks.push({ kind: "quote", spans: inlineSpans(body.join("\n")) });
			continue;
		}

		const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
		const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (bullet !== null || numbered !== null) {
			const ordered = numbered !== null;
			const items: InlineSpan[][] = [];
			while (index < lines.length) {
				const current = lines[index] ?? "";
				const next = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(current) : /^\s*[-*+]\s+(.*)$/.exec(current);
				if (next === null) break;
				items.push(inlineSpans(next[1] ?? ""));
				index++;
			}
			blocks.push({ kind: "list", ordered, items });
			continue;
		}

		// A paragraph is the lines until a blank line or the start of another block.
		const paragraph: string[] = [line];
		index++;
		while (index < lines.length) {
			const current = lines[index] ?? "";
			if (
				current.trim() === "" ||
				/^\s*```/.test(current) ||
				/^#{1,6}\s+/.test(current) ||
				tableAt(lines, index) !== null ||
				/^>\s?/.test(current) ||
				/^\s*([-*+]|\d+[.)])\s+/.test(current)
			) {
				break;
			}
			paragraph.push(current);
			index++;
		}
		blocks.push({ kind: "paragraph", spans: inlineSpans(paragraph.join("\n")) });
	}

	return blocks;
}
