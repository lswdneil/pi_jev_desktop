// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import { RpcClosedError, RpcConnection, RpcTimeoutError } from "../../src/main/rpc.ts";
import { FakeProcess } from "./fakes.ts";

/**
 * The protocol side of one agent process: numbered requests, routed responses, unsolicited events, and every way the
 * conversation can end.
 */

function connect(process: FakeProcess, requestTimeoutMs = 200): RpcConnection {
	return new RpcConnection(process, { requestTimeoutMs });
}

describe("requests", () => {
	it("numbers a request and resolves the response with that number", async () => {
		const process = new FakeProcess();
		const connection = connect(process);

		const answer = connection.request({ type: "abort" });
		expect(process.lastCommand()).toEqual({ type: "abort", id: "1" });
		process.emit({ type: "response", id: "1", command: "abort", success: true });

		await expect(answer).resolves.toMatchObject({ command: "abort", success: true });
		expect(connection.getPendingCount()).toBe(0);
	});

	it("keeps two requests apart", async () => {
		const process = new FakeProcess();
		const connection = connect(process);

		const first = connection.request({ type: "get_state" });
		const second = connection.request({ type: "abort" });
		// Answer the second one first: the mapping is by id, not by arrival order.
		process.emit({ type: "response", id: "2", command: "abort", success: true });
		process.emit({ type: "response", id: "1", command: "get_state", success: true, data: { sessionId: "s-1" } });

		await expect(second).resolves.toMatchObject({ command: "abort" });
		await expect(first).resolves.toMatchObject({ command: "get_state" });
	});

	it("rejects a failure response with the agent's own message", async () => {
		const process = new FakeProcess();
		const connection = connect(process);

		const answer = connection.request({ type: "prompt", message: "hello" });
		process.emit({ type: "response", id: "1", command: "prompt", success: false, error: "no model is configured" });

		await expect(answer).rejects.toThrow("prompt failed: no model is configured");
	});

	it("gives up on a request nobody answers", async () => {
		const process = new FakeProcess();
		const connection = connect(process, 5);

		await expect(connection.request({ type: "get_state" })).rejects.toBeInstanceOf(RpcTimeoutError);
	});
});

describe("events", () => {
	it("passes anything that is not a response to the listeners", () => {
		const process = new FakeProcess();
		const connection = connect(process);
		const seen: string[] = [];
		connection.onEvent((event) => seen.push(event.type));

		process.emit({ type: "message_update", message: { role: "assistant" } });
		process.emit({ type: "extension_ui_request", id: "7", method: "confirm", title: "run it?" });

		expect(seen).toEqual(["message_update", "extension_ui_request"]);
	});

	it("ignores a response for an id nobody sent, and counts what is not JSON", async () => {
		const process = new FakeProcess();
		const connection = connect(process);
		const seen: string[] = [];
		connection.onEvent((event) => seen.push(event.type));

		process.emit({ type: "response", id: "999", command: "abort", success: true });
		process.emitChunk("pi v0.5.0 starting\n");
		process.emit({ type: "message_update" });

		expect(seen).toEqual(["message_update"]);
		expect(connection.getUnparsedLines()).toBe(1);
	});

	it("reassembles a message split across chunks", () => {
		const process = new FakeProcess();
		const connection = connect(process);
		const seen: string[] = [];
		connection.onEvent((event) => seen.push(event.type));

		process.emitChunk('{"type":"mess');
		process.emitChunk('age_update"}\n');

		expect(seen).toEqual(["message_update"]);
		expect(connection.getUnparsedLines()).toBe(0);
	});
});

describe("ending", () => {
	it("rejects what is pending when the agent exits, and carries its stderr", async () => {
		const process = new FakeProcess();
		const connection = connect(process);
		process.emitStderr("Error: no API key for anthropic\n");

		const answer = connection.request({ type: "get_state" });
		process.die(2);

		await expect(answer).rejects.toBeInstanceOf(RpcClosedError);
		await expect(answer).rejects.toThrow("no API key for anthropic");
		expect(connection.getStderrTail()).toContain("no API key");
	});

	it("reports a process that never started", async () => {
		const process = new FakeProcess();
		const connection = connect(process);

		const answer = connection.request({ type: "abort" });
		process.failToStart("spawn mu ENOENT");

		await expect(answer).rejects.toThrow("spawn mu ENOENT");
	});

	it("refuses new work and kills the process when disposed", async () => {
		const process = new FakeProcess();
		const connection = connect(process);
		const pending = connection.request({ type: "get_state" });

		connection.dispose();

		await expect(pending).rejects.toBeInstanceOf(RpcClosedError);
		await expect(connection.request({ type: "abort" })).rejects.toBeInstanceOf(RpcClosedError);
		expect(process.killed).toBe(true);
	});
});
