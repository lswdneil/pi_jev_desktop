import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../src/duration.js";

test("parses each unit", () => {
	assert.equal(parseDuration("250ms"), 250);
	assert.equal(parseDuration("2s"), 2000);
	assert.equal(parseDuration("1m"), 60_000);
});
