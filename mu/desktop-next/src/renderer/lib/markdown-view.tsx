// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * A message, rendered.
 *
 * The parser (`shared/markdown.ts`) returns blocks and spans; this turns them into React elements. Nothing here builds
 * HTML from a string, so a model that writes markup cannot write markup — the worst it can do is have a paragraph that
 * says `<script>`.
 */

import { type Block, type InlineSpan, parseMarkdown } from "../../shared/markdown.ts";

export function Markdown({ text }: { readonly text: string }): React.JSX.Element {
	const blocks = parseMarkdown(text);
	return (
		<div className="markdown" data-markdown-blocks={blocks.length}>
			{blocks.map((block, index) => (
				<BlockView key={index} block={block} />
			))}
		</div>
	);
}

function BlockView({ block }: { readonly block: Block }): React.JSX.Element {
	switch (block.kind) {
		case "code":
			return (
				<pre className="code" data-block="code">
					<code data-language={block.language}>{block.text}</code>
				</pre>
			);
		case "heading": {
			const content = <Spans spans={block.spans} />;
			if (block.level === 1) return <h1>{content}</h1>;
			if (block.level === 2) return <h2>{content}</h2>;
			return <h3>{content}</h3>;
		}
		case "quote":
			return (
				<blockquote>
					<Spans spans={block.spans} />
				</blockquote>
			);
		case "list":
			return block.ordered ? (
				<ol data-block="list">
					{block.items.map((item, index) => (
						<li key={index}>
							<Spans spans={item} />
						</li>
					))}
				</ol>
			) : (
				<ul data-block="list">
					{block.items.map((item, index) => (
						<li key={index}>
							<Spans spans={item} />
						</li>
					))}
				</ul>
			);
		case "paragraph":
			return (
				<p data-block="paragraph">
					<Spans spans={block.spans} />
				</p>
			);
	}
}

function Spans({ spans }: { readonly spans: readonly InlineSpan[] }): React.JSX.Element {
	return (
		<>
			{spans.map((span, index) => {
				if (span.kind === "code") return <code key={index}>{span.text}</code>;
				if (span.kind === "strong") return <strong key={index}>{span.text}</strong>;
				if (span.kind === "em") return <em key={index}>{span.text}</em>;
				return <span key={index}>{span.text}</span>;
			})}
		</>
	);
}
