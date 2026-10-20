import assert from "node:assert/strict";
import { test } from "node:test";

import {
	compatibilityPolicyProblems,
	COMPATIBILITY_DOC,
	CONFIG_MIGRATIONS_SOURCE,
	diskFiles,
	REQUIRED_SECTIONS,
	VERSION_SOURCES,
} from "./compat-policy.mjs";

const DOC = `${REQUIRED_SECTIONS.join("\n\nstatement\n\n")}

The current format version is **1**.

${VERSION_SOURCES.join(" and ")}
`;

function repo(overrides = {}) {
	const files = new Map([
		[COMPATIBILITY_DOC, DOC],
		[CONFIG_MIGRATIONS_SOURCE, "export const CONFIG_SCHEMA_VERSION = 1;\nexport const CONFIG_MIGRATIONS = [];\n"],
		["package.json", JSON.stringify({ name: "pi-monorepo", version: "0.0.3" })],
		["kyrn/npm/package.template.json", JSON.stringify({ name: "mu-agent", version: "0.1.8" })],
		["CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [0.1.6] - 2026-09-30\n"],
	]);
	for (const [path, value] of Object.entries(overrides)) {
		if (value === undefined) files.delete(path);
		else files.set(path, value);
	}
	return files;
}

function check(overrides) {
	const files = repo(overrides);
	return compatibilityPolicyProblems({ read: (path) => files.get(path) });
}

test("a repository whose doc and code agree has no problems", () => {
	assert.deepEqual(check({}), []);
});

test("a schema version that drifted from the code is a problem", () => {
	assert.match(check({ [CONFIG_MIGRATIONS_SOURCE]: "export const CONFIG_SCHEMA_VERSION = 2;\nexport const CONFIG_MIGRATIONS = [];\n" }).join("\n"), /documents schema version 1 but .* declares 2/);
	assert.match(check({ [COMPATIBILITY_DOC]: DOC.replace("**1**", "**3**") }).join("\n"), /documents schema version 3/);
});

test("a missing doc, section, version source or changelog section is a problem", () => {
	assert.match(check({ [COMPATIBILITY_DOC]: undefined }).join("\n"), /is missing: there is nowhere/);
	assert.match(check({ [COMPATIBILITY_DOC]: DOC.replace("## Rollback", "## Undo") }).join("\n"), /no longer documents "## Rollback"/);
	assert.match(check({ [COMPATIBILITY_DOC]: DOC.replace("kyrn/npm/package.template.json", "") }).join("\n"), /does not name kyrn\/npm\/package\.template\.json/);
	assert.match(check({ [COMPATIBILITY_DOC]: DOC.replace("package.json", "") }).join("\n"), /does not name package\.json/);
	assert.match(check({ "CHANGELOG.md": "# Changelog\n" }).join("\n"), /no ## \[Unreleased\] section/);
	assert.match(check({ "package.json": undefined }).join("\n"), /is named in .* but does not exist/);
});

test("the real repository passes its own policy", () => {
	assert.deepEqual(compatibilityPolicyProblems(diskFiles(process.cwd())), []);
});
