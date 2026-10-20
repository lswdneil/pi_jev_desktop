import {
	type ContentSource,
	markerIn,
	markUntrusted,
	provenanceFor,
	sourceOfTool,
	type TranscriptEntry,
	writeDecision,
} from "@earendil-works/pi-coding-agent";

/**
 * The structural half of injection defence, on the kernel side: mark content that came from outside,
 * and answer one question about a write — did the person ask for it after seeing that content?
 *
 * The judge's `tool.injection` decision stays as the content layer ("does this passage look like an
 * instruction?"). This layer does not care how the content looks: a page that reads like documentation and
 * ends with `rm -rf` is marked all the same, and a write after it needs the person's word. Both have to
 * pass, which is the point — a judge that is wrong one time in a hundred should not be enough.
 */

export interface ToolResultMark {
	readonly text: string;
	/** True when this edit added the marker (false for trusted tools, and for text that already had one). */
	readonly marked: boolean;
}

/** Marks one tool result with its provenance, when its tool is an outside source. */
export function markToolResult(toolName: string, text: string): ToolResultMark {
	const provenance = provenanceFor(sourceOfTool(toolName));
	if (provenance.trust !== "untrusted") return { text, marked: false };
	const marked = markUntrusted(text, provenance);
	return { text: marked, marked: marked !== text };
}

/** One message as the guard reads it: what the person said, or what a tool brought in. */
export interface GuardEntry {
	readonly role: "user" | "tool";
	readonly text: string;
	readonly tool?: string;
}

export interface GuardVerdict {
	/** The untrusted source a write would be following, when the person has not asked for it. */
	readonly source: ContentSource;
	readonly reason: string;
	readonly chain: readonly string[];
}

/**
 * Whether this call must be decided by the person rather than by a mode, a grant or a judge.
 *
 * `entries` is the conversation in order (what the session branch holds). The marker is in the text, so a
 * compacted conversation that kept a message keeps its marker — nothing extra has to be threaded through.
 */
export function untrustedWriteVerdict(toolName: string, entries: readonly GuardEntry[]): GuardVerdict | undefined {
	const transcript: TranscriptEntry[] = entries.map((entry) =>
		entry.role === "user"
			? { role: "user" as const, text: entry.text }
			: { role: "tool" as const, tool: entry.tool ?? "unknown", text: entry.text },
	);
	const decision = writeDecision({ tool: toolName }, transcript);
	if (decision.action !== "approve" || decision.source === undefined) return undefined;
	return { source: decision.source, reason: decision.reason, chain: decision.chain };
}

/** The source of the newest untrusted marker in a set of messages, for display. */
export function newestUntrustedSource(entries: readonly GuardEntry[]): ContentSource | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry) continue;
		const source = markerIn(entry.text);
		if (source) return source;
	}
	return undefined;
}
