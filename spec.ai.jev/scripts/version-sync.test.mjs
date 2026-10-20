import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { latestReleasedVersion, releaseVersionProblems } from "./release-versions.mjs";

const dirs = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture({ templateVersion = "0.1.8", released = "0.1.8", changelog = true, desktop } = {}) {
	const root = mkdtempSync(join(tmpdir(), "mu-release-versions-"));
	dirs.push(root);
	mkdirSync(join(root, "kyrn", "npm"), { recursive: true });
	writeFileSync(
		join(root, "kyrn", "npm", "package.template.json"),
		`${JSON.stringify({ name: "spec-ai-agent", version: templateVersion }, null, "\t")}\n`,
	);
	if (changelog) {
		writeFileSync(join(root, "kyrn", "npm", "CHANGELOG.md"), `# Changelog\n\n## [Unreleased]\n\n## [${released}] - 2026-10-06\n\n- something\n`);
	}
	if (desktop !== undefined) {
		mkdirSync(join(root, "desktop-next"), { recursive: true });
		writeFileSync(join(root, "desktop-next", "package.json"), `${JSON.stringify({ name: "mu-desktop", version: desktop }, null, "\t")}\n`);
	}
	return root;
}

describe("latestReleasedVersion", () => {
	it("skips [Unreleased] and takes the newest released heading", () => {
		assert.equal(latestReleasedVersion("# Changelog\n\n## [Unreleased]\n\n- pending\n\n## [0.1.8] - 2026-10-06\n"), "0.1.8");
		assert.equal(latestReleasedVersion("no headings here"), undefined);
	});
});

describe("releaseVersionProblems", () => {
	it("finds nothing when the template and the changelog agree", () => {
		assert.deepEqual(releaseVersionProblems({ root: fixture() }), []);
	});

	it("reports drift in both directions, with the numbers in the message", () => {
		const bumpedOnly = releaseVersionProblems({ root: fixture({ templateVersion: "0.1.9", released: "0.1.8" }) });
		assert.equal(bumpedOnly.length, 1);
		assert.match(bumpedOnly[0], /0\.1\.9/);
		assert.match(bumpedOnly[0], /0\.1\.8/);

		const releasedOnly = releaseVersionProblems({ root: fixture({ templateVersion: "0.1.8", released: "0.1.9" }) });
		assert.equal(releasedOnly.length, 1);
		assert.match(releasedOnly[0], /drift/);
	});

	it("does not compare the monorepo root, which versions something else", () => {
		const root = fixture();
		writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "pi-monorepo", version: "0.0.3" }, null, "\t")}\n`);
		assert.deepEqual(releaseVersionProblems({ root }), []);
	});

	it("requires a missing changelog or template to be named, not assumed", () => {
		const noChangelog = releaseVersionProblems({ root: fixture({ changelog: false }) });
		assert.equal(noChangelog.length, 1);
		assert.match(noChangelog[0], /CHANGELOG/);

		const root = mkdtempSync(join(tmpdir(), "mu-release-empty-"));
		dirs.push(root);
		const noTemplate = releaseVersionProblems({ root });
		assert.equal(noTemplate.length, 1);
		assert.match(noTemplate[0], /template/);
	});

	it("keeps the desktop shell on the same base version once it exists", () => {
		assert.deepEqual(releaseVersionProblems({ root: fixture({ desktop: "0.1.8-beta.1" }) }), []);
		const wrong = releaseVersionProblems({ root: fixture({ desktop: "0.2.0" }) });
		assert.equal(wrong.length, 1);
		assert.match(wrong[0], /must start with the package's version/);
	});
});
