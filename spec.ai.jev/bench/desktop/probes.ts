import type { BenchMetric } from "../../packages/kyrn-judge/bench/run.ts";
import { measure } from "../../packages/kyrn-judge/bench/run.ts";
import { decodeCbor, encodeCbor } from "../../packages/protocol/src/cbor/index.ts";
import { Markdown, type MarkdownTheme } from "../../packages/tui/src/components/markdown.ts";

/**
 * The three costs a shell switch would have to beat, measured without a shell: how a transcript crosses the
 * process boundary, how much one message costs to render, and how streaming deltas turn into frames.
 *
 * Fixed synthetic input, no Electron, no network, no terminal: the numbers are about code, not about the
 * machine's graphics stack. That is on purpose — the question this answers is "would rewriting the UI in
 * another toolkit change these three numbers?", and if it would not, it cannot justify a rewrite either.
 */

/** One assistant message with a code block, a list and a paragraph: what a rendered message actually holds. */
const SAMPLE_MESSAGE = `## Checking the failing test

The failure is in \`test/auth.test.ts\`: the token is minted with \`exp\` in seconds and compared with \`now\` in
milliseconds, so every check after the first second reads as expired.

1. Normalise the clock: compare \`exp * 1000\` with \`now\`.
2. Add a regression test with a fixed clock.
3. Re-run the suite.

\`\`\`ts
export function isExpired(token: { exp: number }, now: number): boolean {
	const expiresAt = token.exp * 1000;
	return Number.isFinite(expiresAt) && expiresAt <= now;
}
\`\`\`

That keeps the maths in one place. \`Number.isFinite\` guards a token with no \`exp\` claim, which the decoder
allows but the verifier must not treat as valid forever.`;

interface TranscriptMessage {
	role: "user" | "assistant" | "tool";
	text: string;
	tool?: { name: string; output: string };
}

/** A transcript of about `bytes` bytes, in the shape the app and the harness actually exchange. */
export function transcript(bytes = 10 * 1024 * 1024): TranscriptMessage[] {
	const messages: TranscriptMessage[] = [];
	let size = 0;
	let index = 0;
	while (size < bytes) {
		const message: TranscriptMessage = {
			role: index % 3 === 0 ? "user" : index % 3 === 1 ? "assistant" : "tool",
			text: `${SAMPLE_MESSAGE}\n\nMessage ${index}: ${"the failing test prints the same assertion each run. ".repeat(4)}`,
			...(index % 3 === 2 ? { tool: { name: "bash", output: "npm test\n".repeat(40) } } : {}),
		};
		messages.push(message);
		size += JSON.stringify(message).length;
		index++;
	}
	return messages;
}

/** The wire format the desktop app uses today: one JSON object per line. */
export function encodeJsonl(messages: readonly TranscriptMessage[]): string {
	return messages.map((message) => JSON.stringify(message)).join("\n");
}

export function decodeJsonl(text: string): unknown[] {
	return text.split("\n").map((line) => JSON.parse(line));
}

/** The theme the terminal UI gives the markdown component, reduced to the styles a measurement needs. */
export const PROBE_THEME: MarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: (text) => text,
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: (text) => text,
	quote: (text) => text,
	quoteBorder: (text) => text,
	hr: (text) => text,
	listBullet: (text) => text,
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
	// Highlighting is the expensive part of rendering a code block, so the probe includes one.
	highlightCode: (code) => code.split("\n").map((line) => line),
};

/** Runs the probes and returns the same metric shape the kernel benchmarks use. */
export async function runDesktopProbes(): Promise<BenchMetric[]> {
	const messages = transcript();
	const jsonl = encodeJsonl(messages);
	const cbor = encodeCbor(messages);

	const jsonlEncode = await measure("transcript.jsonl.encode", () => {
		if (encodeJsonl(messages).length === 0) throw new Error("nothing encoded");
	});
	const jsonlDecode = await measure("transcript.jsonl.decode", () => {
		if (decodeJsonl(jsonl).length !== messages.length) throw new Error("wrong message count");
	});
	const cborEncode = await measure("transcript.cbor.encode", () => {
		if (encodeCbor(messages).byteLength === 0) throw new Error("nothing encoded");
	});
	const cborDecode = await measure("transcript.cbor.decode", () => {
		const decoded = decodeCbor(cbor);
		if (!Array.isArray(decoded) || decoded.length !== messages.length) throw new Error("wrong message count");
	});

	// One message is about 0.1 ms: too small to gate, because the timer noise around it is larger than the
	// signal. Twenty fresh components per sample keep the number above that noise without changing the work
	// being measured (no cache is reused between them).
	const render = await measure("message.markdown.render", () => {
		for (let index = 0; index < 20; index++) {
			const component = new Markdown(SAMPLE_MESSAGE, 0, 0, PROBE_THEME);
			if (component.render(100).length === 0) throw new Error("nothing rendered");
		}
	});

	// Streaming: the same message split into deltas, re-rendered once per frame, for two batch sizes. A shell
	// that redraws per byte pays for the parse on every byte; one that batches pays it per frame.
	const stream = (chunk: number): Promise<BenchMetric> =>
		measure(`stream.render.${chunk === 1 ? "per-byte" : `chunks-of-${chunk}`}`, () => {
			let text = "";
			for (let offset = 0; offset < SAMPLE_MESSAGE.length; offset += chunk) {
				// A fresh component per frame is the worst case: the parse cache of a long-lived one would hide it.
				text = SAMPLE_MESSAGE.slice(0, offset + chunk);
				new Markdown(text, 0, 0, PROBE_THEME).render(100);
			}
		});
	const perByte = await stream(1);
	// 64-byte chunks are what a batching client uses; one frame of a 60 Hz loop is 16.7 ms.
	const batched = await stream(64);

	return [
		{ ...jsonlEncode, name: "transcript.jsonl.encode" },
		{ ...jsonlDecode, name: "transcript.jsonl.decode" },
		{ ...cborEncode, name: "transcript.cbor.encode" },
		{ ...cborDecode, name: "transcript.cbor.decode" },
		render,
		perByte,
		batched,
	];
}

/** The byte sizes the two codecs produce for the same transcript, reported next to the timings. */
export function transcriptBytes(messages: readonly TranscriptMessage[] = transcript()): {
	jsonl: number;
	cbor: number;
} {
	return { jsonl: encodeJsonl(messages).length, cbor: encodeCbor(messages).byteLength };
}
