import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { describe } from "../src/app.js";

test("describes a config", () => {
	assert.equal(describe({ name: "mu" }), "mu");
	assert.equal(loadConfig({}).name, "anonymous");
});
