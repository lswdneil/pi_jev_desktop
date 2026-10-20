import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type CheckResult, explainProblem } from "../src/setup/check.ts";

const execFileAsync = promisify(execFile);

/**
 * The custom-CA path end to end: a local HTTPS server whose certificate only the committed test CA can vouch for,
 * asked by `mu setup`'s own model-list check.
 *
 * The child process is the point. Node reads `NODE_EXTRA_CA_CERTS` once, at startup, so setting it inside this
 * process would prove nothing; the test sets it for the check's process and asserts both directions — trusted when
 * named, and a TLS failure with a sentence a person can act on when not.
 */

const here = fileURLToPath(new URL("./fixtures/tls/", import.meta.url));
const ca = join(here, "ca.pem");
const child = join(here, "check-key-child.ts");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
	const key = readFileSync(join(here, "server.key"));
	const cert = readFileSync(join(here, "server.pem"));
	server = createServer({ key, cert }, (request, response) => {
		if (request.url === "/models") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ data: [{ id: "local-check-model" }] }));
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Run the check in a child process with the environment Node will read at startup. Proxies are cleared so the
 * request cannot be diverted, and `NODE_EXTRA_CA_CERTS` is removed unless this call supplies it: an inherited value
 * would make the "untrusted" direction pass for the wrong reason.
 *
 * Asynchronous on purpose: a synchronous spawn blocks this process's event loop, so the server above cannot answer
 * the child and every case ends in a timeout instead of the TLS failure under test.
 */
async function runCheck(extraEnv: Readonly<Record<string, string>>): Promise<CheckResult> {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		HTTP_PROXY: "",
		HTTPS_PROXY: "",
		ALL_PROXY: "",
		NO_PROXY: "127.0.0.1",
	};
	if (extraEnv.NODE_EXTRA_CA_CERTS === undefined) delete env.NODE_EXTRA_CA_CERTS;
	Object.assign(env, extraEnv);
	const { stdout } = await execFileAsync(process.execPath, [child, baseUrl], {
		encoding: "utf8",
		timeout: 60_000,
		env,
	});
	return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as CheckResult;
}

describe("a custom CA for the setup check", () => {
	it("is trusted when NODE_EXTRA_CA_CERTS names it: the model list comes back", async () => {
		const result = await runCheck({ NODE_EXTRA_CA_CERTS: ca });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.models).toEqual(["local-check-model"]);
	});

	it("is not trusted without it, and the TLS failure comes with a sentence a person can act on", async () => {
		const result = await runCheck({});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.problem.kind).toBe("tls");
		const english = explainProblem(result.problem, { service: "Local" }, "en");
		expect(english).toMatch(/secure connection to 127\.0\.0\.1(:\d+)? failed/);
		expect(english).toMatch(/proxy or firewall/);
		expect(explainProblem(result.problem, { service: "Local" }, "zh")).toMatch(/安全连接/);
	});
});
