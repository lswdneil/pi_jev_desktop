import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

test("prints JSON when asked", () => {
	const result = spawnSync(process.execPath, ["src/cli.js", "--json"], { encoding: "utf8" });
	assert.equal(result.status, 0);
	assert.deepEqual(JSON.parse(result.stdout), { name: "mu" });
});
