import { describe, expect, it } from "vitest";
import { decodeCbor, encodeCbor } from "../src/cbor/index.ts";

/**
 * The codec the desktop shell would move a transcript with, measured rather than assumed.
 *
 * `bench/desktop/probes.ts` reports the numbers behind `docs/performance-budget.md`; this test is the part
 * that has to stay true in CI: CBOR round-trips exactly, it is not larger than JSONL, and neither codec takes
 * a pathological amount of time on a 10 MB transcript. The absolute bounds are deliberately loose — a shared
 * runner is slow — so only a regression that changes the order of magnitude fails here.
 */

interface Message {
	readonly role: "user" | "assistant" | "tool";
	readonly text: string;
}

function transcript(bytes = 10 * 1024 * 1024): Message[] {
	const messages: Message[] = [];
	let size = 0;
	let index = 0;
	const paragraph =
		"## Checking the failing test\n\nThe token is minted with `exp` in seconds and compared with `now` in milliseconds.\n\n```ts\nexport const expired = (exp: number, now: number) => exp * 1000 <= now;\n```\n";
	while (size < bytes) {
		const message: Message = { role: index % 2 === 0 ? "assistant" : "user", text: `${paragraph}\nMessage ${index}` };
		messages.push(message);
		size += JSON.stringify(message).length;
		index++;
	}
	return messages;
}

describe("the transcript codecs", () => {
	it("round-trips a transcript through CBOR exactly", () => {
		const messages = transcript(64 * 1024);
		const decoded = decodeCbor(encodeCbor(messages));
		expect(decoded).toEqual(messages);
	});

	it("is not larger than one JSON object per line", () => {
		const messages = transcript(1024 * 1024);
		const cbor = encodeCbor(messages).byteLength;
		const jsonl = messages.map((message) => JSON.stringify(message)).join("\n").length;
		// CBOR wins by a few percent on this shape (string-heavy, no binary); the assertion is that it never
		// loses, which is what a reviewer would want to know before choosing it.
		expect(cbor).toBeLessThanOrEqual(jsonl);
	});

	it("handles 10 MB in well under a second each way", () => {
		const messages = transcript();
		const encodeStarted = performance.now();
		const bytes = encodeCbor(messages);
		const encodeMs = performance.now() - encodeStarted;
		const decodeStarted = performance.now();
		const decoded = decodeCbor(bytes);
		const decodeMs = performance.now() - decodeStarted;

		expect(Array.isArray(decoded) ? decoded.length : 0).toBe(messages.length);
		// Loose on purpose: the measured cost is tens of milliseconds. A bound of a second fails only when
		// something became quadratic, which is the regression this test exists for.
		expect(encodeMs).toBeLessThan(1000);
		expect(decodeMs).toBeLessThan(1000);
	});
});
