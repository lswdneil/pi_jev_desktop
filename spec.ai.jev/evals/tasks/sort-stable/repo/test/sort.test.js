import assert from "node:assert/strict";
import { test } from "node:test";
import { byScore } from "../src/sort.js";

test("sorts by score, stably", () => {
	const items = [
		{ id: "a", score: 1 },
		{ id: "b", score: 3 },
		{ id: "c", score: 3 },
		{ id: "d", score: 2 },
	];
	assert.deepEqual(byScore(items).map((item) => item.id), ["b", "c", "d", "a"]);
});
