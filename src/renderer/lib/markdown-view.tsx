// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * A message, rendered.
 *
 * The parser (`shared/markdown.ts`) returns blocks and spans; this turns them into React elements. Nothing here builds
 * HTML from a string, so a model that writes markup cannot write markup — the worst it can do is have a paragraph that
 * says `<script>`. Links are data too: the parser emits http(s) addresses, and a click asks the app to preview one.
 */

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Block, type InlineSpan, parseMarkdown } from "../../shared/markdown.ts";
import { highlight, type HighlightToken } from "./highlight.ts";

export function Markdown({
	text,
	onOpenLink,
	labels,
	onCopy,
}: {
	readonly text: string;
	/** A link a model wrote: http(s) only, since that is all the parser emits. */
	readonly onOpenLink?: (url: string) => void;
	/** The shell's words for the code block's copy button. */
	readonly labels?: (key: string) => string;
	/** The preload's clipboard bridge; the page itself is denied the browser clipboard permission. */
	readonly onCopy?: (text: string) => Promise<void>;
}): React.JSX.Element {
	const blocks = parseMarkdown(text);
	return (
		<div className="markdown" data-markdown-blocks={blocks.length}>
			{blocks.map((block, index) => (
				<BlockView key={index} block={block} onOpenLink={onOpenLink} labels={labels} onCopy={onCopy} />
			))}
		</div>
	);
}

function BlockView({
	block,
	onOpenLink,
	labels,
	onCopy,
}: {
	readonly block: Block;
	readonly onOpenLink: ((url: string) => void) | undefined;
	readonly labels: ((key: string) => string) | undefined;
	readonly onCopy: ((text: string) => Promise<void>) | undefined;
}): React.JSX.Element {
	switch (block.kind) {
		case "code":
			return <CodeBlock text={block.text} language={block.language} labels={labels} onCopy={onCopy} />;
		case "heading": {
			const content = <Spans spans={block.spans} onOpenLink={onOpenLink} />;
			if (block.level === 1) return <h1>{content}</h1>;
			if (block.level === 2) return <h2>{content}</h2>;
			return <h3>{content}</h3>;
		}
		case "quote":
			return (
				<blockquote>
					<Spans spans={block.spans} onOpenLink={onOpenLink} />
				</blockquote>
			);
		case "list":
			return block.ordered ? (
				<ol data-block="list">
					{block.items.map((item, index) => (
						<li key={index}>
							<Spans spans={item} onOpenLink={onOpenLink} />
						</li>
					))}
				</ol>
			) : (
				<ul data-block="list">
					{block.items.map((item, index) => (
						<li key={index}>
							<Spans spans={item} onOpenLink={onOpenLink} />
						</li>
					))}
				</ul>
			);
		case "paragraph":
			return (
				<p data-block="paragraph">
					<Spans spans={block.spans} onOpenLink={onOpenLink} />
				</p>
			);
	}
}

function CodeBlock({
	text,
	language,
	labels,
	onCopy,
}: {
	readonly text: string;
	readonly language: string | undefined;
	readonly labels: ((key: string) => string) | undefined;
	readonly onCopy: ((text: string) => Promise<void>) | undefined;
}): React.JSX.Element {
	const [tokens, setTokens] = useState<readonly (readonly HighlightToken[])[] | undefined>(undefined);
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => {
		let alive = true;
		setTokens(undefined);
		void highlight(text, language).then((next) => {
			if (alive) setTokens(next);
		});
		return () => {
			alive = false;
		};
	}, [text, language]);

	useEffect(
		() => () => {
			if (timer.current !== undefined) window.clearTimeout(timer.current);
		},
		[],
	);

	const copy = (): void => {
		void (onCopy === undefined ? navigator.clipboard.writeText(text) : onCopy(text))
			.then(() => {
				setCopied(true);
				window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {});
	};

	return (
		<div className="code-block" data-block="code">
			<div className="code-block-head">
				<span className="code-lang">{language ?? "text"}</span>
				<button type="button" className="code-copy" data-testid="copy-code" onClick={copy}>
					{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
					{copied ? (labels?.("conversation.copied") ?? "Copied") : (labels?.("conversation.copyCode") ?? "Copy")}
				</button>
			</div>
			<pre className="code">
				<code data-language={language}>
					{tokens === undefined
						? text
						: tokens.map((line, index) => (
								<span key={index} className="code-line">
									{line.map((token, tokenIndex) => (
										<span key={tokenIndex} style={token.color === undefined ? undefined : { color: token.color }}>
											{token.content}
										</span>
									))}
									{index === tokens.length - 1 ? null : "\n"}
								</span>
							))}
				</code>
			</pre>
		</div>
	);
}

function Spans({
	spans,
	onOpenLink,
}: {
	readonly spans: readonly InlineSpan[];
	readonly onOpenLink: ((url: string) => void) | undefined;
}): React.JSX.Element {
	return (
		<>
			{spans.map((span, index) => {
				if (span.kind === "code") return <code key={index}>{span.text}</code>;
				if (span.kind === "strong") return <strong key={index}>{span.text}</strong>;
				if (span.kind === "em") return <em key={index}>{span.text}</em>;
				if (span.kind === "link") {
					const href = span.href ?? "";
					return (
						<a
							key={index}
							href={href}
							data-testid="message-link"
							// The conversation never navigates itself: a link is a preview request, and the panel it opens
							// has the app's own navigation rules.
							onClick={(event) => {
								event.preventDefault();
								onOpenLink?.(href);
							}}
						>
							{span.text}
						</a>
					);
				}
				return <span key={index}>{span.text}</span>;
			})}
		</>
	);
}
