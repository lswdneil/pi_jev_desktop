import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	BUNDLED_PACKAGES,
	FOREIGN_SCOPES,
	getPublishablePackages,
	publishRefusal,
	PUBLISHABLE_PACKAGES,
} from "./release-packages.mjs";

const dirs = [];
function temp() {
	const dir = mkdtempSync(join(tmpdir(), "mu-publish-guard-"));
	dirs.push(dir);
	return dir;
}

describe("publish guard", () => {
	it("refuses a public manifest in someone else's scope, and says which scope", () => {
		const reason = publishRefusal({ name: "@earendil-works/pi-ai", version: "1.0.2" });
		assert.ok(reason, "expected a refusal");
		assert.match(reason, /@earendil-works\//);
		for (const scope of FOREIGN_SCOPES) assert.ok(scope.startsWith("@"));
	});

	it("refuses a public manifest that is not a package this repository publishes", () => {
		const reason = publishRefusal({ name: "some-other-package", version: "1.0.0" });
		assert.match(reason, /not a package this repository publishes/);
		assert.ok(PUBLISHABLE_PACKAGES.length > 0);
	});

	it("refuses a private manifest, because npm would refuse it anyway", () => {
		const reason = publishRefusal({ name: "@earendil-works/pi-ai", private: true });
		assert.match(reason, /private/);
	});

	it("lets the scope owner publish when they say so explicitly", () => {
		assert.equal(publishRefusal({ name: "@earendil-works/pi-ai" }, { allowForeignScope: true }), undefined);
		assert.equal(
			publishRefusal({ name: "spec-ai-agent", version: "0.1.8" }, { allowForeignScope: false }),
			undefined,
			"the repository's own package needs no override",
		);
	});
});

describe("what publish.mjs is allowed to see", () => {
	it("finds no publishable workspace package in this checkout", () => {
		// Every harness package is private and the published package is built, not a workspace member.
		assert.deepEqual(getPublishablePackages({ allowForeignScope: false }), []);
		assert.ok(BUNDLED_PACKAGES.length >= 10, "the bundled set is what the runtime-deps check covers");
	});

	it("would publish a workspace member only if it were the published package", () => {
		// The guard is a function of the manifest, so a manifest that names spec-ai-agent passes it.
		assert.equal(publishRefusal({ name: "spec-ai-agent", version: "0.1.8" }, { allowForeignScope: false }), undefined);
	});
});

describe("a checkout whose packages are not private", () => {
	it("is refused for the scope, not silently published", () => {
		const dir = temp();
		mkdirSync(join(dir, "packages"), { recursive: true });
		writeFileSync(join(dir, "packages", "x.json"), "{}");
		// The real check reads this checkout's manifests; the point of the fixture is the guard's verdict on
		// a manifest that lost its private flag.
		const manifest = { name: "@earendil-works/pi-ai", version: "1.0.2" };
		assert.match(String(publishRefusal(manifest, { allowForeignScope: false })), /scope/);
	});
});
