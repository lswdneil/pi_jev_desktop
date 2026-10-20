/**
 * Where a piece of content came from, and how much it may be believed.
 *
 * The judge already asks "does this passage look like an instruction aimed at an AI?" (`tool.injection`).
 * That is a probabilistic question, and a wrong answer — one in a hundred — is enough to let a web page
 * drive a write. This module is the structural half: content that arrived from outside the conversation
 * carries a mark in the transcript, and a write that follows such content needs the person's word for it.
 *
 * The mark is plain text on purpose. It survives compaction because compaction keeps text it keeps at all;
 * it is visible to the model, which then knows the passage is not the person speaking; and it costs a
 * handful of bytes instead of a side table that every consumer would have to learn to read.
 */

export type ContentSource = "web" | "search" | "browser" | "mcp" | "file" | "user" | "project";

export type TrustLevel = "untrusted" | "user" | "project";

export interface Provenance {
	readonly source: ContentSource;
	readonly trust: TrustLevel;
}

/**
 * Trust by source.
 *
 * `user` and `project` content is what the person typed or committed: it may instruct. Everything that
 * arrived over a wire — a page, a search result, a browser snapshot, an MCP server's answer — may not,
 * however friendly it looks. A file read is `project`: the person pointed at it, so it speaks with the
 * repository's authority, not the internet's.
 */
export function provenanceFor(source: ContentSource): Provenance {
	switch (source) {
		case "user":
			return { source, trust: "user" };
		case "file":
		case "project":
			return { source: "project", trust: "project" };
		case "web":
		case "search":
		case "browser":
		case "mcp":
			return { source, trust: "untrusted" };
		default:
			return { source: "web", trust: "untrusted" };
	}
}

/** The source a tool's result comes from, by the name the model calls it. */
export function sourceOfTool(toolName: string): ContentSource {
	if (toolName.startsWith("mcp__") || toolName.startsWith("mcp:")) return "mcp";
	if (toolName === "web_fetch" || toolName === "fetch" || toolName === "web") return "web";
	if (toolName === "web_search" || toolName === "search") return "search";
	if (toolName.startsWith("browse") || toolName === "browser") return "browser";
	if (toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls") return "file";
	return "project";
}

/** Tools that change the world. The guard asks about these, and only these. */
const WRITE_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "bash", "powershell", "multi_edit", "apply_patch"]);

export function isWriteTool(toolName: string): boolean {
	return WRITE_TOOLS.has(toolName);
}

/** Shown to the model, and scanned for by the guard. Keep it one token-ish prefix so it is cheap. */
export const UNTRUSTED_MARKER_PREFIX = "⟦untrusted:";

/** `⟦untrusted:web⟧` — one marker line, no URLs, no timestamps, nothing that varies per call. */
export function untrustedMarker(provenance: Provenance): string {
	return `${UNTRUSTED_MARKER_PREFIX}${provenance.source}⟧`;
}

/**
 * Prefixes a result with its provenance marker. Content already marked is left alone, so a result that
 * passes through two layers does not end up with two markers.
 *
 * The marker goes on its own line *before* the text: a passage that begins with "ignore previous
 * instructions" must not be able to push the marker out of view.
 */
export function markUntrusted(text: string, provenance: Provenance): string {
	if (provenance.trust !== "untrusted") return text;
	if (text.startsWith(UNTRUSTED_MARKER_PREFIX)) return text;
	return `${untrustedMarker(provenance)}\n${text}`;
}

/** The source named by the first marker in a piece of text, if it has one. */
export function markerIn(text: string): ContentSource | undefined {
	const match = new RegExp(`${UNTRUSTED_MARKER_PREFIX}([a-z]+)⟧`).exec(text);
	return (match?.[1] as ContentSource | undefined) ?? undefined;
}

/** What the transcript says: a user message, or a tool result with its source. */
export type TranscriptEntry =
	| { readonly role: "user"; readonly text: string }
	| { readonly role: "tool"; readonly tool: string; readonly text: string };

export interface WriteDecision {
	readonly action: "allow" | "approve";
	/** Why, in one sentence the model or the approval dialog can show. */
	readonly reason: string;
	/** The chain: which untrusted content, after which user message, and whether that message covers it. */
	readonly chain: readonly string[];
	/** The source of the untrusted content that was found, when there was one. */
	readonly source?: ContentSource;
}

/** Words that make a user message an instruction to act on something they just saw. */
// Two patterns rather than one: `\b` needs a word character on one side, and CJK characters are not word
// characters to JavaScript, so a boundary-anchored alternation would never match "按那个页面" — the very
// sentence this has to recognise.
const AUTHORISING_ASCII =
	/\b(?:apply|do|use|follow|delete|remove|rm|write|edit|change|update|fix|install|run|execute)\b|according to|as (?:the|that) (?:page|site|docs?|server)/iu;
const AUTHORISING_CJK = /照|按|删除|执行|修改|运行|应用|照着/u;

/**
 * Whether the person's message authorises acting on content from `source`.
 *
 * Deliberately simple and conservative: a message that names the source, or that uses an imperative and
 * refers to the page/server/docs it just produced, counts. Everything else does not — including "thanks",
 * which is the most common message after a web lookup and authorises nothing.
 */
export function authorises(words: string, source: ContentSource | undefined): boolean {
	const text = words.trim();
	if (!text || !source) return false;
	// The source, or the thing that carried it: a person says "that page" or "那个页面", not "web_fetch".
	const namesSource =
		new RegExp(`\\b${source}\\b|\\b(?:page|site|docs?|server|results?)\\b`, "iu").test(text) ||
		/页面|网页|文档|资料|结果|服务器|官网/u.test(text);
	if (!namesSource) return false;
	return AUTHORISING_ASCII.test(text) || AUTHORISING_CJK.test(text);
}

/**
 * The structural write guard.
 *
 * It is fed the transcript (or its tail) and answers one question: may this write run, or does the person
 * have to say yes? A write is authorised when the newest user message after the newest untrusted content
 * asks for it. Untrusted content with no user message after it always needs approval — that is the case
 * this exists for: a page tells the model to run `rm -rf`, and no person ever said so.
 */
export function writeDecision(
	entry: { tool: string; args?: string },
	transcript: readonly TranscriptEntry[],
): WriteDecision {
	if (!isWriteTool(entry.tool)) {
		return { action: "allow", reason: "not a write", chain: [] };
	}
	let lastUser = -1;
	let lastUntrusted = -1;
	let source: ContentSource | undefined;
	transcript.forEach((item, index) => {
		if (item.role === "user") {
			lastUser = index;
			return;
		}
		const marked = markerIn(item.text);
		if (marked) {
			lastUntrusted = index;
			source = marked;
		}
	});
	if (lastUntrusted === -1) {
		return { action: "allow", reason: "no untrusted content in the transcript", chain: [] };
	}
	const chain = [`untrusted content from ${source} at entry ${lastUntrusted + 1} of ${transcript.length}`];
	const userText =
		lastUser === -1
			? ""
			: transcript[lastUser]?.role === "user"
				? (transcript[lastUser] as { text: string }).text
				: "";
	if (lastUser > lastUntrusted) {
		chain.push(`the person's message at entry ${lastUser + 1} came after it`);
		if (authorises(userText, source)) {
			chain.push(`and asks for it: "${userText.trim().slice(0, 120)}"`);
			return { action: "allow", reason: "the person asked for this after seeing it", chain, source };
		}
		chain.push(`but does not ask for it: "${userText.trim().slice(0, 120)}"`);
		return { action: "approve", reason: `a write follows untrusted ${source} content`, chain, source };
	}
	chain.push(
		lastUser === -1
			? "no user message has been seen at all"
			: `the newest user message (entry ${lastUser + 1}) came before it`,
	);
	return {
		action: "approve",
		reason: `a write follows untrusted ${source} content, and the person has not asked for it since`,
		chain,
		source,
	};
}
