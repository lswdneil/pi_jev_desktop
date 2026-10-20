import { describe, expect, it } from "vitest";
import {
	DEFAULT_HTTP_IDLE_TIMEOUT_MS,
	providerStreamHttpOptions,
	resolveHttpTimeouts,
} from "../../src/core/http-dispatcher.ts";
import { createBashTool } from "../../src/core/tools/bash.ts";

describe("http dispatcher budgets", () => {
	it("keeps the historical mapping when no stage policy is passed", () => {
		// One number fed both budgets before there was a policy: an unchanged call must behave unchanged.
		expect(resolveHttpTimeouts(DEFAULT_HTTP_IDLE_TIMEOUT_MS)).toEqual({
			headersTimeoutMs: 300_000,
			bodyTimeoutMs: 300_000,
		});
		expect(resolveHttpTimeouts(0)).toEqual({ headersTimeoutMs: 0, bodyTimeoutMs: 0 });
	});

	it("maps first-byte to headers and idle to the body, so a silent start fails faster than a slow body", () => {
		expect(resolveHttpTimeouts(DEFAULT_HTTP_IDLE_TIMEOUT_MS, { firstByteMs: 30_000, idleMs: 300_000 })).toEqual({
			headersTimeoutMs: 30_000,
			bodyTimeoutMs: 300_000,
		});
	});

	it("rejects a budget that is not a whole number of milliseconds", () => {
		expect(() => resolveHttpTimeouts(1_000, { firstByteMs: -1 })).toThrow(/firstByteMs/);
		expect(() => resolveHttpTimeouts(1_000, { idleMs: Number.NaN })).toThrow(/idleMs/);
	});
});

describe("providerStreamHttpOptions", () => {
	it("caps the first byte from the provider-stream preset and leaves the body to the user's setting", () => {
		expect(providerStreamHttpOptions(300_000)).toEqual({ firstByteMs: 30_000, idleMs: 300_000 });
	});

	it("lets a tighter user setting win over the cap", () => {
		expect(providerStreamHttpOptions(10_000)).toEqual({ firstByteMs: 10_000, idleMs: 10_000 });
	});

	it("does not reintroduce a timeout the user disabled", () => {
		expect(providerStreamHttpOptions(0)).toBeUndefined();
	});
});

describe("bash command timeout", () => {
	it("runs without a cap when no default is configured", async () => {
		const tool = createBashTool(process.cwd());
		const result = await tool.execute("test-call", { command: "echo held-open" }, undefined);
		const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
		expect(text).toContain("held-open");
	});

	it("kills the whole tree when the configured default expires", async () => {
		// 0.5 s of budget against a process that would sit for a minute: the point is the configured
		// cap reaching the existing tree-kill path, not the model's own timeout argument.
		const tool = createBashTool(process.cwd(), { defaultTimeoutMs: 500 });
		await expect(
			tool.execute("test-call", { command: 'node -e "setTimeout(() => {}, 60000)"' }, undefined),
		).rejects.toThrow(/timed out after 0\.5 seconds/);
	});

	it("lets the call's own timeout win over the configured default", async () => {
		const tool = createBashTool(process.cwd(), { defaultTimeoutMs: 500 });
		await expect(
			tool.execute("test-call", { command: 'node -e "setTimeout(() => {}, 60000)"', timeout: 1 }, undefined),
		).rejects.toThrow(/timed out after 1 seconds/);
	});
});
