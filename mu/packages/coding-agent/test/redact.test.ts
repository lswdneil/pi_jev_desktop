import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { environmentSecrets, REDACTED, redactFailure, redactSecrets } from "../src/core/redact.ts";

interface Vector {
	name: string;
	input: string;
	forbidden: string[];
	required: string[];
}

// The same file the kernel's test reads: both implementations must agree on every sample.
const VECTORS: Vector[] = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "redact-vectors.json"), "utf8"),
);

describe("redactSecrets", () => {
	for (const vector of VECTORS) {
		it(vector.name, () => {
			const clean = redactSecrets(vector.input);
			for (const secret of vector.forbidden) expect(clean).not.toContain(secret);
			for (const kept of vector.required) expect(clean).toContain(kept);
		});
	}

	it("takes out a value of this process's own credential variables, wherever it appears", () => {
		const known = environmentSecrets({ MY_SERVICE_TOKEN: "abc0123456789def" });
		expect(known).toEqual(["abc0123456789def"]);
		expect(redactSecrets("log line: abc0123456789def", known)).toBe(`log line: ${REDACTED}`);
	});

	it("does not take out a setting that only looks like one", () => {
		expect(environmentSecrets({ MAX_TOKENS: "4096", DEBUG: "true", TZ: "UTC" })).toEqual([]);
	});
});

describe("redactFailure", () => {
	it("redacts the message and the stack of an error", () => {
		const error = new Error("auth failed for sk-proj-AbCdEf0123456789AbCdEf0123456789");
		error.stack = `Error: auth failed for sk-proj-AbCdEf0123456789AbCdEf0123456789\n    at run (${"file:///app/x.js:1:1"})`;
		const failure = redactFailure(error);
		expect(failure.message).not.toContain("sk-proj-AbCdEf0123456789AbCdEf0123456789");
		expect(failure.stack).not.toContain("sk-proj-AbCdEf0123456789AbCdEf0123456789");
		expect(failure.stack).toContain("x.js:1:1");
	});

	it("describes a thrown value that is not an error", () => {
		expect(redactFailure({ code: "EACCES", path: "/etc/shadow" }).message).toBe(
			'{"code":"EACCES","path":"/etc/shadow"}',
		);
	});
});
