/**
 * Splits a long tool output into pieces of at most `size` characters, on line boundaries; a line longer
 * than the size becomes pieces of its own.
 *
 * It lives here rather than in the feature that uses it for two reasons: a batch request and a benchmark
 * both need it without dragging in the extension runtime (and with it the host package's built code), and
 * the rule is easier to test as a function than through an event handler.
 */
export function chunkLines(text: string, size: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const line of text.split("\n")) {
		if (current && current.length + line.length + 1 > size) {
			chunks.push(current);
			current = "";
		}
		current = current ? `${current}\n${line}` : line;
		while (current.length > size) {
			chunks.push(current.slice(0, size));
			current = current.slice(size);
		}
	}
	if (current) chunks.push(current);
	return chunks;
}
