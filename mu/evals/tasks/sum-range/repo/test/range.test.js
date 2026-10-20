import assert from "node:assert/strict";
import { test } from "node:test";
import { sumRange } from "../src/range.js";

test("sums 1..n inclusive", () => {
	assert.equal(sumRange(3), 6);
	assert.equal(sumRange(1), 1);
});
