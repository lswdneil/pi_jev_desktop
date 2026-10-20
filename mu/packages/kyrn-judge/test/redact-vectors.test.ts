import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/redact.ts";

interface Vector {
	name: string;
	input: string;
	forbidden: string[];
	required: string[];
}

/**
 * The host writes crash records with `packages/coding-agent/src/core/redact.ts`, this kernel redacts what
 * leaves for the judge, and the dependency only goes host → kernel: the two implementations cannot share
 * code. They share samples instead, so a pattern that drifts on one side fails the other side's test.
 */
const VECTORS: Vector[] = JSON.parse(
	readFileSync(join(__dirname, "..", "..", "coding-agent", "test", "fixtures", "redact-vectors.json"), "utf8"),
);

describe("redaction agrees with the host's crash records", () => {
	for (const vector of VECTORS) {
		it(vector.name, () => {
			const clean = redactSecrets(vector.input);
			for (const secret of vector.forbidden) expect(clean).not.toContain(secret);
			for (const kept of vector.required) expect(clean).toContain(kept);
		});
	}
});
