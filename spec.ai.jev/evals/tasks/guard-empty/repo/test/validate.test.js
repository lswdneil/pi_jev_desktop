import assert from "node:assert/strict";
import { test } from "node:test";
import { validateName } from "../src/validate.js";

test("rejects an empty name", () => {
	assert.throws(() => validateName(""), /name is required/);
	assert.throws(() => validateName("   "), /name is required/);
	assert.equal(validateName("mu"), "mu");
});
