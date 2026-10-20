#!/usr/bin/env node

// Hydrate packages/ai model data from a fixed catalog revision instead of the
// live models.dev fetch that `npm run generate-models` performs.
//
//   node scripts/hydrate-model-data-from-pin.mjs            # use nix/model-catalog.json
//   node scripts/hydrate-model-data-from-pin.mjs --from <file>   # use a local catalog JSON
//   node scripts/hydrate-model-data-from-pin.mjs --check    # validate the pin only, write nothing
//
// Why: `packages/ai/src/providers/data/` is gitignored and regenerated from the
// live catalog on every build, so a models.dev rename turns the type check of
// `packages/ai/test/**` red without anyone touching the repository. Hydrating
// from the pin makes the build reproducible until someone moves the pin with
// `npm run update:model-catalog-pin`.
//
// The catalog endpoint returns the same bytes a revision hashes, so a mismatch
// is a hard error: a pin that no longer matches its content must never be used.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateModelCatalog } from "../packages/ai/scripts/hydrate-model-catalog.ts";

const MODEL_TYPES = "types=chat,image,classifier";
const REVISION_RE = /^sha256-[0-9a-f]{64}$/;
const CATALOG_URL = "https://pi.dev/api/models/revisions";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function usage() {
	console.log(`Usage: node scripts/hydrate-model-data-from-pin.mjs [--from <file>] [--check]

  --from <file>  hydrate from this catalog JSON instead of the pinned revision
  --check        verify the source and print the plan, write nothing`);
}

function parseArgs(argv) {
	let from;
	let check = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--check") {
			check = true;
			continue;
		}
		if (arg === "--from") {
			from = argv[++index];
			if (!from) throw new Error("--from requires a path");
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			usage();
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return { from: from === undefined ? undefined : resolve(from), check };
}

function sha256(bytes) {
	return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

function readPin() {
	const pinPath = join(root, "nix/model-catalog.json");
	const pin = JSON.parse(readFileSync(pinPath, "utf8"));
	if (typeof pin.revision !== "string" || !REVISION_RE.test(pin.revision)) {
		throw new Error(`Invalid revision in ${pinPath}`);
	}
	return pin.revision;
}

async function fetchRevision(revision) {
	const response = await fetch(`${CATALOG_URL}/${revision}?${MODEL_TYPES}`);
	if (!response.ok) throw new Error(`Catalog revision ${revision} is unavailable: HTTP ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (sha256(bytes) !== revision) throw new Error(`Catalog revision ${revision} does not match its content`);
	return bytes;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const bytes = options.from ? readFileSync(options.from) : await fetchRevision(readPin());
	const digest = sha256(bytes);
	const catalogPath = join(root, ".artifacts/model-catalog/models.all.json");
	const aiRoot = join(root, "packages/ai");
	const sourcePath = options.from ?? catalogPath;

	if (!options.from) {
		mkdirSync(dirname(catalogPath), { recursive: true });
		writeFileSync(catalogPath, bytes);
	}

	hydrateModelCatalog(aiRoot, sourcePath, { validateOnly: true });
	console.log(`catalog ok  ${bytes.length} bytes  ${digest}`);
	if (options.check) {
		console.log("check only: nothing hydrated");
		return;
	}

	hydrateModelCatalog(aiRoot, sourcePath);
	console.log(`hydrated    ${join(aiRoot, "src", "providers", "data")}`);
}

await main();
