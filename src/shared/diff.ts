// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * A line diff for the file editor.
 *
 * The panel needs one thing: what would change if this were saved. It is not a patch format and it is not
 * git's algorithm; it is the smallest set of rows a person can read, with the counts the header shows.
 *
 * The alignment is a longest-common-subsequence table, which costs `before * after` cells. Two things keep that from
 * being a problem: common leading and trailing lines are trimmed first (an edit in the middle of a 5 000-line file
 * compares only the middle), and a pair that is still too large falls back to counting added and removed lines as
 * multisets, which is exact for the counts and costs linear time. The rows are empty in that case, because a diff no
 * one can read is worse than a sentence saying why there is none.
 */

export type DiffKind = "same" | "add" | "remove";

export interface DiffRow {
	readonly kind: DiffKind;
	readonly text: string;
	/** 1-based line number in the file as it was, for `same` and `remove`. */
	readonly before?: number;
	/** 1-based line number in the file as it would be, for `same` and `add`. */
	readonly after?: number;
}

export interface LineDiff {
	readonly rows: readonly DiffRow[];
	readonly added: number;
	readonly removed: number;
	/** True when the pair was too large to align; `rows` then holds only the common head and tail. */
	readonly tooLarge: boolean;
}

/** Lines without their terminators, and without the empty line a trailing newline would otherwise produce. */
export function splitLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** The default cell budget: 1 000 000 comparisons is a few milliseconds and covers a 1 000-line change. */
export const DEFAULT_DIFF_LIMIT = 1_000_000;

function align(a: readonly string[], b: readonly string[]): readonly { kind: DiffKind; text: string }[] {
	const width = b.length + 1;
	const table = new Int32Array((a.length + 1) * width);
	const at = (i: number, j: number): number => table[i * width + j] ?? 0;
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i * width + j] =
				a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
		}
	}

	const rows: { kind: DiffKind; text: string }[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			rows.push({ kind: "same", text: a[i] as string });
			i++;
			j++;
		} else if (at(i + 1, j) >= at(i, j + 1)) {
			rows.push({ kind: "remove", text: a[i] as string });
			i++;
		} else {
			rows.push({ kind: "add", text: b[j] as string });
			j++;
		}
	}
	while (i < a.length) rows.push({ kind: "remove", text: a[i++] as string });
	while (j < b.length) rows.push({ kind: "add", text: b[j++] as string });
	return rows;
}

function countByMultiset(a: readonly string[], b: readonly string[]): { added: number; removed: number } {
	const counts = new Map<string, number>();
	for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
	let added = 0;
	for (const line of b) {
		const left = counts.get(line) ?? 0;
		if (left > 0) counts.set(line, left - 1);
		else added++;
	}
	let removed = 0;
	for (const left of counts.values()) removed += left;
	return { added, removed };
}

export function diffLines(before: string, after: string, limit: number = DEFAULT_DIFF_LIMIT): LineDiff {
	const a = splitLines(before);
	const b = splitLines(after);

	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

	const middleA = a.slice(head, a.length - tail);
	const middleB = b.slice(head, b.length - tail);
	const rows: DiffRow[] = [];
	for (let index = 0; index < head; index++) {
		rows.push({ kind: "same", text: a[index] as string, before: index + 1, after: index + 1 });
	}

	if (middleA.length * middleB.length > limit) {
		const { added, removed } = countByMultiset(middleA, middleB);
		for (let index = a.length - tail; index < a.length; index++) {
			rows.push({ kind: "same", text: a[index] as string, before: index + 1, after: index + 1 + b.length - a.length });
		}
		return { rows, added, removed, tooLarge: true };
	}

	let beforeLine = head + 1;
	let afterLine = head + 1;
	let added = 0;
	let removed = 0;
	for (const row of align(middleA, middleB)) {
		if (row.kind === "same") rows.push({ ...row, before: beforeLine++, after: afterLine++ });
		else if (row.kind === "remove") {
			rows.push({ ...row, before: beforeLine++ });
			removed++;
		} else {
			rows.push({ ...row, after: afterLine++ });
			added++;
		}
	}
	for (let index = a.length - tail; index < a.length; index++) {
		rows.push({
			kind: "same",
			text: a[index] as string,
			before: index + 1,
			after: index + 1 + b.length - a.length,
		});
	}
	return { rows, added, removed, tooLarge: false };
}
