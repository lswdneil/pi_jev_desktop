import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageDirectories } from "./package-workspaces.mjs";

/**
 * Which packages this repository publishes, and which names it must never publish under.
 *
 * Out of the box the harness packages still carry pi's scope (`@earendil-works/pi-ai` and friends). They are
 * workspace-internal: nobody outside this repository should see them, and publishing one would put this
 * project's build into a scope and a name that belong to pi. `private: true` in each manifest is the real
 * fence (npm refuses to publish it at all); this module is the second fence, for the publish script and for
 * anyone who removes the flag without thinking.
 */

/** The only package this repository publishes on npm. */
export const PUBLISHABLE_PACKAGES = Object.freeze(["mu-agent"]);

/**
 * The harness packages whose source is bundled into the published `mu-agent`. They are not published
 * alone, and they are the ones whose imports must therefore be declared: a missing dependency here breaks
 * the package that ships. (`evals` and `kyrn-judge` are not bundled: the kernel is built separately.)
 */
export const BUNDLED_PACKAGES = Object.freeze([
	"@earendil-works/chord",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-client",
	"@earendil-works/pi-codemode",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-durable",
	"@earendil-works/pi-mcp",
	"@earendil-works/pi-protocol",
	"@earendil-works/pi-server",
	"@earendil-works/pi-telemetry",
	"@earendil-works/pi-tui",
]);

/** Scopes owned by someone else. A name under one of these is never ours to take. */
export const FOREIGN_SCOPES = Object.freeze(["@earendil-works/"]);

/**
 * Why `pkg` must not be published, or undefined when it may be.
 *
 * `MU_ALLOW_FOREIGN_SCOPE=1` exists for the maintainers of those scopes themselves, and is read at call time
 * so a test can prove both branches.
 */
export function publishRefusal(pkg, options = {}) {
	const allowForeignScope = options.allowForeignScope ?? process.env.MU_ALLOW_FOREIGN_SCOPE === "1";
	if (pkg.private === true) return `${pkg.name} is private:true, so npm refuses it anyway`;
	if (allowForeignScope) return undefined;
	const foreign = FOREIGN_SCOPES.find((scope) => pkg.name.startsWith(scope));
	if (foreign) return `${pkg.name} is in a scope this repository does not own (${foreign})`;
	if (!PUBLISHABLE_PACKAGES.includes(pkg.name)) {
		return `${pkg.name} is not a package this repository publishes (only ${PUBLISHABLE_PACKAGES.join(", ")})`;
	}
	return undefined;
}

/** Every workspace package, with its manifest, whether or not it may be published. */
export function getWorkspacePackages() {
	return findPackageDirectories().map((directory) => ({
		directory,
		...JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
	}));
}

/**
 * The harness packages a consumer could install, as they choose among themselves.
 *
 * This is the set the release tooling and the consumer test pack. It is not the set npm would accept: those
 * manifests are `private: true`, so the name is kept for the code that asks "what ships together", and
 * `getPublishablePackages` is what asks "what may be published".
 */
export function getPublicWorkspacePackages() {
	return getWorkspacePackages()
		.filter((pkg) => BUNDLED_PACKAGES.includes(pkg.name))
		.map(({ directory, name, version }) => ({ directory, name, version }));
}

/** The packages that pass the publish guard: in practice none, since `mu-agent` is built, not a workspace. */
export function getPublishablePackages(options = {}) {
	return getWorkspacePackages()
		.filter((pkg) => publishRefusal(pkg, options) === undefined)
		.map(({ directory, name, version }) => ({ directory, name, version }));
}
