// The request `custom-ca.test.ts` runs in a child process: `NODE_EXTRA_CA_CERTS` is read once, when Node starts, so
// the only way to prove that the product honours it is to start the product's check with the variable set.
//
// Usage: node check-key-child.ts <baseUrl>
// Prints the check's result as one JSON line, and nothing else.

import { checkKey } from "../../../src/setup/check.ts";

/** Node's own fetch, as `mu setup` uses it: the trust store is the process's, which is the point of the test. */
const run = async (baseUrl: string): Promise<void> => {
	const result = await checkKey({ kind: "openai-models", baseUrl, key: "sk-test", fetch: globalThis.fetch });
	process.stdout.write(`${JSON.stringify(result)}\n`);
};

const baseUrl = process.argv[2];
if (baseUrl === undefined) {
	process.stderr.write("usage: check-key-child.ts <baseUrl>\n");
	process.exitCode = 2;
} else {
	run(baseUrl).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
