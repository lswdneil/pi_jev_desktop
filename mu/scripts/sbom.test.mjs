import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSbom, componentsFromLock, hashOf, nameOf, parseSbomArgs, purlFor } from "./sbom.mjs";

const LOCK = {
	lockfileVersion: 3,
	packages: {
		"": { name: "pi-monorepo", version: "0.0.3" },
		"node_modules/alpha": {
			version: "1.2.3",
			resolved: "https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz",
			integrity: "sha512-DYV5LSsVMnzq0lbfaYMSpxZPUMAx4+hy343dRss+pVCLIfF62qOhxpYfZ5TmOk1GTDQm5f9wPprMNSStmnsV4w==",
			license: "MIT",
		},
		"node_modules/@scope/pkg": { version: "0.4.0", integrity: "sha1-MDQwY2M2Zjk5ZmRk" },
		"node_modules/local": { version: "0.0.0", link: true, resolved: "packages/local" },
		"node_modules/broken-integrity": { version: "2.0.0", integrity: "sha512-not base64!" },
		"node_modules/no-version": {},
	},
};

test("turns lockfile entries into components, skipping the root, links and unusable entries", () => {
	const components = componentsFromLock(LOCK);
	assert.deepEqual(
		components.map((component) => `${component.name}@${component.version}`),
		["@scope/pkg@0.4.0", "alpha@1.2.3", "broken-integrity@2.0.0"],
	);
	assert.equal(components[1].purl, "pkg:npm/alpha@1.2.3");
	assert.equal(components[1].hashes[0].alg, "SHA-512");
	// base64 → hex, so a reader can compare it with `sha512sum` output.
	assert.match(components[1].hashes[0].content, /^[0-9a-f]{128}$/);
	assert.equal(components[0].purl, "pkg:npm/%40scope/pkg@0.4.0");
});

test("keeps the lockfile path and licence as properties, so the SBOM is traceable", () => {
	const [scoped] = componentsFromLock({
		packages: { "node_modules/@scope/pkg": { version: "0.4.0" } },
	});
	assert.equal(scoped.properties[0].value, "node_modules/@scope/pkg");
	assert.equal(scoped["bom-ref"], "pkg:npm/%40scope/pkg@0.4.0?path=node_modules/@scope/pkg");
});

test("reads a purl for scoped and unscoped packages", () => {
	assert.equal(purlFor("alpha", "1.0.0"), "pkg:npm/alpha@1.0.0");
	assert.equal(purlFor("@scope/pkg", "1.0.0"), "pkg:npm/%40scope/pkg@1.0.0");
	assert.equal(nameOf("node_modules/a/node_modules/@s/b"), "@s/b");
	assert.equal(nameOf("packages/local"), undefined);
});

test("converts an integrity string, and returns nothing for one it cannot read", () => {
	assert.deepEqual(hashOf("sha256-AAAA"), { alg: "SHA-256", content: "000000" });
	assert.equal(hashOf("md5-AAAA"), undefined);
	assert.equal(hashOf(undefined), undefined);
});

test("builds the same document for the same lockfile", () => {
	const once = buildSbom(LOCK, { name: "mu", version: "0.1.7", now: new Date("2026-10-18T00:00:00.000Z") });
	const twice = buildSbom(LOCK, { name: "mu", version: "0.1.7", now: new Date("2026-10-18T00:00:00.000Z") });
	assert.deepEqual(twice, once);
	assert.equal(once.bomFormat, "CycloneDX");
	assert.equal(once.specVersion, "1.5");
	assert.match(once.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.equal(once.metadata.component.name, "mu");
	assert.equal(once.metadata.component.version, "0.1.7");
	// A different lockfile is a different BOM.
	const other = buildSbom({ packages: {} }, { name: "mu", version: "0.1.7", now: new Date("2026-10-18T00:00:00.000Z") });
	assert.notEqual(other.serialNumber, once.serialNumber);
	assert.deepEqual(other.components, []);
});

test("requires a version, and takes the commit when given one", () => {
	assert.throws(() => parseSbomArgs([]), /--version is required/);
	assert.throws(() => parseSbomArgs(["--nope"]), /unknown argument/);
	const options = parseSbomArgs(["--version", "0.1.7", "--out", "dist/sbom.cdx.json", "--commit", "abc123"]);
	assert.deepEqual(options, { lock: "package-lock.json", out: "dist/sbom.cdx.json", name: "mu", version: "0.1.7", commit: "abc123" });
	const sbom = buildSbom({ packages: {} }, options);
	assert.deepEqual(sbom.metadata.component.properties, [{ name: "mu:commit", value: "abc123" }]);
});
