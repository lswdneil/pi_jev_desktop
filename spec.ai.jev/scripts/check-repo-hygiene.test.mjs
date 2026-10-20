import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkRepoHygiene, DEAD_PATHS, KEEP_PATHS, REMOVED_PATHS, violations } from "./check-repo-hygiene.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "mu-hygiene-"));
	for (const path of KEEP_PATHS) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), path.endsWith(".yml") ? "a: b\n" : "x");
	}
	return root;
}

test("a clean tree passes", () => {
	const root = fixture();
	try {
		const result = checkRepoHygiene(root);
		assert.deepEqual(result, { dead: [], missingKeep: [], restored: [] });
		assert.deepEqual(violations(result), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("every dead path is reported", () => {
	const root = fixture();
	try {
		for (const path of DEAD_PATHS) {
			writeFileSync(join(root, path), "x");
		}
		const result = checkRepoHygiene(root);
		assert.deepEqual(result.dead, DEAD_PATHS);
		assert.equal(violations(result).length, DEAD_PATHS.length);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a missing keep path fails, because deleting it breaks the installer or the READMEs", () => {
	const root = fixture();
	try {
		rmSync(join(root, "desktop/resources/app.icns"));
		const result = checkRepoHygiene(root);
		assert.deepEqual(result.missingKeep, ["desktop/resources/app.icns"]);
		assert.match(violations(result)[0], /keep path is missing/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a removed file that comes back is reported", () => {
	const root = fixture();
	try {
		for (const path of REMOVED_PATHS) {
			writeFileSync(join(root, path), "x");
		}
		const result = checkRepoHygiene(root);
		assert.deepEqual(result.restored, REMOVED_PATHS);
		assert.match(violations(result)[0], /removed file is back/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
